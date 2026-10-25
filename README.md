# Studio Review — videoreviewplatform

Eigen reviewplatform voor de filmagency: video's delen met klanten, feedback op tijdstip verzamelen, nieuwe versies uploaden en goedkeuring per versie vastleggen.

## Bouwplan en technische keuzes

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Server | Node.js 22 + Express | Weinig afhankelijkheden (alleen `express`), goed met streaming en grote bestanden. |
| Database | SQLite via het ingebouwde `node:sqlite` | Echte, transactionele opslag zonder aparte databaseserver of native build. Eén bestand, makkelijk te back-uppen. Overstap naar PostgreSQL kan later. |
| Bestanden | Lokale schijf (`~/Studio Review/gegevens/media`, of een externe schijf) achter een eigen opslaglaag | Werkt direct; online opslag kan later als tweede laag. Bestanden krijgen een willekeurige, permanente naam; die staat los van de titel. |
| Uploads | Eigen hervatbare upload in blokken van 8 MB | Grote bestanden hoeven niet in één keer te slagen. Bij een fout volgen automatische herhaalpogingen, en de voortgang is zichtbaar. |
| Video-controle | `ffprobe`/`ffmpeg` | Controleert of een upload echt een video is en leest duur en resolutie uit. Maakt een voorvertoning en (op de achtergrond) afspeelversies in meerdere kwaliteiten. |
| Frontend | Vanilla JS-modules, geen build-stap; hls.js 1.7.3 meegeleverd (Apache-2.0, `public/shared/vendor`) | Licht en snel op mobiel. Alle tekst gaat via `textContent`, dus geen XSS via titels of reacties. hls.js zit in de ZIP: geen extra installatie, ook offline. |
| Beveiliging | Accounts (scrypt-wachtwoorden, httpOnly-sessiecookie), CSRF-header, strikte CSP, `Referrer-Policy: no-referrer` | Elke klant-aanvraag (ook voor videobestanden) controleert op de server of de link geldig en niet ingetrokken is. |

### Datamodel (kort)
- **project** → meerdere **video's** (opleveringen), een **merk**, een **projectlink** (klantportaal) en **briefingonderdelen**
- **video**: *zichtbare titel*, optioneel type / beeldverhouding / kanaal, akkoordgever (naam + e-mail), deel-links
- **versie**: technische bestandsnaam, opgeslagen bestand, status, gedeeld-op
- **status_events**: elke statuswijziging met oud → nieuw, gebeurtenis, wie (team, klant met opgegeven naam of geverifieerde akkoordgever) en tijdstip
- **reacties** (met tijdstip en antwoorden; teamreacties intern of zichtbaar voor de klant), **feedbackrondes** en **goedkeuringen**: altijd gekoppeld aan één specifieke versie

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

**ffprobe wordt niet gevonden?** De app zoekt ffprobe en ffmpeg zelf, ook in `/opt/homebrew/bin` (Apple silicon) en `/usr/local/bin` (Intel). Staan ze ergens anders, zet dan `FFPROBE_PATH` en `FFMPEG_PATH` in het instellingenbestand (zie hieronder). Onder **Instellingen › Team & rechten › Systeem** zie je welke paden gebruikt worden.

## Gegevens, back-ups en opslag

**Waar staat wat** (ook te zien onder **Opslag & back-ups**):

| Wat | Standaardlocatie | Bij een update |
|---|---|---|
| Programma (code) | de uitgepakte map, bijv. `~/Downloads/Review-tool-0.7.0` | vervangen |
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
| `npm run herstel` | Zet een back-up terug; je kiest hem uit een lijst. De app moet gestopt zijn. De back-up wordt eerst volledig gecontroleerd en in een tijdelijke map klaargezet. Je huidige gegevens worden niet verwijderd, maar bewaard als `gegevens.voor-herstel-<datum>`. **Klantlinks:** vooraf zie je hoeveel review-, akkoord-, project- en opleverlinks de back-up bevat. Standaard worden ze allemaal ongeldig (een back-up weet niet welke links later zijn ingetrokken); je maakt daarna nieuwe links. Alleen bewust (keuze 2 of `--links=herstellen`) gaan de links uit de back-up weer werken, ook later ingetrokken links. Goedkeuringen, reacties, opleveringen en geschiedenis blijven altijd bewaard. Een ZIP-update raakt links niet. |

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

## Klantportaal, merken, opleveringen en briefing

**Klantportaal (projectlink)**
- Eén vaste link per project (`/p/…`) geeft de klant een overzicht van alle video’s waarvan een versie is **gepubliceerd**. Je maakt de link via **Klantportaal** op de projectpagina.
- Het portaal toont:
  - de projectnaam en een korte introductie;
  - per video een kaart met thumbnail, titel, type, de gepubliceerde versie en de status in gewone taal;
  - de video’s gegroepeerd: *Wacht op jouw review*, *Feedback verstuurd*, *Goedgekeurd*;
  - de briefingonderdelen die je met de klant deelt.
- Bekijken, reageren en feedback versturen werkt precies zoals bij een reviewlink. Op de videopagina staat een link terug naar het overzicht.
- **De klant ziet nooit:**
  - concepten en nieuwe interne versies; een nieuwe versie verandert de klantweergave pas als je publiceert;
  - interne notities;
  - interne briefingonderdelen.

  De server controleert dit ook bij directe verzoeken.
- **Geen goedkeuringsrechten:** een projectlink kan nooit goedkeuren. Goedkeuren blijft per video, per exacte versie, via de persoonlijke akkoordlink (**Delen** bij de video).
- **Intrekken:** het portaal én alle video’s die via het portaal zijn geopend, zijn direct niet meer bereikbaar. Afzonderlijke review- en akkoordlinks per video blijven werken; die trek je apart in via **Delen**. Het venster toont hoeveel er nog actief zijn.
- **Vervangen:** dit maakt een nieuwe link; de oude werkt daarna niet meer.
- **Let op, lokaal:** zolang de app op je Mac draait, begint de link met `http://localhost:3000`. Zo’n link werkt alleen op die Mac en is **niet bereikbaar voor klanten buiten je computer**. Het venster waarschuwt hiervoor. Voor echte klanttoegang is hosting nodig (zie *Nog nodig voor livegebruik*).

