# Studio Review bijwerken (ZIP-installatie op de Mac)

Vanaf versie 0.2.0 staan programma en gegevens los van elkaar:

- **Programma**: de uitgepakte map. Bij elke update komt er een nieuwe.
- **Gegevens**: `~/Studio Review/` met daarin `gegevens/`, `backups/` en `instellingen.env`. Deze map blijft gewoon staan.

## Van 0.8.0 naar 0.9.0 (bouwronde 8: vaste donkere stijl, rustiger, klantportaal)

Alleen een nieuwe programmamap. Je gegevens in `~/Studio Review` (of je eigen `DATA_DIR`) blijven
staan. Accounts, rollen, klantlinks, feedback, goedkeuringen, opleveringen, covers, vastgezette
projecten, back-ups en je dashboardindeling blijven werken. Een gewone update maakt **geen** klantlinks ongeldig.

1. **Maak eerst een back-up en controleer hem:** **Instellingen › Opslag & back-ups › Nu back-up maken**
   (in 0.8.0 via het tandwiel rechtsboven). Wacht tot er bij de nieuwe back-up “compleet en gecontroleerd” staat.
2. **Stop de app:** dubbelklik `Stop Studio Review.command` in de map van 0.8.0.
3. **Pak de nieuwe ZIP uit in een nieuwe map.** Laat de map van 0.8.0 staan.
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.**
5. **Ververs** een openstaand tabblad in je gewone browser. De app is direct donker, ook als hij eerder
   op Licht stond, en onderaan staat **Studio Review 0.9.0 (build …)**.

**Internet bij het installeren (eerlijk):** geen nieuwe npm-onderdelen ten opzichte van 0.8.0. De
startknop haalt de bestaande onderdelen uit de npm-cache op je Mac (`~/.npm`). In de test (Linux, zonder
netwerk, vanaf 0.8.0) werkte dat. Is die cache leeg, dan is er bij de eerste start **wel internet nodig**,
of kopieer `node_modules` uit de map van 0.8.0. Node.js en ffmpeg moeten al geïnstalleerd zijn. Niet op
jouw Mac getest.

**Wat er bij de eerste start gebeurt:** niets wordt omgezet of opnieuw verwerkt. Een bewaarde themakeuze
wordt genegeerd en opgeruimd zodra je je voorkeuren opnieuw opslaat. In de browser gebeurt dat bij het
eerste bezoek.

**Wat je direct merkt:** vaste donkere stijl; **Instellingen** staat in het profielmenu; het klantportaal
begint met **Jouw acties**; in de klantreview heet de knop **Goedkeuren**. Alles wat verplaatst is:
[docs/HERINRICHTING.md](docs/HERINRICHTING.md).

**Terug naar 0.8.0?** Stop 0.9.0, zet de back-up van stap 1 terug met `npm run herstel` in de **nieuwe**
map (klantlinks uit de back-up worden dan standaard ongeldig) en start de map van 0.8.0. Niet apart getest.

## Van 0.7.0 naar 0.8.0 (bouwronde 7: stijl 2 nachtblauw, omslagen, vastzetten)

Weer alleen een nieuwe programmamap; je gegevens in `~/Studio Review` (of je eigen `DATA_DIR`) blijven
staan. Accounts, rollen, klantlinks, feedback, goedkeuringen, opleveringen, back-ups en je voorkeuren
(thema en dashboardindeling) blijven werken. Een gewone update maakt geen klantlinks ongeldig.

1. **Maak eerst een back-up en controleer hem:** **Instellingen › Opslag & back-ups › Nu back-up maken**.
   Wacht tot er bij de nieuwe back-up “compleet en gecontroleerd” staat.
2. **Stop de app:** dubbelklik `Stop Studio Review.command` in de map van 0.7.0.
3. **Pak de nieuwe ZIP uit in een nieuwe map.** Laat de map van 0.7.0 staan.
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.**
5. **Controleer:** ververs een openstaand tabblad (gewoon verversen is genoeg; de nieuwe bestanden komen
   van een nieuw adres). Je ziet nu de **bovenbalk** en onderaan de pagina **Studio Review 0.8.0 (build …)**.
   Open een project en een klantlink in een privévenster.

