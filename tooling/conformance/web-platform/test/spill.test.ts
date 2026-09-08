// Spill-to-disk: the plan's "large payloads are not forced into RAM" row.
//
// The byte store's second consumer, and the first to use its ranged-read side. What
// comes back is a Blob either way, which is the claim worth testing hardest -- a
// consumer of a spilled body must not be able to tell, except by asking.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AbortController,
  DurableSpillArea,
  ReadableStream,
} from "../../../../runtime/web-platform/src/index.ts";
import { durableStoreFromFlat } from "../../../../runtime/web-platform/src/provider.ts";
import { HostNodeDurableStore } from "../node-runtime.ts";
import { FakeFlat } from "./fake-flat.ts";

const encoder = new TextEncoder();
const none = () => new AbortController().signal;

const BACKENDS = [
  {
    name: "host filesystem",
    make(t) {
      const root = mkdtempSync(join(tmpdir(), "nts-spill-"));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      return new HostNodeDurableStore({ root });
    },
  },
  {
    name: "flat provider through the adapter",
    make() {
      return durableStoreFromFlat(new FakeFlat());
    },
  },
];

/** A stream of `count` chunks of `size` bytes, each filled with its own index. */
function chunkedStream(count, size, hooks = {}) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= count) {
        controller.close();
        return;
      }
      if (hooks.failAt === index) {
        controller.error(hooks.failure);
        return;
      }
      hooks.onChunk?.(index);
      controller.enqueue(new Uint8Array(size).fill(index % 251));
      index++;
    },
    cancel(reason) {
      hooks.onCancel?.(reason);
    },
  });
}

function expectedBytes(count, size) {
  const out = new Uint8Array(count * size);
  for (let index = 0; index < count; index++) {
    out.fill(index % 251, index * size, (index + 1) * size);
  }
  return out;
}

/** Records what actually reached the store, so "streamed" can be more than a comment. */
function recording(store) {
  const appends = [];
  const settled = [];
  return {
    appends,
    settled,
    store: {
      read: (...args) => store.read(...args),
      source: (...args) => store.source(...args),
      delete: (...args) => store.delete(...args),
      list: (...args) => store.list(...args),
      size: (...args) => store.size(...args),
      close: () => store.close(),
      async write(namespace, key, signal) {
        const write = await store.write(namespace, key, signal);
        return {
          async append(bytes) {
            appends.push(bytes.length);
            await write.append(bytes);
          },
          commit() {
            settled.push("commit");
            return write.commit();
          },
          discard() {
            settled.push("discard");
            return write.discard();
          },
        };
      },
    },
  };
}

