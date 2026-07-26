# Koala — do zrobienia

## Funkcje

- [ ] Foldery notatek (grupowanie notatek autora w podfoldery)
- [ ] Wyszukiwanie rozdziałów i notatek
- [x] Serwer proxy AI (Cloudflare Worker + Hono w `server/`, lokalnie przez
      `wrangler dev`; klucz w `.dev.vars` → tryb live, bez klucza → atrapa)
- [x] Podłączyć weryfikację w aplikacji (`app/src/lib/ai.ts` woła serwer)
- [ ] Przetestować tryb live (wpisać klucz Anthropic do `server/.dev.vars`)
- [ ] Wdrożyć Workera do Cloudflare (`npm run deploy` + `wrangler secret put
      ANTHROPIC_API_KEY`) i podmienić `PROXY_URL` w `app/src/lib/ai.ts`
- [ ] Ustawić CSP w `tauri.conf.json` (connect-src tylko do adresu proxy)

## Dystrybucja

- [ ] GitHub Actions — automatyczne budowanie (Windows / macOS / Linux)
- [ ] Wersja macOS (`.dmg`)
- [ ] Podpis aplikacji (Azure Trusted Signing lub certyfikat OV/EV) — potrzebny
      do dystrybucji: u użytkowników z włączonym Smart App Control / SmartScreen
      niepodpisana aplikacja nie uruchomi się lub wywoła ostrzeżenia
