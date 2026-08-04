// Serwer proxy AI dla Narwhala — Cloudflare Worker + Hono.
//
// Jedyny endpoint: POST /verify — przyjmuje tekst rozdziału i notatki autora,
// zwraca listę problemów (gramatyka / spójność / logika).
//
// Dwa tryby, przełączane obecnością klucza:
//  - BRAK klucza (ANTHROPIC_API_KEY nieustawiony) → atrapa z przykładowymi
//    danymi; pozwala testować całe okablowanie aplikacji bez kosztów
//  - klucz obecny (.dev.vars lokalnie / wrangler secret produkcyjnie) →
//    prawdziwa weryfikacja przez API Anthropic
//
// Dostęp: gdy ustawiony jest NARWHAL_AUTH_TOKEN, /verify wymaga nagłówka
// `Authorization: Bearer <token>` (inaczej 401). Bez tokenu bramka jest wyłączona,
// żeby praca lokalna nie wymagała konfiguracji.
//
// TWARDA ZASADA: klucz API żyje wyłącznie tutaj, nigdy w aplikacji desktopowej.

import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";

/** Zmienne środowiskowe Workera (lokalnie: .dev.vars, produkcyjnie: secret). */
interface Env {
  ANTHROPIC_API_KEY?: string;
  /**
   * Token wymagany w nagłówku `Authorization: Bearer`. Nieustawiony = bramka
   * wyłączona, żeby lokalny `wrangler dev` działał bez żadnej konfiguracji.
   * Na produkcji ustawiany przez `wrangler secret put NARWHAL_AUTH_TOKEN`.
   */
  NARWHAL_AUTH_TOKEN?: string;
  /** Licznik tempa żądań (binding `[[ratelimits]]` w wrangler.toml). */
  VERIFY_RATE_LIMIT?: RateLimiter;
}

/**
 * Binding limitera Cloudflare. Własny interfejs zamiast typu z SDK, żeby kod
 * kompilował się niezależnie od wersji `@cloudflare/workers-types`.
 */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/* Górne ograniczenia żądania. Bez nich pojedyncze żądanie może kosztować
 * dowolnie dużo: koszt API rośnie liniowo z rozmiarem wejścia.
 *
 * Wartości dobrane tak, by ZMIEŚCIŁA SIĘ CAŁA SPORA KSIĄŻKA. Sonnet 5 ma okno
 * kontekstu 1 mln tokenów; polski tokenizuje się mniej więcej po 2,5 znaku na
 * token, więc 1,8 mln znaków to ok. 700 tys. tokenów — grubo ponad 250 tys.
 * słów, z zapasem na prompt systemowy i odpowiedź. Odcinamy dopiero to, czego
 * model i tak by nie przyjął. */
/** Twardy limit ciała żądania; sprawdzany przed parsowaniem JSON-a. */
const MAX_BODY_BYTES = 8_000_000;
/** Łącznie tekst + notatki + rozdziały (~700 tys. tokenów dla polskiego). */
const MAX_TOTAL_CHARS = 1_800_000;
/** Sam weryfikowany rozdział — pojedynczy rozdział nigdy nie jest tak długi. */
const MAX_TEXT_CHARS = 200_000;

/** Kategorie problemów — muszą odpowiadać IssueType w app/src/lib/ai.ts. */
type IssueType = "grammar" | "consistency" | "logic";

interface Issue {
  type: IssueType;
  fragment: string;
  description: string;
  suggestion: string;
}

interface VerifyRequest {
  text: string;
  notes: { title: string; content: string }[];
  /** Pozostałe rozdziały jako kontekst spójności (opcjonalne — starsze wersje aplikacji ich nie wysyłają). */
  chapters?: { title: string; content: string }[];
}

/** Zużycie tokenów pojedynczej weryfikacji — do wyświetlenia w UI. */
interface VerifyUsage {
  /** Tokeny wejścia pełnopłatne (poza cache). */
  input: number;
  /** Tokeny zapisane do cache (stawka 1,25–2×). */
  cacheWrite: number;
  /** Tokeny odczytane z cache (stawka ~0,1×). */
  cacheRead: number;
  /** Tokeny wyjścia (myślenie + odpowiedź). */
  output: number;
}

/** Linie strumienia NDJSON zwracanego przez POST /verify — błędy wypychane
 *  pojedynczo, gdy tylko model dokończy dany obiekt (UI pokazuje je na żywo). */
