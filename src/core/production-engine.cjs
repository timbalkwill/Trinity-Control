const { EventBus } = require("./event-bus.cjs");
const { assertAdapterContract } = require("../adapters/contracts.cjs");
const { DEVICE_STATES, DEVICE_TYPES, DeviceManager } = require("./device-manager.cjs");
const { StateStore } = require("./state-store.cjs");

const ENGINE_EVENTS = Object.freeze({
  STATE_CHANGED: "production:state-changed",
  ACTIVITY: "production:activity",
  ERROR: "production:error"
});

const clone = value => JSON.parse(JSON.stringify(value));

class ProductionEngine {
  constructor({ initialState, stateStore, eventBus, deviceManager, persistState } = {}) {
    this.eventBus = eventBus || new EventBus();
    this.stateStore = stateStore || new StateStore(initialState);
    this.commandState = null;
    this.persistState = persistState;
    this.deviceManager = deviceManager || new DeviceManager();
    this.commandHandlers = new Map();
    this.commandQueue = Promise.resolve();
    this.transitionGeneration = 0;
    this.pendingTimers = new Set();

    this.registerBuiltInCommands();
  }

  getSnapshot() {
    return this.stateStore.getSnapshot();
  }

  subscribe(eventName, subscriber) {
    return this.eventBus.subscribe(eventName, subscriber);
  }

  registerAdapter(subsystem, adapter) {
    if (typeof subsystem !== "string" || !subsystem) {
      throw new TypeError("Adapter subsystem must be a non-empty string");
    }
    assertAdapterContract(subsystem, adapter);
    const type = {
      camera: DEVICE_TYPES.CAMERA,
      videoSwitcher: DEVICE_TYPES.VIDEO_SWITCHER,
      lighting: DEVICE_TYPES.LIGHTING
    }[subsystem] || DEVICE_TYPES.UNKNOWN;
    this.deviceManager.registerDevice({
      id: `legacy-${subsystem}`,
      name: `${subsystem} adapter`,
      type,
      connectionState: adapter.mode === "simulation" ? DEVICE_STATES.SIMULATION : DEVICE_STATES.UNKNOWN,
      statusMessage: "Registered through compatibility adapter path",
      supportsReconnect: false,
      supportsConfiguration: false,
      supportsHealthMonitoring: false,
      supportedCapabilities: [subsystem]
    }, adapter);
    return adapter;
  }

  getAdapter(subsystem) {
    return this.deviceManager.getAdapterByCapability(subsystem);
  }

  registerDeviceAdapter(adapter) {
    if (!adapter || typeof adapter.register !== "function") {
      throw new TypeError("Device adapter must implement register(deviceManager)");
    }
    adapter.register(this.deviceManager);
    return adapter;
  }

  getDevices() {
    return this.deviceManager.getDevices();
  }

