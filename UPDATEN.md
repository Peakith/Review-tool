# Studio Review bijwerken (ZIP-installatie op de Mac)

Vanaf versie 0.2.0 staan programma en gegevens los van elkaar:

- **Programma**: de uitgepakte map. Bij elke update komt er een nieuwe.
- **Gegevens**: `~/Studio Review/` met daarin `gegevens/`, `backups/` en `instellingen.env`. Deze map blijft gewoon staan.

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
