# Koala — do zrobienia

## Funkcje

- [ ] Foldery notatek (grupowanie notatek autora w podfoldery)
- [ ] Wyszukiwanie rozdziałów i notatek
- [ ] Serwer proxy AI (Cloudflare Worker + klucz Anthropic po stronie serwera)
- [ ] Podłączyć prawdziwą weryfikację (podmienić atrapę w `app/src/lib/ai.ts`)

## Dystrybucja

- [ ] GitHub Actions — automatyczne budowanie (Windows / macOS / Linux)
- [ ] Wersja macOS (`.dmg`)
- [ ] Podpis aplikacji (Azure Trusted Signing lub certyfikat OV/EV) — potrzebny
      do dystrybucji: u użytkowników z włączonym Smart App Control / SmartScreen
      niepodpisana aplikacja nie uruchomi się lub wywoła ostrzeżenia
