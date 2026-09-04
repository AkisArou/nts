// Our three comparison relations against node's, over random structures.
//
//   node tooling/conformance/fuzz-deep-equal.mjs [cases] [seed]
//
// `util.isDeepStrictEqual` and `assert.deepEqual` are the oracle. The
// generator builds pairs that are *usually* equal and occasionally differ in
// one place, because two random structures are almost never equal and a
// fuzzer that only ever produces `false` on both sides proves nothing.
//
// Kinds are drawn from a list that includes the ones with no own enumerable
// properties -- `WeakMap`, `Promise`, `WeakRef` -- because those are where a
// missing case does not fail, it falls through to the key walk and answers
// "equal" for two empty objects. That answer is well-formed, is right for a
// `WeakRef` and wrong for a `WeakMap`, and nothing at the point of the
// fall-through tells them apart.

import assert from "node:assert";
import { inspect, isDeepStrictEqual as nodeStrict } from "node:util";

const ROOT = new URL("../../", import.meta.url).pathname;
await import(`${ROOT}runtime/node/util/bindings.node.mjs`);
const ours = await import(`${ROOT}runtime/node/util/src/deep-equal.ts`);

const CASES = Number(process.argv[2] ?? 30_000);
const SEED = Number(process.argv[3] ?? 1);

/** A small deterministic generator, so a failure can be replayed by seed. */
function makeRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const random = makeRandom(SEED);
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;

const PRIMITIVES = [
  0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity,
  "", "a", "ab", "é", "😀",
  true, false, null, undefined, 1n, -1n,
  Symbol.iterator, Symbol.asyncIterator,
];

/** The kinds whose identity does not live in their own properties. */
const OPAQUE = [
  () => new WeakMap(),
  () => new WeakSet(),
  () => new WeakRef(globalThis),
  () => Promise.resolve(1),
];

/**
 * One value, and a copy of it that is structurally equal.
 *
 * Both halves are built together rather than the second copied, so that a
 * comparison cannot succeed by identity where it should succeed by structure.
 */
function build(depth) {
  if (depth <= 0 || chance(0.35)) {
    const v = pick(PRIMITIVES);
    return [v, v];
  }
  switch (Math.floor(random() * 10)) {
    case 0: {
      const n = Math.floor(random() * 4);
      const a = [];
      const b = [];
      for (let i = 0; i < n; i++) {
        const [x, y] = build(depth - 1);
        a.push(x);
        b.push(y);
      }
      return [a, b];
    }
    case 1: {
      const a = {};
      const b = {};
      const n = Math.floor(random() * 4);
      for (let i = 0; i < n; i++) {
        const key = chance(0.15) ? Symbol.for(`s${i}`) : `k${i}`;
        const [x, y] = build(depth - 1);
        a[key] = x;
        b[key] = y;
      }
      return [a, b];
    }
    case 2: {
      const a = new Map();
      const b = new Map();
      const n = Math.floor(random() * 3);
      for (let i = 0; i < n; i++) {
        const [k1, k2] = build(depth - 1);
        const [v1, v2] = build(depth - 1);
        a.set(k1, v1);
        b.set(k2, v2);
      }
      return [a, b];
    }
    case 3: {
      const n = Math.floor(random() * 3);
      const a = new Set();
      const b = new Set();
      for (let i = 0; i < n; i++) {
        const [x, y] = build(depth - 1);
        a.add(x);
        b.add(y);
      }
      return [a, b];
    }
    case 4: {
      const t = Math.floor(random() * 1e12);
      return [new Date(t), new Date(t)];
    }
    case 5: {
      const src = pick(["a", "b.", "^x$"]);
      const flags = pick(["", "g", "i", "gi"]);
      return [new RegExp(src, flags), new RegExp(src, flags)];
    }
    case 6: {
      const bytes = Array.from({ length: Math.floor(random() * 5) }, () =>
        Math.floor(random() * 256));
      const Ctor = pick([Uint8Array, Int8Array, Uint16Array, Float64Array]);
      return [new Ctor(bytes), new Ctor(bytes)];
    }
    case 7: {
      const message = pick(["", "boom", "x"]);
      return [new Error(message), new Error(message)];
    }
    case 8: {
      const make = pick(OPAQUE);
      return [make(), make()];
    }
    default: {
      const wrapped = pick([1, "a", true]);
      return [Object(wrapped), Object(wrapped)];
    }
  }
}

/** Change one thing, somewhere, so the pair is no longer equal. */
function perturb(value) {
  if (Array.isArray(value) && value.length > 0) {
    const copy = value.slice();
    copy[Math.floor(random() * copy.length)] = pick(PRIMITIVES);
    return copy;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > 0) {
      const copy = { ...value };
      copy[pick(keys)] = pick(PRIMITIVES);
      return copy;
    }
  }
  return pick(PRIMITIVES);
}

const nodeLoose = (a, b) => {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

const RELATIONS = [
  ["strict", nodeStrict, ours.isDeepStrictEqual],
  ["loose", nodeLoose, ours.isDeepEqual],
];

let agree = 0;
const differ = [];

for (let i = 0; i < CASES && differ.length < 10; i++) {
  let [a, b] = build(3);
  // A quarter of the pairs are made unequal, so the comparison has to decide
  // rather than always answering the same way.
  if (chance(0.25)) b = perturb(b);

  for (const [mode, theirs, mine] of RELATIONS) {
    let want;
    let got;
    try {
      want = theirs(a, b);
    } catch (e) {
      want = `threw ${e.constructor.name}`;
    }
    try {
      got = mine(a, b);
    } catch (e) {
      got = `threw ${e.constructor.name}`;
    }
    if (want === got) {
      agree++;
    } else {
      differ.push({ mode, want, got, a, b });
    }
  }
}

const total = agree + differ.length;
console.log(`${agree} agree, ${differ.length} differ, of ${total} comparisons (seed ${SEED})`);
for (const { mode, want, got, a, b } of differ) {
  console.log(`  ${mode}: node ${want}, ours ${got}`);
  console.log(`    a = ${inspectShort(a)}`);
  console.log(`    b = ${inspectShort(b)}`);
}
process.exitCode = differ.length > 0 ? 1 : 0;

function inspectShort(value) {
  try {
    const text = inspect(value, { depth: 4, breakLength: Infinity });
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  } catch {
    return String(value);
  }
}
