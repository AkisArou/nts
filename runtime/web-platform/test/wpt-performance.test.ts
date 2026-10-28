// Pinned High Resolution Time and User Timing files use the canonical source
// implementation. No Node Performance classes or clone capability are injected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { DOMException } from "../src/core/errors.ts";
import { Event, EventTarget } from "../src/core/events.ts";
import {
  createPerformance, Performance, PerformanceEntry, PerformanceMark, PerformanceMeasure,
} from "../src/performance/performance.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("performance-manifest.json", root), "utf8")) as WptManifest;
const prefix = process.env.NTS_WPT_PERFORMANCE_FIXTURE;
const selected = prefix === undefined ? manifest : {
  ...manifest,
  fixtures: manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix)),
};
assert.ok(selected.fixtures.length > 0, "The Performance fixture filter must select at least one file");

test("WPT High Resolution Time and User Timing — pinned source cases", async (suite) => {
  await runWptFixtures(suite, root, selected, (reportError) => {
    const runtime = createHostNodeWebPlatform({}, {}, reportError);
    const performance = createPerformance(runtime);
    return {
      exposeSelf: true,
      globals: {
        performance, Performance, PerformanceEntry, PerformanceMark, PerformanceMeasure,
        DOMException, Event, EventTarget,
        // Genuine ECMAScript constructors keep ordinary object checks aligned
        // with the canonical imported source; these are not competing Web APIs.
        Object, Promise,
      },
      async close() { await runtime.close(); },
    };
  });
});
