// An object literal at a **method-signature** interface, whose method reads
// the locals of the function that built it.
//
//     interface Reader { read(): number }
//     const r: Reader = { read() { return base + 1; } };
//
// `read()` is a table method and a table method has no environment, so `base`
// was refused as *a name from an enclosing scope* --- 35 sites in `runtime/`,
// one idiom: a literal standing in for an interface. And the two spellings
// that looked like a way around it,
//
//     { read: () => base + 1 }          a property the type does not declare
//     { read: function () { … } }       a property the type does not declare
//
// refused too, because the interface declares `read` as a method and a method
// has no *slot* for a value to go in. At `interface Reader { read: () => number }`
// every spelling worked, which was the measurement that sized this: a named
// type holding a capturing closure in a field already lowered and ran. What
// was missing was one decision, not a representation.
//
// # The decision, and why it is the type's
//
// `fields_of` lays out a member when `is_stored()`, and a `METHOD_SIGNATURE`
// is not. `Hierarchy::stored` is the exception: the methods of a type that
// **some literal of the type supplies with an environment** --- a capturing
// body, or any value at all --- are laid out as the field holding the closure,
// and `lower_object_method` finds the field before it asks the table.
//
// It has to be decided per *type* and before the first layout is built. One
// layout serves every value of a type, so `read` cannot be storage in one
// literal and a table entry in another; `collect_stored_members` answers "does
// any literal of this type give this member an environment" over the whole
// program, in `collect_hierarchy`, and every literal of the type then fills
// the slot --- including one whose method captures nothing.
//
// # What it deliberately leaves on the table
//
//   * A single literal whose method captures nothing:
//     `examples/a-method-on-an-object-literal` is the control, and its
//     function list is unchanged.
//   * A method reading `this`. It binds its own, the way a `function` does,
//     and a closure cannot be it. One such literal at a type settles the type
//     on the table, and a capturing literal beside it keeps today's refusal.
//     `blockers/two-literals-at-one-interface` is that shape.
//   * A type anything but a literal can be --- a class implementing it, an
//     interface extending it or extended by it. A class instance read through
//     a layout with a field where the class has a slot is a `FieldGet` at an
//     index that means something else, so such a type keeps its refusal.
//
// # An instantiation has no table, so its literals are stored
//
// `Box<number>` is its own type id and the hierarchy registers only the
// declaration's, so a literal's method there was *a method with no
// declaration in the hierarchy* --- capturing or not, on both binaries. A
// slot needs neither a table nor a per-instantiation function name, so every
// literal method at an instantiation is stored, and `Box<number>` and
// `Box<string>` are two layouts rather than one name. (`generic`, below.)
//
// # A method written for a declared slot
//
// `interface Sink { write?: Callback }` declares storage, and a literal that
// writes `write(chunk) { … }` for it was emitting a `Sink#write` function
// and refusing on the first captured name --- the stream sinks and sources in
// `runtime/web-platform` are all this shape. The slot exists and the method
// is collected, so it is the closure that goes in; `literal_member_is_storage`
// is the one question both the literal and the member walk ask.
// (`fieldMethod`, `optionalFieldMethod`, below.)
//
// # Two entrances that had no guard, closed on the way
//
// The structural case above is refused by `coerce` at a parameter, and it was
// not at an array element: `[lit, new Thing()]`, `held.push(new Thing())` and
// `held[1] = new Thing()` all stored a `Thing` at `Named`'s representation
// unasked, and reading `name` through it read `id` --- a `double` --- as a
// string pointer. **SIGSEGV where node answers 3**, on the binary before this
// change as well. All three go through `coerce` now; the refusing shapes are
// in `blockers/a-class-in-an-interface-typed-array`.

interface Reader {
  read(): number;
}

/** The corpus shape: a method shorthand closing over a local. */
export function adapter(n: number): number {
  const base = n * 2;
  const reader: Reader = {
    read(): number {
      return base + 1;
    },
  };
  return reader.read();
}

