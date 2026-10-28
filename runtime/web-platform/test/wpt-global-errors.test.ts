// Only the two source-only checks run until actual-global/native metadata
// capabilities exist. A deterministic test contract is not that native binding.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { ErrorDriver } from "./support/global-errors-driver.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("global-errors-manifest.json", root), "utf8")) as WptManifest;

test("WPT reportError — pinned source-policy cases and named native dependencies", async (suite) => {
  await runWptFixtures(suite, root, manifest, (_reportError, _context, reportUncaughtException) => {
    const provider = createHostNodeWebPlatform();
    const driver = new ErrorDriver();
    driver.reportExceptionToConsole = (error): void => {
      driver.errors.push(error);
      reportUncaughtException(error);
    };
    return {
      exposeSelf: true,
      uncaughtExceptionChannel: true,
      globals: { reportError: driver.runtime.reportError.bind(globalThis) },
      async close() {
        await provider.close();
        assert.equal(driver.events.length, 1, "only the getter non-observation case reports an exception");
        assert.equal(driver.errors.length, 1);
        assert.equal(driver.tasks.length, 0, "source-only reportError cases must not use promise hooks");
      },
    };
  });
});
