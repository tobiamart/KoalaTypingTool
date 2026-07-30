// Warstwa weryfikacji AI — woła serwer proxy (Cloudflare Worker w server/).
//
// Klucz Anthropic API NIGDY nie jest w aplikacji desktopowej — zna go tylko
// serwer. Lokalnie serwer działa na http://localhost:8787 (uruchamiany przez
// server-dev.bat albo `npm run dev` w server/). Bez klucza po stronie serwera
// odpowiedzi są przykładowe (pole `mock: true`).
//
// Do serwera wysyłamy token dostępu (`Authorization: Bearer`), jeśli jest —
// patrz getAuthToken(). To szew pod przyszłe konta użytkowników; token
// deweloperski nie jest sekretem chroniącym cokolwiek poza kosztem API.

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

/**
 * Adres serwera proxy. W trybie deweloperskim celujemy w lokalnego wranglera,
 * w zbudowanej aplikacji w produkcyjnego Workera — inaczej każdy test podczas
 * pisania kodu paliłby prawdziwy limit API. `VITE_NARWHAL_PROXY_URL` pozwala
 * nadpisać jedno i drugie (np. testowanie produkcyjnego Workera z trybu dev).
 */
const PROXY_URL =
  import.meta.env.VITE_NARWHAL_PROXY_URL ??
  (import.meta.env.DEV ? "http://localhost:8787" : "https://api.narwhal.ink");

/**
 * Szew tożsamości. Dziś zwraca token deweloperski z `VITE_NARWHAL_TOKEN`
 * (plik `app/.env.local`, wzór w `app/.env.example`); docelowo zwróci token
 * zalogowanego użytkownika z keychaina — patrz Blok 3 w TODO.md.
 *
 * Brak tokenu nie jest błędem: serwer bez ustawionego NARWHAL_AUTH_TOKEN ma
 * bramkę wyłączoną, więc praca lokalna nie wymaga żadnej konfiguracji.
 */
function getAuthToken(): string | undefined {
  const token = import.meta.env.VITE_NARWHAL_TOKEN;
  return token ? token : undefined;
}

// Długi rozdział + myślenie modelu potrafią trwać dziesiątki sekund.
const TIMEOUT_MS = 180_000;

/** Linia strumienia NDJSON z serwera (patrz server/src/index.ts). */
type StreamMsg =
  | { type: "start"; mock: boolean }
  | { type: "issue"; issue: Issue }
  | { type: "done"; usage?: VerifyUsage }
  | { type: "error"; message: string };

/**
 * Weryfikuje tekst pod kątem gramatyki, spójności i logiki (przez serwer proxy).
 * Serwer streamuje wyniki (NDJSON) — `onIssue` jest wołane dla każdego błędu
 * od razu, gdy model go dokończy; zwracany Promise domyka się z kompletem.
 */
export async function verifyText(
  params: VerifyParams,
  onIssue?: (issue: Issue) => void,
): Promise<VerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const token = getAuthToken();
    const res = await fetch(`${PROXY_URL}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    // 401 to inna sytuacja niż padnięty serwer — komunikat musi kierować
    // użytkownika do tokenu, a nie do restartu serwera.
    if (res.status === 401) {
      throw new Error(
        "Not authorized to use AI verification. Check your access token and try again.",
      );
    }
    if (res.status === 429) {
      throw new Error("Too many checks in a short time. Wait a minute and try again.");
    }
    if (res.status === 413) {
      throw new Error(
        "This text is too long to verify in one request. Split it into shorter chapters.",
      );
    }
    if (!res.ok) {
      throw new Error(`Verification server error (HTTP ${res.status}).`);
    }
    if (!res.body) {
      throw new Error("Empty response from the verification server.");
    }

    const issues: Issue[] = [];
    let mock = false;
    let usage: VerifyUsage | undefined;

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line) as StreamMsg;
      if (msg.type === "start") mock = msg.mock;
      else if (msg.type === "issue") {
        issues.push(msg.issue);
        onIssue?.(msg.issue);
      } else if (msg.type === "done") usage = msg.usage;
      else if (msg.type === "error") throw new Error(msg.message);
    };

    // Czytaj strumień linia po linii (NDJSON).
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    handleLine(buf);

    return { issues, mock, usage };
  } catch (e) {
    // Rozróżnij przekroczenie czasu, padnięty serwer i błąd merytoryczny.
    if (controller.signal.aborted) {
      throw new Error("Verification timed out. Try a shorter text.");
    }
    if (e instanceof TypeError) {
      throw new Error(
        "Cannot reach the verification server. Start it (server-dev.bat on Windows," +
          " or `npm run dev` in server/) and try again.",
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
