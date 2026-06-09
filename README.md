# DOMUS

DOMUS est un CLI et une petite interface locale pour piloter des ampoules
TP-Link Tapo sur le reseau Wi-Fi local.

Objectif: installation simple, usage rapide, pas de Home Assistant, pas de
Docker, pas de cloud DOMUS. Les identifiants Tapo restent dans ton fichier
local `.env`.

## Systeme supporte

DOMUS est developpe et teste sur le systeme de Gabriel, avec macOS, Node.js 20+
et Python 3. Les autres environnements, notamment Windows/PC, ne sont pas
officiellement maintenus ici. Les adaptations sont bienvenues si d'autres
developpeurs veulent les porter.

## Installation rapide

```bash
git clone https://github.com/GabrielSandap/OPX_CLI_DOMUS.git
cd OPX_CLI_DOMUS
./installer.sh
npm run dev
```

Ouvre ensuite l'adresse affichee par Next.js, souvent:

```text
http://localhost:3000
```

Au premier lancement, l'app affiche l'onboarding Tapo:

1. Verifie que l'ordinateur est sur le meme Wi-Fi que les appareils Tapo.
2. Renseigne l'email et le mot de passe du compte TP-Link/Tapo.
3. Clique sur `Enregistrer et scanner`.
4. DOMUS detecte les appareils et memorise leurs IP dans `.env`.

## Prerequis

- Node.js `>=20.9.0`
- npm
- Python 3 avec `venv`
- Un compte TP-Link/Tapo avec un vrai mot de passe
- Des appareils Tapo connectes au meme reseau local

Si tu utilises Tapo via Google, Apple ou Facebook, cree ou reinitialise un vrai
mot de passe TP-Link/Tapo dans l'app Tapo avant de configurer DOMUS.

## Scripts utiles

```bash
./installer.sh # installe Node, Python, cree .env si besoin, teste le build
./update.sh    # met a jour le repo et les dependances
./doctor.sh    # diagnostique les prerequis et la configuration locale
```

`./install.sh` reste disponible comme alias.

Les memes commandes existent aussi via npm:

```bash
npm run install:domus
npm run update:domus
npm run doctor
```

## CLI DOMUS

Dans le dossier du projet:

```bash
./domus list
./domus on all
./domus off Salon
./domus brightness Bureau 35
./domus color "Chevet" "#FF8800"
./domus scene save "Soiree"
./domus scene apply "Soiree"
```

La variante npm marche aussi:

```bash
npm run domus -- list
```

Pour exposer la commande `domus` dans le terminal:

```bash
npm link
domus list
```

Commandes disponibles:

- `domus list`, `domus ls`, `domus status`
- `domus on [cible]`
- `domus off [cible]`
- `domus toggle <cible>`
- `domus brightness <cible> <1-100>`
- `domus temp <cible> <kelvin> [brightness]`
- `domus color <cible> <#RRGGBB>`
- `domus color <cible> <hue> <saturation> [value]`
- `domus scene list`
- `domus scene save <nom>`
- `domus scene apply <nom>`
- `domus scene transition <nom> <ms>`
- `domus scene delete <nom>`
- `domus raw <arguments tapo_lights.py>`

Ajoute `--json` pour recuperer la sortie brute:

```bash
domus list --json
```

## Configuration locale

`.env.example` contient les variables attendues:

```env
TAPO_EMAIL=
TAPO_PASSWORD=
TAPO_KNOWN_IPS=
TAPO_KNOWN_ALIASES=
```

`TAPO_KNOWN_IPS` et `TAPO_KNOWN_ALIASES` sont optionnels. L'onboarding web les
remplit automatiquement apres un scan reussi.

Ne partage jamais `.env`: il contient tes identifiants TP-Link/Tapo.

## Ambiances

Les ambiances sont sauvegardees localement dans `domus-scenes.json`.

```bash
domus scene save "Lecture"
domus scene apply "Lecture"
domus scene transition "Lecture" 5000
```

## Depannage

Lance d'abord:

```bash
./doctor.sh
```

Si tu vois `authentification refusee`:

- `TAPO_EMAIL` doit etre l'email exact du compte TP-Link/Tapo.
- `TAPO_PASSWORD` est le mot de passe TP-Link/Tapo, pas le mot de passe Wi-Fi.
- L'email et le mot de passe sont sensibles a la casse.
- Apres un changement de mot de passe, coupe puis rallume les appareils si besoin.

Si un appareil affiche `protocole TPAP non supporte`, cherche dans l'app Tapo une
option du type `Third-Party Compatibility` ou `Compatibilite tierce`, puis relance:

```bash
./update.sh
```

## Publication GitHub

Le repo est prepare pour etre public:

- `.env`, `.venv`, `node_modules`, `.next` et les caches sont ignores.
- `.env.example` documente la configuration sans secret.
- Les IP personnelles ne sont pas codees en dur.
- `domus-scenes.json` demarre vide.

Repo public: https://github.com/GabrielSandap/OPX_CLI_DOMUS
