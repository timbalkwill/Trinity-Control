"use strict";

const { EventBus } = require("./event-bus.cjs");

const DEVICE_TYPES = Object.freeze({
  CAMERA: "Camera",
  VIDEO_SWITCHER: "VideoSwitcher",
  LIGHTING: "Lighting",
  AUDIO: "Audio",
  GRAPHICS: "Graphics",
  STREAMING: "Streaming",
  CONTROLLER: "Controller",
  UNKNOWN: "Unknown"
});

const DEVICE_STATES = Object.freeze({
  UNKNOWN: "Unknown",
  DISCONNECTED: "Disconnected",
  CONNECTING: "Connecting",
  CONNECTED: "Connected",
  DEGRADED: "Degraded",
  ERROR: "Error",
  SIMULATION: "Simulation"
});

const DEVICE_EVENTS = Object.freeze({
  REGISTERED: "device:registered",
  UPDATED: "device:updated",
  REMOVED: "device:removed",
  ERROR: "device:error",
  HEALTH: "device:health"
});

const clone = value => JSON.parse(JSON.stringify(value));
const allowedStates = new Set(Object.values(DEVICE_STATES));
const allowedTypes = new Set(Object.values(DEVICE_TYPES));

class DeviceManager {
  constructor({ eventBus, now = () => Date.now() } = {}) {
    this.eventBus = eventBus || new EventBus();
    this.now = now;
    this.devices = new Map();
    this.adapters = new Map();
    this.resourceIds = new Map();
    this.registeredAt = new Map();
  }

  subscribe(eventName, subscriber) {
    return this.eventBus.subscribe(eventName, subscriber);
  }

  registerDevice(registration, adapter, { resourceIds = [] } = {}) {
    const id = this.requiredText(registration?.id, "Device id");
    if (this.devices.has(id)) throw new Error(`Device already registered: ${id}`);
    if (!adapter || typeof adapter !== "object") {
      throw new TypeError(`Device adapter must be an object: ${id}`);
    }

    const now = this.now();
    const supportedCapabilities = [...new Set(
      (registration.supportedCapabilities || []).map(capability =>
        this.requiredText(capability, "Device capability")
      )
    )];
    const device = {
      id,
      name: this.requiredText(registration.name, "Device name"),
      type: allowedTypes.has(registration.type) ? registration.type : DEVICE_TYPES.UNKNOWN,
      connectionState: allowedStates.has(registration.connectionState)
        ? registration.connectionState
        : DEVICE_STATES.UNKNOWN,
      lastSeen: registration.lastSeen ?? null,
      statusMessage: String(registration.statusMessage || "Status unknown"),
      ...(registration.version ? { version: String(registration.version) } : {}),
      ...(registration.manufacturer ? { manufacturer: String(registration.manufacturer) } : {}),
      ...(registration.model ? { model: String(registration.model) } : {}),
      supportsReconnect: Boolean(registration.supportsReconnect),
      supportsConfiguration: Boolean(registration.supportsConfiguration),
      supportsHealthMonitoring: Boolean(registration.supportsHealthMonitoring),
      supportedCapabilities,
      health: {
        lastSuccessfulCommunication: registration.health?.lastSuccessfulCommunication ?? null,
        lastError: registration.health?.lastError ?? null,
        reconnectAttempts: Number(registration.health?.reconnectAttempts) || 0,
        uptime: Number(registration.health?.uptime) || 0
      }
    };

    this.devices.set(id, device);
    this.adapters.set(id, adapter);
    this.resourceIds.set(id, new Set(resourceIds.map(String)));
    this.registeredAt.set(id, now - device.health.uptime);
    this.publish(DEVICE_EVENTS.REGISTERED, { device: this.snapshotDevice(id) });
    return this.snapshotDevice(id);
  }

