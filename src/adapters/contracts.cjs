const ADAPTER_CONTRACTS = Object.freeze({
  camera: ["recallPreset"],
  videoSwitcher: ["take"],
  lighting: ["applyScene", "releaseOverride"]
});

function assertAdapterContract(subsystem, adapter) {
  const requiredMethods = ADAPTER_CONTRACTS[subsystem];
  if (!requiredMethods) {
    throw new Error(`Unknown adapter subsystem: ${subsystem}`);
  }
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError(`Adapter for ${subsystem} must be an object`);
  }

  for (const method of requiredMethods) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`${subsystem} adapter must implement ${method}()`);
    }
  }

  return adapter;
}

module.exports = { ADAPTER_CONTRACTS, assertAdapterContract };
