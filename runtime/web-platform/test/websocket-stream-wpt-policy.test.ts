// Supplemental policy controls for the unchanged tentative WebSocketStream WPT.
// Draft: WHATWG WebSockets PR 48, d5570f3448ce165eacca2e0a519eeacd4d4a5123.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { AbortController, DOMException, WebSocketError, WebSocketStream } from "../src/index.ts";
import { installWebPlatformRuntime, WebPlatformRuntime } from "../src/provider.ts";
import type { CancelHandle, Scheduler } from "../src/provider/primitives.ts";
import type {
  SocketIncoming,
  SocketMessage,
  WebSocketSession,
} from "../src/websocket/transport.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, fn);
};

// An event-loop checkpoint, without an assertion about elapsed machine time.
const checkpoint = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function observeSettlement(promise: Promise<unknown>): { settled: boolean } {
  const result = { settled: false };
  promise.then(() => { result.settled = true; }, () => { result.settled = true; });
  return result;
}

class ControlledSession implements WebSocketSession {
  readonly protocol = "";
  readonly extensions = "";
  readonly sent: SocketMessage[] = [];
  readonly closes: { code: number | null; reason: string }[] = [];
  readonly sendGates: PromiseWithResolvers<void>[] = [];
  closeFailure: unknown = null;
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

