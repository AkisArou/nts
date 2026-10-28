// Node 24.20's exact WPT directory revisions, using the canonical source classes.
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { AbortController, AbortSignal, CustomEvent, DOMException, Event, EventTarget } from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("events-abort/manifest.json", root), "utf8")) as WptManifest;

test("WPT events and abort — Node 24.20 directory revisions", async (suite) => {
  await runWptFixtures(suite, root, manifest, (reportError) => {
    const runtime = createHostNodeWebPlatform({}, {}, reportError);
    return {
      globals: { AbortController, AbortSignal, CustomEvent, DOMException, Event, EventTarget },
      close: () => runtime.close(),
    };
  });
});