type StreamMsg =
  | { type: "start"; mock: boolean }
  | { type: "issue"; issue: Issue }
  | { type: "done"; usage?: VerifyUsage }
  | { type: "error"; message: string };

const app = new Hono<{ Bindings: Env }>();

// CORS: wpuszczamy wyłącznie okno aplikacji Narwhal.
//  - http://localhost:1420 — tryb deweloperski (vite)
//  - http(s)://tauri.localhost — webview spakowanej aplikacji na Windows
//  - tauri://localhost — webview spakowanej aplikacji na macOS i Linuksie
//    (inny schemat protokołu niż na Windows, dlatego osobny wpis)
// allowHeaders trzeba podać jawnie: bez „Authorization" preflight odrzuciłby
// żądanie z tokenem, a Hono domyślnie nie wpuszcza żadnych własnych nagłówków.
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:1420",
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
    ],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Prosty health-check — pozwala sprawdzić, w którym trybie działa serwer
// i czy bramka dostępu jest aktywna (`auth: "off"` = token nieustawiony).
app.get("/", (c) =>
  c.json({
    ok: true,
    mode: c.env.ANTHROPIC_API_KEY ? "live" : "mock",
    auth: c.env.NARWHAL_AUTH_TOKEN ? "on" : "off",
  }),
);

/* ------------------------------------------------------------------ */
/* Bramka dostępu                                                      */
/* ------------------------------------------------------------------ */

/**
 * Wynik bramki. `userId` trafia do logu zużycia — dziś jest jeden token
 * deweloperski i stałe „dev", docelowo token zalogowanego użytkownika i jego
 * identyfikator (Blok 3 w TODO.md). Trzymanie tego już teraz w jednym miejscu
 * oznacza, że dodanie prawdziwej tożsamości to zmiana tylko w authenticate().
 */
type Auth = { ok: true; userId: string } | { ok: false };

/**
 * Porównanie tokenów w czasie niezależnym od tego, ile znaków się zgadza.
 * Zwykłe `===` przerywa na pierwszej różnicy, co teoretycznie pozwala zgadywać
 * token bajt po bajcie. Własna implementacja, bo nie chcemy zależeć od tego,
 * czy dany runtime ma `crypto.subtle.timingSafeEqual`. Długość i tak wycieka —
 * to standardowy i akceptowany kompromis.
 */
function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Pyta Claude'a, w jakim języku napisany jest rozdział. Osobne mikro-zapytanie
 * do Haiku (kilkadziesiąt tokenów), bo tylko **nazwa** języka podana z góry
 * skutecznie steruje głównym wywołaniem.
 *
 * Cztery podejścia bez osobnego zapytania zawiodły — instrukcja w prompcie
 * systemowym, opisy pól w schemacie, przypomnienie tuż przy tekście i pole
 * `language` jako pierwsze w structured outputs. Za każdym razem model kopiował
 * język notatek, więc rozdział po angielsku dostawał opisy po polsku.
 * Nie wracać do tych wariantów bez dowodu, że coś się zmieniło.
 *
 * Wykrywanie robi model, nie regexp — zgodnie z wymaganiem, że ma to działać
 * dla dowolnego języka, nie tylko polskiego i angielskiego.
 */
async function detectLanguage(client: Anthropic, text: string): Promise<string> {
  // Próbka wystarczy — język widać po pierwszym akapicie, a krótkie wejście
  // trzyma koszt i opóźnienie tego kroku na poziomie szumu.
  const sample = text.slice(0, 1500);
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16,
      system:
        "Reply with the English name of the language the text is written in, and nothing else. Examples: English, Polish, Spanish, German.",
      messages: [{ role: "user", content: sample }],
    });
    const block = res.content.find((b) => b.type === "text");
    const name = block?.type === "text" ? block.text.trim() : "";
    // Sanity check: nazwa języka to jedno–dwa słowa liter. Cokolwiek innego
    // znaczy, że model odpowiedział nie tak — wtedy angielski, zgodnie z regułą.
    return /^[A-Za-z][A-Za-z ]{1,24}$/.test(name) ? name : "English";
  } catch {
    // Wykrywanie języka nie może wywalić całej weryfikacji.
    return "English";
  }
}

/** Sumaryczna długość tytułów i treści bloku kontekstu (odporna na złe wpisy). */
function blockLength(items: { title: string; content: string }[] | undefined): number {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (const item of items) {
    total += String(item?.title ?? "").length + String(item?.content ?? "").length;
  }
  return total;
}

