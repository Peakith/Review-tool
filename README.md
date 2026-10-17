# Studio Review — videoreviewplatform

Eigen reviewplatform voor de filmagency: video's delen met klanten, feedback op tijdstip verzamelen, nieuwe versies uploaden en goedkeuring per versie vastleggen.

## Bouwplan en technische keuzes

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Server | Node.js 22 + Express | Weinig afhankelijkheden (alleen `express`), goed met streaming en grote bestanden. |
| Database | SQLite via het ingebouwde `node:sqlite` | Echte, transactionele opslag zonder aparte databaseserver of native build. Eén bestand, makkelijk te back-uppen. Overstap naar PostgreSQL kan later. |
| Bestanden | Lokale schijf (`data/media`) | Werkt direct. Bestanden krijgen een willekeurige, permanente naam; die staat los van de titel. |
| Uploads | Eigen hervatbare upload in blokken van 8 MB | Grote bestanden hoeven niet in één keer te slagen. Bij een fout volgen automatische herhaalpogingen, en de voortgang is zichtbaar. |
| Video-controle | `ffprobe`/`ffmpeg` | Controleert of een upload echt een video is en leest duur en resolutie uit. Maakt een voorvertoning. |
| Frontend | Vanilla JS-modules, geen build-stap | Licht en snel op mobiel. Alle tekst gaat via `textContent`, dus geen XSS via titels of reacties. |
| Beveiliging | Accounts (scrypt-wachtwoorden, httpOnly-sessiecookie), CSRF-header, strikte CSP, `Referrer-Policy: no-referrer` | Elke klant-aanvraag (ook voor videobestanden) controleert op de server of de link geldig en niet ingetrokken is. |

### Datamodel (kort)
- **project** → meerdere **video's**
- **video**: *zichtbare titel*, akkoordgever (naam + e-mail), deel-links
- **versie**: technische bestandsnaam, opgeslagen bestand, status, gedeeld-op
- **status_events**: elke statuswijziging met oud → nieuw, gebeurtenis, wie (team, klant met opgegeven naam of geverifieerde akkoordgever) en tijdstip
- **reacties** (met tijdstip en antwoorden), **feedbackrondes** en **goedkeuringen**: altijd gekoppeld aan één specifieke versie

## Snel starten op een Mac

