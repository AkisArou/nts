import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
  CustomEvent,
  CountQueuingStrategy,
  Event,
  EventTarget,
  File,
  FormData,
  Headers,
  DOMException,
  ReadableStream,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TextDecoder,
  TextEncoder,
  WritableStream,
} = await import("./node_modules/.tsbuild/host/runtime/web-platform/src/index.js");
const { createHostNodeWebPlatform } =
  await import("./node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js");
const hostRuntime = createHostNodeWebPlatform();

let passed = 0;
let failed = 0;

function gitBlobHash(data) {
  return createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
}

function readVerified(root, path, expectedHash) {
  const data = readFileSync(new URL(path, root));
  assert.equal(gitBlobHash(data), expectedHash, `Upstream source changed: ${path}`);
  return data;
}

function reportPass(path, name) {
  passed++;
  console.log(`PASS ${path} :: ${name}`);
}

function reportFailure(path, name, error) {
  failed++;
  const detail = error instanceof Error ? (error.stack ?? String(error)) : String(error);
  console.error(`FAIL ${path} :: ${name}\n  ${detail}`);
}

function createWptContext(path, pending) {
  let contextIntrinsicTypeError = TypeError;
  const context = createContext({
    AbortController,
    AbortSignal,
    ArrayBuffer,
    BigInt64Array,
    BigUint64Array,
    Blob,
    ByteLengthQueuingStrategy,
    CustomEvent,
    CountQueuingStrategy,
    DataView,
    DOMException,
    Event,
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
    MessageChannel,
    // The APIs under test are host-realm modules, so the ordinary objects they
    // return must be compared with that same realm's intrinsic prototype.
    Object,
    Promise,
    RangeError,
    ReadableStream,
    ReadableStreamDefaultController,
    ReadableStreamDefaultReader,
    TextDecoder,
    TextEncoder,
    TypeError,
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    WebAssembly,
    WritableStream,
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
        step(callback) {
          try {
            return callback.call(test);
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
    fetch() {
      throw new Error("Host/network fetch is not an oracle in these tests");
    },
    done() {},
    format_value(value) {
      return JSON.stringify(value);
    },
    promise_test(fn, name) {
      const asynchronousFailure = Promise.withResolvers();
      const test = {
        step(callback) {
          try {
            return callback.call(test);
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
      const body = Promise.resolve().then(() => {
        return fn(test);
      });
      const timeout = Promise.withResolvers();
      const timer = setTimeout(
        () => timeout.reject(new Error(`Upstream promise test timed out: ${name}`)),
        5000,
      );
      const result = Promise.race([body, asynchronousFailure.promise, timeout.promise])
        .finally(() => clearTimeout(timer))
        .then(
          () => reportPass(path, name),
          (error) => reportFailure(path, name, error),
        );
      pending.push(result);
    },
    promise_rejects_exactly(_test, expected, promise, message) {
      return assert.rejects(promise, (error) => error === expected, message);
    },
    promise_rejects_js(_test, constructor, promise, message) {
      return assert.rejects(promise, constructor, message);
    },
    test(fn, name) {
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
  const pending = [];
  const context = createWptContext(path, pending);
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
  await Promise.all(pending);
}

const localSupport = new Map();
for (const [path, expectedHash] of Object.entries(manifest.files)) {
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
  await runFixture(nodeWptRoot, path, readVerified(nodeWptRoot, path, expectedHash), nodeSupport);
}

console.log(JSON.stringify({ upstreamTests: passed + failed, passed, failed }));
hostRuntime.close();
process.exit(failed === 0 ? 0 : 1);
