// Controls for the WPT driver's provider drain. These gates describe causal
// completion; no assertion depends on elapsed time or host socket buffer sizes.
import assert from "node:assert/strict";
import test from "node:test";
import { AbortController, WritableStream } from "../src/index.ts";
import type { SocketIncoming, SocketMessage, WebSocketHandshake, WebSocketSession } from "../src/websocket/transport.ts";
import { createDrainableTransport } from "./wpt/websocket-stream-conformance/drainable-transport.ts";

const checkpoint = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const handshake: WebSocketHandshake = {
  url: new URL("ws://example.test/"),
  protocols: [],
  origin: "http://example.test",
};

function observeSettlement(promise: Promise<unknown>): { settled: boolean } {
  const result = { settled: false };
  void promise.then(() => { result.settled = true; }, () => { result.settled = true; });
  return result;
}

class ControlledSession implements WebSocketSession {
  readonly protocol = "echo";
  readonly extensions = "permessage-deflate";
  readonly read = Promise.withResolvers<SocketIncoming>();
  readonly sends: SocketMessage[] = [];
  readonly sendGates: PromiseWithResolvers<void>[] = [];
  readonly closeGate = Promise.withResolvers<void>();
  readonly closeCalls: { code: number | null; reason: string }[] = [];
  abortCalls = 0;
  private changed = Promise.withResolvers<void>();

  next(): Promise<SocketIncoming> { return this.read.promise; }

  send(message: SocketMessage): Promise<void> {
    this.sends.push(message);
    const gate = this.sendGates.shift();
    this.changed.resolve();
    this.changed = Promise.withResolvers<void>();
    return gate?.promise ?? Promise.resolve();
  }

  async waitForSends(count: number): Promise<void> {
    while (this.sends.length < count) await this.changed.promise;
  }

  close(code: number | null, reason: string): Promise<void> {
    this.closeCalls.push({ code, reason });
    return this.closeGate.promise;
  }

  abort(): void { this.abortCalls++; }
}

test("WPT drain waits for provider connection without changing its inputs or errors", { timeout: 60_000 }, async () => {
  const session = new ControlledSession();
  const connected = Promise.withResolvers<WebSocketSession>();
  const controller = new AbortController();
  const tracked = createDrainableTransport({
    connect(request, signal) {
      assert.equal(request, handshake);
      assert.equal(signal, controller.signal);
      return connected.promise;
    },
  });
  const connection = tracked.transport.connect(handshake, controller.signal);
  const drained = tracked.drain();
  const observation = observeSettlement(drained);
  await checkpoint();
  assert.equal(observation.settled, false);
  connected.resolve(session);
  const wrapped = await connection;
  await drained;
  assert.equal(wrapped.protocol, session.protocol);
  assert.equal(wrapped.extensions, session.extensions);
  assert.equal(wrapped.next(), session.read.promise, "the pending read is neither wrapped nor drained");
  wrapped.abort();
  assert.equal(session.abortCalls, 1);

  const failure = new Error("connection refused");
  const failed = createDrainableTransport({ connect() { return Promise.reject(failure); } });
  await assert.rejects(failed.transport.connect(handshake, controller.signal), (error: unknown) => error === failure);
  await failed.drain();
});

test("WPT drain waits for whole send and close operations while an idle read stays pending", { timeout: 60_000 }, async () => {
  const session = new ControlledSession();
  const accepted = Promise.withResolvers<void>();
  session.sendGates.push(accepted);
  const tracked = createDrainableTransport({ connect() { return Promise.resolve(session); } });
  const wrapped = await tracked.transport.connect(handshake, new AbortController().signal);
  assert.equal(wrapped.next(), session.read.promise);
  const message: SocketMessage = { kind: "binary", data: new Uint8Array([1, 2, 3]) };
  assert.equal(wrapped.send(message), accepted.promise);
  assert.equal(session.sends[0], message, "tracking does not copy a payload");
  assert.equal(wrapped.close(1000, "done"), session.closeGate.promise);
  assert.deepEqual(session.closeCalls, [{ code: 1000, reason: "done" }]);
  const drained = tracked.drain();
  const observation = observeSettlement(drained);
  await checkpoint();
  assert.equal(observation.settled, false);
  accepted.resolve();
  await checkpoint();
  assert.equal(observation.settled, false, "the close write still holds the drain open");
  session.closeGate.resolve();
  await drained;
  assert.equal(session.abortCalls, 0, "draining does not abort the provider");
});

test("WPT drain includes queued stream writes after a provider completion task", { timeout: 60_000 }, async () => {
  const session = new ControlledSession();
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  session.sendGates.push(first, second);
  const tracked = createDrainableTransport({ connect() { return Promise.resolve(session); } });
  const wrapped = await tracked.transport.connect(handshake, new AbortController().signal);
  const writable = new WritableStream<string>({
    async write(value) {
      assert.ok(typeof value === "string");
      await wrapped.send({ kind: "text", data: value });
      // The WebSocketStream draft queues a task before settling each write.
      await checkpoint();
    },
  });
  const writer = writable.getWriter();
  const writes = [writer.write("first"), writer.write("second")];
  await session.waitForSends(1);
  const drained = tracked.drain();
  const observation = observeSettlement(drained);
  first.resolve();
  await session.waitForSends(2);
  assert.equal(observation.settled, false, "a queued write still waits for its provider");
  second.resolve();
  await drained;
  await Promise.all(writes);
  assert.deepEqual(session.sends, [{ kind: "text", data: "first" }, { kind: "text", data: "second" }]);
});

test("WPT drain observes a provider handoff queued after its first checkpoint", { timeout: 60_000 }, async () => {
  const session = new ControlledSession();
  const accepted = Promise.withResolvers<void>();
  session.sendGates.push(accepted);
  const tracked = createDrainableTransport({ connect() { return Promise.resolve(session); } });
  const wrapped = await tracked.transport.connect(handshake, new AbortController().signal);
  const drained = tracked.drain();
  const observation = observeSettlement(drained);
  // Queue the handoff after drain has scheduled its first checkpoint. A drain
  // which accepts that first empty observation would finish before this work.
  queueMicrotask(() => {
    setImmediate(() => { void wrapped.send({ kind: "text", data: "queued" }); });
  });
  await session.waitForSends(1);
  assert.equal(observation.settled, false);
  accepted.resolve();
  await drained;
});

test("WPT drain preserves provider send rejections for the stream's caller", { timeout: 60_000 }, async () => {
  const session = new ControlledSession();
  const accepted = Promise.withResolvers<void>();
  session.sendGates.push(accepted);
  const tracked = createDrainableTransport({ connect() { return Promise.resolve(session); } });
  const wrapped = await tracked.transport.connect(handshake, new AbortController().signal);
  const writable = new WritableStream<string>({
    write(value) {
      assert.ok(typeof value === "string");
      return wrapped.send({ kind: "text", data: value });
    },
  });
  const failure = new Error("provider write failed");
  const write = writable.getWriter().write("message");
  const rejected = assert.rejects(write, (error: unknown) => error === failure);
  await session.waitForSends(1);
  const drained = tracked.drain();
  accepted.reject(failure);
  await rejected;
  await drained;
});
