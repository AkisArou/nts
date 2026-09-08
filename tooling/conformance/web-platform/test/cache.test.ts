// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DELTA_SECONDS,
  HttpCache,
  MemoryHttpCacheStore,
  ReadableStream,
  cacheReuseDecision,
  currentAgeSeconds,
  freshnessLifetime,
  parseAge,
  parseCacheControl,
  parseHTTPDate,
} from "../../../../runtime/web-platform/src/index.ts";
import { createHostNodeWebPlatform } from "../node-runtime.ts";

const bootstrapRuntime = createHostNodeWebPlatform();

test("Cache-Control parses tokens, quoted strings, extensions and saturated deltas", () => {
  const parsed = parseCacheControl(
    'max-age="60", s-maxage=999999999999999999999, max-stale, immutable, Community="UCI", x-token=yes',
  );
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.duplicateFreshnessDirective, false);
  assert.equal(parsed.directives.maxAge, 60);
  assert.equal(parsed.directives.sMaxage, MAX_DELTA_SECONDS);
  assert.equal(parsed.directives.maxStale, true);
  assert.equal(parsed.directives.immutable, true);
  assert.deepEqual(parsed.directives.extensions, [
    { name: "community", value: "UCI" },
    { name: "x-token", value: "yes" },
  ]);
});

test("qualified private and no-cache survive OWS around equals", () => {
  const parsed = parseCacheControl(
    'private = "Authorization, Cookie", no-cache\t=\t"Set-Cookie", max-age = 60',
  );
  assert.deepEqual(parsed.directives.private, ["authorization", "cookie"]);
  assert.deepEqual(parsed.directives.noCache, ["set-cookie"]);
  assert.equal(parsed.directives.maxAge, 60);
  assert.equal(parsed.malformed, false);
});

test("malformed restrictive directives fail closed without hiding later members", () => {
  const parsed = parseCacheControl(
    'private="bad field", no-cache="", no-store=surprise, public="wrong", max-age=oops, immutable',
  );
  assert.equal(parsed.directives.private, true);
  assert.equal(parsed.directives.noCache, true);
  assert.equal(parsed.directives.noStore, true);
  assert.equal(parsed.directives.public, undefined);
  assert.equal(parsed.directives.maxAge, undefined);
  assert.equal(parsed.directives.immutable, true);
  assert.equal(parsed.malformed, true);
});

test("duplicate freshness directives are explicit and conservative", () => {
  const parsed = parseCacheControl("max-age=60, MAX-AGE=120, stale-if-error=30");
  assert.equal(parsed.directives.maxAge, 60);
  assert.equal(parsed.duplicateFreshnessDirective, true);
  assert.deepEqual(
    freshnessLifetime({
      shared: false,
      parsed,
      responseTime: 0,
      dateValue: 0,
      heuristicAllowed: true,
    }),
    { seconds: 0, source: "none" },
  );
});

test("HTTP-date accepts all three RFC 9110 wire forms without Date.parse", () => {
  const now = Date.UTC(2026, 0, 1);
  const expected = Date.UTC(1994, 10, 6, 8, 49, 37);
  assert.equal(parseHTTPDate("Sun, 06 Nov 1994 08:49:37 GMT", now), expected);
  assert.equal(parseHTTPDate("Sunday, 06-Nov-94 08:49:37 GMT", now), expected);
  assert.equal(parseHTTPDate("Sun Nov  6 08:49:37 1994", now), expected);
  assert.equal(parseHTTPDate("Sun, 31 Feb 1994 08:49:37 GMT", now), null);
  assert.equal(parseHTTPDate("Sun, 06 Nov 1994 08:49:37 UTC", now), null);
  assert.equal(parseHTTPDate("Sun, 06 Nov 1994 08:49:60 GMT", now), Date.UTC(1994, 10, 6, 8, 50));
});

