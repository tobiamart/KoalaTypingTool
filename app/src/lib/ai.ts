// Warstwa weryfikacji AI — woła serwer proxy (Cloudflare Worker w server/).
//
// Klucz Anthropic API NIGDY nie jest w aplikacji desktopowej — zna go tylko
// serwer. Lokalnie serwer działa na http://localhost:8787 (uruchamiany przez
// server-dev.bat albo `npm run dev` w server/). Bez klucza po stronie serwera
// odpowiedzi są przykładowe (pole `mock: true`).

/** Kategoria wykrytego problemu. */
export type IssueType = "grammar" | "consistency" | "logic";

/** Pojedynczy problem wykryty w tekście. */
export interface Issue {
  type: IssueType;
  /** Fragment tekstu, którego dotyczy uwaga. */
  fragment: string;
  /** Opis problemu. */
  description: string;
  /** Proponowana poprawka. */
  suggestion: string;
}

/** Zużycie tokenów pojedynczej weryfikacji (zwracane przez serwer w trybie live). */
export interface VerifyUsage {
  /** Tokeny wejścia pełnopłatne (poza cache). */
  input: number;
  /** Tokeny zapisane do cache. */
  cacheWrite: number;
  /** Tokeny odczytane z cache (~10% ceny). */
  cacheRead: number;
  /** Tokeny wyjścia (myślenie + odpowiedź). */
  output: number;
}

export interface VerifyResult {
  issues: Issue[];
  /** true = serwer działa bez klucza API i zwrócił dane przykładowe. */
  mock: boolean;
  /** Zużycie tokenów — brak w trybie atrapy. */
  usage?: VerifyUsage;
}

export interface VerifyParams {
  /** Treść (Markdown) weryfikowanego rozdziału. */
  text: string;
  /** Notatki autora jako kontekst (opis świata, postacie itd.). */
  notes: { title: string; content: string }[];
  /** Pozostałe rozdziały jako kontekst spójności (bez weryfikowanego). */
  chapters: { title: string; content: string }[];
}

// TODO: po wdrożeniu Workera do Cloudflare podmienić na adres produkcyjny.
const PROXY_URL = "http://localhost:8787";

// Długi rozdział + myślenie modelu potrafią trwać dziesiątki sekund.
const TIMEOUT_MS = 180_000;

/** Weryfikuje tekst pod kątem gramatyki, spójności i logiki (przez serwer proxy). */
export async function verifyText(params: VerifyParams): Promise<VerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let res: Response;
    try {
      res = await fetch(`${PROXY_URL}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    } catch {
      // Rozróżnij przekroczenie czasu od niedziałającego serwera.
      if (controller.signal.aborted) {
        throw new Error("Verification timed out. Try a shorter text.");
      }
      throw new Error(
        "Cannot reach the verification server. Start it with server-dev.bat and try again.",
      );
    }

    if (!res.ok) {
      throw new Error(`Verification server error (HTTP ${res.status}).`);
    }
    return (await res.json()) as VerifyResult;
  } finally {
    clearTimeout(timer);
  }
}
