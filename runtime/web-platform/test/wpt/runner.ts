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
  defaultTestName?: string;
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

/** Execute verified classic HTML scripts in order, without emulating a DOM. */
export function runWptHtmlScripts(
  harness: WptHarness,
  source: string,
  fixture: WptFixture,
  support: ReadonlyMap<string, string>,
): void {
  const harnessScripts: string[] = [];
  const dependencies: string[] = [];
  const scripts: { source: string; path: string; lineOffset: number }[] = [];
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? "";
    assert.doesNotMatch(attributes, /\b(?:type|async|defer|nomodule)\b/i);
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    if (src !== null) {
      const reference = src[1] ?? src[2] ?? src[3];
      assert.ok(reference);
      const url = new URL(reference, `https://wpt.invalid/${fixture.path}`);
      assert.equal(url.origin, "https://wpt.invalid", "HTML support must be a local pinned path");
      assert.equal(url.search, "", "HTML support cannot require server-side parameters");
      assert.equal(url.hash, "", "HTML support fragments are not supported");
      const path = url.pathname.slice(1);
      if (path === "resources/testharness.js" || path === "resources/testharnessreport.js") {
        harnessScripts.push(reference);
      } else {
        dependencies.push(path);
        const script = support.get(path);
        assert.notEqual(script, undefined, `unpinned HTML support script: ${path}`);
        scripts.push({ source: script!, path, lineOffset: 0 });
      }
    } else {
      const openingEnd = source.indexOf(">", match.index) + 1;
      const lineOffset = source.slice(0, openingEnd).split("\n").length - 1;
      scripts.push({ source: match[2] ?? "", path: fixture.path, lineOffset });
    }
  }
  // Validate the complete dependency plan before executing any fixture code.
  assert.deepEqual(harnessScripts, fixture.harnessScripts, "HTML harness imports must match manifest");
  assert.deepEqual(dependencies, fixture.support, "HTML scripts must match pinned dependencies");
  for (const script of scripts) harness.run(script.source, script.path, script.lineOffset);
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
        timeouts.length === 0 ? 10000 : 60000, {
          exposeSelf: environment.exposeSelf,
          defaultTestName: fixture.defaultTestName,
          maxTests: fixture.expectedTests,
        });
      const scripts = [...source.matchAll(/^\/\/ META: script=(.+)$/gm)].map((match) => {
        const reference = match[1];
        assert.ok(reference);
        return new URL(reference, `https://wpt.invalid/${fixture.path}`).pathname.slice(1);
      });
      if (fixture.format === "javascript") {
        assert.deepEqual(scripts, fixture.support, "META scripts must match pinned dependencies");
        for (const path of scripts) {
          const script = support.get(path);
          assert.notEqual(script, undefined, `unpinned support script: ${path}`);
          harness.run(script!, path);
        }
        harness.run(source, fixture.path);
      } else {
        assert.equal(scripts.length, 0, "HTML dependencies must use classic script elements");
        runWptHtmlScripts(harness, source, fixture, support);
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
