# Herinrichting (bouwronde 6): ontwerpregels, inventarisatie en plek van iedere functie

Alle bestaande functies blijven bestaan en vindbaar; oude adressen blijven werken. Rollen en rechten:
[ROLLEN.md](ROLLEN.md).

## Ontwerpregels (gelden voor elk scherm)

- Elk scherm heeft één doel en één hoofdactie (primaire knop in inktkleur). Veelgebruikte acties staan
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
- Niets alleen bij hover zichtbaar (de hernoemknop bij video's staat er nu altijd).

## Huisstijl Studio Brutaal: wat is gebruikt en wat ontbreekt

- **Bronnen die zijn gebruikt:** de briefing ("direct, zelfverzekerd, creatief, professioneel; Lef loont")
  en wat al in de app stond (merken in Instellingen › Merken met logo en accentkleur per merk).
- **Niet bereikbaar:** www.studiobrutaal.nl was vanuit de bouwomgeving geblokkeerd (netwerkbeleid);
  er zijn geen logo-, lettertype- of kleurbestanden van Studio Brutaal aangeleverd.
- **Daarom:** er zijn **geen** huisstijlkleuren of -lettertypen verzonnen. De teamomgeving is neutraal
  zwart-wit met sterke koppen. De accentkleuren van de standaardmerken (`#ff6a3d` voor Studio Brutaal en
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