  updateDevice(id, changes) {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Unknown device: ${id}`);
    const allowed = new Set([
      "name", "connectionState", "lastSeen", "statusMessage", "version",
      "manufacturer", "model", "supportsReconnect", "supportsConfiguration",
      "supportsHealthMonitoring", "supportedCapabilities", "health"
    ]);
    const unsupported = Object.keys(changes || {}).filter(key => !allowed.has(key));
    if (unsupported.length) throw new Error(`Unsupported device fields: ${unsupported.join(", ")}`);

    if (Object.hasOwn(changes, "connectionState") && !allowedStates.has(changes.connectionState)) {
      throw new Error(`Unknown device state: ${changes.connectionState}`);
    }
    if (Object.hasOwn(changes, "name")) changes.name = this.requiredText(changes.name, "Device name");
    if (Object.hasOwn(changes, "supportedCapabilities")) {
      changes.supportedCapabilities = [...new Set(changes.supportedCapabilities.map(String))];
    }
    const health = changes.health ? { ...device.health, ...changes.health } : device.health;
    Object.assign(device, changes, { health });
    this.publish(DEVICE_EVENTS.UPDATED, { device: this.snapshotDevice(id) });
    return this.snapshotDevice(id);
  }

  removeDevice(id) {
    const device = this.snapshotDevice(id);
    if (!device) return false;
    this.devices.delete(id);
    this.adapters.delete(id);
    this.resourceIds.delete(id);
    this.registeredAt.delete(id);
    this.publish(DEVICE_EVENTS.REMOVED, { device });
    return true;
  }

  reportHealth(id, { success = false, error = null, statusMessage } = {}) {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Unknown device: ${id}`);
    const now = this.now();
    if (success) {
      device.lastSeen = now;
      device.health.lastSuccessfulCommunication = now;
      device.health.lastError = null;
    }
    if (error) {
      device.health.lastError = error.message || String(error);
      device.connectionState = DEVICE_STATES.ERROR;
      this.publish(DEVICE_EVENTS.ERROR, {
        device: this.snapshotDevice(id),
        message: device.health.lastError
      });
    }
    if (statusMessage !== undefined) device.statusMessage = String(statusMessage);
    const snapshot = this.snapshotDevice(id);
    this.publish(DEVICE_EVENTS.HEALTH, { device: snapshot });
    this.publish(DEVICE_EVENTS.UPDATED, { device: snapshot });
    return snapshot;
  }

  recordReconnectAttempt(id) {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Unknown device: ${id}`);
    device.health.reconnectAttempts += 1;
    return this.reportHealth(id, { statusMessage: "Reconnect requested" });
  }

  getDevice(id) {
    return this.snapshotDevice(id);
  }

  getDevices() {
    return [...this.devices.keys()].map(id => this.snapshotDevice(id));
  }

  getAdapterByCapability(capability, { resourceId } = {}) {
    if (resourceId !== undefined) {
      for (const [id, device] of this.devices) {
        if (
          device.supportedCapabilities.includes(capability) &&
          this.resourceIds.get(id)?.has(String(resourceId))
        ) return this.adapters.get(id);
      }
    }
    for (const [id, device] of this.devices) {
      if (
        device.supportedCapabilities.includes(capability) &&
        this.resourceIds.get(id)?.size === 0
      ) return this.adapters.get(id);
    }
    return undefined;
  }

  snapshotDevice(id) {
    const device = this.devices.get(id);
    if (!device) return null;
    const snapshot = clone(device);
    snapshot.health.uptime = Math.max(0, this.now() - this.registeredAt.get(id));
    return snapshot;
  }

  publish(eventName, payload) {
    this.eventBus.publish(eventName, { type: eventName, at: this.now(), ...payload });
  }

  requiredText(value, label) {
    const text = String(value || "").trim();
    if (!text) throw new TypeError(`${label} must be a non-empty string`);
    return text;
  }
}

module.exports = { DEVICE_EVENTS, DEVICE_STATES, DEVICE_TYPES, DeviceManager };
