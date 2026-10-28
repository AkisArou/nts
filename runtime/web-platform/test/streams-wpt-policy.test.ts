// Specification controls for source-policy edge cases absent from the pinned WPT.
// Upstream fixtures remain unedited in test/wpt/streams/.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { ReadableStream } from "../src/streams/readable.ts";
import type {
  ReadableByteStreamController,
  ReadableStreamBYOBView,
  UnderlyingByteSource,
} from "../src/streams/readable.ts";

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// https://streams.spec.whatwg.org/#readable-byte-stream-controller-pull-into
// Step 16.2 errors any queued underfill after close, including whole elements.
for (const fixture of [
  { name: "Uint8Array", bytes: [1, 2], view: (): ReadableStreamBYOBView => new Uint8Array(4) },
  { name: "Uint16Array", bytes: [1, 2, 3, 4], view: (): ReadableStreamBYOBView => new Uint16Array(4) },
]) {
  test(`BYOB aligned ${fixture.name} underfill after close rejects read and closed`, async (t) => {
    let controller!: ReadableByteStreamController;
    const callbacks: string[] = [];
    const stream = new ReadableStream({
      type: "bytes",
      start(value) {
        controller = value;
        value.enqueue(new Uint8Array(fixture.bytes));
        value.close();
      },
      pull() { callbacks.push("pull"); },
      cancel() { callbacks.push("cancel"); },
    });
    const reader = stream.getReader({ mode: "byob" });
    t.after(async () => { await reader.cancel().catch(() => {}); });
    const order: string[] = [];
    let readError: unknown;
    let closedError: unknown;
    void reader.closed.then(
      () => { order.push("closed fulfilled"); },
      (error: unknown) => { closedError = error; order.push("closed rejected"); },
    );
    void reader.read(fixture.view(), { min: 4 }).then(
      () => { order.push("read fulfilled"); },
      (error: unknown) => { readError = error; order.push("read rejected"); },
    );
    // The queued bytes and close request are already available. A task turn lets
    // their promise reactions run without waiting forever on the defective path.
    await nextTurn();
    assert.deepEqual(order, ["closed rejected", "read rejected"]);
    assert.ok(readError instanceof TypeError);
    assert.equal(readError, closedError);
    assert.equal(controller.desiredSize, null);
    assert.throws(() => controller.enqueue(new Uint8Array([5])), TypeError);
    assert.deepEqual(callbacks, []);
  });
}

test("BYOB minimum met by the final queued chunk succeeds before the closed read", async () => {
  const stream = new ReadableStream({
    type: "bytes",
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      controller.close();
    },
  });
  const reader = stream.getReader({ mode: "byob" });
  const chunk = await reader.read(new Uint8Array(4), { min: 4 });
  assert.equal(chunk.done, false);
  assert.deepEqual(chunk.value, new Uint8Array([1, 2, 3, 4]));
  await reader.closed;
  const end = await reader.read(new Uint8Array(4), { min: 4 });
  assert.equal(end.done, true);
  assert.equal(end.value?.byteLength, 0);
});

// https://streams.spec.whatwg.org/#readable-stream-cancel
// Closing precedes the underlying cancellation callback, including for bytes.
test("byte cancellation invokes the saved callback with a closed controller", async () => {
  let controller!: ReadableByteStreamController;
  let calls = 0;
  let receiver: UnderlyingByteSource | undefined;
  let receivedReason: unknown;
  let desiredSize: number | null | undefined;
  let enqueueError: unknown;
  let closeError: unknown;
  const source: UnderlyingByteSource = {
    type: "bytes",
    start(value) { controller = value; },
    cancel(reason) {
      calls++;
      receiver = this;
      receivedReason = reason;
      desiredSize = controller.desiredSize;
      try { controller.enqueue(new Uint8Array([1])); }
      catch (error) { enqueueError = error; }
      try { controller.close(); }
      catch (error) { closeError = error; }
    },
  };
  const stream = new ReadableStream(source, { highWaterMark: 2 });
  const reason = {};
  await stream.cancel(reason);
  await stream.cancel("second cancellation");
  assert.equal(calls, 1);
  assert.equal(receiver, source);
  assert.equal(receivedReason, reason);
  assert.equal(desiredSize, 0);
  assert.ok(enqueueError instanceof TypeError);
  assert.ok(closeError instanceof TypeError);
  const end = await stream.getReader().read();
  assert.deepEqual(end, { done: true, value: undefined });
});

test("byte cancellation closes pending reads before a callback error rejects cancellation", async () => {
  let controller!: ReadableByteStreamController;
  const callbackError = new Error("underlying cancellation failed");
  const ignoredError = new Error("error after cancellation closed the stream");
  const events: string[] = [];
  const stream = new ReadableStream({
    type: "bytes",
    start(value) { controller = value; },
    cancel() {
      events.push("cancel callback");
      controller.error(ignoredError);
      throw callbackError;
    },
  });
  const reader = stream.getReader({ mode: "byob" });
  const closed = reader.closed.then(
    () => { events.push("closed fulfilled"); },
    () => { events.push("closed rejected"); },
  );
  const read = reader.read(new Uint8Array(4)).then(
    (result) => {
      events.push("read fulfilled");
      assert.deepEqual(result, { done: true, value: undefined });
    },
    () => { events.push("read rejected"); },
  );
  const cancellation = reader.cancel("reason").then(
    () => { assert.fail("the underlying cancellation error must reject cancellation"); },
    (error: unknown) => {
      events.push("cancel rejected");
      assert.equal(error, callbackError);
    },
  );
  await Promise.all([closed, read, cancellation]);
  assert.deepEqual(events, ["cancel callback", "closed fulfilled", "read fulfilled", "cancel rejected"]);
  assert.equal(controller.desiredSize, 0);
});
