const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRODUCTION_LOOK_SCHEMA_VERSION,
  createProductionLook,
  deleteProductionLook,
  duplicateProductionLook,
  normalizeProductionLook,
  resolveProductionLookCameraAssignments,
  resolveProductionLookResources,
  summarizeProductionLook,
  updateProductionLook,
  validateProductionLook
} = require("../production-look-operations.cjs");
const { buildCueExecutionPlan } = require("../cue-execution-plan.cjs");

function fixture() {
  return {
    cameras: [{ id: "main", name: "Main" }, { id: "left", name: "Left" }],
    cameraPresets: [{ id: "wide", name: "Wide" }, { id: "tight", name: "Tight" }],
    lightingScenes: [{ id: "warm", name: "Warm" }, { id: "blue", name: "Blue" }],
    cameraLayouts: [{ id: "layout", name: "Layout", programCamera: "main", previewCamera: "left", programPreset: "Wide", previewPreset: "Left" }],
    productionLooks: [],
    runOfService: []
  };
}

test("legacy Production Look migration preserves identity and selections", () => {
  const legacy = { id: "legacy", name: "Legacy", lightingSceneId: "warm", cameraLayoutId: "layout", graphics: "Lyrics", houseLights: 30 };
  const migrated = normalizeProductionLook(legacy);
  assert.equal(migrated.schemaVersion, PRODUCTION_LOOK_SCHEMA_VERSION);
  assert.equal(migrated.id, "legacy");
  assert.equal(migrated.name, "Legacy");
  assert.equal(migrated.lightingSceneId, "warm");
  assert.equal(migrated.cameraLayoutId, "layout");
  assert.equal(migrated.graphics, "Lyrics");
  assert.equal(migrated.houseLights, 30);
  assert.equal(migrated.enabled, true);
  assert.deepEqual(migrated.cameraAssignments, []);
});

test("migration is idempotent and tolerates null fields", () => {
  const migrated = normalizeProductionLook({ id: "one", name: "One", lightingSceneId: null, tags: null });
  assert.deepEqual(normalizeProductionLook(migrated), migrated);
  assert.equal(migrated.lightingSceneId, null);
  assert.deepEqual(migrated.tags, []);
});

test("migration canonicalizes roles and preserves legacy camera selections", () => {
  const migrated = normalizeProductionLook({
    id: "one",
    name: "One",
    programCameraId: "main",
    previewCameraId: "left",
    cameraAssignments: [
      { role: "PROGRAM", cameraId: "", presetId: "wide" },
      { role: "Aux", cameraId: "left", presetId: "tight" }
    ]
  });
  assert.deepEqual(migrated.cameraAssignments, [
    { role: "program", cameraId: "main", presetId: "wide", shotId: null },
    { role: "auxiliary", cameraId: "left", presetId: "tight", shotId: null },
    { role: "preview", cameraId: "left", presetId: null, shotId: null }
  ]);
  assert.deepEqual(normalizeProductionLook(migrated), migrated);
});

test("modern camera assignments are authoritative over legacy fields and layouts", () => {
  const state = fixture();
  const look = {
    id: "look",
    cameraLayoutId: "layout",
    programCameraId: "left",
    previewCameraId: "main",
    cameraAssignments: [
      { role: "PROGRAM", cameraId: "main", presetId: "wide" },
      { role: "preview", cameraId: "left", presetId: "tight" },
      { role: "AUX", cameraId: "main" }
    ]
  };
  const resolved = resolveProductionLookCameraAssignments(state, look);
  assert.equal(resolved.programCameraId, "main");
  assert.equal(resolved.previewCameraId, "left");
  assert.deepEqual(resolved.auxiliaryCameraIds, ["main"]);
  assert.equal(resolved.program.presetName, "Wide");
  assert.equal(resolved.preview.presetName, "Tight");
});

test("legacy direct selections and layout remain deterministic fallbacks", () => {
  const state = fixture();
  const direct = resolveProductionLookCameraAssignments(state, { programCameraId: "main", previewCameraId: "left", cameraAssignments: [] });
  assert.equal(direct.program.source, "legacy-video");
  assert.equal(direct.preview.source, "legacy-video");
  const layout = resolveProductionLookCameraAssignments(state, { cameraLayoutId: "layout", cameraAssignments: [] });
  assert.equal(layout.program.source, "legacy-layout");
  assert.equal(layout.preview.source, "legacy-layout");
});

test("invalid modern assignments warn and fall through to valid legacy selections", () => {
  const state = fixture();
  const resolved = resolveProductionLookCameraAssignments(state, {
    programCameraId: "main",
    previewCameraId: "left",
    cameraAssignments: [{ role: "program", cameraId: "missing" }]
  });
  assert.equal(resolved.programCameraId, "main");
  assert.equal(resolved.previewCameraId, "left");
  assert.ok(resolved.warnings.some(warning => warning.includes("Missing program camera")));
});

test("cue camera layout overrides Production Look camera assignments", () => {
  const state = fixture();
  const resolved = resolveProductionLookCameraAssignments(state, {
    cameraAssignments: [
      { role: "program", cameraId: "left" },
      { role: "preview", cameraId: "main" }
    ]
  }, { cameraLayoutId: "layout" });
  assert.equal(resolved.programCameraId, "main");
  assert.equal(resolved.previewCameraId, "left");
  assert.equal(resolved.program.source, "cue");
});

