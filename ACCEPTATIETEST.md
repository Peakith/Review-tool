# Acceptatietest: volledige klantflow

Duur: ± 20 minuten. Je hebt twee browservensters nodig: één voor het **team** en één privévenster voor de **klant**. Gebruik een echte export (H.264/AAC MP4), en voor stap 6 een tweede export als versie 2.
Vink elke stap af. Een ✗ met een korte notitie is voor ons het nuttigst.

## A. Team: voorbereiden
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 1 | Open de installatielink uit het serverlog (`/?setup=…`). Probeer eerst de code te wijzigen. | Met een verkeerde code: "De installatiecode klopt niet". Met de juiste code: account aangemaakt en ingelogd. | ☐ |
| 2 | Maak project "Acceptatietest" aan en upload `jouw_export_v01.mp4`. Vul als titel "Campagnefilm — Hoofdvideo" in. | Voortgangsbalk; de video staat als **Concept** in het project. De titel heeft geen ".mp4"; de bestandsnaam staat alleen klein onder de speler. | ☐ |
| 3 | Klik **Titel wijzigen** en maak er "Campagnefilm — Definitief" van. | De titel verandert. Bestand, versie en geschiedenis blijven gelijk. | ☐ |
| 4 | Klik **Download**. | Het bestand heet `Campagnefilm — Definitief - v1.mp4` en speelt lokaal af. | ☐ |
| 5 | Klik **Zet op "Klaar voor review"** en daarna **Delen met klant**. | Status **In review**; er is automatisch een reviewlink aangemaakt. In de statusgeschiedenis staan 3 regels met jouw naam en tijd. | ☐ |
| 6 | Vul bij **Akkoordgever** een naam en e-mail in, klik **Opslaan** en dan **Maak persoonlijke akkoordlink**. | Akkoordlink staat in de lijst (en is gekopieerd). | ☐ |

## B. Klant: reviewen (privévenster, liefst ook op je telefoon)
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 7 | Open de **reviewlink**. | Titel "Campagnefilm — Definitief", "Versie 1 NIEUWSTE", status In review. Geen login. | ☐ |
| 8 | Speel af, controleer het geluid, spoel via de tijdlijn naar het midden en test volledig scherm. | Beeld en geluid lopen; na het vooruitspoelen speelt de video vanaf het nieuwe punt verder. | ☐ |
| 9 | Vul je naam in. Pauzeer op ± 0:10 en plaats een opmerking. Doe hetzelfde op ± 0:20. | Beide reacties tonen het juiste tijdstip, "opgegeven naam" en "Nog niet verstuurd". Er staan markeringen op de tijdlijn. | ☐ |
| 10 | Klik op de tijdcode van de eerste reactie. | De video springt naar ± 0:10. | ☐ |
| 11 | Ververs het teamvenster. | Status is **nog steeds In review**: een losse reactie verandert niets. | ☐ |
| 12 | Klant: **Feedback versturen (2)** → bevestig. | Melding "verstuurd"; status **Aanpassingen nodig**. | ☐ |
| 13 | Probeer als gewone klant goed te keuren. | Er is geen goedkeurknop. Er staat "Goedkeuren gebeurt door <naam>". | ☐ |

## C. Team: verwerken en versie 2
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 14 | Teamvenster verversen: beantwoord de eerste reactie en klik **✓ Markeer als afgehandeld**. | Antwoord zichtbaar, reactie afgehandeld. De status blijft **Aanpassingen nodig**. | ☐ |
| 15 | **+ Nieuwe versie uploaden** met `jouw_export_v02.mp4`. | v2 verschijnt als **Concept** en neemt de titel automatisch over. | ☐ |
| 16 | Klant: ververs de reviewlink. | Klant ziet **nog steeds Versie 1** (geen versiekeuze). | ☐ |
| 17 | Team: zet v2 op Klaar voor review en klik **Delen met klant**. Klant: ververs. | Dezelfde link toont **Versie 2 NIEUWSTE**, status In review, geen goedkeuring. Via de versiekeuze is Versie 1 nog te zien, met de feedback en het antwoord van het team (alleen-lezen). | ☐ |

## D. Akkoordgever: goedkeuren
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 18 | Open de **akkoordlink** (liefst op je telefoon). | "Je reviewt als <naam> ✓ Aangewezen akkoordgever". Er zijn knoppen "Feedback versturen" en "Deze versie goedkeuren". | ☐ |
| 19 | Klik **Deze versie goedkeuren** → **Ja, keur Versie 2 goed**. | Groene melding met naam, datum en tijd. Status **Goedgekeurd**. | ☐ |
| 20 | Team: ververs. | v2 **Goedgekeurd** (met naam en e-mail van de akkoordgever); v1 blijft **Aanpassingen nodig**. | ☐ |
| 21 | Team: corrigeer de status van v2 handmatig naar "In review", met als reden "test". | Wordt gelogd met jouw naam en reden. De klantgoedkeuring blijft in de geschiedenis staan. | ☐ |

## E. Toegang intrekken
| # | Doe | Verwacht | ✓ |
|---|---|---|---|
| 22 | Team: **Intrekken** bij de reviewlink. Klant: ververs. | "Link ingetrokken". Ook de video zelf laadt niet meer. | ☐ |
| 23 | Wijzig de akkoordgever (andere naam). Open de oude akkoordlink. | Ook de oude akkoordlink is ingetrokken. | ☐ |

---

## Handmatige browsertestlijst
Automatisch getest (zie testverslag in de PR): **Chrome 141 desktop (Linux)** en **Chrome 141 met Pixel 7-emulatie**. Al het andere moet nog met de hand. Voer per browser minstens stappen 7–10, 12, 18–19 en 4 uit.

| Browser / apparaat | Afspelen + geluid | Vooruitspoelen | Volledig scherm | Reactie op tijdstip | Feedback / goedkeuren | Downloadnaam |
|---|---|---|---|---|---|---|
| Safari (macOS) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Safari (iPhone, iOS 17+) | ☐ | ☐ | ☐ (native speler) | ☐ | ☐ | n.v.t. |
| Chrome (Android, echt toestel) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Chrome (Windows of macOS) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Edge (Windows) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Firefox | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

Let extra op in **iOS Safari**:
- volledig scherm opent de native speler;
- na het tikken in het reactieveld moet het toetsenbord de knoppen niet afdekken;
- de onderbalk "Feedback versturen / Goedkeuren" moet boven de home-indicator staan.