  failRead(error: unknown): void {
    const read = this.reads.shift();
    assert.ok(read, "a transport read must be pending");
    read.reject(error);
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
    return this.closeFailure === null ? Promise.resolve() : Promise.reject(this.closeFailure);
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

// Draft sections 4.1 and 5: starting a handshake does not finish the readable.
for (const operation of ["public close", "writer close", "writable abort"] as const) {
  for (const clean of [true, false]) {
    suite(`WebSocketStream ${operation} keeps a read pending until ${clean ? "clean" : "abnormal"} closure`, async (t) => {
      const session = new ControlledSession();
      controlledRuntime(t, session);
      const stream = new WebSocketStream("ws://example.test/socket");
      const { readable, writable } = await stream.opened;
      const read = readable.getReader().read();
      const readState = observeSettlement(read);
      let closing: Promise<void>;
      if (operation === "public close") {
        stream.close();
        closing = Promise.resolve();
      } else if (operation === "writer close") {
        closing = writable.getWriter().close();
      } else {
        closing = writable.abort(new Error("application abort"));
      }
      observeSettlement(closing);
      await session.waitForCloses(1);
      await checkpoint();
      assert.equal(readState.settled, false, "a close request cannot complete a pending read");

      session.push({
        kind: "close",
        code: clean ? 1000 : 1006,
        reason: "",
        wasClean: clean,
        failed: !clean,
      });
      if (clean) {
        assert.deepEqual(await stream.closed, { closeCode: 1000, reason: "" });
        assert.deepEqual(await read, { value: undefined, done: true });
        await closing;
      } else {
        const error = await stream.closed.then(
          () => assert.fail("an abnormal closing handshake must reject"),
          (reason: unknown) => reason,
        );
        assert.ok(error instanceof WebSocketError);
        assert.equal(error.closeCode, 1006);
        await assert.rejects(read, (reason: unknown) => reason === error);
        if (operation === "writer close") {
          await assert.rejects(closing, (reason: unknown) => reason === error);
        } else {
          await closing;
        }
      }
    });
  }
}

suite("WebSocketStream send failure preserves the readable until peer close feedback", async (t) => {
  const session = new ControlledSession();
  controlledRuntime(t, session);
  const stream = new WebSocketStream("ws://example.test/socket");
  const { readable, writable } = await stream.opened;
  const read = readable.getReader().read();
  const readState = observeSettlement(read);
  const accepted = Promise.withResolvers<void>();
  session.sendGates.push(accepted);
  const write = writable.getWriter().write("pending");
  observeSettlement(write);
  await session.waitForSends(1);
  accepted.reject(new Error("peer stopped receiving"));
  await assert.rejects(write, (error: unknown) =>
    error instanceof DOMException && error.name === "InvalidStateError");
  await checkpoint();
  assert.equal(readState.settled, false, "write failure must preserve pending peer feedback");
  session.push({ kind: "close", code: 4001, reason: "peer", wasClean: true, failed: false });
  const error = await stream.closed.then(
    () => assert.fail("unwritten data must reject closed"),
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof WebSocketError);
  assert.equal(error.closeCode, 4001);
  assert.equal(error.reason, "peer");
  await assert.rejects(read, (reason: unknown) => reason === error);
});

suite("WebSocketStream readable cancellation still closes the readable immediately", async (t) => {
  const session = new ControlledSession();
  controlledRuntime(t, session);
  const stream = new WebSocketStream("ws://example.test/socket");
  const { readable } = await stream.opened;
  const reader = readable.getReader();
  const read = reader.read();
  await reader.cancel();
  assert.deepEqual(await read, { value: undefined, done: true });
  session.push({ kind: "close", code: 1006, reason: "", wasClean: false, failed: true });
  await assert.rejects(stream.closed, WebSocketError);
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
});

class ManualScheduler implements Scheduler {
  readonly tasks: (() => void)[] = [];
  readonly errors: unknown[] = [];

  enqueue(task: () => void): void {
    this.tasks.push(task);
  }

  delay(_milliseconds: number, _task: () => void): CancelHandle {
    return assert.fail("the controlled transport must not need a timer");
  }

  reportError(error: unknown): void {
    this.errors.push(error);
  }

  runNext(): void {
    const task = this.tasks.shift();
    assert.ok(task, "protocol feedback must queue a task");
    task();
  }

  runAll(): void {
    while (this.tasks.length !== 0) this.runNext();
  }
}

function manualRuntime(
  t: TestContext,
  session: ControlledSession,
  connect: () => Promise<WebSocketSession> = () => Promise.resolve(session),
) {
  const scheduler = new ManualScheduler();
  const runtime = new WebPlatformRuntime({
    ...createHostNodePrimitives({}, (error) => scheduler.reportError(error)),
    scheduler,
  }, { webSocketTransport: { connect } });
  installWebPlatformRuntime(runtime);
  t.after(async () => {
    runtime.close();
    await checkpoint();
    scheduler.runAll();
    assert.deepEqual(scheduler.errors, []);
  });
  return { scheduler, runtime };
}

async function openManually(scheduler: ManualScheduler) {
  const stream = new WebSocketStream("ws://example.test/socket");
  await checkpoint();
  scheduler.runAll();
  const opened = await stream.opened;
  await checkpoint();
  return { stream, ...opened };
}

// Draft section 4.1: promise continuations alone cannot publish protocol feedback.
suite("WebSocketStream publishes an established connection in a scheduler task", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const stream = new WebSocketStream("ws://example.test/socket");
  const opened = observeSettlement(stream.opened);
  await checkpoint();
  assert.equal(opened.settled, false);
  assert.equal(session.nextCalls, 0, "receiving starts after the open feedback task");
  scheduler.runNext();
  await stream.opened;
  await checkpoint();
  assert.equal(session.nextCalls, 1);
});

suite("WebSocketStream reports connection failure in a scheduler task", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session, () => Promise.reject(new Error("handshake failed")));
  const stream = new WebSocketStream("ws://example.test/socket");
  const opened = observeSettlement(stream.opened);
  const closed = observeSettlement(stream.closed);
  await checkpoint();
  assert.equal(opened.settled, false);
  assert.equal(closed.settled, false);
  scheduler.runNext();
  const error = await stream.opened.then(
    () => assert.fail("a failed handshake must reject"),
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof WebSocketError);
  await assert.rejects(stream.closed, (reason: unknown) => reason === error);
});

