"use strict";

const crypto = require("node:crypto");
const dgram = require("node:dgram");
const http = require("node:http");
const https = require("node:https");

let viscaSequence = 0;

function viscaAddress(value) {
  const address = Number(value ?? 1);
  return Number.isInteger(address) && address >= 1 && address <= 7 ? address : 1;
}

function createViscaPresetRecallPacket({ presetNumber, address = 1, sequenceNumber } = {}) {
  if (!Number.isInteger(presetNumber) || presetNumber < 0 || presetNumber > 254) {
    throw new RangeError("VISCA preset number must be between 0 and 254");
  }
  const payload = Buffer.from([0x80 + viscaAddress(address), 0x01, 0x04, 0x3f, 0x02, presetNumber, 0xff]);
  const packet = Buffer.alloc(8 + payload.length);
  packet.writeUInt16BE(0x0100, 0);
  packet.writeUInt16BE(payload.length, 2);
  packet.writeUInt32BE((sequenceNumber ?? viscaSequence++) >>> 0, 4);
  payload.copy(packet, 8);
  return packet;
}

function createViscaUdpTransport({ socketFactory = () => dgram.createSocket("udp4"), now = Date.now } = {}) {
  return function recallViscaPreset(configuration) {
    const startedAt = now();
    const port = Number(configuration.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return Promise.resolve({ ok: false, code: "configurationIncomplete", message: "Camera UDP port is not configured" });
    }
    let packet;
    try {
      packet = createViscaPresetRecallPacket({
        presetNumber: configuration.presetNumber,
        address: configuration.viscaAddress,
        sequenceNumber: configuration.sequenceNumber
      });
    } catch {
      return Promise.resolve({ ok: false, code: "presetMappingMissing", message: "Camera preset hardware mapping is missing or invalid" });
    }
    return new Promise(resolve => {
      const socket = socketFactory();
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* Socket may already be closed. */ }
        resolve({ ...result, elapsedMs: Math.max(0, now() - startedAt) });
      };
      socket.once("error", error => finish(normalizedFailure(error)));
      socket.send(packet, port, configuration.host, error => {
        if (error) finish(normalizedFailure(error));
        else finish({ ok: true, message: "VISCA UDP preset recall command sent" });
      });
    });
  };
}

function digestChallenge(header = "") {
  if (!/^Digest\s/i.test(header)) return null;
  return Object.fromEntries([...header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)]
    .map(match => [match[1].toLowerCase(), match[2] ?? match[3]]));
}

function digestAuthorization({ challenge, method, path, username, password }) {
  const realm = challenge.realm || "";
  const nonce = challenge.nonce || "";
  const qop = challenge.qop?.split(",").map(value => value.trim()).find(value => value === "auth");
  const algorithm = (challenge.algorithm || "MD5").toUpperCase();
  if (!nonce || (algorithm !== "MD5" && algorithm !== "MD5-SESS")) return null;
  const hash = value => crypto.createHash("md5").update(value).digest("hex");
  const cnonce = crypto.randomBytes(8).toString("hex");
  const nc = "00000001";
  let ha1 = hash(`${username}:${realm}:${password}`);
  if (algorithm === "MD5-SESS") ha1 = hash(`${ha1}:${nonce}:${cnonce}`);
  const ha2 = hash(`${method}:${path}`);
  const response = qop ? hash(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : hash(`${ha1}:${nonce}:${ha2}`);
  const values = [
    `username="${username}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${path}"`,
    `response="${response}"`, `algorithm=${algorithm}`
  ];
  if (challenge.opaque) values.push(`opaque="${challenge.opaque}"`);
  if (qop) values.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${values.join(", ")}`;
}

function requestOnce({ protocol, host, port, path, timeoutMs, authorization }, requestImpl) {
  return new Promise((resolve, reject) => {
    const request = (requestImpl || (protocol === "https:" ? https.request : http.request))({
      protocol, hostname: host, port, path, method: "GET",
      headers: authorization ? { Authorization: authorization } : {}
    }, response => {
      response.resume();
      response.on("end", () => resolve({
        statusCode: response.statusCode || 0,
        authenticate: response.headers["www-authenticate"] || null
      }));
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error("Camera request timed out");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject);
    request.end();
  });
}

function normalizedFailure(error) {
  if (error?.code === "ETIMEDOUT" || error?.name === "AbortError") {
    return { ok: false, code: "timeout", message: "Camera preset recall timed out" };
  }
  return { ok: false, code: "connectionFailure", message: "Could not connect to the camera" };
}

function createPtzOpticsTransport({ requestImpl, timeoutMs = 3000, now = Date.now } = {}) {
  return async function recallPtzOpticsPreset(configuration) {
    const startedAt = now();
    const protocol = configuration.protocol === "https" || configuration.protocol === "https:" ? "https:" : "http:";
    const path = `/cgi-bin/ptzctrl.cgi?ptzcmd&POSCALL&${encodeURIComponent(configuration.presetNumber)}`;
    const requestOptions = {
      protocol,
      host: configuration.host,
      port: configuration.port || (protocol === "https:" ? 443 : 80),
      path,
      timeoutMs: configuration.timeoutMs || timeoutMs
    };
    try {
      let response = await requestOnce(requestOptions, requestImpl);
      if (response.statusCode === 401 && configuration.username && configuration.password) {
        const challenge = digestChallenge(response.authenticate);
        const authorization = challenge
          ? digestAuthorization({ challenge, method: "GET", path, username: configuration.username, password: configuration.password })
          : `Basic ${Buffer.from(`${configuration.username}:${configuration.password}`).toString("base64")}`;
        if (authorization) response = await requestOnce({ ...requestOptions, authorization }, requestImpl);
      }
      const elapsedMs = Math.max(0, now() - startedAt);
      if (response.statusCode === 401 || response.statusCode === 403) {
        return { ok: false, code: "authenticationFailure", message: "Camera authentication failed", elapsedMs };
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return { ok: false, code: "cameraRejected", message: `Camera rejected preset recall (${response.statusCode || "no status"})`, elapsedMs };
      }
      return { ok: true, message: "Camera accepted the preset recall command", elapsedMs };
    } catch (error) {
      return { ...normalizedFailure(error), elapsedMs: Math.max(0, now() - startedAt) };
    }
  };
}

module.exports = {
  createPtzOpticsTransport,
  createViscaPresetRecallPacket,
  createViscaUdpTransport,
  digestAuthorization,
  digestChallenge
};
