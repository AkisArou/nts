import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { MessageChannel } from "node:worker_threads";

// This is the deliberately small testharness.js surface required by the complete,
// unchanged fixtures named in the manifest. Test and support sources are read from
// either the local delivery snapshot or Node's pinned WPT checkout and hash-verified;
// host Fetch and WebSocket implementations are never used as an oracle.
const repositoryRoot = new URL("../../../", import.meta.url);
const localWptRoot = new URL("runtime/web-platform/third_party/wpt/", repositoryRoot);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", localWptRoot), "utf8"));
// A prefix, not an exact path. It was exact, and an area prefix therefore selected nothing
// and reported a clean run over zero tests -- which reads exactly like "nothing broke".
const fixtureFilter = process.env.NTS_WEB_PLATFORM_FIXTURE;
let fixtureFilterMatched = 0;
const fixtureSelected = (path) => {
  if (fixtureFilter === undefined) return true;
  const hit = path === fixtureFilter || path.startsWith(fixtureFilter);
  if (hit) fixtureFilterMatched++;
  return hit;
};

if (process.env.NTS_WEB_PLATFORM_COMPILED !== "1") {
  const build = spawnSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "--project",
      "tooling/conformance/web-platform/tsconfig.json",
      "--pretty",
      "false",
    ],
    { cwd: fileURLToPath(repositoryRoot), stdio: "inherit" },
  );
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const {
  AbortController,
  AbortSignal,
  Blob,
  ByteLengthQueuingStrategy,
  Cache,
  CacheStorage,
  CustomEvent,
  CountQueuingStrategy,
  CookieJar,
  Event,
  EventSource,
  EventTarget,
  File,
  FormData,
  Headers,
  DOMException,
  Request,
  Response,
  ServerCookiePolicy,
  ReadableByteStreamController,
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TextDecoder,
  TextDecoderStream,
  TextEncoder,
  TextEncoderStream,
  TransformStream,
  TransformStreamDefaultController,
  URLSearchParams,
  WritableStream,
  WebSocketError,
  WebSocketStream,
} = await import("./node_modules/.tsbuild/host/runtime/web-platform/src/index.js");
const { createHostNodeWebPlatform } =
  await import("./node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js");
const { installWebPlatformRuntime } =
  await import("./node_modules/.tsbuild/host/runtime/web-platform/src/provider.js");

let passed = 0;
let failed = 0;
let notApplicable = 0;

function gitBlobHash(data) {
  return createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
}

function readVerified(root, path, expectedHash) {
  const data = readFileSync(new URL(path, root));
  assert.equal(gitBlobHash(data), expectedHash, `Upstream source changed: ${path}`);
  return data;
}

const eventSourceResources = new Map();
for (const resourcePath of [
  "eventsource/resources/accept.event_stream",
  "eventsource/resources/last-event-id.py",
  "eventsource/resources/message.py",
  "eventsource/resources/message2.py",
  "service-workers/cache-storage/cache-add.https.any.js",
  "service-workers/cache-storage/resources/blank.html",
  "service-workers/cache-storage/resources/fetch-status.py",
  "service-workers/cache-storage/resources/simple.txt",
  "service-workers/cache-storage/resources/vary.py",
]) {
  eventSourceResources.set(
    resourcePath,
    readVerified(
      localWptRoot,
      resourcePath,
      manifest.support[resourcePath] ?? manifest.files[resourcePath],
    ),
  );
}

