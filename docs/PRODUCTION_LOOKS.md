# Production Looks 2.0

Production Looks are reusable, hardware-independent descriptions of a desired production state. Schema version 2 prepares Trinity Control for external adapters without coupling saved services to QLC+, ATEM, PTZ, Motion Studio, presentation, or audio APIs.

## Schema

Each normalized Look contains:

- identity: `id`, `name`, `description`, `color`, `enabled`, `createdAt`, `updatedAt`
- lighting: `lightingSceneId`, `lightingFadeMs`, `stageWashMode`, `wallWashMode`
- video: legacy-compatible `cameraLayoutId`, `programCameraId`, `previewCameraId`, `transitionStyle`, `transitionDurationMs`
- cameras: `cameraAssignments` by logical role and optional `selectedShotId`
- motion: `motionProfileId`, `motionDurationMs`, `motionSpeed`, `motionEnabled`
- future references: `audioSceneId`, `presentationCueId`
- metadata: `tags`, `operatorNotes`

Resource references are nullable. A saved Look remains valid when optional hardware or library resources are unavailable.

## Migration

The main process normalizes every saved Look to schema version 2. Migration preserves IDs, names, legacy resource selections, unknown legacy properties, and all cue references. It supplies deterministic safe defaults and is idempotent. Legacy direct PROGRAM/PREVIEW camera IDs are copied into empty role assignments, without deleting the original fields. Role names are case-insensitive and `aux` is normalized to `auxiliary`.

## Cue precedence

Resource resolution is explicit:

1. a valid cue-specific camera-layout override
2. a valid modern Production Look `cameraAssignments` role
3. a valid legacy direct PROGRAM/PREVIEW camera field
4. a valid legacy Production Look camera layout
5. the safe unassigned state

Invalid references generate execution-plan warnings. Editing a Look never edits a cue, and deleting a referenced Look never silently clears the cue reference.

## Execution plan

`buildCueExecutionPlan(state, cue)` is pure and returns cue and Look identity, lighting intent with fade and source, video intent with transition and source, logical camera assignments, motion intent, future integration references, and warnings. Optional missing resources never cause the builder to throw.

GO, NEXT, and BACK continue to call `executeCue()`. The plan is a foundation for future adapters, not a parallel executor.

## Integration boundaries

No external hardware communication is included yet. Future adapters can consume the plan for:

- QLC+ lighting scene and fade execution
- ATEM program/preview switching and transitions
- PTZ preset recalls by logical role
- Motion Studio profiles
- audio scene recalls
- presentation cue triggers

Adapters should report execution results separately and must not mutate Production Looks or cue overrides.

## Camera Manager compatibility

Camera assignments are the authoritative PROGRAM, PREVIEW, and AUXILIARY selections in the editor and runtime. They reference stable camera device IDs and optional preset IDs. Camera Manager resolves their human-readable names without rewriting the Look. Deleted or unavailable cameras and presets remain visible as warnings, while a valid legacy selection can still provide a compatibility fallback.

Editing camera capabilities, operational metadata, or presets does not mutate a Production Look or cue. Cue-specific camera-layout overrides retain precedence, execution-plan generation remains pure, and no preset recall or camera switching is activated by Camera Manager.

## Executed state versus edited state

When GO, NEXT, BACK, or a confirmed direct jump executes a cue, `executeCue()` stores a normalized hardware-independent `live.executionSnapshot` derived from the pure execution plan. The snapshot records cue and Look identity, resolved lighting and video names, fade and wash modes, layout and preset details, motion intent, source labels, warnings, and execution time.

The Live page and Browser Operator show this executed snapshot for the active cue. PROGRAM, PREVIEW, and AUXILIARY tile roles are derived from stable camera IDs in that snapshot, never camera array order. Editing any Production Look—including the Look referenced by the active cue—does not change the displayed executed state. The edited values appear only after that cue executes again. This prevents Trinity from implying that hardware changed when no execution occurred.
