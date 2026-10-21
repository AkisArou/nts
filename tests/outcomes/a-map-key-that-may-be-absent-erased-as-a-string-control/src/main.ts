// run: check
//
// The control for a-map-key-that-may-be-absent-erased-as-a-string: the same
// maps keyed by `string`, each absence spelled as a string of its own
// ("<undefined>", "<null>") beside the string that names it. Nothing erased
// may be absent, so nothing claims otherwise, and every backend agrees.

export function undefinedKeys(seed: number): number {
  const keys = new Map<string, number>();
  keys.set("<undefined>", 1);
  keys.set("undefined", 2);
  const pick: string = (seed | 0) % 2 === 0 ? "<undefined>" : "undef" + "ined";
  keys.set(pick, (keys.get(pick) ?? 0) + 10);
  return keys.size * 1000 + (keys.get("<undefined>") ?? 0) * 100 + (keys.get("undefined") ?? 0);
}

export function nullKeys(seed: number): number {
  const keys = new Map<string, number>();
  keys.set("<null>", 1);
  keys.set("null", 2);
  const pick: string = (seed | 0) % 2 === 0 ? "<null>" : "nu" + "ll";
  keys.set(pick, (keys.get(pick) ?? 0) + 10);
  return keys.size * 1000 + (keys.get("<null>") ?? 0) * 100 + (keys.get("null") ?? 0);
}
