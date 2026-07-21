(function installRemoteTransport() {
  if (window.trinity) return;

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

  const events = new EventSource('/api/events');
  setConnectionStatus('reconnecting');

  const fetchLatestState = async () => {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`State request failed (${response.status})`);
    return response.json();
  };
  const fetchDevices = async () => {
    const response = await fetch('/api/devices', { cache: 'no-store' });
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
      const update = {
        type: 'state-changed',
        commandType: 'ReconnectSnapshot',
        revision: latest.revision || 0,
        state: latest
      };
      for (const subscriber of stateSubscribers) subscriber(update);
      const deviceUpdate = {
        type: 'devices-changed',
        eventType: 'device:reconnect-snapshot',
        devices
      };
      for (const subscriber of deviceSubscribers) subscriber(deviceUpdate);
    } catch {
      setConnectionStatus(navigator.onLine ? 'reconnecting' : 'offline');
    }
  };
  events.onerror = () => setConnectionStatus(
    navigator.onLine ? 'reconnecting' : 'offline'
  );
  events.addEventListener('state-changed', event => {
    const update = JSON.parse(event.data);
    for (const subscriber of stateSubscribers) subscriber(update);
  });
  events.addEventListener('devices-changed', event => {
    const update = JSON.parse(event.data);
    for (const subscriber of deviceSubscribers) subscriber(update);
  });
  window.addEventListener('offline', () => setConnectionStatus('offline'));
  window.addEventListener('online', () => setConnectionStatus('reconnecting'));

  window.trinity = {
    getInterfaceMode: () => 'operator',
    getCapabilities: () => ({ ...window.TrinityInterface.OPERATOR_CAPABILITIES }),
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
})();
