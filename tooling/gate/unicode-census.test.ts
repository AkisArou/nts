import { test } from "node:test";
import { spawnTest } from "./test-wait.ts";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

// The whole code-point range, converted by the compiled runtime and by
// node, must agree exactly (docs/foundations/unicode.md, stage 1). The
// version-pin test samples signature letters; this is the census behind
// it: chunked whole-string conversion in both directions over every code
// point, folded into one digest per side. Chunking (rather than one
// character per call) is deliberate: Final_Sigma's context, surrogate
// decoding and lone-surrogate adjacency are exercised as they occur in
// real strings, and both sides convert the identical chunks.

const ROOT = join(import.meta.dirname, "..", "..");
const bin = process.env.NTS_BIN ?? join(ROOT, "target/nts-dev/nts");
const CHUNK = 1024;

const PROBE = `
function digest(s: string, h: number): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

let h = 0x811c9dc5 | 0;
for (let start = 0; start <= 0x10ffff; start += ${CHUNK}) {
  let s = "";
  const end = Math.min(start + ${CHUNK}, 0x110000);
  for (let cp = start; cp < end; cp++) s += String.fromCodePoint(cp);
  h = digest(s.toLowerCase(), h);
  h = digest(s.toUpperCase(), h);
}
// Sigma frames: the sequential pass never puts a sigma in final position
// (its code-point neighbours are cased), so Final_Sigma and the Cased /
// Case_Ignorable tables behind it need their own pass -- every code point
// once as the skipped-or-counted character before a sigma and once after
// one, space-separated so each frame's context is its own.
for (let start = 0; start <= 0x10ffff; start += 256) {
  let s = "";
  const end = Math.min(start + 256, 0x110000);
  for (let cp = start; cp < end; cp++) {
    const c = String.fromCodePoint(cp);
    s += "\\u0391" + c + "\\u03A3 \\u0391\\u03A3" + c + " ";
  }
  h = digest(s.toLowerCase(), h);
}
console.log((h >>> 0).toString(16));
`;

function nodeDigest(): string {
  const digest = (s: string, h: number): number => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h;
  };
  let h = 0x811c9dc5 | 0;
  for (let start = 0; start <= 0x10ffff; start += CHUNK) {
    let s = "";
    const end = Math.min(start + CHUNK, 0x110000);
    for (let cp = start; cp < end; cp++) s += String.fromCodePoint(cp);
    h = digest(s.toLowerCase(), h);
    h = digest(s.toUpperCase(), h);
  }
  for (let start = 0; start <= 0x10ffff; start += 256) {
    let s = "";
    const end = Math.min(start + 256, 0x110000);
    for (let cp = start; cp < end; cp++) {
      const c = String.fromCodePoint(cp);
      s += "\u0391" + c + "\u03A3 \u0391\u03A3" + c + " ";
    }
    h = digest(s.toLowerCase(), h);
  }
  return (h >>> 0).toString(16);
}

function run(command: string, args: string[], cwd: string, what: string): string {
  const ran = spawnTest(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NTS_CHECKERS: "1" },
  }, what);
  if (ran.error || ran.signal) {
    throw new Error(`not measured: ${what} ended by ${ran.signal ?? ran.error?.message}`);
  }
  assert.equal(ran.status, 0, `${what} failed:\n${ran.stdout}\n${ran.stderr}`);
  return `${ran.stdout}`.trim();
}

test("case conversion agrees with node over every code point", () => {
  assert.ok(existsSync(bin), `build nts or set NTS_BIN before running this test: ${bin}`);
  const dir = mkdtempSync(join(tmpdir(), "nts-unicode-census-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        strict: true,
        noEmit: true,
      },
      include: ["src"],
    }));
    writeFileSync(join(dir, "src/main.ts"), PROBE);
    const out = join(dir, "out");
    run(bin, ["emit-c", join(dir, "tsconfig.json"), "--out", out, "--rc", "--main"], dir, "nts emit-c (census probe)");
    // Every .c the emitter wrote, not a fixed list (the same rule
    // tooling/memory/run.sh states), so a new support file cannot be
    // silently left off the link.
    const sources = readdirSync(out).filter((name) => name.endsWith(".c")).sort()
      .map((name) => join(out, name));
    run("clang", ["-std=c11", "-O2", "-DNTS_PROVIDER_RC", `-I${out}`, ...sources, "-luv", "-lm", "-o", join(out, "run")], dir, "clang (census probe)");
    const got = run(join(out, "run"), [], dir, "census probe");
    assert.equal(got, nodeDigest(),
      "compiled case conversion differs from node somewhere in 0..0x10FFFF; " +
      "the model in compiler/unicode and node's tables have drifted (D2)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
