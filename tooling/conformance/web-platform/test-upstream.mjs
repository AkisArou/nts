// Adapted only for integrated repository paths; upstream fixtures remain hash-verified.
// Runs the two complete, unchanged vendored WPT files. This minimal assertion
// bridge supports only their synchronous harness API; it is NOT WPT testharness.js.
// No test is removed, marked passed on failure, or redirected to native Headers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { Headers } from "./node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
const root = new URL("../../../runtime/web-platform/third_party/wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
let passed = 0,
  failed = 0;
for (const [path, sha] of Object.entries(manifest.files)) {
  const data = readFileSync(new URL(path, root));
  const actual = createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
  assert.equal(actual, sha, "Upstream source changed: " + path);
  if (!path.endsWith(".js")) continue;
  runInNewContext(
    data.toString(),
    {
      Headers,
      fetch() {
        throw new Error("Host/network fetch is not an oracle in these tests");
      },
      WebSocket: class {
        constructor() {
          throw new Error("Host WebSocket is forbidden");
        }
      },
      test(fn, name) {
        try {
          fn();
          passed++;
          console.log("PASS " + path + " :: " + name);
        } catch (error) {
          failed++;
          console.error("FAIL " + path + " :: " + name + "\n  " + String(error));
        }
      },
      assert_equals: assert.strictEqual,
      assert_true: (value, message) => assert.equal(value, true, message),
      assert_false: (value, message) => assert.equal(value, false, message),
      assert_array_equals(actual, expected, message) {
        assert.equal(actual.length, expected.length, message);
        for (let i = 0; i < actual.length; i++) assert.strictEqual(actual[i], expected[i], message);
      },
    },
    { filename: path, timeout: 5000 },
  );
}
console.log(JSON.stringify({ upstreamTests: passed + failed, passed, failed }));
process.exitCode = failed ? 1 : 0;