**Internet bij het installeren (eerlijk):** 0.8.0 heeft **geen nieuwe npm-onderdelen** ten opzichte van
0.7.0. De startknop installeert de bestaande onderdelen bij de eerste start in de nieuwe map uit de
npm-cache op je Mac (`~/.npm`). In de test (Linux, zonder netwerk, vanaf 0.7.0) werkte dat. Is die cache
leeg, dan is er bij de eerste start **wel internet nodig**, of kopieer `node_modules` uit de map van
0.7.0. Node.js en ffmpeg moeten al geïnstalleerd zijn. Dit is **niet** op jouw Mac getest.

**Wat er bij de eerste start gebeurt**
- De database krijgt een paar extra kolommen (omslag per project) en een tabel voor vastgezette
  projecten. Er wordt niets omgezet of opnieuw verwerkt; bestaande projecten krijgen vanzelf een
  automatische omslag.

**Wat je direct merkt**
- Stijl 2 (nachtblauw met blauwe accenten) in de hele app; Licht en Systeem blijven beschikbaar.
- Het menu staat **bovenaan**; versie en systeemstatus staan klein onderaan de pagina.
- Projectpagina met omslag, voorvertoning en kaarten; **titel wijzigen** zit nu in het **⋯**-menu van
  een video. Zie [docs/HERINRICHTING.md](docs/HERINRICHTING.md) voor alles wat verplaatst is.
- Nieuw: **Omslag wijzigen…** (Projectleider/beheerder) en de **ster** om projecten voor jezelf vast te
  zetten.
- Dashboard: wie het nooit had aangepast, krijgt de nieuwe standaard (Aandacht nodig · Vastgezet · Inbox
  · Bij de klant). Had je het aangepast, dan blijft jouw indeling; voeg de nieuwe blokken toe via
  **Dashboard aanpassen**.

**Terug naar 0.7.0?** Stop 0.8.0, zet de back-up van stap 1 terug met `npm run herstel` in de **nieuwe**
map (klantlinks uit de back-up worden dan standaard ongeldig) en start daarna de map van 0.7.0. Dat
teruggaan zelf is in deze ronde niet apart getest; 0.7.0 rechtstreeks starten op gegevens van 0.8.0 ook
niet. Omslagen en vastgezette projecten die je na de update instelde, zitten niet in die back-up.

## Van 0.6.0 naar 0.7.0 (bouwronde 6: nieuwe vormgeving, rollen, freelancers, klantvragen, ⌘K)

Weer alleen een nieuwe programmamap; je gegevens in `~/Studio Review` blijven staan, en je accounts,
klantlinks, feedback, goedkeuringen, opleveringen en back-ups blijven werken.

1. **Maak eerst een back-up en controleer hem:** **Instellingen › Opslag & back-ups › Nu back-up maken**.
   Wacht tot er bij de nieuwe back-up “compleet en gecontroleerd” staat. Ga niet verder zonder.
2. **Stop de app:** dubbelklik `Stop Studio Review.command` in de map van 0.6.0.
3. **Pak de nieuwe ZIP uit in een nieuwe map.** Laat de map van 0.6.0 staan (die heb je nodig als je
   terug wilt).
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.**
5. **Controleer:** ververs een openstaand tabblad; onderin de zijbalk staat **Studio Review 0.7.0**. Open
   een project en een video, en open één klantlink in een privévenster.

**Internet bij het installeren (eerlijk):** 0.7.0 heeft **geen nieuwe npm-onderdelen** ten opzichte van
0.6.0 (zelfde express en pdfkit; de videospeler hls.js zit in de ZIP). De startknop installeert die
onderdelen bij de eerste start in de nieuwe map, uit de npm-cache op je Mac (`~/.npm`) als ze daar staan.
Dat werkte in de test zonder netwerk vanaf 0.6.0. Is die cache leeg (bijvoorbeeld op een andere Mac of na
opschonen), dan is er bij de eerste start **wel internet nodig**, of kopieer `node_modules` uit de map
van 0.6.0. Node.js zelf en ffmpeg moeten al geïnstalleerd zijn; die zitten niet in de ZIP. Een
meegeleverde browserbibliotheek betekent dus niet dat een verse ZIP op elke Mac volledig offline
installeert.

**Wat er bij de eerste start gebeurt**
- **Rechten worden omgezet naar rollen**, zonder dat iemand er rechten bij krijgt: Beheren →
  Projectleider, Uploaden → Editor, Publiceren en delen → Editor (publiceren vervalt), Bekijken en
  reageren → Meekijker (reageren vervalt; toegewezen taken worden losgekoppeld met toelichting).
  Beheerders blijven beheerder. Bovenaan **Instellingen › Team & rechten** staat wie een recht verloor;
  geef daar of via **Personen** in het project bewust de juiste rol. Zie [docs/ROLLEN.md](docs/ROLLEN.md).
