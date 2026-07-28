"use strict";

const QLC_PREFIX = "QLC+API|";
const DEFAULT_QLC_PORT = 9999;
const DEFAULT_TIMEOUT_MS = 3000;
const boundedTimeout = value => value === null || value === undefined || value === ""
  ? DEFAULT_TIMEOUT_MS
  : Math.max(250, Math.min(30000, Number(value) || DEFAULT_TIMEOUT_MS));

function safeHost(value) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/[\r\n]/g, "") : null;
}

function endpointFor(config = {}) {
  const host = safeHost(config.host);
  if (!host) return null;
  const secure = config.protocol === "wss" || config.protocol === "wss:";
  const port = Number.isInteger(Number(config.port)) && Number(config.port) > 0 ? Number(config.port) : DEFAULT_QLC_PORT;
  return `${secure ? "wss" : "ws"}://${host}:${port}/qlcplusWS`;
}

function virtualConsoleEndpointFor(config = {}) {
  const host = safeHost(config.host);
  if (!host) return null;
  const secure = config.protocol === "wss" || config.protocol === "wss:";
  const port = Number.isInteger(Number(config.port)) && Number(config.port) > 0 ? Number(config.port) : DEFAULT_QLC_PORT;
  return `${secure ? "https" : "http"}://${host}:${port}/vc.json`;
}

function authorizationHeaders(config = {}) {
  if (!config.username && !config.password) return {};
  return { Authorization: `Basic ${Buffer.from(`${config.username || ""}:${config.password || ""}`).toString("base64")}` };
}

function errorResult(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

function classifyError(error) {
  const code = error?.code || "";
  if (code === "timeout") return errorResult("timeout", "QLC+ connection timed out");
  if (code === "authenticationFailure") return errorResult(code, "QLC+ authentication failed");
  if (code === "unexpectedDisconnect") return errorResult(code, "QLC+ disconnected unexpectedly");
  if (code === "invalidResponse") return errorResult(code, "QLC+ returned an invalid response");
  return errorResult("connectionFailure", "Could not connect to QLC+");
}

function defaultWebSocketFactory(url, options) {
  return new WebSocket(url, [], options);
}

function eventData(event) {
  if (typeof event?.data === "string") return event.data;
  if (Buffer.isBuffer(event?.data)) return event.data.toString("utf8");
  return String(event?.data ?? "");
}

class QlcPlusWebSocketSession {
  constructor(config, { webSocketFactory = defaultWebSocketFactory, now = Date.now } = {}) {
    this.config = { ...config };
    this.webSocketFactory = webSocketFactory;
    this.now = now;
    this.socket = null;
    this.pending = null;
    this.closedIntentionally = false;
  }

  connect() {
    if (this.socket) return Promise.resolve();
    const endpoint = endpointFor(this.config);
    if (!endpoint) return Promise.reject(Object.assign(new Error("missing host"), { code: "configurationIncomplete" }));
    const timeoutMs = boundedTimeout(this.config.timeoutMs);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.closedIntentionally = true;
        this.socket?.close();
        reject(Object.assign(new Error("timeout"), { code: "timeout" }));
      }, timeoutMs);
      try {
        this.socket = this.webSocketFactory(endpoint, { headers: authorizationHeaders(this.config) });
      } catch {
        clearTimeout(timer);
        return reject(Object.assign(new Error("connection"), { code: "connectionFailure" }));
      }
      this.socket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", event => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const status = event?.statusCode || event?.response?.statusCode;
        reject(Object.assign(new Error("connection"), { code: status === 401 || status === 403 ? "authenticationFailure" : "connectionFailure" }));
      }, { once: true });
      this.socket.addEventListener("message", event => this.receive(eventData(event)));
      this.socket.addEventListener("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(Object.assign(new Error("disconnect"), { code: "unexpectedDisconnect" }));
        }
        if (!this.closedIntentionally && this.pending) {
          this.pending.reject(Object.assign(new Error("disconnect"), { code: "unexpectedDisconnect" }));
          this.pending = null;
        }
      });
    });
  }

  receive(message) {
    if (!this.pending) return;
    const fields = message.split("|");
    if (fields[0] !== "QLC+API" || fields[1] !== this.pending.command) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  request(command, ...parameters) {
    if (!this.socket || this.pending) {
      return Promise.reject(Object.assign(new Error("invalid state"), { code: "unexpectedAdapterError" }));
    }
    const timeoutMs = boundedTimeout(this.config.timeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(Object.assign(new Error("timeout"), { code: "timeout" }));
      }, timeoutMs);
      this.pending = { command, resolve, reject, timer };
      this.socket.send([QLC_PREFIX + command, ...parameters].join("|"));
    });
  }

  disconnect() {
    this.closedIntentionally = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Object.assign(new Error("disconnect"), { code: "unexpectedDisconnect" }));
      this.pending = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}

function parseNumberResponse(response) {
  const fields = String(response).split("|");
  const count = Number(fields[2]);
  if (fields[0] !== "QLC+API" || fields[1] !== "getWidgetsNumber" || !Number.isInteger(count) || count < 0) {
    throw Object.assign(new Error("invalid"), { code: "invalidResponse" });
  }
  return count;
}

