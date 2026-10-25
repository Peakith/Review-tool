# Acceptatietest: volledige flow

Duur: ± 20 minuten. Gebruik **een aparte gegevensmap**, zodat je eigen projecten onaangeroerd blijven:

```bash
DATA_DIR=./data-test PORT=3001 SETUP_TOKEN=acceptatietest-12345678 npm start
```
Open daarna `http://localhost:3001/?setup=acceptatietest-12345678`. Gooi `data-test/` na afloop weg.

Je hebt twee browservensters nodig: één voor het **team** en een privévenster voor de **klant**. Gebruik twee echte exports (H.264/AAC MP4) als versie 1 en versie 2. Vink elke stap af; een ✗ met een korte notitie is het nuttigst.

## A. Team: van leeg account tot gedeelde video
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 1 | Maak het eerste account aan via de installatielink. | Je ziet "Begin met je eerste project": een korte uitleg en één knop. Nergens staat losse tekst zoals "null". | ☐ |
| 2 | **Eerste project aanmaken** → "Acceptatietest", klant "Testklant". | Je komt in het lege project met een grote sleepzone. | ☐ |
| 3 | Sleep `export_v01.mp4` in de sleepzone (of klik erop). | Rechtsonder het uploadpaneel met voortgang, daarna "Bestand wordt gecontroleerd" en dan "Klaar". De video staat in de lijst met thumbnail, duur, "Intern v1 · Concept" en "Nog niet gedeeld". | ☐ |
| 4 | Klik bij de video op **⋯ › Titel wijzigen…**, typ "Campagnefilm — Hoofdvideo" en klik **Opslaan**. | De titel is aangepast, zonder ".mp4". | ☐ |
| 5 | Open de video. Klik in de statusbalk op **Klaar voor review**, daarna op **Publiceren naar klant** en bevestig. | De statusbalk toont "In review". In de kop staat "Klant ziet: Versie 1". | ☐ |
| 6 | **Delen** → kopieer de **reviewlink**. Vul bij **Akkoordlink** naam en e-mail in → **Akkoordgever opslaan** → **Persoonlijke akkoordlink maken**. | Het venster legt het verschil uit: de reviewlink "kan niet goedkeuren", en alleen met de akkoordlink kan worden goedgekeurd. | ☐ |
| 7 | **⋯ › Download Versie 1**. | Het bestand heet zoals je het uploadde (`export_v01.mp4`), ook al heb je de titel gewijzigd, en speelt lokaal af. | ☐ |

## B. Klant: reviewen (privévenster, liefst ook op je telefoon)
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 8 | Open de reviewlink. | Titel, "Versie 1 · nieuwste" en "Klaar voor jouw review". Geen login nodig. Er is geen goedkeurknop. | ☐ |
| 9 | Speel af, controleer het geluid, spoel via de tijdlijn naar het midden en test volledig scherm. | Beeld en geluid lopen; na vooruitspoelen speelt de video vanaf het nieuwe punt verder. | ☐ |
| 10 | Vul je naam in. Spoel naar ± 0:10, klik in het invoerveld en plaats een reactie. Herhaal op ± 0:20. | Het invoerveld toont "Bij 0:10" (en daarna 0:20). Beide reacties staan als "Nog niet verstuurd", met markeringen op de tijdlijn. De onderbalk toont "2 reacties nog niet verstuurd". | ☐ |
| 11 | Klik op de tijdcode van de eerste reactie. | De video springt naar ± 0:10. | ☐ |
| 12 | Ververs het teamvenster. | Status is **nog steeds In review**: een losse reactie verandert niets. | ☐ |
| 13 | Klant: **Feedback versturen (2)**, eventueel met een toelichting, en bevestig. | Groene bevestiging "Je feedback is verstuurd". De status wordt "Feedback verstuurd" en de reacties tonen "Verstuurd als feedback". | ☐ |