- Voor bestaande video's wordt op de achtergrond een inhoudscode (hash) berekend, één bestand tegelijk,
  zodat identieke uploads ook voor oudere bestanden worden herkend. Dat leest elk bestand één keer en
  kost bij veel materiaal even tijd; de app blijft bruikbaar.

**Wat je direct merkt**
- Nieuwe, rustigere vormgeving (zwart-wit, lijnen in plaats van kaders). Alles staat nog op dezelfde plek
  of is terug te vinden via [docs/HERINRICHTING.md](docs/HERINRICHTING.md). Je thema en dashboard blijven.
- Klanten zien op hun startpagina eerst **Jouw acties**, dan **Bij Studio Brutaal**, **Goedgekeurd**
  (ingeklapt) en **Definitieve bestanden**.
- Nieuw: **Personen** per project (met tijdelijke toegang), **freelanceraccounts** (alleen klantfeedback
  bekijken), **Vraag aan klant**, de **opdrachtbalk** (⌘K) en een melding bij **identieke uploads**.
- Huisstijl: er zijn geen huisstijlwaarden verzonnen. Pas logo en kleur aan in **Instellingen › Merken**
  (de standaardkleuren zijn plaatshouders) en, als je wilt, de studionaam die klanten zien.

**Let op:** de app blijft lokaal op je Mac. Klanten en freelancers kunnen nog **niet** van buiten je Mac
inloggen of links openen; de links beginnen met `localhost`.

**Terug naar 0.6.0?** Stop 0.7.0, zet de back-up van stap 1 terug met `npm run herstel` in de **nieuwe**
map (veilige standaard: klantlinks uit de back-up worden ongeldig), en start daarna de map van 0.6.0.
Start 0.6.0 **niet** zomaar op de gegevens van 0.7.0: dat is niet getest. 0.6.0 kent de rollen
Meekijker en Freelancer, de einddatums en de klantvragen niet; je kunt er dan niet op rekenen dat die
beperkingen nog gelden.

## Van 0.5.1 naar 0.6.0 (bouwronde 5: rustiger indeling, klanten, inbox, kwaliteit, ZIP)

Weer alleen een nieuwe programmamap; je gegevens in `~/Studio Review` blijven staan en je klantlinks blijven werken.

1. **Maak eerst een back-up:** **Opslag & back-ups › Nu back-up maken** (in 0.6.0 staat dat onder **Instellingen**). Wacht tot er “compleet en gecontroleerd” staat.
2. **Stop de app:** dubbelklik `Stop Studio Review.command`.
3. **Pak de nieuwe ZIP uit** in een nieuwe map. Laat de oude map nog staan.
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.** Er zijn **geen nieuwe npm-onderdelen**: de startknop haalt express en pdfkit uit de npm-cache op je Mac, zonder internet. *Getest zonder netwerk vanaf 0.5.1: start in ongeveer 1 seconde.* Is de cache leeg en is er geen internet, kopieer dan `node_modules` uit de map van 0.5.1 (zelfde onderdelen). De nieuwe videospeler (hls.js) zit al in de ZIP.
5. **Ververs een openstaand tabblad.** Onderin de zijbalk staat **Studio Review 0.6.0**.

**Wat je direct merkt**
- Nieuwe indeling: **Dashboard, Projecten, Klanten, Inbox** en **Mijn taken**. Team, Merken, Opslag, Archief en Prullenbak staan onder **Instellingen**. Oude adressen (zoals `/opslag`) werken nog. Waar elke functie nu staat: [docs/HERINRICHTING.md](docs/HERINRICHTING.md).
- **Afspeelversies worden op de achtergrond gemaakt**, ook voor al je bestaande video’s. Dat gebeurt één video tegelijk (gepubliceerde versies eerst) en kost tijd en ruimte (zie hieronder). De Mac blijft bruikbaar, maar de ventilator kan hoorbaar zijn.
- **Klantlinks zonder downloadrecht krijgen het originele bestand niet meer**, alleen de afspeelversies. Tot de eerste afspeelversie van een video klaar is, ziet de klant daar “wordt voorbereid”. Wil je dat een klant het origineel kan downloaden, maak dan een reviewlink met “Klant mag het bestand downloaden” (standaard uit). Opleverlinks blijven gewoon downloaden.
- Je eigen bezoeken aan klantlinks (ingelogd) staan nu als **teambezoek** in de activiteit, standaard verborgen.

