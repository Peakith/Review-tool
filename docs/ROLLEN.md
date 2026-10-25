# Rollen en rechten (vanaf 0.7.0)

Iedereen met een account is **beheerder**, **teamlid** of **freelancer**. Teamleden en freelancers zien
alleen projecten waaraan ze expliciet zijn gekoppeld. Per project hebben ze één rol. Een rol in het ene
project geeft niets in een ander project, en nooit toegang tot de beheerschermen.

Klanten hebben geen account. Ze werken via hun eigen links (klantportaal, projectlink, review- en
akkoordlink, opleverlink). Goedkeuren blijft per video, en alleen voor de aangewezen akkoordgever
(persoonlijke link).

## Rechtenmatrix

| Mag | Beheerder | Projectleider | Editor | Meekijker | Freelancer |
|---|---|---|---|---|---|
| Projecten en video's bekijken | alle | toegewezen | toegewezen | toegewezen | alleen gepubliceerde versies |
| Interne notities, taken en ongepubliceerde versies zien | ✓ | ✓ | ✓ | ✓ | — |
| Klantfeedback met tijdcodes, bereiken en tekeningen | ✓ | ✓ | ✓ | ✓ | ✓ (alleen lezen, alleen verstuurde feedback) |
| Reageren, feedback afhandelen, feedbacktaken | ✓ | ✓ | ✓ | — | — |
| Uploaden, nieuwe versies, titels en gegevens wijzigen | ✓ | ✓ | ✓ | — | — |
| Originelen en feedbackexports downloaden | ✓ | ✓ | ✓ | ✓ | — |
| Publiceren, klantlinks maken en beheren, akkoordgever | ✓ | ✓ | — | — | — |
| Vraag aan klant stellen of intrekken | ✓ | ✓ | — | — | — |
| Definitief opleveren, status corrigeren, archiveren, prullenbak | ✓ | ✓ | — | — | — |
| Personen aan het project koppelen (rol, einddatum) | ✓ | ✓ (bestaande accounts) | — | — | — |
| Accounts maken, merken, opslag, back-ups, definitief verwijderen | ✓ | — | — | — | — |
| Eigen inbox, voorkeuren, thema en wachtwoord | ✓ | ✓ | ✓ | ✓ | ✓ (alleen meldingen over klantfeedback) |

Technisch: Projectleider = niveau `manage`, Editor = `upload`, Meekijker = `read`, Freelancer = `feedback`.
De oude niveaus `view` en `publish` bestaan alleen nog als ze vóór de update zo waren opgeslagen; ze
worden bij de update omgezet (zie hieronder).

## Freelancer: strikt alleen-lezen

- Ziet in gekoppelde projecten alleen wat de klant ook ziet: gepubliceerde versies (afspeelversie, nooit
  het origineel), de thumbnail, en verstuurde klantfeedback met tijdcodes, bereiken en tekeningen.
  Zichtbare antwoorden van het team aan de klant staan erbij; interne notities, interne antwoorden,
  taken, afhandelstatus en concepten van de klant niet.
- Eigen eenvoudige omgeving: **Mijn projecten**, **Inbox** (alleen meldingen over verstuurde
  klantfeedback) en **Mijn account** (thema, wachtwoord). Geen bewerkknoppen.
- Alle andere teamroutes zijn op de server dicht voor een freelanceraccount (ook zoeken, aantallen,
  thumbnails, media, exports, klantgegevens en directe API-verzoeken). Ook een oude, hogere
  projectkoppeling geeft een freelanceraccount niet meer dan "Freelancer".
- Er is geen schakelaar om een freelancer toch te laten uploaden of reageren. Moet iemand meer doen,
  maak het account dan bewust **teamlid** (Team & rechten › ⋯ › Teamlid maken); de koppelingen beginnen
  dan als Meekijker.

## Tijdelijke toegang

- Elke projectkoppeling kan een eigen einddatum en -tijd hebben (getoond met tijdzone).
- De server controleert de einddatum bij **elk** verzoek. Na het verstrijken of intrekken: geen toegang
  meer tot feedback, thumbnails of afspeelversies; het project verdwijnt uit overzichten, zoeken en de
  inbox; er komen geen nieuwe meldingen; een open pagina toont bij verversen of het volgende verzoek
  "Je toegang tot dit project is verlopen". Video- en goedkeuringsstatus veranderen niet.
- Verlengen, nu intrekken en ontkoppelen kan via het project (**Personen**) of Team & rechten. Het
  verlopen van één koppeling raakt andere projecten niet. Reacties, feedback en geschiedenis blijven.
- Koppelingen en einddatums zitten in back-ups. Een einddatum is een vast moment: wat bij het
  terugzetten al verstreken is, blijft verstreken.

## Overstap vanaf 0.6.0

Bij de eerste start van 0.7.0 worden bestaande koppelingen omgezet, zonder dat iemand er rechten bij krijgt:

| Was | Wordt | Wat verandert |
|---|---|---|
| Beheren | Projectleider | niets |
| Publiceren en delen | Editor | publiceren en delen vervalt |
| Uploaden | Editor | niets |
| Bekijken en reageren | Meekijker | reageren en afhandelen vervalt; toegewezen taken worden losgekoppeld (met toelichting) |

Beheerders blijven beheerder. Er blijft altijd minstens één actieve beheerder (degraderen of uitschakelen
van de laatste wordt geweigerd). Wie er een recht heeft verloren, staat in een melding bovenaan
**Instellingen › Team & rechten**; geef daar of via **Personen** in het project bewust de juiste rol.