**Klantweergave (voorbeeld voor het team)**
- **Klantweergave** op de projectpagina en bij elke video opent dezelfde klantpagina’s, met dezelfde filters op de server, maar alleen-lezen en met een voorbeeldbalk. Zo controleer je precies wat de klant ziet, ook zonder actieve projectlink.

**Merken**
- **Merken** (beheerders) beheert Studio Brutaal en Moviemates: de merknaam, de accentkleur en het logo (PNG, JPG of WebP tot 2 MB; SVG is bewust niet toegestaan).
  - De pagina toont een live voorbeeld.
  - Zonder logo ziet de klant de naam met initialen.
- Per project kies je het merk bij **Project bewerken**. Het merk verschijnt in het portaal en op alle reviewpagina’s van dat project.
- Een kleur die op de donkere achtergrond slecht leesbaar is, wordt automatisch lichter getoond.
- Een project zonder merk krijgt de standaard Studio Review-weergave.

**Opleveringen**
- Elke oplevering (hoofdvideo, teaser, cutdown, social, overig) is een eigen video. Een verbeterde montage is een nieuwe **versie** van dezelfde oplevering.
- Per video kun je optioneel het type, de beeldverhouding en het bedoelde kanaal invullen. De beeldverhouding wordt automatisch herkend, bijvoorbeeld 9:16.
- De projectpagina groepeert de opleveringen per type, met per oplevering de status, de nieuwste interne versie en de versie die de klant ziet.
- Bestaande video’s blijven gewoon werken; type en kanaal zijn optioneel.

**Briefing en referenties** (tabblad op de projectpagina)
- Je kunt hier kwijt:
  - een briefing als tekst;
  - referentielinks (alleen `http`/`https`);
  - bijlagen: PDF (tot 100 MB), afbeelding (PNG, JPG, WebP, GIF, tot 30 MB) of referentievideo (MP4, MOV, WebM).
- Elk onderdeel is **intern** (standaard) of **zichtbaar voor de klant**. Dat zie je overal met een icoon én tekst.
- Rechten:
  - delen met de klant vraagt het recht *Publiceren en delen*;
  - toevoegen vraagt *Uploaden*;
  - lezen vraagt *Bekijken*.
- Bestanden:
  - worden op hun echte inhoud gecontroleerd; een HTML-bestand dat `.pdf` heet, wordt geweigerd;
  - worden geserveerd met hun eigen type en een afgeschermde (sandbox-)beveiliging, zodat ze nooit als webpagina met scripts kunnen draaien;
  - tellen mee in **Opslag**;
  - gaan mee in back-up en herstel;
  - komen bij weggooien in de **Prullenbak**.
- Lukt opslaan niet, dan blijft je ingevulde tekst staan, ook na verversen.

**Interne en zichtbare teamreacties**
- Notities van het team zijn standaard **intern**. In het invoerveld kies je *Intern* of *Zichtbaar voor klant*.
- Een antwoord op een klantreactie is standaard zichtbaar, met een vinkje *Alleen intern*. Onder een interne notitie blijft alles intern.
- Je kunt per reactie wisselen: **Zichtbaar maken voor klant** of **Intern maken**.
- **Wijziging bij deze update:** vóór deze versie zag de klant álle teamreacties op een gepubliceerde versie.
  - Losse teamnotities van vóór de update zijn nu intern.
  - Antwoorden van het team op klantreacties blijven zichtbaar.
  - Wil je een oude notitie toch aan de klant tonen, kies dan *Zichtbaar maken voor klant*.

## Feedback verwerken, reviewrondes, tekenen, vergelijken en exporteren

**Feedbacktaken** (alleen team)
- Van elke reactie kun je in de werkplek een **taak** maken: **Taak maken**. Een taak heeft:
  - een verantwoordelijke;
  - een prioriteit (hoog, normaal of laag);
  - een optionele deadline (een dag);
  - een status (open, bezig of afgehandeld);
  - een interne toelichting.
- De taak blijft gekoppeld aan de reactie, de video, de versie en de tijdcode.
- Per reactie bestaat hooguit één taak. Opnieuw klikken of opnieuw proberen na een verbindingsfout maakt nooit een tweede.
- **Eén afhandelstatus:** een taak op *Afgehandeld* zetten handelt de reactie af. Een reactie afvinken of heropenen zet de taak mee. Een reactie kan dus nooit tegelijk "afgehandeld" en "taak open" zijn. De status van de video verandert hierdoor niet.
- **Overzicht:** het tabblad **Feedback & taken** op de projectpagina toont de verstuurde klantfeedback en alle reacties met een taak. Je kunt filteren op verantwoordelijke, video, prioriteit en status.
- **Mijn taken** in de zijbalk toont jouw taken in alle projecten, met een teller.
- **Wie kan wat:**
  - toewijzen kan alleen aan teamleden met toegang tot het project;
  - verliest iemand later die toegang, of wordt het account uitgeschakeld, dan wordt de taak losgekoppeld met een zichtbare toelichting;
  - een taak maken of de details wijzigen vraagt het recht *Uploaden*;
  - de status wijzigen kan ook de toegewezen persoon zelf.
- **Klanten** zien nooit iets van taken.

**Reviewrondes** (per video)
- Een ronde ontstaat alleen bij **Publiceren naar klant**. Je kiest dan *Bij ronde N (huidige)* of *Ronde N+1 starten*.
- Bij een nieuwe ronde kun je optioneel een **deadline** opgeven (datum en tijd, met tijdzone en uitgeschreven ter controle) en een **toelichting voor de klant**.
- Bij elke publicatie beschrijf je **wat er is aangepast**. De klant ziet dat bij precies die versie.
- **Afgesproken aantal rondes:**
  - in te stellen per project (*Project bewerken*), met een afwijking per video (*Gegevens* bij de video);
  - wordt per video bijgehouden;
  - meer rondes dan afgesproken geeft een waarschuwing, maar wordt niet geblokkeerd en niet gefactureerd.
