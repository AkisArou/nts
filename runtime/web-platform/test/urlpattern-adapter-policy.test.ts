import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

type CloseMode = "clean" | "reported" | "thrown";

// Run the real fixture runner in its own process. A teardown error must change
// the file/process result, not merely an internal array inspected by this test.
function runCloseControl(mode: CloseMode): { status: number | null; output: string } {
  const moduleURL = (path: string): string => JSON.stringify(new URL(path, import.meta.url).href);
  const source = `
    import { readFileSync } from "node:fs";
    import test from "node:test";
    import { URL } from "node:url";
    import { runWptFixtures } from ${moduleURL("./wpt/runner.ts")};
    import { createHostNodeWebPlatform } from ${moduleURL("../host/node-runtime.ts")};
    import { URLPattern } from ${moduleURL("../src/urlpattern/url-pattern.ts")};
    import { installURLPatternURLCapability } from ${moduleURL("../src/provider/url-pattern.ts")};
    import { HostURLPatternURLCapability } from ${moduleURL("./urlpattern-provider.ts")};
    const root = new URL(${moduleURL("./wpt/")});
    const manifest = JSON.parse(readFileSync(new URL("urlpattern-manifest.json", root), "utf8"));
    manifest.fixtures = manifest.fixtures.filter((fixture) => fixture.path === "urlpattern/urlpattern-constructor.any.js");
    const mode = ${JSON.stringify(mode)};
    test("URLPattern runner teardown control", async (suite) => {
      await runWptFixtures(suite, root, manifest, (reportError) => {
        const runtime = createHostNodeWebPlatform();
        installURLPatternURLCapability(runtime, new HostURLPatternURLCapability());
        return {
          globals: { URLPattern, URL },
          async close() {
            await runtime.close();
            await Promise.resolve();
            console.log("URLPattern teardown path reached: " + mode);
            const error = new Error("URLPattern teardown sentinel");
            if (mode === "reported") reportError(error);
            if (mode === "thrown") throw error;
          },
        };
      });
    });
  `;
  const environment = { ...process.env };
  // A node:test worker otherwise makes its child use the parent's IPC reporter.
  delete environment.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath,
    ["--expose-gc", "--input-type=module", "--test-reporter=tap", "--eval", source],
    { env: environment, encoding: "utf8" });
  const output = child.stdout + child.stderr;
  assert.equal(child.error, undefined, output);
  assert.equal(child.signal, null, output);
  assert.match(output, /WPT urlpattern\/urlpattern-constructor\.any\.js: 2 pass, 0 fail, 0 blocked/, output);
  assert.match(output, new RegExp("URLPattern teardown path reached: " + mode), output);
  return { status: child.status, output };
}

test("WPT provider errors reported after awaited close fail the fixture process", () => {
  const result = runCloseControl("reported");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /WPT harness failed/);
});

test("WPT clean provider teardown preserves the fixture process success", () => {
  const result = runCloseControl("clean");
  assert.equal(result.status, 0, result.output);
});

test("WPT a throwing provider close remains a fixture process failure", () => {
  const result = runCloseControl("thrown");
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /URLPattern teardown sentinel/);
});
