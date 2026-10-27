import { test } from "node:test";
import { spawnTest } from "./test-wait.ts";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

// Decision D2 (docs/foundations/unicode.md): nts's Unicode tables move
// in lockstep with the pinned node's version. This test reads node's
// version and each backend's effective one -- behaviourally, through
// signature letters whose case mappings arrived in a known release --
// and fails where they differ. A signature is a letter that only
// lowercases from some release on: U+A7CB arrived in 16.0, U+A7CE in
// 17.0 (it has no entry at all in 16.0 data). When node moves to a
// release with no signature here, this test fails by name until one is
// added, which is the point: the pin cannot drift silently.

const ROOT = join(import.meta.dirname, "..", "..");
const bin = process.env.NTS_BIN ?? join(ROOT, "target/nts-dev/nts");

const SIGNATURES = [
  { version: "16.0", upper: 0xa7cb, lower: 0x0264 },
  { version: "17.0", upper: 0xa7ce, lower: 0xa7cf },
];

function probeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "nts-unicode-version-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "ES2022", module: "NodeNext" },
    include: ["src"],
  }));
  const fns = SIGNATURES.map(({ version, upper }) =>
    `export function since${version.replace(".", "_")}(seed: number): number {\n` +
    `  return (String.fromCodePoint(${upper}).toLowerCase().codePointAt(0) ?? 0) + ((seed | 0) & 1);\n}`);
  writeFileSync(join(dir, "src/main.ts"), fns.join("\n"));
  return dir;
}

function identifierProbeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "nts-unicode-identifier-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "ES2022", module: "NodeNext" },
    include: ["src"],
  }));
  // A signature letter is any newest inducted ID_Start letter.
  const { upper } = SIGNATURES[SIGNATURES.length - 1]!;
  const latest = String.fromCodePoint(upper);
  writeFileSync(join(dir, "src/main.ts"), `
const ${latest}value = 7;

export function probe(seed: number): number {
  return ${latest}value + ((seed | 0) & 1);
}
`);
  return dir;
}

function agrees(backend: string, dir = probeProject()): boolean {
  try {
    // spawnTest's hang guard throws on expiry: a killed or signalled run is
    // "not measured" with that reason, never a disagreement.
    const ran = spawnTest(bin, ["check", dir], {
      encoding: "utf8",
      env: { ...process.env, NTS_BACKEND: backend, NTS_CHECKERS: "1" },
    }, `nts check (${backend})`);
    if (ran.error || ran.signal) {
      throw new Error(`not measured: nts check (${backend}) ended by ${ran.signal ?? ran.error?.message}`);
    }
    return ran.status === 0 && `${ran.stdout}${ran.stderr}`.includes("agreed on every case");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the signatures cover the pinned node's Unicode version", () => {
  const nodeUnicode = process.versions.unicode;
  assert.ok(
    SIGNATURES.some(({ version }) => version === nodeUnicode),
    `node reports Unicode ${nodeUnicode} and no signature letter pins it; ` +
    "add the release's newest case-mapped letter to SIGNATURES",
  );
});

test("native case tables are at the pinned node's Unicode version", () => {
  assert.ok(existsSync(bin), `build nts or set NTS_BIN before running this test: ${bin}`);
  assert.ok(agrees("c"), "native (C) case mappings lag node's Unicode version");
  assert.ok(agrees("llvm"), "native (LLVM) case mappings lag node's Unicode version");
});

test(
  "frontend identifier tables are at the pinned node's Unicode version",
  { todo: "the native checker knows identifiers by Unicode 15.1, so a name starting with a newer letter such as U+A7CB is TS1127 here where node accepts it (docs/foundations/unicode.md). The identifier tables are upstream's, so this is reported upstream, not edited here." },
  () => {
    assert.ok(existsSync(bin), `build nts or set NTS_BIN before running this test: ${bin}`);
    assert.ok(agrees("c", identifierProbeProject()), "frontend identifier tables lag node's Unicode version");
  },
);

test(
  "JVM case tables are at the pinned node's Unicode version",
  { todo: "JDK 21's tables are Unicode 15.0 and node's are 17.0; the JVM answers through the JDK until stage 1 generates its tables from compiler/unicode (docs/foundations/unicode.md). Signature letters reproduce in tests/outcomes/a-unicode-16-letter-lowercased-on-the-jvm and a-unicode-17-letter-lowercased-on-the-jvm." },
  () => {
    assert.ok(existsSync(bin), `build nts or set NTS_BIN before running this test: ${bin}`);
    assert.ok(agrees("jvm"), "JVM case mappings lag node's Unicode version");
  },
);
