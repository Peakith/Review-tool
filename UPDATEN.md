# Studio Review bijwerken (ZIP-installatie op de Mac)

Vanaf versie 0.2.0 staan programma en gegevens los van elkaar:

- **Programma**: de uitgepakte map. Bij elke update komt er een nieuwe.
- **Gegevens**: `~/Studio Review/` met daarin `gegevens/`, `backups/` en `instellingen.env`. Deze map blijft gewoon staan.

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
