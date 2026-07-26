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
}

interface VerifyResponse {
  issues: Issue[];
  /** true = serwer działa bez klucza i zwrócił dane przykładowe. */
  mock: boolean;
}

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

  const hasKey = Boolean(c.env.ANTHROPIC_API_KEY);

  if (!body.text.trim()) {
    return c.json({ issues: [], mock: !hasKey } satisfies VerifyResponse);
  }

  if (!hasKey) {
    return c.json(mockVerify() satisfies VerifyResponse);
  }

  try {
    const issues = await verifyWithClaude(c.env.ANTHROPIC_API_KEY!, body);
    return c.json({ issues, mock: false } satisfies VerifyResponse);
  } catch (e) {
    console.error("verify failed:", e);
    return c.json({ error: "Verification failed on the AI server." }, 502);
  }
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
(worldbuilding, characters, bibliography) that define the rules of the work.

Find concrete problems in the text and classify each as exactly one of:
- "grammar" — grammar, spelling or punctuation errors
- "consistency" — internal contradictions within the text itself
- "logic" — contradictions with facts or rules established in the author's notes

Rules:
- Report only genuine, specific problems. No stylistic preferences, no praise.
- "fragment" must be an exact quote from the text (max ~15 words).
- Write "description" and "suggestion" in the same language as the analyzed text.
- If there are no problems, return an empty issues list.`;

async function verifyWithClaude(
  apiKey: string,
  { text, notes }: VerifyRequest,
): Promise<Issue[]> {
  const client = new Anthropic({ apiKey });

  const notesBlock =
    notes.length > 0
      ? notes.map((n) => `### ${n.title}\n\n${n.content}`).join("\n\n")
      : "(no author notes provided)";

  // Streaming: długi rozdział + myślenie modelu potrafią trwać dziesiątki
  // sekund — stream zapobiega timeoutom HTTP, a finalMessage() składa całość.
  const stream = client.beta.messages.stream({
    model: "claude-opus-5",
    max_tokens: 16000,
    // Awaryjne przełączenie na inny model, gdyby klasyfikatory bezpieczeństwa
    // odrzuciły żądanie (zalecana domyślna konfiguracja dla claude-opus-5).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `## Author's notes\n\n${notesBlock}\n\n## Text to verify\n\n${text}`,
      },
    ],
  });

  const message = await stream.finalMessage();

  // Klasyfikatory mogły odrzucić żądanie mimo fallbacków — nie czytaj wtedy content.
  if (message.stop_reason === "refusal") {
    throw new Error("Request declined by safety filters.");
  }

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Empty model response.");
  }

  const parsed = JSON.parse(textBlock.text) as { issues: Issue[] };
  return parsed.issues;
}

/* ------------------------------------------------------------------ */
/* Tryb MOCK — dane przykładowe (serwer bez klucza)                    */
/* ------------------------------------------------------------------ */

function mockVerify(): VerifyResponse {
  return {
    mock: true,
    issues: [
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
    ],
  };
}