## C. Team: verwerken en versie 2
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 14 | Team: ververs. | In het projectoverzicht staat "Feedback binnen". De statusbalk van de video toont "Feedback ontvangen" met naam en datum. | ☐ |
| 15 | Beantwoord de eerste reactie en klik **Afhandelen**. | Het antwoord is zichtbaar, de reactie staat op "Afgehandeld" en de status blijft **Aanpassingen nodig**. | ☐ |
| 16 | **Nieuwe versie** → kies `export_v02.mp4` → **Uploaden als Versie 2**. | Het venster legt uit: blijft intern, klanten blijven Versie 1 zien. Na de upload staat Versie 2 op "Concept" en toont de kop "Klant ziet: Versie 1". | ☐ |
| 17 | Klant: ververs. | Nog steeds **Versie 1**, zonder versiekeuze. | ☐ |
| 18 | Team: **Klaar voor review** → **Publiceren naar klant**. Klant: ververs. | Dezelfde link toont **Versie 2 · nieuwste**, In review en niet goedgekeurd. Via de versiekeuze is Versie 1 nog te zien, met de feedback (alleen-lezen). | ☐ |

## D. Akkoordgever: goedkeuren
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 19 | Open de **akkoordlink** (liefst op je telefoon). | "Je reviewt als <naam>, Aangewezen akkoordgever". Onderin staan "Feedback versturen" en "Deze versie goedkeuren". | ☐ |
| 20 | **Deze versie goedkeuren** → **Ja, keur Versie 2 goed**. | Groene bevestiging, status **Goedgekeurd** met naam, datum en tijd. | ☐ |
| 21 | Team: ververs. | De statusbalk toont "Goedgekeurd door <naam>". Onder Versies staat v1 op "Aanpassingen nodig" en v2 op "Goedgekeurd". | ☐ |
| 22 | **Status van Versie 2 corrigeren** → kies "In review" en klik zonder reden op opslaan. Vul daarna een reden in. | Zonder reden lukt het niet. Met reden wordt de correctie opgeslagen; onder **Geschiedenis** staat "Reden: …" met jouw naam. | ☐ |

## E. Toegang intrekken
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 23 | **Delen** → prullenbak bij de reviewlink → **Intrekken**. Klant: ververs. | "Deze link werkt niet meer". Ook de video zelf laadt niet meer. | ☐ |
| 24 | Wijzig de akkoordgever in het deelvenster. Open de oude akkoordlink. | Ook de oude akkoordlink is ingetrokken. | ☐ |

---

## F. Startknop, gegevens en beheer (op je eigen Mac)
Deze punten zijn **niet op een echte Mac getest**: de start- en stopknop zijn alleen op Linux getest. Doe ze daarom zelf, en volg voor de eerste keer **[UPDATEN.md](UPDATEN.md)**.

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 25 | Dubbelklik `Start Studio Review.command` in de nieuwe map. | macOS vraagt eenmalig om toestemming (zie de README). Daarna opent Terminal, de controles staan op ✓, de vraag om gegevens over te nemen verschijnt, en de browser opent vanzelf. | ☐ |
| 26 | Log in. | Je bestaande projecten, video's, reacties en klantlinks zijn er allemaal. Onderaan de pagina staat "Studio Review 0.8.0 (build …)". | ☐ |
| 27 | Dubbelklik nog eens op de startknop. | Er start niets nieuws; de bestaande sessie opent in de browser. | ☐ |
| 28 | **Instellingen › Opslag & back-ups › Nu back-up maken.** | De back-up krijgt "compleet en gecontroleerd", met de juiste aantallen en in een map onder `~/Studio Review/backups`. | ☐ |
| 29 | **Instellingen › Team & rechten** → voeg een freelancer toe met toegang "Bekijken en reageren" tot één project. Log in als freelancer (privévenster). | De freelancer ziet alleen dat project, kan reageren, maar ziet geen upload-, deel- of publiceerknoppen. | ☐ |
| 30 | Gooi als beheerder een testvideo in de prullenbak en open de klantlink ervan. | De klant krijgt "niet meer beschikbaar". Na **Instellingen › Prullenbak › Terugzetten** werkt de link weer. | ☐ |
| 31 | Dubbelklik `Stop Studio Review.command`. | De melding "Studio Review is gestopt. Je gegevens zijn bewaard." verschijnt, en het startvenster stopt. | ☐ |
| 32 | Start opnieuw en ververs een tabblad dat nog openstond. | De pagina werkt direct, zonder harde verversing of het legen van de cache. | ☐ |

