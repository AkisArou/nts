// Shared, test-only fixture adapter. Every area supplies its own canonical package
// globals; a fresh VM context never inherits Node's competing web API globals.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { TextDecoder } from "node:util";
import { WptHarness } from "./harness.ts";
import type { WptBlock, WptResult } from "./harness.ts";
import { readWptVersions, verifiedWptSource } from "./versions.ts";

export interface WptSource {
  path: string;
}

export type WptTimeoutCategory = "network" | "reconnect";

export interface WptFixture extends WptSource {
  format: "javascript" | "html";
  support: string[];
  harnessScripts: string[];
  expectedTests: number;
  blockedTests: Record<string, WptBlock>;
  /** One declared META/meta variant; omitted keeps the unqualified fixture URL. */
  variant?: string;
  timeoutCategory?: WptTimeoutCategory;
  /** Explicit, source-ordered literal importScripts requests, as WPT paths. */
  importScripts?: string[];
}

export interface WptManifest {
  fixtures: WptFixture[];
  support: WptSource[];
  license: WptSource;
}

export interface WptEnvironment {
  globals: Record<string, unknown>;
  exposeSelf?: boolean;
  /** Real aliases of the fixture's VM global, for example a worker's `self`. */
  globalAliases?: readonly string[];
  close(): void | Promise<void>;
}

export interface WptMetadata {
  readonly title: string | undefined;
  readonly timeout: "long" | undefined;
  readonly globals: readonly string[];
  readonly variants: readonly string[];
  readonly scripts: readonly string[];
}

export interface WptFixtureContext {
  readonly fixture: WptFixture;
  /** Read from the verified original, before any .sub substitutions. */
  readonly metadata: WptMetadata;
  readonly url: URL;
  readonly timeoutMilliseconds: number;
}

export interface WptScriptContext {
  readonly path: string;
  readonly kind: "fixture" | "support";
  readonly context: WptFixtureContext;
  readonly url: URL;
}

export interface WptRunnerOptions {
  /** Origin of a local resource server. WPT paths remain rooted at its origin. */
  baseURL?: string | URL | ((fixture: WptFixture) => string | URL);
  timeouts?: Partial<Record<"default" | "long" | WptTimeoutCategory, number>>;
  timeoutCategory?: WptTimeoutCategory;
  /** Called only after hashes and original dependency declarations are checked. */
  transformScript?: (verifiedSource: string, script: WptScriptContext) => string;
}

export interface WptPreparedScript {
  readonly path: string;
  readonly url: URL;
  readonly source: string;
  readonly lineOffset: number;
}

export interface WptPreparedFixture {
  readonly context: WptFixtureContext;
  readonly scripts: readonly WptPreparedScript[];
  readonly imports: readonly WptPreparedScript[];
}

interface ScriptEntry {
  readonly path: string;
  readonly url: URL;
  readonly kind: "fixture" | "support";
  readonly source: string;
  readonly lineOffset: number;
}

const resolutionRoot = new URL("https://wpt.invalid/");
const defaultTimeouts = { default: 10_000, long: 60_000, network: 60_000, reconnect: 120_000 };
const harnessPaths = new Set(["/resources/testharness.js", "/resources/testharnessreport.js"]);

function referenceURL(reference: string, fixtureURL: URL): URL {
  const url = new URL(reference, fixtureURL);
  assert.equal(url.origin, fixtureURL.origin, `external WPT script is not locally pinned: ${reference}`);
  assert.equal(url.hash, "", `fragment in WPT script dependency: ${reference}`);
  return url;
}

