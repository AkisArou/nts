// Specification controls for source-policy edge cases absent from the pinned WPT.
// Upstream fixtures remain unedited in test/wpt/streams/.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { ReadableStream } from "../src/streams/readable.ts";
import type {
  ReadableByteStreamController,
  ReadableStreamBYOBView,
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
