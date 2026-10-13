// An open value made a number, by every kind it can hold; `Number(bigint)`;
// `Array.isArray` of an open value; and the number and string services the
// host answers with node's own methods.

function open(value: unknown): unknown {
  return value;
}

type Scalar = number | string | boolean | null | undefined;

function pick(v: number): Scalar {
  switch ((v | 0) & 7) {
    case 0: return v;
    case 1: return v > 2;
    case 2: return " 0x1F ";
    case 3: return null;
    case 4: return undefined;
    case 5: return "12.5e1";
    case 6: return "";
    default: return "not a number";
  }
}

export function incremented(v: number): number {
  let value: Scalar = pick(v);
  // @ts-expect-error -- JavaScript converts; TypeScript will not step a union
  value++;
  return value as number;
}

export function decremented(v: number): number {
  let value: Scalar = pick(v + 1);
  // @ts-expect-error -- as above
  --value;
  return value as number;
}

export function bigintExplicitly(v: number): number {
  return Number(open(BigInt(v | 0) * 3n) as bigint);
}

export function isArray(v: number): number {
  const values: unknown[] = [[1, 2], new Uint8Array(2), { length: 2 }, "ab", v, ["x"]];
  let found = 0;
  for (let i = 0; i < values.length; i++) {
    if (Array.isArray(values[i])) found += 1 << i;
  }
  return found;
}

export function radix(v: number): string {
  const r = ((v | 0) & 31) + 2;
  return `${(v * 1000.75).toString(r)}|${(255).toString(16)}|${(-v).toString(2)}`;
}

export function fixed(v: number): string {
  return `${v.toFixed(2)}|${(v / 3).toFixed(0)}|${(1.005).toFixed(2)}`;
}

export function strings(v: number): string {
  const text = "Ünïcode ß " + (v | 0);
  return `${text.toUpperCase()}|${text.toLowerCase()}|${"ab".repeat((v | 0) & 3)}|${text.at(-1)}|${text.at(-100) ?? "none"}|${"😀x".codePointAt(0)}|${"😀x".codePointAt(9) ?? -1}`;
}

// Number.isFinite, isInteger and isSafeInteger over the edges: NaN, both
// infinities, -0, a fraction, and either side of 2^53.
export function numberTests(v: number): string {
  const values = [v, v / 0, -v / 0, v * 0.5, -0 * v, 2 ** 53 + v, 2 ** 53 - 1 + v, 0.1 + v];
  let text = "";
  for (const x of values) {
    text += `${Number.isFinite(x) ? 1 : 0}${Number.isInteger(x) ? 1 : 0}${Number.isSafeInteger(x) ? 1 : 0},`;
  }
  return text;
}

// A heterogeneous tuple is laid out as a struct, and the language calls it an
// Array: isArray of it through an open slot is true. Beside it, an object of
// the same field types, which is not.
export function openTuple(v: number): string {
  const pair: [number, string] = [v, "a"];
  const record = { first: v, second: "a" };
  const opens: unknown[] = [pair, record, [v, v]];
  let text = "";
  for (const open of opens) {
    text += Array.isArray(open) ? "1" : "0";
  }
  return text;
}
