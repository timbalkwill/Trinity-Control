# Device configuration foundation

## Schema

`state.devices` is a versioned ordered collection. Every record has identity, type, name, enable/status state, timestamps, notes, connection fields, capabilities, and metadata. Supported initial types are `camera`, `lighting`, `switcher`, `audio`, `presentation`, and `browserOperator`.

Camera records add a string `logicalRole`, manufacturer/model, IP address, port, protocol, username, credential reference or password, tracking and motion flags, preset support, connection status, last-check time, and last error.

Device identity is always the record ID. Array position is presentation order only.

## Defaults and migration

A new installation starts with enabled Main, Left, and Right camera records using IDs and logical roles `main`, `left`, and `right`. Disabled placeholders are created for QLC+, ATEM, X32, Presentation System, and Browser Operator.

When device configuration is absent, migration derives camera devices from the existing camera library so all camera IDs and references survive. If a device collection already exists, it is normalized in place without appending defaults or replacing edited records. Repeated migration is idempotent.

## Expandable cameras and roles

The model supports any number of cameras. Cameras can be added, renamed, enabled, disabled, reordered, duplicated, or safely deleted. Logical roles are free-form strings. The UI suggests `main`, `left`, `right`, `audience`, `pastor`, and `choir`, while accepting custom roles.

Two enabled cameras may share a role, but validation and Settings show a warning. Trinity never resolves that warning by rewriting state automatically.

## Settings and production separation

Structural configuration is available only in the Electron **Settings** area through restricted preload IPC. Live pages remain focused on service operation. Browser Operator has no device editor.

Every mutation loads the latest saved state, applies one narrow change through `device-operations.cjs`, saves immediately, and broadcasts the authoritative result.

## Security boundary

Browser state is explicitly projected. It may include minimal operational summaries containing device ID, type, display name, logical role, enable state, and connection-status label. It excludes:

- passwords and credential references
- usernames
- private device notes
- full connection/network configuration
- system configuration

The projection applies to initial state, command responses, and SSE events.

## Reference behavior

Before deletion, Trinity counts references from Production Looks, logical camera assignments, camera layouts, cues, presets, Shots, and reserved direct camera fields. Referenced deletion requires confirmation. Confirmation removes only the device; it never clears or rewrites Production Looks, Shots, or cues. Intentional missing references remain visible for repair.

Production-facing summaries prefer a matching device name and fall back to the legacy camera library. Missing devices generate warnings rather than crashes.

## Diagnostic adapter contract

Diagnostics stores a timestamped stub result per device. Current outcomes are:

- **Not configured**
- **Disabled**
- **Adapter not implemented**
- **Ready for future test**

No current diagnostic opens a socket or claims a hardware connection.

Future PTZ, QLC+, ATEM, X32, and presentation adapters should consume validated configuration and report real results without mutating device identity, Production Looks, cues, or execution plans.

## Camera Manager boundary

Device Configuration answers what camera hardware exists and how it connects. Camera Manager uses the same camera device IDs to describe operational capabilities, presets, readiness, and known live state. It never duplicates credential or network editing.

Camera Manager metadata lives under `device.metadata.cameraManager`; presets live in the separate versioned `state.cameraPresets` collection. Editing a capability or preset does not rewrite the camera device identity, Production Looks, or cues.

Shot Library targets a stable camera device ID or logical role. A role-only Shot resolves conservatively at execution time. Specific camera references participate in deletion counts and remain missing if the camera is removed.
