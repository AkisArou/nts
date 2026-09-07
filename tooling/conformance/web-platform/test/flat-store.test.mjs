// The flat-to-DurableByteStore adapter, exercised against a fake provider.
//
// This is the shared half of the storage seam. A provider gives twelve synchronous
// functions over scalars, strings and caller-owned views -- the shape a foreign-function
// boundary can carry -- and everything the contract adds above it is written once here:
// promises, the `AbortSignal` checked between chunks, the write as an object with a
// lifetime, the two-call retry when a fill buffer was short, and the record encoding.
//
// The fake provider is the point rather than a shortcut. Testing the adapter against a
// real store would mean every assertion below could also be answered by the store, and
// the parts most likely to differ between platforms are exactly these. The Android and
// host providers owe their own evidence for the flat surface; this owes the layer above.
import assert from "node:assert/strict";
import test from "node:test";

import { AbortController } from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { durableStoreFromFlat } from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const none = () => new AbortController().signal;
const at = (namespace, key) => `${namespace} ${key}`;

/** Decimal digits then NUL, as the record encoding writes them. */
function pushNumber(out, value) {
  for (const code of String(value)) out.push(code.charCodeAt(0));
  out.push(0);
}

class FakeFlat {
  constructor() {
    this.values = new Map();
    this.writes = new Map();
    this.sources = new Map();
    this.live = new Set();
    this.next = 1;
    this.clock = 1000;
    this.closed = false;
    this.reads = 0;
    this.lists = 0;
  }

  open(namespace, key) {
    if (this.live.has(at(namespace, key))) return -1;
    this.live.add(at(namespace, key));
    const handle = this.next++;
    this.writes.set(handle, { namespace, key, chunks: [] });
    return handle;
  }

  append(handle, from) {
    const write = this.writes.get(handle);
    assert.ok(write, "append on a handle the adapter did not open");
    // Copied, because the caller owns the view it handed down.
    write.chunks.push(from.slice());
  }

  commit(handle) {
    const write = this.writes.get(handle);
    assert.ok(write, "commit on a handle the adapter did not open");
    let total = 0;
    for (const chunk of write.chunks) total += chunk.length;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of write.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.values.set(at(write.namespace, write.key), {
      key: write.key,
      namespace: write.namespace,
      bytes,
      modified: this.clock++,
    });
    this.writes.delete(handle);
    this.live.delete(at(write.namespace, write.key));
  }

  discard(handle) {
    const write = this.writes.get(handle);
    if (write === undefined) return;
    this.writes.delete(handle);
    this.live.delete(at(write.namespace, write.key));
  }

  read(namespace, key, into) {
    this.reads++;
    const record = this.values.get(at(namespace, key));
    if (record === undefined) return -1;
    into.set(record.bytes.subarray(0, Math.min(record.bytes.length, into.length)));
    return record.bytes.length;
  }

  remove(namespace, key) {
    return this.values.delete(at(namespace, key));
  }

  list(namespace, into) {
    this.lists++;
    const out = [];
    for (const record of this.values.values()) {
      if (record.namespace !== namespace) continue;
      const key = encoder.encode(record.key);
      pushNumber(out, record.bytes.length);
      pushNumber(out, record.modified);
      pushNumber(out, key.length);
      for (const byte of key) out.push(byte);
    }
    const bytes = Uint8Array.from(out);
    into.set(bytes.subarray(0, Math.min(bytes.length, into.length)));
    return bytes.length;
  }

  size(namespace) {
    let total = 0;
    for (const record of this.values.values()) {
      if (record.namespace === namespace) total += record.bytes.length;
    }
    return total;
  }

  sourceOpen(namespace, key, start, length) {
    const record = this.values.get(at(namespace, key));
    if (record === undefined) return -1;
    const handle = this.next++;
    this.sources.set(handle, {
      bytes: record.bytes,
      position: start,
      end: Math.min(start + length, record.bytes.length),
    });
    return handle;
  }

  sourceRead(handle, into) {
    const source = this.sources.get(handle);
    assert.ok(source, "sourceRead on a handle the adapter did not open");
    if (source.position >= source.end) return -1;
    const count = Math.min(into.length, source.end - source.position);
    into.set(source.bytes.subarray(source.position, source.position + count));
    source.position += count;
    return count;
  }

