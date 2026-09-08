// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
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
import type { TestContext } from "node:test";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AbortController } from "../src/index.ts";
import { HostNodeDurableStore } from "../host/node-runtime.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
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

suite("a reader opened before a delete keeps reading", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "doomed", "bytes that outlive their key");

  const source = await target.source("cache", "doomed", none());
  assert.equal(source.size, 28);
  const reader = source.open(0, source.size);
  assert.equal(decoder.decode(await reader.read(6)), "bytes ");

  assert.equal(await target.delete("cache", "doomed", none()), true);
  assert.equal(await target.read("cache", "doomed", none()), null, "the key is gone");

  // A descriptor pins what it was opened over -- the same guarantee that makes a
  // replaced value invisible to an open reader, extended to a removed one. Without it
  // nothing can release stored bytes while a reader might still hold them.
  assert.equal(decoder.decode(await reader.read(64)), "that outlive their key");
  assert.equal(await reader.read(64), undefined);
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

suite("a source reads the value it was opened over, or fails", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "key", "the original value");

  const source = await target.source("cache", "key", none());
  assert.equal(source.size, 18);

  // The value is replaced after the source exists but before it is read. Blob shares
  // *immutable* stored ranges, so a source that silently started reading the new value
  // would break that guarantee for every Blob built on this store.
  await put(target, "cache", "key", "a completely different and longer value");

  const reader = source.open(0, 18);
  let bytes = null;
  let failure = null;
  try {
    bytes = await reader.read(64);
  } catch (error) {
    failure = error;
  }
  await reader.close();

  if (failure !== null) {
    // Refusing is the correct outcome: the value it was opened over is gone.
    assert.match(String(failure), /replaced|no longer/i);
  } else {
    // If it read anything, it must be the value the source was opened over -- never a
    // prefix of a different one, which is what clamping to the new size would give.
    assert.equal(decoder.decode(bytes), "the original value".slice(0, bytes.length));
    assert.ok(bytes.length > 0);
  }
});

suite("a reader opened before a replacement keeps reading the original", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "key", "the original value");
  const source = await target.source("cache", "key", none());
  const reader = source.open(0, 18);
  // Reading once pins the value; the descriptor outlives the rename that replaces it.
  const first = await reader.read(4);
  assert.equal(decoder.decode(first), "the ");

  await put(target, "cache", "key", "a completely different and longer value");

  // The rest of the *original* value, not the rest of the new one. This is what Blob
  // means by an immutable stored range, and it is the reason the descriptor is opened
  // rather than the path re-resolved.
  const parts = [first];
  while (true) {
    const chunk = await reader.read(64);
    if (chunk === undefined) break;
    parts.push(chunk);
  }
  await reader.close();
  assert.equal(Buffer.concat(parts.map((p) => Buffer.from(p))).toString(), "the original value");
});

suite("two readers over one source are independent", async (t) => {
  const { store: target } = store(t);
  await put(target, "cache", "key", "abcdefghij");
  const source = await target.source("cache", "key", none());

  const left = source.open(0, 5);
  const right = source.open(5, 5);
  // Interleaved deliberately: a shared file offset would make these steal from each
  // other, and reading them one after the other would hide it.
  const leftFirst = await left.read(2);
  const rightFirst = await right.read(2);
  const leftRest = await left.read(64);
  const rightRest = await right.read(64);
  assert.equal(decoder.decode(leftFirst) + decoder.decode(leftRest), "abcde");
  assert.equal(decoder.decode(rightFirst) + decoder.decode(rightRest), "fghij");

  // Each range ends where it was asked to, and never returns an empty chunk.
  assert.equal(await left.read(64), undefined);
  assert.equal(await right.read(64), undefined);
  await left.close();
  await right.close();
  // Closing twice is safe, as is closing a reader that was never read.
  await left.close();
  const unread = source.open(0, 3);
  await unread.close();
});
