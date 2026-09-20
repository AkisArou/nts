// Our compiled expression semantics against node's, over random expressions.
//
//   node tooling/conformance/fuzz-expressions.mjs [cases] [seed]
//
// # Why this exists
//
// The two fuzzers beside it -- `fuzz-deep-equal` and `fuzz-timer-order` -- test
// *runtime* behaviours. Nothing generates programs to test the thing this
// compiler actually is: an expression, lowered, emitted as C, and run.
//
// That matters because of what the other instruments cannot see. The test262
// census ranks **refusals**, so a construct that compiles and returns the wrong
// number is invisible to it -- it is a `strict-pass` that happens to fail an
// assertion, or worse, one that passes anyway. The gate compares `examples/`,
// which are programs a person thought to write. On 2026-09-20 five wrong
// answers were found in one night by hand-writing ten-line probes, one area at
// a time: object spread dropping a getter, six enumerations dropping one, a
// `var` loop head reading as zero from any function, a literal answering a
// slot's zero, and `Object.keys` of a class answering `[]`. Each took a guess
// about *where* to look.
//
// This removes the guess from one axis of it.
//
// # The oracle, and why it is the exit status
//
// `console.log` does not lower, so a compiled program cannot print its answer.
// What it can do is **throw**, which is what `tooling/sweep/probe.sh` already
// uses: node evaluates each expression and its value is baked into the emitted
// program as `assert.sameValue(expr, <literal>)`. Agreement is exit 0.
//
// Each assertion carries its own index as the message, so a failure names
// itself -- `nts: uncaught Test262Error: #37` -- and no bisection is needed to
// find which of forty expressions disagreed. Only the first failure in a batch
// is reported, which is why a disagreement re-runs that one expression alone
// before it is printed: an isolated repro is what a person needs, and a batch
// is only a way to pay for one `cc` invocation instead of forty.
//
// # What a refusal means here
//
// A refused batch is **not a failure** and is not counted as one. A generator
// that only produced constructs known to lower would be testing the subset
// someone already thought about, which is the same blindness this exists to
// remove. So refusals are counted, their messages are reported, and the batch
// is skipped -- the interesting output is `differ`, and `refused` is a map of
// where the generator wandered past what the compiler accepts.
//
// # Determinism
//
// Seeded, and the seed is printed. A fuzzer whose failures cannot be reproduced
// is a fuzzer nobody acts on.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const HARNESS = readFileSync(join(ROOT, "tooling/sweep/probe-harness.ts"), "utf8");

const CASES = Number(process.argv[2] ?? 400);
const SEED = Number(process.argv[3] ?? 1);
const BATCH = 40;

/** xorshift32: small, seeded, and the same sequence on every machine. */
function rng(seed) {
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

const next = rng(SEED);
const pick = (xs) => xs[Math.floor(next() * xs.length)];
const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));

/**
 * A number literal that is worth generating.
 *
 * Weighted towards the values that break things rather than uniformly over the
 * doubles: zero, the signed zero, the integer boundaries, and a fraction whose
 * decimal expansion is not exact.
 */
function numberLiteral() {
  return pick([
    "0",
    "-0",
    "1",
    "-1",
    "2",
    "3",
    "7",
    "10",
    "0.5",
    "0.1",
    "1.5",
    "-2.5",
    "100",
    "2147483647",
    "-2147483648",
    "4294967295",
    "9007199254740991",
    String(int(-50, 50)),
  ]);
}

const WORDS = ["", "a", "ab", "abc", "hello", "x y", "0", "10", " pad ", "ABC"];
const stringLiteral = () => JSON.stringify(pick(WORDS));