/** The arrow spelling at the same type, which refused as an undeclared property. */
export function arrowProperty(n: number): number {
  const base = n * 2;
  const reader: Reader = { read: (): number => base + 1 };
  return reader.read();
}

/** The `function` spelling. */
export function functionProperty(n: number): number {
  const base = n * 2;
  const reader: Reader = {
    read: function (): number {
      return base + 1;
    },
  };
  return reader.read();
}

/** A shorthand property holding a local closure. */
export function shorthand(n: number): number {
  const base = n * 2;
  const read = (): number => base + 1;
  const reader: Reader = { read };
  return reader.read();
}

// Two literals at one interface, one capturing and one not. The type's `read`
// is a field, so both are closures --- and there is no `Reader#read` for the
// second to collide with, which is what refused two plain literals before.
interface Source {
  next(): number;
}

export function mixed(n: number): number {
  const base = n * 2;
  const a: Source = {
    next(): number {
      return base;
    },
  };
  const b: Source = {
    next(): number {
      return 1;
    },
  };
  return a.next() + b.next();
}

interface Pair {
  left(): number;
}

/** Two plain literals at one interface, neither capturing. */
export function twoPlain(n: number): number {
  const a: Pair = {
    left(): number {
      return 1;
    },
  };
  const b: Pair = {
    left(): number {
      return 2;
    },
  };
  return a.left() + b.left() + (n - n);
}

/** An anonymous literal, whose type is its own. */
export function anonymous(n: number): number {
  const base = n * 2;
  const reader = {
    read(): number {
      return base + 1;
    },
  };
  return reader.read();
}

type Alias = {
  read(): number;
};

/** A type literal behind an alias declares the method the same way. */
export function aliased(n: number): number {
  const base = n * 2;
  const reader: Alias = {
    read(): number {
      return base + 1;
    },
  };
  return reader.read();
}

/** A capture by reference: the closure sees the write after it was built. */
export function byReference(n: number): number {
  let base = n;
  const reader: Reader = {
    read(): number {
      return base;
    },
  };
  base = base * 10;
  return reader.read();
}

function call(reader: Reader): number {
  return reader.read();
}

/** Passed as a parameter and held in an array: the field travels with it. */
export function passedAndHeld(n: number): number {
  const base = n * 2;
  const reader: Reader = {
    read(): number {
      return base + 1;
    },
  };
  const held: Reader[] = [reader];
  return call(reader) + call(held[0]);
}

/** A literal's method is an own property, whether a slot or a closure. */
export function enumerated(n: number): string {
  const base = n * 2;
  const reader: Reader = {
    read(): number {
      return base + 1;
    },
  };
  return `${Object.keys(reader).join(",")}:${String(reader.hasOwnProperty("read"))}:${reader.read()}`;
}

/** The closure is called through the interface from another function. */
export function throughAnother(n: number): number {
  const base = n + 1;
  const reader: Reader = {
    read(): number {
      return base * base;
    },
  };
  return call(reader);
}

interface Box<T> {
  get(): T;
}

/** Two instantiations of one generic interface, one capturing and one not. */
export function generic(n: number): number {
  const a: Box<number> = {
    get(): number {
      return n + 1;
    },
  };
  const b: Box<string> = {
    get(): string {
      return "ab";
    },
  };
  return a.get() + b.get().length;
}

interface Sink {
  write: (chunk: number) => number;
}

/** A method written for a field the type declares. */
export function fieldMethod(n: number): number {
  const base = n * 2;
  const sink: Sink = {
    write(chunk: number): number {
      return chunk + base;
    },
  };
  return sink.write(1);
}

interface OptionalSink {
  write?: (chunk: number) => number;
}

/** The same at an optional field, which is how a stream's sink declares it. */
export function optionalFieldMethod(n: number): number {
  const base = n * 2;
  const sink: OptionalSink = {
    write(chunk: number): number {
      return chunk + base;
    },
  };
  return sink.write ? sink.write(1) : 0;
}
