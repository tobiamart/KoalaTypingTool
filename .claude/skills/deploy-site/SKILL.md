---
name: deploy-site
description: Deploy the narwhal.ink landing page to Cloudflare Workers. Use when asked to publish the website, put a new version of the site live, or update narwhal.ink. Covers pre-flight checks, the first-deploy DNS conflict, post-deploy verification, and rollback.
---

# Wdrożenie strony narwhal.ink

Strona to **osobny Worker** od proxy AI. Dwie usługi na jednej domenie, celowo
rozdzielone: landing nie ma powodu dzielić limitów tempa ani sekretów
z endpointem `/verify`.

| Worker | Katalog | Adres | Co robi |
|---|---|---|---|
| `narwhal-site` | `web/` | `narwhal.ink`, `www.narwhal.ink` | statyczna strona |
| `narwhal-proxy` | `server/` | `api.narwhal.ink` | endpoint `/verify` |

**Nie ma builda.** Nowa wersja strony to po prostu zmieniony
`web/public/index.html`. Katalog `public/` idzie na krawędź tak, jak leży.

⚠️ **Nie ma też adresu podglądowego.** `workers_dev = false` znaczy, że nie
istnieje `*.workers.dev`, na którym dałoby się obejrzeć zmianę przed
wypuszczeniem. Jedyna próba generalna to podgląd lokalny, a jedyne miejsce,
gdzie strona jest widoczna publicznie, to prawdziwa domena. Wdrażaj świadomie.

## Zanim wdrożysz

### 1. Podgląd lokalny

```bash
cd web && npm install && npm run dev     # http://localhost:8788
```

Port 8788 jest wpisany w `[dev]` w `wrangler.toml`, bo domyślny port wranglera
to 8787, a na nim siedzi serwer proxy. Bez tego oba `npm run dev` naraz kolidują.

### 2. Dokument się waliduje

Strona to jeden plik pisany ręcznie, więc nie ma builda, który złapałby
niedomknięty znacznik.

```bash
python3 - <<'PY'
from html.parser import HTMLParser
VOID={'area','base','br','col','embed','hr','img','input','link','meta','source','wbr'}
class P(HTMLParser):
    def __init__(s): super().__init__(convert_charrefs=True); s.st=[]; s.e=[]
    def handle_starttag(s,t,a):
        if t not in VOID: s.st.append((t,s.getpos()))
    def handle_endtag(s,t):
        if t in VOID: return
        if not s.st or s.st[-1][0]!=t: s.e.append(f"{t} @ {s.getpos()}")
        else: s.st.pop()
p=P(); p.feed(open('web/public/index.html',encoding='utf-8').read())
print("BLEDY:", p.e or "brak", "| NIEZAMKNIETE:", [t for t,_ in p.st] or "brak")
PY
```

### 3. Paleta nie rozjechała się z aplikacją

Kolory są **skopiowane** z `app/src/styles.css` do bloku `:root` w HTML-u. To
świadomy koszt zamiast współdzielonego pakietu tokenów, ale znaczy, że zmiana
motywu w aplikacji cicho rozjeżdża stronę.

```bash
for t in bg surface elevated accent accent-hover on-accent \
         grammar consistency logic text muted faint text-read; do
  a=$(grep -m1 -E "^\s+--$t: " app/src/styles.css     | sed 's/.*: *//;s/;.*//')
  w=$(grep -m1 -E "^\s+--$t: " web/public/index.html  | sed 's/.*: *//;s/;.*//')
  [ "$a" = "$w" ] || echo "ROZJAZD --$t: app=$a web=$w"
done
```

Cisza znaczy, że jest zgodnie.

### 4. Treść trzyma zasady

Widoczny tekst **nie używa długich myślników** (komentarze w kodzie mogą).
Poniższe ma wypisać tylko linie komentarzy albo nic:

```bash
python3 - <<'PY'
import re
s=open('web/public/index.html',encoding='utf-8').read()
s=re.sub(r'/\*.*?\*/','',s,flags=re.S); s=re.sub(r'<!--.*?-->','',s,flags=re.S)
print('\n'.join(l.strip() for l in s.split('\n')
      if '—' in l and not l.strip().startswith('//')) or 'brak')
PY
```

Sprawdź też, czy linki prowadzą tam, gdzie mają:

```bash
grep -o 'https://github.com/[a-zA-Z0-9/_-]*' web/public/index.html | sort -u
```

## Pierwsze wdrożenie: najpierw DNS

`custom_domain = true` sprawia, że wrangler sam zakłada rekord DNS i zamawia
certyfikat. **Nie uda mu się, dopóki w strefie wiszą stare rekordy A** dla
`narwhal.ink` i `www` (wskazują na Cloudflare, nie mają origin, więc żądanie
timeoutuje). Usuń je w panelu Cloudflare → DNS przed pierwszym `npm run deploy`,
inaczej dostaniesz konflikt przy zakładaniu rekordu.

Sprawdzenie stanu przed wdrożeniem:

```bash
dig +short narwhal.ink A
curl -s -o /dev/null -w '%{http_code}\n' -m 10 https://narwhal.ink
```

`000` albo timeout znaczy, że rekordy wiszą i nic ich nie obsługuje.

## Wdrożenie

```bash
cd web
npx wrangler whoami      # potwierdź, że to właściwe konto Cloudflare
npm run deploy
```

## Weryfikacja po wdrożeniu

Zawsze wszystkie cztery. Trzecia pilnuje, żeby wdrożenie strony nie ruszyło
proxy, bo obie usługi siedzą na tej samej domenie.

```bash
curl -sI https://narwhal.ink     | head -1     # HTTP/2 200
curl -sI https://www.narwhal.ink | head -1     # HTTP/2 200
curl -s  https://api.narwhal.ink               # {"ok":true,"mode":"live","auth":"on"}
curl -s  https://narwhal.ink | grep -c "It won" # >0, treść faktycznie dojechała
```

Certyfikat dla świeżo założonej domeny potrafi wchodzić kilka minut. Błąd TLS
tuż po pierwszym wdrożeniu nie musi znaczyć awarii, powtórz test.

## Wycofanie

Cloudflare trzyma historię wdrożeń, więc powrót nie wymaga gita.

```bash
cd web
npx wrangler deployments list
npx wrangler rollback <version-id>
```

## Pułapki

- **Wdrażasz zawartość dysku, nie commita.** `wrangler deploy` pakuje `public/`
  w takiej postaci, w jakiej leży, bez oglądania się na git. Sprawdź
  `git status` przed wdrożeniem, żeby nie wypuścić przypadkowej wersji roboczej.
- **Przeglądarka trzyma starą wersję.** Po wdrożeniu testuj twardym odświeżeniem
  albo przez `curl`, inaczej zobaczysz kopię z cache i uznasz, że nie zadziałało.
- **Konto Cloudflare musi być zalogowane.** `npm run deploy` bez sesji wranglera
  otworzy przeglądarkę i zawiesi się w tle; w sesji agenta zacznij od
  `npx wrangler whoami`.
- **`web/` ma własne `node_modules`.** Klon nie przynosi zależności, a bez
  `npm install` w tym katalogu ani `dev`, ani `deploy` nie wystartuje.
- **To nie jest publikacja repozytorium.** Skill `publish` wypycha kod do
  publicznego `tobiamart/narwhal`. Te dwie rzeczy nie są ze sobą sprzężone.
