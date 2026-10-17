# Afgeschermde testomgeving opzetten

De testomgeving bestaat uit de app plus Caddy. Caddy regelt automatisch HTTPS en zet de hele omgeving achter één gedeeld wachtwoord. Daardoor kan alleen wie de logingegevens heeft de team- en klantpagina's openen, ook de reviewlinks.

> **Status:** de `Dockerfile`, `deploy/compose.yaml` en `deploy/Caddyfile` zijn geschreven, maar in de ontwikkelomgeving **niet gebouwd of gestart**: Docker en publieke tunnels waren daar niet beschikbaar. Draai na de eerste start de controle uit stap 5.

## Wat je nodig hebt
| Nodig | Voorbeeld | Waarom |
|---|---|---|
| Een Linux-server met Docker en Docker Compose | VPS bij Hetzner, DigitalOcean of TransIP (2 vCPU, 4 GB RAM) | Draait de app en ffmpeg |
| Persistente schijf | ≥ 100 GB, afhankelijk van jullie videovolume | Video's en database (volume `review-data`) |
| Een (sub)domein | `review-test.jouwagency.nl` → A-record naar het IP van de server | Nodig voor HTTPS |
| Poort 80 en 443 open | firewall van de VPS | Let's Encrypt en bezoekers |

## Stappen
1. **Code op de server zetten**
   ```bash
   git clone <repo-url> review-tool && cd review-tool
   git checkout claude/gifted-cori-4qgyq3
   ```
2. **Instellingen**
   ```bash
   cp deploy/voorbeeld.env deploy/.env
   docker run --rm caddy:2.8 caddy hash-password --plaintext 'kies-een-sterk-wachtwoord'
   ```
   Vul in `deploy/.env` in: `DOMAIN`, een zelfgekozen `SETUP_TOKEN` (minstens 20 tekens) en `PREVIEW_PASSWORD_HASH` (de hash tussen enkele aanhalingstekens).
3. **Starten**
   ```bash
   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
   docker compose -f deploy/compose.yaml logs app    # toont o.a. de installatielink
   ```
4. **Eerste account**: open `https://<DOMAIN>/?setup=<SETUP_TOKEN>` en log in met de testomgeving-login (`PREVIEW_USER` + wachtwoord). Vul daarna naam, e-mail en wachtwoord in.
5. **Controle**: `https://<DOMAIN>/api/health` moet tonen:
   `{"status":"ok","database":"ok","ffprobe":"ok","ffmpeg":"ok","uploads":"ok"}`

## Inloggegevens voor de beoordelaar
- **Testomgeving-login** (browserpopup): `PREVIEW_USER` / het gekozen wachtwoord. Deel dit met iedereen die test, ook met testklanten.
- **Teamaccount**: aangemaakt in stap 4. Extra testers voeg je toe via **Team**.
- **Klant**: geen account. Die gebruikt de reviewlink of akkoordlink die het team kopieert.

## Naar livegang
- Haal het `basic_auth`-blok uit `deploy/Caddyfile` weg, anders moeten klanten een extra wachtwoord invoeren.
- Kies een eigen domein, regel back-ups van het volume `review-data` en plan onderhoud (`docker compose pull && up -d --build`).
- Laat `ALLOW_UNVERIFIED_UPLOADS` uit. Het image installeert ffmpeg, dus uploads worden altijd gecontroleerd.

## Zonder Docker
Node.js ≥ 22.13 en `apt install ffmpeg`, dan `npm ci --omit=dev && npm start`, met `PUBLIC_URL`, `SECURE_COOKIES=true`, `TRUST_PROXY=true` en `SETUP_TOKEN` gezet. Zet er een reverse proxy met TLS voor, en zet in nginx `client_max_body_size` op minimaal `10m` (uploadblokken zijn 8 MB). Draai de app als service (systemd of pm2).
