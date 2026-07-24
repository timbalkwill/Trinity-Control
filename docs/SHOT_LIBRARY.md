# Shot Library foundation

## Purpose

A Shot is a reusable framing concept such as **Pastor Tight**, **Choir Wide**, or **Baptistry**. It describes subject, framing, camera target, preset, tracking preference, motion intent, and operator metadata without belonging to a service, cue, Production Look, or hardware adapter.

A camera preset is a saved position on one physical camera. A Shot may reference that preset and either a stable camera device ID or logical role. A Production Look coordinates Shots with lighting and video roles. A cue determines when that Look executes.

## Schema and migration

`state.shots` is a versioned, ordered collection with stable IDs. Schema version 1 includes identity, categories/tags, favorite and enabled state, camera/preset references, framing, tracking and motion intent, operator metadata, and nullable future references. Unknown properties survive normalization.

A new installation receives ten deterministic starter Shots. Defaults are created only when `shots` has never been saved. A saved empty array is authoritative, repeated migration is idempotent, and deleted defaults are never recreated.

Suggested categories are Pastor, Platform, Music, Piano, Choir, Baptistry, Congregation, Wide, and Utility. Custom categories persist and join the filter list. Utility is only the display fallback for uncategorized Shots.

## Target resolution

`resolveShotTarget()` is pure and never rewrites a Shot:

1. use a valid enabled `cameraDeviceId`
2. otherwise resolve an enabled camera by `logicalCameraRole`
3. otherwise retain the Shot and report a missing or disabled camera
4. resolve `cameraPresetId` only when it belongs to the resolved camera
5. report missing, disabled, or mismatched presets without invalidating the Shot

Readiness labels are conservative and never claim hardware is connected.

## Production Look and execution

Each Production Look camera assignment may reference a `shotId` alongside explicit camera/preset compatibility fields. Resolution order is cue camera-layout override, valid Shot, explicit assignment, legacy direct camera fields, legacy Look layout, then unassigned.

The cue plan records role, Shot ID/name, camera, preset, tracking intent, motion intent, source, and warnings. `executeCue()` freezes those values into `live.executionSnapshot`. Editing a Shot never changes the executed display until the cue executes again.

## References and security

Shot deletion counts Production Looks, role assignments, cues, templates, and reserved Motion Studio references. Confirmed deletion removes only the Shot and preserves missing references. Camera and preset deletion likewise counts Shots and never rewrites them.

Browser Operator receives safe Shot names and execution intent. It does not receive full Shot records, private notes, calibration data, device configuration, network settings, or credentials.

## Current boundary

This foundation does not send PTZ commands, recall presets, switch ATEM inputs, show previews, control tracking, or execute motion. Future adapters consume the frozen plan without changing Shot identity or service data.
