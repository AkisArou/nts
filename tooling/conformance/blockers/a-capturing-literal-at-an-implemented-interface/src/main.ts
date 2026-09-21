// expect: NTS1001 `base`, a name from an enclosing scope

// A capturing object literal at an interface that a **class implements**.
//
// `Hierarchy::stored` lays a type's method out as a field holding a closure
// when a literal of the type supplies it with an environment --- and it
// declines to for a type anything but a literal can be. This is that guard,
// and what it prevents: `Fixed` has a dispatch table and no field, so a
// `Fixed` read through a `Reader` layout with `read` as a field would be a
// `FieldGet` at an index that means something else in the class. The literal
// keeps the refusal it has always had, and `Fixed` keeps working.
//
// `implements` is the only way this compiler admits a class as an interface
// today; a class that satisfies `Reader` structurally without the clause is
// refused at the coercion, which `blockers/a-class-in-an-interface-typed-array`
// holds for the array entrances. So "nothing but a literal can be this type"
// is a question `Hierarchy::implements` can answer, and does.
//
// A `FIXED` here means dispatch landed for literals: each literal its own
// class implementing the interface, and the call site choosing by receiver.
// That is the route `blockers/two-literals-at-one-interface` describes.

interface Reader {
  read(): number;
}

class Fixed implements Reader {
  read(): number {
    return 5;
  }
}

/** The control: the class through the interface, which must keep working. */
export function throughTheClass(n: number): number {
  const f: Reader = new Fixed();
  return f.read() + (n - n);
}

/** The literal, which captures and stays refused while `Fixed` exists. */
export function throughTheLiteral(n: number): number {
  const base = n * 2;
  const r: Reader = {
    read(): number {
      return base + 1;
    },
  };
  return r.read();
}
