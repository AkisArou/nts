// expect: NTS1001 `hasOwnProperty` of a method the type declares as a signature

// `r.hasOwnProperty("read")` where `r` is typed as an interface whose `read`
// is a **method signature**.
//
// The answer is a fact about the *value*: an object literal's method is an own
// property (`true`), a class's is on the prototype (`false`), and a value
// typed `Reader` may be either. `lower_has_own_property` answers from the
// type, so it cannot know, and until 2026-09-22 it did not say so: the arm
// read `kind == Field` and answered `false` for every method --- which was
// right for a class and **wrong for every literal**, on named and anonymous
// types alike, measured against node on the binary before the change. A
// wrong answer with no diagnostic, since the day the function was written.
//
// Now: a field is `true`, a member the type lays out as storage is `true`
// (only a literal builds one), a member written in a literal is `true`, a
// member written in a class is `false`, and a signature is this refusal.
// `examples/an-object-literal-method-that-captures` (`enumerated`) guards the
// literal answer; `examples/a-method-on-an-object-literal` the class one.
//
// A `FIXED` here means the value carries enough to answer at run time ---
// which is what `in` does through the layout, and what a signature-typed
// receiver would need a tag for.

interface Reader {
  read(): number;
}

class Fixed implements Reader {
  read(): number {
    return 5;
  }
}

function pick(n: number): Reader {
  if (n > 0) {
    return new Fixed();
  }
  return {
    read(): number {
      return 1;
    },
  };
}

export function ownership(n: number): boolean {
  return pick(n).hasOwnProperty("read");
}