## G. Klantportaal, merk en briefing (bouwronde 2)
Doe dit eerst zelf op je Mac. Wil je het portaal op een tweede apparaat of telefoon testen, dan werkt de localhost-link daar niet (zie README).

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 33 | **Instellingen › Merken** → upload een logo voor Moviemates en pas eventueel de kleur aan. | Het voorbeeld rechts toont direct logo, kleur en knop. | ☐ |
| 34 | **⋯ › Project bewerken** → kies het merk Moviemates en schrijf een korte introductie. | Bij het project staat een kleurstip met “Moviemates”. | ☐ |
| 35 | Geef bij een video **Gegevens → Invullen**: type “Social”, kanaal “Instagram Reels”. | De projectpagina in de **lijstweergave** groepeert per type; bij de video staat “Social · 9:16 · Instagram Reels”. | ☐ |
| 36 | Tabblad **Briefing**: voeg een tekst toe, een link en een PDF. Deel alleen de link. | Alles staat eerst onder “Alleen intern”; de link verhuist naar “Zichtbaar voor de klant”. | ☐ |
| 37 | **Delen › Klantportaal (projectlink) → Projectlink maken** en open de link in een privévenster (Safari én Chrome). | Je ziet logo, introductie, alleen gepubliceerde video’s met de gepubliceerde versie, en alleen de gedeelde link. Geen interne PDF, geen concepten, geen goedkeurknop. | ☐ |
| 38 | Open in het portaal een video, plaats een reactie en verstuur feedback. Ga terug naar het overzicht. | De video staat onder “Feedback verstuurd”. Interne teamnotities zijn niet zichtbaar. | ☐ |
| 39 | Upload een nieuwe versie (niet publiceren) en ververs het portaal. | Het portaal toont nog de vorige versie en status. Pas na **Publiceren naar klant** verschijnt de nieuwe versie. | ☐ |
| 40 | **Delen › Klantweergave bekijken** op de projectpagina. | Exact dezelfde video’s en briefing als in het privévenster, met een paarse voorbeeldbalk. | ☐ |
| 41 | **Delen › Klantportaal → Intrekken**. Ververs het privévenster. | “Deze link werkt niet meer”. Een afzonderlijke reviewlink van een video werkt nog wel. | ☐ |
| 42 | Herhaal 37–38 op je iPhone of Android-telefoon (alleen mogelijk met een bereikbaar adres; lokaal kan dat nog niet). | Kaarten onder elkaar, verticale video’s passen in beeld, knoppen zijn goed te raken. | ☐ |

