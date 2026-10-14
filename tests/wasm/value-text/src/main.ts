// `String(v)` of an erased value and of a boolean: each erased tag prints by
// name (`undefined`, `null`, `true`, `false`), a number by
// `Number.prototype.toString`, a string as itself. An object prints as its
// class says ("[object Object]", or its own `toString`); an object literal's
// own `toString` is refused by name. `typeof` spells each tag, including an
// object's and a function's.
const values: unknown[] = [undefined, null, true, false, 0, -0, 1.5, NaN, -Infinity, 1e21, "text", ""];

export function count(): number {
  return values.length;
}

export function concatenated(i: number): string {
  return "<" + values[i] + ">";
}

export function converted(i: number): string {
  return String(values[i]);
}

export function aBoolean(n: number): string {
  return String(n > 0);
}

const kinds: unknown[] = [undefined, null, true, 1, "s", { kind: 1 }, (x: number): number => x];

export function kindCount(): number {
  return kinds.length;
}

export function kindOf(i: number): string {
  return typeof kinds[i];
}

export function anObject(n: number): string {
  const object: unknown = { n };
  return "" + object;
}

/** An object literal's own `toString` is not callable through its type, so
 * the core refuses how it prints. */
export function anObjectWithItsOwnText(n: number): string {
  const object: unknown = { n, toString: (): string => "own" };
  return "" + object;
}

class Plain {}
class Labelled {
  constructor(readonly label: string) {}
  toString(): string {
    return `L:${this.label}`;
  }
}

const dictionary: Record<string, number> = { a: 1 };
const empty: number[] = [];

// Arrays print their elements joined by commas (`null` and `undefined`
// empty, nested arrays and objects as they print), typed arrays theirs, and
// the runtime's objects their class tag.
const containers: unknown[] = [
  [1, 2.5, -0],
  ["a", "", "c"],
  [true, false],
  [[1, [2, 3]], "s", null, undefined],
  [new Plain(), new Labelled("x")],
  empty,
  [10n, -3n],
  new Map<number, number>([[1, 2]]),
  new Set<string>(["a"]),
  dictionary,
  Promise.resolve(1),
  new Uint8Array([1, 2, 255]),
  new Float64Array([0.5, -1]),
  new ArrayBuffer(4),
  new DataView(new ArrayBuffer(2)),
];

export function containerCount(): number {
  return containers.length;
}

export function containerText(i: number): string {
  return String(containers[i]);
}

export function containerInTemplate(i: number): string {
  return `<${containers[i]}>`;
}

/** An array met again inside its own join prints as empty, as node's join does. */
export function selfJoined(n: number): string {
  const a: unknown[] = [n];
  a.push(a);
  return String(a);
}

export function nestedCycle(n: number): string {
  const a: unknown[] = [];
  const b: unknown[] = [n, a];
  a.push(b);
  return String(a) + "|" + String(b);
}

/** One array held twice, and not inside itself, prints twice. */
export function sharedNotCyclic(n: number): string {
  const inner: unknown[] = [n];
  const outer: unknown = [inner, inner];
  return String(outer);
}

/** Arrays nested `depth` deep: node prints any depth; past 64, C and Wasm
 * refuse by name. */
export function nestedDeep(depth: number): string {
  let value: unknown = 1;
  for (let i = 0; i < depth; i++) value = [value];
  return String(value);
}
