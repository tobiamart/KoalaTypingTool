// Drobiazgi zależne od systemu. Aplikacja chodzi na Windows i macOS, więc
// etykieta skrótu musi się zgadzać z klawiaturą, na którą patrzy użytkownik.

/** Czy webview działa na macOS (tam modyfikatorem jest ⌘, gdzie indziej Ctrl). */
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Etykieta skrótu wyszukiwarki pokazywana w interfejsie. */
export const SEARCH_SHORTCUT = isMac ? "⌘K" : "Ctrl+K";
