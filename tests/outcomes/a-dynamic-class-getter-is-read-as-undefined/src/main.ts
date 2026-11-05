// run: check
// A dynamic getter read gives a wrong answer versus node.
// C sanitizer checking build: exits early with a signal in the map lookup.
// JVM: ClassCastException abort.
// dynamicRead and typedRead differ only in how the same property is read.
// The typed receiver is the one-difference control for the erased receiver.

class Entry {
  #value: number;
  constructor(n: number) { this.#value = n; }
  static #check(value: unknown): void {
    if (value === null || typeof value !== "object" || !true) throw new Error("bad");
  }
  get blocked(): number { Entry.#check(this); return this.#value; }
  get ready(): number { return this.#value + 1; }
}
class Child extends Entry { get detail(): number { return 2; } }
export function dynamicRead(n: number): string {
  const value = new Child(n);
  const key = n % 2 === 0 ? "blocked" : "ready";
  return String((value as unknown as Record<string, unknown>)[key]);
}

export function typedRead(n: number): string {
  const value = new Child(n);
  const key = n % 2 === 0 ? "blocked" : "ready";
  return String(key === "blocked" ? value.blocked : value.ready);
}
