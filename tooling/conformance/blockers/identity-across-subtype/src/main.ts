// expect: emit-c --napi -> fails-to-compile pointer cannot be cast to type 'double'
//
// **The expectation names a clang error, not a string in `program.c`.** It said
// `emits-c <text>` and that is a substring match: a fragment taken from broken
// output can also occur in correct output, and this one did. It reported
// `reproduces` after the defect was fixed, and would have gone on doing so.
//
// `===` between a subtype reference and a supertype reference is emitted as a
// **numeric** comparison of two pointers:
//
//     v22 = (double)v11;     // NtsObj_Extended *
//     v23 = (double)v1;      // NtsObj_Base *
//     v12 = v22 == v23;
//     error: pointer cannot be cast to type 'double'
//
// Nothing is refused. The two operands have different C struct types, so they
// cannot be compared as pointers directly, and the emitter reaches for the
// numeric path instead of casting either side to a common one. `===` on two
// references is address equality, which is exactly what a cast to a shared base
// pointer would give.
//
// **It is the identity form of `blockers/upcast-to-base`**, which is the
// assignment form. Both come from C not treating a derived struct as its base
// even when it begins with one; one appears at `=`, the other at `===`. They are
// separate fixtures because a fix for one need not be a fix for the other -- the
// assignment needs a cast on the right, the comparison needs a common type for
// both sides.
//
// Traced from `assert`, which cannot compile and where this is 2 of its 20 clang
// errors. The site is `MemoryHttpCacheStore.touch` in web-platform's cache
// store: `interface MemoryEntry extends HttpCacheEntry`, and `candidate ===
// entry` compares the two. That is ordinary TypeScript and there is no other way
// to write a linear scan for an identity.

interface Base {
  readonly url: string;
}

interface Extended extends Base {
  sequence: number;
}

class Store {
  entries: Extended[] = [];

  touch(entry: Base): number {
    for (let i = 0; i < this.entries.length; i++) {
      const candidate = this.entries[i];
      if (candidate === entry) {
        candidate.sequence = i;
        return i;
      }
    }
    return -1;
  }
}

export function touch(): number {
  const s = new Store();
  s.entries.push({ url: "a", sequence: 0 });
  return s.touch({ url: "a" });
}
