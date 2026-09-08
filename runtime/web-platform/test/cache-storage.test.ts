import test from "node:test";
import assert from "node:assert/strict";
import {
  Cache,
  CacheStorage,
  Headers,
  MemoryCacheStorageStore,
  ReadableStream,
  Request,
  Response,
} from "../src/index.ts";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
// Symbol-keyed internals: not on the interface prototype and not on the public barrel,
// so a test reaches them the same way the runtime does.
import {
  abortSignalSubscribe,
} from "../src/core/abort-brand.ts";
import { must } from "./harness.ts";
import type {
  CacheStorageEntry,
  CacheStorageHandle,
  CacheStorageStore,
} from "../src/cache/cache-storage.ts";
import type { HeaderEntry } from "../src/fetch/headers.ts";
import type {
  FetchTransport,
  TransportResponse,
} from "../src/fetch/transport.ts";
import type { WebPlatformRuntime } from "../src/provider.ts";
import type { WebPlatformOptions } from "../src/provider.ts";

function stream(text: string): ReadableStream<Uint8Array> {
  const bytes = new globalThis.TextEncoder().encode(text);
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) controller.close();
      else {
        sent = true;
        controller.enqueue(bytes);
      }
    },
  });
}

function transportResponse(
  status: number,
  text: string | null,
  headers: readonly HeaderEntry[] = [],
): TransportResponse {
  return {
    status,
    statusText: status >= 200 && status <= 299 ? "OK" : "Failure",
    headers,
    body: text === null ? null : stream(text),
  };
}

function runtimeWithTransport(
  dispatch: FetchTransport["dispatch"],
  options: WebPlatformOptions = {},
): WebPlatformRuntime {
  return createHostNodeWebPlatform({
    ...options,
    fetchTransport: { dispatch },
  });
}

function quietRuntime(options: WebPlatformOptions = {}): WebPlatformRuntime {
  return runtimeWithTransport(async () => {
    throw new Error("Unexpected network request");
  }, options);
}

test("Cache and CacheStorage are illegal constructors", () => {
  const runtime = quietRuntime();
  assert.throws(() => new Cache(), TypeError);
  assert.throws(() => new CacheStorage(), TypeError);
  assert.equal(Cache.length, 0);
  assert.equal(CacheStorage.length, 0);
  assert.equal(Cache.prototype.match.length, 1);
  assert.equal(Cache.prototype.matchAll.length, 0);
  assert.equal(Cache.prototype.add.length, 1);
  assert.equal(Cache.prototype.addAll.length, 1);
  assert.equal(Cache.prototype.put.length, 2);
  assert.equal(Cache.prototype.delete.length, 1);
  assert.equal(Cache.prototype.keys.length, 0);
  assert.equal(CacheStorage.prototype.match.length, 1);
  assert.equal(CacheStorage.prototype.open.length, 1);
  assert.equal(CacheStorage.prototype.keys.length, 0);
  assert.equal(Object.prototype.toString.call(new Headers()), "[object Headers]");
  assert.equal(
    Object.prototype.toString.call(new Request("https://cache.test")),
    "[object Request]",
  );
  assert.equal(Object.prototype.toString.call(new Response()), "[object Response]");
  runtime.close();
});

test("Cache algorithms do not redispatch through overridable public methods", async () => {
  const runtime = runtimeWithTransport(async () => transportResponse(200, "network"));
  const cache = await runtime.caches.open("dispatch");
  await cache.put("https://cache.test/item", new Response("stored"));

  cache.matchAll = () => {
    throw new Error("Cache.match called the public matchAll method");
  };
  cache.addAll = () => {
    throw new Error("Cache.add called the public addAll method");
  };
  assert.equal(await must(await cache.match("https://cache.test/item"), "the cache holds that entry").text(), "stored");
  await cache.add("https://cache.test/network");

  const inheritedMatch = Cache.prototype.match;
  Cache.prototype.match = () => {
    throw new Error("CacheStorage.match called Cache.prototype.match");
  };
  try {
    assert.equal(await must(await runtime.caches.match("https://cache.test/item"), "the cache holds that entry").text(), "stored");
  } finally {
    Cache.prototype.match = inheritedMatch;
  }
});

