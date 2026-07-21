(function installRemoteTransport() {
  if (window.trinity) return;

  let connectionStatus = 'offline';
  const stateSubscribers = new Set();
  const statusSubscribers = new Set();

  const setConnectionStatus = status => {
    if (connectionStatus === status) return;
    connectionStatus = status;
    for (const subscriber of statusSubscribers) subscriber(status);
  };

  const unsupported = () =>
    Promise.reject(new Error('Remote control commands are not enabled in this foundation.'));

  const events = new EventSource('/api/events');
  setConnectionStatus('reconnecting');

  events.onopen = () => setConnectionStatus('connected');
  events.onerror = () => setConnectionStatus(
    navigator.onLine ? 'reconnecting' : 'offline'
  );
  events.addEventListener('state-changed', event => {
    const update = JSON.parse(event.data);
    for (const subscriber of stateSubscribers) subscriber(update);
  });
  window.addEventListener('offline', () => setConnectionStatus('offline'));
  window.addEventListener('online', () => setConnectionStatus('reconnecting'));

  window.trinity = {
    getState: async () => {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok) throw new Error(`State request failed (${response.status})`);
      return response.json();
    },
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
