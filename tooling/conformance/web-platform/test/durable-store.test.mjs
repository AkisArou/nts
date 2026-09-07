// The durable byte store's contract, exercised against the host filesystem strawman.
//
// The shape came from the JVM lane after they ran a capability check on a real API-26
// device: atomic rename and both syncs are available at the floor, so atomicity does
// not have to shape the ABI. Streaming is write-only on their reasoning that a
// whole-value write cannot serve "large payloads are not forced into RAM", because the
// bytes parameter *is* the payload in RAM.
//
// Host evidence for the contract. The Android provider is theirs and owes the same
// guarantees against its own storage.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AbortController } from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { HostNodeDurableStore } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const none = () => new AbortController().signal;

function store(t) {
  const root = mkdtempSync(join(tmpdir(), "nts-durable-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { store: new HostNodeDurableStore({ root }), root };
}

async function put(target, namespace, key, text, signal = none()) {
  const write = await target.write(namespace, key, signal);
  await write.append(encoder.encode(text));
  await write.commit();
}

suite("a committed value reads back whole and by range", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "greeting", "hello durable world");

  assert.equal(
    decoder.decode(await target.read("cache", "greeting", none())),
    "hello durable world",
  );

  // The ranged path is the seam Blob already consumes.
  const source = await target.source("cache", "greeting", none());
  assert.equal(source.size, 19);
  const reader = source.open(6, 7);
  const chunk = await reader.read(64);
  assert.equal(decoder.decode(chunk), "durable");
  assert.equal(await reader.read(64), undefined, "the range ends where it was asked to");
  await reader.close();
});

suite("an absent key is null rather than an error", async (t) => {
  const { store: target } = store(t);
  assert.equal(await target.read("cache", "missing", none()), null);
  assert.equal(await target.source("cache", "missing", none()), null);
  assert.equal(await target.delete("cache", "missing", none()), false);
  assert.deepEqual(await target.list("cache", none()), []);
  assert.equal(await target.size("cache", none()), 0);
});

suite("nothing appended is visible before commit", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "key", "original");

  const write = await target.write("cache", "key", none());
  await write.append(encoder.encode("replacement "));
  await write.append(encoder.encode("in progress"));
  // The whole point of the handle: the key still holds what it held.
  assert.equal(decoder.decode(await target.read("cache", "key", none())), "original");
  assert.deepEqual(
    (await target.list("cache", none())).map((record) => record.key),
    ["key"],
    "an uncommitted write is not a record",
  );

  await write.commit();
  assert.equal(
    decoder.decode(await target.read("cache", "key", none())),
    "replacement in progress",
  );
});

suite("discarding leaves the key holding what it held", async (t) => {
  const { store: target, root } = store(t);
  await put(target, "cache", "key", "original");

  const write = await target.write("cache", "key", none());
  await write.append(encoder.encode("never committed"));
  await write.discard();
  assert.equal(decoder.decode(await target.read("cache", "key", none())), "original");
  // Discarding is idempotent, and does not resurrect anything after a commit.
  await write.discard();
  assert.equal(decoder.decode(await target.read("cache", "key", none())), "original");

  // And it leaves no partial file behind for a later run to trip over.
  const namespaceDirectory = join(root, readdirSync(root)[0]);
  assert.deepEqual(
    readdirSync(namespaceDirectory).filter((name) => name.startsWith(".partial-")),
    [],
  );
});

suite("cancelling makes no partial value visible", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "key", "original");

  const controller = new AbortController();
  const write = await target.write("cache", "key", controller.signal);
  await write.append(encoder.encode("first half "));
  controller.abort(new Error("caller went away"));

  // The guarantee is not that a write in progress stops immediately -- it is that no
  // partial value becomes visible. The next chunk is where the signal is honoured.
  await assert.rejects(write.append(encoder.encode("second half")));
  await assert.rejects(write.commit());
  assert.equal(
    decoder.decode(await target.read("cache", "key", none())),
    "original",
    "a cancelled write leaves the previous value exactly as it was",
  );
  await write.discard();
});

suite("a crashed write is invisible rather than half-present", async (t) => {
  const { store: target, root } = store(t);
  await put(target, "cache", "key", "original");

  // Simulating a crash: append, then abandon the handle without commit or discard,
  // exactly as a process that died would. The temporary file is still on disk.
  const write = await target.write("cache", "key", none());
  await write.append(encoder.encode("lost work"));
  const namespaceDirectory = join(root, readdirSync(root)[0]);
  assert.equal(
    readdirSync(namespaceDirectory).some((name) => name.startsWith(".partial-")),
    true,
    "the test must actually leave a partial file, or it proves nothing",
  );

  // A fresh store over the same directory is what a restart looks like.
  const reopened = new HostNodeDurableStore({ root });
  assert.equal(decoder.decode(await reopened.read("cache", "key", none())), "original");
  assert.deepEqual(
    (await reopened.list("cache", none())).map((record) => record.key),
    ["key"],
    "a leftover partial is not a record",
  );
  await write.discard();
});

