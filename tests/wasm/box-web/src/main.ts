// The helper boundaries keep core from folding the number/erasure roundtrip.
// Wasm inlining puts the numeric box, copies, tests and projections together.
function carry(value: unknown): unknown { return value; }
function kind(value: unknown): boolean { return typeof value === "number"; }
function read(value: unknown): number { return typeof value === "number" ? value : 0; }

export function numeric(value: number): number {
  const carried = carry(value);
  return kind(carried) ? read(carried) : 0;
}
export function numericControl(value: number): number { return value; }

// Seeds 2^30-1 and -2^30-1 cross between i31 and heap boxes in the SAME web,
// on consecutive iterations. Neither representation alone licenses the fold.
export function edge(seed: number): number {
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const carried = carry(seed + i);
    total += (kind(carried) ? 1 : 0) + read(carried);
  }
  return total;
}
export function edgeControl(seed: number): number {
  let total = 0;
  for (let i = 0; i < 2; i++) total += 1 + (seed + i);
  return total;
}

// A reference store escapes the web and must retain the box.
export function escaping(value: number): number {
  const values: unknown[] = [];
  const carried = carry(value);
  values.push(carried);
  return read(values[0]);
}
export function escapingControl(value: number): number { return value; }

// Mixed number/string values and their non-number arm stay references.
export function mixed(value: number): number {
  const carried = carry(value < 0 ? "text" : value);
  return typeof carried === "number" ? read(carried) : String(carried).length;
}
export function mixedControl(value: number): number { return value < 0 ? 4 : value; }