suite("WebSocketStream keeps signal abort ahead of queued connection failure", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session, () => Promise.reject(new Error("handshake failed")));
  const controller = new AbortController();
  const stream = new WebSocketStream("ws://example.test/socket", { signal: controller.signal });
  const opened = observeSettlement(stream.opened);
  await checkpoint();
  assert.equal(opened.settled, false);
  const reason = new Error("application abort");
  controller.abort(reason);
  await assert.rejects(stream.opened, (error: unknown) => error === reason);
  await assert.rejects(stream.closed, (error: unknown) => error === reason);
  scheduler.runAll();
  await assert.rejects(stream.opened, (error: unknown) => error === reason);
});

suite("WebSocketStream ignores signal abort after establishment before the open task", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const controller = new AbortController();
  const stream = new WebSocketStream("ws://example.test/socket", { signal: controller.signal });
  const opened = observeSettlement(stream.opened);
  await checkpoint();
  assert.equal(opened.settled, false);
  controller.abort(new Error("too late to abort the handshake"));
  scheduler.runNext();
  await stream.opened;
  assert.equal(session.aborted, false);
});

for (const operation of ["close", "shutdown"] as const) {
  suite(`WebSocketStream ${operation} before the queued open task never publishes open`, async (t) => {
    const session = new ControlledSession();
    const { scheduler, runtime } = manualRuntime(t, session);
    const stream = new WebSocketStream("ws://example.test/socket");
    const opened = observeSettlement(stream.opened);
    await checkpoint();
    assert.equal(opened.settled, false);
    if (operation === "close") stream.close();
    else runtime.close();
    const error = await stream.opened.then(
      () => assert.fail("a closed stream must not publish open"),
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof WebSocketError);
    await assert.rejects(stream.closed, (reason: unknown) => reason === error);
    scheduler.runAll();
    assert.equal(session.aborted, true);
    assert.equal(session.nextCalls, 0);
  });
}

suite("WebSocketStream schedules received messages and stops when its one-chunk queue is full", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { readable } = await openManually(scheduler);
  assert.equal(session.nextCalls, 1);
  session.push({ kind: "text", data: "first" });
  await checkpoint();
  assert.equal(scheduler.tasks.length, 1, "the received message needs a feedback task");
  assert.equal(session.nextCalls, 1);
  scheduler.runNext();
  await checkpoint();
  assert.equal(session.nextCalls, 1, "a full queue must not request another provider message");
  const reader = readable.getReader();
  assert.deepEqual(await reader.read(), { value: "first", done: false });
  await checkpoint();
  assert.equal(session.nextCalls, 2);
  const read = reader.read();
  const state = observeSettlement(read);
  session.push({ kind: "binary", data: Uint8Array.of(3) });
  await checkpoint();
  assert.equal(state.settled, false);
  scheduler.runNext();
  assert.deepEqual(await read, { value: Uint8Array.of(3), done: false });
});

suite("WebSocketStream close discards a queued message and settles the read on peer feedback", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, readable } = await openManually(scheduler);
  const read = readable.getReader().read();
  const state = observeSettlement(read);
  session.push({ kind: "text", data: "discard after close" });
  await checkpoint();
  assert.equal(state.settled, false);
  stream.close();
  scheduler.runNext();
  await checkpoint();
  assert.equal(state.settled, false);
  assert.equal(session.nextCalls, 2, "closing must continue draining provider feedback");
  session.push({ kind: "close", code: 1000, reason: "", wasClean: true, failed: false });
  await checkpoint();
  assert.equal(state.settled, false);
  scheduler.runNext();
  await stream.closed;
  assert.deepEqual(await read, { value: undefined, done: true });
});

suite("WebSocketStream shutdown rejects a read even when its message task is already queued", async (t) => {
  const session = new ControlledSession();
  const { scheduler, runtime } = manualRuntime(t, session);
  const { stream, readable } = await openManually(scheduler);
  const read = readable.getReader().read();
  const state = observeSettlement(read);
  session.push({ kind: "text", data: "discard after shutdown" });
  await checkpoint();
  assert.equal(state.settled, false);
  runtime.close();
  const error = await stream.closed.then(
    () => assert.fail("runtime shutdown must reject closed"),
    (reason: unknown) => reason,
  );
  await assert.rejects(read, (reason: unknown) => reason === error);
  scheduler.runAll();
  assert.equal(session.nextCalls, 1);
});

