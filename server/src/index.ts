// Serwer proxy AI dla Koali — Cloudflare Worker + Hono.
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
// TWARDA ZASADA: klucz API żyje wyłącznie tutaj, nigdy w aplikacji desktopowej.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";

/** Zmienne środowiskowe Workera (lokalnie: .dev.vars, produkcyjnie: secret). */
interface Env {
  ANTHROPIC_API_KEY?: string;
}

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

// CORS: wpuszczamy wyłącznie okno aplikacji Koala — dev (vite) i wersję
// spakowaną (origin webview Tauri na Windows to http(s)://tauri.localhost).
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:1420",
      "http://tauri.localhost",
      "https://tauri.localhost",
    ],
  }),
);

// Prosty health-check — pozwala sprawdzić, w którym trybie działa serwer.
app.get("/", (c) =>
  c.json({ ok: true, mode: c.env.ANTHROPIC_API_KEY ? "live" : "mock" }),
);

app.post("/verify", async (c) => {
  let body: VerifyRequest;
  try {
    body = await c.req.json<VerifyRequest>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }
  if (typeof body.text !== "string" || !Array.isArray(body.notes)) {
    return c.json({ error: "Expected { text: string, notes: [] }." }, 400);
  }
  if (body.chapters !== undefined && !Array.isArray(body.chapters)) {
    return c.json({ error: "Expected chapters to be an array." }, 400);
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
      const usage = await verifyWithClaude(c.env.ANTHROPIC_API_KEY!, body, (issue) =>
        send({ type: "issue", issue }),
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
- "consistency" — contradictions within the verified text itself OR with the
  other chapters (names, facts, timeline, character traits)
- "logic" — contradictions with facts or rules established in the author's notes

Rules:
- Report only problems in the verified text — never in the notes or other chapters.
- Report only genuine, specific problems. No stylistic preferences, no praise.
- "fragment" must be an exact quote from the verified text (max ~15 words).
- Write "description" and "suggestion" in the same language as the analyzed text.
- If there are no problems, return an empty issues list.`;

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
  onIssue: (issue: Issue) => Promise<void>,
): Promise<VerifyUsage> {
  const client = new Anthropic({ apiKey });

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
            type: "text",
            text: `## Text to verify\n\n${text}`,
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
  console.log(
    `usage: input=${usage.input} cache_write=${usage.cacheWrite}` +
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