  registerCommand(commandType, handler) {
    if (typeof commandType !== "string" || !commandType) {
      throw new TypeError("Command type must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new TypeError(`Handler for ${commandType} must be a function`);
    }
    this.commandHandlers.set(commandType, handler);
  }

  dispatch(command) {
    const operation = this.commandQueue.then(() => this.execute(command));
    this.commandQueue = operation.catch(() => undefined);
    return operation;
  }

  async execute(command) {
    const type = command?.type;
    const handler = this.commandHandlers.get(type);

    if (!handler) {
      const error = new Error(`Unknown production command: ${type || "(missing)"}`);
      this.publishError(type, error);
      throw error;
    }

    try {
      this.commandState = this.stateStore.getSnapshot();
      const changed = await handler(command.payload || {}, command);
      if (changed !== false) await this.commit(type);
      return this.getSnapshot();
    } catch (error) {
      this.publishError(type, error);
      throw error;
    } finally {
      this.commandState = null;
    }
  }

  async replaceSnapshot(nextState, reason = "CompatibilityStateSave") {
    return this.dispatch({
      type: "ReplaceSnapshot",
      payload: { state: nextState, reason }
    });
  }

  registerBuiltInCommands() {
    this.registerCommand("ReplaceSnapshot", async ({ state }) => {
      if (!state || typeof state !== "object") {
        throw new TypeError("Replacement state must be an object");
      }
      this.commandState = clone(state);
      this.commandState.revision = this.stateStore.getRevision();
      this.transitionGeneration += 1;
    });

    this.registerCommand("ActivateCue", ({ index }) => this.activateCue(index));
    this.registerCommand("NextCue", () => this.activateCue(this.commandState.live.cueIndex + 1));
    this.registerCommand("PreviousCue", () => this.activateCue(this.commandState.live.cueIndex - 1));

    this.registerCommand("SetHold", ({ hold }) => {
      this.commandState.live.hold = Boolean(hold);
      this.addActivity(`Hold ${this.commandState.live.hold ? "enabled" : "released"}`);
    });

    this.registerCommand("TakeCamera", payload => this.takeCamera(payload));
    this.registerCommand("SetLightingOverride", payload => this.setLightingOverride(payload));
    this.registerCommand("ReleaseLightingOverride", () => this.releaseLightingOverride());
    this.registerCommand("UpdateCameraConfiguration", payload => this.updateCameraConfiguration(payload));
    this.registerCommand("UpdateLightingSceneConfiguration", payload => this.updateLightingSceneConfiguration(payload));

    this.registerCommand("CompleteCueTransition", async payload => {
      if (payload.generation !== this.transitionGeneration) return false;
      await this.completeCueTransition(payload);
      return true;
    });
  }

  async activateCue(requestedIndex) {
    const cues = this.commandState.runOfService || [];
    if (!cues.length) return false;

    const index = Math.max(0, Math.min(Number(requestedIndex) || 0, cues.length - 1));
    const cue = cues[index];
    const look = this.findById(this.commandState.productionLooks, cue.productionLookId);
    const layout = this.findById(
      this.commandState.cameraLayouts,
      cue.cameraLayoutId || look?.cameraLayoutId
    );
    const lightingSceneId = cue.lightingSceneId || look?.lightingSceneId || null;
    const transition = this.cueTransition(cue);
    const previousProgramCamera = this.commandState.live.programCamera;
    const previousProgramPreset = this.commandState.live.programPreset;
    const generation = ++this.transitionGeneration;

    this.commandState.live.cueIndex = index;
    this.commandState.live.cueStartedAt = Date.now();
    this.commandState.live.lastLightingSceneId = lightingSceneId;
    this.commandState.live.lightingOverrideId = cue.lightingSceneId || null;

    if (lightingSceneId) {
      await this.getAdapter("lighting")?.applyScene?.({ sceneId: lightingSceneId });
    }

    if (layout) {
      await this.prepareCamera(layout.programCamera, layout.programPreset);
      await this.prepareCamera(layout.previewCamera, layout.previewPreset);
      this.commandState.live.previewCamera = layout.programCamera || this.commandState.live.previewCamera;
      this.commandState.live.previewPreset = layout.programPreset || "Stage Wide";
      if ("tracking" in layout) this.commandState.live.tracking = Boolean(layout.tracking);
    }

    this.addActivity(`Cue started: ${cue.name || "Cue"}`);
    this.addActivity(`Preparing cue: ${cue.name || "Cue"}`);

    const completion = {
      generation,
      cueId: cue.id,
      cueName: cue.name || "Cue",
      layout,
      transition,
      previousProgramCamera,
      previousProgramPreset
    };

    if (transition.waitForPTZ && transition.mode !== "none" && transition.delay > 0) {
      this.scheduleTransition(completion, transition.delay);
    } else {
      await this.completeCueTransition(completion);
    }
  }

  async prepareCamera(cameraId, preset) {
    if (!cameraId) return;
    await this.getAdapter("camera")?.recallPreset?.({ cameraId, preset });
    const camera = this.findById(this.commandState.cameras, cameraId);
    if (camera) camera.lastPreset = preset || "Stage Wide";
  }

  scheduleTransition(completion, delay) {
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.dispatch({ type: "CompleteCueTransition", payload: completion }).catch(() => undefined);
    }, delay);
    this.pendingTimers.add(timer);
  }

  async completeCueTransition({ cueId, cueName, layout, transition, previousProgramCamera, previousProgramPreset }) {
    if (transition.mode === "none") {
      this.commandState.live.programCamera = previousProgramCamera;
      this.commandState.live.programPreset = previousProgramPreset;
    } else if (layout) {
      await this.getAdapter("videoSwitcher")?.take?.({
        cameraId: layout.programCamera,
        mode: transition.mode
      });
      this.commandState.live.programCamera = layout.programCamera || this.commandState.live.programCamera;
      this.commandState.live.programPreset = layout.programPreset || "Stage Wide";
      this.commandState.live.previewCamera = layout.previewCamera || this.commandState.live.previewCamera;
      this.commandState.live.previewPreset = layout.previewPreset || "Stage Wide";
    }

    this.commandState.live.lastTransition = {
      cueId,
      mode: transition.mode,
      waitForPTZ: transition.waitForPTZ,
      delay: transition.delay,
      completedAt: Date.now()
    };
    const delayLabel = transition.waitForPTZ && transition.mode !== "none"
      ? ` after ${(transition.delay / 1000).toFixed(1)}s`
      : "";
    this.addActivity(`${this.transitionLabel(transition.mode)}: ${cueName}${delayLabel}`);
  }

  async takeCamera({ cameraId, preset }) {
    const camera = this.findById(this.commandState.cameras, cameraId);
    if (!camera) throw new Error(`Unknown camera: ${cameraId}`);
    if (cameraId === this.commandState.live.programCamera && !preset) return false;

    this.transitionGeneration += 1;
    const previousProgram = this.commandState.live.programCamera;
    const previousPreset = this.commandState.live.programPreset;
    const selectedPreset = preset || camera.lastPreset || "Stage Wide";

    await this.prepareCamera(cameraId, selectedPreset);
    await this.getAdapter("videoSwitcher")?.take?.({ cameraId, mode: "cut" });

    this.commandState.live.programCamera = cameraId;
    this.commandState.live.programPreset = selectedPreset;
    this.commandState.live.previewCamera = previousProgram;
    this.commandState.live.previewPreset = previousPreset;
    this.addActivity(`Camera live: ${camera.name || cameraId}`);
  }

  async setLightingOverride({ sceneId }) {
    const scene = this.findById(this.commandState.lightingScenes, sceneId);
    if (!scene) throw new Error(`Unknown lighting scene: ${sceneId}`);
    await this.getAdapter("lighting")?.applyScene?.({ sceneId });
    this.commandState.live.lightingOverrideId = sceneId;
    this.addActivity(`Lighting scene: ${scene.name || sceneId}`);
  }

  async releaseLightingOverride() {
    const sceneId = this.commandState.live.lastLightingSceneId || this.effectiveCueLightingId();
    await this.getAdapter("lighting")?.releaseOverride?.({ sceneId });
    this.commandState.live.lightingOverrideId = null;
    this.addActivity("Returned to cue lighting");
  }

  updateCameraConfiguration({ cameraId, changes }) {
    const camera = this.findById(this.commandState.cameras, cameraId);
    if (!camera) throw new Error(`Unknown camera: ${cameraId}`);
    if (!changes || typeof changes !== "object") {
      throw new TypeError("Camera configuration changes must be an object");
    }
    this.assertAllowedChanges(changes, ["name", "role", "enabled", "lastPreset"], "camera");

    if (Object.hasOwn(changes, "name")) camera.name = this.requiredText(changes.name, "Camera name");
    if (Object.hasOwn(changes, "role")) camera.role = this.requiredText(changes.role, "Camera role");
    if (Object.hasOwn(changes, "enabled")) camera.enabled = Boolean(changes.enabled);
    if (Object.hasOwn(changes, "lastPreset")) camera.lastPreset = this.requiredText(changes.lastPreset, "Camera preset");

    this.addActivity(`Camera configuration updated: ${camera.name}`);
  }

  updateLightingSceneConfiguration({ sceneId, changes }) {
    const scene = this.findById(this.commandState.lightingScenes, sceneId);
    if (!scene) throw new Error(`Unknown lighting scene: ${sceneId}`);
    if (!changes || typeof changes !== "object") {
      throw new TypeError("Lighting configuration changes must be an object");
    }
    this.assertAllowedChanges(
      changes,
      ["name", "category", "room", "favorite", "platform", "fill", "ceiling", "house", "fade"],
      "lighting scene"
    );

    for (const field of ["name", "category", "room"]) {
      if (Object.hasOwn(changes, field)) {
        scene[field] = this.requiredText(changes[field], `Lighting ${field}`);
      }
    }
    if (Object.hasOwn(changes, "favorite")) scene.favorite = Boolean(changes.favorite);
    for (const field of ["platform", "fill", "ceiling", "house"]) {
      if (Object.hasOwn(changes, field)) scene[field] = this.boundedNumber(changes[field], field, 0, 100);
    }
    if (Object.hasOwn(changes, "fade")) scene.fade = this.boundedNumber(changes.fade, "fade", 0, 60);

    this.addActivity(`Lighting configuration updated: ${scene.name}`);
  }

  requiredText(value, label) {
    const normalized = String(value ?? "").trim();
    if (!normalized) throw new Error(`${label} cannot be empty`);
    return normalized;
  }

  assertAllowedChanges(changes, allowedFields, label) {
    const allowed = new Set(allowedFields);
    const unsupported = Object.keys(changes).filter(field => !allowed.has(field));
    if (unsupported.length) {
      throw new Error(`Unsupported ${label} configuration fields: ${unsupported.join(", ")}`);
    }
  }

  boundedNumber(value, label, minimum, maximum) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) throw new Error(`${label} must be a number`);
    return Math.min(maximum, Math.max(minimum, normalized));
  }

  effectiveCueLightingId() {
    const cue = this.commandState.runOfService?.[this.commandState.live.cueIndex];
    const look = this.findById(this.commandState.productionLooks, cue?.productionLookId);
    return cue?.lightingSceneId || look?.lightingSceneId || null;
  }

  cueTransition(cue) {
    return {
      mode: cue?.transition?.mode || "auto",
      waitForPTZ: cue?.transition?.waitForPTZ === undefined
        ? true
        : Boolean(cue.transition.waitForPTZ),
      delay: Number.isFinite(Number(cue?.transition?.delay))
        ? Math.max(0, Number(cue.transition.delay))
        : 800
    };
  }

  transitionLabel(mode) {
    return ({ auto: "AUTO", cut: "CUT", fade: "FADE TO BLACK", none: "NO SWITCH" })[mode] || "AUTO";
  }

  findById(items, id) {
    return (items || []).find(item => item.id === id);
  }

  addActivity(message) {
    const activity = { at: Date.now(), message };
    this.commandState.live.activityLog = [activity, ...(this.commandState.live.activityLog || [])].slice(0, 8);
    this.eventBus.publish(ENGINE_EVENTS.ACTIVITY, {
      type: "activity",
      activity: clone(activity)
    });
  }

  publishError(commandType, error) {
    this.eventBus.publish(ENGINE_EVENTS.ERROR, {
      type: "error",
      commandType: commandType || null,
      message: error.message,
      at: Date.now()
    });
  }

  async commit(commandType) {
    const snapshot = this.stateStore.commit(this.commandState);
    await this.persistState?.(snapshot);
    this.eventBus.publish(ENGINE_EVENTS.STATE_CHANGED, {
      type: "state-changed",
      commandType,
      revision: snapshot.revision,
      state: snapshot
    });
  }

  dispose() {
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
    this.eventBus.clear();
  }
}

module.exports = { ENGINE_EVENTS, ProductionEngine };