## H. Feedback verwerken, rondes, tekenen, vergelijken en export (bouwronde 3, ± 20 min)
Gebruik een testproject, of een aparte gegevensmap (zie boven). Doe de klantstappen in een privévenster, liefst in Safari én Chrome.

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 43 | **⋯ › Project bewerken** → afgesproken rondes: 2. | Opgeslagen. In de werkplek staat bij een video “2 afgesproken per video”. | ☐ |
| 44 | Publiceer een video: kies **Ronde 1 starten**, vul een deadline in (datum + tijd) en een toelichting. | Onder het tijdveld staat de datum uitgeschreven, met tijdzone. In de werkplek onder **Info › Reviewrondes** staat ronde 1 met die deadline. | ☐ |
| 45 | Klant: open de link. | Je ziet “Reviewronde 1 · graag je reactie vóór …” en de toelichting. | ☐ |
| 46 | Klant: pauzeer, klik **Tekenen**, zet een rechthoek en een pijl, typ een tekst en plaats de reactie. | De reactie heeft het label “Tekening”. Een klik toont de tekening op het stilstaande beeld. | ☐ |
| 47 | Klant: klik **Bereik**, speel een paar seconden verder, klik **Eind hier**, typ en plaats de reactie. Klik daarna op **Fragment afspelen**. | Het tijdcodelabel toont bijvoorbeeld “0:04–0:07”. Op de tijdlijn staat een balk. Het fragment stopt aan het einde. | ☐ |
| 48 | Klant: verstuur de feedback. Team: open de tekening in de werkplek, ook in volledig scherm en in een kleiner venster. | De tekening staat steeds op dezelfde plek in het beeld. | ☐ |
| 49 | Team: **Taak maken** op een klantreactie: kies een collega, prioriteit hoog en een deadline. | Op de reactie staat een taaklabel. Het project toont het onder **Feedback**. | ☐ |
| 50 | Log in als die collega → **Mijn taken** → **Bezig** → **Afgehandeld**. | De reactie is afgehandeld. De status van de video blijft “Aanpassingen nodig”. | ☐ |
| 51 | Upload v2 en publiceer: kies **Ronde 2 starten** en vul in wat er is aangepast. Doe hetzelfde nog eens met v3 (ronde 3). | Bij ronde 3 waarschuwt het venster dat dit boven de afspraak is. Publiceren lukt gewoon. De klant ziet “Aangepast in versie 3”. | ☐ |
| 52 | Werkplek → **⋯ › Vergelijken**. Speel af, zet het geluid op A, schuif B +1 s, en zet de koppeling los. | A en B lopen gelijk. De verschuiving werkt. De kortere versie meldt “Einde van deze versie”. Los heeft elke versie zijn eigen bediening. | ☐ |
| 53 | Project → **⋯ › Feedback exporteren** → PDF, zonder interne gegevens. Open het bestand. | Je ziet het merk, versie, ronde, tijdcodes, antwoorden en de tekening op het videobeeld. Er staat niets interns in. | ☐ |
| 54 | **⋯ › Feedback exporteren** → CSV, met “Interne notities en taakgegevens” aan. Open het bestand in Numbers of Excel. | De bestandsnaam eindigt op “INTERN”. €, ë en meerregelige tekst staan goed. Een reactie die met “=” begint, wordt niet uitgerekend. | ☐ |
| 55 | Geef een collega geen toegang meer tot het project (**Instellingen › Team & rechten**). | Zijn taak staat op “niet toegewezen”, met de uitleg waarom. | ☐ |

## I. Definitieve oplevering en klantactiviteit (bouwronde 4, ± 15 min)
Gebruik een testproject. Doe de klantstappen in een privévenster (niet ingelogd), liefst in Safari én Chrome. Alles werkt lokaal: de links zijn alleen op je eigen Mac te openen.

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 56 | Laat de akkoordgever (privévenster, akkoordlink) versie 1 goedkeuren. Team: open de video. | In de statusbalk staat **Definitief vrijgeven…**. | ☐ |
| 57 | Zet bij een andere video de status handmatig op Goedgekeurd (Status van Versie 1 corrigeren). Open **Oplevering › Bestanden vrijgeven…**. | Die video kan niet worden gekozen; de uitleg zegt dat een statuslabel geen klantgoedkeuring vervangt. | ☐ |
| 58 | Kies versie 1 → **Overzicht bekijken** → **Vrijgeven**. Vul een oplevertekst in en sla op. Maak een **opleverlink**. | Het overzicht toont bestandsnaam, formaat en grootte. De rij staat op “Beschikbaar voor de klant”. | ☐ |
| 59 | Privévenster: open de opleverlink en klik **Downloaden**. | Merk, oplevertekst, thumbnail, type/kanaal, MP4 + grootte, versie, datum. Het bestand heet zoals het is geüpload (bijv. `export_v01.mp4`) en speelt af in QuickTime. | ☐ |
| 60 | Team: upload een nieuwe versie (concept). | Onder Oplevering staat “Er is een nieuwere versie…”. De klant ziet en downloadt nog steeds versie 1. | ☐ |
| 61 | Publiceer v2, laat hem goedkeuren, en klik bij de oplevering **Vervangen…**. Probeer eerst zonder het vinkje. | Zonder vinkje gebeurt niets. Met vinkje ziet de klant versie 2; de geschiedenis toont “vervangen”. | ☐ |
| 62 | Corrigeer de status van v2 naar “Aanpassingen nodig”. Ververs de opleverpagina van de klant. | Team: “Geblokkeerd”. Klant: “Tijdelijk niet beschikbaar”, geen downloadknop. | ☐ |
| 63 | **Terugnemen…** met een reden. Daarna de opleverlink **Intrekken…**. | Het intrekvenster noemt welke andere links nog toegang geven. De klant ziet eerst een lege pagina, daarna “Deze link werkt niet meer”. | ☐ |
| 64 | Open het klantportaal (projectlink) in het privévenster. | Na een nieuwe vrijgave staat bovenaan de kaart “Definitieve bestanden”. | ☐ |
| 65 | Team: tab **Activiteit**. Filter op “Download aangevraagd” en op een video. | Je ziet je klantstappen met tijd (met tijdzone), video, versie en “Via opleverlink” / “Via akkoordlink van …”, plus verstuurde feedback en goedkeuringen als “formeel”. Je eigen bezoeken als ingelogd teamlid staan er alleen bij als je “Eigen teambezoeken tonen” aanvinkt. | ☐ |
| 66 | **Instellingen › Opslag & back-ups** → Klantactiviteit bewaren: zet 30 dagen en sla op. | Opgeslagen. Goedkeuringen en geschiedenis blijven staan. | ☐ |
| 66a | Werkplek van een video waarvan v1 is opgeleverd en v2 bestaat: open v2 → **Status van Versie 2 corrigeren**. | Het venster zegt “alleen voor Versie 2” en “De definitieve oplevering is Versie 1”. Na opslaan blijft de opleverpagina v1 tonen en downloaden. | ☐ |
| 67 | Op een iPhone (alleen met een bereikbaar adres): open een video met een tekening en tik op volledig scherm. | Een korte uitleg met **Groot in de pagina (met tekeningen)**. Daarin staat de tekening op de juiste plek. *Nog niet op een echte iPhone getest.* | ☐ |

