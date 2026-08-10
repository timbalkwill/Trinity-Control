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

function createDefaultClient() {
  const { Atem } = require("atem-connection");
  return new Atem();
}

function createAtemService({ getState, clientFactory = createDefaultClient, logger = console, confirmationTimeoutMs = 2000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
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
      const programInput = programInputFromState(current.state);
      publish(snapshot("connected", { programInput }));
    });
    current.on("disconnected", () => publish(snapshot("disconnected", { message: "ATEM disconnected" })));
    current.on("stateChanged", state => {
      const programInput = programInputFromState(state);
      if (programInput !== null) publish(snapshot("connected", { programInput }));
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

  async function takeLive(cameraDeviceId) {
    if (!configuration.enabled) throw Object.assign(new Error("ATEM is disabled"), { code: "ATEM_DISABLED" });
    if (!configuration.configured) throw Object.assign(new Error("ATEM is not configured"), { code: "ATEM_NOT_CONFIGURED" });
    if (status.connectionState !== "connected" || !client) throw Object.assign(new Error("ATEM is disconnected"), { code: "ATEM_DISCONNECTED" });
    const input = configuration.cameraInputs[cameraDeviceId];
    if (input === undefined) throw Object.assign(new Error("Camera has no ATEM input mapping"), { code: "ATEM_MAPPING_MISSING" });
    if (status.programInput === input) return status;
    let cancelConfirmation = () => {};
    const confirmation = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        subscribers.delete(listener);
        error ? reject(error) : resolve(value);
      };
      const listener = next => {
        if (next.connectionState !== "connected") finish(Object.assign(new Error("ATEM disconnected before PROGRAM confirmation"), { code: "ATEM_CONFIRMATION_FAILED" }));
        else if (next.programInput === input) finish(null, next);
      };
      const timer = setTimer(() => finish(Object.assign(new Error("ATEM PROGRAM confirmation timed out"), { code: "ATEM_CONFIRMATION_TIMEOUT" })), confirmationTimeoutMs);
      subscribers.add(listener);
      cancelConfirmation = () => finish(Object.assign(new Error("ATEM PROGRAM confirmation cancelled"), { code: "ATEM_CONFIRMATION_CANCELLED" }));
    });
    try { await client.changeProgramInput(input); }
    catch {
      cancelConfirmation();
      confirmation.catch(() => {});
      throw Object.assign(new Error("ATEM rejected the PROGRAM switch"), { code: "ATEM_SWITCH_FAILED" });
    }
    return confirmation;
  }

  return Object.freeze({
    getStatus: () => status,
    initialize,
    reconfigure,
    takeLive,
    subscribe(subscriber) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    async shutdown() { await closeClient(); publish(snapshot(configuration.enabled ? "disconnected" : "disabled")); }
  });
}

module.exports = { atemConfiguration, cameraForProgramInput, createAtemService, programInputFromState };
