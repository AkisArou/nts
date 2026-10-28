// Unedited WebCryptoAPI WPT, using this package's canonical Crypto implementation.
import assert from "node:assert/strict";
import test from "node:test";
import { runWptFixtures } from "./wpt/runner.ts";
import { createWebCryptoWptEnvironment } from "./wpt/webcrypto/environment.ts";
import { readWebCryptoManifest } from "./wpt/webcrypto/manifest.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = readWebCryptoManifest();
const prefix = process.env.NTS_WPT_CRYPTO_FIXTURE;
const selected = prefix === undefined ? manifest : {
  ...manifest,
  fixtures: manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix)),
  excludedFixtures: manifest.excludedFixtures.filter((fixture) => fixture.path.startsWith(prefix)),
};
assert.ok(selected.fixtures.length + selected.excludedFixtures.length > 0,
  "The WebCrypto fixture filter must select at least one file");

test("WPT WebCryptoAPI — Node 24.20 directory revision", async (suite) => {
  await runWptFixtures(suite, root, selected, createWebCryptoWptEnvironment);
  for (const fixture of selected.excludedFixtures) {
    await suite.test(fixture.path, { skip: `${fixture.category}: ${fixture.reason}` }, () => {});
    suite.diagnostic(`WPT ${fixture.path}: not run (${fixture.category})`);
  }
});