  sourceClose(handle) {
    this.sources.delete(handle);
  }

  sourceSize(namespace, key) {
    const record = this.values.get(at(namespace, key));
    return record === undefined ? -1 : record.bytes.length;
  }

  close() {
    this.closed = true;
  }
}

function adapted() {
  const flat = new FakeFlat();
  return { flat, store: durableStoreFromFlat(flat) };
}

async function put(target, namespace, key, bytes, signal = none()) {
  const write = await target.write(namespace, key, signal);
  await write.append(bytes);
  await write.commit();
}

suite("a value written through the adapter reads back whole and by range", async () => {
  const { store } = adapted();
  await put(store, "cache", "greeting", encoder.encode("hello durable world"));

  assert.equal(
    decoder.decode(await store.read("cache", "greeting", none())),
    "hello durable world",
  );

  const source = await store.source("cache", "greeting", none());
  assert.equal(source.size, 19);
  const reader = source.open(6, 7);
  assert.equal(decoder.decode(await reader.read(64)), "durable");
  assert.equal(await reader.read(64), undefined, "the range ends where it was asked to");
  await reader.close();
});

suite("a value larger than the first fill buffer reads back whole", async () => {
  const { flat, store } = adapted();
  // Larger than the adapter's initial guess, so the short-buffer retry is the only
  // way the whole value comes back.
  const payload = new Uint8Array(9001);
  for (let index = 0; index < payload.length; index++) payload[index] = index % 251;
  await put(store, "cache", "big", payload);

  const read = await store.read("cache", "big", none());
  assert.equal(read.length, 9001);
  assert.deepEqual(read, payload);
  assert.equal(flat.reads, 2, "the retry is one further call, not a search");
});

suite("a fill buffer that was long enough is not asked twice", async () => {
  const { flat, store } = adapted();
  await put(store, "cache", "small", encoder.encode("short"));
  assert.equal(decoder.decode(await store.read("cache", "small", none())), "short");
  assert.equal(flat.reads, 1);
});

suite("list survives keys that contain the separator and non-ASCII text", async () => {
  const { store } = adapted();
  // A key may hold any byte. The encoding carries an explicit key length for exactly
  // this: scanning for the next NUL would split this key into two records.
  const awkward = "with\u0000nul";
  await put(store, "cache", awkward, encoder.encode("a"));
  await put(store, "cache", "é中文", encoder.encode("bb"));
  await put(store, "other", "elsewhere", encoder.encode("ccc"));

  const records = await store.list("cache", none());
  assert.deepEqual(
    records.map((record) => record.key).sort(),
    [awkward, "é中文"].sort(),
  );
  const bySize = new Map(records.map((record) => [record.key, record.size]));
  assert.equal(bySize.get(awkward), 1);
  assert.equal(bySize.get("é中文"), 2);
  assert.ok(records.every((record) => record.modifiedMilliseconds > 0));
});

suite("a listing larger than the first fill buffer comes back complete", async () => {
  const { flat, store } = adapted();
  const expected = [];
  for (let index = 0; index < 400; index++) {
    const key = `key-${index}-${"p".repeat(20)}`;
    expected.push(key);
    await put(store, "cache", key, encoder.encode("v"));
  }
  const records = await store.list("cache", none());
  assert.equal(flat.lists, 2, "one retry, sized by what the provider reported");
  assert.equal(await store.size("cache", none()), 400);
  // The count alone is too weak to be evidence: a parser that loses its place in the
  // stream still consumes one record per turn, so it reports 400 mangled records.
  assert.deepEqual(
    records.map((record) => record.key).sort(),
    expected.sort(),
  );
  assert.ok(
    records.every((record) => record.size === 1),
    "every record carries the size it was written with",
  );
});