suite("records carry size and modification time, and namespaces are separate", async (t) => {
  const { store: target } = store(t);
  const before = Date.now() - 1000;
  await put(target, "cache", "a", "one");
  await put(target, "cache", "b", "twotwo");
  await put(target, "cookies", "a", "elsewhere");

  const records = (await target.list("cache", none()))
    .slice()
    .sort((x, y) => (x.key < y.key ? -1 : 1));
  assert.deepEqual(
    records.map((record) => [record.key, record.size]),
    [
      ["a", 3],
      ["b", 6],
    ],
  );
  for (const record of records) {
    assert.ok(record.modifiedMilliseconds >= before, "a record knows when it was committed");
  }
  assert.equal(await target.size("cache", none()), 9);
  // One namespace cannot see or count another's keys.
  assert.equal(await target.size("cookies", none()), 9, "a namespace counts only its own");
  assert.equal(decoder.decode(await target.read("cookies", "a", none())), "elsewhere");
});

suite("keys are encoded rather than trusted as paths", async (t) => {
  const { store: target } = store(t);
  // A key that would escape the namespace if it were used as a path segment.
  const hostile = "../../escaped";
  await put(target, "cache", hostile, "contained");
  assert.equal(decoder.decode(await target.read("cache", hostile, none())), "contained");
  assert.deepEqual(
    (await target.list("cache", none())).map((record) => record.key),
    [hostile],
    "the key round-trips exactly, without ever being a path",
  );
});

suite("delete removes a key and a closed store refuses work", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "key", "value");
  assert.equal(await target.delete("cache", "key", none()), true);
  assert.equal(await target.read("cache", "key", none()), null);
  assert.equal(await target.delete("cache", "key", none()), false);

  await target.close();
  await assert.rejects(target.read("cache", "key", none()), /closed/);
  await assert.rejects(target.write("cache", "key", none()), /closed/);
});

suite("a second concurrent write to one key is refused, not queued", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "key", "original");

  const first = await target.write("cache", "key", none());
  await first.append(encoder.encode("mine"));

  // Refused rather than queued. Queueing would turn a caller's mistake into a pause,
  // with the pause as the only evidence it made one.
  await assert.rejects(target.write("cache", "key", none()), /already open/);
  // And the first writer is undisturbed by the attempt.
  await first.commit();
  assert.equal(decoder.decode(await target.read("cache", "key", none())), "mine");

  // Once settled, the key is writable again -- the guard tracks a write, not a key.
  const second = await target.write("cache", "key", none());
  await second.append(encoder.encode("later"));
  await second.commit();
  assert.equal(decoder.decode(await target.read("cache", "key", none())), "later");
});

suite("a discarded or cancelled write releases the key", async (t) => {
  const { store: target } = store(t);
  // Discarding must release, or one abandoned write locks a key for the process.
  const discarded = await target.write("cache", "key", none());
  await discarded.discard();
  const afterDiscard = await target.write("cache", "key", none());
  await afterDiscard.append(encoder.encode("after discard"));
  await afterDiscard.commit();
  assert.equal(decoder.decode(await target.read("cache", "key", none())), "after discard");

  // The same for a cancelled one, which is the path most likely to be abandoned.
  const controller = new AbortController();
  const cancelled = await target.write("cache", "key", controller.signal);
  controller.abort(new Error("gone"));
  await cancelled.discard();
  const afterCancel = await target.write("cache", "key", none());
  await afterCancel.append(encoder.encode("after cancel"));
  await afterCancel.commit();
  assert.equal(decoder.decode(await target.read("cache", "key", none())), "after cancel");
});

suite("two different keys write concurrently without interfering", async (t) => {
  const { store: target } = store(t);
  // Sequential *per key* -- not one write at a time for the whole store.
  const a = await target.write("cache", "a", none());
  const b = await target.write("cache", "b", none());
  await a.append(encoder.encode("first"));
  await b.append(encoder.encode("second"));
  // The same key name in another namespace is a different key, and this is opened
  // while `cache/a` is still unsettled -- committing first would let a guard that
  // ignored the namespace pass.
  const other = await target.write("cookies", "a", none());
  await other.append(encoder.encode("elsewhere"));

  await b.commit();
  await a.commit();
  await other.commit();
  assert.equal(decoder.decode(await target.read("cache", "a", none())), "first");
  assert.equal(decoder.decode(await target.read("cache", "b", none())), "second");
  assert.equal(decoder.decode(await target.read("cookies", "a", none())), "elsewhere");
});