for (const backend of BACKENDS) {
  const suite = (name, fn) => test(`${name} [${backend.name}]`, { timeout: 8000 }, fn);

  suite("a body under the threshold never reaches the store", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 4096 });
    const body = await area.spill(chunkedStream(4, 256), none(), "text/plain");

    assert.equal(body.spilled, false);
    assert.equal(body.size, 1024);
    assert.equal(body.blob.size, 1024);
    assert.equal(body.blob.type, "text/plain");
    assert.deepEqual(new Uint8Array(await body.blob.arrayBuffer()), expectedBytes(4, 256));
    assert.deepEqual(await bytes.list("spill", none()), []);
    await body.release();
  });

  suite("a body over the threshold spills and reads back byte for byte", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 1024 });
    const body = await area.spill(chunkedStream(16, 256), none(), "application/octet-stream");

    assert.equal(body.spilled, true);
    assert.equal(body.size, 4096);
    assert.equal(body.blob.size, 4096);
    assert.equal(body.blob.type, "application/octet-stream");
    assert.deepEqual(new Uint8Array(await body.blob.arrayBuffer()), expectedBytes(16, 256));
    assert.equal((await bytes.list("spill", none())).length, 1);

    await body.release();
    assert.deepEqual(await bytes.list("spill", none()), [], "release removes the stored bytes");
    await body.release();
  });

  suite("a spilled blob slices through the store's ranged reads", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 64 });
    const body = await area.spill(chunkedStream(8, 128), none());

    // The whole point of `BlobExternalSource`: a slice reopens the range rather than
    // materialising the body to cut a piece out of it.
    const middle = body.blob.slice(200, 400);
    assert.equal(middle.size, 200);
    assert.deepEqual(
      new Uint8Array(await middle.arrayBuffer()),
      expectedBytes(8, 128).subarray(200, 400),
    );
    // Two slices read independently, which a shared read offset would break.
    const first = body.blob.slice(0, 10);
    const last = body.blob.slice(1014, 1024);
    const [a, b] = await Promise.all([first.arrayBuffer(), last.arrayBuffer()]);
    assert.deepEqual(new Uint8Array(a), expectedBytes(8, 128).subarray(0, 10));
    assert.deepEqual(new Uint8Array(b), expectedBytes(8, 128).subarray(1014, 1024));
    await body.release();
  });

  suite("the body is written as it arrives, not assembled and then written", async (t) => {
    const recorder = recording(backend.make(t));
    const area = await DurableSpillArea.open(recorder.store, { memoryThresholdBytes: 1024 });
    const body = await area.spill(chunkedStream(16, 256), none());

    assert.equal(body.spilled, true);
    // The first append carries what was held while under the threshold; every later
    // chunk goes out on its own. A single append the size of the body would mean the
    // whole thing was in memory, which is the condition this exists to avoid.
    assert.ok(recorder.appends.length > 1, `expected streaming appends, saw ${recorder.appends}`);
    assert.ok(
      Math.max(...recorder.appends) <= 1280,
      `no append may carry the whole body: ${recorder.appends}`,
    );
    assert.equal(
      recorder.appends.reduce((total, size) => total + size, 0),
      4096,
    );
    await body.release();
  });

  suite("a body past the byte limit is refused and leaves nothing", async (t) => {
    const recorder = recording(backend.make(t));
    const bytes = recorder.store;
    const area = await DurableSpillArea.open(bytes, {
      memoryThresholdBytes: 128,
      maxBytes: 512,
    });
    let cancelled;
    const stream = chunkedStream(16, 256, { onCancel: (reason) => (cancelled = reason) });

    await assert.rejects(() => area.spill(stream, none()), { name: "LimitError" });
    assert.equal(cancelled?.name, "LimitError", "the producer is told to stop");
    assert.deepEqual(await bytes.list("spill", none()), []);
    // An empty namespace is not proof the write went away: an uncommitted write is
    // invisible to `list` and still holds its key. The discard has to be observed.
    assert.deepEqual(recorder.settled, ["discard"]);
  });

  suite("an abort mid-body rejects with the exact reason and leaves nothing", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 128 });
    const controller = new AbortController();
    const reason = new Error("the caller gave up");
    let cancelled;
    const stream = chunkedStream(16, 256, {
      onChunk: (index) => {
        if (index === 4) controller.abort(reason);
      },
      onCancel: (value) => (cancelled = value),
    });

    await assert.rejects(
      () => area.spill(stream, controller.signal),
      (thrown) => thrown === reason,
    );
    assert.equal(cancelled, reason);
    assert.deepEqual(await bytes.list("spill", none()), []);
  });

  suite("an already-aborted signal is refused without consuming the stream", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 8 });
    const controller = new AbortController();
    const reason = new Error("too late");
    controller.abort(reason);
    let cancelled = false;
    const stream = chunkedStream(4, 8, { onCancel: () => (cancelled = true) });

    await assert.rejects(
      () => area.spill(stream, controller.signal),
      (thrown) => thrown === reason,
    );
    assert.deepEqual(await bytes.list("spill", none()), []);
    // Not "no chunk was pulled" -- a stream fills its queue on construction, so that
    // would pass without anyone reading it. The claim is that spill left the stream
    // usable: neither cancelled nor part-consumed, so a caller can try again.
    assert.equal(cancelled, false);
    assert.equal(stream.locked, false);
    const retried = await area.spill(stream, none());
    assert.deepEqual(new Uint8Array(await retried.blob.arrayBuffer()), expectedBytes(4, 8));
    await retried.release();
  });

  suite("a stream that fails part way leaves nothing behind", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 128 });
    const failure = new Error("the producer broke");
    const stream = chunkedStream(16, 256, { failAt: 6, failure });

    await assert.rejects(
      () => area.spill(stream, none()),
      (thrown) => thrown === failure,
    );
    assert.deepEqual(await bytes.list("spill", none()), []);
  });

  suite("concurrent spills get their own keys and read back independently", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 64 });
    const [first, second] = await Promise.all([
      area.spill(chunkedStream(4, 128), none()),
      area.spill(chunkedStream(6, 128), none()),
    ]);

    assert.equal(first.spilled, true);
    assert.equal(second.spilled, true);
    assert.equal((await bytes.list("spill", none())).length, 2);
    assert.deepEqual(new Uint8Array(await first.blob.arrayBuffer()), expectedBytes(4, 128));
    assert.deepEqual(new Uint8Array(await second.blob.arrayBuffer()), expectedBytes(6, 128));

    await first.release();
    assert.equal((await bytes.list("spill", none())).length, 1, "one release, one survivor");
    assert.deepEqual(new Uint8Array(await second.blob.arrayBuffer()), expectedBytes(6, 128));
    await second.release();
  });

  suite("opening the area discards whatever the last run left", async (t) => {
    const bytes = backend.make(t);
    const first = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 64 });
    const stranded = await first.spill(chunkedStream(4, 128), none());
    assert.equal(stranded.spilled, true);
    assert.equal((await bytes.list("spill", none())).length, 1);

    // Nothing can name it again, so it is not data -- it is a leak.
    await DurableSpillArea.open(bytes);
    assert.deepEqual(await bytes.list("spill", none()), []);
  });

  suite("an empty body is a zero-length blob and touches nothing", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 0 });
    const body = await area.spill(chunkedStream(0, 0), none());
    assert.equal(body.spilled, false);
    assert.equal(body.size, 0);
    assert.equal(body.blob.size, 0);
    assert.deepEqual(await bytes.list("spill", none()), []);
  });

  suite("a zero threshold spills the very first chunk", async (t) => {
    const bytes = backend.make(t);
    const area = await DurableSpillArea.open(bytes, { memoryThresholdBytes: 0 });
    const body = await area.spill(chunkedStream(3, 32), none());
    assert.equal(body.spilled, true);
    assert.deepEqual(new Uint8Array(await body.blob.arrayBuffer()), expectedBytes(3, 32));
    await body.release();
  });
}