function attributes(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of text.matchAll(/([^\s=<>"'`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = (match[1] ?? "").toLowerCase();
    assert.ok(name !== "" && !result.has(name), "duplicate or empty HTML attribute");
    result.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function fixtureText(bytes: Buffer, format: WptFixture["format"]): string {
  if (format === "javascript") return bytes.toString("utf8");
  // These local HTML fixtures have no HTTP charset header. Honour their BOM or
  // explicit meta declaration after validating the original bytes. This is file
  // decoding by the Node test host, not an implementation of the API under test.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  let encoding = "utf-8";
  for (const match of bytes.subarray(0, 1024).toString("latin1").matchAll(/<meta\b([^>]*)>/gi)) {
    const values = attributes(match[1] ?? "");
    const declared = values.get("charset") ??
      (values.get("http-equiv")?.toLowerCase() === "content-type"
        ? /\bcharset\s*=\s*["']?([^\s;"']+)/i.exec(values.get("content") ?? "")?.[1]
        : undefined);
    if (declared !== undefined) { encoding = declared; break; }
  }
  return new TextDecoder(encoding).decode(bytes);
}

function metadata(source: string, format: WptFixture["format"]): WptMetadata {
  const titles: string[] = [];
  const timeouts: string[] = [];
  const globals: string[] = [];
  const variants: string[] = [];
  const scripts: string[] = [];
  if (format === "javascript") {
    for (const match of source.matchAll(/^\/\/ META:\s*([^=\r\n]+)=(.*)\r?$/gm)) {
      const name = match[1]?.trim();
      const value = (match[2] ?? "").trim();
      switch (name) {
        case "title": titles.push(value); break;
        case "timeout": timeouts.push(value); break;
        case "global": globals.push(...value.split(",").map((entry) => entry.trim())); break;
        case "variant": variants.push(value); break;
        case "script": scripts.push(value); break;
      }
    }
  } else {
    for (const match of source.matchAll(/<meta\b([^>]*)>/gi)) {
      const values = attributes(match[1] ?? "");
      const name = values.get("name")?.toLowerCase();
      if (name === "timeout") timeouts.push(values.get("content") ?? "");
      if (name === "variant") variants.push(values.get("content") ?? "");
    }
    for (const match of source.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)) titles.push((match[1] ?? "").trim());
  }
  assert.ok(titles.length <= 1, "duplicate WPT title metadata");
  assert.ok(timeouts.length <= 1 && timeouts.every((value) => value === "long"), "Unsupported WPT timeout metadata");
  assert.ok(globals.every((value) => value !== ""), "empty WPT global metadata");
  assert.ok(variants.every((value) => value === "" || value.startsWith("?")), "unsupported WPT variant metadata");
  assert.equal(new Set(variants).size, variants.length, "duplicate WPT variant metadata");
  assert.ok(scripts.every((value) => value !== ""), "empty WPT script metadata");
  return { title: titles[0], timeout: timeouts.length === 0 ? undefined : "long", globals, variants, scripts };
}

function timeoutFor(fixture: WptFixture, meta: WptMetadata, options: WptRunnerOptions): number {
  const timeouts = { ...defaultTimeouts, ...options.timeouts };
  for (const [name, value] of Object.entries(timeouts)) {
    assert.ok(Object.hasOwn(defaultTimeouts, name), `unknown WPT timeout category: ${name}`);
    assert.ok(Number.isSafeInteger(value) && value > 0, "WPT deadlines must be positive integer milliseconds");
  }
  const category = fixture.timeoutCategory ?? options.timeoutCategory;
  assert.ok(category === undefined || category === "network" || category === "reconnect", "unknown WPT fixture timeout category");
  // A network/reconnect allowance can extend the declared WPT budget, never shorten it.
  const declared = meta.timeout === "long" ? timeouts.long : timeouts.default;
  return category === undefined ? declared : Math.max(declared, timeouts[category]);
}

function literalImports(source: string): string[] {
  // This loading primitive admits the standalone literal calls used by the
  // selected fixtures. Computed imports need a separately reviewed loader.
  const calls = [...source.matchAll(/^[\t ]*importScripts\s*\(([^()\r\n]*)\)\s*;?[\t ]*$/gm)];
  assert.equal(calls.length, [...source.matchAll(/\bimportScripts\s*\(/g)].length,
    "importScripts must use standalone literal arguments");
  const references: string[] = [];
  for (const call of calls) {
    const argumentsText = call[1] ?? "";
    if (argumentsText.trim() === "") continue;
    const argument = /\s*(?:"([^"\\]*)"|'([^'\\]*)')\s*(,|$)/gy;
    let offset = 0;
    while (offset < argumentsText.length) {
      argument.lastIndex = offset;
      const match = argument.exec(argumentsText);
      assert.ok(match !== null, "importScripts must use literal URL arguments without escapes");
      references.push(match[1] ?? match[2] ?? "");
      offset = argument.lastIndex;
      assert.ok(match[3] !== "," || offset < argumentsText.length, "trailing comma in importScripts mapping");
    }
  }
  return references;
}

function scriptEntries(
  fixture: WptFixture,
  source: string,
  context: WptFixtureContext,
  support: ReadonlyMap<string, string>,
): { entries: ScriptEntry[]; imports: ScriptEntry[] } {
  const entries: ScriptEntry[] = [];
  const imports: ScriptEntry[] = [];
  const dependencies: string[] = [];
  const harness: string[] = [];
  const supportEntry = (reference: string): ScriptEntry => {
    const url = referenceURL(reference, context.url);
    const path = url.pathname.slice(1);
    const script = support.get(path);
    assert.notEqual(script, undefined, `unpinned support script: ${path}`);
    dependencies.push(path);
    return { path, url, kind: "support", source: script!, lineOffset: 0 };
  };
  if (fixture.format === "javascript") {
    for (const reference of context.metadata.scripts) entries.push(supportEntry(reference));
    const references = fixture.importScripts === undefined ? [] : literalImports(source);
    assert.deepEqual(references.map((reference) => {
      const url = referenceURL(reference, context.url);
      return url.pathname.slice(1) + url.search;
    }), fixture.importScripts ?? [], "importScripts declarations must match their pinned mapping");
    for (const reference of references) {
      const url = referenceURL(reference, context.url);
      if (harnessPaths.has(url.pathname) && url.search === "") {
        harness.push(url.pathname);
        imports.push({ path: url.pathname.slice(1), url, kind: "support", source: "", lineOffset: 0 });
      } else {
        const imported = supportEntry(reference);
        assert.equal(literalImports(imported.source).length, 0, "nested importScripts need an explicit loader extension");
        imports.push(imported);
      }
    }
    entries.push({ path: fixture.path, url: context.url, kind: "fixture", source, lineOffset: 0 });
  } else {
    assert.equal(fixture.importScripts, undefined, "HTML fixtures do not have a worker script loader");
    // Extract classic scripts without inventing a Document, parsing a DOM or
    // executing module/async/defer lifecycle that this environment does not own.
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const values = attributes(match[1] ?? "");
      for (const name of ["async", "defer", "nomodule"]) assert.ok(!values.has(name), `unsupported HTML script attribute: ${name}`);
      const type = (values.get("type") ?? "").trim().toLowerCase();
      assert.ok(type === "" || type === "text/javascript" || type === "application/javascript", `unsupported HTML script type: ${type}`);
      const reference = values.get("src");
      if (reference !== undefined) {
        const url = referenceURL(reference, context.url);
        if (harnessPaths.has(url.pathname) && url.search === "") harness.push(url.pathname);
        else entries.push(supportEntry(reference));
      } else {
        const openingEnd = source.indexOf(">", match.index) + 1;
        const lineOffset = source.slice(0, openingEnd).split("\n").length - 1;
        entries.push({ path: fixture.path, url: context.url, kind: "fixture", source: match[2] ?? "", lineOffset });
      }
    }
  }
  assert.deepEqual(dependencies, fixture.support, "fixture scripts must match pinned dependencies in source order");
  assert.deepEqual(harness, fixture.harnessScripts, "HTML harness imports must match manifest");
  return { entries, imports };
}

/** Verify all originals and declarations before exposing text to a substitution hook. */
export function loadWptFixtures(root: URL, manifest: WptManifest, options: WptRunnerOptions = {}): WptPreparedFixture[] {
  const versions = readWptVersions(root);
  verifiedWptSource(root, manifest.license.path, versions);
  const support = new Map<string, string>();
  for (const source of manifest.support) {
    assert.ok(!support.has(source.path), `duplicate WPT support path: ${source.path}`);
    support.set(source.path, verifiedWptSource(root, source.path, versions).toString("utf8"));
  }
  const prepared: { context: WptFixtureContext; entries: ScriptEntry[]; imports: ScriptEntry[] }[] = [];
  for (const fixture of manifest.fixtures) {
    const bytes = verifiedWptSource(root, fixture.path, versions);
    assert.ok(fixture.format === "javascript" || fixture.format === "html", "unknown WPT fixture format");
    const source = fixtureText(bytes, fixture.format);
    const meta = metadata(source, fixture.format);
    assert.ok(fixture.variant === undefined || meta.variants.includes(fixture.variant), "fixture variant is not declared by WPT");
    assert.ok(Number.isSafeInteger(fixture.expectedTests) && fixture.expectedTests >= 0, "invalid WPT registration count");
    const origin = new URL((typeof options.baseURL === "function" ? options.baseURL(fixture) : options.baseURL) ?? resolutionRoot);
    assert.ok(origin.protocol === "http:" || origin.protocol === "https:", "WPT base URL must be HTTP or HTTPS");
    const url = new URL("/" + fixture.path + (fixture.variant ?? ""), origin);
    const context = { fixture, metadata: meta, url, timeoutMilliseconds: timeoutFor(fixture, meta, options) };
    prepared.push({ context, ...scriptEntries(fixture, source, context, support) });
  }
  return prepared.map(({ context, entries, imports }) => {
    const prepare = (entry: ScriptEntry): WptPreparedScript => {
      const transformed = options.transformScript === undefined || harnessPaths.has(entry.url.pathname)
        ? entry.source
        : options.transformScript(entry.source, { path: entry.path, kind: entry.kind, context, url: entry.url });
      assert.equal(typeof transformed, "string", "WPT script substitution must return text");
      return { path: entry.path, url: entry.url, source: transformed, lineOffset: entry.lineOffset };
    };
    return { context, scripts: entries.map(prepare), imports: imports.map(prepare) };
  });
}

export type WptEnvironmentFactory = (
  reportError: (error: unknown) => void, context: WptFixtureContext,
) => WptEnvironment | Promise<WptEnvironment>;

/** Execute one prepared fixture, including provider cleanup, for tests or a census. */
export async function executeWptFixture(
  prepared: WptPreparedFixture,
  createEnvironment: WptEnvironmentFactory,
): Promise<WptResult[]> {
  const { context, scripts, imports } = prepared;
  const { fixture } = context;
  let harness: WptHarness | undefined;
  const startupErrors: unknown[] = [];
  const environment = await createEnvironment((error) => {
    if (harness === undefined) startupErrors.push(error);
    else harness.reportError(error);
  }, context);
  try {
    const globals = { ...environment.globals };
    let imported = 0;
    if (fixture.importScripts !== undefined) {
      assert.ok(!Object.hasOwn(globals, "importScripts"), "environment must not replace the verified importScripts loader");
      globals.importScripts = (...references: unknown[]): void => {
        for (const reference of references) {
          assert.equal(typeof reference, "string", "importScripts URL must match its literal declaration");
          const expected = imports[imported];
          assert.ok(expected !== undefined, "undeclared importScripts request");
          assert.equal(referenceURL(reference as string, context.url).href, expected.url.href,
            "importScripts request changed from its verified declaration");
          imported++;
          harness!.run(expected.source, expected.path);
        }
      };
    }
    harness = new WptHarness(globals, fixture.blockedTests, context.timeoutMilliseconds, {
      exposeSelf: environment.exposeSelf, globalAliases: environment.globalAliases,
    });
    for (const error of startupErrors) harness.reportError(error);
    for (const script of scripts) harness.run(script.source, script.path, script.lineOffset);
    const results = await harness.finish();
    assert.equal(imported, imports.length, "declared importScripts dependency was not loaded");
    return results;
  } finally {
    await environment.close();
  }
}

/** Run an area manifest with only the globals supplied by its source provider. */
export async function runWptFixtures(
  suite: TestContext,
  root: URL,
  manifest: WptManifest,
  createEnvironment: WptEnvironmentFactory,
  options: WptRunnerOptions = {},
): Promise<void> {
  for (const prepared of loadWptFixtures(root, manifest, options)) {
    const { context } = prepared;
    const { fixture } = context;
    const name = fixture.path + (fixture.variant ?? "");
    await suite.test(name, async (file) => {
      const results = await executeWptFixture(prepared, createEnvironment);
      assert.equal(results.length, fixture.expectedTests, "WPT registration count changed");
      const counts = { pass: 0, fail: 0, blocked: 0 };
      for (const result of results) {
        counts[result.status]++;
        await file.test(result.name, { skip: result.reason }, () => {
          if (result.status === "fail") throw result.error;
        });
      }
      file.diagnostic(`WPT ${name}: ${counts.pass} pass, ${counts.fail} fail, ${counts.blocked} blocked`);
    });
  }
}
