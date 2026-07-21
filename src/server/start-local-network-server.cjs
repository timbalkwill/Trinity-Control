async function startLocalNetworkServer(server, logger = console) {
  try {
    const address = await server.start();
    return { started: true, address };
  } catch (error) {
    logger.error(`[Trinity Remote] Server failed to start: ${error.message}`);
    return { started: false, error };
  }
}

module.exports = { startLocalNetworkServer };
