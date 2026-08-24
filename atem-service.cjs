"use strict";

const CONNECTION_STATES = new Set(["disabled", "notConfigured", "connecting", "connected", "disconnected", "error"]);

function integerInput(value) {
  const input = Number(value);
  return Number.isInteger(input) && input >= 0 ? input : null;
}

function atemDevice(state) {
  return (state?.devices || []).find(device => device?.type === "switcher" &&
    (device.adapterType === "atem" || device.metadata?.adapter === "atem" || device.id === "device-atem")) || null;
}

function atemConfiguration(state) {
  const device = atemDevice(state);
  const rawMappings = device?.metadata?.atemCameraInputs;
  const cameraInputs = {};
  if (rawMappings && typeof rawMappings === "object") {
    for (const [cameraDeviceId, value] of Object.entries(rawMappings)) {
      const input = integerInput(value);
      if (cameraDeviceId && input !== null) cameraInputs[cameraDeviceId] = input;
    }
  }
  return {
    deviceId: device?.id || null,
    name: device?.name || "ATEM Mini Pro",
    enabled: device?.enabled === true,
    configured: Boolean(device?.ipAddress || device?.connection?.host),
    host: device?.ipAddress || device?.connection?.host || null,
    cameraInputs
  };
}

function cameraForProgramInput(configuration, programInput) {
  if (programInput === null || programInput === undefined) return null;
  return Object.entries(configuration.cameraInputs).find(([, input]) => input === programInput)?.[0] || null;
}

function programInputFromState(state) {
  return integerInput(state?.video?.mixEffects?.[0]?.programInput);
}

function mixEffectFromState(state) {
  const mixEffect = state?.video?.mixEffects?.[0];
  return {
    programInput: integerInput(mixEffect?.programInput),
    previewInput: integerInput(mixEffect?.previewInput),
    transitioning: mixEffect?.transitionPosition?.inTransition === true,
    remainingFrames: Number.isInteger(mixEffect?.transitionPosition?.remainingFrames) ? mixEffect.transitionPosition.remainingFrames : null
  };
}

function createDefaultClient() {
  const { Atem } = require("atem-connection");
  return new Atem();
}