/**
 * Czyta ciało żądania jako tekst, przerywając po przekroczeniu `maxBytes`.
 * Zwraca `null`, gdy limit padł — wtedy wołający odpowiada 413.
 *
 * Powód, dla którego nie wystarczy `c.req.json()`: sprawdzenie nagłówka
 * Content-Length omija żądanie z `Transfer-Encoding: chunked`, bo tam tego
 * nagłówka po prostu nie ma. Bez licznika po stronie strumienia pułapem
 * zostaje limit Cloudflare (100 MB), a każdy taki bajt to czas CPU Workera.
 */
async function readBounded(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Przestań pobierać resztę — dalsze bajty nic już nie zmienią.
      await reader.cancel();
      return null;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function authenticate(c: Context<{ Bindings: Env }>): Auth {
  const expected = c.env.NARWHAL_AUTH_TOKEN;
  // Bramka wyłączona — lokalny wrangler dev ma działać bez konfiguracji.
  if (!expected) return { ok: true, userId: "anonymous" };

  const prefix = "Bearer ";
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith(prefix)) return { ok: false };
  if (!tokensEqual(header.slice(prefix.length), expected)) return { ok: false };
  return { ok: true, userId: "dev" };
}

app.post("/verify", async (c) => {
  // Sprawdzamy uprawnienia PRZED czytaniem ciała żądania — nieuprawniony
  // klient nie powinien być w stanie zmusić Workera do żadnej pracy.
  const auth = authenticate(c);
  if (!auth.ok) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  // Limit tempa. Token dostępu leży w bundlu aplikacji, więc trzeba założyć,
  // że kiedyś wycieknie — wtedy to jest jedyna rzecz, która stoi między
  // wyciekiem a pętlą generującą rachunek. Kluczem jest adres IP; gdy dojdą
  // konta, powinien nim być identyfikator użytkownika.
  const limiter = c.env.VERIFY_RATE_LIMIT;
  if (limiter) {
    const key = c.req.header("CF-Connecting-IP") ?? auth.userId;
    const { success } = await limiter.limit({ key });
    if (!success) {
      return c.json({ error: "Too many requests. Try again in a minute." }, 429);
    }
  }

  // Odrzuć zbyt duże ciało przed parsowaniem — parsowanie kilkumegabajtowego
  // JSON-a samo w sobie kosztuje czas CPU, którego na darmowym planie jest 10 ms.
  //
  // Content-Length to tylko szybka ścieżka: nagłówka nie ma w żądaniu chunked,
  // a klient może go zaniżyć. Prawdziwym ogranicznikiem jest readBounded(),
  // które liczy bajty w miarę czytania i przerywa po przekroczeniu progu.
  const declaredBytes = Number(c.req.header("Content-Length") ?? 0);
  if (declaredBytes > MAX_BODY_BYTES) {
    return c.json({ error: "Request too large." }, 413);
  }

  const raw = await readBounded(c.req.raw, MAX_BODY_BYTES);
  if (raw === null) {
    return c.json({ error: "Request too large." }, 413);
  }

  let body: VerifyRequest;
  try {
    body = JSON.parse(raw) as VerifyRequest;
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Expected { text: string, notes: [] }." }, 400);
  }
  if (typeof body.text !== "string" || !Array.isArray(body.notes)) {
    return c.json({ error: "Expected { text: string, notes: [] }." }, 400);
  }
  if (body.chapters !== undefined && !Array.isArray(body.chapters)) {
    return c.json({ error: "Expected chapters to be an array." }, 400);
  }

  // Content-Length bywa nieobecny albo skłamany, więc mierzymy też to, co
  // faktycznie poszłoby do modelu. `blockLength` jest odporny na wpisy o złym
  // kształcie — pola bez treści liczą się jako puste, zamiast wywalać żądanie.
  if (body.text.length > MAX_TEXT_CHARS) {
    return c.json({ error: "Chapter too long to verify." }, 413);
  }
  const totalChars =
    body.text.length + blockLength(body.notes) + blockLength(body.chapters);
  if (totalChars > MAX_TOTAL_CHARS) {
    return c.json({ error: "Project too large to verify in one request." }, 413);
  }

  const hasKey = Boolean(c.env.ANTHROPIC_API_KEY);

  // Odpowiedź to strumień NDJSON: start → issue* → done (albo error).
  // Dzięki temu UI pokazuje błędy pojedynczo, w trakcie pracy modelu.
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  return stream(c, async (s) => {
    const send = async (msg: StreamMsg): Promise<void> => {
      await s.writeln(JSON.stringify(msg));
    };
    await send({ type: "start", mock: !hasKey });

    if (!body.text.trim()) {
      await send({ type: "done" });
      return;
    }

    if (!hasKey) {
      // Atrapa z opóźnieniami — pozwala obejrzeć strumieniowe UI bez klucza.
      for (const issue of MOCK_ISSUES) {
        await s.sleep(350);
        await send({ type: "issue", issue });
      }
      await send({ type: "done" });
      return;
    }

    try {
      const usage = await verifyWithClaude(
        c.env.ANTHROPIC_API_KEY!,
        body,
        auth.userId,
        (issue) => send({ type: "issue", issue }),
      );
      await send({ type: "done", usage });
    } catch (e) {
      console.error("verify failed:", e);
      await send({ type: "error", message: "Verification failed on the AI server." });
    }
  });
});

