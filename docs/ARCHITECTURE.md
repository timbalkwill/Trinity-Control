# Architecture

The refresh build keeps the stable Electron main/preload boundary while replacing the renderer with a smaller, defensive implementation.

- `electron-main.cjs`: persistent state, migrations, and IPC commands.
- `cue-execution.cjs`: authoritative cue resource resolution and execution for GO, NEXT, and BACK.
- `preload.cjs`: restricted renderer API.
- `public/app.js`: pages and operator interactions.
- `public/styles.css`: responsive production-console layout.

The app uses a separate product name and application ID so it does not overwrite Alpha 4 data.