function createAtemService({ getState, clientFactory = createDefaultClient, logger = console, confirmationTimeoutMs = 2000, transitionConfirmationTimeoutMs = 30000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof getState !== "function") throw new TypeError("getState is required");
  const subscribers = new Set();
  let client = null;
  let configuration = atemConfiguration(getState());
  let status = null;

  function snapshot(connectionState = status?.connectionState || "disconnected", patch = {}) {
    if (!CONNECTION_STATES.has(connectionState)) connectionState = "error";
    const programInput = connectionState === "connected" ? (patch.programInput ?? status?.programInput ?? null) : null;
    return Object.freeze({
      name: configuration.name,
      enabled: configuration.enabled,
      configured: configuration.configured,
      host: configuration.host,
      connectionState,
      programInput,
      previewInput: connectionState === "connected" ? (patch.previewInput ?? status?.previewInput ?? null) : null,
      transitioning: connectionState === "connected" && (patch.transitioning ?? status?.transitioning) === true,
      remainingFrames: connectionState === "connected" ? (patch.remainingFrames ?? status?.remainingFrames ?? null) : null,
      liveCameraId: connectionState === "connected" ? cameraForProgramInput(configuration, programInput) : null,
      cameraInputs: { ...configuration.cameraInputs },
      message: patch.message || null
    });
  }

  status = snapshot(configuration.enabled ? (configuration.configured ? "disconnected" : "notConfigured") : "disabled");

  function publish(next) {
    status = next;
    for (const subscriber of subscribers) {
      try { subscriber(status); } catch { /* A renderer subscriber cannot break ATEM state. */ }
    }
    return status;
  }

  function detach(current) {
    if (!current) return;
    current.removeAllListeners?.("connected");
    current.removeAllListeners?.("disconnected");
    current.removeAllListeners?.("stateChanged");
    current.removeAllListeners?.("error");
  }

  function bind(current) {
    current.on("connected", () => {
      publish(snapshot("connected", mixEffectFromState(current.state)));
    });
    current.on("disconnected", () => publish(snapshot("disconnected", { message: "ATEM disconnected" })));
    current.on("stateChanged", state => {
      const mixEffect = mixEffectFromState(state);
      if (mixEffect.programInput !== null) publish(snapshot("connected", mixEffect));
    });
    current.on("error", message => {
      logger.error?.(`[Trinity ATEM] ${String(message || "ATEM connection error")}`);
      publish(snapshot("error", { message: "ATEM communication error" }));
    });
  }

  async function closeClient() {
    const current = client;
    client = null;
    if (!current) return;
    detach(current);
    try { await current.disconnect?.(); }
    catch { /* Shutdown must remain bounded and safe. */ }
    try { await current.destroy?.(); }
    catch { /* Some injected clients do not implement destroy. */ }
  }

  async function initialize() {
    configuration = atemConfiguration(getState());
    await closeClient();
    if (!configuration.enabled) return publish(snapshot("disabled"));
    if (!configuration.configured) return publish(snapshot("notConfigured", { message: "ATEM host is not configured" }));
    client = clientFactory();
    bind(client);
    publish(snapshot("connecting"));
    try {
      await client.connect(configuration.host);
      return status;
    } catch {
      await closeClient();
      return publish(snapshot("error", { message: "Could not connect to the ATEM" }));
    }
  }

  async function reconfigure() {
    const next = atemConfiguration(getState());
    const connectionChanged = next.enabled !== configuration.enabled || next.configured !== configuration.configured || next.host !== configuration.host;
    const mappingChanged = JSON.stringify(next.cameraInputs) !== JSON.stringify(configuration.cameraInputs) || next.name !== configuration.name;
    configuration = next;
    if (connectionChanged) return initialize();
    if (mappingChanged) return publish(snapshot(status.connectionState, { programInput: status.programInput, message: status.message }));
    return status;
  }

  function waitForStatus(predicate, timeoutMs, timeoutMessage, timeoutCode) {
    let cancel = () => {};
    const pending = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        subscribers.delete(listener);
        error ? reject(error) : resolve(value);
      };
      const listener = next => {
        if (next.connectionState !== "connected") finish(Object.assign(new Error("ATEM disconnected during transition"), { code: "ATEM_CONFIRMATION_FAILED" }));
        else if (predicate(next)) finish(null, next);
      };
      const timer = setTimer(() => finish(Object.assign(new Error(timeoutMessage), { code: timeoutCode })), timeoutMs);
      cancel = () => finish(Object.assign(new Error("ATEM transition confirmation cancelled"), { code: "ATEM_CONFIRMATION_CANCELLED" }));
      subscribers.add(listener);
      listener(status);
    });
    pending.cancel = cancel;
    return pending;
  }

  async function takeInput(input, { transition = "mix", trace } = {}) {
    if (!configuration.enabled) throw Object.assign(new Error("ATEM is disabled"), { code: "ATEM_DISABLED" });
    if (!configuration.configured) throw Object.assign(new Error("ATEM is not configured"), { code: "ATEM_NOT_CONFIGURED" });
    if (status.connectionState !== "connected" || !client) throw Object.assign(new Error("ATEM is disconnected"), { code: "ATEM_DISCONNECTED" });
    input = integerInput(input);
    if (input === null) throw Object.assign(new Error("Video Source has no ATEM input mapping"), { code: "ATEM_MAPPING_MISSING" });
    if (status.programInput === input) return status;
    transition = String(transition || "mix").toLocaleLowerCase();
    if (!new Set(["mix", "cut"]).has(transition)) throw Object.assign(new Error("Unsupported video transition"), { code: "ATEM_TRANSITION_UNSUPPORTED" });
    trace?.mark("adapter_entry");
    let transitionStarted = false;
    const completion = waitForStatus(next => {
      if (next.transitioning) transitionStarted = true;
      return (transition === "cut" || transitionStarted) && !next.transitioning && next.programInput === input;
    }, transitionConfirmationTimeoutMs, "ATEM transition confirmation timed out", "ATEM_TRANSITION_TIMEOUT");
    const observeTransition = next => {
      if (next.previewInput === input) trace?.mark("preview_confirmed");
      if (next.transitioning) trace?.mark("transition_started");
      if (!next.transitioning && next.programInput === input) {
        trace?.mark("program_target");
        if (transition === "cut" || transitionStarted) trace?.mark("transition_complete");
      }
    };
    const unsubscribeTiming = trace ? (subscribers.add(observeTransition), () => subscribers.delete(observeTransition)) : () => {};
    try {
      if (typeof client.sendCommands === "function") {
        const { Commands, Enums } = require("atem-connection");
        const preview = new Commands.PreviewInputCommand(0, input);
        trace?.mark("preview_command");
        const commandBatch = [preview];
        if (transition === "mix") {
          const style = new Commands.TransitionPropertiesCommand(0);
          style.updateProps({ nextStyle: Enums.TransitionStyle.MIX });
          commandBatch.push(style, new Commands.AutoTransitionCommand(0));
          trace?.mark("transition_style_command");
          trace?.mark("auto_command");
        } else {
          commandBatch.push(new Commands.CutCommand(0));
          trace?.mark("cut_command");
        }
        await client.sendCommands(commandBatch);
      } else {
        try { await client.changePreviewInput(input); }
        catch { throw Object.assign(new Error("ATEM rejected the PREVIEW selection"), { code: "ATEM_PREVIEW_FAILED" }); }
        trace?.mark("preview_command");
        if (transition === "mix") {
          const { Enums } = require("atem-connection");
          try { await client.setTransitionStyle({ nextStyle: Enums.TransitionStyle.MIX }); }
          catch { throw Object.assign(new Error("ATEM rejected the Mix transition style"), { code: "ATEM_MIX_STYLE_FAILED" }); }
          trace?.mark("transition_style_command");
          trace?.mark("auto_command");
          await client.autoTransition();
        } else {
          trace?.mark("cut_command");
          await client.cut();
        }
      }
    } catch (error) {
      unsubscribeTiming();
      completion.cancel();
      completion.catch(() => {});
      if (error?.code) throw error;
      throw Object.assign(new Error(transition === "mix" ? "ATEM rejected the Auto transition" : "ATEM rejected the Cut"), { code: transition === "mix" ? "ATEM_AUTO_FAILED" : "ATEM_CUT_FAILED" });
    }
    return completion.finally(unsubscribeTiming);
  }

  const takeSource = (mapping, options) => takeInput(mapping?.input, options);
  const takeLive = (cameraDeviceId, options) => takeInput(configuration.cameraInputs[cameraDeviceId], options);

  return Object.freeze({
    getStatus: () => status,
    takeSource,
    initialize,
    reconfigure,
    takeLive,
    subscribe(subscriber) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    async shutdown() { await closeClient(); publish(snapshot(configuration.enabled ? "disconnected" : "disabled")); }
  });
}

module.exports = { atemConfiguration, cameraForProgramInput, createAtemService, mixEffectFromState, programInputFromState };
