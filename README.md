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

## Installatie

Vereist: **Node.js ≥ 22.13** en bij voorkeur **ffmpeg** (met ffprobe).

```bash
npm install
npm start                # http://localhost:3000
```

Bij het eerste bezoek maak je het eerste teamaccount aan. Dat kan ook via de commandoregel:

```bash
npm run create-user -- sanne@agency.nl "Sanne de Vries" "een-lang-wachtwoord"
```

Tests (vereist ffmpeg):

```bash
npm test
```

### Omgevingsvariabelen
| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | `3000` | Poort van de server |
| `DATA_DIR` | `./data` | Map voor database, video's en tijdelijke uploads |
| `PUBLIC_URL` | (host van de aanvraag) | Publiek adres voor deel-links, bijv. `https://review.jouwagency.nl` |
| `SECURE_COOKIES` | `false` | Op `true` zetten achter HTTPS |
| `TRUST_PROXY` | `false` | Op `true` achter een reverse proxy (nginx, Caddy) |
| `MAX_UPLOAD_GB` | `20` | Maximale bestandsgrootte |

## Wat werkt en wat nog configuratie nodig heeft

**Werkt nu volledig (getest):** accounts, projecten, chunked uploads met voortgang en herhaalpogingen, controle met ffprobe, voorvertoningen, titels los van bestandsnamen, versies, statussen met automatische regels en logboek, reacties op tijdstip met antwoorden en afvinken, feedbackrondes, goedkeuring door de akkoordgever, deel-links die je kunt intrekken, downloads met de juiste extensie, en een mobiele reviewpagina.

Geautomatiseerd getest met `npm test` (12 tests), waaronder:
- een titelwijziging breekt geen bestanden, links, reacties of geschiedenis;
- ingediende feedback zet de status op *Aanpassingen nodig* (openen, losse reactie en afvinken doen dat niet);
- goedkeuring geldt alleen voor de bekeken versie;
- een nieuwe versie bewaart de eerdere feedback en goedkeuring en is zelf niet goedgekeurd;
- een ingetrokken link geeft geen toegang meer, ook niet tot het videobestand.

**Resterende configuratiestappen voor productie**
1. **HTTPS en domein**: zet een reverse proxy (Caddy of nginx) met TLS voor de app. Stel `PUBLIC_URL`, `SECURE_COOKIES=true` en `TRUST_PROXY=true` in. Zet in nginx `client_max_body_size` op minimaal `10m` (blokken zijn 8 MB).
2. **ffmpeg installeren** op de server (`apt install ffmpeg`). Zonder ffmpeg worden uploads niet gecontroleerd en is er geen voorvertoning.
3. **Opslag en back-ups**: `DATA_DIR` op een schijf met voldoende ruimte, plus regelmatige back-ups van `review.db` en `media/`. Wil je objectopslag (S3, R2), dan is daarvoor nog een opslagadapter nodig.
4. **E-mail (niet gebouwd)**: links worden nu door het team gekopieerd en zelf verstuurd. Voor automatische uitnodigingen en meldingen bij feedback of goedkeuring is een SMTP-dienst nodig.
5. **Verificatie van de akkoordgever**: die gebeurt nu via het bezit van een persoonlijke, intrekbare link. Een sterkere controle (eenmalige code per e-mail) vraagt om punt 4.
6. **Procesbeheer**: draai de app als service (systemd, pm2 of Docker) met automatische herstart.
7. **Opruimen**: afgebroken uploads blijven in `data/uploads-tmp` staan. Ruim die periodiek op (bijv. bestanden ouder dan 2 dagen).

Bewust buiten deze versie gelaten: facturatie, videobewerking/transcoding, integraties en annotaties op het beeld.