- **Wat een ronde niet doet:**
  - uploads, losse reacties en herhaalde verzoeken maken geen extra ronde; publiceren is idempotent per verzoek;
  - een verstreken deadline keurt niets goed en sluit niets af;
  - de bestaande statusregels blijven ongewijzigd.
- **Na de update:** versies die al gedeeld waren, krijgen geen verzonnen ronde. Ze staan in het tabblad **Rondes** als "gedeeld vóórdat rondes werden bijgehouden". De volgende publicatie start ronde 1.

**Tekenen en tijdsbereiken** (team en klant)
- **Tekenen:** in het invoerveld zet de knop **Tekenen** de video stil. Je hebt een pen, pijl, rechthoek en vier kleuren, plus *ongedaan maken* en *wissen*.
  - De tekening hoort bij de reactie, de exacte versie en het moment. Het videobestand verandert niet.
  - Posities worden opgeslagen ten opzichte van het werkelijke beeld, zonder zwarte randen. De tekening staat daardoor goed bij andere schermgroottes, in volledig scherm en bij verticale video's.
  - Werkt ook met aanraking. Gewone tekst blijft altijd mogelijk.
- **Bereik:** met de knop **Bereik** maak je een reactie "van 0:12 tot 0:18".
  1. Klik op **Bereik**.
  2. Speel verder.
  3. Klik op **Eind hier**.

  De server controleert de grenzen. Een klik op de reactie springt naar het begin. **Fragment afspelen** speelt alleen dat stuk af. Het bereik is zichtbaar op de tijdlijn.
- **Zichtbaarheid:** een tekening volgt de zichtbaarheid van de reactie. Interne tekeningen verschijnen nooit op klantpagina's, in voorbeelden of in klantexports.
- **Let op:** op een iPhone opent volledig scherm de eigen speler van iOS. Daar zijn tekeningen niet zichtbaar; buiten volledig scherm wel.

**Versies vergelijken**
- In de werkplek (**Vergelijken**) en op de klantpagina (**Versies vergelijken**) zie je twee versies naast elkaar:
  - versienummers en status bij elke versie;
  - gekoppeld afspelen, pauzeren en spoelen, met de mogelijkheid de koppeling los te zetten;
  - geluid van één gekozen versie;
  - handmatige uitlijning (±1 s of ±1 beeld);
  - bij verschillende lengtes de melding "Einde van deze versie".
- Gekoppelde tijdcodes zijn **geen** inhoudelijke vergelijking; de pagina zegt dat ook.
- Klanten kunnen alleen gepubliceerde versies vergelijken.
- Vergelijken is alleen-lezen.
- Op mobiel staan de versies onder elkaar, of je wisselt tussen A en B.