test("named caches preserve insertion order, share lists, and survive name deletion", async () => {
  const runtime = quietRuntime();
  const first = await runtime.caches.open("first");
  const sameList = await runtime.caches.open("first");
  await runtime.caches.open("second");
  await first.put("https://cache.test/one", new Response("one"));

  assert.notStrictEqual(first, sameList);
  assert.equal(await must(await sameList.match("https://cache.test/one"), "the cache holds that entry").text(), "one");
  assert.deepEqual(await runtime.caches.keys(), ["first", "second"]);
  assert.equal(await runtime.caches.has("first"), true);
  assert.equal(await runtime.caches.delete("first"), true);
  assert.equal(await runtime.caches.delete("first"), false);
  assert.equal(await runtime.caches.has("first"), false);

  // Deleting a name does not invalidate Cache objects already associated with its list.
  assert.equal(await must(await first.match("https://cache.test/one"), "the cache holds that entry").text(), "one");
  const replacement = await runtime.caches.open("first");
  assert.equal(await replacement.match("https://cache.test/one"), undefined);
  assert.deepEqual(await runtime.caches.keys(), ["second", "first"]);

  // A copy, because `keys()` returns a readonly sequence and the assertion is that pushing to
  // what a caller holds is ordinary rather than a view into the storage.
  const names = [...(await runtime.caches.keys())];
  names.push("ordinary-sequence");
  assert.equal(names.at(-1), "ordinary-sequence");
});

test("cache names use DOMString conversion without replacing lone surrogates", async () => {
  const runtime = quietRuntime();
  const unpaired = "unpaired\ud800";
  const replaced = "unpaired\ufffd";
  await runtime.caches.open(unpaired);
  assert.equal(await runtime.caches.has(unpaired), true);
  assert.equal(await runtime.caches.has(replaced), false);
  assert.deepEqual(await runtime.caches.keys(), [unpaired]);
});

test("put consumes the supplied body and matches return independent immutable responses", async () => {
  const runtime = quietRuntime();
  const cache = await runtime.caches.open("responses");
  const original = new Response("payload", {
    status: 201,
    statusText: "Created",
    headers: { "x-answer": "yes" },
  });
  await cache.put("https://cache.test/item#stored-fragment", original);
  assert.equal(original.bodyUsed, true);

  const first = await cache.match("https://cache.test/item#different-fragment");
  const second = await cache.match("https://cache.test/item");
  assert.equal(must(first, "the cache matched that entry").status, 201);
  assert.equal(must(first, "the cache matched that entry").statusText, "Created");
  assert.equal(must(first, "the cache matched that entry").headers.get("x-answer"), "yes");
  assert.throws(() => must(first, "the cache matched that entry").headers.set("x-answer", "changed"), TypeError);
  assert.equal(await must(first, "the cache matched that entry").text(), "payload");
  assert.equal(await must(second, "the cache matched that entry").text(), "payload");

  const all = await cache.matchAll();
  assert.equal(Object.isFrozen(all), true);
  assert.equal(all.length, 1);
  // Deliberately mutating a frozen sequence: throwing is the assertion, and `matchAll` returns
  // a readonly array, so the call is a violation as well as a type error.
  assert.throws(() => (all as Response[]).push(new Response()), TypeError);
});

