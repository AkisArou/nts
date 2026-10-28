// Compression Standard §§2–5, against every executable file in the unchanged pin.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";
import { createCompressionEnvironment, startCompressionResourceServer } from "./wpt/compression-streams/environment.ts";

interface CompressionManifest extends WptManifest {
  excludedFixtures: { path: string; category: string; reason: string }[];
}

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("compression-streams/manifest.json", root), "utf8")) as CompressionManifest;

test("WPT Compression Streams — ae05f5cb53d3e290b91ae1e92069baa188292880", async (suite) => {
  const server = await startCompressionResourceServer();
  try {
    await runWptFixtures(suite, root, manifest, (reportError) => createCompressionEnvironment(server, reportError));
    for (const fixture of manifest.excludedFixtures) {
      await suite.test(fixture.path, { skip: fixture.category + ": " + fixture.reason }, () => {});
    }
    for (const path of ["media/foo.vtt", "media/test-av-384k-44100Hz-1ch-320x240-30fps-10kfr.webm"]) {
      assert.ok(server.requested.has(path), `unchanged fixture did not fetch ${path}`);
    }
  } finally {
    await server.close();
  }
});
