# Herinrichting: ontwerpregels, inventarisatie en plek van iedere functie

Alle bestaande functies blijven bestaan en vindbaar; oude adressen blijven werken. Rollen en rechten:
[ROLLEN.md](ROLLEN.md).

## Bouwronde 7 (0.8.0): stijl 2 — nachtblauw met blauwe accenten

Gekozen stijl, toegepast op de hele app (team, freelancer, klant). Licht/Donker/Systeem blijft; stijl 2 is
het donkere thema. Opgeslagen themakeuzes blijven gelden. De merken Studio Brutaal en Moviemates
(logo en accentkleur in **Instellingen › Merken**) blijven ongewijzigd op de klantpagina's.

| Gebruik | Donker (stijl 2) | Contrast |
|---|---|---|
| Achtergrond | `#0B1424` | — |
| Panelen | `#14233A` | — |
| Verhoogd / geselecteerd | `#1C304C` | — |
| Primaire knoppen | `#2563EB`, witte tekst | 5,2 : 1 |
| Links, focus, selectie | `#7BB4FF` | 8,6 : 1 op de achtergrond |
| Hoofdtekst | `#E6EEF9` | 15,8 : 1 |
| Secundaire tekst | `#B5C8E1` | 10,8 : 1 |
| Rustige hulptekst | `#8FA5C2` | ≥ 5,3 : 1, ook op verhoogde vlakken |
| Lijnen | `#29415F` | — |

Hoeken 8–12 px. Kleur alleen voor belangrijke acties en statussen; “Nog niet verstuurd” blijft neutraal,
rood alleen voor fouten. Het lichte thema gebruikt dezelfde opbouw (lichte vlakken, donkerblauwe
selectie `#1D4ED8`). Contrast wordt in de browsertest `test:browser:ui` gemeten (≥ 4,5 : 1).

### Wat er verplaatst of veranderd is

| Was (0.7.0) | Wordt (0.8.0) |
|---|---|
| Zijbalk links met menu, zoeken en profiel | **Bovenbalk**: links Studio Brutaal · Studio Review; midden Dashboard, Projecten, Klanten, Inbox, Mijn taken; rechts compact zoeken (⌘K/Ctrl+K), Instellingen (tandwiel) en het profielmenu |
| Versienummer en systeemstatus onderaan de zijbalk | Klein **onderaan elke pagina** (en zoals altijd in Instellingen › Opslag & back-ups) |
| Knop **Opdrachten** in de zijbalk | Het toetsenbordlabel in het zoekveld (of ⌘K / Ctrl+K) |
| Projectkop: titel met knoppen | **Kleine omslag** links, naam, klant en aantallen ernaast, **Vastzetten** bij de titel; rechts **Personen**, **Delen**, **Nieuwe video** en **⋯** (met **Omslag wijzigen…**) |
| Videolijst op de projectpagina | **Grote voorvertoning** van de gekozen video met samenvatting (status, versie, wat de klant ziet, **Video openen**); daaronder kaarten met een blauwe selectierand, of de **lijst** (schakelaar rechts; de lijst groepeert per type zoals voorheen). De keuze staat in de adresbalk (`?video=…`) |
| Titel wijzigen met het potloodje in de rij | **⋯** bij de video → **Titel wijzigen…** (ook in de werkplek bij de titel) |
| Projectenoverzicht met kleine kaarten | **Grote omslagen**, ster om vast te zetten, zoeken, filters en kaart/lijst |
| Dashboard: Mijn taken, Nieuwe feedback, Wacht op klant, Recente projecten | Nieuw standaard: **Aandacht nodig**, **Vastgezet**, **Inbox**, **Bij de klant**. Wie het dashboard al had aangepast, houdt die indeling; de nieuwe blokken zijn toe te voegen via **Dashboard aanpassen** |
| Freelancerstart: lijst met projecten | Zelfde lijst met **omslag** (alleen uit gedeelde versies) en **ster** |
| Klantportaal | Zelfde volgorde (Jouw acties · Bij Studio Brutaal · Goedgekeurd (ingeklapt) · Definitieve bestanden). In het ingeklapte **Alle projecten en video’s** nu een kleine omslag en een ster om een project in **deze browser** vast te zetten |
| Klantreview op mobiel | Vaste actiebalk onderaan (Feedback versturen · Deze versie goedkeuren); de balk wijkt zolang je typt en er is onderaan ruimte gereserveerd, zodat hij nooit reacties of invoer afdekt |