suite("WebSocketStream reports provider read failure from a scheduler task", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, readable } = await openManually(scheduler);
  const read = readable.getReader().read();
  const state = observeSettlement(read);
  session.failRead(new Error("provider read failed"));
  await checkpoint();
  assert.equal(state.settled, false);
  scheduler.runNext();
  const error = await stream.closed.then(
    () => assert.fail("provider failure must reject closed"),
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof WebSocketError);
  await assert.rejects(read, (reason: unknown) => reason === error);
});

// Draft section 4.2, write step 6.3: provider acceptance precedes the task settlement.
suite("WebSocketStream publishes send completion and releases write backpressure in a task", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { writable } = await openManually(scheduler);
  const writer = writable.getWriter();
  const write = writer.write("accepted");
  const written = observeSettlement(write);
  const ready = observeSettlement(writer.ready);
  await session.waitForSends(1);
  await checkpoint();
  assert.equal(written.settled, false);
  assert.equal(ready.settled, false);
  scheduler.runNext();
  await write;
  await writer.ready;
});

suite("WebSocketStream public close cannot strand an already accepted write task", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, writable } = await openManually(scheduler);
  const write = writable.getWriter().write("accepted");
  const state = observeSettlement(write);
  await session.waitForSends(1);
  await checkpoint();
  assert.equal(state.settled, false);
  stream.close();
  scheduler.runNext();
  await write;
  session.push({ kind: "close", code: 1000, reason: "", wasClean: true, failed: false });
  await checkpoint();
  scheduler.runNext();
  assert.deepEqual(await stream.closed, { closeCode: 1000, reason: "" });
});

suite("WebSocketStream shutdown settles a pending write before its stale completion task", async (t) => {
  const session = new ControlledSession();
  const { scheduler, runtime } = manualRuntime(t, session);
  const { stream, writable } = await openManually(scheduler);
  const write = writable.getWriter().write("accepted");
  const state = observeSettlement(write);
  await session.waitForSends(1);
  await checkpoint();
  assert.equal(state.settled, false);
  runtime.close();
  const error = await stream.closed.then(
    () => assert.fail("runtime shutdown must reject closed"),
    (reason: unknown) => reason,
  );
  await assert.rejects(write, (reason: unknown) => reason === error);
  scheduler.runAll();
  await assert.rejects(write, (reason: unknown) => reason === error);
});

suite("WebSocketStream peer close settles an unwritten send even when the provider resolves late", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, writable } = await openManually(scheduler);
  const accepted = Promise.withResolvers<void>();
  session.sendGates.push(accepted);
  const write = writable.getWriter().write("pending");
  observeSettlement(write);
  await session.waitForSends(1);
  session.push({ kind: "close", code: 4001, reason: "peer", wasClean: true, failed: false });
  await checkpoint();
  assert.equal(scheduler.tasks.length, 1);
  scheduler.runNext();
  const error = await stream.closed.then(
    () => assert.fail("unwritten data must reject closed"),
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof WebSocketError);
  assert.equal(error.closeCode, 4001);
  await assert.rejects(write, (reason: unknown) =>
    reason instanceof DOMException && reason.name === "InvalidStateError");
  accepted.resolve();
  await checkpoint();
  scheduler.runAll();
  assert.equal(session.sent.length, 1);
});

