// Supplemental policy regressions for the unchanged WebSocket WPT corpus.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Blob, CloseEvent, DOMException, Event, MessageEvent, WebSocket } from "../src/index.ts";
import type {
  SocketIncoming,
  SocketMessage,
  WebSocketSession,
} from "../src/websocket/transport.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 60_000 }, fn);
};

class RecordingSession implements WebSocketSession {
  readonly protocol = "";
  readonly extensions = "";
  readonly sent: SocketMessage[] = [];
  private readonly incoming: SocketIncoming[] = [];
  private readonly reads: PromiseWithResolvers<SocketIncoming>[] = [];
  private sendChanged = Promise.withResolvers<void>();

  next(): Promise<SocketIncoming> {
    const queued = this.incoming.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    const read = Promise.withResolvers<SocketIncoming>();
    this.reads.push(read);
    return read.promise;
  }

  push(value: SocketIncoming): void {
    const read = this.reads.shift();
    if (read === undefined) this.incoming.push(value);
    else read.resolve(value);
  }

  send(message: SocketMessage): Promise<void> {
    this.sent.push(message);
    this.sendChanged.resolve();
    this.sendChanged = Promise.withResolvers<void>();
    return Promise.resolve();
  }

  async waitForSends(count: number): Promise<void> {
    while (this.sent.length < count) await this.sendChanged.promise;
  }

  close(code: number | null, reason: string): Promise<void> {
    this.push({ kind: "close", code: code ?? 1005, reason, wasClean: true, failed: false });
    return Promise.resolve();
  }

  abort(): void {
    this.push({ kind: "close", code: 1006, reason: "", wasClean: false, failed: true });
  }
}

function controlledSocket(t: TestContext, connectError?: Error) {
  const session = new RecordingSession();
  const errors: unknown[] = [];
  const runtime = createHostNodeWebPlatform({
    webSocketTransport: {
      connect: () => connectError === undefined ? Promise.resolve(session) : Promise.reject(connectError),
    },
  }, {}, (error) => errors.push(error));
  t.after(() => runtime.close());
  const socket = new WebSocket("ws://example.test/socket");
  const opened = new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
  const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
  return { socket, session, opened, closed, errors };
}

// A JavaScript caller can supply values outside the TypeScript declaration.
function sendValue(socket: WebSocket, value: unknown): void {
  const send = socket.send as (this: WebSocket, value: unknown) => void;
  send.call(socket, value);
}

suite("WebSocket.send checks and converts its required argument before readyState", (t) => {
  const { socket } = controlledSocket(t);
  // @ts-expect-error -- missing the required union argument must throw TypeError.
  assert.throws(() => socket.send(), TypeError);
  assert.throws(() => sendValue(socket, Symbol("payload")), TypeError);

  const failure = new Error("conversion failed");
  let conversions = 0;
  assert.throws(() => sendValue(socket, {
    [Symbol.toPrimitive](hint: string) {
      assert.equal(hint, "string");
      conversions++;
      throw failure;
    },
  }), (error: unknown) => error === failure);
  assert.equal(conversions, 1);

  assert.throws(() => sendValue(socket, {
    toString() {
      conversions++;
      return "converted while connecting";
    },
  }), (error: unknown) => error instanceof DOMException && error.name === "InvalidStateError");
  assert.equal(conversions, 2);
  assert.equal(socket.bufferedAmount, 0);
});

suite("WebSocket.send selects USVString for other JavaScript values", async (t) => {
  const { socket, session, opened } = controlledSocket(t);
  await opened;
  let conversions = 0;
  const values: unknown[] = [undefined, null, 17, true, 23n, {
    [Symbol.toPrimitive](hint: string) {
      assert.equal(hint, "string");
      conversions++;
      return "\ud800";
    },
    get buffer(): never {
      return assert.fail("an ordinary object is not an ArrayBufferView");
    },
  }];
  const expected = ["undefined", "null", "17", "true", "23", "\ufffd"];
  for (const value of values) sendValue(socket, value);
  assert.equal(conversions, 1);
  assert.equal(socket.bufferedAmount, 24);
  await session.waitForSends(expected.length);
  assert.deepEqual(session.sent, expected.map((data) => ({ kind: "text", data })));
});

