// Unedited WPT fixtures, with the package's canonical classes and ordinary-Node
// provider. Browser-only capabilities are named skips, never replacement APIs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { AbortController, AbortSignal, CustomEvent, DOMException, Event, EventTarget } from "../src/index.ts";
import { WptHarness } from "./wpt/harness.ts";
import type { WptBlock } from "./wpt/harness.ts";

interface Source {
  path: string;
  sha256: string;
  gitBlob: string;
}

interface Fixture extends Source {
  format: "javascript" | "html";
  support: string[];
  harnessScripts: string[];
  expectedTests: number;
  blockedTests: Record<string, WptBlock>;
}

interface Manifest {
  revision: string;
  fixtures: Fixture[];
  support: Source[];
  license: Source;
}

const root = new URL("./wpt/events-abort/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")) as Manifest;

function verified(source: Source): string {
  const bytes = readFileSync(new URL(`upstream/${source.path}`, root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.path);
  assert.equal(
    createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    source.gitBlob,
    `upstream blob changed: ${source.path}`,
  );
  return bytes.toString("utf8");
}

test(`WPT events and abort — ${manifest.revision}`, { timeout: 30000 }, async (suite) => {
  verified(manifest.license);
  const support = new Map(manifest.support.map((source) => [source.path, verified(source)]));
  for (const fixture of manifest.fixtures) {
    await suite.test(fixture.path, async (file) => {
      const harness = new WptHarness(
        { AbortController, AbortSignal, CustomEvent, DOMException, Event, EventTarget },
        fixture.blockedTests,
      );
      const runtime = createHostNodeWebPlatform({}, {}, (error) => harness.reportError(error));
      file.after(() => runtime.close());
      const source = verified(fixture);
      const scripts = [...source.matchAll(/^\/\/ META: script=(.+)$/gm)].map((match) => {
        const reference = match[1];
        assert.ok(reference);
        return new URL(reference, `https://wpt.invalid/${fixture.path}`).pathname.slice(1);
      });
      assert.deepEqual(scripts, fixture.support, "META scripts must match pinned dependencies");
      for (const path of scripts) {
        const script = support.get(path);
        assert.notEqual(script, undefined, `unpinned support script: ${path}`);
        harness.run(script!, path);
      }
      if (fixture.format === "javascript") harness.run(source, fixture.path);
      else {
        // This is extraction of the pinned HTML's script text, not a DOM emulator.
        // These fixtures have ordinary inline scripts and harness imports only.
        const external: string[] = [];
        for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
          const attributes = match[1] ?? "";
          assert.doesNotMatch(attributes, /\b(?:type|async|defer|nomodule)\b/i);
          const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
          if (src !== null) {
            const path = src[1] ?? src[2] ?? src[3];
            assert.ok(path === "/resources/testharness.js" || path === "/resources/testharnessreport.js");
            external.push(path);
          } else {
            const openingEnd = source.indexOf(">", match.index) + 1;
            const lineOffset = source.slice(0, openingEnd).split("\n").length - 1;
            harness.run(match[2] ?? "", fixture.path, lineOffset);
          }
        }
        assert.deepEqual(external, fixture.harnessScripts, "HTML harness imports must match manifest");
      }
      const results = await harness.finish();
      assert.equal(results.length, fixture.expectedTests, "WPT registration count changed");
      const counts = { pass: 0, fail: 0, blocked: 0 };
      for (const result of results) {
        counts[result.status]++;
        await file.test(result.name, { skip: result.reason }, () => {
          if (result.status === "fail") throw result.error;
        });
      }
      file.diagnostic(`WPT ${fixture.path}: ${counts.pass} pass, ${counts.fail} fail, ${counts.blocked} blocked`);
    });
  }
});