test("obsolete two-digit dates use the RFC fifty-year rule", () => {
  assert.equal(
    parseHTTPDate("Sunday, 06-Nov-77 08:49:37 GMT", Date.UTC(2026, 0, 1)),
    Date.UTC(1977, 10, 6, 8, 49, 37),
  );
  assert.equal(
    parseHTTPDate("Sunday, 06-Nov-76 08:49:37 GMT", Date.UTC(2026, 0, 1)),
    Date.UTC(2076, 10, 6, 8, 49, 37),
  );
});

test("Age parsing saturates, takes the first list member and rejects signed values", () => {
  assert.equal(parseAge(" 123\t"), 123);
  assert.equal(parseAge("999999999999999999"), MAX_DELTA_SECONDS);
  assert.equal(parseAge("1, 2"), 1);
  assert.equal(parseAge("-1"), null);
  assert.equal(parseAge("1\u00a0"), null);
});

test("current age includes apparent age, transit delay and resident time", () => {
  assert.equal(
    currentAgeSeconds(
      {
        requestTime: 1_000,
        responseTime: 3_000,
        dateValue: -7_000,
        ageValue: 4,
      },
      8_000,
    ),
    15,
  );
  assert.equal(
    currentAgeSeconds(
      {
        requestTime: 1_000,
        responseTime: 3_000,
        dateValue: 4_000,
        ageValue: 4,
      },
      8_000,
    ),
    11,
  );
});

test("freshness lifetime follows s-maxage, max-age, Expires, then heuristic order", () => {
  const parsed = parseCacheControl("s-maxage=10, max-age=20");
  assert.deepEqual(
    freshnessLifetime({
      shared: true,
      parsed,
      responseTime: 0,
      dateValue: 0,
      heuristicAllowed: true,
    }),
    { seconds: 10, source: "s-maxage" },
  );
  assert.deepEqual(
    freshnessLifetime({
      shared: false,
      parsed,
      responseTime: 0,
      dateValue: 0,
      heuristicAllowed: true,
    }),
    { seconds: 20, source: "max-age" },
  );
  assert.deepEqual(
    freshnessLifetime({
      shared: false,
      parsed: parseCacheControl("public"),
      responseTime: 1_000_000,
      dateValue: 1_000_000,
      expiresValue: 1_060_000,
      lastModifiedValue: 0,
      heuristicAllowed: true,
    }),
    { seconds: 60, source: "expires" },
  );
  assert.deepEqual(
    freshnessLifetime({
      shared: false,
      parsed: parseCacheControl("public"),
      responseTime: 1_000_000,
      dateValue: 1_000_000,
      lastModifiedValue: 0,
      heuristicAllowed: true,
    }),
    { seconds: 100, source: "heuristic" },
  );
});

test("request freshness constraints and response revalidation rules compose", () => {
  const response = parseCacheControl("must-revalidate").directives;
  assert.equal(
    cacheReuseDecision({
      currentAge: 20,
      freshnessLifetime: 30,
      request: parseCacheControl("min-fresh=15").directives,
      response,
      shared: false,
    }),
    "revalidate",
  );
  assert.equal(
    cacheReuseDecision({
      currentAge: 40,
      freshnessLifetime: 30,
      request: parseCacheControl("max-stale=10").directives,
      response: parseCacheControl("").directives,
      shared: false,
    }),
    "stale-allowed",
  );
  assert.equal(
    cacheReuseDecision({
      currentAge: 40.001,
      freshnessLifetime: 30,
      request: parseCacheControl("max-stale=10").directives,
      response: parseCacheControl("").directives,
      shared: false,
    }),
    "revalidate",
  );
});

function body(text) {
  const bytes = new globalThis.TextEncoder().encode(text);
  let sent = false;
  return new ReadableStream({
    pull(controller) {
      if (sent) controller.close();
      else {
        sent = true;
        controller.enqueue(bytes);
      }
    },
  });
}

