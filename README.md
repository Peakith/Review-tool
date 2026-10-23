# Studio Review — videoreviewplatform

Eigen reviewplatform voor de filmagency: video's delen met klanten, feedback op tijdstip verzamelen, nieuwe versies uploaden en goedkeuring per versie vastleggen.

## Bouwplan en technische keuzes

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Server | Node.js 22 + Express | Weinig afhankelijkheden (alleen `express`), goed met streaming en grote bestanden. |
| Database | SQLite via het ingebouwde `node:sqlite` | Echte, transactionele opslag zonder aparte databaseserver of native build. Eén bestand, makkelijk te back-uppen. Overstap naar PostgreSQL kan later. |
| Bestanden | Lokale schijf (`~/Studio Review/gegevens/media`, of een externe schijf) achter een eigen opslaglaag | Werkt direct; online opslag kan later als tweede laag. Bestanden krijgen een willekeurige, permanente naam; die staat los van de titel. |
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

**Eenmalig:** installeer [Homebrew](https://brew.sh) en daarna Node.js en ffmpeg:
```bash
brew install node ffmpeg
```

**Starten:** dubbelklik **`Start Studio Review.command`** in de programmamap.
- Er opent een Terminal-venster met de controles (Node, ffprobe, ffmpeg) en daarna je browser.
- De eerste keer worden de onderdelen automatisch geïnstalleerd (`npm install`).
- Laat het venster open zolang je werkt.
- Draait de app al, dan opent een tweede dubbelklik gewoon de bestaande sessie.
- Gebruikt een ander programma of een andere Studio Review-installatie de poort, dan krijg je een melding met wat je kunt doen. Er wordt nooit een ander proces gestopt.

**Stoppen:** gebruik een van deze drie manieren. Je gegevens blijven altijd bewaard.
- Dubbelklik **`Stop Studio Review.command`**.
- Of druk op **Ctrl + C** in het startvenster.
- Of sluit dat venster.

**De eerste keer weigert macOS de startknop?** Bestanden uit een gedownloade ZIP worden door Gatekeeper tegengehouden. Kies een van deze oplossingen:
- **macOS 14 en ouder:** klik met de rechtermuisknop op het bestand, kies **Open** en dan nog eens **Open**.
- **macOS 15 en nieuwer:** probeer het één keer te openen. Ga daarna naar **Systeeminstellingen › Privacy en beveiliging** en kies onderaan **Toch openen**.
- **Lukt geen van beide:** open Terminal en typ `bash ` (met spatie). Sleep dan het bestand in het venster en druk op Enter.

**Ontwikkelen werkt zoals altijd.** De startknop gebruikt dezelfde code als `npm start`. `npm run dev` herstart bij elke wijziging. `npm run check` controleert de installatie, en `npm run stop` stopt de app.

**Bijwerken naar een nieuwe versie:** zie **[UPDATEN.md](UPDATEN.md)**.

**ffprobe wordt niet gevonden?** De app zoekt ffprobe en ffmpeg zelf, ook in `/opt/homebrew/bin` (Apple silicon) en `/usr/local/bin` (Intel). Staan ze ergens anders, zet dan `FFPROBE_PATH` en `FFMPEG_PATH` in het instellingenbestand (zie hieronder). Onder **Team & rechten › Systeem** zie je welke paden gebruikt worden.

## Gegevens, back-ups en opslag

**Waar staat wat** (ook te zien onder **Opslag & back-ups**):

| Wat | Standaardlocatie | Bij een update |
|---|---|---|
| Programma (code) | de uitgepakte map, bijv. `~/Downloads/Review-tool-0.2.0` | vervangen |
| Gegevens (database met accounts, projecten, reacties, links en rechten; video's in `media/`) | `~/Studio Review/gegevens` | blijft staan |
| Back-ups | `~/Studio Review/backups` | blijft staan |
| Instellingen | `~/Studio Review/instellingen.env` | blijft staan |

- **Oudere installaties** bewaarden de gegevens in de programmamap (`<programmamap>/data`). De startknop meldt dat en biedt aan ze te verhuizen. Het verhuizen werkt zo:
  - eerst wordt een back-up gemaakt;
  - de database wordt veilig gekopieerd, met de back-upfunctie van SQLite (geen ruwe bestandskopie);
  - elk videobestand wordt gecontroleerd met een controlesom;
  - de oude map blijft onaangeroerd.

  Verhuizen kan ook met de hand: `npm run verhuis`.
- Start je een **nieuwe, lege programmamap**, dan zoekt de startknop naast die map en in Downloads naar een eerdere versie met gegevens, en biedt aan die over te nemen.
- `DATA_DIR` (in `.env` of het instellingenbestand) wint altijd. Dat is handig voor testgegevens: `DATA_DIR=./data-test npm start`.

**Back-ups**

| Commando | Wat het doet |
|---|---|
| **Opslag & back-ups › Nu back-up maken**, of `npm run backup` | Maakt een back-up terwijl de app draait. Die bevat de database (een consistente momentopname), alle video's en thumbnails, en `manifest.json` met aantallen, controlesommen en of hij compleet is. De back-up komt in een eigen map buiten de gegevensmap; video's worden in stromen gekopieerd, dus ook grote bestanden kosten weinig geheugen. |
| `npm run herstel` | Zet een back-up terug; je kiest hem uit een lijst. De app moet gestopt zijn. De back-up wordt eerst volledig gecontroleerd en in een tijdelijke map klaargezet. Je huidige gegevens worden niet verwijderd, maar bewaard als `gegevens.voor-herstel-<datum>`. |

**Opslag**
- **Opslag & back-ups** toont het gebruik per project en in totaal: actieve versies, oudere versies, gearchiveerd, prullenbak en tijdelijke uploads. Daarnaast zie je de vrije schijfruimte.
- Een upload die de vrije ruimte onder de reserve zou brengen, wordt vooraf geweigerd. Uploads die nog lopen tellen daarbij mee. De reserve stel je in met `MIN_FREE_GB` (standaard 5).
- **Video's op een externe schijf:** stop de app en voer `npm run verplaats-opslag -- "/Volumes/<schijf>/Studio Review/media"` uit.
  - Bestanden worden gekopieerd en gecontroleerd, en `MEDIA_DIR` wordt opgeslagen in het instellingenbestand.
  - Is de schijf later niet aangesloten, dan meldt de app dat duidelijk. Uploads en afspelen worden dan geweigerd, en er wordt niets op de interne schijf aangemaakt.
- De opslag zit achter een eigen laag (`server/storage.js`), zodat er later online opslag naast kan komen.

**Archief en prullenbak**
- **Archiveren** (project of video) bewaart alles, inclusief bestanden. Het maakt dus geen ruimte vrij.
  - Klanten kunnen hun link nog openen, maar niet meer reageren of goedkeuren.
  - Terugzetten kan altijd.
- **Naar de prullenbak** (project, video of oudere versie) is herstelbaar.
  - Klantlinks en directe videolinks werken niet zolang iets in de prullenbak staat.
  - Terugzetten brengt alles terug, inclusief reacties, links en geschiedenis. Ingetrokken links blijven ingetrokken.
- **Definitief verwijderen** kan alleen een beheerder, als aparte stap vanuit de prullenbak.
  - Je ziet eerst hoeveel bestanden en hoeveel ruimte er vrijkomt, en je moet dat bevestigen.
  - Automatisch definitief verwijderen bestaat niet: dat staat bewust uit.

## Rechten per project

Er zijn twee soorten accounts:
- **Beheerders** zien alles. Zij beheren teamleden, opslag, back-ups en definitief verwijderen. Er blijft altijd minstens één actieve beheerder.
- **Teamleden** (bijvoorbeeld freelancers) zien alleen de projecten waar ze toegang toe hebben.

Per project krijgt een teamlid een van deze niveaus. Elk niveau omvat het vorige:

| Niveau | Mag |
|---|---|
| Bekijken en reageren | afspelen, downloaden, reageren en reacties afhandelen |
| Uploaden | + nieuwe video's en versies, titels wijzigen, klaarzetten |
| Publiceren en delen | + publiceren naar de klant, reviewlinks en akkoordgever |
| Beheren | + project bewerken, status corrigeren, archiveren, naar de prullenbak |

- De server controleert dit bij elke aanvraag, ook voor videobestanden, thumbnails, reacties en uploads.
- Zonder toegang bestaat een project voor dat account niet (404).
- Bestaande accounts van vóór deze versie zijn beheerder geworden.
- Klantlinks en de akkoordgever werken los van accounts, net als voorheen.

## Versie en cache
- Het versienummer staat onderin de zijbalk en onder **Opslag & back-ups**, bijvoorbeeld `0.2.0 (build 325929cd)`. Het werkt ook zonder Git:
  - de versie komt uit `package.json`;
  - de build is een vingerafdruk van de interfacebestanden.
- Na een update is gewoon verversen genoeg. De pagina zelf wordt altijd gecontroleerd, en alle scripts en stijlen (ook geïmporteerde modules) komen van een adres per build.

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
- **Team & rechten:** teamleden en freelancers toevoegen, toegang per project, en zien of ffprobe en ffmpeg gevonden zijn (met paden). Zie *Rechten per project*.

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
npm start                # http://localhost:3000 (of dubbelklik Start Studio Review.command)
```

### Eerste account (beveiligd)
Een nieuwe installatie zonder accounts vraagt om een **installatiecode**. Zo kan een willekeurige bezoeker het eerste account niet claimen.
- Stel zelf `SETUP_TOKEN` in, of laat de server bij het starten een willekeurige code genereren. Die code verschijnt alleen in het serverlog, samen met een directe link (`/?setup=…`).
- De startknop doet dit automatisch: bij een lege installatie opent hij de browser direct met de juiste installatielink.
- Of maak het account via de commandoregel: `npm run create-user -- sanne@agency.nl "Sanne de Vries" "een-lang-wachtwoord"` (wordt beheerder).
- Zodra er één account bestaat, is de installatiepagina definitief dicht (409). Collega's en freelancers voeg je toe via **Team & rechten**.

### Tests
Alle tests gebruiken eigen, tijdelijke mappen en raken je echte gegevens in `~/Studio Review` niet aan.
```bash
npm test                                                  # 56 servertests (vereist ffmpeg)
CHROME_PATH=/pad/naar/chrome npm run test:browser         # klant- en teamflow in een echte browser (51 controles)
CHROME_PATH=/pad/naar/chrome npm run test:browser:beheer  # rechten, opslag, back-ups, prullenbak, archief (23)
CHROME_PATH=/pad/naar/chrome npm run test:browser:update  # update met de vorige interface in de browsercache (7)
npm run test:update-zip                                   # ZIP-update: vorige versie → nieuwe map → gegevens overgenomen (13)
```
- De servertests dekken onder meer:
  - rechten per niveau, ook voor media, thumbnails, reacties en uploads;
  - de prullenbak (klantlinks en directe media geblokkeerd, terugzetten, definitief verwijderen);
  - back-up en herstel van begin tot eind (account, project, versie, reacties en reviewlink);
  - geheugengebruik bij een bestand van 400 MB;
  - verhuizen van gegevens, te weinig schijfruimte en een ontbrekende externe schijf;
  - cacheheaders;
  - de start- en stopknop: overnemen van een vorige installatie, een tweede klik, een vreemd programma op de poort en een andere installatie op de poort.
- De browsertests maken zelf H.264/AAC-MP4's. Ze hebben een Chrome **met H.264** nodig, zoals Google Chrome of [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/). De Chromium van Playwright speelt geen H.264 af.
- `test:browser:update` en `test:update-zip` vragen een Git-checkout, omdat ze de vorige versie uit de geschiedenis halen.

### Instellingen
Zet instellingen in **`~/Studio Review/instellingen.env`**. Die blijft bij updates bewaard.
- Elke regel heeft de vorm `NAAM=waarde`, bijvoorbeeld `PORT=3001` of `MIN_FREE_GB=20`.
- `.env` in de programmamap werkt ook, maar gaat bij een ZIP-update verloren.
- Een waarde in de terminal of in `.env` gaat vóór het instellingenbestand.

| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | `3000` | Poort van de server |
| `DATA_DIR` | `~/Studio Review/gegevens` | Map voor database, video's en tijdelijke uploads (wint altijd; zie *Gegevens*) |
| `MEDIA_DIR` | `<DATA_DIR>/media` | Aparte map voor video's, bijv. op een externe schijf (`npm run verplaats-opslag`) |
| `BACKUP_DIR` | `~/Studio Review/backups` | Map voor back-ups; moet buiten de gegevensmap liggen |
| `MIN_FREE_GB` | `5` | Vrije ruimte die altijd over moet blijven; uploads daaronder worden vooraf geweigerd |
| `STUDIO_REVIEW_HOME` | `~/Studio Review` | Hoofdmap voor gegevens, back-ups en `instellingen.env` |
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
2. **Back-ups**: lokaal ingebouwd (zie *Gegevens, back-ups en opslag*). Zet de back-upmap bij voorkeur op een andere schijf, of kopieer hem regelmatig naar een externe schijf. Voor objectopslag (S3, R2) is nog een opslagadapter nodig.
3. **E-mail (niet gebouwd)**: links worden nu gekopieerd en zelf verstuurd. Voor uitnodigingen en meldingen is een SMTP-dienst nodig.
4. **Verificatie van de akkoordgever**: nu via het bezit van een persoonlijke, intrekbare link. Een sterkere controle (eenmalige code per e-mail) vraagt om punt 3.
5. **Handmatige browsertest** in Safari (macOS en iOS) en op echte Android-toestellen: die zijn niet automatisch getest.
6. **De start- en stopknop op een echte Mac**: de knoppen zijn getest op Linux (zelfde bash- en Node-code). Wat alleen macOS doet, is niet getest: dubbelklikken in Finder, Gatekeeper, het openen van de browser met `open` en de Homebrew-paden.

Bewust buiten deze versie gelaten: facturatie, videobewerking/transcoding, integraties en annotaties op het beeld.