## J. Back-up terugzetten en klantlinks (± 10 min, alleen met testgegevens)
Gebruik de aparte testgegevensmap (zie boven), nooit je echte gegevens.

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 68 | Maak een back-up. Trek daarna een reviewlink in. Stop de app en voer `npm run herstel` uit; kies die back-up. | Vóór het terugzetten zie je het aantal review-, akkoord-, project-, oplever- en klantportaallinks en de keuze; 1 (veilig) is de standaard. | ☐ |
| 69 | Kies 1 (Enter) en bevestig. Start de app. | Bovenaan: “Alle … klantlinks zijn ongeldig gemaakt”. Elke oude klantlink toont “ingetrokken”. Goedkeuringen, reacties en opleveringen zijn er nog. | ☐ |
| 70 | Maak een nieuwe reviewlink, projectlink en opleverlink en open ze in een privévenster. | Ze werken. | ☐ |
| 71 | (Optioneel) Herhaal 68 en kies 2. | Eerst een extra waarschuwing. Daarna werkt ook de reviewlink die je na de back-up had ingetrokken weer, en de melding in de app is rood. | ☐ |

## K. Bouwronde 5: rustiger werken, klanten, inbox, kwaliteit en ZIP (± 30 min, op je Mac)
Gebruik de aparte testgegevensmap. Doe klantstappen in een privévenster, in **Safari én Chrome**: Safari is in deze ronde niet getest (alleen Chrome en Pixel 7-emulatie). De links werken alleen op je eigen Mac (localhost).

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 72 | Log in. | Links: **Dashboard, Projecten, Klanten, Inbox**, daaronder **Mijn taken**; onderaan **Instellingen**. Het dashboard toont vier blokken. | ☐ |
| 73 | **Dashboard aanpassen**: voeg “Opslag” toe, maak “Recente projecten” breed, verplaats een blok met de pijltjes, klik **Klaar**, ververs. | De indeling blijft bewaard. Buiten de aanpasmodus zie je geen bewerkknoppen. | ☐ |
| 74 | Profielmenu (je naam linksonder) → **Licht**, daarna **Systeem**. | Het thema wisselt direct en blijft na verversen staan. | ☐ |
| 75 | Typ in het zoekveld (of druk op `/`) een woord uit een klantreactie. Kies het resultaat. | De juiste video en versie openen, met de reactie geselecteerd. | ☐ |
| 76 | Werkplek → **Info** → pauzeer op een mooi beeld → **Huidig frame gebruiken**. | Projectoverzicht en klantportaal tonen dat frame (volledige beeldverhouding). **Automatisch** zet het terug. | ☐ |
| 77 | **Klanten → Nieuwe klant** “Testklant”, standaardtaal Engels. **Project koppelen** → kies je testproject. Zet een tweede project op **Afgerond**. | De klantnaam bij een project koppelt niets vanzelf; alleen wat je kiest staat bij de klant. | ☐ |
| 78 | **Klantportaal → Nieuwe link** (algemeen) en een tweede: **Persoonlijk voor een akkoordgever**, met precies het e-mailadres van de akkoordgever van een video. | Twee links; de persoonlijke heeft het label “akkoordgever” en een localhost-waarschuwing. | ☐ |
| 79 | Privévenster: open de algemene link. | Engels (standaardtaal), met NL/EN rechtsboven. Actieve projecten open, het afgeronde project ingeklapt. Geen goedkeurknop. Wissel naar NL: titels en reacties blijven zoals ze zijn. | ☐ |
| 80 | Open een video, typ een reactie (niet plaatsen) en klik **Volgende video**. | Eerst de vraag “Pagina verlaten?”. **Blijven** laat je tekst staan. | ☐ |
| 81 | Privévenster 2: open de persoonlijke link → de video van die akkoordgever → **Deze versie goedkeuren**. | Eén korte bevestiging met videotitel en exacte versie. Daarna “Goedgekeurd door …”. Bij een video met een andere akkoordgever is er geen goedkeurknop. | ☐ |
| 82 | Team: corrigeer de status van die versie terug naar In review. Akkoordgever: ververs. | Een duidelijke melding “Eerdere goedkeuring ingetrokken” met wie, wanneer en wat nu; opnieuw goedkeuren kan. | ☐ |
| 83 | **Beveiliging** bij de algemene link: wachtwoord en een vervaldatum. Ververs het privévenster. | Wachtwoordscherm. Verkeerd wachtwoord: duidelijke melding. Juist: portaal open, onderaan “geldig tot …” met tijdzone. | ☐ |
| 84 | Zet bij het project **Klanttoegang uit** (Delen › Klant en klanttoegang). Ververs het privévenster op een video. | “Tijdelijk niet beschikbaar”; ook oude review- en opleverlinks werken niet. Weer **Actief**: de links werken weer, behalve een link die je los had ingetrokken. | ☐ |
| 85 | Klik bij het project op **Volgen** (als je het niet al volgt). Laat de klant feedback versturen. | **Inbox** toont “… stuurde feedback op …” met een teller in de zijbalk. Klik erop: de juiste video en versie openen. | ☐ |
| 86 | Inbox → **Meldingen inschakelen** en sta toe. Zet het tabblad op de achtergrond en laat een collega je een taak geven. | Een melding van de browser (alleen zolang het tabblad openstaat en de app draait). Sluit je het tabblad, dan zie je hem later gewoon in de inbox. *Niet op een Mac getest.* | ☐ |
| 87 | Upload een **4K-export**. Kijk in de werkplek onder **Info › Afspeelversies**. | Voortgang (“wordt gemaakt: …%”), daarna “4K, 1440p, 1080p, 720p · … MB”. Een 1080p-export krijgt alleen 1080p en 720p. | ☐ |
| 88 | Klant (reviewlink zonder download): tandwiel in de speler. Kies 720p tijdens het afspelen, daarna Auto. | Alleen niveaus die de bron heeft. Wisselen zonder sprong in tijd of geluid; het label toont wat er echt speelt. Rechtsklik op de video geeft geen “Video opslaan als”. | ☐ |
| 89 | Klant: probeer de downloadknop. Maak daarna een reviewlink **met** download. | Zonder downloadrecht: geen knop. Met: wel, onder de oorspronkelijke bestandsnaam. | ☐ |
| 90 | Geef twee goedgekeurde versies vrij (Oplevering). Opleverpagina klant → **Alles downloaden (ZIP)**. Open de ZIP met dubbelklik in de Finder. | De browser toont de voortgang. In de ZIP: de bestanden onder hun oorspronkelijke naam (dubbele namen elk in een eigen map) en `Overzicht.txt`. *Uitpakken met Archiefhulpprogramma is niet op een Mac getest.* | ☐ |
| 91 | Op je iPhone of in Safari: open een reviewlink en kies een kwaliteit. | Speelt af (Safari gebruikt zijn eigen HLS). *Niet getest: meld wat je ziet.* | ☐ |

