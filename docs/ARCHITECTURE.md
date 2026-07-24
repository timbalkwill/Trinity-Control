# Architecture

The refresh build keeps the stable Electron main/preload boundary while replacing the renderer with a smaller, defensive implementation.

- `electron-main.cjs`: persistent state, migrations, and IPC commands.
- `cue-execution.cjs`: authoritative cue resource resolution and execution for GO, NEXT, and BACK.
- `operator-commands.cjs`: serialized, authoritative operator commands shared by Electron IPC and browser requests.
- `operator-server.cjs`: local HTTP server, explicit JSON API, whitelisted browser assets, and Server-Sent Event state broadcasts.
- `preload.cjs`: restricted renderer API.
- `public/app.js`: pages and operator interactions.
- `public/styles.css`: responsive production-console layout.
- `public/operator/`: touch-oriented Browser Operator interface for iPad Safari.

The app uses a separate product name and application ID so it does not overwrite Alpha 4 data.

## Browser Operator

Trinity Control starts one dependency-free HTTP server on `0.0.0.0:4310` with the Electron application. Browse to `http://<Mac-LAN-IP>:4310/operator/` from a trusted device on the same local network. `/` redirects to the Operator page.

The browser API exposes only state reads, health, SSE state events, and the approved operator commands. It does not expose Electron, filesystem access, arbitrary state replacement, or arbitrary static files. Electron IPC and browser requests call the same serialized command service, which persists state before broadcasting the authoritative snapshot to connected SSE clients.

## Enhanced Order of Service

`service-operations.cjs` owns cue-list mutations, cue validation, timing calculations, and keyboard-command mapping. Electron IPC and Browser Operator HTTP routes call the same serialized `operator-commands.cjs` methods. Each operation loads the latest authoritative state, applies one narrow mutation, saves immediately, and publishes the saved snapshot over SSE. Browser clients never submit a complete state object, which prevents an older browser snapshot from overwriting newer desktop changes.

Reordering records the active cue ID before moving the array item and restores `live.cueIndex` from that ID afterward. Cue duplication preserves lighting and camera override fields. Existing saved services need no cue migration; `live.serviceStartedAt` is added lazily from `cueStartedAt` when absent. Timing indicators are derived read-only from timestamps and cue durations, so their one-second display updates do not execute cues or write state.

GO, NEXT, and BACK still use the single authoritative `executeCue()` path. Direct jumps beyond two positions require an explicit confirmation flag, while sequential NEXT and BACK remain immediate.

## Production Looks 2.0 foundation

`production-look-operations.cjs` owns the versioned Production Look schema, normalization, validation, resource resolution, summaries, and CRUD operations. Migration is applied in the main process before state reaches either renderer. Electron IPC and narrow HTTP commands both use the serialized operator-command queue, so every edit begins with the latest saved state and publishes only the resulting authoritative snapshot.

`cue-execution-plan.cjs` builds a pure hardware-independent description of the desired cue state. It records the source of lighting and video values, camera assignments, motion intent, future audio/presentation references, and non-fatal missing-resource warnings. `executeCue()` remains the only runtime entry point for GO, NEXT, and BACK; the execution plan does not communicate with hardware or create another execution path.

Cue precedence remains: valid cue override, valid referenced Production Look value, then the existing safe fallback. Updating or deleting a Look never rewrites a cue. A confirmed deletion may leave an intentional missing reference so an operator can repair the cue later.

## Device configuration foundation

`device-operations.cjs` owns the versioned device collection, deterministic migration, validation, CRUD, ordering, logical-role lookup, reference counting, summaries, and diagnostic stubs. The collection is separate from the legacy camera library so existing camera IDs, layouts, Production Looks, cues, and runtime execution remain unchanged.

Electron Settings mutations use restricted preload IPC and the existing serialized operator-command queue. Browser Operator receives `deviceSummaries` through an explicit projection; full device records, usernames, passwords, credential references, private notes, and system configuration are removed from every HTTP response and SSE event.

Diagnostics deliberately report configuration and adapter readiness only. No device adapter performs network communication, and no stub reports a connected state. Production Look resolution prefers matching device names while retaining the legacy camera library as a compatibility fallback. Execution plans remain pure and `executeCue()` remains authoritative.

## Camera Manager foundation

Camera Manager is a computed operational projection over camera records in `state.devices`; it does not create another camera identity. `camera-manager-operations.cjs` resolves device details, legacy camera records, conservative capability states, diagnostic readiness, known program/preview state, and preset summaries. Main, Left, and Right are presentation priorities only, followed by any additional camera devices.

All camera records—including the initial Main, Left, and Right records—use the same create, rename, duplicate, enable/disable, and reference-aware delete operations. Deletion removes only the camera device. Production Looks, layouts, cues, and presets retain their stable camera IDs as visible missing references so an operator can repair them later. An explicitly saved `devices` array, including an empty array, is authoritative during migration; defaults are created only when no device collection has ever been saved.

Shot Library adds `state.shots` between camera presets and Production Looks. `shot-operations.cjs` owns versioned migration, CRUD, ordering, filtering, reference counts, pure target resolution, readiness summaries, and deterministic defaults. The dependency chain is Device → Camera Manager → Camera Preset → Shot → Production Look → Cue → `executeCue()` → `live.executionSnapshot`.

Shot mutations use the serialized main-process command queue and restricted preload bridge. Execution plans resolve Shot intent without mutation; Browser Operator receives only safe summaries and frozen executed assignments, never private Shot metadata.

`state.cameraPresets` is the versioned preset collection. `camera-preset-operations.cjs` owns deterministic legacy migration, validation, narrow CRUD, per-camera ordering, category/favorite queries, and reference-aware deletion. Browser clients receive safe `managedCameras` and `cameraPresetSummaries`, never device configuration or full preset records.

This release assumes a trusted church LAN. It does not provide cloud access or authentication and should not be exposed directly to the internet.

## Browser Operator troubleshooting

- **Server not running:** Open the Cameras page in the desktop app and check the Browser Operator status. Review the Terminal log for a port or firewall error.
- **Wrong Mac IP:** Use a Network URL shown in the Cameras page. The address can change when the Mac reconnects to Wi-Fi.
- **Different Wi-Fi networks:** Confirm the Mac and iPad are connected to the same network and subnet.
- **Guest Wi-Fi or client isolation:** Guest networks commonly prevent devices from reaching each other. Use the trusted production network or disable client isolation.
- **macOS firewall:** Allow incoming connections for Trinity Control when macOS prompts, or review Firewall settings in System Settings.
- **Port 4310 already in use:** Quit the other application using port 4310, then restart Trinity Control. Trinity does not silently choose another port because operator bookmarks depend on it.
