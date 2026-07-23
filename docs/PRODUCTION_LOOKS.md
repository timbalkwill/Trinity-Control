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

The main process normalizes every saved Look to schema version 2. Migration preserves IDs, names, legacy resource selections, unknown legacy properties, and all cue references. It supplies deterministic safe defaults for missing fields and is idempotent. The legacy `cameraLayoutId` remains supported so existing service execution and camera preset behavior do not change.

## Cue precedence

Resource resolution is explicit:

1. a valid cue-specific lighting or camera-layout override
2. a valid value inherited from the referenced Production Look
3. the existing safe `null`/runtime fallback

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

Camera assignments continue to reference stable camera device IDs and optional preset IDs. Camera Manager resolves their human-readable names without rewriting the Look. Deleted or unavailable cameras and presets remain visible as missing references.

Editing camera capabilities, operational metadata, or presets does not mutate a Production Look or cue. Cue-specific camera-layout overrides retain precedence, execution-plan generation remains pure, and no preset recall or camera switching is activated by Camera Manager.