## L. Bouwronde 6: vormgeving, rollen, freelancer, klantvragen, ⌘K (± 25 min, op je Mac)
Gebruik de aparte testgegevensmap, met **twee projecten** (A en B, elk met een gedeelde video) en
**twee extra accounts** die je in stap 92 maakt. Gebruik voor elk account een eigen browservenster
(of een privévenster). Safari, een echte iPhone en macOS-systeemmeldingen zijn in deze ronde **niet**
getest (alleen Chrome op Linux en Pixel 7-emulatie): meld wat je ziet.

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 92 | **Instellingen › Team & rechten › Account toevoegen**: “Eddy Editor” (Teamlid) en “Fien Freelancer” (Freelancer). Bij Fien: project A → **Freelancer**, met een einddatum over 10 minuten. | Onder **Rollen en rechten** staat de rechtenmatrix. Fien staat er met “Project A (freelancer, tijdelijk)”. | ☐ |
| 93 | Open project A → **Personen** → **Persoon toevoegen** → kies Eddy → rol **Editor** → Toevoegen. | Eddy staat in de lijst als Editor; beheerders staan apart als “altijd toegang”. De rol staat standaard op Meekijker tot je hem kiest. | ☐ |
| 94 | Log in als Eddy. | Alleen project A is zichtbaar. Project B via de adresbalk: “Niet gevonden”. Eddy kan reageren en uploaden in A, maar ziet geen **Delen**. | ☐ |
| 95 | Log in als Fien. | Eigen eenvoudige omgeving: **Klantfeedback** met alleen project A, “Toegang tot … CET/CEST”. Bij de video: alleen gepubliceerde versie en verstuurde klantfeedback (met tijdcodes, fragmenten en tekeningen), geen invoerveld, geen interne notities. | ☐ |
| 96 | Als Fien: druk **⌘K** en typ een woord uit de titel van een video in project B. | Geen resultaat uit B. Acties alleen: Mijn projecten, Inbox, Mijn account. **Esc** sluit. | ☐ |
| 97 | Wacht tot Fiens einddatum voorbij is (of trek de toegang in via **Personen › ⋯ › Toegang nu intrekken**). Ververs bij Fien de videopagina. | “Je toegang tot dit project is verlopen”. Op de startpagina is project A verdwenen. Bij het team blijft de status van de video ongewijzigd. | ☐ |
| 98 | Als beheerder in project A: **Delen › Vraag aan klant…** → kies de video → “Klopt de naam in de eindtitel?” → Vraag delen met klant. | De vraag staat onder **Feedback › Vragen aan de klant** als **Open**. | ☐ |
| 99 | Privévenster: open het klantportaal van de klant van project A. | Bovenaan “Er staan … video’s voor je klaar. En 1 vraag van het team.” Dan **Jouw acties** (met de vraag), **Bij Studio Brutaal**, **Goedgekeurd** (ingeklapt) en **Definitieve bestanden** (alleen als er iets is vrijgegeven). | ☐ |
| 100 | Klik bij de vraag **Beantwoorden**, typ een antwoord en je naam, klik twee keer snel op **Antwoord versturen**. | Eén antwoord, onder **Beantwoorde vragen** met “(naam zelf ingevuld)”. Het team krijgt één melding in de inbox. De status van de video verandert niet. | ☐ |
| 101 | Upload in project A hetzelfde bestand nog eens, maar hernoem het eerst in de Finder. Upload tegelijk een ander bestand. | Bij het hernoemde bestand: “Dit bestand staat al in dit project als …, versie …” met **Bestaande openen**, **Annuleren** en **Toch uploaden**. Het andere bestand gaat gewoon door. **Annuleren** laat niets achter; **Toch uploaden** maakt een gewone nieuwe video met de nieuwe bestandsnaam. | ☐ |
| 102 | Druk **⌘K** in een project, typ “upload”, kies **Video’s uploaden naar dit project** met de pijltjes en Enter. | De bestandskiezer opent (dezelfde als via de knop). | ☐ |
| 103 | Wissel het thema (profielmenu) tussen Licht en Donker en bekijk een project, de werkplek en het klantportaal. Maak het venster ook smal (zoals een telefoon); een echte telefoon kan de links nog niet openen (alleen localhost). | Alles leesbaar in beide thema’s; het merk van de klant (logo, kleur) blijft zichtbaar. | ☐ |