test("query matching implements ignoreSearch, ignoreMethod, and exact Vary", async () => {
  const runtime = quietRuntime();
  const cache = await runtime.caches.open("query");
  await cache.put(
    new Request("https://cache.test/value?a=1", { headers: { "accept-language": "en" } }),
    new Response("english", { headers: { vary: "Accept-Language" } }),
  );

  assert.equal(
    await must(
      await cache.match("https://cache.test/value?a=1#fragment", {
        ignoreVary: true,
      }),
      "the cache holds that entry",
    ).text(),
    "english",
  );
  assert.equal(
    await cache.match(
      new Request("https://cache.test/value?a=1", {
        headers: { "accept-language": "fr" },
      }),
    ),
    undefined,
  );
  assert.equal(
    await must(
      await cache.match(
        new Request("https://cache.test/value?a=2", {
          headers: { "accept-language": "en" },
        }),
        { ignoreSearch: true },
      ),
      "the cache holds that entry",
    ).text(),
    "english",
  );
  assert.equal(
    await cache.match(new Request("https://cache.test/value?a=1", { method: "POST" })),
    undefined,
  );
  assert.equal(
    await must(
      await cache.match(new Request("https://cache.test/value?a=1", { method: "POST" }), {
        ignoreMethod: true,
        ignoreVary: true,
      }),
      "the cache holds that entry",
    ).text(),
    "english",
  );
});

test("keys and delete return every matching request and preserve immutable headers", async () => {
  const runtime = quietRuntime();
  const cache = await runtime.caches.open("keys");
  await cache.put(
    new Request("https://cache.test/key", { headers: { variant: "a" } }),
    new Response("a", { headers: { vary: "variant" } }),
  );
  await cache.put(
    new Request("https://cache.test/key", { headers: { variant: "b" } }),
    new Response("b", { headers: { vary: "variant" } }),
  );
  const keys = await cache.keys();
  assert.equal(Object.isFrozen(keys), true);
  assert.equal(keys.length, 2);
  assert.equal(must(keys[0], "the cache kept that key").headers.get("variant"), "a");
  assert.equal(must(keys[1], "the cache kept that key").headers.get("variant"), "b");
  assert.throws(() => must(keys[0], "the cache kept that key").headers.set("variant", "changed"), TypeError);
  assert.equal(await cache.delete("https://cache.test/key", { ignoreVary: true }), true);
  assert.deepEqual(await cache.keys(), []);
});

test("put enforces scheme, method, partial-response, Vary-star and body-state rules", async () => {
  const runtime = quietRuntime();
  const cache = await runtime.caches.open("validation");

  await assert.rejects(cache.put("ftp://cache.test/x", new Response("x")), TypeError);
  await assert.rejects(
    cache.put(new Request("https://cache.test/x", { method: "POST" }), new Response("x")),
    TypeError,
  );
  await assert.rejects(
    cache.put("https://cache.test/x", new Response("x", { status: 206 })),
    TypeError,
  );
  await assert.rejects(
    cache.put("https://cache.test/x", new Response("x", { headers: { vary: "*" } })),
    TypeError,
  );
  const used = new Response("used");
  await used.text();
  await assert.rejects(cache.put("https://cache.test/used", used), TypeError);
  const locked = new Response("locked");
  const reader = must(locked.body, "a Response built with a body has one").getReader();
  await assert.rejects(cache.put("https://cache.test/locked", locked), TypeError);
  reader.releaseLock();
  // Deliberately not a Response: refusing it is the assertion.
  const notAResponse = {} as unknown as Response;
  await assert.rejects(cache.put("https://cache.test/value", notAResponse), TypeError);

  // Empty Vary is not Vary: *.
  await cache.put("https://cache.test/empty-vary", new Response("ok", { headers: { vary: "" } }));
  assert.equal(await must(await cache.match("https://cache.test/empty-vary"), "the cache holds that entry").text(), "ok");

  await cache.put("https://cache.test/error", Response.error());
  const error = must(await cache.match("https://cache.test/error"), "the cache holds that entry");
  assert.equal(error.status, 0);
  assert.equal(error.type, "error");
});

