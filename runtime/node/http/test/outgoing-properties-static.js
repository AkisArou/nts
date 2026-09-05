"use strict";

// Supported behavior retained from pinned upstream
// test-http-outgoing-properties.js. The upstream file replaces
// msg._implicitHeader at runtime; the fixed-layout equivalent is an ordinary
// class override.
const common = require("../common");
const assert = require("assert");
const http = require("http");
const { EventEmitter } = require("events");

{
  const message = new http.OutgoingMessage();
  assert.strictEqual(message.writableObjectMode, false);
  assert(message.writableHighWaterMark > 0);
  assert.strictEqual(message.writableLength, 0);
}

class HeaderlessMessage extends http.OutgoingMessage {
  _implicitHeader() {}
}

{
  const message = new HeaderlessMessage();
  message.write("abc");
  assert.strictEqual(message.writableLength, 3);
  const chunk = Buffer.alloc(4096);
  while (message.write(chunk));
  assert.strictEqual(message.writableNeedDrain, true);
  assert(message.outputSize >= message.writableHighWaterMark);
  message.destroy();
}

class RecordingSocket extends EventEmitter {
  writable = true;
  writableLength = 0;
  writableHighWaterMark = 64 * 1024;
  writes = [];

  write(chunk, encoding, callback) {
    if (typeof encoding === "function") callback = encoding;
    this.writes.push(chunk);
    if (callback) process.nextTick(callback);
    return true;
  }

  end() {}
  destroy() {}
  setTimeout() {}
  setNoDelay() {}
  setKeepAlive() {}
}

{
  const socket = new RecordingSocket();
  const message = new HeaderlessMessage();
  message.connection = socket;
  message.end(
    "hello world",
    common.mustCall((error) => {
      assert.strictEqual(error, null);
      assert.strictEqual(message.writableFinished, true);
      assert.strictEqual(socket.writes.length, 2);
      assert.strictEqual(socket.writes[0].toString(), "hello world");
      assert.strictEqual(socket.writes[1], "");
    }),
  );
}

class FailingSocket extends RecordingSocket {
  error = new Error("forced write failure");
  errored = null;

  write(chunk, encoding, callback) {
    if (typeof encoding === "function") callback = encoding;
    this.errored = this.error;
    if (callback) process.nextTick(callback, this.error);
    return true;
  }
}

{
  const socket = new FailingSocket();
  const message = new HeaderlessMessage();
  message.socket = socket;
  message.on("finish", common.mustNotCall());
  message.write(
    "body",
    common.mustCall((error) => {
      assert.strictEqual(error, socket.error);
    }),
  );
  message.end(
    common.mustCall((error) => {
      assert.strictEqual(error, socket.error);
      assert.strictEqual(message.writableFinished, false);
    }),
  );
}

const server = http.createServer(
  common.mustCall((request, response) => {
    assert.strictEqual(response.writableHighWaterMark, request.socket.writableHighWaterMark);
    assert.strictEqual(response.writableLength, 0);
    response.write("");
    const before = response.writableLength;
    response.write("abc");
    assert.strictEqual(response.writableLength, before + 8);
    response.end();
    response.on(
      "finish",
      common.mustCall(() => {
        assert.strictEqual(response.writableFinished, true);
        assert.strictEqual(response.closed, false);
        assert.strictEqual(response.writableLength, 0);
        server.close();
      }),
    );
    response.on(
      "close",
      common.mustCall(() => {
        assert.strictEqual(response.closed, true);
      }),
    );
  }),
);

server.listen(
  0,
  common.mustCall(() => {
    const request = http.request({
      port: server.address().port,
      method: "GET",
      path: "/",
    });
    assert.strictEqual(request.path, "/");
    assert.strictEqual(request.method, "GET");
    assert.strictEqual(request.host, "localhost");
    assert.strictEqual(request.protocol, "http:");
    request.end();
  }),
);