function serveEventSourceResource(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  const path = url.pathname.replace(/^\//, "");
  if (!eventSourceResources.has(path)) {
    response.writeHead(404);
    response.end();
    return;
  }

  if (path === "service-workers/cache-storage/resources/simple.txt") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(eventSourceResources.get(path));
    return;
  }

  if (path === "service-workers/cache-storage/resources/blank.html") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(eventSourceResources.get(path));
    return;
  }

  if (path === "service-workers/cache-storage/resources/fetch-status.py") {
    const status = Number(url.searchParams.get("status"));
    response.writeHead(status);
    response.end();
    return;
  }

  if (path === "service-workers/cache-storage/resources/vary.py") {
    const setVary = url.searchParams.get("set-vary-value-override-cookie");
    if (setVary !== null && setVary !== "") {
      response.writeHead(200, {
        "Set-Cookie": `vary-value-override=${setVary}; Path=/`,
      });
      response.end("vary cookie set");
      return;
    }
    if (url.searchParams.has("clear-vary-value-override-cookie")) {
      response.writeHead(200, {
        "Set-Cookie": "vary-value-override=; Max-Age=0; Path=/",
      });
      response.end("vary cookie cleared");
      return;
    }
    const cookie = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("vary-value-override="));
    const cookieVary = cookie?.slice("vary-value-override=".length);
    const vary =
      cookieVary === undefined || cookieVary === "" ? url.searchParams.get("vary") : cookieVary;
    response.writeHead(200, vary === null || vary === "" ? {} : { Vary: vary });
    response.end("vary response");
    return;
  }

  if (path === "service-workers/cache-storage/cache-add.https.any.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end(eventSourceResources.get(path));
    return;
  }

  if (path === "eventsource/resources/message.py") {
    const mime = url.searchParams.get("mime") ?? "text/event-stream";
    const message = url.searchParams.get("message") ?? "data: data";
    const newline = url.searchParams.get("newline") === "none" ? "" : "\n\n";
    const wait = Number(url.searchParams.get("sleep") ?? "0");
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": mime });
      response.end(Buffer.from(message + newline + "\n"));
    }, wait);
    return;
  }

  if (path === "eventsource/resources/message2.py") {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream",
    });
    response.end(
      "data:msg\ndata: msg\n\n:\nfalsefield:msg\n\nfalsefield:msg\nData:data\n\ndata\n\ndata:end\n\n",
    );
    return;
  }

  if (path === "eventsource/resources/last-event-id.py") {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const lastEventId = request.headers["last-event-id"];
    if (typeof lastEventId === "string" && lastEventId !== "") {
      response.write("data: ");
      response.write(Buffer.from(lastEventId, "latin1"));
      response.end("\n\n");
    } else {
      response.end("id: …\nretry: 200\ndata: hello\n\n");
    }
    return;
  }

  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.end("data: " + (request.headers.accept ?? "") + "\n\n");
}

const eventSourceServer = createServer(serveEventSourceResource);
eventSourceServer.listen(0, "127.0.0.1");
await once(eventSourceServer, "listening");
const eventSourceAddress = eventSourceServer.address();
assert.notEqual(typeof eventSourceAddress, "string");
assert.notEqual(eventSourceAddress, null);
const eventSourceRoot = new URL(`http://127.0.0.1:${eventSourceAddress.port}/`);

const hostRuntime = createHostNodeWebPlatform({
  baseURL: "https://example.test/fetch/",
  origin: "https://example.test",
});

function reportPass(path, name) {
  passed++;
  console.log(`PASS ${path} :: ${name}`);
}

function reportFailure(path, name, error) {
  failed++;
  const detail =
    error !== null && typeof error === "object" && typeof error.stack === "string"
      ? error.stack
      : String(error);
  console.error(`FAIL ${path} :: ${name}\n  ${detail}`);
}

function reportNotApplicable(path, name, reason) {
  notApplicable++;
  console.log(`NOT-APPLICABLE ${path} :: ${name}\n  ${reason}`);
}