suite("WebSocket.send preserves binary union branches and snapshots views", async (t) => {
  const { socket, session, opened } = controlledSocket(t);
  await opened;
  const bytes = new Uint8Array([6, 7, 8, 9]);
  socket.send(new DataView(bytes.buffer, 1, 2));
  socket.send(bytes.buffer);
  socket.send(new Blob([bytes]));
  bytes.fill(0);
  await session.waitForSends(3);
  assert.deepEqual(session.sent, [
    { kind: "binary", data: new Uint8Array([7, 8]) },
    { kind: "binary", data: new Uint8Array([6, 7, 8, 9]) },
    { kind: "binary", data: new Uint8Array([6, 7, 8, 9]) },
  ]);
});

suite("WebSocket.send converts discarded data and counts its UTF-8 bytes after close", async (t) => {
  const { socket, session, opened, closed } = controlledSocket(t);
  await opened;
  socket.close();
  await closed;
  sendValue(socket, undefined);
  sendValue(socket, null);
  sendValue(socket, { toString: () => "\ud800" });
  assert.equal(socket.bufferedAmount, 16);
  assert.deepEqual(session.sent, []);
  assert.throws(() => sendValue(socket, Symbol("payload")), TypeError);
  // @ts-expect-error -- the required-argument check also applies after close.
  assert.throws(() => socket.send(), TypeError);
  assert.equal(socket.bufferedAmount, 16);
});

const handlerNames = ["onopen", "onerror", "onmessage", "onclose"] as const;
type HandlerName = typeof handlerNames[number];

function setHandlerValue(socket: WebSocket, name: HandlerName, value: unknown): void {
  const bindings: Record<HandlerName, unknown> = socket;
  bindings[name] = value;
}

function handlerEvent(name: HandlerName): Event {
  if (name === "onmessage") return new MessageEvent("message", { data: "payload" });
  if (name === "onclose") return new CloseEvent("close");
  return new Event(name.slice(2));
}

suite("WebSocket handler attributes convert primitives to null and retain non-callable objects", async (t) => {
  const { socket, opened, errors } = controlledSocket(t);
  await opened;
  const primitives: unknown[] = [null, undefined, false, 0, NaN, "handler", 1n, Symbol("handler")];
  const object = {
    get handleEvent(): never {
      return assert.fail("an event handler attribute must not call an object's handleEvent");
    },
  };
  for (const name of handlerNames) {
    for (const value of primitives) {
      setHandlerValue(socket, name, () => assert.fail("a primitive must clear the handler"));
      setHandlerValue(socket, name, value);
      assert.equal(socket[name], null);
      socket.dispatchEvent(handlerEvent(name));
    }
    setHandlerValue(socket, name, object);
    assert.equal(socket[name], object);
    socket.dispatchEvent(handlerEvent(name));
    setHandlerValue(socket, name, null);
  }
  assert.deepEqual(errors, []);
});

suite("WebSocket handler replacement preserves its listener position until a primitive clears it", async (t) => {
  const { socket, opened, errors } = controlledSocket(t);
  await opened;
  for (const name of handlerNames) {
    const order: string[] = [];
    const event = handlerEvent(name);
    const before = () => order.push("before");
    const after = () => order.push("after");
    const handler = function (this: WebSocket, received: Event): void {
      assert.equal(this, socket);
      assert.equal(received, event);
      order.push("handler");
    };
    socket.addEventListener(event.type, before);
    setHandlerValue(socket, name, {});
    socket.addEventListener(event.type, after);
    setHandlerValue(socket, name, handler);
    assert.equal(socket[name], handler);
    socket.dispatchEvent(event);
    assert.deepEqual(order, ["before", "handler", "after"]);

    order.length = 0;
    setHandlerValue(socket, name, {});
    setHandlerValue(socket, name, handler);
    socket.dispatchEvent(event);
    assert.deepEqual(order, ["before", "handler", "after"]);

    order.length = 0;
    setHandlerValue(socket, name, undefined);
    setHandlerValue(socket, name, handler);
    socket.dispatchEvent(event);
    assert.deepEqual(order, ["before", "after", "handler"]);

    setHandlerValue(socket, name, null);
    socket.removeEventListener(event.type, before);
    socket.removeEventListener(event.type, after);
  }
  assert.deepEqual(errors, []);
});