Eenmalig: installeer [Homebrew](https://brew.sh) en daarna Node.js en ffmpeg:
```bash
brew install node ffmpeg
```

Starten (en na elke update opnieuw starten):
```bash
cd ~/pad/naar/Review-tool        # de map van deze repository
git pull                         # alleen bij een update
npm install                      # alleen bij een update
npm run check                    # controleert Node, ffprobe, ffmpeg en je gegevens
npm start                        # open daarna http://localhost:3000
```
Stoppen doe je met **Ctrl + C** in hetzelfde terminalvenster.

**ffprobe wordt niet gevonden?** De server zoekt ffprobe en ffmpeg nu zelf, ook als `/opt/homebrew/bin` (Apple silicon) of `/usr/local/bin` (Intel) niet in je PATH staat. Het lange startcommando met `PATH=… FFPROBE_PATH=…` is daarom niet meer nodig. Staan ze ergens anders, kopieer dan `.env.example` naar `.env` en vul `FFPROBE_PATH` en `FFMPEG_PATH` in; `npm start` leest `.env` automatisch. Bij het starten toont de terminal welke paden gebruikt worden, en in de app zie je dat onder **Team › Systeem**.

**"Poort 3000 is al in gebruik"?** Er draait nog een oude server. Sluit dat terminalvenster, of zoek het proces met `lsof -i :3000` en stop het met `kill <PID>`. Je kunt ook een andere poort kiezen met `PORT=3001` in `.env`.

**Je gegevens** (accounts, projecten, video's, reacties en links) staan in de map `data/`. Updates veranderen daar niets aan; maak voor de zekerheid wel een kopie van `data/` voordat je een update installeert.

## Functionaliteit

**Teamomgeving (inloggen verplicht)**
- **Vaste zijbalk** met Projecten, Team, recente projecten (met een stip als er feedback ligt) en de systeemstatus.
- **Projectoverzicht:**
  - zoeken op project of klant, filters (*Actie nodig*, *Wacht op klant*, *Goedgekeurd*) en sorteren;
  - per project: thumbnails, het aantal video's, de laatste activiteit, statuslabels en één zin met de volgende actie (bijv. "Feedback binnen · 1 video aanpassen");
  - een leeg account krijgt een korte uitleg met één knop.
- **Projectpagina:**
  - uploaden door te slepen of met de bestandskiezer, meerdere bestanden tegelijk;
  - een uploadpaneel met per bestand voortgang, verwerking, succes of een concrete fout, en opnieuw proberen (gaat verder waar de upload was);
  - per video: thumbnail, duur, een inline bewerkbare titel, en "Intern vN" naast "Klant ziet vM", met open reacties.
- **"Nieuwe video" en "Nieuwe versie" zijn gescheiden.** Een nieuwe video maak je op de projectpagina. Een nieuwe versie upload je vanaf de video, via een venster dat uitlegt dat de versie intern blijft tot je publiceert.
- **Reviewwerkplek:**
  - de speler krijgt de meeste ruimte, met daarnaast een paneel met de tabs *Reacties*, *Versies* en *Geschiedenis*;
  - een vaste statusbalk zegt waar de versie staat en wat de volgende stap is (*Klaar voor review* → *Publiceren naar klant*);
  - een versiekeuze, *Nieuwe versie* en *Delen* staan altijd op dezelfde plek.
- **Reacties** filter je op open, afgehandeld of alles. Je kunt ze beantwoorden en afhandelen. Het invoerveld toont live op welk moment de reactie komt, en een klik maakt er een algemene reactie van.
- **Deelvenster** met een duidelijk verschil tussen de **reviewlink** (bekijken, reageren, feedback; kan niet goedkeuren) en de **akkoordlink** (persoonlijk; alleen hiermee kan worden goedgekeurd). Links kopieer je en trek je in vanuit dit venster.
- **Status corrigeren** kan alleen met een verplichte reden, die in de geschiedenis wordt bewaard.
- **Downloaden** geeft `Titel - vN.<echte extensie>`, bijvoorbeeld `Campagnefilm — Hoofdvideo - v2.mp4`.
- **Team & systeem:** teamleden toevoegen, en zien of ffprobe en ffmpeg gevonden zijn (met paden).

**Klantpagina (via link, zonder account)**
- Bovenaan staat welke video en versie het is ("Versie 2 · nieuwste") en de status in gewone taal ("Klaar voor jouw review", "Feedback verstuurd", "Goedgekeurd").
- Een inklapbare "Zo werkt het"-uitleg: reageren, versturen en goedkeuren.
- Elke reactie toont "Nog niet verstuurd" of "Verstuurd als feedback". Een vaste actiebalk telt de nog niet verstuurde reacties.
- **Reactie plaatsen**, **Feedback versturen** en **Deze versie goedkeuren** (alleen akkoordgever) zijn aparte stappen, elk met een bevestiging.
- Er wordt niets dubbel verstuurd: knoppen zijn geblokkeerd tijdens het versturen, en er is een request-id per actie. Ingevulde tekst blijft bewaard bij fouten en na een herlaadbeurt.
- Op mobiel staat de speler boven en de reacties eronder, met grote knoppen in een vaste onderbalk.

**Toegankelijkheid en robuustheid**
- Bediening met het toetsenbord en een zichtbare focusrand.
- Sneltoetsen in de speler: spatie/K afspelen, J/L of ←/→ 5 seconden terug of vooruit, `,` en `.` één beeld, F volledig scherm, M geluid aan/uit.
- Statuslabels altijd met icoon én tekst. Tekstcontrast minimaal 4,5:1.
- Lange titels worden netjes afgekapt (de volledige titel staat in de tooltip). Ontbreekt een thumbnail, dan verschijnt een vervangend vlak; ontbrekende thumbnails worden bij het starten alsnog gemaakt.
- Laadindicatoren, en na 30 seconden zonder antwoord een duidelijke melding met "Opnieuw proberen".

### Statusregels
| Gebeurtenis | Nieuwe status |
|---|---|
| Upload (nieuwe video of versie) | Concept |
| Team: "Klaar voor review" | Klaar voor review |
| Team: "Publiceren naar klant" | In review (klanten zien vanaf nu deze versie) |
| Klant: "Feedback versturen" | Aanpassingen nodig |
| Akkoordgever: "Deze versie goedkeuren" | Goedgekeurd |
| Team: "Status corrigeren" (reden verplicht) | Elke status (gelogd met naam en reden) |

Feedback en goedkeuring zijn alleen mogelijk op de nieuwste gedeelde versie met status *In review* of *Aanpassingen nodig*.

### Ondersteunde videoformaten (eerste versie)
`.mp4`, `.m4v`, `.mov` en `.webm`, standaard tot 20 GB (instelbaar). Er wordt **niet getranscodeerd**: wat de browser van de klant niet kan afspelen (bijv. ProRes in `.mov`), krijgt een duidelijke melding. **Aanbevolen: H.264/AAC in MP4.** Die speelt in alle gangbare browsers, ook op iPhone en Android.

## Installatie (lokaal)

Vereist: **Node.js ≥ 22.13** en **ffmpeg** (met ffprobe). Zonder ffprobe weigert de server uploads, omdat de inhoud dan niet gecontroleerd kan worden.

```bash
npm install
npm start                # http://localhost:3000
```

### Eerste account (beveiligd)
Een nieuwe installatie zonder accounts vraagt om een **installatiecode**. Zo kan een willekeurige bezoeker het eerste account niet claimen.
- Stel zelf `SETUP_TOKEN` in, of laat de server bij het starten een willekeurige code genereren. Die code verschijnt alleen in het serverlog, samen met een directe link (`/?setup=…`).
- Of maak het account via de commandoregel: `npm run create-user -- sanne@agency.nl "Sanne de Vries" "een-lang-wachtwoord"`.
- Zodra er één account bestaat, is de installatiepagina definitief dicht (409). Collega's voeg je toe via **Team**.

### Tests
```bash
npm test                                         # 30 server-tests (vereist ffmpeg)
CHROME_PATH=/pad/naar/chrome npm run test:browser  # volledige klantflow in een echte browser
```
De browsertest maakt zelf 1080p H.264/AAC-MP4's en doorloopt in een tijdelijke, lege omgeving de hele flow met 51 controles: leeg account, project maken, uploaden, titel aanpassen, publiceren, reageren, feedback versturen, nieuwe versie, goedkeuren op mobiel, handmatig corrigeren, intrekken, veel reacties, ontbrekende thumbnails en een trage of wegvallende verbinding. Hij heeft een Chrome **met H.264** nodig, zoals Google Chrome of [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/). De Chromium die Playwright standaard meelevert speelt geen H.264 af.

### Omgevingsvariabelen
| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | `3000` | Poort van de server |
| `DATA_DIR` | `./data` | Map voor database, video's en tijdelijke uploads |
| `PUBLIC_URL` | (host van de aanvraag) | Publiek adres voor deel-links, bijv. `https://review.jouwagency.nl` |
| `SECURE_COOKIES` | `false` | Op `true` achter HTTPS |
| `TRUST_PROXY` | `false` | Op `true` achter een reverse proxy (nginx, Caddy) |
| `SETUP_TOKEN` | (willekeurig, in log) | Installatiecode voor het eerste account |
| `MAX_UPLOAD_GB` | `20` | Maximale bestandsgrootte |
| `FFPROBE_PATH` / `FFMPEG_PATH` | automatisch gezocht | Alleen nodig als ffprobe/ffmpeg niet in PATH, `/opt/homebrew/bin`, `/usr/local/bin` of `/usr/bin` staan |
| `ALLOW_UNVERIFIED_UPLOADS` | `false` | Alleen voor ontwikkeling: uploads accepteren zonder ffprobe. **Nooit in productie.** |
| `UPLOAD_EXPIRY_HOURS` | `24` | Afgebroken uploads zonder activiteit worden na deze tijd verwijderd |
| `UPLOAD_CLEANUP_INTERVAL_MINUTES` | `60` | Hoe vaak de opruiming draait (ook direct bij het starten) |

### Afhankelijkheden zichtbaar
- `GET /api/health` geeft `database`, `ffprobe`, `ffmpeg` en `uploads` (`ok`, `uitgeschakeld` of `zonder controle`).
- Ontbreekt ffprobe of ffmpeg, dan toont de teamomgeving een balk bovenaan en meldt het serverlog dit bij het starten.

### Betrouwbaarheid van klantacties
"Feedback versturen", "Deze versie goedkeuren" en reacties sturen een unieke request-id mee. Valt de verbinding weg, dan probeert de browser het opnieuw met dezelfde id. De server herkent een herhaald verzoek en wijzigt dan niets. Een oud feedbackverzoek kan dus nooit een latere goedkeuring of een handmatige correctie overschrijven. Een nieuwe klantactie (met een nieuwe id) volgt gewoon de statusregels.

## Testomgeving en livegang
Zie **[DEPLOY.md](DEPLOY.md)** voor een afgeschermde testomgeving met Docker en Caddy (HTTPS en een wachtwoord). Zie **[ACCEPTATIETEST.md](ACCEPTATIETEST.md)** om de klantflow zelf te doorlopen en voor de handmatige browsertestlijst.

### Nog nodig voor livegebruik
1. **Hosting**: een server of VPS met Docker, een domein (DNS A-record) en een persistente schijf (zie DEPLOY.md).
2. **Back-ups** van `review.db` en `media/`. Voor objectopslag (S3, R2) is nog een opslagadapter nodig.
3. **E-mail (niet gebouwd)**: links worden nu gekopieerd en zelf verstuurd. Voor uitnodigingen en meldingen is een SMTP-dienst nodig.
4. **Verificatie van de akkoordgever**: nu via het bezit van een persoonlijke, intrekbare link. Een sterkere controle (eenmalige code per e-mail) vraagt om punt 3.
5. **Handmatige browsertest** in Safari (macOS en iOS) en op echte Android-toestellen: die zijn niet automatisch getest.

Bewust buiten deze versie gelaten: facturatie, videobewerking/transcoding, integraties en annotaties op het beeld.
