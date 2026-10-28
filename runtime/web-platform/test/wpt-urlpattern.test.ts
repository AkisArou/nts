import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Response } from "../src/fetch/response.ts";
import { installURLPatternURLCapability } from "../src/provider/url-pattern.ts";
import { URLPattern } from "../src/urlpattern/url-pattern.ts";
import { HostURLPatternURLCapability } from "./urlpattern-provider.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("urlpattern-manifest.json", root), "utf8")) as WptManifest;
const fixtureFilter = process.env.NTS_WPT_URLPATTERN_FIXTURE;
const selected = fixtureFilter === undefined ? manifest : {
  ...manifest, fixtures: manifest.fixtures.filter((fixture) => fixture.path === fixtureFilter),
};
assert.ok(selected.fixtures.length > 0, "URLPattern fixture filter selected no files");
const data = readFileSync(new URL("urlpattern/resources/urlpatterntestdata.json", root), "utf8");

test("WPT URLPattern — Node 24.20 directory revision", async (suite) => {
  await runWptFixtures(suite, root, selected, (reportError) => {
    let networkAttempts = 0;
    const runtime = createHostNodeWebPlatform({
      fetchTransport: { async dispatch() { networkAttempts++; throw new Error("URLPattern WPT cannot use the network"); } },
    }, {}, reportError);
    installURLPatternURLCapability(runtime, new HostURLPatternURLCapability());
    return {
      exposeSelf: true,
      globals: {
        URLPattern,
        // This genuine host URL only computes expected base components in the
        // unedited upstream helper (and supplies dictionary input in one test).
        // It is not the URLPattern implementation and establishes no URL API claim.
        URL,
        async fetch(path: string): Promise<Response> {
          assert.equal(path, "resources/urlpatterntestdata.json", "Only the pinned local data file may be requested");
          return new Response(data, { headers: { "Content-Type": "application/json" } });
        },
      },
      async close() {
        await runtime.close();
        assert.equal(networkAttempts, 0);
      },
    };
  });
});