**Exporteren** (PDF en CSV)
- **Exporteren** op de projectpagina (selectie van video's) of *Feedback exporteren…* bij een video.
- **Inhoud:**
  - project, video, versie, ronde, auteur en datum;
  - tijdcode of bereik;
  - reacties met antwoorden;
  - de afhandelstatus.
- **PDF:**
  - met de projectbranding;
  - bij reacties met een tekening staat het videobeeld met de tekening erop.
- **CSV:**
  - UTF-8 met `;` als scheiding, zodat de tabel goed opent in Excel en Numbers met Nederlandse instellingen;
  - een komma als scheiding kan met `?scheiding=komma`;
  - formules uit ingevoerde tekst worden onschadelijk gemaakt.
- **Interne gegevens:**
  - interne notities, taken en niet-gepubliceerde versies staan standaard **uit**;
  - zet je ze aan, dan wordt de export op elke pagina en in de bestandsnaam als **INTERN** gemarkeerd.
- **Klanten** kunnen via hun link en het portaal ook downloaden, maar krijgen nooit interne gegevens, ook niet via aangepaste verzoeken.

## Definitieve opleveringen en klantactiviteit

**Publiceren en vrijgeven zijn twee verschillende acties**
- *Publiceren* zet een versie klaar voor review (zoals voorheen).
- *Definitief vrijgeven* maakt een goedgekeurde versie beschikbaar als eindbestand om te downloaden. Dat doe je in het project onder **Oplevering › Bestanden vrijgeven…**, of vanuit de werkplek met **Definitief vrijgeven…** bij een goedgekeurde versie.
- Vrijgeven gaat in twee stappen:
  1. per video kies je de exacte versie;
  2. je ziet een overzicht van wat de klant krijgt (bestandsnaam, formaat, grootte, wie goedkeurde) en bevestigt.

**Wanneer telt een goedkeuring?**
- Alleen als de akkoordgever precies deze versie heeft goedgekeurd via de persoonlijke akkoordlink, en de versie nog op Goedgekeurd staat.
- Een handmatig op “Goedgekeurd” gezette status **zonder** klantgoedkeuring telt niet. Het venster legt uit waarom.
- Wordt de status na de goedkeuring handmatig gecorrigeerd (bijvoorbeeld naar “Aanpassingen nodig”), dan geldt de goedkeuring als **ingetrokken**:
  - een bestaande oplevering van die versie wordt **geblokkeerd** (geen nieuwe downloads; de klant ziet “tijdelijk niet beschikbaar”);
  - de status handmatig terugzetten op Goedgekeurd herstelt dat **niet**;
  - nodig is: status op “In review” → de akkoordgever keurt opnieuw goed → het team geeft opnieuw bewust vrij.

**Een oplevering verwijst blijvend naar één versie**
- Er wordt geen kopie gemaakt: de download is het bestaande bestand van die versie. Ook back-ups bevatten het bestand maar één keer.
- Een nieuwe upload, een nieuwe reviewversie of een nieuw concept verandert de oplevering niet en blokkeert hem ook niet.
- Het team ziet wél wanneer er een nieuwere interne of gepubliceerde versie bestaat dan de opgeleverde.
- **Vervangen** (een andere goedgekeurde versie vrijgeven) vraagt een expliciete bevestiging. De oude oplevering is daarna niet meer te downloaden.
- **Terugnemen** vraagt een bevestiging en een reden. Het bestand verdwijnt dan van de opleverpagina; versie, goedkeuring en status blijven ongewijzigd.
- Vrijgaven, vervangingen, terugnames en opleverlinks staan in de **oplevergeschiedenis**, met wie en wanneer.

**De opleverpagina voor de klant**
- Bovenaan: projectnaam, merk en een korte oplevertekst (in te vullen onder **Oplevering**).
- Per bestand:
  - thumbnail en titel;
  - type, beeldverhouding en kanaal (waar ingevuld);
  - bestandsformaat, grootte en resolutie;
  - versienummer en datum van vrijgave;
  - een downloadknop.
- De download heeft de zichtbare titel en de echte extensie, bijvoorbeeld `Zomerlijn — Hoofdfilm - v2.mp4`. Het bestand wordt gestreamd (ook grote bestanden komen niet in één keer in het geheugen) en ondersteunt hervatten.
- Bereikbaar op drie manieren:
  - een **afzonderlijke opleverlink** (`/o/…`), die je maakt, vervangt of intrekt onder **Oplevering**. Deze link geeft **alleen** toegang tot de vrijgegeven bestanden van dit project: geen reviewpagina’s, concepten, feedback of andere projecten;
  - via het **klantportaal**: de kaart “Definitieve bestanden” verschijnt zodra er iets is vrijgegeven;
  - als alleen-lezen **klantweergave** voor het team (downloaden staat daar uit).
- Intrekken of vervangen van de opleverlink blokkeert direct ook rechtstreekse downloadverzoeken via die link. Het venster toont welke andere links (klantportaal, reviewlinks met download, akkoordlinks) volgens hun eigen rechten toegang houden.
- **Archief:** opleveringen blijven te downloaden, maar nieuw vrijgeven kan niet.
- **Prullenbak:**
  - een video of versie in de prullenbak is niet te downloaden;
  - een project in de prullenbak sluit de opleverlink af;
  - terugzetten brengt de toegang terug, maar activeert een ingetrokken link nooit opnieuw;
  - het venster voor definitief verwijderen waarschuwt als bestanden deel uitmaken van een oplevering.
- **Back-up terugzetten** maakt standaard alle klantlinks ongeldig, ook de opleverlink (zie `npm run herstel` hierboven). De vrijgaven zelf blijven staan; maak een nieuwe opleverlink en deel die.

**Klantactiviteit** (tab **Klantactiviteit** in het project, voor wie mag publiceren en delen)
- Gebeurtenissen:
  - klantportaal geopend;
  - reviewpagina geopend;
  - afspelen gestart;
  - opleverpagina geopend;
  - download aangevraagd.
- Per regel: datum en tijd, video en exacte versie (waar van toepassing) en via welke link. Filters op gebeurtenis en video.
- De labels beschrijven alleen wat is waargenomen:
  - “Afspelen gestart” betekent niet “volledig bekeken”;
  - “Download aangevraagd” betekent niet “opgeslagen”;
  - “Via akkoordlink van Joris” zegt welke link is gebruikt, niet wie er keek;
  - een naam die een bezoeker zelf intypte, staat er als “opgegeven naam, niet geverifieerd”.
- Wat niet meetelt:
  - thumbnails, videodeelverzoeken, voorladen en vervolgdelen van een download;
  - de klantweergave van het team en ingelogde teamleden die een klantlink openen;
  - herhalingen: hetzelfde signaal via dezelfde link telt één keer per 30 minuten (downloads: per 5 minuten), en een herhaald verzoek wordt herkend.
- De server controleert bij elk signaal of de link toegang heeft tot de genoemde video en versie. Een bezoeker kan dus geen activiteit voor een ander project registreren.
- Wat niet wordt bewaard:
  - er is geen externe trackingdienst;
  - de app bewaart geen tokens, IP-adressen of apparaatkenmerken.
- Activiteit verandert nooit een status, taak of goedkeuring. Feedback en goedkeuringen blijven in de geschiedenis per versie staan.
- **Bewaartermijn:** standaard 90 dagen. Een beheerder stelt die in onder **Opslag & back-ups** (7–730 dagen). Oudere activiteit wordt automatisch opgeruimd bij het starten en elk uur. Goedkeuringen, feedback, statuscorrecties en oplevergeschiedenis worden daarbij nooit verwijderd.

**Volledig scherm op iPhone**
- Op iPhone opent volledig scherm de ingebouwde speler van iOS. Daarin kunnen geen tekeningen worden getoond.
- Heeft de video tekeningen, dan krijg je bij de knop **Volledig scherm** eerst een korte uitleg en een keuze:
  - **Groot in de pagina (met tekeningen):** de speler vult het venster, mét tekeningen; sluiten met dezelfde knop of Esc;
  - **Schermvullend zonder tekeningen.**
- Zonder tekeningen gaat de iPhone direct naar de ingebouwde schermvullende weergave, zoals voorheen.
- Dit is getest met een nagebootste iPhone-omgeving in Chrome, **niet op een echte iPhone**.

## Bouwronde 6: nieuwe vormgeving, rollen, freelancers, klantvragen en ⌘K

- **Vormgeving**: neutrale zwart-witbasis met sterke koppen, lijnen in plaats van kaders, kleur alleen voor
  status en het merk van de klant. Ontwerpregels en de plek van iedere functie:
  [docs/HERINRICHTING.md](docs/HERINRICHTING.md). Er zijn geen huisstijlwaarden van Studio Brutaal
  verzonnen: logo en kleur per merk stel je in onder **Instellingen › Merken** (de standaardkleuren zijn
  plaatshouders); lettertypen kunnen later in `public/shared/huisstijl.css`.
- **Klantstartpagina** in vaste volgorde: een samenvatting (“Er staan 3 video’s voor je klaar.”), dan
  **Jouw acties** (per video het project, de exacte versie, wat er gevraagd wordt en de deadline;
  verstreken deadlines eerst; één actie per video; goedkeuren alleen voor de aangewezen akkoordgever via
  de persoonlijke link), **Bij Studio Brutaal** (feedback verstuurd), **Goedgekeurd** (ingeklapt),
  **Definitieve bestanden** (alleen wat echt is vrijgegeven) en een ingeklapte route naar alle projecten
  en video’s. Een bezoek of afspelen rondt nooit iets af; een verstreken deadline keurt nooit goed.
- **Rollen en personen**: zie hieronder en [docs/ROLLEN.md](docs/ROLLEN.md). Vanuit het project:
  **Personen** → bestaand persoon kiezen (of als beheerder een account maken) → rol en eventueel
  tijdelijke toegang → toevoegen. Verlengen, nu intrekken en ontkoppelen in dezelfde lijst.
- **Freelancers**: eigen alleen-lezen omgeving met gekoppelde projecten, verstuurde klantfeedback
  (tijdcodes, fragmenten, tekeningen) op gepubliceerde versies en een eigen inbox. Alle andere teamroutes
  zijn op de server dicht.
- **Vraag aan klant**: een Projectleider deelt een vraag over het project of een exacte versie; de klant
  ziet hem onder **Jouw acties** en antwoordt in het klantportaal of via de projectlink (naam van een
  persoonlijke link = geverifieerd; zelf ingevulde naam staat er als zodanig bij). Het team krijgt een
  melding. Herhaalde verzoeken maken geen dubbele vragen, antwoorden of meldingen. Een antwoord verandert
  niets aan status of goedkeuring, en een goedkeuring beantwoordt geen vraag.
- **Opdrachtbalk** (⌘K op de Mac, Ctrl+K elders, of **Opdrachten** in de zijbalk): zoeken in je
  projecten, video’s en taken en toegestane acties starten (bijv. uploaden), volledig met het toetsenbord.
  Zelfde rechten als de rest van de app; bevestigingen blijven gewoon.
- **Identieke uploads**: de app vergelijkt de inhoud (SHA-256, gestreamd berekend), alleen binnen het
  eigen project. Bij een identiek bestand: “Dit bestand staat al in dit project als …, versie …” met
  **Bestaande openen**, **Annuleren** (verwijdert alleen de tijdelijke upload) of **Toch uploaden**
  (gewone versie met de eigen bestandsnaam). Nooit automatisch samenvoegen of overschrijven. Oudere
  versies krijgen hun hash op de achtergrond.

## Bouwronde 5: rustiger werken, klanten, inbox, kwaliteit en ZIP

### Indeling, dashboard, zoeken en thema
- **Dashboard** per account: standaard vier blokken (Mijn taken, Nieuwe feedback, Wacht op klant, Recente projecten). Met **Dashboard aanpassen** voeg je blokken toe, verberg, verplaats (ook met het toetsenbord) en maak je ze breed; alleen dan zie je bewerkknoppen. Klantactiviteit en Opslag zijn er alleen voor wie de rechten heeft. Alles wordt op de server beperkt tot je eigen projecten.
- **Zoeken** (veld in de zijbalk, sneltoets `/`): projecten en klanten, videotitels, oorspronkelijke bestandsnamen, briefings en reacties, gegroepeerd. Een reactie opent de juiste video, versie en het juiste tijdstip. Zoekopdrachten bewaar je per account. Elke zoekopdracht (ook suggesties en aantallen) houdt rekening met je rechten.
- **Thema**: Licht, Donker of Systeem in het profielmenu (per account). Klanten zonder account hebben dezelfde kleine keuze rechtsboven op hun pagina’s (onthouden in hun browser).
- **Eigen thumbnail** per versie: Info › *Huidig frame gebruiken*; *Automatisch* zet hem terug. Het videobestand blijft ongewijzigd en een interne versie lekt niet via klantweergaven.

### Klanten en klantportaal
- **Klanten** (hoofdmenu): projecten koppel je expliciet aan een klant (nooit op basis van een gelijke naam). Per project kies je **Actief**, **Afgerond** (in het portaal ingeklapt) of **Klanttoegang uit** (verborgen en geblokkeerd voor álle klantlinks en directe bestanden). Weer aanzetten heropent geen links die je los had ingetrokken.
- **Klantportaal** `/k/…`: klant → projecten → gepubliceerde video’s en opleveringen. Een **algemene** link kan nooit goedkeuren. Een **persoonlijke** link (met het e-mailadres van een akkoordgever) kan goedkeuren bij precies de video’s waar die persoon de aangewezen akkoordgever is: bekijken → *Deze versie goedkeuren* → één korte bevestiging met titel en exacte versie. Bestaande project-, review-, akkoord- en opleverlinks werken zoals voorheen, met hun eigen bereik.
- Wordt een goedkeuring later door het team ingetrokken (statuscorrectie), dan ziet de klant wie wanneer goedkeurde, dat het is ingetrokken, en wat er nu nodig is.
- **Taal**: klantpagina’s in het Nederlands of Engels (standaard per klant, schakelaar rechtsboven voor de kijker). Titels, reacties en briefing worden niet vertaald. Datums met tijdzone.
- **Vorige/volgende** video binnen het portaal waaruit je kwam, met een waarschuwing als er nog niet geplaatste of niet verstuurde reacties zijn.
- **Wachtwoord en vervaldatum** op review-, akkoord-, project-, oplever- en klantportaallinks (knop *Beveiliging*). Wachtwoorden worden gehasht opgeslagen, staan nooit in een URL of log, en gokpogingen worden beperkt (8 per kwartier per link). Een nieuw wachtwoord of intrekken maakt eerdere ontgrendelingen ongeldig. Geldt ook voor video’s, afspeelbestanden, exports en ZIP’s. Een verlopen link verandert niets aan goedkeuringen. Herstel van een back-up maakt ook klantportaallinks standaard ongeldig.

### Inbox en meldingen
- **Inbox** per account: taak toegewezen, @vermelding (`@Volledige Naam` of `@naam` vóór de @ van het e-mailadres), antwoord in een gesprek dat je volgt, klantfeedback, goedkeuring (en intrekking), vrijgave en terugnemen van opleveringen in projecten die je volgt. Gelezen/ongelezen per persoon; geen dubbele meldingen bij herhaalpogingen; een melding opent de juiste video, versie, reactie of oplevering.
- Een project volg je met **Volgen** in de projectkop (automatisch als je het maakt, erin uploadt of publiceert). Een gesprek volg je zodra je erin schrijft of de taak hebt.
- Rechten worden gecontroleerd bij maken, tonen en openen: wie de toegang tot een project verliest, ziet de meldingen daarvan niet meer.
- **Browsermeldingen** alleen na *Meldingen inschakelen*, en alleen zolang de app in een tabblad openstaat. Er wordt niets gemaild. Draait de app alleen op deze Mac, dan kunnen teamleden op andere computers hun inbox nog niet gebruiken.
- **Klantactiviteit** is één tijdlijn: signalen (geopend, afspelen gestart, download aangevraagd) én formele acties (feedback verstuurd, goedkeuring), met datum, tijd, tijdzone, video, versie en link. Eigen bezoeken als ingelogd teamlid staan apart als *teambezoek* (standaard verborgen). Het overzicht ververst elke 30 seconden.

### Kwaliteit, afspeelversies en downloadrechten
- Na elke upload maakt de app **afspeelversies**: 4K, 1440p, 1080p en 720p, maar alleen wat de bron heeft (gemeten aan de korte zijde, dus ook staande video’s; rotatie en niet-vierkante pixels worden rechtgezet). Een bron kleiner dan 720p krijgt één versie op eigen formaat. Eerst 720p, zodat afspelen snel kan.
- Formaat: H.264 (High) + AAC stereo 48 kHz, fragmented MP4 met HLS-afspeellijsten, één bestand per kwaliteit, sleutelbeeld elke 2 seconden.
- **Speler**: tandwiel met **Auto** (hoogste kwaliteit die de verbinding aankan, zonder te blijven wisselen) of een vaste kwaliteit; het label toont wat er echt speelt. Wisselen behoudt tijdcode, geluid, fragmenten en tekeningen. In Chrome speelt dit via hls.js (getest); Edge en Firefox gebruiken dezelfde route (niet apart getest); Safari gebruikt zijn eigen HLS-ondersteuning (**niet getest**). Zonder HLS-ondersteuning speelt één afspeelversie als gewoon bestand.
- **Beperkingen**: HDR-bronnen (PQ/HLG) worden zonder kleuromzetting naar 8-bit SDR gecodeerd en kunnen fletser ogen; het origineel blijft de referentie (de werkplek meldt het). 10-bit en 4:2:2 worden 8-bit 4:2:0. Meer dan twee audiokanalen worden stereo.
- **Verwerking** op de achtergrond, één tegelijk (instelbaar), gepubliceerde versies eerst, met voortgang in *Info › Afspeelversies*, automatisch één nieuwe poging en *Opnieuw proberen*. Vóór elk niveau wordt de vrije ruimte gecontroleerd. Afspeelversies tellen mee in het opslagoverzicht (apart vermeld), zitten in back-ups en verdwijnen bij definitief verwijderen.
- **Extra opslag (vuistregel)**: per minuut video ± 150–300 MB voor een 4K-bron (alle vier de niveaus samen), ± 35–70 MB voor een 1080p-bron.
- **Downloadrechten**: nieuwe reviewlinks hebben standaard géén download. Zonder downloadrecht levert de server het origineel via geen enkel adres (403); afspelen gaat alleen via de afspeelversies, met dezelfde controles op link, wachtwoord, vervaldatum, intrekken en klanttoegang. Het contextmenu en de downloadknop van de video zijn uit. **Dit is geen kopieerbeveiliging**: wat iemand kan afspelen, kan hij opnemen. Bestaande links houden hun instelling; opleverlinks downloaden gewoon de vrijgegeven bestanden.

### Opleverpakket (ZIP)
- *Alles downloaden (ZIP)* op de opleverpagina (en *Alles als ZIP* voor het team) bij twee of meer beschikbare bestanden.
- Alleen exacte versies met een geldige vrijgave en goedkeuring, onder hun oorspronkelijke naam. Dubbele namen komen elk in een map met de videotitel. Plus `Overzicht.txt` (in de taal van de klant) met video, versie, goedkeuring en vrijgave. De ZIP heet naar het project.
- De ZIP wordt **rechtstreeks gestreamd, zonder compressie** (video’s worden daar niet kleiner van) en zonder tijdelijk bestand: de grootte is vooraf bekend, zodat de browser de voortgang toont; er is geen extra schijfruimte nodig en er blijft niets achter dat later via een adres op te halen is. Bestanden boven 4 GB: ZIP64.
- Toegang wordt bij het starten én vóór elk bestand opnieuw gecontroleerd. Wordt de link intussen ingetrokken, verloopt hij of wordt een oplevering teruggenomen, dan breekt de download af (geen pakket dat compleet lijkt).

## Rollen en rechten

Volledige matrix en regels: [docs/ROLLEN.md](docs/ROLLEN.md). Kort:

- **Accounts**: beheerder (alles), teamlid (alleen gekoppelde projecten) of freelancer (alleen
  klantfeedback bekijken in gekoppelde projecten). Er blijft altijd minstens één actieve beheerder.
- **Rol per project**: **Projectleider** (beheren, personen koppelen, publiceren, delen, opleveren),
  **Editor** (uploaden, versies, reageren, feedbacktaken), **Meekijker** (bekijken, niets wijzigen) of
  **Freelancer** (alleen voor freelanceraccounts). Een rol geeft niets in andere projecten en nooit
  toegang tot beheer.
- **Tijdelijke toegang**: per koppeling een einddatum en -tijd, bij elk verzoek gecontroleerd.
- De server controleert alles bij elke aanvraag, ook voor videobestanden, thumbnails, zoeken, aantallen,
  meldingen en exports. Zonder toegang bestaat een project voor dat account niet (404).
- Klantlinks en de akkoordgever werken los van accounts, net als voorheen.

## Versie en cache
- Het versienummer staat onderin de zijbalk, in het profielmenu en onder **Instellingen › Opslag & back-ups**, bijvoorbeeld `0.7.0 (build 1a2b3c4d)`. Het werkt ook zonder Git:
  - de versie komt uit `package.json`;
  - de build is een vingerafdruk van de interfacebestanden.
- Na een update is gewoon verversen genoeg. De pagina zelf wordt altijd gecontroleerd, en alle scripts en stijlen (ook geïmporteerde modules) komen van een adres per build.

## Functionaliteit

**Teamomgeving (inloggen verplicht)**
- **Vaste zijbalk** met zoeken, **Dashboard, Projecten, Klanten, Inbox**, **Mijn taken**, onderaan **Instellingen** (team, merken, opslag, archief, prullenbak), de systeemstatus en het profielmenu (thema, account, uitloggen). Waar elke functie staat: [docs/HERINRICHTING.md](docs/HERINRICHTING.md).
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
  - de speler krijgt de meeste ruimte, met daarnaast een paneel met de tabs *Reacties*, *Versies* en *Info* (eigenschappen, thumbnail, afspeelversies, rondes en geschiedenis);
  - een vaste statusbalk zegt waar de versie staat en wat de volgende stap is (*Klaar voor review* → *Publiceren naar klant*);
  - een versiekeuze, de volgende stap en *Delen* staan altijd op dezelfde plek; minder gebruikte acties staan onder **⋯**.
- **Reacties** filter je op open, afgehandeld of alles. Je kunt ze beantwoorden en afhandelen. Het invoerveld toont live op welk moment de reactie komt, en een klik maakt er een algemene reactie van.
- **Deelvenster** met een duidelijk verschil tussen de **reviewlink** (bekijken, reageren, feedback; kan niet goedkeuren) en de **akkoordlink** (persoonlijk; alleen hiermee kan worden goedgekeurd). Links kopieer je en trek je in vanuit dit venster.
- **Status van Versie N corrigeren** kan alleen met een verplichte reden, die in de geschiedenis van precies die versie wordt bewaard. Andere versies en hun goedkeuringen veranderen niet; het venster toont wat de correctie betekent voor de goedkeuring en een eventuele oplevering.
- **Downloaden** geeft de **oorspronkelijke uploadnaam**, ook als je de titel wijzigt (team, reviewlinks met download, opleverlinks en ZIP). Ontbreekt een bruikbare naam (alleen bij oude of vreemde uploads), dan valt hij terug op `Titel - vN.<extensie>`; er wordt geen naam verzonnen.
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
| Team: "Status van Versie N corrigeren" (reden verplicht) | Elke status (gelogd met naam en reden) |

Feedback en goedkeuring zijn alleen mogelijk op de nieuwste gedeelde versie met status *In review* of *Aanpassingen nodig*.

### Ondersteunde videoformaten (eerste versie)
`.mp4`, `.m4v`, `.mov` en `.webm`, standaard tot 20 GB (instelbaar). Het **origineel blijft altijd ongewijzigd**. Voor het afspelen maakt de app op de achtergrond **afspeelversies** (H.264/AAC, zie *Bouwronde 5*); daardoor speelt ook een ProRes- of HEVC-bron af in de browser zodra die klaar zijn. **Aanbevolen blijft: H.264/AAC in MP4.**

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
npm test                                                   # 162 servertests (vereist ffmpeg en unzip)
CHROME_PATH=/pad/naar/chrome npm run test:browser          # klant- en teamflow in een echte browser (52 controles)
CHROME_PATH=/pad/naar/chrome npm run test:browser:beheer   # rollen, freelanceraccount, opslag, back-ups, prullenbak, archief (28)
CHROME_PATH=/pad/naar/chrome npm run test:browser:portaal  # klantportaal (startpagina in vaste volgorde), merk, opleveringen, briefing, desktop + mobiel (52)
CHROME_PATH=/pad/naar/chrome npm run test:browser:feedback # taken, rondes, tekenen, bereik, vergelijken, export, desktop + mobiel (50)
CHROME_PATH=/pad/naar/chrome npm run test:browser:oplevering # opleveringen, klantactiviteit, statuscorrectie per versie, iPhone-uitleg (nagebootst), desktop + mobiel (52)
CHROME_PATH=/pad/naar/chrome npm run test:browser:update   # update met de vorige interface in de browsercache (7)
npm run test:update-zip                                    # ZIP-update: oude versie → nieuwe map → gegevens overgenomen (13)
CHROME_PATH=/pad/naar/chrome npm run test:browser:ui      # dashboard, zoeken, thema, bestandsnamen, thumbnail, desktop + mobiel (38)
CHROME_PATH=/pad/naar/chrome npm run test:browser:klanten # klanten, klantportaal NL/EN, goedkeuren, vorige/volgende, wachtwoord, bezoekersthema, desktop + mobiel (47)
CHROME_PATH=/pad/naar/chrome npm run test:browser:inbox   # inbox, browsermeldingen (nagebootst), activiteitentijdlijn (24)
CHROME_PATH=/pad/naar/chrome npm run test:browser:kwaliteit # kwaliteitskeuze met hls.js, vertraagd netwerk, 4K/staand, geen origineel (23)
CHROME_PATH=/pad/naar/chrome npm run test:browser:ronde6  # ⌘K met toetsenbord en beperkte rechten, identieke uploads in de wachtrij, klantvraag, freelancer verloopt (24)
npm run test:upgrade                                       # bijwerken vanaf 0.6.0 met echte gegevens, rollen omgezet, oude en nieuwe back-up terugzetten (46)
npm run test:offline-update                                # ZIP-update vanaf 0.6.0 met de echte startknop, zonder netwerk (Linux: unshare + python3) (11)
```
- De servertests dekken onder meer:
  - rechten per niveau, ook voor media, thumbnails, reacties en uploads;
  - de prullenbak (klantlinks en directe media geblokkeerd, terugzetten, definitief verwijderen);
  - back-up en herstel van begin tot eind (account, project, versie, reacties en reviewlink);
  - klantlinks bij herstel: standaard alle review-, akkoord-, project- en opleverlinks ongeldig (ook op een schone installatie), alleen bewust de links uit de back-up, historie intact, nieuwe links werken, de herstelopdracht zelf;
  - statuscorrecties per exacte versie: een correctie op v2 raakt de oplevering van v1 niet, intrekken op v1 blokkeert wel, een handmatig label herstelt niets;
  - geheugengebruik bij een bestand van 400 MB;
  - verhuizen van gegevens, te weinig schijfruimte en een ontbrekende externe schijf;
  - cacheheaders;
  - klantportaal: alleen gepubliceerde informatie, geen goedkeuringsrechten, intrekken en vervangen, interne reacties en interne versies ook niet via directe verzoeken;
  - briefing: zichtbaarheid, rechten, bestandscontrole (geen HTML/SVG/vermomde bestanden), veilige headers, prullenbak, opslag, back-up en herstel van bijlagen;
  - merken: kleur, logo (geen SVG), alleen beheerders;
  - feedbacktaken: geen dubbele taken, één afhandelstatus, rechten, toegang intrekken, filters;
  - reviewrondes: expliciete keuze, idempotent publiceren, geen extra rondes door uploads/reacties, verstreken deadlines, statusregels;
  - tekeningen en tijdsbereiken: grenzen en vormen op de server, afscherming van interne tekeningen;
  - export: CSV (bijzondere tekens, meerdere regels, formules), PDF-inhoud, interne markering, klantafscherming, rechten;
  - back-up en herstel van taken, rondes, bereiken en tekeningen;
  - opleveringen: alleen echte klantgoedkeuring, handmatig label en ingetrokken goedkeuring geweigerd, nieuwe concepten raken de oplevering niet, vervangen en terugnemen, opleverlink intrekken en vervangen (ook directe downloads), toegang via verschillende links, archief, prullenbak, definitief-verwijderen-overzicht, downloadnaam en identieke inhoud, back-up en herstel;
  - klantactiviteit: geen dubbele of technische gebeurtenissen, geen activiteit van het team, afscherming tussen projecten, geen tokens of IP-adressen, opruimen zonder verlies van formele geschiedenis;
  - de start- en stopknop: overnemen van een vorige installatie, een tweede klik, een vreemd programma op de poort en een andere installatie op de poort.
- De browsertests maken zelf H.264/AAC-MP4's. Ze hebben een Chrome **met H.264** nodig, zoals Google Chrome of [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/). De Chromium van Playwright speelt geen H.264 af.
- `test:browser:update`, `test:update-zip` en `test:upgrade` vragen een Git-checkout, omdat ze de vorige versie uit de geschiedenis halen.

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
| `VARIANT_CONCURRENCY` | `1` | Hoeveel afspeelversies tegelijk worden gemaakt (1–4) |
| `VARIANT_PRESET` | `veryfast` | Snelheid van het maken van afspeelversies (`ultrafast` … `medium`): sneller = grotere bestanden |

### Lettertype in PDF-exports
PDF's gebruiken het meegeleverde lettertype DejaVu Sans (`server/fonts/`, vrije licentie in `LICENSE-DejaVu.txt`), zodat €, ë, — en andere tekens overal goed staan. De PDF-bibliotheek `pdfkit` (MIT) wordt bij de eerste start automatisch geïnstalleerd.

### Afhankelijkheden zichtbaar
- `GET /api/health` geeft `database`, `ffprobe`, `ffmpeg` en `uploads` (`ok`, `uitgeschakeld` of `zonder controle`).
- Ontbreekt ffprobe of ffmpeg, dan toont de teamomgeving een balk bovenaan en meldt het serverlog dit bij het starten.

### Betrouwbaarheid van klantacties
"Feedback versturen", "Deze versie goedkeuren" en reacties sturen een unieke request-id mee. Valt de verbinding weg, dan probeert de browser het opnieuw met dezelfde id. De server herkent een herhaald verzoek en wijzigt dan niets. Een oud feedbackverzoek kan dus nooit een latere goedkeuring of een handmatige correctie overschrijven. Een nieuwe klantactie (met een nieuwe id) volgt gewoon de statusregels.

## Testomgeving en livegang
Zie **[DEPLOY.md](DEPLOY.md)** voor een afgeschermde testomgeving met Docker en Caddy (HTTPS en een wachtwoord). Zie **[ACCEPTATIETEST.md](ACCEPTATIETEST.md)** om de klantflow zelf te doorlopen en voor de handmatige browsertestlijst.

### Nog nodig voor livegebruik
1. **Hosting**: een server of VPS met Docker, een domein (DNS A-record) en een persistente schijf (zie DEPLOY.md). Pas dan zijn project-, review- en akkoordlinks bereikbaar voor klanten; lokaal beginnen ze met `localhost` en werken ze alleen op je eigen Mac. Zet dan ook `PUBLIC_URL`.
2. **Back-ups**: lokaal ingebouwd (zie *Gegevens, back-ups en opslag*). Zet de back-upmap bij voorkeur op een andere schijf, of kopieer hem regelmatig naar een externe schijf. Voor objectopslag (S3, R2) is nog een opslagadapter nodig.
3. **E-mail (niet gebouwd)**: links worden nu gekopieerd en zelf verstuurd. De inbox en browsermeldingen werken alleen in de app zelf (met een open tabblad). Voor uitnodigingen en meldingen per e-mail is een SMTP-dienst nodig.
4. **Teamleden buiten deze Mac**: inboxen, taken en meldingen zijn per account gebouwd, maar zolang de app op `localhost` draait, kunnen collega’s en freelancers op andere computers er niet bij.
5. **Verificatie van de akkoordgever**: nu via het bezit van een persoonlijke, intrekbare link. Een sterkere controle (eenmalige code per e-mail) vraagt om punt 3.
6. **Handmatige browsertest** in Safari (macOS en iOS) en op echte Android-toestellen: die zijn niet automatisch getest.
7. **De start- en stopknop op een echte Mac**: de knoppen zijn getest op Linux (zelfde bash- en Node-code). Wat alleen macOS doet, is niet getest: dubbelklikken in Finder, Gatekeeper, het openen van de browser met `open` en de Homebrew-paden.

Bewust buiten deze versie gelaten: facturatie, videobewerking/transcoding, integraties en annotaties op het beeld.