**Ruimte en tijd voor afspeelversies (vuistregels, geen garantie)**
- Per video komen er bestanden bij: 720p ± 1,5–3,5 Mbit/s, 1080p ± 3–6, 1440p ± 6–10, 4K ± 10–20 Mbit/s (afhankelijk van het beeld). Een 4K-video van 1 minuut kost zo ± 150–300 MB extra; een 1080p-video van 1 minuut ± 35–70 MB.
- Rekentijd hangt af van je Mac: reken op een paar keer de speelduur voor 4K, minder voor lagere bronnen. Instellen in `instellingen.env`: `VARIANT_CONCURRENCY` (hoeveel tegelijk, standaard 1) en `VARIANT_PRESET` (`veryfast` standaard; `ultrafast` = sneller maar groter).
- Vóór elk niveau controleert de app de vrije ruimte (met `MIN_FREE_GB` als ondergrens). Is er te weinig, dan staat dat bij de versie onder **Info**, met **Opnieuw proberen**.
- Afspeelversies tellen mee in **Opslag & back-ups** (apart vermeld) en in back-ups, en verdwijnen bij definitief verwijderen.

**Terug naar 0.5.1?** Zet de back-up van stap 1 terug met `npm run herstel` in de **nieuwe** map (veilige standaard: klantlinks uit de back-up worden ongeldig) en start daarna de oude map. Start de oude versie **niet** zomaar op de gegevens van 0.6.0: dat is niet getest, en 0.5.1 kent geen wachtwoorden, vervaldatums of “Klanttoegang uit” op links, dus die bescherming zou dan niet meer werken.

## Van 0.4.0 naar 0.5.1 (bouwronde 4: definitieve opleveringen en klantactiviteit)

Weer alleen een nieuwe programmamap; je gegevens in `~/Studio Review` blijven staan, en je klantlinks blijven werken.

1. **Maak eerst een back-up:** **Opslag & back-ups › Nu back-up maken**. Wacht tot er “compleet en gecontroleerd” staat.
2. **Stop de app:** dubbelklik `Stop Studio Review.command`.
3. **Pak de nieuwe ZIP uit** in een nieuwe map. Laat de oude map nog staan.
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.** De eerste start installeert de onderdelen (express en pdfkit) in de nieuwe map:
   - **Normaal geen internet nodig:** deze onderdelen zijn bij de eerste start van 0.4.0 al gedownload en staan in de npm-cache op je Mac (`~/.npm`). De startknop haalt ze daar op. *Getest zonder netwerk: dit lukte in ongeveer 1 seconde.*
   - **Is de npm-cache leeg** (bijvoorbeeld opgeruimd), dan is internet nodig. Zonder internet stopt de startknop na ruim een minuut met de melding *Installeren is mislukt*. Je gegevens worden niet aangeraakt.
   - **Geen internet en lege cache?** Kopieer de map `node_modules` uit je vorige programmamap (0.4.0) naar de nieuwe map en start opnieuw. Dat kan bij deze update, omdat 0.4.0 en 0.5.1 precies dezelfde onderdelen gebruiken. *Getest zonder netwerk en zonder cache.*
5. **Ververs een openstaand tabblad.** Onderin de zijbalk staat dan **Studio Review 0.5.1**.
6. Open een project: er zijn twee nieuwe tabbladen, **Oplevering** en **Klantactiviteit**.

**Goed om te weten na deze update**
- Er wordt niets automatisch vrijgegeven. Bestaande goedkeuringen door de akkoordgever tellen wel: die versies kun je meteen bewust vrijgeven.
- Versies die alleen handmatig op Goedgekeurd zijn gezet, kunnen niet worden vrijgegeven; daarvoor is een goedkeuring via de akkoordlink nodig.
- Klantactiviteit wordt pas vanaf deze versie bijgehouden; er is geen activiteit van vóór de update.
- Bestaande links, reacties, rondes, taken, exports en het klantportaal werken ongewijzigd. Een ZIP-update raakt klantlinks nooit.
- Node.js (22.13 of nieuwer) en ffmpeg moeten al geïnstalleerd zijn, zoals bij 0.4.0.

