import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { Build, Comparator, Json } from "./run-record.ts";
export const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
export type Pins = {
  builds: Record<Comparator, Build | null>;
  bun: string | null;
  scriptc: { root: string; command: string; argvPrefix: boolean } | null;
  declaration: Json;
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  const o = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(o).sort(), keys.sort(), "unknown or missing comparator pin field");
  return o;
}
function text(value: unknown): string {
  assert.ok(typeof value === "string" && value.length > 0);
  return value;
}
function within(root: string, value: unknown): string {
  const path = resolve(root, text(value)),
    r = relative(root, path);
  assert.ok(r !== ".." && !r.startsWith("../") && !isAbsolute(r), "comparator path escapes cache");
  return path;
}
function verify(path: string, digest: unknown): void {
  assert.match(text(digest), /^[a-f0-9]{64}$/);
  assert.equal(sha256(path), digest, "comparator pin checksum mismatch: " + path);
}
export function pinnedComparators(
  root: string,
  cache = process.env.NTS_BENCH_COMPARATOR_CACHE ?? join(homedir(), ".cache/nts-comparators"),
): Pins {
  const raw: unknown = JSON.parse(
      readFileSync(join(root, "tooling/bench/comparators.json"), "utf8"),
    ),
    p = object(raw, ["version", "node", "bun", "scriptc"]);
  assert.equal(p.version, 1);
  assert.equal(process.version, p.node, "benchmark node version differs from declared pin");
  const b = object(p.bun, ["version", "commit", "webkitCommit", "path", "sha256"]),
    s = object(p.scriptc, [
      "version",
      "commit",
      "directory",
      "command",
      "files",
      "nodeIslands",
      "argvPrefix",
    ]);
  assert.equal(s.nodeIslands, "off");
  assert.equal(typeof s.argvPrefix, "boolean");
  const bun = within(cache, b.path),
    scroot = within(cache, s.directory),
    sccommand = within(scroot, s.command);
  let available = true;
  assert.ok(Array.isArray(s.files) && s.files.length > 0);
  for (const file of s.files) {
    const f = object(file, ["path", "sha256"]),
      path = within(scroot, f.path);
    if (existsSync(path)) verify(path, f.sha256);
    else available = false;
  }
  if (existsSync(bun)) verify(bun, b.sha256);
  const build: Build = {
    version: text(b.version),
    commit: text(b.commit),
    sha256: text(b.sha256),
    command: [bun],
  };
  return {
    builds: {
      node: {
        version: process.version,
        commit: null,
        sha256: sha256(process.execPath),
        command: [process.execPath],
      },
      "Bun JIT": build,
      "Bun AOT": { ...build, command: [bun, "build", "--compile", "--aot"] },
      ScriptC: {
        version: text(s.version),
        commit: text(s.commit),
        sha256: (s.files as { sha256: string }[])[0].sha256,
        command: [
          process.execPath,
          sccommand,
          "build",
          "--node-islands=off",
          "--optimization=release",
          "--target-cpu=native",
        ],
      },
    },
    bun: existsSync(bun) ? bun : null,
    scriptc: available
      ? { root: scroot, command: sccommand, argvPrefix: s.argvPrefix as boolean }
      : null,
    declaration: raw as Json,
  };
}
