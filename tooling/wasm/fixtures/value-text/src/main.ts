// `String(v)` of an erased value and of a boolean: each erased tag prints by
// name (`undefined`, `null`, `true`, `false`), a number by
// `Number.prototype.toString`, a string as itself. An object prints as its
// type says, which the Wasm backend does not record yet, so it is refused by
// name rather than answered "[object Object]". `typeof` spells each tag,
// including an object's and a function's.
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