function header(entries, name) {
  for (const [entryName, value] of entries) {
    if (entryName.toLowerCase() === name) return value;
  }
  return null;
}

function cacheRuntime(transport, now, options = {}) {
  const store = options.store ?? new MemoryHttpCacheStore();
  const httpCache = new HttpCache({
    store,
    type: options.type,
    wallTimeMilliseconds: () => now.value,
    urls: bootstrapRuntime.urls,
    diagnostics: options.diagnostics,
  });
  return createHostNodeWebPlatform({ fetchTransport: transport, httpCache });
}

test("Fetch reuses fresh complete responses and emits a corrected Age", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch() {
      calls++;
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["cache-control", "max-age=60"],
          ["date", new Date(now.value).toUTCString()],
        ],
        body: body("cached"),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(await (await runtime.fetch("https://cache.test/value")).text(), "cached");
  now.value += 10_000;
  const hit = await runtime.fetch("https://cache.test/value");
  assert.equal(await hit.text(), "cached");
  assert.equal(hit.headers.get("age"), "10");
  assert.equal(calls, 1);
});

test("Vary keeps independent variants and matches normalized request whitespace", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch(request) {
      calls++;
      const language = header(request.headers, "accept-language") ?? "none";
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["cache-control", "max-age=60"],
          ["vary", "Accept-Language"],
        ],
        body: body(language),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(
    await (
      await runtime.fetch("https://cache.test/vary", { headers: { "accept-language": "en  US" } })
    ).text(),
    "en  US",
  );
  assert.equal(
    await (
      await runtime.fetch("https://cache.test/vary", { headers: { "accept-language": "fr" } })
    ).text(),
    "fr",
  );
  assert.equal(
    await (
      await runtime.fetch("https://cache.test/vary", { headers: { "accept-language": "en US" } })
    ).text(),
    "en  US",
  );
  assert.equal(calls, 2);
});

test("stale entries revalidate with ETag and retain their body after 304", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  let conditional = null;
  const transport = {
    async dispatch(request) {
      calls++;
      conditional = header(request.headers, "if-none-match");
      if (conditional !== null) {
        return {
          status: 304,
          statusText: "Not Modified",
          headers: [
            ["cache-control", "max-age=60"],
            ["etag", '"one"'],
            ["date", new Date(now.value).toUTCString()],
          ],
          body: null,
        };
      }
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["cache-control", "max-age=0"],
          ["etag", '"one"'],
          ["date", new Date(now.value).toUTCString()],
        ],
        body: body("original"),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(await (await runtime.fetch("https://cache.test/revalidate")).text(), "original");
  now.value += 1_000;
  const validated = await runtime.fetch("https://cache.test/revalidate");
  assert.equal(await validated.text(), "original");
  assert.equal(validated.headers.get("cache-control"), "max-age=60");
  assert.equal(conditional, '"one"');
  assert.equal(calls, 2);
});