**Een back-up terugzetten (`npm run herstel`) werkt vanaf deze versie anders voor klantlinks.**
- Een back-up weet niet welke links je ná het maken ervan hebt ingetrokken. Daarom vraagt de herstelopdracht vooraf wat er met klantlinks gebeurt, en toont hij hoeveel review-, akkoord-, project- en opleverlinks er in de back-up geldig zijn.
- **Standaard (veilig):** alle klantlinks worden ongeldig. Na het starten maak je nieuwe links aan (Delen bij de video, Klantportaal en Oplevering in het project) en deel je die opnieuw. Goedkeuringen, reacties, opleveringen en geschiedenis blijven volledig bewaard.
- **Alleen als je daar bewust voor kiest** (keuze 2, of `npm run herstel -- --links=herstellen`) gaan de links uit de back-up weer werken. Ook links die je later had ingetrokken, geven dan weer toegang.
- Na het starten staat bovenaan een melding met wat er met de links is gebeurd.

**Terug naar 0.4.0?** Stop de app. Zet de back-up van stap 1 terug met `npm run herstel` in de **nieuwe** map (die stelt de vraag over klantlinks) en start daarna de oude versie in de oude map. De herstelopdracht van 0.4.0 zelf kent die vraag niet en laat alle links uit de back-up weer werken.

## Van 0.3.0 naar 0.4.0 (bouwronde 3: taken, rondes, tekenen, vergelijken, export)

Hetzelfde als de vorige keer: alleen een nieuwe programmamap. Je gegevens in `~/Studio Review` blijven staan.

1. **Maak een back-up:** **Opslag & back-ups › Nu back-up maken**.
2. **Stop de app:** dubbelklik `Stop Studio Review.command`.
3. **Pak de nieuwe ZIP uit** in een nieuwe map.
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.**
   - De eerste start installeert de onderdelen, nu ook de PDF-bibliotheek. Daarvoor is één keer internet nodig.
   - Er wordt niets gevraagd over je gegevens.
5. **Ververs een openstaand tabblad.** Onderin de zijbalk staat dan **Studio Review 0.4.0**.
6. **Optioneel:** stel bij **Project bewerken** het afgesproken aantal reviewrondes per video in.

**Goed om te weten na deze update**
- Versies die al gedeeld waren, krijgen geen verzonnen reviewronde. Bij de volgende publicatie kies je *Ronde 1 starten*.
- Bestaande reacties, links, goedkeuringen en het klantportaal werken ongewijzigd.
- Taken en tekeningen zijn nieuw. Er wordt niets automatisch omgezet.

**Terug naar 0.3.0?** Stop de app, zet in de oude map de back-up van stap 1 terug met `npm run herstel`, en start de oude versie. Zonder herstel start 0.3.0 ook, maar die toont dan geen taken, rondes en tekeningen.

## Van 0.2.0 naar 0.3.0 (bouwronde 2: klantportaal, merken, briefing)

Je gegevens staan al in `~/Studio Review`. Bijwerken is daarom alleen een nieuwe programmamap.

1. **Maak een back-up:** **Opslag & back-ups › Nu back-up maken**. Wacht tot er *compleet en gecontroleerd* staat.
2. **Stop de app:** dubbelklik **`Stop Studio Review.command`** in je huidige programmamap, of sluit het startvenster.
3. **Pak de nieuwe ZIP uit in een nieuwe map** in Downloads. Bestaat de mapnaam al, dan zet macOS er “ 2” achter; dat is prima.
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.**
   - Weigert macOS het bestand, dan geldt hetzelfde als de vorige keer: rechtermuisknop › **Open**, of **Systeeminstellingen › Privacy en beveiliging › Toch openen**.
   - De eerste start installeert de onderdelen opnieuw. Er wordt niets gevraagd over je gegevens.
   - De database krijgt automatisch de nieuwe velden. Bestaande projecten, video's, links, reacties en goedkeuringen blijven werken.
5. **Ververs een openstaand tabblad** (Cmd + R). Onderin de zijbalk staat dan **Studio Review 0.3.0**.
6. **Controleer en richt in:**
   - **Merken:** upload eventueel de logo's van Studio Brutaal en Moviemates en controleer de kleuren.
   - **Per project:** kies bij **Project bewerken** een merk en schrijf eventueel een introductie.
   - **Wat de klant ziet:** bekijk het met **Klantweergave**.
7. Werkt alles, gooi dan de oude programmamap weg.

**Goed om te weten na deze update**
- Losse teamnotities die je vóór de update plaatste, zijn nu **intern**: de klant ziet ze niet meer. Antwoorden op klantreacties blijven zichtbaar.
- Wil je een oude notitie toch tonen, kies dan bij die reactie **Zichtbaar maken voor klant**.
- Projectlinks (klantportaal) beginnen lokaal met `http://localhost:3000`. Ze werken alleen op deze Mac en zijn nog niet bereikbaar voor klanten buiten je computer.

