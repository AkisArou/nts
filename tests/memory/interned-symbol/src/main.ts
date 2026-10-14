// What a symbol costs: one cell, and nothing else.
//
// No description string when none is given, no registry entry, no table. A
// symbol's identity is its address, so there is nothing to intern and nothing
// to hash unless the program asks for it — `Symbol()` is an allocation and a
// header, and this case is the statement that it is only that.
//
// Seventeen made and seventeen discarded. Each is compared against the one
// before it, so none is dead and none escapes.

export function work(n: number): number {
  let total = 0;
  let previous: symbol = Symbol();
  for (let i = 0; i < 16 + n; i++) {
    const made: symbol = Symbol();
    // Always false — two symbols are never equal — and the comparison is what
    // keeps both alive to the end of the iteration.
    total = total + (made === previous ? 1 : 0);
    previous = made;
  }
  return total;
}
