/// <reference types="vite/client" />

// Zmienne środowiskowe aplikacji. Vite wstawia do bundla tylko te z prefiksem
// VITE_, więc wszystko tutaj jest jawnie publiczne — NIGDY nie wolno tu wpisać
// klucza API Anthropic (patrz „Bezpieczeństwo" w CLAUDE.md).
interface ImportMetaEnv {
  /** Token deweloperski serwera weryfikacji — patrz getAuthToken() w lib/ai.ts. */
  readonly VITE_NARWHAL_TOKEN?: string;
  /** Nadpisanie adresu serwera proxy (domyślnie: localhost w dev, produkcja w buildzie). */
  readonly VITE_NARWHAL_PROXY_URL?: string;
}
