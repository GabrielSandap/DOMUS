# DOMUS

DOMUS is a local CLI and lightweight web UI for controlling TP-Link Tapo lights
on your local Wi-Fi network.

The goal is simple setup and fast daily use: no Home Assistant, no Docker, and
no DOMUS cloud service. Your Tapo credentials stay on your machine in the local
`.env` file.

## Supported System

DOMUS is developed and tested on Gabriel's setup: macOS, Node.js 20+, and
Python 3.11+. Other environments, especially Windows/PC setups, are not officially
maintained here. Ports and compatibility fixes are welcome from contributors
who want to support them.

## Quick Install

```bash
git clone https://github.com/GabrielSandap/DOMUS.git
cd DOMUS
./install
npm run dev
```

Then open the URL printed by Next.js, usually:

```text
http://localhost:3000
```

On first launch, the app shows the Tapo onboarding flow:

1. Make sure the computer running DOMUS is on the same Wi-Fi network as the Tapo devices.
2. Enter the email and password for the TP-Link/Tapo account.
3. Click the save-and-scan button.
4. DOMUS detects the devices and stores their IP addresses in `.env`.

## Requirements

- Node.js `>=20.9.0`
- npm
- Python `>=3.11` with `venv`
- A TP-Link/Tapo account with a real password
- Tapo devices connected to the same local network

If you use Tapo through Google, Apple, or Facebook login, create or reset a real
TP-Link/Tapo password in the Tapo app before setting up DOMUS.

## Useful Scripts

```bash
./install     # installs requirements, links the domus CLI globally, checks readiness
./update.sh    # updates the repo and dependencies
./doctor.sh    # checks local requirements and configuration
```

`./install.sh` and `./installer.sh` are also available as aliases.

The same commands are available through npm:

```bash
npm run install:domus
npm run update:domus
npm run doctor
```

## DOMUS CLI

From the project directory:

```bash
./domus list
./domus on all
./domus off Salon
./domus brightness Bureau 35
./domus color "Chevet" "#FF8800"
./domus scene save "Soiree"
./domus scene apply "Soiree"
```

The npm variant also works:

```bash
npm run domus -- list
```

The installer exposes the `domus` command globally with `npm link`. To relink it manually:

```bash
npm link
domus list
```

Available commands:

- `domus list`, `domus ls`, `domus status`
- `domus on [target]`
- `domus off [target]`
- `domus toggle <target>`
- `domus brightness <target> <1-100>`
- `domus temp <target> <kelvin> [brightness]`
- `domus color <target> <#RRGGBB>`
- `domus color <target> <hue> <saturation> [value]`
- `domus scene list`
- `domus scene save <name>`
- `domus scene apply <name>`
- `domus scene transition <name> <ms>`
- `domus scene delete <name>`
- `domus raw <tapo_lights.py arguments>`

Add `--json` to get raw JSON output:

```bash
domus list --json
```

## Local Configuration

`.env.example` contains the expected variables:

```env
TAPO_EMAIL=
TAPO_PASSWORD=
TAPO_KNOWN_IPS=
TAPO_KNOWN_ALIASES=
```

`TAPO_KNOWN_IPS` and `TAPO_KNOWN_ALIASES` are optional. The web onboarding fills
them automatically after a successful scan.

Never share `.env`: it contains your TP-Link/Tapo credentials.

## Scenes

Scenes are stored locally in `domus-scenes.json`.

```bash
domus scene save "Reading"
domus scene apply "Reading"
domus scene transition "Reading" 5000
```

## Troubleshooting

Start with:

```bash
./doctor.sh
```

If you see `authentification refusee`:

- `TAPO_EMAIL` must be the exact email used by the TP-Link/Tapo account.
- `TAPO_PASSWORD` is the TP-Link/Tapo account password, not the Wi-Fi password.
- Email and password are case-sensitive.
- After changing the password, power-cycle the devices if needed.

If a device reports `protocole TPAP non supporte`, look in the Tapo app for an
option such as `Third-Party Compatibility`, enable it if available, then run:

```bash
./update.sh
```

## Public GitHub Release

This repo is prepared for public sharing:

- `.env`, `.venv`, `node_modules`, `.next`, and caches are ignored.
- `.env.example` documents configuration without secrets.
- Personal IP addresses are not hard-coded.
- `domus-scenes.json` starts empty.

Public repo: https://github.com/GabrielSandap/DOMUS
