// `sort()` over a string array with null slots, against node. In a
// `(string | null)[]` a null sorts as the text "null", stably: a stored `null`
// and the string "null" keep their order. In a `(string | undefined)[]`, the
// control, the slot is `undefined`, which sorts last and is never compared.

function showNulls(xs: (string | null)[]): string {
  let out = "";
  for (const x of xs) out += (x === null ? "<null>" : x) + ",";
  return out;
}

function showUndefineds(xs: (string | undefined)[]): string {
  let out = "";
  for (const x of xs) out += (x === undefined ? "<undefined>" : x) + ",";
  return out;
}

const words = ["nulls", "a", "null", "nul", "", "z", "nullz", "N", "~"];

function nulls(at: number): (string | null)[] {
  const xs: (string | null)[] = [];
  const n = words.length;
  for (let i = 0; i < n + 3; i++) {
    xs.push(i % 4 === ((at | 0) & 7) % 4 ? null : words[(i + ((at | 0) & 7)) % n]!);
  }
  return xs;
}

export function nullsSortAsTheirText(at: number): string {
  return showNulls(nulls(at).sort());
}

export function aStoredNullAndTheStringKeepTheirOrder(at: number): string {
  const xs: (string | null)[] =
    ((at | 0) & 7) % 2 === 0 ? ["null", null, "b", null, "null"] : [null, "null", "a", "null", null];
  return showNulls(xs.sort());
}

export function undefinedsSortLast(at: number): string {
  const xs: (string | undefined)[] = [];
  const n = words.length;
  for (let i = 0; i < n + 3; i++) {
    xs.push(i % 4 === ((at | 0) & 7) % 4 ? undefined : words[(i + ((at | 0) & 7)) % n]!);
  }
  return showUndefineds(xs.sort());
}

export function allNull(at: number): string {
  const xs: (string | null)[] = [null, null, null];
  if (((at | 0) & 7) % 2 === 0) xs.push("m");
  return showNulls(xs.sort());
}

export function allUndefined(at: number): string {
  const xs: (string | undefined)[] = [undefined, undefined, "q"];
  if (((at | 0) & 7) % 2 === 0) xs.push("b");
  return showUndefineds(xs.sort());
}
