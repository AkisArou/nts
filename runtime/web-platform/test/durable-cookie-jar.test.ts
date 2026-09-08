// A cookie jar that survives the process.
//
// Run over two providers reached two different ways, following what the durable cache
// suite established: the host filesystem answers whether atomic replace really holds
// against something that can crash, and the fake flat provider carries the same workload
// through `durableStoreFromFlat` so the adapter is exercised by a real caller rather than
// only by its own unit tests. A disagreement between the two runs is a disagreement
// between the two halves of the seam.
//
// The cases that matter here are not the round trip. They are what happens to bytes that
// come back wrong, because a jar that silently starts empty has lost a user's session with
// no evidence anywhere and looks exactly like a first run.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import {
  AbortController,
  CookieJar,
  CookieJarStoreError,
  DurableCookieJarStore,
} from "../src/index.ts";
import { durableStoreFromFlat } from "../src/provider.ts";
import { HostNodeDurableStore } from "../host/node-runtime.ts";
import { FakeFlat } from "./fake-flat.ts";
import type { TestContext } from "node:test";
import type { DurableByteStore } from "../src/provider.ts";
import { must } from "./harness.ts";
import type { StoredCookie } from "../src/cookies/jar.ts";
import type { AbortSignal } from "../src/index.ts";

const none = () => new AbortController().signal;
const encoder = new TextEncoder();