function parseWidgetList(response) {
  const fields = String(response).split("|");
  if (fields[0] !== "QLC+API" || fields[1] !== "getWidgetsList" || (fields.length - 2) % 2 !== 0) {
    throw Object.assign(new Error("invalid"), { code: "invalidResponse" });
  }
  const widgets = [];
  for (let index = 2; index < fields.length; index += 2) {
    if (!fields[index]) throw Object.assign(new Error("invalid"), { code: "invalidResponse" });
    widgets.push({ widgetId: fields[index], name: fields[index + 1] || "Unnamed widget" });
  }
  return widgets;
}

function responseValue(response, command) {
  const fields = String(response).split("|");
  if (fields[0] !== "QLC+API" || fields[1] !== command || fields.length < 3) {
    throw Object.assign(new Error("invalid"), { code: "invalidResponse" });
  }
  return fields.at(-1);
}

function parseVirtualConsoleHierarchy(input) {
  if (!input || !Array.isArray(input.pages)) throw Object.assign(new Error("invalid"), { code: "invalidResponse" });
  const controls = new Map();
  const pages = input.pages.map((page, pageIndex) => {
    const pageName = String(page?.caption || `Page ${pageIndex + 1}`);
    const visit = (children, parent = null, containerPath = []) => {
      for (const child of Array.isArray(children) ? children : []) {
        const widgetId = String(child?.id ?? "");
        if (!widgetId) continue;
        const parentName = parent?.caption ? String(parent.caption) : null;
        const nextPath = child?.caption ? [...containerPath, String(child.caption)] : [...containerPath];
        controls.set(widgetId, {
          pageIndex,
          pageName,
          parentWidgetId: parent?.id === undefined ? null : String(parent.id),
          parentName,
          containerPath: [...containerPath]
        });
        visit(child.children, child, nextPath);
      }
    };
    visit(page?.children);
    return { pageIndex, pageName, pageId: page?.id === undefined ? null : String(page.id) };
  });
  return { pages, controls };
}

function createQlcPlusTransport(options = {}) {
  const now = options.now || Date.now;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  async function discoverHierarchy(config) {
    if (typeof fetchImpl !== "function") return { pages: [], controls: new Map() };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout(config.timeoutMs));
    try {
      const response = await fetchImpl(virtualConsoleEndpointFor(config), {
        headers: authorizationHeaders(config),
        signal: controller.signal
      });
      if (!response?.ok) return { pages: [], controls: new Map() };
      return parseVirtualConsoleHierarchy(await response.json());
    } catch {
      return { pages: [], controls: new Map() };
    } finally {
      clearTimeout(timer);
    }
  }
  async function withSession(config, operation) {
    const startedAt = now();
    const session = new QlcPlusWebSocketSession(config, options);
    try {
      await session.connect();
      const value = await operation(session);
      return { ok: true, ...value, elapsedMs: Math.max(0, now() - startedAt) };
    } catch (error) {
      return { ...classifyError(error), elapsedMs: Math.max(0, now() - startedAt) };
    } finally {
      session.disconnect();
    }
  }
  return {
    connect: config => {
      const session = new QlcPlusWebSocketSession(config, options);
      return session.connect().then(() => session);
    },
    disconnect: session => session?.disconnect(),
    testConnection: config => withSession(config, async session => ({
      code: "qlcConnected",
      widgetCount: parseNumberResponse(await session.request("getWidgetsNumber")),
      message: "QLC+ is reachable"
    })),
    discoverControls: config => withSession(config, async session => {
      const hierarchy = await discoverHierarchy(config);
      const widgetCount = parseNumberResponse(await session.request("getWidgetsNumber"));
      const widgets = parseWidgetList(await session.request("getWidgetsList"));
      for (const widget of widgets) {
        widget.widgetType = responseValue(await session.request("getWidgetType", widget.widgetId), "getWidgetType");
        widget.status = responseValue(await session.request("getWidgetStatus", widget.widgetId), "getWidgetStatus");
        widget.canActivateScene = widget.widgetType.toLowerCase() === "button";
        Object.assign(widget, hierarchy.controls.get(widget.widgetId) || {
          pageIndex: null, pageName: null, parentWidgetId: null, parentName: null, containerPath: []
        });
      }
      return { code: "qlcConnected", widgetCount, widgets, pages: hierarchy.pages, message: `Discovered ${widgets.length} QLC+ controls` };
    }),
    activateControl: (config, { externalControlId, value = 255 } = {}) =>
      withSession(config, async session => {
        await session.request(String(externalControlId), String(value));
        return { code: "qlcConnected", message: "QLC+ control command was sent" };
      })
  };
}

module.exports = {
  DEFAULT_QLC_PORT,
  QlcPlusWebSocketSession,
  createQlcPlusTransport,
  endpointFor,
  parseVirtualConsoleHierarchy,
  parseNumberResponse,
  parseWidgetList,
  virtualConsoleEndpointFor
};
