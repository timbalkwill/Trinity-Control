(function exposeRemoteClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.install(root);
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function diagnosticTransport(message) {
    const unavailable = () => Promise.reject(new Error(message));
    return {
      getInterfaceMode: () => 'production-console',
      getConnectionStatus: () => 'offline',
      onConnectionStatusChanged: subscriber => {
        subscriber('offline');
        return () => {};
      },
      getState: unavailable,
      getDevices: () => Promise.resolve([]),
      onStateChanged: () => () => {},
      onDevicesChanged: () => () => {},
      onActivity: () => () => {},
      onProductionError: () => () => {}
    };
  }

  function browserTransport(runtime) {
    let connectionStatus = 'offline';
    const stateSubscribers = new Set();
    const deviceSubscribers = new Set();
    const statusSubscribers = new Set();
    let hasOpened = false;

    const setConnectionStatus = status => {
      if (connectionStatus === status) return;
      connectionStatus = status;
      for (const subscriber of statusSubscribers) subscriber(status);
    };

    const unsupported = () =>
      Promise.reject(new Error('Remote control commands are not enabled in this foundation.'));

    const events = new runtime.EventSource('/api/events');
    setConnectionStatus('reconnecting');

    const fetchLatestState = async () => {
      const response = await runtime.fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error(`State request failed (${response.status})`);
      return response.json();
    };
    const fetchDevices = async () => {
      const response = await runtime.fetch('/api/devices', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Device request failed (${response.status})`);
      return response.json();
    };

    events.onopen = async () => {
      setConnectionStatus('connected');
      if (!hasOpened) {
        hasOpened = true;
        return;
      }
      try {
        const [latest, devices] = await Promise.all([fetchLatestState(), fetchDevices()]);
        for (const subscriber of stateSubscribers) subscriber({
          type: 'state-changed',
          commandType: 'ReconnectSnapshot',
          revision: latest.revision || 0,
          state: latest
        });
        for (const subscriber of deviceSubscribers) subscriber({
          type: 'devices-changed',
          eventType: 'device:reconnect-snapshot',
          devices
        });
      } catch {
        setConnectionStatus(runtime.navigator.onLine ? 'reconnecting' : 'offline');
      }
    };
    events.onerror = () => setConnectionStatus(
      runtime.navigator.onLine ? 'reconnecting' : 'offline'
    );
    events.addEventListener('state-changed', event => {
      const update = JSON.parse(event.data);
      for (const subscriber of stateSubscribers) subscriber(update);
    });
    events.addEventListener('devices-changed', event => {
      const update = JSON.parse(event.data);
      for (const subscriber of deviceSubscribers) subscriber(update);
    });
    runtime.addEventListener('offline', () => setConnectionStatus('offline'));
    runtime.addEventListener('online', () => setConnectionStatus('reconnecting'));

    return {
      getInterfaceMode: () => 'operator',
      getCapabilities: () => ({ ...runtime.TrinityInterface.OPERATOR_CAPABILITIES }),
      getState: fetchLatestState,
      getDevices: fetchDevices,
      getConnectionStatus: () => connectionStatus,
      onConnectionStatusChanged: subscriber => {
        statusSubscribers.add(subscriber);
        subscriber(connectionStatus);
        return () => statusSubscribers.delete(subscriber);
      },
      onStateChanged: subscriber => {
        stateSubscribers.add(subscriber);
        return () => stateSubscribers.delete(subscriber);
      },
      onDevicesChanged: subscriber => {
        deviceSubscribers.add(subscriber);
        return () => deviceSubscribers.delete(subscriber);
      },
      onActivity: () => () => {},
      onProductionError: () => () => {},
      saveState: unsupported,
      addCueTemplate: unsupported,
      moveCue: unsupported,
      removeCue: unsupported,
      goCue: unsupported,
      nextCue: unsupported,
      previousCue: unsupported,
      toggleHold: unsupported,
      setHold: unsupported,
      takeCamera: unsupported,
      lightingOverride: unsupported,
      returnToCueLighting: unsupported,
      updateCameraConfiguration: unsupported,
      updateLightingConfiguration: unsupported
    };
  }

  function install(runtime) {
    const selection = runtime.TrinityTransport.selectTransport(
      runtime.location.protocol,
      runtime.trinity
    );
    runtime.trinityTransport = selection.kind;

    if (selection.kind === 'electron-ipc') return selection.api;
    if (selection.kind === 'browser-http') {
      runtime.trinity = browserTransport(runtime);
      return runtime.trinity;
    }
    runtime.trinity = diagnosticTransport(selection.diagnostic);
    return runtime.trinity;
  }

  return { browserTransport, diagnosticTransport, install };
});