test("add and addAll fetch complete responses and commit atomically", async () => {
  let fetches = 0;
  const runtime = runtimeWithTransport(async (request) => {
    fetches++;
    if (request.url.pathname === "/bad") return transportResponse(404, "missing");
    if (request.url.pathname === "/partial") return transportResponse(206, "partial");
    if (request.url.pathname === "/vary-star") {
      return transportResponse(200, "vary", [["vary", "*"]]);
    }
    const language = request.headers.find((entry) => entry[0] === "accept-language")?.[1];
    return transportResponse(
      200,
      request.url.pathname.slice(1) + (language === undefined ? "" : ":" + language),
      language === undefined ? [] : [["vary", "accept-language"]],
    );
  });
  const cache = await runtime.caches.open("network");

  await cache.add("https://cache.test/one");
  assert.equal(await must(await cache.match("https://cache.test/one"), "the cache holds that entry").text(), "one");

  await assert.rejects(
    cache.addAll(["https://cache.test/two", "https://cache.test/bad"]),
    TypeError,
  );
  assert.equal(await cache.match("https://cache.test/two"), undefined);
  assert.equal(await cache.match("https://cache.test/bad"), undefined);
  await assert.rejects(cache.add("https://cache.test/partial"), TypeError);
  await assert.rejects(cache.add("https://cache.test/vary-star"), TypeError);

  await assert.rejects(
    cache.addAll(["https://cache.test/duplicate", "https://cache.test/duplicate"]),
    (error: unknown) => error instanceof Error && error.name === "InvalidStateError",
  );
  assert.equal(await cache.match("https://cache.test/duplicate"), undefined);
  await assert.rejects(
    cache.addAll([
      "https://cache.test/fragment-duplicate#one",
      "https://cache.test/fragment-duplicate#two",
    ]),
    (error: unknown) => error instanceof Error && error.name === "InvalidStateError",
  );

  await cache.addAll([
    new Request("https://cache.test/variant", { headers: { "accept-language": "en" } }),
    new Request("https://cache.test/variant", { headers: { "accept-language": "fr" } }),
  ]);
  assert.equal(
    await must(
      await cache.match(
        new Request("https://cache.test/variant", { headers: { "accept-language": "fr" } }),
      ),
      "the cache holds that entry",
    ).text(),
    "variant:fr",
  );

  const beforeInvalidScheme = fetches;
  await assert.rejects(cache.add("data:text/plain,no"), TypeError);
  assert.equal(fetches, beforeInvalidScheme);
  await assert.rejects(
    // `undefined` is deliberately not a request: refusing the whole list is the assertion.
    cache.addAll([
      "https://cache.test/valid",
      undefined as unknown as string,
      "https://cache.test/also-valid",
    ]),
    TypeError,
  );
});

test("addAll aborts remaining fetches after one response is invalid", async () => {
  let aborted = false;
  const runtime = runtimeWithTransport(async (request) => {
    if (request.url.pathname === "/bad") return transportResponse(404, "missing");
    return new Promise((resolve, reject) => {
      const unsubscribe = request.signal[abortSignalSubscribe](() => {
        aborted = true;
        unsubscribe();
        reject(request.signal.reason);
      });
    });
  });
  const cache = await runtime.caches.open("abort-batch");
  await assert.rejects(
    cache.addAll(["https://cache.test/wait", "https://cache.test/bad"]),
    TypeError,
  );
  await Promise.resolve();
  assert.equal(aborted, true);
  assert.deepEqual(await cache.keys(), []);
});

test("addAll duplicate detection is symmetric across different Vary responses", async () => {
  const runtime = runtimeWithTransport(async (request) => {
    const vary = request.headers.find((entry) => entry[0] === "x-response-vary")?.[1];
    return transportResponse(200, "variant", [["vary", vary ?? ""]]);
  });
  const cache = await runtime.caches.open("asymmetric-vary");
  const shapeVary = new Request("https://cache.test/asymmetric", {
    headers: {
      "x-response-vary": "x-shape",
      "x-shape": "circle",
      "x-size": "big",
    },
  });
  const sizeVary = new Request("https://cache.test/asymmetric", {
    headers: {
      "x-response-vary": "x-size",
      "x-shape": "square",
      "x-size": "big",
    },
  });
  await assert.rejects(
    cache.addAll([shapeVary, sizeVary]),
    (error: unknown) => error instanceof Error && error.name === "InvalidStateError",
  );
  await assert.rejects(
    cache.addAll([sizeVary, shapeVary]),
    (error: unknown) => error instanceof Error && error.name === "InvalidStateError",
  );
  assert.deepEqual(await cache.keys(), []);
});