export default app;

/* ------------------------------------------------------------------ */
/* Tryb LIVE — prawdziwa weryfikacja przez API Anthropic               */
/* ------------------------------------------------------------------ */

// Schemat JSON odpowiedzi modelu (structured outputs) — gwarantuje,
// że dostaniemy poprawny Issue[] bez ręcznego parsowania prozy.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["grammar", "consistency", "logic"] },
          fragment: {
            type: "string",
            description: "Exact short quote from the text (max ~15 words)",
          },
          description: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["type", "fragment", "description", "suggestion"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a meticulous editorial assistant inside a book-writing app.
You receive a chapter (or document) in Markdown, plus the author's notes
(worldbuilding, characters, bibliography) that define the rules of the work,
and the other chapters of the same work as context.

Find concrete problems in the verified text and classify each as exactly one of:
- "grammar" — grammar, spelling or punctuation errors
- "consistency" — a fact in the text contradicts something already established,
  no matter the source: the verified text itself, another chapter, or the
  author's notes (names, character traits, appearance, objects, places, dates)
- "logic" — the text does not add up on its own terms: impossible or reversed
  sequences of events, an effect preceding its cause, a character acting on
  knowledge they could not have, or an event that breaks a rule of the world
  stated in the notes (e.g. casting a spell at night when magic works by day)

Choosing between the two: ask what is wrong. If a stated fact simply does not
match what was established elsewhere, that is "consistency". If the facts are
individually fine but the events could not have happened that way, that is
"logic".

Rules:
- Report only problems in the verified text — never in the notes or other chapters.
- Report only genuine, specific problems. No stylistic preferences, no praise.
- "fragment" must be an exact quote from the verified text (max ~15 words).
- If there are no problems, return an empty issues list.

- Write every "description" and "suggestion" in the language named in the
  "## Text to verify" section below.`;

/**
 * Przyrostowy ekstraktor obiektów `issue` z częściowego JSON-a.
 * Model streamuje `{"issues":[{...},{...}]}` kawałkami — obiekt issue zaczyna
 * się, gdy głębokość klamer rośnie z 1 na 2, a kończy przy powrocie na 1.
 * Śledzimy stan stringów (cudzysłowy, escape), żeby klamry w treści opisów
 * nie psuły liczenia. push() zwraca obiekty dokończone w danym kawałku.
 */
function makeIssueExtractor(): { push: (chunk: string) => Issue[] } {
  let buf = "";
  let inString = false;
  let escape = false;
  let depth = 0;
  let start = -1;

  return {
    push(chunk: string): Issue[] {
      const completed: Issue[] = [];
      for (const ch of chunk) {
        buf += ch;
        if (inString) {
          if (escape) escape = false;
          else if (ch === "\\") escape = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === "{") {
          depth++;
          if (depth === 2) start = buf.length - 1;
        } else if (ch === "}") {
          if (depth === 2 && start !== -1) {
            try {
              completed.push(JSON.parse(buf.slice(start)) as Issue);
            } catch {
              // Niedomknięty/uszkodzony obiekt — pominięcie jest bezpieczne,
              // finalna odpowiedź i tak przechodzi przez structured outputs.
            }
            start = -1;
          }
          depth--;
        }
      }
      return completed;
    },
  };
}

async function verifyWithClaude(
  apiKey: string,
  { text, notes, chapters }: VerifyRequest,
  userId: string,
  onIssue: (issue: Issue) => Promise<void>,
): Promise<VerifyUsage> {
  const client = new Anthropic({ apiKey });

  // Najpierw pytamy o język — wynik trafia do promptu głównego jako nazwa.
  const language = await detectLanguage(client, text);

  const notesBlock =
    notes.length > 0
      ? notes.map((n) => `### ${n.title}\n\n${n.content}`).join("\n\n")
      : "(no author notes provided)";

  const chaptersBlock =
    chapters && chapters.length > 0
      ? chapters.map((ch) => `### ${ch.title}\n\n${ch.content}`).join("\n\n")
      : "(no other chapters)";

  // Prompt caching: cache to dopasowanie prefiksu (unieważnienie kaskaduje
  // w dół), więc treść układamy tak, by duże bloki były przed zmiennymi:
  // system prompt → pozostałe rozdziały (duże) → notatki (małe) → weryfikowany
  // rozdział (zmienny, bez cache). Osobne breakpointy na rozdziałach i
  // notatkach sprawiają, że edycja notatki przepisuje w cache tylko notatki —
  // rozdziały dalej czytają się za ~10% ceny. TTL 1h, bo między sprawdzeniami
  // podczas pisania mija zwykle więcej niż 5 minut.
  //
  // Streaming: długi rozdział + myślenie modelu potrafią trwać dziesiątki
  // sekund — stream zapobiega timeoutom HTTP, a finalMessage() składa całość.
  const msgStream = client.messages.stream({
    model: "claude-sonnet-5",
    max_tokens: 16000,
    output_config: {
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    // TTL 1h także tutaj — API wymaga, by dłuższy TTL nie następował po krótszym
    // (kolejność przetwarzania: tools → system → messages).
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `## Other chapters (context)\n\n${chaptersBlock}`,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
          {
            type: "text",
            text: `## Author's notes\n\n${notesBlock}`,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
          {
            // Nazwa języka stoi tuż przy tekście i jest tym, co realnie steruje
            // odpowiedzią. Blok jest poza cache (zmienia się co żądanie).
            type: "text",
            text: `## Text to verify\n\n(This text is written in ${language}. Write every description and suggestion in ${language}.)\n\n${text}`,
          },
        ],
      },
    ],
  });

  // Wypychaj każdy dokończony obiekt issue od razu, w trakcie strumienia.
  const extractor = makeIssueExtractor();
  for await (const event of msgStream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      for (const issue of extractor.push(event.delta.text)) {
        await onIssue(issue);
      }
    }
  }

  const message = await msgStream.finalMessage();

  // Klasyfikatory mogły odrzucić żądanie — wtedy nie ufamy treści.
  if (message.stop_reason === "refusal") {
    throw new Error("Request declined by safety filters.");
  }

  // Zużycie tokenów — do logu i do UI (cache_read > 0 oznacza,
  // że prefiks poszedł za ~10% ceny).
  const usage: VerifyUsage = {
    input: message.usage.input_tokens,
    cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
    cacheRead: message.usage.cache_read_input_tokens ?? 0,
    output: message.usage.output_tokens,
  };
  // `user` w logu jest po to, by dało się policzyć koszt na użytkownika —
  // bez tego nie ma danych do wyceny planów ani do ustawienia limitów.
  console.log(
    `usage: user=${userId} input=${usage.input} cache_write=${usage.cacheWrite}` +
      ` cache_read=${usage.cacheRead} output=${usage.output}`,
  );
  return usage;
}

/* ------------------------------------------------------------------ */
/* Tryb MOCK — dane przykładowe (serwer bez klucza)                    */
/* ------------------------------------------------------------------ */

const MOCK_ISSUES: Issue[] = [
  {
    type: "grammar",
    fragment: "example sentence fragment",
    description:
      "Possible punctuation error — a missing comma before the conjunction.",
    suggestion: 'Add a comma before "which".',
  },
  {
    type: "consistency",
    fragment: "character name",
    description:
      "This character was previously introduced under a different name.",
    suggestion: 'Align the character\'s name with the "Characters" note.',
  },
  {
    type: "logic",
    fragment: "event description",
    description:
      "This event contradicts a world rule described in the notes.",
    suggestion: 'Check consistency with the "World rules" note.',
  },
];