## M. Korte Mac-test 0.8.0: stijl 2, omslag, vastzetten (± 10 min)
Doe dit na de update (zie [UPDATEN.md](UPDATEN.md)) eerst met je **echte** installatie alleen kijkend
(stap 104–105), en de rest bij voorkeur met de aparte testgegevensmap. Gemaakt en getest met Chrome op
Linux en Pixel 7-emulatie; **niet** in Safari, niet op jouw Mac en niet op een echte telefoon.

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 104 | Start met `Start Studio Review.command` en ververs een tabblad dat nog openstond. | Nachtblauwe app met het menu **bovenaan**; onderaan de pagina “Studio Review 0.8.0 (build …)”. Je projecten, thema en (eventueel aangepaste) dashboardindeling zijn er nog. | ☐ |
| 105 | Open een bestaand project. | Links een kleine **omslag** (automatisch gekozen), naam, klant en aantallen, rechts Personen · Delen · Nieuwe video · ⋯. Daaronder de tabbladen en een grote voorvertoning van één video met status, versie en **Video openen**. Er speelt niets vanzelf. | ☐ |
| 106 | Klik op afspelen in de voorvertoning, en kies tijdens het afspelen een andere kaart. | Het geluid stopt meteen; de voorvertoning toont de gekozen video (titel en versie kloppen). De status van beide video's is ongewijzigd. Een staande video is helemaal zichtbaar. | ☐ |
| 107 | **Omslag wijzigen** (op de omslag of via ⋯) → kies de thumbnail van een andere video → Omslag opslaan. Daarna nogmaals → **Automatisch**. | De omslag verandert in het project, in **Projecten** en (als vastgezet) op het dashboard. De thumbnail en titel van de video zelf blijven gelijk. Automatisch zet hem terug. | ☐ |
| 108 | Klik de **ster** bij een project in **Projecten**. Herlaad; log uit en weer in. | Het project staat bovenaan en in het dashboardblok **Vastgezet**, ook na herladen en opnieuw inloggen. Een ander account ziet het niet als vastgezet. | ☐ |
| 109 | Open als klant het klantportaal (privévenster) en klap **Alle projecten en video’s** open. Klik een ster en herlaad. | **Jouw acties** staat bovenaan; kleine omslagen alleen in het ingeklapte overzicht; het vastgezette project staat daar bovenaan (alleen in deze browser). | ☐ |
| 110 | Maak het klantvenster smal (zoals een telefoon), open een video, klik in het reactieveld en typ. | De actiebalk onderaan (Feedback versturen · Deze versie goedkeuren) verdwijnt zolang je typt en komt daarna terug; hij dekt nooit de laatste reactie af. | ☐ |
| 111 | Wissel in het profielmenu tussen Licht, Donker en Systeem. | Alles blijft leesbaar; de keuze blijft na herladen bewaard. | ☐ |

## Handmatige browsertestlijst
Automatisch getest (`npm run test:browser`, zie de PR): **Chrome 141 desktop (Linux, headless)** en **Chrome 141 met Pixel 7-emulatie**. Al het andere moet nog met de hand. Voer per browser minstens stappen 8–11, 13, 19–20 en 7 uit.

| Browser / apparaat | Afspelen + geluid | Vooruitspoelen | Volledig scherm | Reactie op tijdstip | Feedback / goedkeuren | Downloadnaam | Slepen om te uploaden |
|---|---|---|---|---|---|---|---|
| Safari (macOS) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Chrome (macOS) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Safari (iPhone) | ☐ | ☐ | ☐ (native speler) | ☐ | ☐ | n.v.t. | n.v.t. |
| Chrome (Android, echt toestel) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | n.v.t. |
| Firefox / Edge | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

Let extra op in **iOS Safari**:
- volledig scherm opent de native speler;
- het toetsenbord mag het invoerveld en de onderbalk niet afdekken;
- de onderbalk moet boven de home-indicator staan.
