# Herinrichting (bouwronde 5): inventarisatie en nieuwe plek van iedere functie

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
