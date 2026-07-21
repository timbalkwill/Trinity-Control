# Architecture

## Runtime boundaries

Trinity Control has one production system with two planned operator interfaces:

- **Production Console:** the existing Electron renderer on the production computer.
- **Live Remote:** a future iPad-optimized client.

Both clients observe the same authoritative state and events. The Production Console continues to issue commands through Electron IPC. The initial Live Remote foundation serves the existing web assets and authoritative snapshot over HTTP, then broadcasts committed state changes over Server-Sent Events (SSE). Network clients are read-only until a secured remote command contract is introduced.

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

Alpha 6 Phase 2 adds the explicit configuration commands `UpdateCameraConfiguration` and `UpdateLightingSceneConfiguration`. Configuration commands use the same serialized dispatch path as live commands and never allow a renderer to mutate the State Store directly.

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
8. The local-network server broadcasts the same committed event to browser clients over SSE.

## Local-network transport

`src/server/local-network-server.cjs` uses Node's built-in HTTP server and binds to `0.0.0.0` on port `4310` by default. `TRINITY_REMOTE_PORT` can select a different port. It serves the existing `public` application, exposes the current authoritative snapshot at `GET /api/state`, and streams state-change events at `GET /api/events`.

`public/remote-client.js` supplies the same state-loading and subscription shape used by the renderer when Electron's preload bridge is absent. It maps browser connectivity to `connected`, `reconnecting`, and `offline`. Electron keeps its existing IPC bridge and reports `connected` locally.

SSE is intentionally one-way: only the PC's Production Engine can commit state. Authentication, remote command authorization, discovery, TLS, and an iPad-specific presentation remain future work. The HTTP server logs its listening addresses and client connection lifecycle.

The preload bridge keeps request-response methods for compatibility and adds unsubscribe-capable event subscriptions. The renderer requests cue, camera-take, and lighting-override operations; it no longer owns cue-transition timing.

## Interface Capability Model

The Production Console and browser Operator Interface use the same renderer, state mapping, formatting helpers, and page functions. `public/interface-model.js` defines explicit capabilities and derives navigation and read-only view models from them. Pages adapt to capabilities rather than checking whether the runtime is Electron or a browser.

The Production Console receives the complete capability set. It is responsible for live operation, camera recall, service and look editing, lighting control, and system configuration. Its Electron IPC transport and existing desktop behavior remain unchanged.

The browser receives Operator capabilities. It can view only Live, Service, and Cameras. These views consume the authoritative snapshot, update through SSE, and expose no mutation controls. Camera names and saved positions come only from Production Engine state; an empty position collection is shown honestly rather than populated with renderer defaults. Reconnecting browsers fetch a fresh snapshot before continuing the event stream.

A future remote command API should grant narrow command capabilities only after authentication and authorization are defined. It should translate approved requests into the existing Production Engine command path; it must not introduce browser-owned state, direct State Store mutation, or duplicated production rules.

## Configuration flow

The Production Console includes a dedicated Configuration area with Cameras, Lighting, Video Switcher, Production Defaults, Devices, and System tabs. Camera and lighting records are editable in Phase 2. The other tabs expose the boundaries and current simulated/default status without adding premature hardware behavior.

Camera and lighting configuration follows this path:

1. The operator submits a configuration card in the Production Console.
2. Preload sends only the record ID and allowed changes through a configuration-specific IPC method.
3. Electron translates the request into an explicit Production Engine command.
4. The engine locates the existing record, validates and normalizes supported fields, and rejects unknown record IDs or invalid required values.
5. The engine commits the updated snapshot through the State Store.
6. The existing persistence callback writes the committed authoritative snapshot, including its new revision.
7. A state-change event carrying the same revision and snapshot is delivered to subscribed clients.

Camera IDs and lighting-scene IDs are immutable because other production records reference them. Observed camera connectivity is also not configuration: `online` remains simulated runtime status. Record creation and deletion are deferred until reference-integrity and live-safety rules are defined.

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
- Remote command authorization, authentication, discovery, and an iPad-specific interface
- A complete persistence rewrite
- Explicit engine commands for every editing operation
- Camera and lighting record creation/deletion and reference-integrity policy
- Editing commands for Video Switcher, Production Defaults, Devices, and System configuration
- A generalized per-domain override and priority model
- A front-end framework or TypeScript conversion
- Redesign of existing Production Console screens or navigation behavior
