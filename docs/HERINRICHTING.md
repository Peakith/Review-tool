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
- Klantpagina’s (review, projectportaal, opleverpagina): ongewijzigde functies; in fase B komen klantportaal per klant, taalkeuze en vorige/volgende erbij.

## Nieuw per fase
- **A**: dashboard (persoonlijk, aanpasbaar), globaal zoeken met opgeslagen zoekopdrachten, thema, originele bestandsnamen bij downloads, handmatige thumbnail.
- **B**: klanten en klantportaal, eenvoudiger goedkeuren via persoonlijke portaallink, NL/EN, vorige/volgende, wachtwoord en vervaldatum op links.
- **C**: inbox en meldingen, klantactiviteit als duidelijke tijdlijn.
- **D**: adaptieve videokwaliteit, downloadrechten, opleverpakketten als ZIP.