suite("WebSocketStream queued writes and writer close follow explicit provider and peer gates", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, writable } = await openManually(scheduler);
  const firstAccepted = Promise.withResolvers<void>();
  const secondAccepted = Promise.withResolvers<void>();
  session.sendGates.push(firstAccepted, secondAccepted);
  const writer = writable.getWriter();
  const first = writer.write("first");
  const second = writer.write("second");
  observeSettlement(first);
  observeSettlement(second);
  const closing = writer.close();
  const closeState = observeSettlement(closing);
  await session.waitForSends(1);
  await checkpoint();
  assert.deepEqual(session.sent, [{ kind: "text", data: "first" }]);
  assert.deepEqual(session.closes, []);
  firstAccepted.resolve();
  await checkpoint();
  assert.equal(session.sent.length, 1, "the second write waits for the first completion task");
  scheduler.runNext();
  await first;
  await session.waitForSends(2);
  assert.deepEqual(session.closes, []);
  secondAccepted.resolve();
  await checkpoint();
  assert.deepEqual(session.closes, [], "writer close waits for the second completion task");
  scheduler.runNext();
  await second;
  await session.waitForCloses(1);
  assert.equal(closeState.settled, false);
  session.push({ kind: "close", code: 1005, reason: "", wasClean: true, failed: false });
  await checkpoint();
  assert.equal(closeState.settled, false);
  scheduler.runNext();
  await closing;
  assert.deepEqual(await stream.closed, { closeCode: 1005, reason: "" });
});

suite("WebSocketStream readable cancellation drains a message whose delivery task is pending", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, readable } = await openManually(scheduler);
  const reader = readable.getReader();
  const read = reader.read();
  const state = observeSettlement(read);
  session.push({ kind: "text", data: "discard after cancellation" });
  await checkpoint();
  assert.equal(state.settled, false);
  await reader.cancel();
  assert.deepEqual(await read, { value: undefined, done: true });
  scheduler.runNext();
  assert.equal(session.nextCalls, 2);
  session.push({ kind: "close", code: 1005, reason: "", wasClean: true, failed: false });
  await checkpoint();
  scheduler.runNext();
  assert.deepEqual(await stream.closed, { closeCode: 1005, reason: "" });
});

suite("WebSocketStream writable abort waits for an already accepted write's completion task", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, writable } = await openManually(scheduler);
  const writer = writable.getWriter();
  const write = writer.write("accepted");
  const written = observeSettlement(write);
  await session.waitForSends(1);
  await checkpoint();
  assert.equal(written.settled, false);
  const reason = new Error("application abort");
  const abort = writer.abort(reason);
  const aborted = observeSettlement(abort);
  await checkpoint();
  assert.equal(aborted.settled, false);
  assert.deepEqual(session.closes, []);
  scheduler.runNext();
  await write;
  await abort;
  assert.deepEqual(session.closes, [{ code: null, reason: "" }]);
  await assert.rejects(writer.write("too late"), (error: unknown) => error === reason);
  session.push({ kind: "close", code: 1005, reason: "", wasClean: true, failed: false });
  await checkpoint();
  scheduler.runNext();
  await stream.closed;
});

suite("WebSocketStream queues a provider close failure before settling its readable and closed", async (t) => {
  const session = new ControlledSession();
  const { scheduler } = manualRuntime(t, session);
  const { stream, readable } = await openManually(scheduler);
  const read = readable.getReader().read();
  const readState = observeSettlement(read);
  const closedState = observeSettlement(stream.closed);
  session.closeFailure = new Error("provider close failed");
  stream.close();
  await checkpoint();
  assert.equal(readState.settled, false);
  assert.equal(closedState.settled, false);
  scheduler.runNext();
  const error = await stream.closed.then(
    () => assert.fail("provider close failure must reject closed"),
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof WebSocketError);
  await assert.rejects(read, (reason: unknown) => reason === error);
});

// Draft section 4.3 and Web IDL DOMString/default conversion distinguish null.
suite("WebSocketError defaults only an omitted or undefined message", () => {
  assert.equal(new WebSocketError().message, "");
  assert.equal(new WebSocketError(undefined).message, "");
  // @ts-expect-error -- JavaScript null must undergo DOMString conversion.
  assert.equal(new WebSocketError(null).message, "null");
  assert.equal(new WebSocketError("").message, "");
  assert.equal(new WebSocketError("\ud800").message, "\ud800", "message is DOMString, not USVString");
});
