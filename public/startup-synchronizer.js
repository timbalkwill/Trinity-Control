(function exposeStartupSynchronizer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrinityStartup = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  async function synchronize({ transport, onState, onDevices, logger = console }) {
    const buffered = [];
    let buffering = true;

    transport.onStateChanged(update => {
      if (buffering) buffered.push({ type: 'state', update });
      else onState(update);
    });
    transport.onDevicesChanged?.(update => {
      if (buffering) buffered.push({ type: 'devices', update });
      else onDevices(update);
    });

    logger.info?.('[Trinity Startup] Initial browser snapshots requested');
    const [state, devices] = await Promise.all([
      transport.getState(),
      transport.getDevices?.() || Promise.resolve([])
    ]);
    onState({
      type: 'state-changed',
      commandType: 'InitialHttpSnapshot',
      revision: state.revision || 0,
      state
    });
    onDevices({
      type: 'devices-changed',
      eventType: 'device:initial-http-snapshot',
      devices
    });

    buffering = false;
    for (const item of buffered) {
      if (item.type === 'state') onState(item.update);
      else onDevices(item.update);
    }
    logger.info?.(
      `[Trinity Startup] Browser snapshots ready at revision ${state.revision || 0}; replayed ${buffered.length} buffered event(s)`
    );
  }

  return { synchronize };
});
