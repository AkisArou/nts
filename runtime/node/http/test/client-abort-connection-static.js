"use strict";

// Supported behavior retained from pinned upstream test-http-client-abort3.js.
// The upstream second case replaces Agent.prototype.createConnection at
// runtime; the fixed-layout equivalent is a statically declared override.
const common = require("../common");
const http = require("http");
const net = require("net");

function createFailingConnection() {
  const socket = new net.Socket();
  process.nextTick(() => socket.destroy(new Error("Oops")));
  return socket;
}

function expectPostAbortConnectionError(request) {
  request.on("error", common.expectsError({ name: "Error", message: "Oops" }));
  request.abort();
}

expectPostAbortConnectionError(http.get({ createConnection: createFailingConnection }));

class CustomAgent extends http.Agent {
  createConnection() {
    return createFailingConnection();
  }
}

expectPostAbortConnectionError(http.get({ agent: new CustomAgent() }));
