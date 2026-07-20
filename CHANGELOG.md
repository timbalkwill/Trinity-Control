## Alpha 6 Phase 1

- Added an authoritative in-memory Production Engine with serialized command dispatch and state revisions.
- Added a modular Event Bus for state, activity, and error events.
- Added validated simulation adapter contracts for camera/PTZ, video switching, and lighting.
- Routed cue activation, camera takes, and lighting overrides through the engine.
- Added engine-to-renderer state events while retaining compatibility request-response APIs.
- Added automated tests for engine sequencing, revisions, live commands, events, and stale delayed work.

## 1.0.2-alpha.5.2
- Refined the Live console without changing the core layout.
- Added a live time-in-cue counter that resets whenever a cue is selected.
- Removed estimated cue duration and countdown-to-next-cue concepts.
- Added next-cue, notes, activity log, and system-status information.
- Preserved three-camera switching, favorite lighting controls, and Service-only drag-and-drop ordering.
# Changelog

## 1.0.1-alpha.5.1

- Added drag-and-drop cue reordering on the Service page.
- Removed the up/down reordering arrows.
- Kept the Live page cue list selection-only with no reordering.
- Preserved the currently active cue when other cues are moved around it.

## 1.0.0-alpha.5

- Created a clean, separate Trinity Control refresh project.
- Added three direct-take camera monitor panels.
- Added Worship 1, Worship 2, and Worship 3 cues and production looks.
- Removed sequential transport controls from the Live page.
- Fixed page scrolling around the persistent navigation bar.
- Added visible startup error reporting instead of a silent blank window.
