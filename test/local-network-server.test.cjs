const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createLocalNetworkServer } = require("../src/server/local-network-server.cjs");

function connectEventStream(url) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];

  const connected = fetch(url, { signal: controller.signal }).then(async response => {
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventName = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (!eventName || !data) continue;
        const event = { event: eventName, data: JSON.parse(data) };
        const waiter = waiters.shift();
        if (waiter) waiter(event);
        else events.push(event);
      }
    }
  }).catch(error => {
    if (error.name !== "AbortError") throw error;
  });

  const dequeue = () => events.length
    ? Promise.resolve(events.shift())
    : new Promise(resolve => waiters.push(resolve));

  return {
    close: async () => {
      controller.abort();
      await connected;
    },
    nextEvent: async eventName => {
      while (true) {
        const event = await dequeue();
        if (!eventName || event.event === eventName) return event;
      }
    }
  };
}

test("a PC state change is broadcast to two browser clients without reload", async () => {
  let snapshot = { revision: 0, live: { hold: false } };
  const messages = [];
  const server = createLocalNetworkServer({
    getSnapshot: () => snapshot,
    publicDirectory: path.join(__dirname, "..", "public"),
    host: "127.0.0.1",
    port: 0,
    logger: { info: message => messages.push(message), warn: message => messages.push(message) }
  });
  const address = await server.start();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const firstClient = connectEventStream(`${baseUrl}/api/events`);
  const secondClient = connectEventStream(`${baseUrl}/api/events`);

  try {
    const [firstInitial, secondInitial] = await Promise.all([
      firstClient.nextEvent("state-changed"),
      secondClient.nextEvent("state-changed")
    ]);
    assert.equal(firstInitial.data.state.live.hold, false);
    assert.equal(secondInitial.data.state.live.hold, false);
    await Promise.all([
      firstClient.nextEvent("devices-changed"),
      secondClient.nextEvent("devices-changed")
    ]);

    snapshot = { revision: 1, live: { hold: true } };
    server.broadcastStateChanged({
      type: "state-changed",
      commandType: "SetHold",
      revision: 1,
      state: snapshot
    });

    const [firstUpdate, secondUpdate] = await Promise.all([
      firstClient.nextEvent("state-changed"),
      secondClient.nextEvent("state-changed")
    ]);
    assert.equal(firstUpdate.data.state.live.hold, true);
    assert.equal(secondUpdate.data.state.live.hold, true);
    assert.equal(firstUpdate.data.revision, 1);
    assert.equal(secondUpdate.data.revision, 1);
    assert.equal(messages.filter(message => message.includes("Client connected")).length, 2);

    server.broadcastDevicesChanged({
      type: "devices-changed",
      eventType: "device:updated",
      devices: [{ id: "simulation-camera", connectionState: "Simulation" }]
    });
    const [firstDevices, secondDevices] = await Promise.all([
      firstClient.nextEvent("devices-changed"),
      secondClient.nextEvent("devices-changed")
    ]);
    assert.equal(firstDevices.data.devices[0].connectionState, "Simulation");
    assert.equal(secondDevices.data.devices[0].connectionState, "Simulation");
  } finally {
    await Promise.all([firstClient.close(), secondClient.close()]);
    await server.close();
  }
});

test("the state endpoint and static application are available over HTTP", async () => {
  const server = createLocalNetworkServer({
    getSnapshot: () => ({ revision: 7 }),
    getDevices: () => [{ id: "simulation-camera", connectionState: "Simulation" }],
    publicDirectory: path.join(__dirname, "..", "public"),
    host: "127.0.0.1",
    port: 0,
    logger: { info() {}, warn() {} }
  });
  const address = await server.start();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const stateResponse = await fetch(`${baseUrl}/api/state`);
    assert.deepEqual(await stateResponse.json(), { revision: 7 });
    const deviceResponse = await fetch(`${baseUrl}/api/devices`);
    assert.deepEqual(await deviceResponse.json(), [
      { id: "simulation-camera", connectionState: "Simulation" }
    ]);
    const applicationResponse = await fetch(`${baseUrl}/`);
    const application = await applicationResponse.text();
    assert.match(application, /interface-model\.js/);
    assert.match(application, /transport-selection\.js/);
    assert.match(application, /remote-client\.js/);
    assert.match(application, /apple-mobile-web-app-capable/);
  } finally {
    await server.close();
  }
});