test("create, update, duplicate, and delete use isolated objects", () => {
  const state = fixture();
  const created = createProductionLook(state, { name: "Created", tags: ["one"], cameraAssignments: [{ role: "program", cameraId: "main", presetId: "Wide" }] }, { id: "created", now: 1000 });
  assert.equal(created.id, "created");
  updateProductionLook(state, "created", { description: "Updated" }, { now: 2000 });
  const duplicate = duplicateProductionLook(state, "created", { id: "copy", now: 3000 });
  assert.equal(duplicate.id, "copy");
  assert.equal(duplicate.name, "Created Copy");
  duplicate.tags.push("copy-only");
  duplicate.cameraAssignments[0].presetId = "Tight";
  assert.deepEqual(state.productionLooks[0].tags, ["one"]);
  assert.equal(state.productionLooks[0].cameraAssignments[0].presetId, "Wide");
  deleteProductionLook(state, "copy");
  assert.deepEqual(state.productionLooks.map(look => look.id), ["created"]);
});

test("validation requires a non-empty name and accepts nullable resources", () => {
  assert.equal(validateProductionLook(normalizeProductionLook({ name: "" })).valid, false);
  assert.equal(validateProductionLook(normalizeProductionLook({ name: "Valid", lightingSceneId: null, programCameraId: null })).valid, true);
  assert.throws(() => createProductionLook(fixture(), { name: "  " }), /name is required/i);
});

test("referenced deletion requires confirmation and preserves cue references", () => {
  const state = fixture();
  createProductionLook(state, { id: "used", name: "Used" });
  state.runOfService.push({ id: "cue", productionLookId: "used" });
  assert.throws(() => deleteProductionLook(state, "used"), error => error.code === "CONFIRM_LOOK_DELETE" && error.references.length === 1);
  deleteProductionLook(state, "used", { confirmReferences: true });
  assert.equal(state.runOfService[0].productionLookId, "used");
});

test("resource resolution and summary handle missing optional resources", () => {
  const state = fixture();
  const look = normalizeProductionLook({ id: "look", name: "Look", lightingSceneId: "missing", programCameraId: "main", cameraAssignments: [{ role: "program", cameraId: "missing-camera", presetId: "Wide" }] });
  state.productionLooks.push(look);
  const resources = resolveProductionLookResources(state, look);
  assert.equal(resources.lightingScene, null);
  assert.equal(resources.programCamera.id, "main");
  assert.equal(resources.cameraAssignments[0].camera, null);
  assert.match(summarizeProductionLook(state, look).lighting, /Missing/);
});

test("execution plan applies cue override precedence over Production Look inheritance", () => {
  const state = fixture();
  state.productionLooks.push(normalizeProductionLook({ id: "look", name: "Look", lightingSceneId: "warm", cameraLayoutId: "layout", lightingFadeMs: 750, transitionStyle: "mix" }));
  const inherited = buildCueExecutionPlan(state, { id: "inherited", productionLookId: "look" });
  assert.equal(inherited.lighting.sceneId, "warm");
  assert.equal(inherited.lighting.source, "production-look");
  assert.equal(inherited.video.programCameraId, "main");
  const overridden = buildCueExecutionPlan(state, { id: "override", productionLookId: "look", lightingSceneId: "blue" });
  assert.equal(overridden.lighting.sceneId, "blue");
  assert.equal(overridden.lighting.source, "cue");
  assert.equal(overridden.lighting.fadeMs, 750);
});

test("direct Production Look camera selections retain inherited source", () => {
  const state = fixture();
  state.productionLooks.push(normalizeProductionLook({ id: "direct", name: "Direct", programCameraId: "main", previewCameraId: "left" }));
  const plan = buildCueExecutionPlan(state, { id: "cue", productionLookId: "direct" });
  assert.equal(plan.video.source, "production-look");
  assert.equal(plan.video.programCameraName, "Main");
  assert.equal(plan.video.previewCameraName, "Left");
});

test("execution plan reports missing resources without throwing", () => {
  const state = fixture();
  state.productionLooks.push(normalizeProductionLook({ id: "look", name: "Look", lightingSceneId: "missing", programCameraId: "gone", motionEnabled: true }));
  const plan = buildCueExecutionPlan(state, { id: "cue", productionLookId: "look", cameraLayoutId: "missing-layout" });
  assert.equal(plan.lighting.sceneId, null);
  assert.equal(plan.motion.enabled, true);
  assert.ok(plan.warnings.length >= 3);
});

test("updating a Look preserves cue references and cue overrides", () => {
  const state = fixture();
  createProductionLook(state, { id: "look", name: "Look", lightingSceneId: "warm" });
  state.runOfService.push({ id: "cue", productionLookId: "look", lightingSceneId: "blue" });
  updateProductionLook(state, "look", { lightingSceneId: null });
  assert.deepEqual(state.runOfService[0], { id: "cue", productionLookId: "look", lightingSceneId: "blue" });
});
