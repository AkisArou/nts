// `typeof v === "number"` of an erased value is `tag.of(v) == number`, which
// the Wasm backend answers with the test an unerase to `number` makes -- an
// i31, or the number box -- rather than the whole tag (`tag_tests`); and
// `v === undefined`, `v === null` and `typeof v === "boolean"` read the tag
// field of the box those are. Each function asks it of a pool holding every
// kind an erased value can, against node. `kindOf` asks for the string tag
// too, so its tag is the whole tag: the control.

const pool: unknown[] = [
  0, 1, -7, 2.5, -0, NaN, Infinity, 2 ** 31, 2 ** 40, -(2 ** 30),
  "s", "", "7", { a: 1 }, [3], null, undefined, true, false,
];

function pick(i: number): unknown {
  return pool[Math.abs(i | 0) % pool.length];
}

export function isNumber(i: number): boolean {
  return typeof pick(i) === "number";
}

export function notNumber(i: number): boolean {
  return typeof pick(i) !== "number";
}

export function isUndefined(i: number): boolean {
  return pick(i) === undefined;
}

export function isNull(i: number): boolean {
  return pick(i) === null;
}

export function isNullish(i: number): boolean {
  return pick(i) == null;
}

export function isBoolean(i: number): boolean {
  return typeof pick(i) === "boolean";
}

export function kindOf(i: number): number {
  const v = pick(i);
  return typeof v === "number" ? 1 : typeof v === "string" ? 2 : 0;
}

// The shape that measured it (`uniform-callback-arguments`): closures typed
// over `any`, each admitting its arguments as numbers before using them.
export function callThrough(seed: number): number {
  const values: any[] = [seed, seed + 0.5, seed * 2 ** 32];
  const listeners: ((a: any, b: any) => number)[] = [
    (a: number, b: number): number => a + b,
    (a: number, b: number): number => a - b,
  ];
  let total = 0;
  for (let i = 0; i < 6; i++) {
    total += listeners[i & 1]!(values[i % 3], values[(i + 1) % 3]);
  }
  return total;
}

// The shape that measured the boxed tags (`uniform-callback-default`): a
// closure typed over `any` with a default parameter, which asks whether its
// argument is `undefined` before admitting it as a number.
export function callWithDefault(seed: number): number {
  const values: any[] = [seed, undefined, seed + 0.5];
  const listeners: ((a?: any) => number)[] = [
    (a: number = 7): number => a + 1,
    (a: number = -3): number => a * 2,
  ];
  let total = 0;
  for (let i = 0; i < 6; i++) total += listeners[i & 1]!(values[i % 3]);
  return total;
}
