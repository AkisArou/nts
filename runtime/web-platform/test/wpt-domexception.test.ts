import { readFileSync } from "node:fs";
import test from "node:test";
import { DOMException } from "../src/core/errors.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("domexception-manifest.json", root), "utf8")) as WptManifest;

test("WPT DOMException — Node 24.20 es-exceptions revision", async (suite) => {
  await runWptFixtures(suite, root, manifest, () => ({
    // Error is the genuine ECMAScript intrinsic used by the imported class.
    // The competing host DOMException is deliberately not supplied.
    globals: { DOMException, Error, Object, Function },
    exposeSelf: true,
    close() {},
  }));
});
