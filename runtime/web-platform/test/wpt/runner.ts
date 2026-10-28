// Shared, test-only fixture adapter. Every area supplies its own canonical package
// globals; a fresh VM context never inherits Node's competing web API globals.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TestContext } from "node:test";
import { WptHarness } from "./harness.ts";
import type { WptBlock } from "./harness.ts";

export interface WptSource {
  revision: string;
  path: string;
  sha256: string;
  gitBlob: string;
}

export interface WptFixture extends WptSource {
  format: "javascript" | "html";
  support: string[];
  harnessScripts: string[];
  expectedTests: number;
  blockedTests: Record<string, WptBlock>;
}

export interface WptManifest {
  revisions: Record<string, string>;
  fixtures: WptFixture[];
  support: WptSource[];
  license: WptSource;
}

export interface WptEnvironment {
  globals: Record<string, unknown>;
  exposeSelf?: boolean;
  close(): void | Promise<void>;
}

function verified(root: URL, source: WptSource): string {
  const bytes = readFileSync(new URL(source.path, root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.path);
  assert.equal(
    createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    source.gitBlob,
    `upstream blob changed: ${source.path}`,
  );
  return bytes.toString("utf8");
}

/** Run an area manifest with only the globals supplied by its source provider. */
export async function runWptFixtures(
  suite: TestContext,
  root: URL,
  manifest: WptManifest,
  createEnvironment: (reportError: (error: unknown) => void) => WptEnvironment,
): Promise<void> {
  verified(root, manifest.license);
  const support = new Map(manifest.support.map((source) => [source.path, verified(root, source)]));
  for (const fixture of manifest.fixtures) {
    await suite.test(fixture.path, async (file) => {
      const source = verified(root, fixture);
      const timeouts = [...source.matchAll(/^\/\/ META: timeout=(.+)$/gm)].map((match) => match[1]);
      assert.ok(timeouts.length <= 1 && timeouts.every((value) => value === "long"),
        "Unsupported WPT timeout metadata");
      let harness: WptHarness;
      const environment = createEnvironment((error) => harness.reportError(error));
      file.after(() => environment.close());
      // WPT resources/testharness.js uses 10 seconds normally and 60 for long tests.
      harness = new WptHarness(environment.globals, fixture.blockedTests,
        timeouts.length === 0 ? 10000 : 60000, { exposeSelf: environment.exposeSelf });
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
}