/** `depth` shrinks towards 0, which is what keeps an expression finite. */
function numberExpr(depth) {
  if (depth <= 0) return numberLiteral();
  const n = () => numberExpr(depth - 1);
  const s = () => stringExpr(depth - 1);
  return pick([
    () => numberLiteral(),
    () => `(${n()} + ${n()})`,
    () => `(${n()} - ${n()})`,
    () => `(${n()} * ${n()})`,
    () => `(${n()} / ${n()})`,
    () => `(${n()} % ${n()})`,
    // `-1 ** 2` is a SyntaxError in JavaScript --- a unary minus directly
    // before `**` must be parenthesised --- and the generator produces `-1`
    // as a literal, so the base is wrapped rather than trusted.
    () => `((${n()}) ** ${pick(["2", "3", "0"])})`,
    () => `(-(${n()}))`,
    () => `(${n()} | 0)`,
    () => `(${n()} & ${n()})`,
    () => `(${n()} ^ ${n()})`,
    () => `(${n()} << ${int(0, 5)})`,
    () => `(${n()} >> ${int(0, 5)})`,
    () => `(${n()} >>> ${int(0, 5)})`,
    () => `(~(${n()}))`,
    () => `Math.abs(${n()})`,
    () => `Math.floor(${n()})`,
    () => `Math.ceil(${n()})`,
    () => `Math.round(${n()})`,
    () => `Math.trunc(${n()})`,
    () => `Math.sign(${n()})`,
    () => `Math.min(${n()}, ${n()})`,
    () => `Math.max(${n()}, ${n()})`,
    () => `${s()}.length`,
    () => `${s()}.indexOf(${stringLiteral()})`,
    () => `${arrayExpr(depth - 1)}.length`,
    () => `(${boolExpr(depth - 1)} ? ${n()} : ${n()})`,
    () => `Number(${s()})`,
    // A member read off a literal, which is the seam six consumers were wrong
    // about on 2026-09-20. A getter here is a *call* that looks like a load.
    () => `({ k: ${n()} }).k`,
    () => `({ get k(): number { return ${n()}; } }).k`,
    () => `({ a: ${n()}, b: ${n()} }).b`,
    // A fixed three-element literal, indexed in range: an out-of-range read is
    // a known wrong answer (`[] as number[]` then `[0]` gives 0 where node
    // gives `undefined`) and generating it would report noise, not news.
    () => `[${n()}, ${n()}, ${n()}][${int(0, 2)}]`,
    () => `(${n()} ?? 0)`,
  ])();
}

function stringExpr(depth) {
  if (depth <= 0) return stringLiteral();
  const s = () => stringExpr(depth - 1);
  const n = () => numberExpr(depth - 1);
  return pick([
    () => stringLiteral(),
    () => `(${s()} + ${s()})`,
    () => `\`v=\${${n()}}\``,
    () => `${s()}.toUpperCase()`,
    () => `${s()}.toLowerCase()`,
    () => `${s()}.trim()`,
    () => `${s()}.slice(${int(-3, 3)})`,
    () => `${s()}.slice(${int(-3, 3)}, ${int(-3, 4)})`,
    () => `${s()}.substring(${int(0, 3)}, ${int(0, 4)})`,
    () => `${s()}.charAt(${int(0, 4)})`,
    () => `${s()}.repeat(${int(0, 3)})`,
    () => `${s()}.padStart(${int(0, 5)}, ${stringLiteral() || '"-"'})`,
    () => `${s()}.padEnd(${int(0, 5)}, "-")`,
    () => `${s()}.replace(${stringLiteral()}, ${stringLiteral()})`,
    () => `${s()}.concat(${s()})`,
    () => `String(${n()})`,
    () => `${arrayExpr(depth - 1)}.join(${stringLiteral()})`,
    () => `(${boolExpr(depth - 1)} ? ${s()} : ${s()})`,
    () => `({ k: ${s()} }).k`,
    () => `({ get k(): string { return ${s()}; } }).k`,
    () => `[${s()}, ${s()}][${int(0, 1)}]`,
    () => `(() => ${s()})()`,
  ])();
}

function boolExpr(depth) {
  if (depth <= 0) return pick(["true", "false"]);
  const n = () => numberExpr(depth - 1);
  const s = () => stringExpr(depth - 1);
  const b = () => boolExpr(depth - 1);
  return pick([
    () => pick(["true", "false"]),
    () => `(${n()} < ${n()})`,
    () => `(${n()} <= ${n()})`,
    () => `(${n()} > ${n()})`,
    () => `(${n()} >= ${n()})`,
    () => `(${n()} === ${n()})`,
    () => `(${n()} !== ${n()})`,
    () => `(${s()} === ${s()})`,
    () => `(${s()} < ${s()})`,
    () => `(${b()} && ${b()})`,
    () => `(${b()} || ${b()})`,
    () => `(!${b()})`,
    () => `${s()}.includes(${stringLiteral()})`,
    () => `${s()}.startsWith(${stringLiteral()})`,
    () => `${s()}.endsWith(${stringLiteral()})`,
    () => `Number.isInteger(${n()})`,
    () => `Number.isFinite(${n()})`,
    () => `Number.isNaN(${n()})`,
    () => `({ k: ${b()} }).k`,
    () => `${arrayExpr(depth - 1)}.includes(${numberExpr(0)})`,
    () => `${arrayExpr(depth - 1)}.some((v: number): boolean => v > ${int(-2, 2)})`,
    () => `${arrayExpr(depth - 1)}.every((v: number): boolean => v >= ${int(-2, 2)})`,
    () => `(${s()} in { a: 1 } ? true : false)`,
  ])();
}

