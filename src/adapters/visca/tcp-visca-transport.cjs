"use strict";

const net = require("node:net");
const { classifyResponse, splitResponseFrames } = require("./visca-commands.cjs");

class TcpViscaTransport {
  constructor({ socketFactory = () => new net.Socket() } = {}) {
    this.socketFactory = socketFactory;
    this.activeSockets = new Set();
    this.closed = false;
  }

  request({ host, port, command, timeoutMs = 1500 }) {
    if (this.closed) return Promise.reject(new Error("VISCA transport is closed"));
    return new Promise((resolve, reject) => {
      const socket = this.socketFactory();
      this.activeSockets.add(socket);
      let settled = false;
      let received = Buffer.alloc(0);

      const finish = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeSockets.delete(socket);
        socket.destroy();
        if (error) reject(error);
        else resolve(response);
      };

      const timer = setTimeout(() => {
        finish(new Error(`VISCA request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once("error", error => finish(new Error(`VISCA connection failed: ${error.message}`)));
      socket.on("data", chunk => {
        received = Buffer.concat([received, chunk]);
        for (const frame of splitResponseFrames(received)) {
          const classification = classifyResponse(frame);
          if (classification === "error") {
            finish(new Error(`VISCA camera returned error response: ${frame.toString("hex")}`));
            return;
          }
          if (classification === "completion") {
            finish(null, frame);
            return;
          }
        }
      });
      socket.once("connect", () => socket.write(command));
      socket.connect(Number(port), host);
    });
  }

  close() {
    this.closed = true;
    for (const socket of this.activeSockets) socket.destroy();
    this.activeSockets.clear();
  }
}

module.exports = { TcpViscaTransport };