function assertScriptRedispatch(socket: WebSocket, events: readonly Event[]): void {
  for (const event of events) {
    const observations: { event: Event; trusted: boolean }[] = [];
    socket.addEventListener(event.type, (received) => {
      observations.push({ event: received, trusted: received.isTrusted });
    }, { once: true });
    socket.dispatchEvent(event);
    assert.equal(observations.length, 1);
    assert.equal(observations[0]?.event, event);
    assert.equal(observations[0]?.trusted, false);
    assert.equal(event.isTrusted, false);
  }
}

suite("WebSocket protocol open, message, and close events are trusted until script redispatch", async (t) => {
  const { socket, session, opened, closed, errors } = controlledSocket(t);
  const events: Event[] = [];
  const trust: boolean[] = [];
  const record = (event: Event): void => {
    events.push(event);
    trust.push(event.isTrusted);
  };
  for (const type of ["open", "message", "close"]) socket.addEventListener(type, record);
  await opened;
  const received = new Promise<void>((resolve) => socket.addEventListener("message", () => resolve(), { once: true }));
  session.push({ kind: "text", data: "message from the provider" });
  await received;
  socket.close(1000, "done");
  await closed;
  for (const type of ["open", "message", "close"]) socket.removeEventListener(type, record);

  assert.deepEqual(events.map((event) => event.type), ["open", "message", "close"]);
  assert.deepEqual(trust, [true, true, true]);
  assert.ok(events[1] instanceof MessageEvent);
  assert.ok(events[2] instanceof CloseEvent);
  assertScriptRedispatch(socket, events);
  assert.deepEqual(errors, []);
});

suite("WebSocket failed connection error and close events are trusted until script redispatch", async (t) => {
  const { socket, closed, errors } = controlledSocket(t, new Error("connection refused"));
  const events: Event[] = [];
  const trust: boolean[] = [];
  const record = (event: Event): void => {
    events.push(event);
    trust.push(event.isTrusted);
  };
  for (const type of ["open", "error", "close"]) socket.addEventListener(type, record);
  await closed;
  for (const type of ["open", "error", "close"]) socket.removeEventListener(type, record);

  assert.deepEqual(events.map((event) => event.type), ["error", "close"]);
  assert.deepEqual(trust, [true, true]);
  assert.ok(events[1] instanceof CloseEvent);
  assert.equal(events[1].code, 1006);
  assert.equal(events[1].wasClean, false);
  assertScriptRedispatch(socket, events);
  assert.deepEqual(errors, []);
});

suite("WebSocket handlers receive synthetic events regardless of interface or payload", async (t) => {
  const { socket, opened, errors } = controlledSocket(t);
  await opened;
  for (const name of handlerNames) {
    const received: Event[] = [];
    setHandlerValue(socket, name, function (this: WebSocket, event: Event): void {
      assert.equal(this, socket);
      received.push(event);
    });
    socket.dispatchEvent(new Event("unrelated"));
    assert.deepEqual(received, []);

    const synthetic = new Event(name.slice(2));
    socket.dispatchEvent(synthetic);
    assert.equal(received.length, 1);
    assert.equal(received[0], synthetic);
    if (name === "onmessage") {
      const scriptMessage = new MessageEvent("message", { data: { arbitrary: "script payload" } });
      socket.dispatchEvent(scriptMessage);
      assert.equal(received.length, 2);
      assert.equal(received[1], scriptMessage);
    }
    setHandlerValue(socket, name, null);
  }
  assert.deepEqual(errors, []);
});
