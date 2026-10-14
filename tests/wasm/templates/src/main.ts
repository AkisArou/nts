// Tagged templates: one immortal object per source site, holding the cooked
// strings, shared by every call and every copy of the function. Wasm keeps it
// in a type of its own with a string array's layout, so no value of it is
// taken for a writable array.

function pieces(strings: TemplateStringsArray, ...values: number[]): string {
  let text = `${strings.length}:`;
  for (let i = 0; i < strings.length; i++) {
    text += `[${strings[i]}]`;
    if (i < values.length) text += `${values[i]}`;
  }
  return text;
}

function same(n: number): TemplateStringsArray {
  return keep`a${n}b`;
}

function keep(strings: TemplateStringsArray, ..._values: number[]): TemplateStringsArray {
  return strings;
}

function generic<T>(value: T): TemplateStringsArray {
  return keep`g${0}${String(value).length}`;
}

// The pieces, with an empty one at each end and an escape cooked.
export function cooked(n: number): string {
  return pieces`${n}mid\t${n + 1}` + pieces`plain` + pieces``;
}

// One site is one object, every call; two sites with equal text are two.
export function identity(n: number): number {
  const a = same(n);
  const b = same(n + 1);
  const c = keep`a${n}b`;
  return (a === b ? 1 : 0) + (a === c ? 2 : 0);
}

// A generic function's copies share the site's object.
export function acrossCopies(n: number): number {
  return generic(n) === generic("text") ? 1 + (n & 1) : 0;
}

const atModule = same(0);

// Held in a module global and in an array, then compared.
export function held(n: number): number {
  const all = [same(n), keep`other`];
  return (all[0] === atModule ? 1 : 0) + (all[1] === all[0] ? 2 : 0) + all.length * 10;
}

function open(n: number): unknown {
  return n > 2 ? same(n) : [String(n)];
}

// Through an open value: an object, an array, and still the site's.
export function erased(n: number): string {
  const value = open(n);
  return `${typeof value}|${Array.isArray(value)}|${value === atModule}`;
}

// As a Map key, by identity.
export function keyed(n: number): number {
  const seen = new Map<TemplateStringsArray, number>();
  seen.set(same(n), 1);
  seen.set(same(n + 1), (seen.get(same(n)) ?? 0) + 1);
  seen.set(keep`x`, 5);
  return seen.size * 10 + (seen.get(atModule) ?? 0);
}
