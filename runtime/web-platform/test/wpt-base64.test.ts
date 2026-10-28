import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { atob, btoa, DOMException } from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("base64-manifest.json", root), "utf8")) as WptManifest;
const dataPath = "fetch/data-urls/resources/base64.json";
const fixtureDataPath = "../../../fetch/data-urls/resources/base64.json";
assert.equal(manifest.support.length, 1);
assert.equal(manifest.support[0]?.path, dataPath);
const data = readFileSync(new URL(dataPath, root), "utf8");

async function fetchPinnedJson(path: string): Promise<unknown> {
  assert.equal(path, fixtureDataPath, "Only the pinned base64 JSON corpus may be requested");
  // runWptFixtures verifies this support file's SHA-256 and upstream Git blob
  // before creating the fixture environment. This loader never opens a URL.
  return JSON.parse(data) as unknown;
}

test("WPT base64 data loader rejects unpinned paths", async () => {
  for (const path of [
    "https://wpt.invalid/fetch/data-urls/resources/base64.json",
    "../../../fetch/data-urls/resources/base64.json?changed",
    "../../../fetch/data-urls/resources/other.json",
  ]) {
    await assert.rejects(fetchPinnedJson(path), /Only the pinned base64 JSON corpus/);
  }
});

test("WPT HTML atob and btoa — pinned base64 fixture", async (suite) => {
  await runWptFixtures(suite, root, manifest, () => ({
    globals: { atob, btoa, DOMException, fetch_json: fetchPinnedJson },
    close() {},
  }));
});