test("Fetch cache modes distinguish reload, no-store, force-cache and only-if-cached", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const seen = [];
  const transport = {
    async dispatch(request) {
      calls++;
      seen.push({
        cacheControl: header(request.headers, "cache-control"),
        pragma: header(request.headers, "pragma"),
      });
      return {
        status: 200,
        statusText: "OK",
        headers: [["cache-control", "max-age=0"]],
        body: body(`network-${calls}`),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(await (await runtime.fetch("https://cache.test/modes")).text(), "network-1");
  now.value += 10_000;
  assert.equal(
    await (
      await runtime.fetch("https://cache.test/modes", {
        cache: "force-cache",
        mode: "same-origin",
      })
    ).text(),
    "network-1",
  );
  assert.equal(
    await (await runtime.fetch("https://cache.test/modes", { cache: "reload" })).text(),
    "network-2",
  );
  assert.deepEqual(seen[1], { cacheControl: "no-cache", pragma: "no-cache" });
  assert.equal(
    await (await runtime.fetch("https://cache.test/no-store", { cache: "no-store" })).text(),
    "network-3",
  );
  assert.equal(
    await (await runtime.fetch("https://cache.test/no-store", { cache: "no-store" })).text(),
    "network-4",
  );
  await assert.rejects(
    runtime.fetch("https://cache.test/missing", {
      cache: "only-if-cached",
      mode: "same-origin",
    }),
    (error) =>
      error instanceof TypeError &&
      error.message === "Network request failed" &&
      error.cause?.message.includes("only-if-cached"),
  );
  assert.equal(calls, 4);
});

test("request no-store and exact Pragma no-cache directives control reuse", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch() {
      calls++;
      return {
        status: 200,
        statusText: "OK",
        headers: [["cache-control", "max-age=60"]],
        body: body(`network-${calls}`),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  const url = "https://cache.test/request-directives";
  assert.equal(await (await runtime.fetch(url)).text(), "network-1");
  assert.equal(
    await (await runtime.fetch(url, { headers: { "cache-control": "no-store" } })).text(),
    "network-2",
  );
  assert.equal(await (await runtime.fetch(url)).text(), "network-1");
  assert.equal(
    await (await runtime.fetch(url, { headers: { pragma: "x-no-cache-extension" } })).text(),
    "network-1",
  );
  assert.equal(
    await (await runtime.fetch(url, { headers: { pragma: "custom, no-cache" } })).text(),
    "network-3",
  );
  assert.equal(calls, 3);
});

test("cancelled response bodies never publish an incomplete cache entry", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch() {
      calls++;
      let chunk = 0;
      return {
        status: 200,
        statusText: "OK",
        headers: [["cache-control", "max-age=60"]],
        body: new ReadableStream({
          pull(controller) {
            chunk++;
            if (chunk > 2) controller.close();
            else controller.enqueue(new Uint8Array([chunk]));
          },
        }),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  const first = await runtime.fetch("https://cache.test/incomplete");
  const reader = first.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1]));
  await reader.cancel("stop");
  assert.deepEqual(
    await (await runtime.fetch("https://cache.test/incomplete")).bytes(),
    new Uint8Array([1, 2]),
  );
  assert.equal(calls, 2);
});

test("unsafe successful methods invalidate the target URI", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let gets = 0;
  let postStatus = 500;
  const transport = {
    async dispatch(request) {
      if (request.method === "POST") {
        return {
          status: postStatus,
          statusText: postStatus === 204 ? "No Content" : "Server Error",
          headers: [],
          body: null,
        };
      }
      gets++;
      return {
        status: 200,
        statusText: "OK",
        headers: [["cache-control", "max-age=60"]],
        body: body(`get-${gets}`),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(await (await runtime.fetch("https://cache.test/item")).text(), "get-1");
  assert.equal(await (await runtime.fetch("https://cache.test/item")).text(), "get-1");
  await runtime.fetch("https://cache.test/item", { method: "POST", body: "update" });
  assert.equal(await (await runtime.fetch("https://cache.test/item")).text(), "get-1");
  postStatus = 204;
  await runtime.fetch("https://cache.test/item", { method: "POST", body: "update" });
  assert.equal(await (await runtime.fetch("https://cache.test/item")).text(), "get-2");
});

test("unsafe responses invalidate same-origin Location targets but never cross origins", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  const calls = new Map();
  const transport = {
    async dispatch(request) {
      if (request.method === "POST") {
        if (request.url.pathname === "/target") {
          return {
            status: 201,
            statusText: "Created",
            headers: [
              ["location", "/location#new"],
              ["content-location", "https://cache.test/content#representation"],
            ],
            body: body("updated"),
          };
        }
        return {
          status: 204,
          statusText: "No Content",
          headers: [
            ["location", "https://other.test/cross-origin"],
            ["content-location", "https://cache.test/ambiguous-one"],
            ["content-location", "https://cache.test/ambiguous-two"],
          ],
          body: null,
        };
      }
      const href = request.url.href;
      const count = (calls.get(href) ?? 0) + 1;
      calls.set(href, count);
      return {
        status: 200,
        statusText: "OK",
        headers: [["cache-control", "max-age=60"]],
        body: body(`${href}:${count}`),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  const target = "https://cache.test/target";
  const location = "https://cache.test/location";
  const content = "https://cache.test/content";
  const crossOrigin = "https://other.test/cross-origin";
  const ambiguous = "https://cache.test/ambiguous-one";
  for (const url of [target, location, content, crossOrigin, ambiguous]) {
    await (await runtime.fetch(url)).text();
  }

  assert.equal(
    await (await runtime.fetch(target, { method: "POST", body: "change" })).text(),
    "updated",
  );
  assert.match(await (await runtime.fetch(target)).text(), /:2$/);
  assert.match(await (await runtime.fetch(location)).text(), /:2$/);
  assert.match(await (await runtime.fetch(content)).text(), /:2$/);

  await runtime.fetch("https://cache.test/second", { method: "POST", body: "change" });
  assert.match(await (await runtime.fetch(crossOrigin)).text(), /:1$/);
  assert.match(await (await runtime.fetch(ambiguous)).text(), /:1$/);
});

test("invalidation store failures are diagnostic and do not replace the network response", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  const errors = [];
  class FailingDeleteStore extends MemoryHttpCacheStore {
    async delete() {
      throw new TypeError("persistent store unavailable");
    }
  }
  const transport = {
    async dispatch() {
      return {
        status: 200,
        statusText: "OK",
        headers: [["location", "/also-invalidated"]],
        body: body("network answer"),
      };
    },
  };
  const runtime = cacheRuntime(transport, now, {
    store: new FailingDeleteStore(),
    diagnostics: { storeError: (error) => errors.push(error) },
  });
  assert.equal(
    await (
      await runtime.fetch("https://cache.test/item", { method: "POST", body: "change" })
    ).text(),
    "network answer",
  );
  assert.equal(errors.length, 2);
});

test("bounded store refusal and store failures never fail the network response", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  const errors = [];
  let calls = 0;
  const transport = {
    async dispatch() {
      calls++;
      return {
        status: 200,
        statusText: "OK",
        headers: [["cache-control", "max-age=60"]],
        body: body("larger than four"),
      };
    },
  };
  const runtime = cacheRuntime(transport, now, {
    store: new MemoryHttpCacheStore({ maxEntryBytes: 4 }),
    diagnostics: {
      storeError(error) {
        errors.push(error);
      },
    },
  });
  assert.equal(await (await runtime.fetch("https://cache.test/large")).text(), "larger than four");
  assert.equal(await (await runtime.fetch("https://cache.test/large")).text(), "larger than four");
  assert.equal(calls, 2);
  assert.equal(errors.length, 2);
});

test("stale-if-error serves only inside its window and only for defined failures", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch() {
      calls++;
      if (calls === 2) throw new TypeError("offline");
      if (calls === 3) {
        return {
          status: 501,
          statusText: "Not Implemented",
          headers: [],
          body: body("not a stale-if-error status"),
        };
      }
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["cache-control", "max-age=0, stale-if-error=30"],
          ["etag", '"one"'],
          ["date", new Date(now.value).toUTCString()],
        ],
        body: body("stored"),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(await (await runtime.fetch("https://cache.test/stale-error")).text(), "stored");
  now.value += 10_000;
  const stale = await runtime.fetch("https://cache.test/stale-error");
  assert.equal(await stale.text(), "stored");
  assert.equal(stale.headers.get("age"), "10");
  assert.equal(
    await (await runtime.fetch("https://cache.test/stale-error", { cache: "no-cache" })).text(),
    "not a stale-if-error status",
  );
});

test("stale-while-revalidate returns immediately and commits one background refresh", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch(request) {
      calls++;
      if (header(request.headers, "if-none-match") !== null) {
        return {
          status: 200,
          statusText: "OK",
          headers: [
            ["cache-control", "max-age=60"],
            ["etag", '"two"'],
            ["date", new Date(now.value).toUTCString()],
          ],
          body: body("refreshed"),
        };
      }
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["cache-control", "max-age=0, stale-while-revalidate=30"],
          ["etag", '"one"'],
          ["date", new Date(now.value).toUTCString()],
        ],
        body: body("stale"),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(await (await runtime.fetch("https://cache.test/swr")).text(), "stale");
  now.value += 1_000;
  assert.equal(await (await runtime.fetch("https://cache.test/swr")).text(), "stale");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await (await runtime.fetch("https://cache.test/swr")).text(), "refreshed");
  assert.equal(calls, 2);
});

