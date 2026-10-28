// Supplemental policy controls for the unchanged tentative WebSocketStream WPT.
// Draft: WHATWG WebSockets PR 48, d5570f3448ce165eacca2e0a519eeacd4d4a5123.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { WebSocketError, WebSocketStream } from "../src/index.ts";
import type {
  SocketIncoming,
  SocketMessage,
  WebSocketSession,
} from "../src/websocket/transport.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 60_000 }, fn);
};

class ControlledSession implements WebSocketSession {
  readonly protocol = "";
  readonly extensions = "";
  readonly sent: SocketMessage[] = [];
  readonly closes: { code: number | null; reason: string }[] = [];
  readonly sendGates: PromiseWithResolvers<void>[] = [];
  nextCalls = 0;
  aborted = false;
  private readonly incoming: SocketIncoming[] = [];
  private readonly reads: PromiseWithResolvers<SocketIncoming>[] = [];
  private sendChanged = Promise.withResolvers<void>();
  private closeChanged = Promise.withResolvers<void>();

  next(): Promise<SocketIncoming> {
    this.nextCalls++;
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
    const gate = this.sendGates.shift();
    this.sent.push(message);
    this.sendChanged.resolve();
    this.sendChanged = Promise.withResolvers<void>();
    return gate?.promise ?? Promise.resolve();
  }

  async waitForSends(count: number): Promise<void> {
    while (this.sent.length < count) await this.sendChanged.promise;
  }

  close(code: number | null, reason: string): Promise<void> {
    this.closes.push({ code, reason });
    this.closeChanged.resolve();
    this.closeChanged = Promise.withResolvers<void>();
    return Promise.resolve();
  }

  async waitForCloses(count: number): Promise<void> {
    while (this.closes.length < count) await this.closeChanged.promise;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.push({ kind: "close", code: 1006, reason: "", wasClean: false, failed: true });
  }
}

function controlledRuntime(t: TestContext, ...sessions: ControlledSession[]) {
  let next = 0;
  const errors: unknown[] = [];
  const runtime = createHostNodeWebPlatform({
    webSocketTransport: {
      connect() {
        const session = sessions[next++];
        assert.ok(session, "the test must provide each connection's session");
        return Promise.resolve(session);
      },
    },
  }, {}, (error) => errors.push(error));
  t.after(() => {
    runtime.close();
    assert.deepEqual(errors, []);
  });
  return runtime;
}

// Draft section 4.2, write steps 4 and 5: snapshot BufferSource; otherwise USVString.
suite("WebSocketStream converts text writes to USVString before provider dispatch", async (t) => {
  const session = new ControlledSession();
  controlledRuntime(t, session);
  const stream = new WebSocketStream("ws://example.test/socket");
  const { writable } = await stream.opened;
  const writer = writable.getWriter();
  let conversions = 0;
  for (const value of [undefined, null, 17, true, 23n, "\ud800", "\udc00", "🔌", {
    [Symbol.toPrimitive](hint: string) {
      assert.equal(hint, "string");
      conversions++;
      return "left\ud800right";
    },
  }]) {
    await writer.write(value);
  }
  assert.equal(conversions, 1);
  assert.deepEqual(session.sent, [
    "undefined", "null", "17", "true", "23", "\ufffd", "\ufffd", "🔌", "left\ufffdright",
  ].map((data) => ({ kind: "text", data })));
});

suite("WebSocketStream snapshots only a view's bytes before the provider accepts them", async (t) => {
  const session = new ControlledSession();
  controlledRuntime(t, session);
  const stream = new WebSocketStream("ws://example.test/socket");
  const { writable } = await stream.opened;
  const writer = writable.getWriter();
  const accepted = Promise.withResolvers<void>();
  session.sendGates.push(accepted);
  const bytes = Uint8Array.of(4, 5, 6, 7);
  const write = writer.write(new DataView(bytes.buffer, 1, 2));
  await session.waitForSends(1);
  bytes.fill(0);
  assert.deepEqual(session.sent, [{ kind: "binary", data: Uint8Array.of(5, 6) }]);
  accepted.resolve();
  await write;
});

suite("WebSocketStream rejects a failed text conversion without sending a message", async (t) => {
  const session = new ControlledSession();
  controlledRuntime(t, session);
  const stream = new WebSocketStream("ws://example.test/socket");
  const { writable } = await stream.opened;
  const writer = writable.getWriter();
  const failure = new Error("conversion failed");
  let conversions = 0;
  await assert.rejects(writer.write({
    toString() {
      conversions++;
      throw failure;
    },
  }), (error: unknown) => error === failure);
  assert.equal(conversions, 1);
  assert.deepEqual(session.sent, []);
});

// Draft section 4.2, close using reason step 4: validate received error fields too.
for (const operation of ["cancel", "abort"] as const) {
  for (const code of [1001, 1006]) {
    suite(`WebSocketStream ${operation} discards a received close code ${code} and its reason`, async (t) => {
      const sourceSession = new ControlledSession();
      const targetSession = new ControlledSession();
      controlledRuntime(t, sourceSession, targetSession);
      const source = new WebSocketStream("ws://example.test/source");
      await source.opened;
      sourceSession.push({ kind: "close", code, reason: "from peer", wasClean: false, failed: true });
      const error = await source.closed.then(
        () => assert.fail("an abnormal source close must reject"),
        (reason: unknown) => reason,
      );
      assert.ok(error instanceof WebSocketError);
      assert.equal(error.closeCode, code);
      assert.equal(error.reason, "from peer");

      const target = new WebSocketStream("ws://example.test/target");
      const { readable, writable } = await target.opened;
      if (operation === "cancel") await readable.cancel(error);
      else await writable.abort(error);
      assert.deepEqual(targetSession.closes, [{ code: null, reason: "" }]);
      assert.equal(error.closeCode, code, "the received error must not be changed");
      assert.equal(error.reason, "from peer");
    });
  }
}

suite("WebSocketStream cancel and abort preserve valid WebSocketError close information", async (t) => {
  const sessions = Array.from({ length: 4 }, () => new ControlledSession());
  controlledRuntime(t, ...sessions);
  let next = 0;
  for (const operation of ["cancel", "abort"] as const) {
    for (const error of [new WebSocketError(), new WebSocketError("application", {
      closeCode: 4001,
      reason: "finished",
    })]) {
      const stream = new WebSocketStream("ws://example.test/socket");
      const { readable, writable } = await stream.opened;
      if (operation === "cancel") await readable.cancel(error);
      else await writable.abort(error);
      assert.deepEqual(sessions[next++]?.closes, [{ code: error.closeCode, reason: error.reason }]);
    }
  }
});