suite("each ranged read owns its chunk", async () => {
  const { store } = adapted();
  await put(store, "cache", "stream", encoder.encode("first-second-"));

  const source = await store.source("cache", "stream", none());
  const reader = source.open(0, 13);
  // The reader transfers ownership of what it returns, so a consumer may hold two
  // chunks at once. A buffer reused across calls would rewrite the first one here.
  const first = await reader.read(6);
  const second = await reader.read(7);
  assert.equal(decoder.decode(first), "first-");
  assert.equal(decoder.decode(second), "second-");
  assert.notEqual(first.buffer, second.buffer, "chunks may not share a buffer");
  await reader.close();
});

suite("an absent key is null rather than an error", async () => {
  const { store } = adapted();
  assert.equal(await store.read("cache", "missing", none()), null);
  assert.equal(await store.source("cache", "missing", none()), null);
  assert.equal(await store.delete("cache", "missing", none()), false);
  assert.deepEqual(await store.list("cache", none()), []);
});

suite("a second write to a live key is refused rather than queued", async () => {
  const { store } = adapted();
  const first = await store.write("cache", "contended", none());
  await assert.rejects(() => store.write("cache", "contended", none()), TypeError);
  // And released when the first one settles, either way.
  await first.discard();
  const second = await store.write("cache", "contended", none());
  await second.commit();
});

suite("cancellation is honoured between chunks with the exact reason", async () => {
  const { flat, store } = adapted();
  const controller = new AbortController();
  const write = await store.write("cache", "cancelled", controller.signal);
  await write.append(encoder.encode("kept so far"));

  const reason = new Error("the caller changed its mind");
  controller.abort(reason);

  await assert.rejects(
    () => write.append(encoder.encode("more")),
    (thrown) => thrown === reason,
  );
  await assert.rejects(() => write.commit(), (thrown) => thrown === reason);
  // Discard is the cleanup path and has to work when the signal is already aborted,
  // which is precisely when a caller reaches for it.
  await write.discard();
  assert.equal(flat.live.size, 0, "an aborted write does not hold the key");
  assert.equal(await store.read("cache", "cancelled", none()), null);
});

suite("an already-aborted signal is refused before the provider is touched", async () => {
  const { flat, store } = adapted();
  await put(store, "cache", "present", encoder.encode("v"));
  const controller = new AbortController();
  const reason = new Error("too late");
  controller.abort(reason);
  const signal = controller.signal;

  const before = flat.reads;
  await assert.rejects(
    () => store.read("cache", "present", signal),
    (thrown) => thrown === reason,
  );
  await assert.rejects(
    () => store.write("cache", "present", signal),
    (thrown) => thrown === reason,
  );
  await assert.rejects(() => store.list("cache", signal), (thrown) => thrown === reason);
  await assert.rejects(() => store.size("cache", signal), (thrown) => thrown === reason);
  await assert.rejects(
    () => store.delete("cache", "present", signal),
    (thrown) => thrown === reason,
  );
  await assert.rejects(
    () => store.source("cache", "present", signal),
    (thrown) => thrown === reason,
  );
  assert.equal(flat.reads, before, "nothing reached the provider");
  assert.equal(flat.live.size, 0, "and no handle was opened");
});

suite("a settled write refuses further appends and repeats are no-ops", async () => {
  const { store } = adapted();
  const write = await store.write("cache", "settled", none());
  await write.append(encoder.encode("v"));
  await write.commit();
  await assert.rejects(() => write.append(encoder.encode("more")), TypeError);
  await write.commit();
  await write.discard();
  assert.equal(decoder.decode(await store.read("cache", "settled", none())), "v");
});

suite("a closed reader stays closed and closing twice is a no-op", async () => {
  const { store } = adapted();
  await put(store, "cache", "readable", encoder.encode("bytes"));
  const source = await store.source("cache", "readable", none());
  const reader = source.open(0, 5);
  await reader.close();
  await reader.close();
  await assert.rejects(() => reader.read(4), TypeError);
});

suite("a provider failure surfaces as a rejection rather than a throw", async () => {
  const { flat, store } = adapted();
  const failure = new Error("the device is gone");
  flat.size = () => {
    throw failure;
  };
  await assert.rejects(() => store.size("cache", none()), (thrown) => thrown === failure);
});

suite("close reaches the provider", async () => {
  const { flat, store } = adapted();
  await store.close();
  assert.equal(flat.closed, true);
});
