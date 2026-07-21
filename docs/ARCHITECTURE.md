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
- Capability-based adapter discovery through the Device Manager
- Guarded delayed cue transitions

The implemented live commands are `ActivateCue`, `NextCue`, `PreviousCue`, `SetHold`, `TakeCamera`, `SetLightingOverride`, and `ReleaseLightingOverride`.

Alpha 6 Phase 2 adds the explicit configuration commands `UpdateCameraConfiguration` and `UpdateLightingSceneConfiguration`. Configuration commands use the same serialized dispatch path as live commands and never allow a renderer to mutate the State Store directly.

Cue activation resolves the cue's production look and any cue-level camera or lighting overrides. PTZ preparation is initiated before the simulated switcher transition. Every activation receives a transition generation. A newer cue or manual camera command invalidates older delayed transition work, preventing it from overwriting the operator's newer decision.

The engine and its State Store are the authority for live production state. `src/core/state-store.cjs` encapsulates the raw authoritative snapshot and its monotonically increasing revision. Revision `0` is present on the initial snapshot; each committed command produces a new snapshot and state-change event with the same incremented revision. Compatibility editing commands still replace a complete snapshot during this phase; removing that temporary path is deferred until editing operations receive explicit commands.

## Device Manager

`src/core/device-manager.cjs` is the single runtime registry for physical and simulated production devices. The Production Engine requests an adapter by supported capability; it does not select concrete manufacturers or adapter classes. The Device Manager coordinates registered adapters but does not replace their subsystem-specific contracts.

Production state and runtime device state are intentionally separate. Production state contains the service plan, active cue, looks, and operator choices; it is authoritative, revisioned, and persisted by the State Store. Runtime device state contains volatile connectivity and health observations; it is authoritative in the Device Manager, is not persisted into production snapshots, and can change without creating a production revision.

### Runtime Device Model

Every registration exposes a generic device record with `id`, `name`, `type`, `connectionState`, `lastSeen`, `statusMessage`, optional manufacturer/model/version metadata, support flags for reconnect/configuration/health monitoring, and a list of supported capabilities. Generic types currently include Camera, VideoSwitcher, Lighting, Audio, Graphics, Streaming, Controller, and Unknown. Generic connection states are Unknown, Disconnected, Connecting, Connected, Degraded, Error, and Simulation.

Health data includes the last successful communication time, last error, reconnect attempts, and runtime uptime. Renderers consume only this generic model and never branch on PTZOptics, AVKANS, ATEM, QLC+, or another hardware brand.

### Registration Flow

1. An adapter constructs its generic runtime descriptor and calls `registerDevice` through its `register(deviceManager)` method.
2. The Device Manager rejects duplicate IDs, stores the descriptor and private adapter reference, and publishes `device:registered`.
3. The Production Engine discovers the adapter through a generic supported capability such as `camera`, `videoSwitcher`, or `lighting`.
4. Adapter operations report successful communication or errors back to the Device Manager.
5. IPC and the read-only HTTP/SSE transport publish runtime device snapshots independently from production snapshots.

Future adapters use this registration flow without modifications to the Production Engine or renderer. Manufacturer-specific configuration remains inside the adapter boundary.

### Device Lifecycle and Health Monitoring

The Device Manager publishes `device:registered`, `device:updated`, `device:removed`, `device:error`, and `device:health` through the existing Event Bus. Updates can move a device through generic connection states. Successful communication refreshes `lastSeen` and the last-success timestamp; failures retain the last error and move the device to Error; reconnect attempts are counted independently.

The current camera, switcher, and lighting simulation adapters self-register in the Simulation state and report health after simulated operations. They do not perform hardware or network I/O.

## Network PTZ Camera Adapter

Alpha 7.1 adds a standards-based `visca-over-ip` camera adapter without adding manufacturer logic to the Production Engine or renderer. `src/adapters/camera-adapter-factory.cjs` is the startup composition boundary: each camera explicitly selects `simulation` or `visca-over-ip` from persisted configuration. Unknown or invalid adapter configurations register a generic Error device with a useful diagnostic and do not prevent the application or other cameras from starting. Hardware failure never silently changes a camera to simulation.

The Device Manager routes the generic `camera` capability using the configured camera ID. This allows several real and simulated cameras to coexist while the Production Engine continues to issue only normalized `{ cameraId, preset }` requests. Every configured camera registers a distinct generic runtime device record; the adapter instance remains private.

### VISCA Transport Boundary