async function settleWithCleanups(outcome, cleanups) {
  let failed = false;
  let failure;
  try {
    await outcome;
  } catch (error) {
    failed = true;
    failure = error;
  }
  for (let index = cleanups.length - 1; index >= 0; index--) {
    try {
      await cleanups[index]();
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }
  if (failed) throw failure;
}

function createWptContext(
  path,
  root,
  verifiedSupport,
  pending,
  excludedTests,
  seenExcludedTests,
  runtime,
) {
  let contextIntrinsicTypeError = TypeError;
  let promiseTestQueue = Promise.resolve();
  const context = createContext({
    AbortController,
    AbortSignal,
    ArrayBuffer,
    BigInt64Array,
    BigUint64Array,
    Blob,
    ByteLengthQueuingStrategy,
    Cache,
    caches: runtime.caches,
    CacheStorage,
    CustomEvent,
    CountQueuingStrategy,
    DataView,
    DOMException,
    Event,
    EventSource,
    EventTarget,
    File,
    Float16Array,
    Float32Array,
    Float64Array,
    Function,
    FormData,
    gc: globalThis.gc,
    Headers,
    Int8Array,
    Int16Array,
    Int32Array,
    location:
      path.startsWith("eventsource/") || path.startsWith("service-workers/cache-storage/")
        ? new URL(path, eventSourceRoot)
        : new URL(path, root),
    MessageChannel,
    Request,
    Response,
    // The APIs under test are host-realm modules, so the ordinary objects they
    // return must be compared with that same realm's intrinsic prototype.
    Object,
    Promise,
    RangeError,
    ReadableByteStreamController,
    ReadableStream,
    ReadableStreamBYOBReader,
    ReadableStreamBYOBRequest,
    ReadableStreamDefaultController,
    ReadableStreamDefaultReader,
    structuredClone,
    TextDecoder,
    TextDecoderStream,
    TextEncoder,
    TextEncoderStream,
    TransformStream,
    TransformStreamDefaultController,
    TypeError,
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    URL,
    URLSearchParams,
    WebAssembly,
    WritableStream,
    WebSocketError,
    WebSocketStream,
    WebSocket: class {
      constructor() {
        throw new Error("Host WebSocket is forbidden");
      }
    },
    assert_array_equals(actual, expected, message) {
      assert.equal(actual.length, expected.length, message);
      for (let i = 0; i < actual.length; i++) {
        assert.strictEqual(actual[i], expected[i], message);
      }
    },
    assert_class_string(value, expected, message) {
      assert.equal(Object.prototype.toString.call(value), `[object ${expected}]`, message);
    },
    assert_equals: assert.strictEqual,
    assert_false(value, message) {
      assert.equal(value, false, message);
    },
    assert_greater_than(actual, expected, message) {
      assert.ok(actual > expected, message);
    },
    assert_greater_than_equal(actual, expected, message) {
      assert.ok(actual >= expected, message);
    },
    assert_less_than(actual, expected, message) {
      assert.ok(actual < expected, message);
    },
    assert_less_than_equal(actual, expected, message) {
      assert.ok(actual <= expected, message);
    },
    assert_own_property(object, property, message) {
      assert.equal(Object.prototype.hasOwnProperty.call(object, property), true, message);
    },
    assert_not_equals(actual, expected, message) {
      assert.notStrictEqual(actual, expected, message);
    },
    assert_object_equals(actual, expected, message) {
      assert.equal(typeof actual, "object", message);
      assert.notEqual(actual, null, message);
      const seen = new Set();
      const compare = (actualValue, expectedValue) => {
        if (typeof actualValue !== "object" || actualValue === null) {
          assert.strictEqual(actualValue, expectedValue, message);
          return;
        }
        if (seen.has(actualValue)) return;
        seen.add(actualValue);
        const actualKeys = Object.keys(actualValue);
        const expectedKeys = Object.keys(expectedValue);
        assert.deepStrictEqual(actualKeys.sort(), expectedKeys.sort(), message);
        for (const key of actualKeys) compare(actualValue[key], expectedValue[key]);
      };
      compare(actual, expected);
    },
    assert_throws_js(constructor, callback, message) {
      assert.throws(
        callback,
        (error) =>
          error instanceof constructor ||
          (constructor === TypeError && error instanceof contextIntrinsicTypeError),
        message,
      );
    },
    assert_throws_exactly(expected, callback, message) {
      assert.throws(callback, (error) => error === expected, message);
    },
    assert_throws_dom(name, callback, message) {
      assert.throws(
        callback,
        (error) => error instanceof DOMException && error.name === name,
        message,
      );
    },
    assert_true(value, message) {
      assert.equal(value, true, message);
    },
    assert_unreached(message) {
      assert.fail(message);
    },
    step_timeout(callback, delay) {
      return setTimeout(callback, delay);
    },
    async_test(callbackOrName, explicitName) {
      const callback = typeof callbackOrName === "function" ? callbackOrName : undefined;
      const name = callback === undefined ? callbackOrName : explicitName;
      const capability = Promise.withResolvers();
      const timer = setTimeout(
        () => capability.reject(new Error(`Upstream async test timed out: ${name}`)),
        5000,
      );
      const test = {
        step(callback, thisObject = test) {
          try {
            return callback.call(thisObject);
          } catch (error) {
            capability.reject(error);
            return undefined;
          }
        },
        done() {
          capability.resolve();
        },
        step_func(callback) {
          return (...args) => {
            try {
              return callback.call(test, ...args);
            } catch (error) {
              capability.reject(error);
              return undefined;
            }
          };
        },
        step_func_done(callback) {
          return (...args) => {
            try {
              callback.call(test, ...args);
              capability.resolve();
            } catch (error) {
              capability.reject(error);
            }
          };
        },
        step_timeout(callback, delay) {
          return setTimeout(test.step_func(callback), delay);
        },
        unreached_func(message) {
          return () => capability.reject(new Error(message));
        },
      };
      if (callback !== undefined) {
        try {
          callback(test);
        } catch (error) {
          capability.reject(error);
        }
      }
      const result = capability.promise
        .finally(() => clearTimeout(timer))
        .then(
          () => reportPass(path, name),
          (error) => reportFailure(path, name, error),
        );
      pending.push(result);
      return test;
    },
    fetch(input, init) {
      let resolved;
      try {
        const base =
          path.startsWith("eventsource/") || path.startsWith("service-workers/cache-storage/")
            ? new URL(path, eventSourceRoot)
            : new URL(path, root);
        resolved = new URL(String(input), base);
      } catch {
        return runtime.fetch(input, init);
      }
      if (
        path.startsWith("service-workers/cache-storage/") &&
        resolved.origin === eventSourceRoot.origin
      ) {
        return runtime.fetch(resolved.href, init);
      }
      const supportPath = resolved.pathname.slice(root.pathname.length);
      const support = verifiedSupport.get(supportPath);
      if (support !== undefined) {
        return Promise.resolve(
          new Response(support, { headers: [["content-type", "application/json"]] }),
        );
      }
      if (resolved.protocol === "data:") return hostRuntime.fetch(resolved.href, init);
      throw new Error("Host/network fetch is not an oracle in these tests");
    },
    done() {},
    format_value(value) {
      return JSON.stringify(value);
    },
    promise_test(fn, name) {
      const reason = excludedTests[name];
      if (reason !== undefined) {
        assert.equal(seenExcludedTests.has(name), false, `Duplicate excluded WPT name: ${name}`);
        seenExcludedTests.add(name);
        reportNotApplicable(path, name, reason);
        return;
      }
      const asynchronousFailure = Promise.withResolvers();
      const cleanups = [];
      const test = {
        add_cleanup(cleanup) {
          cleanups.push(cleanup);
        },
        step(callback, thisObject = test) {
          try {
            return callback.call(thisObject);
          } catch (error) {
            asynchronousFailure.reject(error);
            return undefined;
          }
        },
        step_func(callback) {
          return (...args) => {
            try {
              return callback.call(test, ...args);
            } catch (error) {
              asynchronousFailure.reject(error);
              return undefined;
            }
          };
        },
        step_timeout(callback, delay) {
          return setTimeout(test.step_func(callback), delay);
        },
        unreached_func(message) {
          return () => asynchronousFailure.reject(new Error(message));
        },
      };
      const scheduled = promiseTestQueue.then(async () => {
        const body = Promise.resolve().then(() => fn(test));
        const timeout = Promise.withResolvers();
        const timer = setTimeout(
          () => timeout.reject(new Error(`Upstream promise test timed out: ${name}`)),
          5000,
        );
        try {
          await settleWithCleanups(
            Promise.race([body, asynchronousFailure.promise, timeout.promise]),
            cleanups,
          );
        } finally {
          clearTimeout(timer);
        }
      });
      const result = scheduled.then(
        () => reportPass(path, name),
        (error) => reportFailure(path, name, error),
      );
      promiseTestQueue = result;
      pending.push(result);
    },
    promise_rejects_exactly(_test, expected, promise, message) {
      return assert.rejects(promise, (error) => error === expected, message);
    },
    promise_rejects_dom(_test, name, promise, message) {
      return assert.rejects(
        promise,
        (error) => error instanceof DOMException && error.name === name,
        message,
      );
    },
    promise_rejects_js(_test, constructor, promise, message) {
      return assert.rejects(promise, constructor, message);
    },
    test(fn, name) {
      const reason = excludedTests[name];
      if (reason !== undefined) {
        assert.equal(seenExcludedTests.has(name), false, `Duplicate excluded WPT name: ${name}`);
        seenExcludedTests.add(name);
        reportNotApplicable(path, name, reason);
        return;
      }
      const cleanups = [];
      const test = {
        add_cleanup(cleanup) {
          cleanups.push(cleanup);
        },
        step_func(callback) {
          return (...args) => callback(...args);
        },
        unreached_func(message) {
          return () => assert.fail(message);
        },
      };
      let failure;
      try {
        fn.call(test, test);
      } catch (error) {
        failure = error;
      }
      for (let index = cleanups.length - 1; index >= 0; index--) {
        try {
          cleanups[index]();
        } catch (error) {
          if (failure === undefined) failure = error;
        }
      }
      if (failure === undefined) reportPass(path, name);
      else reportFailure(path, name, failure);
    },
  });
  // The APIs under test are imported from the host realm. A failed `new` on a
  // non-constructible host function is nevertheless created by the VM realm's
  // syntax operation, whose intrinsic TypeError is not the injected constructor.
  contextIntrinsicTypeError = runInContext(
    "(() => { try { new (() => {})(); } catch (error) { return error.constructor; } })()",
    context,
  );
  context.globalThis = context;
  context.self = context;
  return context;
}

async function runFixture(root, path, data, verifiedSupport) {
  const networkFixture =
    path.startsWith("eventsource/") || path.startsWith("service-workers/cache-storage/");
  const fixtureRuntime = networkFixture
    ? createHostNodeWebPlatform({
        baseURL: new URL(path, eventSourceRoot).href,
        origin: eventSourceRoot.origin,
        cookies: path.startsWith("service-workers/cache-storage/")
          ? new ServerCookiePolicy(new CookieJar())
          : undefined,
      })
    : null;
  const pending = [];
  const excludedTests = manifest.notApplicable?.[path] ?? {};
  const seenExcludedTests = new Set();
  const context = createWptContext(
    path,
    root,
    verifiedSupport,
    pending,
    excludedTests,
    seenExcludedTests,
    fixtureRuntime ?? hostRuntime,
  );
  const source = data.toString();
  const scripts = source.matchAll(/^\/\/ META: script=(.+)$/gm);
  for (const match of scripts) {
    const scriptPath = match[1];
    const relativePath = scriptPath.startsWith("/")
      ? new URL(scriptPath.slice(1), root)
      : new URL(scriptPath, new URL(path, root));
    const supportPath = relativePath.pathname.slice(root.pathname.length);
    const support = verifiedSupport.get(supportPath);
    assert.notEqual(support, undefined, `Unpinned WPT support script: ${supportPath}`);
    runInContext(support.toString(), context, { filename: supportPath, timeout: 5000 });
  }
  runInContext(source, context, { filename: path, timeout: 5000 });
  let observed = 0;
  while (observed < pending.length) {
    const batch = pending.slice(observed);
    observed = pending.length;
    await Promise.all(batch);
  }
  const expectedTests = manifest.expectedTests?.[path];
  if (expectedTests !== undefined) {
    assert.equal(
      pending.length,
      expectedTests,
      `WPT fixture registered an unexpected number of tests: ${path}`,
    );
  }
  assert.deepEqual(
    [...seenExcludedTests].sort(),
    Object.keys(excludedTests).sort(),
    `Stale or unobserved WPT exclusions: ${path}`,
  );
  if (fixtureRuntime !== null) {
    fixtureRuntime.close();
    installWebPlatformRuntime(hostRuntime);
  }
}

const localSupport = new Map();
for (const [path, expectedHash] of Object.entries(manifest.support ?? {})) {
  localSupport.set(path, readVerified(localWptRoot, path, expectedHash));
}
for (const [path, expectedHash] of Object.entries(manifest.files)) {
  if (!fixtureSelected(path)) continue;
  const data = readVerified(localWptRoot, path, expectedHash);
  if (path.endsWith(".js")) {
    await runFixture(localWptRoot, path, data, localSupport);
  }
}

const nodeWptRoot = new URL(`${manifest.nodeWpt.root}/`, repositoryRoot);
const versions = JSON.parse(
  readFileSync(new URL(manifest.nodeWpt.versionsFile, repositoryRoot), "utf8"),
);
for (const [subset, revision] of Object.entries(manifest.nodeWpt.subsets)) {
  assert.equal(versions[subset]?.commit, revision, `Node's ${subset} WPT revision changed`);
}

const nodeSupport = new Map();
for (const [path, expectedHash] of Object.entries(manifest.nodeWpt.support)) {
  nodeSupport.set(path, readVerified(nodeWptRoot, path, expectedHash));
}
for (const [path, expectedHash] of Object.entries(manifest.nodeWpt.tests)) {
  if (!fixtureSelected(path)) continue;
  await runFixture(nodeWptRoot, path, readVerified(nodeWptRoot, path, expectedHash), nodeSupport);
}

console.log(
  JSON.stringify({
    upstreamTests: passed + failed + notApplicable,
    applicableTests: passed + failed,
    passed,
    failed,
    notApplicable,
  }),
);
hostRuntime.close();
await new Promise((resolve, reject) =>
  eventSourceServer.close((error) => (error === undefined ? resolve() : reject(error))),
);
// Before the exit status, not after it: placed below, this never ran, and a filter that
// selected nothing still reported a clean zero.
if (fixtureFilter !== undefined && fixtureFilterMatched === 0) {
  console.error(`NTS_WEB_PLATFORM_FIXTURE=${fixtureFilter} selected no fixtures.`);
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