### Omslag (cover) van een project

- **Automatisch** (standaard, ook voor bestaande projecten zonder iets in te stellen): de thumbnail van de
  hoofdvideo, anders van de video met de meest recente activiteit.
- **Omslag wijzigen…** (Projectleider of beheerder): kies de thumbnail van een andere video, of een
  **frame** uit een video (pauzeer op het beeld en sla op), of zet terug op **Automatisch**.
- Een omslag is een aparte projectkeuze: video's, thumbnails, titels en bestanden veranderen niet en er
  wordt niets opnieuw verwerkt.
- Klanten en freelancers krijgen alleen beeld uit versies die met hen gedeeld zijn; is de gekozen bron
  intern, dan zien zij de automatische keuze uit gedeelde versies (of niets).
- Ophalen loopt via afgeschermde adressen per publiek. Verdwijnt de bron (versie of video in de
  prullenbak), dan valt de omslag terug op automatisch.
- Een eigen frame is een los bestand (`cover-<project>-….jpg`) en gaat mee in opslagbeheer, back-up en
  herstel.

### Vastzetten

- Ster bij een project (projectenoverzicht, projectpagina, freelancerstart). Alleen voor jezelf; anderen
  merken er niets van. Vastgezette projecten staan bovenaan het overzicht en in het dashboardblok
  **Vastgezet**. Blijft bewaard na herladen, opnieuw inloggen, een update en back-up/herstel.
- Vastzetten geeft nooit toegang. Freelancers kunnen alleen projecten vastzetten waar hun koppeling nu
  geldt; verloopt die, dan verdwijnt het project ook uit hun favorieten.
- Klanten (optioneel, zonder account): een ster in **Alle projecten en video’s**, alleen in die browser.
  De acties bovenaan blijven altijd boven vastgezette projecten.

### Niet toegevoegd (bewust)

Hervatten vanaf de laatst bekeken plek, verwerking pauzeren en “Bekijk als freelancer” (voorstellen
43–45) zijn niet gebouwd.

## Bouwronde 6: ontwerpregels, inventarisatie en plek van iedere functie

### Ontwerpregels (bouwronde 6; kleuren vervangen door stijl 2)

- Elk scherm heeft één doel en één hoofdactie (primaire knop; sinds 0.8.0 blauw). Veelgebruikte acties staan
  direct in beeld; zeldzamere onder een logisch genoemd menu (**Delen**, **⋯**) of in de opdrachtbalk.
- Lijsten zijn regels met een lijn ertussen, geen losse kaders. Secties hebben een stevige lijn erboven.
  Kaders alleen nog voor invoervelden, keuzes in dialogen, scrollvakken en de speler.
- Kleur alleen waar het iets betekent: status (altijd met pictogram én tekst) en het merk van de
  klantweergave. In de werkplek is de video het grootste element.
- Eén typografie (zware koppen, rustige lopende tekst), vaste afstanden, knoppen van 32–40 px hoog,
  menu-items van minstens 36 px, zichtbare toetsenbordfocus, voldoende contrast in licht en donker.
- Formulieren kort; extra opties pas na een keuze (bijv. "Tijdelijke toegang" → datum, "Beantwoorden" →
  antwoordveld).
- Thema: Licht, Donker of Systeem, klein in het profielmenu (team) en rechtsboven (klant).
- Niets alleen bij hover zichtbaar (hernoemen staat sinds 0.8.0 in het ⋯-menu van elke video).