`src/adapters/visca/visca-commands.cjs` encodes raw VISCA commands and classifies terminated responses. `tcp-visca-transport.cjs` owns TCP sockets, request timeouts, response collection, and cleanup. `visca-camera-adapter.cjs` maps camera configuration and saved positions to protocol requests and reports results to Device Manager. Protocol encoding, socket lifecycle, and production commands therefore remain separate and independently testable.

This phase uses raw VISCA over TCP with a configurable port that defaults to 5678. Preset recall is encoded as `8x 01 04 3F 02 pp FF`, using configured camera address `x` and explicit hardware preset `pp`. Conservative health monitoring sends the VISCA power inquiry `8x 09 04 00 FF` and requires a valid VISCA completion response. A successful TCP connection without a protocol response is not considered healthy.

### Camera Adapter Configuration and Preset Mapping

The authoritative camera configuration adds `adapterType`, `host`, `port`, `cameraAddress`, `protocol`, `connectionTimeoutMs`, `healthCheckIntervalMs`, optional manufacturer/model metadata, and per-camera `savedPositions`. Existing position names and layout references are preserved. Each saved position may contain an explicit `hardwarePresetNumber` from 0 through 254; blank mappings remain valid configuration but cannot be recalled by hardware. The adapter never guesses a preset number.

Camera IDs, saved-position IDs, and saved-position names remain immutable through the configuration command. Host, port, address, timeout, interval, adapter type, and preset numbers are validated before a production snapshot is committed. Runtime connectivity and errors remain exclusively in Device Manager and are never persisted into camera configuration. Adapter-setting changes take effect on the next application start.

### Startup, Health, and Shutdown

At startup, migration adds safe simulation defaults and preserves existing camera records. The factory registers simulation cameras and one VISCA adapter per configured network camera. Each enabled VISCA camera starts one non-overlapping health check on a configurable interval (15 seconds by default); individual requests default to a 1.5-second timeout. Success updates `lastSeen`, last-success time, and Connected state. Failure records the error, increments health-check reconnect attempts, and leaves other cameras and commands running.

On application shutdown, the camera adapter registry clears health timers and closes all active sockets. Tests use both transport doubles and controllable local TCP servers; no physical camera is required.

Current limitations are deliberate: there is no camera discovery, preset creation, joystick pan/tilt, zoom, focus, auto-tracking, ONVIF, NDI, vendor web API, UDP/Sony VISCA encapsulation, video transport, or browser camera command endpoint.

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
4. The engine requests a capability from the Device Manager, which coordinates the registered adapter.
5. The engine updates its snapshot, increments the revision, and persists through the existing JSON callback.
6. The engine publishes state, activity, or error events.
7. Electron forwards state events through preload to the Production Console.
8. The local-network server broadcasts the same committed event to browser clients over SSE.

## Local-network transport

`src/server/local-network-server.cjs` uses Node's built-in HTTP server and binds to `0.0.0.0` on port `4310` by default. `TRINITY_REMOTE_PORT` can select a different port. It serves the existing `public` application, exposes the current authoritative snapshot at `GET /api/state`, and streams state-change events at `GET /api/events`.

`public/remote-client.js` supplies the same state-loading and subscription shape used by the renderer when Electron's preload bridge is absent. It maps browser connectivity to `connected`, `reconnecting`, and `offline`. Electron keeps its existing IPC bridge and reports `connected` locally. Runtime devices are exposed separately at `GET /api/devices` and as `devices-changed` SSE events.

SSE is intentionally one-way: only the PC's Production Engine can commit state. Authentication, remote command authorization, discovery, TLS, and an iPad-specific presentation remain future work. The HTTP server logs its listening addresses and client connection lifecycle.

The preload bridge keeps request-response methods for compatibility and adds unsubscribe-capable event subscriptions. The renderer requests cue, camera-take, and lighting-override operations; it no longer owns cue-transition timing.

## Interface Capability Model

The Production Console and browser Operator Interface use the same renderer, state mapping, formatting helpers, and page functions. `public/interface-model.js` defines explicit capabilities and derives navigation and read-only view models from them. Pages adapt to capabilities rather than checking whether the runtime is Electron or a browser.

The Production Console receives the complete capability set. It is responsible for live operation, camera recall, service and look editing, lighting control, and system configuration. Its Electron IPC transport and existing desktop behavior remain unchanged.

Its read-only Device Registry configuration view displays generic Device Manager records and health without exposing adapter instances or editing controls. Browser Operator Mode does not expose Configuration; the camera availability it displays is derived from Device Manager runtime state.

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

Camera IDs and lighting-scene IDs are immutable because other production records reference them. Camera saved-position IDs and names are also immutable because layouts reference their names. Observed camera connectivity is runtime Device Manager state rather than configuration. Record creation and deletion are deferred until reference-integrity and live-safety rules are defined.

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