/** Always `number[]`, so every consumer of one typechecks. */
function arrayExpr(depth) {
  const items = () =>
    Array.from({ length: int(0, 3) }, () => numberExpr(0)).join(", ");
  if (depth <= 0) return `[${items()}]`;
  const a = () => arrayExpr(depth - 1);
  return pick([
    () => `[${items()}]`,
    () => `${a()}.slice(${int(-2, 2)})`,
    () => `${a()}.concat(${a()})`,
    () => `${a()}.map((v: number): number => v ${pick(["+", "*", "-"])} ${int(1, 3)})`,
    () => `${a()}.filter((v: number): boolean => v ${pick([">", "<", ">=", "!=="])} ${int(-2, 2)})`,
  ])();
}

const KINDS = [
  ["number", (d) => numberExpr(d)],
  ["string", (d) => stringExpr(d)],
  ["boolean", (d) => boolExpr(d)],
];

/**
 * What node says each expression is, as a literal this program can paste.
 *
 * `undefined` for anything node itself threw on or that has no literal
 * spelling -- `NaN` and the infinities have none that survives a round trip
 * through `JSON.stringify`, so they are spelled out.
 */
function nodeAnswers(dir, exprs) {
  const lines = exprs.map(
    (e, i) => `try { print(${i}, ${e.code}); } catch { print(${i}, undefined); }`,
  );
  const src = `
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
${lines.join("\n")}
console.log(JSON.stringify(out));
`;
  // **`.ts` and `--experimental-strip-types`, the way `probe.sh` runs node.**
  // The generated callbacks carry annotations --- `(v: number): number => …`
  // --- because the *compiled* side needs them under `strict`, and a plain
  // `.mjs` oracle is a syntax error on the first one.
  const file = join(dir, "oracle.ts");
  writeFileSync(file, src);
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
 * One program holding every assertion in the batch.
 *
 * A `-0` is asserted through `Object.is`, because `sameValue` compares with
 * `!==` and `0 !== -0` is false -- an assertion that cannot fail is not an
 * assertion, and this generator produces `-0` often enough to matter.
 */
function program(exprs, expected) {
  const body = exprs
    .map((e, i) => {
      const want = expected[i];
      if (want === null) return null;
      if (want === "-0") {
        return `assert.sameValue(Object.is(${e.code}, -0), true, "#${i}");`;
      }
      if (want === "NaN") {
        return `assert.sameValue(Number.isNaN(${e.code}), true, "#${i}");`;
      }
      return `assert.sameValue(${e.code}, ${want}, "#${i}");`;
    })
    .filter(Boolean);
  return `${HARNESS}\n${body.join("\n")}\n`;
}

const TSCONFIG = JSON.stringify(
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
 * Compile and run one program.
 *
 * Returns a verdict rather than throwing, because every outcome short of
 * "it disagreed" is information this reports and does not fail on.
 */
function compileAndRun(dir, source) {
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
  const refusal = err.match(/NTS\d+ ([^\n]*?) is not supported/);
  if (refusal) return { kind: "refused", detail: refusal[1] };
  if (/NTS2\d{3}/.test(err)) {
    return { kind: "declined", detail: (err.match(/NTS2\d{3} [^\n]*/) ?? [""])[0] };
  }

  try {
    execFileSync(
      "cc",
      [
        "-std=c11", "-O2", "-I.",
        ...readdirSync(join(dir, "out")).filter((f) => f.endsWith(".c")),
        "-luv", "-lm", "-o", "program",
      ],
      { cwd: join(dir, "out"), stdio: "ignore" },
    );
  } catch {
    return { kind: "cc-failed", detail: "" };
  }

  const run = spawnSync(join(dir, "out/program"), [], { encoding: "utf8" });
  if (run.status === 0) return { kind: "agree", detail: "" };
  const message = `${run.stderr ?? ""}`.match(/uncaught \w+: (#\d+)/);
  return { kind: "differ", detail: message ? message[1] : `exit ${run.status}` };
}

const dir = join(process.env.TMPDIR ?? "/tmp", `nts-fuzz-expr-${process.pid}`);
mkdirSync(dir, { recursive: true });

const totals = { agree: 0, differ: 0, refused: 0, typescript: 0, panic: 0, other: 0 };
const refusals = new Map();
const found = [];

/**
 * Run a group, and split it when the compiler declines to build it.
 *
 * A batch exists to pay for one `cc` rather than forty. But a *random*
 * generator reaches constructs this compiler refuses all the time, and an
 * all-or-nothing batch means one refusal discards thirty-nine expressions that
 * would have compiled --- which is how the first run of this file reported
 * `0 agree, 40 refused` and measured almost nothing.
 *
 * So a refusal halves the group and tries again. A single expression that still
 * refuses is attributed to its own construct and dropped; everything beside it
 * is still measured. The cost is `log2(n)` extra builds on a refusal and none
 * at all on a clean batch.
 */
function measure(exprs, expected, depth = 0) {
  if (exprs.length === 0) return;
  const verdict = compileAndRun(join(dir, `g${depth}`), program(exprs, expected));

  if (verdict.kind === "agree") {
    totals.agree += exprs.length;
    return;
  }

  const splittable =
    exprs.length > 1 &&
    (verdict.kind === "refused" ||
      verdict.kind === "declined" ||
      verdict.kind === "typescript" ||
      verdict.kind === "cc-failed" ||
      verdict.kind === "panic");
  if (splittable) {
    const half = Math.floor(exprs.length / 2);
    measure(exprs.slice(0, half), expected.slice(0, half), depth + 1);
    measure(exprs.slice(half), expected.slice(half), depth + 1);
    return;
  }

  if (verdict.kind === "refused" || verdict.kind === "declined") {
    totals.refused += exprs.length;
    refusals.set(verdict.detail, (refusals.get(verdict.detail) ?? 0) + 1);
    return;
  }
  if (verdict.kind === "typescript") {
    totals.typescript += exprs.length;
    return;
  }
  if (verdict.kind === "cc-failed" || verdict.kind === "panic") {
    // **A single expression that panics or emits C that will not build is a
    // finding**, and a loud one: it is not a refusal, so nothing named it.
    totals.panic += exprs.length;
    found.push({ code: exprs[0].code, kind: verdict.kind, detail: verdict.detail });
    return;
  }
  if (verdict.kind !== "differ") {
    totals.other += exprs.length;
    return;
  }

  const index = Number((verdict.detail.match(/#(\d+)/) ?? [])[1]);
  if (Number.isNaN(index) || !exprs[index]) {
    totals.differ += 1;
    found.push({ code: "<unidentified>", kind: "differ", detail: verdict.detail });
    return;
  }
  totals.differ += 1;
  totals.agree += exprs.length - 1;
  found.push({
    code: exprs[index].code,
    expected: expected[index],
    kind: "differ",
    detail: verdict.detail,
  });
}

for (let at = 0; at < CASES; at += BATCH) {
  const exprs = [];
  for (let i = 0; i < Math.min(BATCH, CASES - at); i += 1) {
    const [, make] = pick(KINDS);
    exprs.push({ code: make(int(1, 3)) });
  }
  const expected = nodeAnswers(dir, exprs);
  if (expected === null) {
    totals.other += exprs.length;
    continue;
  }
  measure(exprs, expected);
}

rmSync(dir, { recursive: true, force: true });

const label = `${CASES} expression(s), seed ${SEED}`;
if (found.length === 0) {
  // **`other` is printed even when it is zero.** The first run of this file
  // reported `ok  0 agree, 0 differ` because every batch had fallen into a
  // bucket the summary did not mention, and a line that cannot say "nothing
  // ran" reads exactly like a line that says "nothing was wrong".
  // No leading tool name: `divergence.sh` prints one, and its summary picks the
  // line containing "agree," --- which read `fuzz-expressions ok fuzz-expressions
  // ok …` while this printed its own.
  console.log(
    `${label}: ${totals.agree} agree, 0 differ, ` +
      `${totals.refused} refused, ${totals.typescript} rejected by tsc, ` +
      `${totals.other} unusable`,
  );
} else {
  console.log(
    `${label}: ${totals.agree} agree, ${found.length} differ, ` +
      `${totals.refused} refused  <-- DIFFER`,
  );
  for (const f of found) {
    console.log(`  ${f.kind.padEnd(10)} ${f.code}`);
    if (f.expected !== undefined) console.log(`             node: ${f.expected}`);
  }
}
if (refusals.size > 0) {
  const top = [...refusals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  refused batches, by first reason:`);
  for (const [reason, n] of top) console.log(`    ${String(n).padStart(3)}  ${reason}`);
}

process.exitCode = found.length > 0 ? 1 : 0;
