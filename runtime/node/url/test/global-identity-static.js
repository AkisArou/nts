// `url.URL` is the global `URL`, which no upstream test asserts.
//
// Node guarantees `require('url').URL === globalThis.URL` and the same for
// `URLSearchParams`. Searched across node's pinned `parallel/` suite for an
// export-is-global assertion over URL, URLSearchParams, Blob, File,
// AbortController, AbortSignal, Event, EventTarget and CustomEvent, in both
// argument orders and via `globalThis.`: `test-global-encoder.js` is the only
// hit in the whole suite, and it is about `util`'s Encoding pair.
//
// This one is load-bearing across lanes rather than only across modules. The
// canonical `URL` lives in `runtime/web-platform` and this profile reuses it
// rather than writing a second one, so the identity holds because two lanes
// agree about where the class lives. That agreement is the kind of thing that
// survives in a conversation and dies in a refactor: `URL` stays *referenced*
// whether or not `===` still holds, so no dead-export gate on either side can
// see it break, and `instanceof URL` fails the same way while matching no
// search at all.
//
// So it is asserted here, which is the only place it can live.
"use strict";

require("../common");

const assert = require("assert");
const url = require("url");

assert.strictEqual(url.URL, globalThis.URL, "url.URL is not the global URL");
assert.strictEqual(
  url.URLSearchParams,
  globalThis.URLSearchParams,
  "url.URLSearchParams is not the global URLSearchParams",
);

// Identity is not enough on its own: two names for a broken class would still
// be equal. These check the class works and that instances made either way are
// interchangeable, which is what the identity is for.
{
  const fromModule = new url.URL("https://example.com/a/b?x=1#f");
  const fromGlobal = new globalThis.URL("https://example.com/a/b?x=1#f");

  assert.ok(fromModule instanceof globalThis.URL, "a module URL is not a global URL");
  assert.ok(fromGlobal instanceof url.URL, "a global URL is not a module URL");
  assert.strictEqual(fromModule.href, fromGlobal.href);
  assert.strictEqual(fromModule.pathname, "/a/b");
  assert.strictEqual(fromModule.searchParams.get("x"), "1");
  assert.ok(
    fromModule.searchParams instanceof url.URLSearchParams,
    "a URL's searchParams is not a URLSearchParams",
  );
}
