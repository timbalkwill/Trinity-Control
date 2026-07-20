# Architecture

## Runtime boundaries

Trinity Control has one production system with two planned operator interfaces:

- **Production Console:** the existing Electron renderer on the production computer.
- **Live Remote:** a future iPad-optimized client.

Both clients issue commands to the same Production Engine and observe the same authoritative state and events. Alpha 6 Phase 1 retains Electron IPC for the Production Console. It intentionally does not add the network transport or authentication required by the Live Remote.

## Production Engine

`src/core/production-engine.cjs` coordinates production behavior through the State Store. It is independent of renderer code and provides:

- Access to the State Store's cloned, read-only-to-callers snapshot
- A monotonically increasing state revision
- One serialized command-dispatch path
- Live command handlers
- State-change, activity, and error events
- A registry for subsystem adapters
- Guarded delayed cue transitions

The implemented live commands are `ActivateCue`, `NextCue`, `PreviousCue`, `SetHold`, `TakeCamera`, `SetLightingOverride`, and `ReleaseLightingOverride`.

Cue activation resolves the cue's production look and any cue-level camera or lighting overrides. PTZ preparation is initiated before the simulated switcher transition. Every activation receives a transition generation. A newer cue or manual camera command invalidates older delayed transition work, preventing it from overwriting the operator's newer decision.

The engine and its State Store are the authority for live production state. `src/core/state-store.cjs` encapsulates the raw authoritative snapshot and its monotonically increasing revision. Revision `0` is present on the initial snapshot; each committed command produces a new snapshot and state-change event with the same incremented revision. Compatibility editing commands still replace a complete snapshot during this phase; removing that temporary path is deferred until editing operations receive explicit commands.

## Event Bus

`src/core/event-bus.cjs` is a small synchronous publication boundary with explicit event names. It supports subscription, returned unsubscribe functions, direct unsubscribe, wildcard observation, and clearing subscriptions. A failed subscriber cannot stop delivery to other subscribers. Rejected asynchronous subscribers are also contained and reported when an error reporter is configured.

Engine event names are:

- `production:state-changed`
- `production:activity`
- `production:error`

A state-change event contains the command type, revision, and authoritative snapshot. Activity and error events use structured objects rather than display-only strings.

## Adapters

`src/adapters/contracts.cjs` defines the minimum capability contract for each current subsystem:

- Camera/PTZ: recall a camera preset
- Video switcher: take a camera using a transition mode
- Lighting: apply a scene and release an override

The initial `simulation-camera-controller.cjs`, `simulation-switcher-controller.cjs`, and `simulation-lighting-controller.cjs` implementations under `src/adapters/simulation` deliberately perform no network or hardware I/O. Simulation remains a first-class backend and exercises the same contracts future PTZOptics, AVKANS, ATEM, QLC+, or DMX controllers will use.

Adapters translate an engine intent into subsystem-specific work. They do not own the service plan or authoritative live state, and hardware-specific identifiers should remain inside adapter configuration rather than leaking into renderer workflows.

## Command and event flow

1. An interface requests an operation through its transport adapter.
2. Electron IPC translates the current desktop request into an engine command.
3. The engine serializes and validates command execution.
4. The engine calls registered subsystem adapters as needed.
5. The engine updates its snapshot, increments the revision, and persists through the existing JSON callback.
6. The engine publishes state, activity, or error events.
7. Electron forwards state events through preload to the Production Console.
8. The future Live Remote will use a network transport around the same commands and events.

The preload bridge keeps request-response methods for compatibility and adds unsubscribe-capable event subscriptions. The renderer requests cue, camera-take, and lighting-override operations; it no longer owns cue-transition timing.

## Override direction

Overrides are moving toward independent domains:

- Camera
- Lighting
- Sources/graphics
- Audio

Only the existing lighting override is modeled explicitly in Phase 1. Manual camera takes invalidate stale delayed camera transitions, but a complete per-domain override policy, locking, precedence, and release model remains future work. New domains should be added to the engine rather than coordinated in either interface.

## Persistence and legacy data

`electron-main.cjs` still owns default-state construction, migration, and JSON persistence at `app.getPath("userData")/trinity-data.json`. The engine calls this existing persistence mechanism after committed state changes. Replacing the persistence layer is intentionally outside this phase.

`data/db.json` is not used by the running application and has not been adopted. Its devices, camera shots, production shots, and runs of service represent a separate earlier model. Any future adoption requires an explicit mapping and migration decision for each concept.

## Intentionally outside Alpha 6 Phase 1

- Real PTZ, ATEM, QLC+, DMX, graphics, streaming, or audio integrations
- The iPad server, remote transport, authentication, and discovery
- A complete persistence rewrite
- Explicit engine commands for every editing operation
- A generalized per-domain override and priority model
- A front-end framework or TypeScript conversion
- Visual or navigation changes to the Production Console
