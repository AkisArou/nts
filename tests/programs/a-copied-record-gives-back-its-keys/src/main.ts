// A record whose keys were built at run time, copied (`{ ...o }`), extended
// (`Object.assign`) and enumerated (`Object.keys`, `for...in`), gives back
// every count it took. Under reference counting each of those kept one count
// of every key and value it walked: the runtime's walks read entries through
// `nts_map_key_at` / `nts_map_value_at`, the program's readers, which hand
// back an owned count, and then stored them through something that retains
// its own (`nts_map_set`, an array slot). 68 objects were never given back in
// this program, and the `rc` and `llvm-rc` steps went red on main the day
// `tests/programs/a-function-that-can-fall-off-its-end` first enumerated keys
// it had built.
//
// The control is `literalKeys`: the same walks over keys written as literals,
// which are immortal, so a count too many on one is invisible -- which is how
// this hid.

function built(n: number): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < n % 3; i++) o[`k${i}`] = `v${i}`;
  return o;
}

/** `{ ...o }`: a copy. */
export function spread(n: number): number {
  const copy: Record<string, string> = { ...built(n) };
  return Object.keys(copy).length;
}

/** `Object.assign`: an extension. */
export function assigned(n: number): number {
  const target: Record<string, string> = {};
  Object.assign(target, built(n));
  return Object.keys(target).length;
}

/** `for...in` over built keys. */
export function enumerated(n: number): number {
  let total = 0;
  for (const key in built(n)) total += key.length;
  return total;
}

/** Control: the same walks over literal keys. */
export function literalKeys(n: number): number {
  const o: Record<string, string> = { a: "x", b: "y" };
  const copy: Record<string, string> = { ...o };
  Object.assign(copy, o);
  let total = 0;
  for (const key in copy) total += key.length;
  return total + Object.keys(o).length + n * 0;
}
