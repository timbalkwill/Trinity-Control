# Trinity Control Architecture

## Alpha 4 foundation

Trinity Control is an offline-first Electron application. The Electron main process owns persisted application state and exposes a narrow IPC API through `preload.cjs`. The renderer reads and updates state through that API and never receives direct Node.js access.

## State model

Persisted state lives in Electron's `userData` directory as `trinity-data.json`.

Every saved state now carries two separate versions:

- `version`: the application release that last normalized the data.
- `schemaVersion`: the persisted data format version.

`migrate()` is the single entry point for loading old data. It merges new defaults without deleting user-created lighting scenes, camera layouts, production looks, cue templates, or service cues.

## Core production hierarchy

Assets → Production Looks → Cues → Run of Service → Live State.

The camera subsystem is split into:

- `cameras`: physical or simulated camera devices.
- `cameraPresets`: one shared logical preset library available to every camera.
- `cameraPresetAssignments`: per-camera hardware assignments for logical presets.
- `cameraLayouts`: reusable Program/Preview combinations.

The shared preset names remain exposed through a temporary `presetNames` compatibility alias so Alpha 3 renderer code and existing saved data continue to work during the Alpha 4 migration.

## Next architectural step

Move renderer state mutations behind domain-specific IPC commands and split the renderer into Live, Service, Looks, Lighting, and Cameras modules.