## Huisstijl Studio Brutaal: wat is gebruikt en wat ontbreekt

- **Bronnen die zijn gebruikt:** de briefing ("direct, zelfverzekerd, creatief, professioneel; Lef loont")
  en wat al in de app stond (merken in Instellingen › Merken met logo en accentkleur per merk).
- **Niet bereikbaar:** www.studiobrutaal.nl was vanuit de bouwomgeving geblokkeerd (netwerkbeleid);
  er zijn geen logo-, lettertype- of kleurbestanden van Studio Brutaal aangeleverd.
- **Daarom:** er zijn **geen** huisstijlkleuren of -lettertypen verzonnen. De teamomgeving is neutraal
  zwart-wit met sterke koppen (sinds 0.8.0: stijl 2, nachtblauw). De accentkleuren van de standaardmerken (`#ff6a3d` voor Studio Brutaal en
  `#38c6b8` voor Moviemates) zijn **plaatshouders** uit een eerdere ronde, geen huisstijlafspraken; pas ze
  aan in **Instellingen › Merken** en upload daar het echte logo.
- **Klaar voor de echte huisstijl:** `public/shared/huisstijl.css` is de plek voor lettertypen
  (`--font-display`, `--font`) en eventueel een accentkleur; de studionaam voor klanten ("Bij Studio
  Brutaal") is instelbaar (instelling `studio_name`).

## Schermen: doel, hoofdactie en waar alles staat

| Scherm | Doel | Hoofdactie | Verder |
|---|---|---|---|
| Dashboard `/` | Wat vraagt nu aandacht | — (blokken met directe links) | Dashboard aanpassen (blokken kiezen en ordenen) |
| Projecten `/projecten` | Project vinden | **Nieuw project** (beheerder) | Zoeken, filters, sortering; links naar Archief en Prullenbak |
| Project `/projecten/:id` | Video's van dit project | **Nieuwe video** | **Delen** (klantportaal, opleverlink, klantweergave, vraag aan klant, klant en klanttoegang); **⋯** (feedback exporteren, klantweergave, **Personen en toegang**, project bewerken, archiveren, prullenbak); **Personen** in de kopregel; Volgen; tabbladen Video's · Feedback (met *Vragen aan de klant*) · Briefing · Oplevering · Activiteit |
| Werkplek `/video/:id` | Video bekijken en feedback verwerken | Volgende stap in de statusregel (klaarzetten, publiceren, nieuwe versie, vrijgeven) | Versiekeuze, **Delen**, ⋯ (nieuwe versie, vergelijken, download, export, status corrigeren, archiveren, prullenbak); paneel Reacties · Versies · Info (eigenschappen, **vragen aan de klant**, rondes, geschiedenis) |
| Klanten `/klanten`, klant `/klanten/:id` | Klant en zijn portaal beheren | **Project koppelen** / **Nieuwe link** | Klanttoegang per project, beveiliging per link, bewerken |
| Inbox `/inbox` | Persoonlijke meldingen | Openen | Alles gelezen, meldingsvoorkeuren, browsermeldingen |
| Mijn taken `/taken` | Eigen feedbacktaken | Openen | Filters |
| Zoeken `/zoeken` | Alles terugvinden | — | Opgeslagen zoekopdrachten; snel zoeken met `/` of de opdrachtbalk |
| Instellingen | Account, team, merken, opslag, archief, prullenbak | per onderdeel | Team & rechten met **rechtenmatrix** en melding over omgezette rechten |
| Inloggen | Inloggen | **Inloggen** | — |
| Klantstartpagina `/k/…`, `/p/…` | Wat de klant nu moet doen | Eerste actie onder **Jouw acties** | Bij Studio Brutaal · Goedgekeurd (ingeklapt) · Beantwoorde vragen (ingeklapt) · Definitieve bestanden · Alle projecten en video's (ingeklapt) |
| Klantreview `/r/…` | Video bekijken en reageren | **Feedback versturen** / **Deze versie goedkeuren** (alleen akkoordgever) | Vorige/volgende (via portaal), NL/EN, thema, export |
| Opleverpagina | Definitieve bestanden downloaden | **Alles downloaden** | Per bestand downloaden |
| Freelancer `/`, `/projecten/:id`, `/video/:id` | Klantfeedback bekijken | — (alleen lezen) | Inbox, Mijn account, opdrachtbalk |

## Nieuw in bouwronde 6: waar staat wat

| Functie | Plek |
|---|---|
| Rollen (Projectleider, Editor, Meekijker, Freelancer) en rechtenmatrix | **Instellingen › Team & rechten**; uitleg in [ROLLEN.md](ROLLEN.md) |
| Persoon toevoegen aan een project, rol en tijdelijke toegang | Project → **Personen** (kopregel) of **⋯ › Personen en toegang…**; per account ook via Team & rechten › **Projecten** |
| Verlengen, nu intrekken, ontkoppelen | In dezelfde lijst, menu **⋯** bij de persoon |
| Freelanceromgeving | Automatisch na inloggen met een freelanceraccount |
| Vraag aan klant | Project → **Delen › Vraag aan klant…** of tab **Feedback**; werkplek → **Info › Vragen aan de klant**; klant: **Jouw acties** |
| Opdrachtbalk | **⌘K** (Mac) of **Ctrl+K**; ook de knop **Opdrachten** in de zijbalk |
| Identieke upload | Melding in het uploadpaneel rechtsonder: Bestaande openen · Annuleren · Toch uploaden |
| Klantstartpagina in vaste volgorde | Klantportaal en projectlink |

## Behouden (ongewijzigd in gedrag)

Automatische statuswijzigingen bij klantacties en handmatige correctie met reden per versie; eenvoudig
goedkeuren en apart definitief vrijgeven; inbox en optionele browsermeldingen; originele bestandsnamen in
downloads en ZIP's; automatische en handmatige kwaliteit met afspeelversies; versies vergelijken,
tekeningen, tijdsbereiken, reviewrondes, exports; wachtwoorden, vervaldatums en ingetrokken links;
klantactiviteit, merken, briefing, opslag, archief en prullenbak; back-up en herstel (klantlinks standaard
ongeldig na herstel); dashboard- en themavoorkeuren van elk account.

## Eerdere herinrichting (bouwronde 5): inventarisatie en nieuwe plek van iedere functie

Uitgangspunt: alle bestaande functies blijven bestaan en bereikbaar. Oude adressen (`/team`, `/merken`,
`/opslag`, `/prullenbak`, `/archief`, `/taken`, `/projecten/...`, `/video/...`) blijven werken.

## Hoofdnavigatie (zijbalk)

| Was (0.5.1) | Wordt |
|---|---|
| Projecten (startpagina `/`) | **Dashboard** is de startpagina `/`; **Projecten** staat op `/projecten` |
| — | **Klanten** (`/klanten`, nieuw: klant → projecten → portaal) |
| — | **Inbox** (`/inbox`, nieuw: persoonlijke meldingen) |
| Mijn taken | **Mijn taken**: vaste plek direct onder de hoofdnavigatie, met teller |
| Archief | Projecten › tabblad **Archief** (en `/archief` blijft werken) |
| Prullenbak | **Instellingen › Prullenbak** (en `/prullenbak` blijft werken); link onderaan Projecten |
| Team & rechten / Mijn account | **Instellingen › Team & rechten** / **Instellingen › Mijn account** |
| Merken | **Instellingen › Merken** |
| Opslag & back-ups (incl. bewaartermijn klantactiviteit) | **Instellingen › Opslag & back-ups** |
| Recente projecten in de zijbalk | Dashboardblok **Recente projecten** (zijbalk wordt rustiger) |
| Systeemstatus, versienummer | Onderaan de zijbalk (klein), details in Instellingen › Opslag & back-ups |
| Uitloggen (pictogram) | **Profielmenu** (naam onderaan): Thema (Licht/Donker/Systeem), Meldingen, Instellingen, Uitloggen |
| Uploadwachtrij | Ongewijzigd (rechtsonder), ook als dashboardblok **Uploads en verwerking** |
| — | **Zoeken** bovenaan de zijbalk (sneltoets `/`), resultatenpagina `/zoeken` |

## Projectpagina

| Was | Wordt |
|---|---|
| Kopknoppen: ⋯ (bewerken, archiveren, prullenbak), Exporteren, Klantweergave, Klantportaal, Nieuwe video | **Nieuwe video** (primair) en **Delen** (projectlink/klantportaal, opleverlink, klantweergave); de rest onder één menu **⋯**: Exporteren, Klantweergave, Project bewerken, Archiveren, Naar prullenbak |
| Tabbladen Video’s · Feedback & taken · Briefing & referenties · Oplevering · Klantactiviteit | Kortere tabbladen: **Video’s · Feedback · Briefing · Oplevering · Activiteit** (Activiteit alleen met publicatierechten) |
| Videolijst met zoeken, filters, hernoemen, archiveren, prullenbak, slepen om te uploaden | Ongewijzigd, met minder statuslabels per rij |

## Videowerkplek

| Was | Wordt |
|---|---|
| Kop: titel, gegevens (type/verhouding/kanaal), intern/klant/opgeleverd/rondes, versiekeuze, Nieuwe versie, Vergelijken, Klantweergave, Delen, Meer | Kop: titel + één regel met versie en status; rechts **versiekeuze**, **volgende stap** (primaire knop) en **Delen**; menu **⋯** met Nieuwe versie, Vergelijken, Klantweergave, Download, Feedback exporteren, Status corrigeren, Archiveren, Naar prullenbak |
| Publiceerbalk met uitleg en volgende stap | Smalle statusregel onder de kop met dezelfde uitleg; de knop van de volgende stap staat ook in de kop |
| Speler | Krijgt de meeste ruimte (smaller zijpaneel) |
| Zijpaneel: Reacties · Versies · Rondes · Geschiedenis | **Reacties · Versies · Info**; Info bevat in vaste secties: Eigenschappen (type, verhouding, kanaal, afgesproken rondes, bestand, thumbnail), Rondes, Geschiedenis |
| Bestandsnaam/grootte onder de speler | Info › Eigenschappen |

## Overige schermen
- Vergelijken, Mijn taken, Feedback & taken, Briefing, Oplevering, Klantactiviteit, Prullenbak, Archief, Merken, Team, Opslag: functioneel ongewijzigd, rustiger opgemaakt.
- Klantpagina’s (review, projectportaal, opleverpagina): bestaande functies ongewijzigd; erbij gekomen in fase B: klantportaal per klant (`/k/…`), NL/EN-schakelaar rechtsboven, vorige/volgende onder de kop (alleen via een portaal), wachtwoordscherm en “geldig tot …” onderaan.

## Fase B: waar staat wat
| Functie | Plek |
|---|---|
| Klanten aanmaken, bewerken, verwijderen | **Klanten** in het hoofdmenu (alleen beheerders maken en bewerken) |
| Project aan klant koppelen | Klantpagina → **Project koppelen**, of project → **Delen → Klant en klanttoegang…** (recht Beheren) |
| Klanttoegang Actief / Afgerond / Uit | Klantpagina (per project) of **Delen → Klant en klanttoegang…**; bij “uit” een melding bovenaan het project |
| Klantportaallink (algemeen of persoonlijk voor akkoordgever) | Klantpagina → **Klantportaal → Nieuwe link** (beheerders) |
| Wachtwoord en vervaldatum | Knop **Beveiliging** bij elke link: Delen bij de video (review/akkoord), Delen → Klantportaal (projectlink), Oplevering (opleverlink), klantpagina (klantportaallink) |
| Taal van de klantweergave | Klant bewerken (standaardtaal); de kijker kan zelf wisselen (NL/EN) |
| Goedkeuren | Persoonlijke portaallink → video → **Deze versie goedkeuren** → één bevestiging. Losse akkoordlinks werken zoals voorheen. |

Bestaande project-, review-, akkoord- en opleverlinks houden hun bereik; een losse reviewlink krijgt geen vorige/volgende.

## Fase C: waar staat wat
| Functie | Plek |
|---|---|
| Inbox (taken, @vermeldingen, antwoorden, klantfeedback, goedkeuringen, opleveringen) | **Inbox** in het hoofdmenu, met teller ongelezen |
| Meldingsvoorkeuren en browsermeldingen | Onderaan de inbox, kaart **Meldingen** |
| Project volgen | Knop **Volgen** in de projectkop (automatisch na project maken, uploaden of publiceren) |
| Gesprek niet meer volgen | Knop bij de melding in de inbox |
| Klantactiviteit als tijdlijn (signalen + formele feedback/goedkeuring) | Project → **Activiteit**; teambezoeken via “Eigen teambezoeken tonen” |

### Onderzoek klantactiviteit (onderdeel 12)
- **Vastleggen**: de server legt geopend (portaal, review, oplevering), downloadverzoek en (via de browser) afspelen gestart vast. Werkt zoals bedoeld.
- **Waarom het team soms “niets” zag**: een bezoek van een ingelogd teamlid via een klantlink werd tot nu toe helemaal niet vastgelegd. Wie zelf testte in dezelfde browser waarin hij is ingelogd, zag dus een leeg overzicht. Nu: vastgelegd als *teambezoek*, apart gemarkeerd en standaard verborgen, met teller en uitleg.
- **Ontdubbelen**: per link, soort, video en versie telt een gebeurtenis binnen 30 minuten (download 5) één keer. Twee echte klanten die dezelfde link binnen dat venster gebruiken, worden zo samengevoegd; dat staat nu expliciet in de uitleg. Teambezoeken worden apart ontdubbeld en drukken nooit een klantbezoek weg.
- **Formele acties** (feedback verstuurd, goedkeuring) stonden niet in het overzicht. Nu wel, rechtstreeks uit hun eigen registratie (niets nagemaakt), en ze vallen niet onder de bewaartermijn van signalen.
- **Zichtbaarheid**: het overzicht ververst elke 30 seconden zolang het openstaat; actieve filters staan als chips boven de lijst.

## Nieuw per fase
- **A**: dashboard (persoonlijk, aanpasbaar), globaal zoeken met opgeslagen zoekopdrachten, thema, originele bestandsnamen bij downloads, handmatige thumbnail.
- **B**: klanten en klantportaal, eenvoudiger goedkeuren via persoonlijke portaallink, NL/EN, vorige/volgende, wachtwoord en vervaldatum op links.
- **C**: inbox en meldingen, klantactiviteit als duidelijke tijdlijn.
- **D**: adaptieve videokwaliteit, downloadrechten, opleverpakketten als ZIP.

## Fase D: waar staat wat
| Functie | Plek |
|---|---|
| Kwaliteit kiezen (Auto, 4K, 1440p, 1080p, 720p; alleen wat de bron heeft) | Tandwiel in de spelerbalk (team en klant); het label toont wat er echt speelt |
| Status van de afspeelversies, voortgang, opnieuw proberen | Videowerkplek → **Info** → “Afspeelversies” |
| Ruimte van afspeelversies | Instellingen → Opslag & back-ups (totaal) en Info per versie |
| Downloadrecht per reviewlink | Delen bij de video (“Klant mag het bestand downloaden”, standaard uit) |
| Alles als ZIP | Opleverpagina van de klant (“Alles downloaden”) en Project → Oplevering (“Alles als ZIP”) |
