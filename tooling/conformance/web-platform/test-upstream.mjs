import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

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

const { Blob, File, Headers } =
  await import("./node_modules/.tsbuild/host/runtime/web-platform/src/index.js");

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
  console.error(`FAIL ${path} :: ${name}\n  ${String(error)}`);
}

function createWptContext(path, pending) {
  const context = createContext({
    ArrayBuffer,
    Blob,
    DataView,
    File,
    Headers,
    Int8Array,
    Promise,
    TextEncoder,
    Uint8Array,
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
    assert_not_equals(actual, expected, message) {
      assert.notStrictEqual(actual, expected, message);
    },
    assert_true(value, message) {
      assert.equal(value, true, message);
    },
    fetch() {
      throw new Error("Host/network fetch is not an oracle in these tests");
    },
    format_value(value) {
      return JSON.stringify(value);
    },
    promise_test(fn, name) {
      const result = Promise.resolve()
        .then(() => fn({}))
        .then(
          () => reportPass(path, name),
          (error) => reportFailure(path, name, error),
        );
      pending.push(result);
    },
    test(fn, name) {
      try {
        fn({});
        reportPass(path, name);
      } catch (error) {
        reportFailure(path, name, error);
      }
    },
  });
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
    const relativePath = new URL(match[1], new URL(path, root));
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
assert.equal(
  versions[manifest.nodeWpt.subset]?.commit,
  manifest.nodeWpt.revision,
  `Node's ${manifest.nodeWpt.subset} WPT revision changed`,
);

const nodeSupport = new Map();
for (const [path, expectedHash] of Object.entries(manifest.nodeWpt.support)) {
  nodeSupport.set(path, readVerified(nodeWptRoot, path, expectedHash));
}
for (const [path, expectedHash] of Object.entries(manifest.nodeWpt.tests)) {
  await runFixture(nodeWptRoot, path, readVerified(nodeWptRoot, path, expectedHash), nodeSupport);
}

console.log(JSON.stringify({ upstreamTests: passed + failed, passed, failed }));
process.exitCode = failed === 0 ? 0 : 1;
