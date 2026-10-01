/** Imported, and nothing in this file uses `run`. That is the precondition. */
export class Thrower {
  run(key: string, maybe: number | null): void {
    void maybe;
    if (key !== "a") {
      throw new Error("no " + key);
    }
  }
}

/** **Control.** A plain exported function, which gets a raising copy. */
export function raise(key: string, maybe: number | null): number {
  void maybe;
  if (key !== "a") {
    throw new Error("no " + key);
  }
  return key.length;
}
