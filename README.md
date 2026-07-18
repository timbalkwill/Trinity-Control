# Trinity Control

Offline-first church production control software.

## Current alpha features

- Mission Control
- Live Director
- Run of Service with functional Add Cue
- Shared camera preset library across every camera
- Direct Preview and Program camera selection
- Production Shots
- Technical device status simulation

## Run for development

Install Node.js 22 or newer, then:

```bash
npm install
npm start
```

## Build a Mac application

```bash
npm install
npm run build:mac
```

The finished `.dmg` and `.zip` appear in `dist/`. End users do not need Node.js.

## GitHub automatic builds

Open the repository's **Actions** tab and run **Build Trinity Control**. Download the macOS artifact after the workflow finishes.

The build is currently unsigned. On first launch, macOS may require Control-click → Open.
