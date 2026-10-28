import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import * as api from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("promise-rejection-event-manifest.json", root), "utf8")) as WptManifest;

test("WPT PromiseRejectionEvent — pinned constructor fixture", async (suite) => {
  await runWptFixtures(suite, root, manifest, (reportError) => {
    const runtime = createHostNodeWebPlatform({}, {}, reportError);
    return {
      globals: { Event: api.Event, PromiseRejectionEvent: api.PromiseRejectionEvent, Promise },
      close: () => runtime.close(),
    };
  });
});
