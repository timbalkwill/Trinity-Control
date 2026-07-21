"use strict";

const { DEVICE_STATES, DEVICE_TYPES } = require("../../core/device-manager.cjs");
const { powerInquiryCommand, presetRecallCommand } = require("./visca-commands.cjs");
const { TcpViscaTransport } = require("./tcp-visca-transport.cjs");

function normalizeViscaCameraConfig(camera) {
  const host = String(camera.host || "").trim();
  if (!host || host.length > 253 || /[\s/:]/.test(host)) {
    throw new Error(`Camera ${camera.id}: host must be an IP address or hostname without a URL scheme`);
  }
  const port = Number(camera.port ?? 5678);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Camera ${camera.id}: port must be an integer from 1 to 65535`);
  }
  const cameraAddress = Number(camera.cameraAddress ?? 1);
  if (!Number.isInteger(cameraAddress) || cameraAddress < 1 || cameraAddress > 7) {
    throw new Error(`Camera ${camera.id}: camera address must be an integer from 1 to 7`);
  }
  const connectionTimeoutMs = Number(camera.connectionTimeoutMs ?? 1500);
  if (!Number.isInteger(connectionTimeoutMs) || connectionTimeoutMs < 100 || connectionTimeoutMs > 30000) {
    throw new Error(`Camera ${camera.id}: connection timeout must be from 100 to 30000ms`);
  }
  const healthCheckIntervalMs = Number(camera.healthCheckIntervalMs ?? 15000);
  if (!Number.isInteger(healthCheckIntervalMs) || healthCheckIntervalMs < 5000 || healthCheckIntervalMs > 3600000) {
    throw new Error(`Camera ${camera.id}: health interval must be from 5000 to 3600000ms`);
  }
  return {
    ...camera,
    host,
    port,
    cameraAddress,
    connectionTimeoutMs,
    healthCheckIntervalMs,
    protocol: "visca-over-ip",
    savedPositions: Array.isArray(camera.savedPositions) ? camera.savedPositions : []
  };
}

class ViscaCameraAdapter {
  constructor({ camera, transport, logger = console } = {}) {
    this.camera = normalizeViscaCameraConfig(camera);
    this.transport = transport || new TcpViscaTransport();
    this.logger = logger;
    this.deviceManager = null;
    this.deviceId = `camera-${this.camera.id}`;
    this.healthTimer = null;
    this.healthCheckRunning = false;
    this.closed = false;
    this.lastLoggedState = null;
  }

  register(deviceManager) {
    this.deviceManager = deviceManager;
    const device = deviceManager.registerDevice({
      id: this.deviceId,
      name: this.camera.name,
      type: DEVICE_TYPES.CAMERA,
      connectionState: this.camera.enabled === false ? DEVICE_STATES.DISCONNECTED : DEVICE_STATES.CONNECTING,
      lastSeen: null,
      statusMessage: this.camera.enabled === false ? "Camera disabled" : "Waiting for VISCA health check",
      manufacturer: this.camera.manufacturer || undefined,
      model: this.camera.model || undefined,
      supportsReconnect: true,
      supportsConfiguration: true,
      supportsHealthMonitoring: true,
      supportedCapabilities: ["camera", "camera.recallPreset"]
    }, this, { resourceIds: [this.camera.id] });
    this.logger.info(`[VISCA Camera] Registered ${this.camera.id}`);
    if (this.camera.enabled !== false) this.startHealthMonitoring();
    return device;
  }

  startHealthMonitoring() {
    if (this.closed || this.healthTimer) return;
    this.healthTimer = setInterval(() => this.checkHealth(), this.camera.healthCheckIntervalMs);
    this.healthTimer.unref?.();
    this.checkHealth();
  }

  async checkHealth() {
    if (this.closed || this.healthCheckRunning || this.camera.enabled === false) return false;
    this.healthCheckRunning = true;
    this.deviceManager.updateDevice(this.deviceId, {
      connectionState: DEVICE_STATES.CONNECTING,
      statusMessage: "Checking VISCA control response"
    });
    if (this.lastLoggedState !== DEVICE_STATES.CONNECTED) {
      this.logger.info(`[VISCA Camera] ${this.camera.id} connection attempt`);
    }
    try {
      await this.transport.request({
        host: this.camera.host,
        port: this.camera.port,
        command: powerInquiryCommand(this.camera.cameraAddress),
        timeoutMs: this.camera.connectionTimeoutMs
      });
      this.deviceManager.reportHealth(this.deviceId, {
        success: true,
        statusMessage: "VISCA control responding"
      });
      this.deviceManager.updateDevice(this.deviceId, { connectionState: DEVICE_STATES.CONNECTED });
      this.logTransition(DEVICE_STATES.CONNECTED, "Connection success");
      return true;
    } catch (error) {
      this.deviceManager.recordReconnectAttempt(this.deviceId);
      this.deviceManager.reportHealth(this.deviceId, {
        error,
        statusMessage: "VISCA health check failed"
      });
      this.logTransition(DEVICE_STATES.ERROR, `Connection failure: ${error.message}`);
      return false;
    } finally {
      this.healthCheckRunning = false;
    }
  }

  async recallPreset({ cameraId, preset }) {
    let position;
    try {
      if (cameraId !== this.camera.id) throw new Error(`VISCA adapter does not manage camera: ${cameraId}`);
      if (this.camera.enabled === false) throw new Error(`Camera is disabled: ${cameraId}`);
      position = this.camera.savedPositions.find(item =>
        item.id === preset || item.name === preset
      );
      if (!position) throw new Error(`Camera ${cameraId} has no saved position named: ${preset}`);
      const command = presetRecallCommand(this.camera.cameraAddress, position.hardwarePresetNumber);
      this.logger.info(`[VISCA Camera] Preset recall requested ${cameraId} · ${preset}`);
      await this.transport.request({
        host: this.camera.host,
        port: this.camera.port,
        command,
        timeoutMs: this.camera.connectionTimeoutMs
      });
      this.deviceManager.reportHealth(this.deviceId, {
        success: true,
        statusMessage: `Preset recalled: ${position.name}`
      });
      this.deviceManager.updateDevice(this.deviceId, { connectionState: DEVICE_STATES.CONNECTED });
      this.logger.info(`[VISCA Camera] Preset recall succeeded ${cameraId} · ${preset}`);
      return { cameraId, preset, hardwarePresetNumber: position.hardwarePresetNumber };
    } catch (error) {
      this.deviceManager.reportHealth(this.deviceId, {
        error,
        statusMessage: `Preset recall failed: ${position?.name || preset || "unknown position"}`
      });
      this.logger.error(`[VISCA Camera] Preset recall failed ${cameraId}: ${error.message}`);
      throw error;
    }
  }

  logTransition(state, message) {
    if (this.lastLoggedState === state) return;
    this.lastLoggedState = state;
    this.logger.info(`[VISCA Camera] ${this.camera.id} ${message}`);
  }

  close() {
    this.closed = true;
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.transport.close?.();
    this.logger.info(`[VISCA Camera] Adapter shutdown ${this.camera.id}`);
  }
}

module.exports = { ViscaCameraAdapter, normalizeViscaCameraConfig };
