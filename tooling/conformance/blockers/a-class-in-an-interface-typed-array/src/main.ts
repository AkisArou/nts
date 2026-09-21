// expect: NTS1001 a `Thing` where a `Named` is wanted

// A class instance stored into an **interface-typed array**, at three
// entrances: the literal, `push`, and an indexed store.
//
// `coerce` refuses a `Thing` where a `Named` is wanted at a parameter, and
// says why: `Thing.name` is at one offset and `Named.name` at another, so a
// pointer cast between the two structs reads `id` --- a `double` --- as the
// string pointer. The three entrances here lowered the value *expecting* the
// element type and stored it with no question asked.
//
// **Measured 2026-09-22, on the binary before the fix as well:** SIGSEGV where
// node answers 3, at every one of the three. Not a refusal that became a
// crash --- a crash that was already there, reached by a program nothing had
// refused. It surfaced while `Hierarchy::stored` was being built, because a
// type whose method is a *field* is one more shape a class can disagree with
// about offsets, and the array was the one slot that never asked.
//
// All three go through `coerce` now, and this file holds that they refuse.
//
// # What the corpus lost to it, and the feature behind that
//
// Two sites in `runtime/web-platform` refuse now that were stored unasked:
// `cache/store.ts` pushes a `MemoryEntry` onto an `HttpCacheEntry[]`, where
// `interface MemoryEntry extends HttpCacheEntry { sequence: number }`. That
// reads as an upcast and is not one here. `nts layouts` on the module:
//
//     HttpCacheEntry   body, url, method, …, responseTime
//     MemoryEntry      sequence, url, method, …, responseTime, body
//
// An interface's layout is its **own** members first and the flattened
// inherited ones after, so field 0 is a pointer in one and a `double` in the
// other, and `entry.body` read through the base layout read `sequence`'s
// bits as a pointer. A class is laid out base-first precisely so that an
// upcast is a no-op; an interface that `extends` is not, and that is the
// feature this refusal now points at: lay an extending interface out
// base-first, and the push above becomes the prefix case `coerce` admits.
// The control is `examples/an-object-literal-method-that-captures`
// (`passedAndHeld`), where the element is the right shape and the array
// lowers --- and, in the same example, a subclass in a base-typed array,
// which is the prefix case the check admits.

interface Named {
  name: string;
}

class Thing {
  id: number = 5;
  name: string = "x";
}

export function inTheLiteral(n: number): number {
  const lit: Named = { name: "ab" };
  const held: Named[] = [lit, new Thing()];
  let sum = n - n;
  for (const r of held) {
    sum += r.name.length;
  }
  return sum;
}

export function pushed(n: number): number {
  const held: Named[] = [{ name: "ab" }];
  held.push(new Thing());
  let sum = n - n;
  for (const r of held) {
    sum += r.name.length;
  }
  return sum;
}

export function stored(n: number): number {
  const held: Named[] = [{ name: "ab" }, { name: "c" }];
  held[1] = new Thing();
  let sum = n - n;
  for (const r of held) {
    sum += r.name.length;
  }
  return sum;
}
