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

## Functionaliteit

**Intern (inloggen verplicht)**
- Projecten aanmaken. Het overzicht toont per project hoeveel video's in voorbereiding zijn, wachten op feedback, aanpassingen nodig hebben of goedgekeurd zijn. Binnen een project kun je filteren op status.
- Video uploaden met een vrij te kiezen titel. Het voorstel is de bestandsnaam zonder extensie en kan meteen worden aangepast.
- De titel kun je altijd wijzigen. Bestand, links, reacties en versiegeschiedenis blijven daarbij hetzelfde.
- Nieuwe versie uploaden onder dezelfde video. Die neemt de titel, de links en de akkoordgever over en begint als Concept.
- Status: *Klaar voor review* → *Delen met klant* (wordt *In review*). Je kunt de status ook handmatig corrigeren, met een reden.
- Statusgeschiedenis per versie: wie of wat de wijziging veroorzaakte, met datum en tijd.
- Reacties beantwoorden en als afgehandeld markeren. Afvinken verandert de status niet.
- Reviewlinks aanmaken (met optionele downloadtoestemming), kopiëren en intrekken.
- Eén akkoordgever per video, met een eigen persoonlijke akkoordlink. Wijzig je de akkoordgever, dan wordt de oude akkoordlink automatisch ingetrokken.
- Downloaden geeft `Titel - vN.<echte extensie>`, bijvoorbeeld `Campagnefilm — Hoofdvideo - v2.mp4`.
- Teamleden toevoegen.

**Klant (via link, zonder account)**
- Ziet standaard de nieuwste gedeelde versie, met duidelijk "Versie N (nieuwste)". Oudere gedeelde versies zijn alleen te bekijken.
- Eigen speler met afspeelknoppen, tijdlijn met reactiemarkeringen en volledig scherm (ook op iOS).
- Reacties worden automatisch aan het tijdstip gekoppeld. Een klik op een reactie springt naar dat moment. Antwoorden is mogelijk.
- De reviewer vult een naam in, getoond als *opgegeven naam*. De akkoordgever wordt getoond als *✓ Akkoordgever* (geverifieerd via de persoonlijke link).
- **Feedback versturen** bundelt de eigen reacties tot een feedbackronde en zet de status op *Aanpassingen nodig*.
- **Deze versie goedkeuren** (alleen via de akkoordlink, met expliciete bevestiging en het versienummer). Zet de status op *Goedgekeurd* voor precies die versie.
- De pagina openen, een losse reactie opslaan of reacties afvinken verandert de status niet.

### Statusregels
| Gebeurtenis | Nieuwe status |
|---|---|
| Upload (nieuwe video of versie) | Concept |
| Team: "Zet op Klaar voor review" | Klaar voor review |
| Team: "Delen met klant" | In review |
| Klant: "Feedback versturen" | Aanpassingen nodig |
| Akkoordgever: "Deze versie goedkeuren" | Goedgekeurd |
| Team: handmatige correctie | Elke status (gelogd met naam en reden) |

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
npm test                                         # 24 server-tests (vereist ffmpeg)
CHROME_PATH=/pad/naar/chrome npm run test:browser  # volledige klantflow in een echte browser
```
De browsertest maakt zelf een 1080p H.264/AAC-MP4 en draait 25 controles: afspelen, geluid, vooruitspoelen, volledig scherm, tijdgebonden reacties, downloadnaam, versieflow en goedkeuring op mobiel. Hij heeft een Chrome **met H.264** nodig, zoals Google Chrome of [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/). De Chromium die Playwright standaard meelevert speelt geen H.264 af.

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
| `FFPROBE_PATH` / `FFMPEG_PATH` | `ffprobe` / `ffmpeg` | Paden naar de hulpprogramma's |
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
