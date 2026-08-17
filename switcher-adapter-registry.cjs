"use strict";

function createSwitcherAdapterRegistry(initial = {}) {
  const adapters = new Map(Object.entries(initial));
  return Object.freeze({
    register(type, adapter) {
      if (!type || !adapter || typeof adapter.takeSource !== "function" || typeof adapter.getStatus !== "function") {
        throw new TypeError("Switcher adapters require type, takeSource(), and getStatus()");
      }
      adapters.set(type, adapter);
      return adapter;
    },
    resolve(type) { return adapters.get(type) || null; },
    has(type) { return adapters.has(type); }
  });
}

module.exports = { createSwitcherAdapterRegistry };
