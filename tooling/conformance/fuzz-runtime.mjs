// The machinery a generative differential needs, minus the grammar.
//
// `fuzz-expressions.mjs` was the first of these and carried all of it inline.
// `fuzz-statements.mjs` needs the same compile-run-compare loop over a
// different shape of program, and a second copy of two hundred lines is two
// derivations of "how do we build and run one of these" -- which is the failure
// this repository has written down more times than any other.
//
// So the parts that do not depend on what is being generated live here:
// the seeded rng, the fixture `tsconfig`, the node oracle, the compile-and-run
// verdict, and the bisecting batch runner. What each fuzzer keeps is its
// grammar and the way it assembles a program, because those are the things
// that differ.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "../..");
export const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
export const HARNESS = readFileSync(join(ROOT, "tooling/sweep/probe-harness.ts"), "utf8");

/** xorshift32: small, seeded, and the same sequence on every machine. */
export function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** The three pickers every grammar here wants, over one seeded stream. */
export function pickers(seed) {
  const next = rng(seed);
  return {
    next,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}

export const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      strict: true,
      noEmit: true,
    },
    include: ["src"],
  },
  null,
  2,
);

/**
 * How the oracle renders one value, and the only place that decides it.
 *
 * `-0` and `NaN` are spelled rather than stringified because the assertion side
 * has to test them differently: `sameValue` compares with `!==`, and both
 * `0 !== -0` and `NaN !== NaN` answer the wrong thing for an assertion. A
 * value this cannot render comes back `null`, and its case is dropped.
 */
export const PRINTER = `
const out = [];
function print(i, v) {
  if (typeof v === "number") {
    out.push(Number.isNaN(v) ? "NaN"
      : v === Infinity ? "Infinity"
      : v === -Infinity ? "-Infinity"
      : Object.is(v, -0) ? "-0"
      : String(v));
  } else if (typeof v === "string") {
    out.push(JSON.stringify(v));
  } else if (typeof v === "boolean") {
    out.push(String(v));
  } else {
    out.push(null);
  }
}
`;

/**
 * The assertion for one expected value, or null where there is nothing to
 * assert. Shared so that the two fuzzers cannot drift on what `-0` means.
 */
export function assertion(code, want, label) {
  if (want === null || want === undefined) return null;
  if (want === "-0") return `assert.sameValue(Object.is(${code}, -0), true, "${label}");`;
  if (want === "NaN") return `assert.sameValue(Number.isNaN(${code}), true, "${label}");`;
  return `assert.sameValue(${code}, ${want}, "${label}");`;
}

/**
 * Run a generated `.ts` file under node and return what it printed.
 *
 * `.ts` and `--experimental-strip-types`, the way `probe.sh` runs node: the
 * generated code carries annotations because the *compiled* side needs them
 * under `strict`, and a plain `.mjs` oracle is a syntax error on the first one.
 */
export function runOracle(dir, source) {
  const file = join(dir, "oracle.ts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, source);
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", file],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    if (process.env.NTS_FUZZ_DEBUG) console.error("oracle failed:", run.stderr);
    return null;
  }
  try {
    return JSON.parse(run.stdout.trim());
  } catch {
    if (process.env.NTS_FUZZ_DEBUG) {
      console.error("oracle unparseable:", run.stdout.slice(0, 400));
    }
    return null;
  }
}

/**
 * Compile and run one program.
 *
 * Returns a verdict rather than throwing, because every outcome short of
 * "it disagreed" is information the caller reports and does not fail on.
 */
export function compileAndRun(dir, source) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(dir, "src/main.ts"), source);
  rmSync(join(dir, "out"), { recursive: true, force: true });

  const emit = spawnSync(
    NTS,
    ["emit-c", join(dir, "tsconfig.json"), "--out", join(dir, "out"), "--main"],
    { encoding: "utf8", env: { ...process.env, NTS_NO_SNAPSHOT_CACHE: "1" } },
  );
  const err = `${emit.stderr ?? ""}`;
  if (/^thread '.*panicked at/m.test(err)) {
    return { kind: "panic", detail: (err.match(/panicked at[^\n]*/) ?? [""])[0] };
  }
  if (/^TS\d/m.test(err)) {
    return { kind: "typescript", detail: (err.match(/^TS\d+[^\n]*/m) ?? [""])[0] };
  }
  // **`invalid HIR` is its own verdict, not a `cc-failed`.** `emit-c` writes
  // nothing when the verifier rejects the program, so the C step then fails for
  // want of input --- and reporting that as "the C compiler refused" sends a
  // reader to `cc` for a bug in a lowering pass. It cost an hour once.
  const invalid = err.match(/invalid HIR: (\w+ \{[^}]*\})/);
  if (invalid) return { kind: "invalid-hir", detail: invalid[1] };
  const refusal = err.match(/NTS\d+ ([^\n]*?) is not supported/);
  if (refusal) return { kind: "refused", detail: refusal[1] };
  if (/NTS2\d{3}/.test(err)) {
    return { kind: "declined", detail: (err.match(/NTS2\d{3} [^\n]*/) ?? [""])[0] };
  }

  // **`cc`'s stderr is captured, because "it did not compile" has two very
  // different causes.** With `stdio: "ignore"` a `cc-failed` verdict carried no
  // detail at all, and a generative differential reports one as a finding --- so
  // a transient `No space left on device` on a 16G `/tmp` shared with a running
  // gate reads exactly like a compiler emitting invalid C. One did, on
  // 2026-09-21: a single case in 1,200 that compiled, linked and ran perfectly
  // when re-run on its own.
  //
  // The first error line goes into the verdict, so the two name themselves.
  const build = spawnSync(
    "cc",
    [
      "-std=c11", "-O2", "-I.",
      ...readdirSync(join(dir, "out")).filter((f) => f.endsWith(".c")),
      "-luv", "-lm", "-o", "program",
    ],
    { cwd: join(dir, "out"), encoding: "utf8" },
  );
  if (build.status !== 0) {
    const first = `${build.stderr ?? ""}`
      .split("\n")
      .find((line) => /error|No space|cannot open|fatal/i.test(line));
    const detail = (first ?? `exit ${build.status}`).trim().slice(0, 120);
    if (process.env.NTS_FUZZ_KEEP) {
      const kept = join(process.env.NTS_FUZZ_KEEP, `cc-failed-${Date.now()}.ts`);
      try {
        writeFileSync(kept, source);
        const log = execFileSync(
          "sh",
          ["-c", `cd ${join(dir, "out")} && cc -std=c11 -O2 -I. *.c -luv -lm -o program 2>&1 | head -5`],
          { encoding: "utf8" },
        );
        console.error(`kept ${kept}\n${log}`);
      } catch {}
    }
    return { kind: "cc-failed", detail };
  }

  const run = spawnSync(join(dir, "out/program"), [], { encoding: "utf8" });
  if (run.status === 0) return { kind: "agree", detail: "" };
  const message = `${run.stderr ?? ""}`.match(/uncaught \w+: (#[\w-]+)/);
  return { kind: "differ", detail: message ? message[1] : `exit ${run.status}` };
}

/** A fresh scratch directory for one fuzzer process. */
export function scratch(name) {
  const dir = join(process.env.TMPDIR ?? "/tmp", `nts-fuzz-${name}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
