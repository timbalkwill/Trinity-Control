# Camera Manager foundation

## Purpose

Camera Manager is Trinity Control's operational view of configured cameras. Device Configuration owns hardware identity, network settings, credentials, model, enable state, and logical role. Camera Manager owns the operator-facing projection of capabilities, presets, readiness, diagnostics, and current known state.

Both layers use camera IDs from `state.devices`. There is no second camera identity system.

## Camera experience

Main, Left, and Right are prioritized when their logical roles are present. They are defaults, not a fixed limit. Any additional camera device follows in configured order, and custom roles are supported.

Each detail view shows overview, capability, preset, status, diagnostic, and future-control information. Network and credential editing links back to **Settings → Cameras**.

## Capability model

Capabilities cover pan/tilt, zoom, focus, preset recall, preset save, tracking, motion, tally, and preview. Each resolves to Supported, Not supported, Unknown, or Adapter required. Values may be manually configured or conservatively inferred from device flags. Inference never claims hardware detection.

## Preset model and migration

`state.cameraPresets` uses schema version 1. A preset retains its ID, name, number, camera device ID, logical role, enable and favorite state, custom category/group, notes, and timestamps.

When the collection is absent, legacy camera `savedPositions` migrate deterministically. Existing IDs and preset numbers survive. A deterministic ID is generated only when a legacy position has none. Presets whose camera is missing remain saved and repairable. Repeated migration does not duplicate records.

Preset operations are narrow, serialized, saved immediately, and broadcast from the authoritative main process. Search, category filters, favorites, per-camera ordering, duplicate, edit, disable, and deletion are supported. Referenced deletion requires confirmation and never clears the reference.

## Compatibility and security

Legacy camera records remain resolvable alongside their camera devices. Production Looks, layouts, and cues retain all camera and preset references. Missing resources produce labels or warnings instead of crashes. Cue-specific camera overrides and the single `executeCue()` runtime path are unchanged.

Browser Operator receives read-only camera readiness and preset summary records needed for operation. Passwords, credential references, usernames, IP/host configuration, private device notes, capability internals, and full preset notes remain desktop-only.

## Future integration

No PTZ traffic, preview stream, preset recall, switching, tracking control, tally, calibration, or motion execution is included. The model prepares future Shot Library, Motion Studio, PTZ adapter, tracking, tally, firmware, preview, and calibration work without coupling saved services to a hardware vendor.
