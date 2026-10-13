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
