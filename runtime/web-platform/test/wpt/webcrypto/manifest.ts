// Authored selection data only; upstream sources stay in their original paths.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { WptBlock } from "../harness.ts";
import type { WptFixture, WptManifest, WptSource } from "../runner.ts";

export interface WebCryptoManifest extends WptManifest {
  repository: string;
  metadata: WptSource[];
  excludedFixtures: { path: string; category: string; reason: string }[];
}

interface StoredFixture extends Omit<WptFixture, "blockedTests"> {
  blockedTestFiles?: string[];
  /** Retained only so the original, inline baseline checkout is reproducible. */
  blockedTests?: Record<string, WptBlock>;
}

interface StoredManifest extends Omit<WebCryptoManifest, "fixtures"> {
  fixtures: StoredFixture[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as Record<string, unknown>;
}

function fixturePath(path: unknown): asserts path is string {
  assert.ok(typeof path === "string" && path.startsWith("WebCryptoAPI/") &&
    !/[\\%?#]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
  "WebCrypto fixture paths must stay inside WebCryptoAPI/");
}

/** Expand the small metadata file and its ordered, per-fixture exclusion chunks. */
export function readWebCryptoManifest(area = new URL("./", import.meta.url)): WebCryptoManifest {
  const manifest = record(JSON.parse(readFileSync(new URL("manifest.json", area), "utf8")),
    "WebCrypto manifest must be an object") as unknown as StoredManifest;
  assert.ok(Array.isArray(manifest.fixtures), "WebCrypto fixtures must be an array");
  const fixturePaths = new Set<string>();
  const chunkPaths = new Set<string>();
  const fixtures = manifest.fixtures.map((fixture): WptFixture => {
    record(fixture, "WebCrypto fixture must be an object");
    fixturePath(fixture.path);
    assert.ok(!fixturePaths.has(fixture.path), `duplicate WebCrypto fixture: ${fixture.path}`);
    fixturePaths.add(fixture.path);
    const { blockedTests: inline, blockedTestFiles: references, ...metadata } = fixture;
    assert.ok((inline === undefined) !== (references === undefined),
      "A fixture must specify either inline exclusions or exclusion files");
    const blocks = new Map<string, WptBlock>();
    const add = (name: unknown, value: unknown): void => {
      assert.ok(typeof name === "string" && name !== "", "An exclusion must name its exact test");
      assert.ok(!blocks.has(name), `duplicate WebCrypto exclusion: ${name}`);
      const block = record(value, "WebCrypto exclusion must be an object");
      assert.deepEqual(Object.keys(block).sort(), ["category", "reason"], "Unknown WebCrypto exclusion fields");
      assert.ok(typeof block.category === "string" && block.category !== "", "An exclusion needs a category");
      assert.ok(typeof block.reason === "string" && block.reason !== "", "An exclusion needs a reason");
      blocks.set(name, { category: block.category, reason: block.reason });
    };
    if (inline !== undefined) {
      for (const [name, block] of Object.entries(record(inline, "Inline exclusions must be an object"))) add(name, block);
    } else {
      assert.ok(Array.isArray(references), "Exclusion file references must be an array");
      const prefix = "exclusions/" + fixture.path.slice("WebCryptoAPI/".length) + ".part-";
      for (const reference of references) {
        assert.ok(typeof reference === "string" && reference.startsWith(prefix) &&
          /^[0-9]{3}\.json$/.test(reference.slice(prefix.length)), "Exclusion file must belong to its fixture");
        assert.ok(!chunkPaths.has(reference), `duplicate WebCrypto exclusion file: ${reference}`);
        chunkPaths.add(reference);
        const text = readFileSync(new URL(reference, area), "utf8");
        assert.ok(Buffer.byteLength(text, "utf8") <= 50_000, "WebCrypto exclusion chunk exceeds 50,000 bytes");
        const chunk = record(JSON.parse(text), "WebCrypto exclusion chunk must be an object");
        assert.deepEqual(Object.keys(chunk).sort(), ["blockedTests", "fixture"], "Unknown exclusion chunk fields");
        assert.equal(chunk.fixture, fixture.path, "Exclusion chunk belongs to another fixture");
        assert.ok(Array.isArray(chunk.blockedTests), "Chunk exclusions must be an array");
        for (const value of chunk.blockedTests) {
          const row = record(value, "Chunk exclusion must be an object");
          assert.deepEqual(Object.keys(row).sort(), ["category", "name", "reason"], "Unknown chunk exclusion fields");
          add(row.name, { category: row.category, reason: row.reason });
        }
      }
    }
    return { ...metadata, blockedTests: Object.fromEntries(blocks) };
  });
  assert.ok(Array.isArray(manifest.excludedFixtures), "Excluded fixtures must be an array");
  for (const excluded of manifest.excludedFixtures) {
    record(excluded, "Excluded fixture must be an object");
    fixturePath(excluded.path);
    assert.ok(!fixturePaths.has(excluded.path), `duplicate WebCrypto fixture: ${excluded.path}`);
    fixturePaths.add(excluded.path);
  }
  return { ...manifest, fixtures };
}