test("CacheStorage.match searches named caches in order and honors cacheName", async () => {
  const runtime = quietRuntime();
  const first = await runtime.caches.open("first");
  const second = await runtime.caches.open("second");
  await first.put("https://cache.test/shared", new Response("first"));
  await second.put("https://cache.test/shared", new Response("second"));
  assert.equal(await must(await runtime.caches.match("https://cache.test/shared"), "the cache holds that entry").text(), "first");
  assert.equal(
    await must(await runtime.caches.match("https://cache.test/shared", { cacheName: "second" }), "the cache holds that entry").text(),
    "second",
  );
  assert.equal(
    await runtime.caches.match("https://cache.test/shared", { cacheName: "missing" }),
    undefined,
  );
});

test("memory quotas reject atomically without deleting the prior list", async () => {
  const store = new MemoryCacheStorageStore({
    maxCaches: 1,
    maxEntriesPerCache: 1,
    maxBodyBytesPerCache: 4,
  });
  const runtime = quietRuntime({ cacheStorageStore: store });
  const cache = await runtime.caches.open("bounded");
  await cache.put("https://cache.test/one", new Response("1234"));
  await assert.rejects(
    runtime.caches.open("second"),
    (error: unknown) => error instanceof Error && error.name === "QuotaExceededError",
  );
  await assert.rejects(
    cache.put("https://cache.test/two", new Response("2")),
    (error: unknown) => error instanceof Error && error.name === "QuotaExceededError",
  );
  assert.equal(await must(await cache.match("https://cache.test/one"), "the cache holds that entry").text(), "1234");
  assert.equal(await cache.match("https://cache.test/two"), undefined);
  await assert.rejects(
    cache.put("https://cache.test/one", new Response("12345")),
    (error: unknown) => error instanceof Error && error.name === "QuotaExceededError",
  );
  assert.equal(await must(await cache.match("https://cache.test/one"), "the cache holds that entry").text(), "1234");
});

test("compare-exchange retries preserve concurrent writes", async () => {
  const underlying = new MemoryCacheStorageStore();
  let conflicts = 1;
  const store: CacheStorageStore = {
    lookup: (name: string) => underlying.lookup(name),
    open: (name: string) => underlying.open(name),
    delete: (name: string) => underlying.delete(name),
    keys: () => underlying.keys(),
    read: (handle: CacheStorageHandle) => underlying.read(handle),
    compareExchange(
      handle: CacheStorageHandle,
      revision: number,
      entries: readonly CacheStorageEntry[],
    ) {
      if (conflicts-- > 0) return Promise.resolve(false);
      return underlying.compareExchange(handle, revision, entries);
    },
  };
  const runtime = quietRuntime({ cacheStorageStore: store });
  const cache = await runtime.caches.open("cas");
  await Promise.all([
    cache.put("https://cache.test/a", new Response("a")),
    cache.put("https://cache.test/b", new Response("b")),
  ]);
  assert.deepEqual((await cache.keys()).map((request) => request.url).sort(), [
    "https://cache.test/a",
    "https://cache.test/b",
  ]);
});

test("Web IDL request conversion precedes query-option conversion", async () => {
  const runtime = quietRuntime();
  const cache = await runtime.caches.open("conversion");
  const order: string[] = [];
  const request = {
    toString() {
      order.push("request");
      return "https://cache.test/value";
    },
  };
  const options = {
    get ignoreMethod() {
      order.push("ignoreMethod");
      return false;
    },
    get ignoreSearch() {
      order.push("ignoreSearch");
      return false;
    },
    get ignoreVary() {
      order.push("ignoreVary");
      return false;
    },
  };
  // A stringifier rather than a URL string, because the order of the Web IDL conversions is
  // what this test observes; the parameter takes a `RequestInfo` and this is deliberately not one.
  await cache.match(request as unknown as string, options);
  assert.deepEqual(order, ["request", "ignoreMethod", "ignoreSearch", "ignoreVary"]);
});