test("stale-while-revalidate coalesces each Vary variant independently", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch(request) {
      calls++;
      const language = header(request.headers, "accept-language") ?? "none";
      const conditional = header(request.headers, "if-none-match");
      return {
        status: 200,
        statusText: "OK",
        headers: [
          [
            "cache-control",
            conditional === null ? "max-age=0, stale-while-revalidate=30" : "max-age=60",
          ],
          ["etag", `"${language}-${conditional === null ? "old" : "new"}"`],
          ["vary", "accept-language"],
        ],
        body: body(`${language}-${conditional === null ? "old" : "new"}`),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  const fetchLanguage = async (language) =>
    (
      await runtime.fetch("https://cache.test/swr-vary", {
        headers: { "accept-language": language },
      })
    ).text();
  assert.equal(await fetchLanguage("en"), "en-old");
  assert.equal(await fetchLanguage("fr"), "fr-old");
  now.value += 1_000;
  assert.equal(await fetchLanguage("en"), "en-old");
  assert.equal(await fetchLanguage("fr"), "fr-old");
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await fetchLanguage("en"), "en-new");
  assert.equal(await fetchLanguage("fr"), "fr-new");
  assert.equal(calls, 4);
});

test("shared cache strips qualified private/no-cache fields and Set-Cookie", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch() {
      calls++;
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["cache-control", 'public, max-age=60, private = "x-secret", no-cache = "x-once"'],
          ["x-secret", "private"],
          ["x-once", "validate-me"],
          ["set-cookie", "sid=secret; Secure"],
        ],
        body: body("shared"),
      };
    },
  };
  const runtime = cacheRuntime(transport, now, { type: "shared" });
  const first = await runtime.fetch("https://cache.test/shared");
  assert.equal(first.headers.get("x-secret"), "private");
  assert.equal(await first.text(), "shared");
  const hit = await runtime.fetch("https://cache.test/shared");
  assert.equal(hit.headers.get("x-secret"), null);
  assert.equal(hit.headers.get("x-once"), null);
  assert.deepEqual(hit.headers.getSetCookie(), []);
  assert.equal(await hit.text(), "shared");
  assert.equal(calls, 1);
});

test("Vary star is never stored and HEAD can reuse a complete GET entry", async () => {
  const now = { value: Date.UTC(2026, 0, 1) };
  let calls = 0;
  const transport = {
    async dispatch(request) {
      calls++;
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["cache-control", "max-age=60"],
          ...(request.url.pathname === "/star" ? [["vary", "*"]] : []),
        ],
        body: request.method === "HEAD" ? null : body(`body-${calls}`),
      };
    },
  };
  const runtime = cacheRuntime(transport, now);
  assert.equal(await (await runtime.fetch("https://cache.test/star")).text(), "body-1");
  assert.equal(await (await runtime.fetch("https://cache.test/star")).text(), "body-2");
  assert.equal(await (await runtime.fetch("https://cache.test/get")).text(), "body-3");
  const head = await runtime.fetch("https://cache.test/get", { method: "HEAD" });
  assert.equal(head.body, null);
  assert.equal(calls, 3);
});