**Terug naar de vorige versie?**
1. Stop de app.
2. Zet in de oude programmamap de back-up van stap 1 terug met `npm run herstel`.
3. Start de oude versie weer.

De oude versie start ook zonder herstel op de bijgewerkte gegevens. Maar die kent de nieuwe functies niet en toont dan weer álle teamnotities aan klanten. Gebruik daarom het herstel.

## De eerste keer (van je huidige versie naar 0.2.0)

Je huidige versie staat in `~/Downloads/Review-tool-nieuw` en bewaart de gegevens nog in de map `data/` daarbinnen.

1. **Stop de huidige app.** Druk op **Ctrl + C** in het Terminal-venster waarin `npm start` draait, of sluit dat venster.
2. *(Extra zekerheid, aanbevolen)* Maak in Finder een kopie van `~/Downloads/Review-tool-nieuw/data`: klik met de rechtermuisknop en kies **Dupliceer**.
3. **Pak de nieuwe ZIP uit in Downloads**, in een **nieuwe** map, bijvoorbeeld `Review-tool-claude-gifted-cori-4qgyq3`. Overschrijf de oude map niet.
4. **Dubbelklik in de nieuwe map op `Start Studio Review.command`.**
   - Weigert macOS het bestand, volg dan de stappen onder *De eerste keer weigert macOS de startknop?* in de README:
     - rechtermuisknop › **Open**;
     - of **Systeeminstellingen › Privacy en beveiliging › Toch openen**.
   - De eerste start installeert automatisch de onderdelen. Dat duurt even.
5. **Het venster vraagt of het de gegevens mag overnemen:**
   ```
   ! Er zijn nog geen gegevens voor deze installatie, maar wel bij een eerdere versie:
     1. /Users/<jij>/Downloads/Review-tool-nieuw  (… account(s), … project(en), … video('s) …)
     Overnemen? (j/n)
   ```
   Typ **j** en druk op Enter.

   Wat er dan gebeurt:
   - eerst wordt een back-up van de database gemaakt;
   - daarna wordt alles naar `~/Studio Review/gegevens` gekopieerd en gecontroleerd (aantallen en een controlesom per video);
   - de oude map blijft onaangeroerd.
6. **De browser opent.** Log in zoals altijd en controleer je projecten, video's, reacties en een klantlink.
7. **Maak een eerste volledige back-up:** **Opslag & back-ups › Nu back-up maken**.
8. Had je in de oude map een `.env`, bijvoorbeeld met `FFPROBE_PATH`? Zet die regels dan in `~/Studio Review/instellingen.env`. Daar blijven ze bij updates bewaard.
9. Werkt alles een tijdje goed, dan kun je `~/Downloads/Review-tool-nieuw` weggooien.

**Ging er iets mis?**
- Er is dan niets gewijzigd aan de oude map. Je kunt de oude versie gewoon weer starten met `npm start` in de oude map. Wijzigingen die je in de nieuwe versie hebt gemaakt, staan daar niet in.
- Het venster meldt het als het overnemen mislukt. De app start dan niet, zodat je niet per ongeluk in een lege installatie belandt.

## Volgende updates (vanaf 0.2.0)

1. Stop de app: dubbelklik **`Stop Studio Review.command`**, of sluit het startvenster.
2. Pak de nieuwe ZIP uit in een nieuwe map.
3. Dubbelklik in de nieuwe map op **`Start Studio Review.command`**. Er wordt niets gevraagd: je gegevens staan al in `~/Studio Review`.
4. Ververs een openstaand browsertabblad gewoon (Cmd + R). Je ziet direct de nieuwe versie; het versienummer staat onderin de zijbalk.
5. Gooi de oude programmamap weg.

Een back-up vlak voor een update is nooit verkeerd: **Opslag & back-ups › Nu back-up maken** (of `npm run backup`).

## Handig om te weten
- Wil je niet bij elke update een nieuwe map? Dat kan ook. Vervang dan de inhoud van de programmamap met de app gestopt, want de gegevens staan er niet meer in.
- Werk je vanuit Git (ontwikkelen)? Dan is het `git pull`, `npm install` en opnieuw starten. Je gegevens staan ook dan in `~/Studio Review`.
- Terugzetten van een back-up: stop de app en voer `npm run herstel` uit. Zie de README, onder *Gegevens, back-ups en opslag*.
