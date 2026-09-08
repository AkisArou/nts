// The Cache API over provider-owned durable storage.
//
// The plan asks for "a separate Cache/CacheStorage API with provider-owned durable
// storage", and the memory store's own comment says production providers should inject
// a durable one. This is that store, driven two ways: directly, where the store's own
// contract lives (revisions, handles, body lifetime), and through the real `Cache` and
// `CacheStorage` objects, because a store that satisfies its interface and cannot serve
// the API above it has only passed a test of itself.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AbortController,
  DurableCacheStorageStore,
  Blob,
  Response,
} from "../../../../runtime/web-platform/src/index.ts";
import { durableStoreFromFlat } from "../../../../runtime/web-platform/src/provider.ts";
import { createHostNodeWebPlatform } from "../node-runtime.ts";
import { HostNodeDurableStore } from "../node-runtime.ts";
import { FakeFlat } from "./fake-flat.ts";

const encoder = new TextEncoder();
const none = () => new AbortController().signal;

const BACKENDS = [
  {
    name: "host filesystem",
    make(t) {
      const root = mkdtempSync(join(tmpdir(), "nts-cachestorage-"));
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

/** Every field set to something a lazy codec would lose. */
function requestRecord(url, overrides = {}) {
  return {
    url,
    urlWithoutFragment: url,
    urlWithoutSearchOrFragment: url,
    method: "GET",
    headers: [
      ["accept", "*/*"],
      ["x-odd", "a, b; c=\"d\""],
    ],
    destination: "xslt",
    referrer: "about:client",
    referrerPolicy: "strict-origin-when-cross-origin",
    mode: "no-cors",
    credentials: "include",
    cache: "only-if-cached",
    redirect: "manual",
    integrity: "sha384-é中文",
    keepalive: true,
    priority: "low",
    isReloadNavigation: false,
    isHistoryNavigation: true,
    ...overrides,
  };
}

function responseRecord(body, overrides = {}) {
  return {
    status: 203,
    statusText: "Non-Authoritative Information",
    headers: [["content-type", "text/plain;charset=UTF-8"]],
    body,
    url: "https://cache.test/final",
    redirected: true,
    type: "cors",
    ...overrides,
  };
}

function entry(url, body, overrides = {}) {
  return { request: requestRecord(url), response: responseRecord(body, overrides) };
}

async function blobText(blob) {
  return blob === null ? null : await blob.text();
}

for (const backend of BACKENDS) {
  const only = (name, fn) => test(`${name} [${backend.name}]`, { timeout: 8000 }, fn);

  only("a cache list round-trips every field of both records", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const handle = await store.open("v1");
    const original = entry("https://cache.test/a#frag", new Blob(["stored bytes"]));

    assert.equal(await store.compareExchange(handle, 0, [original]), true);
    const snapshot = await store.read(handle);
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.entries.length, 1);
    const [read] = snapshot.entries;
    assert.deepEqual(read.request, original.request);
    assert.equal(read.response.status, 203);
    assert.equal(read.response.statusText, "Non-Authoritative Information");
    assert.deepEqual(read.response.headers, original.response.headers);
    assert.equal(read.response.url, "https://cache.test/final");
    assert.equal(read.response.redirected, true);
    assert.equal(read.response.type, "cors");
    assert.equal(await blobText(read.response.body), "stored bytes");
  });

  only("a stale revision is refused and changes nothing", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const handle = await store.open("v1");
    await store.compareExchange(handle, 0, [entry("https://cache.test/a", new Blob(["first"]))]);

    assert.equal(
      await store.compareExchange(handle, 0, [entry("https://cache.test/b", null)]),
      false,
      "the revision moved, so the exchange must not apply",
    );
    const snapshot = await store.read(handle);
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.entries[0].request.url, "https://cache.test/a");
    assert.equal(await blobText(snapshot.entries[0].response.body), "first");
  });

  only("a body that came back from read is not stored twice", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const handle = await store.open("v1");
    await store.compareExchange(handle, 0, [entry("https://cache.test/a", new Blob(["kept"]))]);

    const first = await store.read(handle);
    const keysBefore = (await bytes.list("cache-storage", none())).map((r) => r.key).sort();

    // The same entries handed straight back: a store that could not recognise its own
    // Blob would write the bytes again under a new key and orphan the old one.
    assert.equal(await store.compareExchange(handle, 1, first.entries), true);
    const keysAfter = (await bytes.list("cache-storage", none())).map((r) => r.key).sort();
    assert.deepEqual(keysAfter, keysBefore, "no body was rewritten");
    assert.equal(await blobText((await store.read(handle)).entries[0].response.body), "kept");
  });

  only("read returns one Blob per stored body", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const handle = await store.open("v1");
    await store.compareExchange(handle, 0, [entry("https://cache.test/a", new Blob(["same"]))]);

    const a = (await store.read(handle)).entries[0].response.body;
    const b = (await store.read(handle)).entries[0].response.body;
    assert.equal(a, b, "identity is what makes the round trip recognisable");
  });

  only("a body no entry names any longer is removed", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const handle = await store.open("v1");
    await store.compareExchange(handle, 0, [
      entry("https://cache.test/a", new Blob(["a body"])),
      entry("https://cache.test/b", new Blob(["b body"])),
    ]);
    assert.equal((await bytes.list("cache-storage", none())).length, 4);

    const snapshot = await store.read(handle);
    const remaining = snapshot.entries.filter((e) => e.request.url === "https://cache.test/a");
    assert.equal(await store.compareExchange(handle, 1, remaining), true);
    assert.equal(
      (await bytes.list("cache-storage", none())).length,
      3,
      "names, one list, one body",
    );
    assert.equal(await blobText((await store.read(handle)).entries[0].response.body), "a body");
  });

  only("names, lists and bodies all survive a reopen", async (t) => {
    const bytes = backend.make(t);
    const first = await DurableCacheStorageStore.open(bytes);
    const one = await first.open("v1");
    const two = await first.open("v2");
    await first.compareExchange(one, 0, [entry("https://cache.test/a", new Blob(["persisted"]))]);
    await first.compareExchange(two, 0, [entry("https://cache.test/b", null)]);

    const second = await DurableCacheStorageStore.open(bytes);
    assert.deepEqual(await second.keys(), ["v1", "v2"]);
    const reopened = await second.lookup("v1");
    const snapshot = await second.read(reopened);
    assert.equal(snapshot.revision, 1);
    assert.equal(await blobText(snapshot.entries[0].response.body), "persisted");
    assert.equal((await second.read(await second.lookup("v2"))).entries[0].response.body, null);
  });

  only("deleting a name removes its list and its bodies", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const handle = await store.open("v1");
    await store.open("keep");
    await store.compareExchange(handle, 0, [entry("https://cache.test/a", new Blob(["gone"]))]);

    assert.equal(await store.delete("v1"), true);
    assert.equal(await store.delete("v1"), false);
    assert.deepEqual(await store.keys(), ["keep"]);
    const keys = (await bytes.list("cache-storage", none())).map((r) => r.key).sort();
    assert.equal(keys.length, 2, `names plus the surviving list, saw ${keys}`);

    const reopened = await DurableCacheStorageStore.open(bytes);
    assert.deepEqual(await reopened.keys(), ["keep"]);
  });

  only("a body left by an interrupted exchange is reclaimed on open", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const handle = await store.open("v1");
    await store.compareExchange(handle, 0, [entry("https://cache.test/a", new Blob(["real"]))]);

    // Exactly what an interruption between the body write and the list write leaves.
    const orphan = await bytes.write("cache-storage", "b9999", none());
    await orphan.append(encoder.encode("orphaned"));
    await orphan.commit();

    const reopened = await DurableCacheStorageStore.open(bytes);
    const keys = (await bytes.list("cache-storage", none())).map((r) => r.key).sort();
    assert.equal(keys.includes("b9999"), false, `the orphan is gone, saw ${keys}`);
    const snapshot = await reopened.read(await reopened.lookup("v1"));
    assert.equal(await blobText(snapshot.entries[0].response.body), "real");
  });

  only("an exchange interrupted between its keys leaves nothing dangling", async (t) => {
    const bytes = backend.make(t);
    // Bodies are written before the list that names them, and the byte store makes one
    // key atomic and says nothing about two. This fails the list write, which is the
    // window a crash lands in.
    let failLists = false;
    const interrupted = {
      read: (...args) => bytes.read(...args),
      source: (...args) => bytes.source(...args),
      delete: (...args) => bytes.delete(...args),
      list: (...args) => bytes.list(...args),
      size: (...args) => bytes.size(...args),
      close: () => bytes.close(),
      async write(namespace, key, signal) {
        const write = await bytes.write(namespace, key, signal);
        if (!failLists || !key.startsWith("l")) return write;
        return {
          append: (chunk) => write.append(chunk),
          discard: () => write.discard(),
          async commit() {
            await write.discard();
            throw new Error("the power went out");
          },
        };
      },
    };

    const store = await DurableCacheStorageStore.open(interrupted);
    const handle = await store.open("v1");
    await store.compareExchange(handle, 0, [entry("https://cache.test/a", new Blob(["before"]))]);

    failLists = true;
    await assert.rejects(
      () => store.compareExchange(handle, 1, [entry("https://cache.test/b", new Blob(["lost"]))]),
      /power went out/,
    );
    failLists = false;

    // Checked before any reopen. Reclamation at open would hide a failed exchange that
    // left its body behind, so the claim has to be tested at the moment it is made.
    const afterFailure = (await bytes.list("cache-storage", none())).map((r) => r.key).sort();
    assert.deepEqual(afterFailure, ["b1", "l0", "names"], `saw ${afterFailure}`);

    const reopened = await DurableCacheStorageStore.open(bytes);
    const snapshot = await reopened.read(await reopened.lookup("v1"));
    assert.equal(snapshot.revision, 1, "the list is still the one that committed");
    assert.equal(snapshot.entries.length, 1);
    assert.equal(await blobText(snapshot.entries[0].response.body), "before");
    assert.equal(
      (await bytes.list("cache-storage", none())).length,
      3,
      "names, one list, one body -- the abandoned body is not among them",
    );
  });

  only("quotas are refused and leave the stored list alone", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes, {
      maxCaches: 1,
      maxEntriesPerCache: 1,
      maxBodyBytesPerCache: 4,
    });
    const handle = await store.open("bounded");
    await assert.rejects(() => store.open("second"), (e) => e?.name === "QuotaExceededError");
    assert.equal(await store.compareExchange(handle, 0, [entry("https://c.test/a", null)]), true);

    await assert.rejects(
      () =>
        store.compareExchange(handle, 1, [
          entry("https://c.test/a", null),
          entry("https://c.test/b", null),
        ]),
      (e) => e?.name === "QuotaExceededError",
    );
    await assert.rejects(
      () => store.compareExchange(handle, 1, [entry("https://c.test/a", new Blob(["toolong"]))]),
      (e) => e?.name === "QuotaExceededError",
    );
    const snapshot = await store.read(handle);
    assert.equal(snapshot.revision, 1, "a refused exchange did not advance the revision");
    assert.equal(snapshot.entries.length, 1);
    // No refused body may be left in storage, including one written before the refusal.
    const keys = (await bytes.list("cache-storage", none())).map((r) => r.key).sort();
    assert.deepEqual(keys, ["l0", "names"], `saw ${keys}`);
  });

  only("a handle from another store is refused", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    // Deliberately made to collide: both stores allocate ids from zero, so the foreign
    // handle names a list that exists here too. Without the owner check this reads --
    // and worse, writes -- somebody else's cache rather than failing to find one.
    const mine = await store.open("mine");
    const other = await DurableCacheStorageStore.open(backend.make(t), { namespace: "other" });
    const foreign = await other.open("v1");
    await store.compareExchange(mine, 0, [entry("https://cache.test/mine", new Blob(["mine"]))]);

    await assert.rejects(() => store.read(foreign), TypeError);
    await assert.rejects(() => store.compareExchange(foreign, 1, []), TypeError);
    const snapshot = await store.read(mine);
    assert.equal(snapshot.entries.length, 1, "the foreign exchange did not touch this cache");
  });

  only("the real Cache API works over it, and what it stored is still there", async (t) => {
    const bytes = backend.make(t);
    const store = await DurableCacheStorageStore.open(bytes);
    const runtime = createHostNodeWebPlatform({
      cacheStorageStore: store,
      fetchTransport: {
        dispatch: async () => {
          throw new Error("Unexpected network request");
        },
      },
    });

    const cache = await runtime.caches.open("pages");
    await cache.put("https://cache.test/one", new Response("first page"));
    await cache.put("https://cache.test/two", new Response("second page", { status: 202 }));

    const matched = await cache.match("https://cache.test/one");
    assert.equal(await matched.text(), "first page");
    assert.equal((await cache.keys()).length, 2);
    assert.equal(await cache.delete("https://cache.test/two"), true);
    assert.equal(await cache.match("https://cache.test/two"), undefined);
    assert.deepEqual(await runtime.caches.keys(), ["pages"]);

    // The API is only half the claim; the other half is that a new process finds it.
    const reopened = await DurableCacheStorageStore.open(bytes);
    const laterRuntime = createHostNodeWebPlatform({
      cacheStorageStore: reopened,
      fetchTransport: {
        dispatch: async () => {
          throw new Error("Unexpected network request");
        },
      },
    });
    const laterCache = await laterRuntime.caches.open("pages");
    const survived = await laterCache.match("https://cache.test/one");
    assert.equal(await survived.text(), "first page");
    assert.equal(survived.status, 200);
    assert.equal((await laterCache.keys()).length, 1);
  });
}