const BACKENDS = [
  {
    name: "host filesystem",
    make(t: TestContext): DurableByteStore {
      const root = mkdtempSync(join(tmpdir(), "nts-jar-"));
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

function suite(
  name: string,
  fn: (t: TestContext, store: DurableByteStore) => void | Promise<void>,
): void {
  for (const backend of BACKENDS) {
    test(`${name} [${backend.name}]`, { timeout: 15000 }, async (t) => {
      const api = createHostNodeWebPlatform();
      t.after(() => api.close());
      await fn(t, backend.make(t));
    });
  }
}

async function writeRaw(store: DurableByteStore, text: string): Promise<void> {
  const write = await store.write("cookies", "jar", none());
  await write.append(encoder.encode(text));
  await write.commit();
}

suite("a cookie set in one jar is present in the next one over the same store", async (t, store) => {
  const first = new CookieJar({ store: new DurableCookieJarStore(store, none()) });
  await first.setCookie("sid=abc; Path=/; Max-Age=3600", "https://example.test/a");
  await first.close();

  // A second jar over the same bytes, which is the whole point of the class.
  const second = new CookieJar({ store: new DurableCookieJarStore(store, none()) });
  assert.equal(await second.getCookieHeader("https://example.test/a"), "sid=abc");
  await second.close();
});

suite("a session cookie does not come back, because it was never persisted", async (t, store) => {
  const first = new CookieJar({ store: new DurableCookieJarStore(store, none()) });
  await first.setCookie("sid=abc; Path=/", "https://example.test/a");
  await first.close();

  const second = new CookieJar({ store: new DurableCookieJarStore(store, none()) });
  // Not an assertion about the store: the jar decides what it hands over. Written so that
  // a store which started persisting everything would be visible here.
  assert.equal(await second.getCookieHeader("https://example.test/a"), "");
  await second.close();
});

suite("saving replaces the snapshot rather than adding to it", async (t, store) => {
  const jarStore = new DurableCookieJarStore(store, none());
  const jar = new CookieJar({ store: jarStore });
  await jar.setCookie("a=1; Path=/; Max-Age=3600", "https://example.test/");
  await jar.setCookie("b=2; Path=/; Max-Age=3600", "https://example.test/");
  await jar.setCookie("a=; Path=/; Max-Age=0", "https://example.test/");
  await jar.close();

  const loaded = await new DurableCookieJarStore(store, none()).loadAll();
  // An append-shaped store would keep the expired `a` beside the deletion.
  assert.deepEqual(
    loaded.map((cookie) => cookie.name),
    ["b"],
  );
});

suite("an absent key is a first run, not a failure", async (t, store) => {
  assert.deepEqual(await new DurableCookieJarStore(store, none()).loadAll(), []);
});

suite("a snapshot that is not JSON is refused rather than read as empty", async (t, store) => {
  await writeRaw(store, "this is not json");
  await assert.rejects(
    () => new DurableCookieJarStore(store, none()).loadAll(),
    (error: unknown) => error instanceof CookieJarStoreError && /valid JSON/.test(error.message),
  );
});

suite("a snapshot that is JSON but not an array is refused", async (t, store) => {
  await writeRaw(store, '{"sid":"abc"}');
  await assert.rejects(
    () => new DurableCookieJarStore(store, none()).loadAll(),
    (error: unknown) => error instanceof CookieJarStoreError && /not an array/.test(error.message),
  );
});

suite("one unreadable cookie rejects the load by default", async (t, store) => {
  // The default has to be the loud one. Starting empty is indistinguishable from a first
  // run, so a caller cannot tell a corrupt store from a fresh one and will never look.
  await writeRaw(store, '[{"name":"sid"}]');
  await assert.rejects(
    () => new DurableCookieJarStore(store, none()).loadAll(),
    (error: unknown) => error instanceof CookieJarStoreError && /unreadable cookie/.test(error.message),
  );
});

suite("dropping is available, keeps the good ones, and says what it dropped", async (t, store) => {
  const good = {
    name: "sid",
    value: "abc",
    expiryTime: 4102444800000,
    domain: "example.test",
    path: "/",
    creationTime: 1,
    lastAccessTime: 1,
    creationIndex: 0,
    persistent: true,
    hostOnly: true,
    secure: false,
    httpOnly: false,
    sameSite: "Default",
  };
  await writeRaw(store, JSON.stringify([good, { name: "broken" }, null]));
  const reports: [number, number][] = [];
  const loaded = await new DurableCookieJarStore(store, none(), {
    onInvalid: "drop",
    reportDropped: (count, total) => reports.push([count, total]),
  }).loadAll();
  assert.deepEqual(
    loaded.map((cookie) => cookie.name),
    ["sid"],
  );
  // Dropping without a way to observe it is the failure the option exists to avoid.
  assert.deepEqual(reports, [[2, 3]]);
});

suite("dropping nothing reports nothing", async (t, store) => {
  await writeRaw(store, "[]");
  let called = 0;
  const loaded = await new DurableCookieJarStore(store, none(), {
    onInvalid: "drop",
    reportDropped: () => called++,
  }).loadAll();
  assert.deepEqual(loaded, []);
  assert.equal(called, 0, "a clean load must not report a drop");
});

suite("a cookie value outside ASCII survives the round trip", async (t, store) => {
  // The premise this test exists to pin: `JSON.stringify` escapes control characters and
  // lone surrogates, but passes ordinary non-ASCII through literally. A cookie value is an
  // octet string, so code units up to 0xFF are legitimate, and an encoder that assumed the
  // serialized form was ASCII would refuse a perfectly valid cookie.
  const jarStore = new DurableCookieJarStore(store, none());
  const cookie: StoredCookie = {
    name: "sid",
    value: "caf\u00e9-\u00ff",
    expiryTime: 4102444800000,
    domain: "example.test",
    path: "/",
    creationTime: 1,
    lastAccessTime: 1,
    creationIndex: 0,
    persistent: true,
    hostOnly: true,
    secure: false,
    httpOnly: false,
    sameSite: "Default",
  };
  await jarStore.saveAll([cookie]);
  const loaded = await jarStore.loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(must(loaded[0], "the jar loaded the cookie it saved").value, "caf\u00e9-\u00ff");
});

suite("a snapshot that is not valid UTF-8 is refused, not repaired", async (t, store) => {
  // Refused rather than decoded with U+FFFD: a replacement character in a cookie value is
  // a value quietly different from the one stored, and it would be sent to a server.
  const write = await store.write("cookies", "jar", none());
  await write.append(Uint8Array.from([0x5b, 0xff, 0xfe, 0x5d]));
  await write.commit();
  await assert.rejects(
    () => new DurableCookieJarStore(store, none()).loadAll(),
    (error: unknown) => error instanceof CookieJarStoreError && /UTF-8/.test(error.message),
  );
});

suite("a save that fails mid-write leaves the key writable rather than stuck", async (t, store) => {
  // The store refuses a second concurrent write to a key rather than queueing it, so a
  // failed save that left its write open would make every later save fail too -- and the
  // symptom would appear at the next caller, not this one.
  let failNext = true;
  const failing = {
    ...store,
    write: async (namespace: string, key: string, signal: AbortSignal) => {
      const inner = await store.write(namespace, key, signal);
      return {
        append: async (bytes: Uint8Array) => {
          if (failNext) {
            failNext = false;
            throw new Error("the device is full");
          }
          await inner.append(bytes);
        },
        commit: () => inner.commit(),
        discard: () => inner.discard(),
      };
    },
  };
  const jarStore = new DurableCookieJarStore(failing, none());
  await assert.rejects(() => jarStore.saveAll([]), /device is full/);
  // The precondition this test exists for: the next save must succeed.
  await jarStore.saveAll([]);
  assert.deepEqual(await new DurableCookieJarStore(store, none()).loadAll(), []);
});

suite("the namespace and key are configurable and actually used", async (t, store) => {
  const jarStore = new DurableCookieJarStore(store, none(), {
    namespace: "other",
    key: "elsewhere",
  });
  await jarStore.saveAll([]);
  const records = await store.list("other", none());
  assert.deepEqual(
    records.map((record) => record.key),
    ["elsewhere"],
  );
  assert.deepEqual(await store.list("cookies", none()), []);
});

async function readRaw(store: DurableByteStore): Promise<string | null> {
  const bytes = await store.read("cookies", "jar", none());
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

// Every field, not just the one that motivated the round trip above.
//
// That test asserts `loaded[0].value` alone, which was enough while the snapshot was written
// by reflecting over the record: `JSON.stringify(cookies)` cannot put one field's value under
// another field's name. The writer now names all thirteen fields by hand, so it can -- and a
// sabotage that swapped `hostOnly` with `secure` in the writer passed the entire suite. Every
// value below is distinct within its type so that any transposition changes the result, and
// the booleans are carried across three cookies whose patterns differ pairwise, since two of
// them sharing a value would hide a swap of exactly those two.
const ROUND_TRIP: readonly StoredCookie[] = [
  {
    name: "sid",
    value: "café-ÿ",
    expiryTime: 4102444800000,
    domain: "example.test",
    path: "/a",
    creationTime: 11,
    lastAccessTime: 22,
    creationIndex: 0,
    persistent: true,
    hostOnly: true,
    secure: false,
    httpOnly: false,
    sameSite: "Default",
  },
  {
    name: "pref",
    value: "dark",
    expiryTime: null,
    domain: "sub.example.test",
    path: "/b/c",
    creationTime: 33,
    lastAccessTime: 44,
    creationIndex: 1,
    persistent: false,
    hostOnly: false,
    secure: true,
    httpOnly: false,
    sameSite: "Strict",
  },
  {
    name: "tok",
    value: "",
    expiryTime: 1700000000123,
    domain: "other.test",
    path: "/",
    creationTime: 55,
    lastAccessTime: 66,
    creationIndex: 2,
    persistent: true,
    hostOnly: false,
    secure: false,
    httpOnly: true,
    sameSite: "None",
  },
];

suite("every field of every cookie survives the round trip unchanged", async (t, store) => {
  const jarStore = new DurableCookieJarStore(store, none());
  await jarStore.saveAll(ROUND_TRIP);
  assert.deepEqual(await jarStore.loadAll(), ROUND_TRIP);
});

suite("the snapshot on disk holds the field names it claims to", async (t, store) => {
  // A writer and a reader that swap the same two fields agree with each other, so the round
  // trip above cannot see it -- but the bytes are wrong, and a jar written by one version and
  // read by another would carry the values across swapped. Asserting the text is what pins
  // the format rather than the pair's internal consistency.
  const jarStore = new DurableCookieJarStore(store, none());
  await jarStore.saveAll([must(ROUND_TRIP[0], "the fixture has a first cookie")]);
  assert.equal(
    await readRaw(store),
    '[{"name":"sid","value":"café-ÿ","expiryTime":4102444800000,' +
      '"domain":"example.test","path":"/a","creationTime":11,"lastAccessTime":22,' +
      '"creationIndex":0,"persistent":true,"hostOnly":true,"secure":false,' +
      '"httpOnly":false,"sameSite":"Default"}]',
  );
});

suite("a field of the wrong kind is unreadable rather than coerced", async (t, store) => {
  // The reader checks each field's kind, and these are the coercions a reader written with
  // `String(x)` or `Number(x)` would silently accept: a number where a name goes, a string
  // where a timestamp goes, a string where a flag goes, and a sameSite outside the four.
  const base = must(ROUND_TRIP[0], "the round-trip fixture has a first cookie");
  const corruptions = [
    { name: 7 },
    { value: null },
    { creationTime: "11" },
    { secure: "false" },
    { sameSite: "Lax " },
    { expiryTime: "4102444800000" },
    { path: 1 },
    // The pair that a kind check alone catches and a cross-check alone does not. If a
    // wrong-kinded expiry degraded to `null` instead of being refused, `persistent` and
    // `expiryTime` would still agree with each other -- both saying "session cookie" -- and
    // the record would load as one, silently dropping an expiry the server had set.
    { expiryTime: "never", persistent: false },
    { expiryTime: true, persistent: false },
  ];
  for (const patch of corruptions) {
    await writeRaw(store, JSON.stringify([{ ...base, ...patch }]));
    await assert.rejects(
      () => new DurableCookieJarStore(store, none()).loadAll(),
      (error: unknown) => error instanceof CookieJarStoreError,
      `accepted ${JSON.stringify(patch)}`,
    );
  }
});

suite("a missing field is unreadable rather than defaulted", async (t, store) => {
  const base = must(ROUND_TRIP[0], "the round-trip fixture has a first cookie");
  for (const field of Object.keys(base)) {
    // Widened to a record so a field can be removed by its runtime name: the point is to hand
    // the reader a snapshot that is missing one, which a `StoredCookie` cannot be.
    const entry: Record<string, unknown> = { ...base };
    delete entry[field];
    await writeRaw(store, JSON.stringify([entry]));
    await assert.rejects(
      () => new DurableCookieJarStore(store, none()).loadAll(),
      (error: unknown) => error instanceof CookieJarStoreError,
      `accepted a snapshot with no ${field}`,
    );
  }
});
