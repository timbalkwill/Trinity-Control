(function exposeTransportSelection(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrinityTransport = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const PRELOAD_UNAVAILABLE = 'Electron preload bridge is unavailable.';
  const REQUIRED_PRELOAD_METHODS = [
    'getInterfaceMode',
    'getState',
    'getDevices',
    'onStateChanged',
    'onDevicesChanged'
  ];

  const hasPreloadApi = api => Boolean(api) && REQUIRED_PRELOAD_METHODS.every(
    method => typeof api[method] === 'function'
  );

  function selectTransport(protocol, preloadApi) {
    if (protocol === 'file:') {
      return hasPreloadApi(preloadApi)
        ? { kind: 'electron-ipc', api: preloadApi }
        : { kind: 'electron-preload-unavailable', diagnostic: PRELOAD_UNAVAILABLE };
    }
    if (protocol === 'http:' || protocol === 'https:') {
      return { kind: 'browser-http' };
    }
    return {
      kind: 'unsupported',
      diagnostic: `Unsupported Trinity Control protocol: ${protocol || 'unknown'}`
    };
  }

  return { PRELOAD_UNAVAILABLE, REQUIRED_PRELOAD_METHODS, hasPreloadApi, selectTransport };
});
