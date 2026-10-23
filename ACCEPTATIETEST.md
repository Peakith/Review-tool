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
| 4 | Klik op het potlood naast de titel, typ "Campagnefilm — Hoofdvideo" en druk op Enter. | De titel is aangepast, zonder ".mp4". | ☐ |
| 5 | Open de video. Klik in de statusbalk op **Klaar voor review**, daarna op **Publiceren naar klant** en bevestig. | De statusbalk toont "In review". In de kop staat "Klant ziet: Versie 1". | ☐ |
| 6 | **Delen** → kopieer de **reviewlink**. Vul bij **Akkoordlink** naam en e-mail in → **Akkoordgever opslaan** → **Persoonlijke akkoordlink maken**. | Het venster legt het verschil uit: de reviewlink "kan niet goedkeuren", en alleen met de akkoordlink kan worden goedgekeurd. | ☐ |
| 7 | **⋯ › Download Versie 1**. | Het bestand heet `Campagnefilm — Hoofdvideo - v1.mp4` en speelt lokaal af. | ☐ |

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
| 22 | **Status corrigeren** → kies "In review" en klik zonder reden op opslaan. Vul daarna een reden in. | Zonder reden lukt het niet. Met reden wordt de correctie opgeslagen; onder **Geschiedenis** staat "Reden: …" met jouw naam. | ☐ |

## E. Toegang intrekken
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 23 | **Delen** → prullenbak bij de reviewlink → **Intrekken**. Klant: ververs. | "Deze link is ingetrokken". Ook de video zelf laadt niet meer. | ☐ |
| 24 | Wijzig de akkoordgever in het deelvenster. Open de oude akkoordlink. | Ook de oude akkoordlink is ingetrokken. | ☐ |

---

## F. Startknop, gegevens en beheer (op je eigen Mac)
Deze punten zijn **niet op een echte Mac getest**: de start- en stopknop zijn alleen op Linux getest. Doe ze daarom zelf, en volg voor de eerste keer **[UPDATEN.md](UPDATEN.md)**.

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 25 | Dubbelklik `Start Studio Review.command` in de nieuwe map. | macOS vraagt eenmalig om toestemming (zie de README). Daarna opent Terminal, de controles staan op ✓, de vraag om gegevens over te nemen verschijnt, en de browser opent vanzelf. | ☐ |
| 26 | Log in. | Je bestaande projecten, video's, reacties en klantlinks zijn er allemaal. Onderin de zijbalk staat "Studio Review 0.3.0 (build …)". | ☐ |
| 27 | Dubbelklik nog eens op de startknop. | Er start niets nieuws; de bestaande sessie opent in de browser. | ☐ |
| 28 | **Opslag & back-ups › Nu back-up maken.** | De back-up krijgt "compleet en gecontroleerd", met de juiste aantallen en in een map onder `~/Studio Review/backups`. | ☐ |
| 29 | **Team & rechten** → voeg een freelancer toe met toegang "Bekijken en reageren" tot één project. Log in als freelancer (privévenster). | De freelancer ziet alleen dat project, kan reageren, maar ziet geen upload-, deel- of publiceerknoppen. | ☐ |
| 30 | Gooi als beheerder een testvideo in de prullenbak en open de klantlink ervan. | De klant krijgt "niet meer beschikbaar". Na **Prullenbak › Terugzetten** werkt de link weer. | ☐ |
| 31 | Dubbelklik `Stop Studio Review.command`. | De melding "Studio Review is gestopt. Je gegevens zijn bewaard." verschijnt, en het startvenster stopt. | ☐ |
| 32 | Start opnieuw en ververs een tabblad dat nog openstond. | De pagina werkt direct, zonder harde verversing of het legen van de cache. | ☐ |

## G. Klantportaal, merk en briefing (bouwronde 2)
Doe dit eerst zelf op je Mac. Wil je het portaal op een tweede apparaat of telefoon testen, dan werkt de localhost-link daar niet (zie README).

| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 33 | **Merken** → upload een logo voor Moviemates en pas eventueel de kleur aan. | Het voorbeeld rechts toont direct logo, kleur en knop. | ☐ |
| 34 | **Project bewerken** → kies het merk Moviemates en schrijf een korte introductie. | Bij het project staat een kleurstip met “Moviemates”. | ☐ |
| 35 | Geef bij een video **Gegevens → Invullen**: type “Social”, kanaal “Instagram Reels”. | De projectpagina groepeert per type; bij de video staat “Social · 9:16 · Instagram Reels”. | ☐ |
| 36 | Tabblad **Briefing & referenties**: voeg een tekst toe, een link en een PDF. Deel alleen de link. | Alles staat eerst onder “Alleen intern”; de link verhuist naar “Zichtbaar voor de klant”. | ☐ |
| 37 | **Klantportaal → Projectlink maken** en open de link in een privévenster (Safari én Chrome). | Je ziet logo, introductie, alleen gepubliceerde video’s met de gepubliceerde versie, en alleen de gedeelde link. Geen interne PDF, geen concepten, geen goedkeurknop. | ☐ |
| 38 | Open in het portaal een video, plaats een reactie en verstuur feedback. Ga terug naar het overzicht. | De video staat onder “Feedback verstuurd”. Interne teamnotities zijn niet zichtbaar. | ☐ |
| 39 | Upload een nieuwe versie (niet publiceren) en ververs het portaal. | Het portaal toont nog de vorige versie en status. Pas na **Publiceren naar klant** verschijnt de nieuwe versie. | ☐ |
| 40 | **Klantweergave** op de projectpagina. | Exact dezelfde video’s en briefing als in het privévenster, met een paarse voorbeeldbalk. | ☐ |
| 41 | **Klantportaal → Intrekken**. Ververs het privévenster. | “Deze link werkt niet meer”. Een afzonderlijke reviewlink van een video werkt nog wel. | ☐ |
| 42 | Herhaal 37–38 op je iPhone of Android-telefoon (alleen mogelijk met een bereikbaar adres; lokaal kan dat nog niet). | Kaarten onder elkaar, verticale video’s passen in beeld, knoppen zijn goed te raken. | ☐ |

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
