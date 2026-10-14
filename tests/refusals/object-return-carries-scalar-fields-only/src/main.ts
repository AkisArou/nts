// expect: emit-c --napi -> emits-addon napi_set_named_property(env, exports, "fNumber"
//
// **An object crosses outward only if every field is a scalar.** Nine
// functions returning a one-field object, differing in nothing but that field:
//
//     { v: number }        ok        { v: number[] }    returns an object
//     { v: string }        ok        { v: string[] }    returns an object
//     { v: boolean }       ok        { v: Uint8Array }  returns an object
//                                    { v: Inner }       returns an object
//                                    { v?: number }     returns an object
//                                    { v: Inner|null }  refused before the wrapper
//
// The three that cross are the controls. They say the object machinery works,
// so the six declines are field *kinds* rather than objects being
// unsupported -- and they all give the same message, `returns an object`, which
// names the return and not the field that stopped it.
//
// **No nesting.** `{ v: Inner }` where `Inner` is `{ a: number }` declines, so
// the rule is flat-scalar and not scalars-all-the-way-down.
//
// **What it costs, concretely.** `os.userInfo` answers
//
//     { uid, gid, username: Buffer, homedir: Buffer, shell: Buffer | null }
//
// so it cannot cross even after its two lowering refusals are fixed -- three of
// its five fields are views and one is a nullable object. `os` is the module
// closest to green at 17 of node's 23 names, and `userInfo` is one of the six
// missing.
//
// This is the third face of the same boundary. The other two are
// `array-return-only-carries-numbers` (outward: `number[]` only) and
// `parameter-boundary-carries-four-types` (inward: four scalars plus
// `number[]`). An object is the one thing that crosses out and not in, and its
// fields are narrower than the boundary either way.
//
// # The control this fixture did not have, and what it hid
//
// `Shape`/`Square`/`Circle` below are here for one reason: **they put a
// dispatch slot in the program.** Neither is returned, neither crosses, and
// nothing above them mentions them.
//
// `Layout::methods` is one entry per *dispatch slot in the whole program*, with
// `None` where a layout does not implement that slot -- so the moment any
// program has dispatch, every layout in it gets a table, and a five-string
// record's is `[None, None, None, None, None, None]`. The wrapper's test for
// "this is a class and copying it would lose behaviour" was
// `!methods.is_empty()`, which that satisfies.
//
// So an object return was refused by **dispatch existing anywhere in the
// program**. `path.parse` -- five strings, no methods, nothing unusual -- was
// declined because `path` has six dispatch slots somewhere else in it, and that
// single refusal was 26 of the 54 remaining divergences in `path`'s edge table.
//
// Nine functions, six declines, three controls, and not one of them could see
// it, because a fixture written to test object returns had no reason to declare
// a class. Removing these three declarations puts the blind spot back.


// # What it costs, measured
//
// A class instance is an object return too, and a class whose members are all
// **methods** has no scalar field to carry -- so a function returning one is
// declined outright rather than flattened.
//
//     async_hooks/src/main.ts:158   createHook(callbacks): AsyncHook
//     no wrapper for createHook: returns an object
//
// `AsyncHook` holds one private field of an interface type and its surface is
// `enable` and `disable`. Reduced both ways: a returned class with a private
// field of an interface type, and one with a method and no fields at all, both
// give `returns an object`. A returned class with a public scalar field
// publishes, which is the rule above doing exactly what it says.
//
// Against the compiled `async_hooks` addon: 115 failing test files, **54 of
// them stopping at `async_hooks.createHook is not a function`**.
//
// So the rule is not only about how much of an object crosses. For a factory of
// a behavioural object it decides whether the function exists at all, and that
// is a different-shaped cost from a field being dropped.

interface Inner {
  a: number;
}

// Controls. These three are what say the machinery exists.
export function fNumber(): { v: number } {
  return { v: 1 };
}
export function fString(): { v: string } {
  return { v: "a" };
}
export function fBool(): { v: boolean } {
  return { v: true };
}

export function fNumbers(): { v: number[] } {
  return { v: [1] };
}
export function fStrings(): { v: string[] } {
  return { v: ["a"] };
}
export function fView(): { v: Uint8Array } {
  return { v: new Uint8Array(1) };
}
export function fObject(): { v: Inner } {
  return { v: { a: 1 } };
}
export function fOptional(): { v?: number } {
  return { v: 1 };
}


// The control. A dispatched method, so the program has a slot table -- which is
// what every layout in it then carries a row of, `None` in every column it does
// not implement. Nothing here crosses the boundary; the point is only that the
// program is not slot-free, which is what every real module is and what this
// fixture was not.
abstract class Shape {
  abstract area(): number;
}

class Square extends Shape {
  private side: number;
  constructor(side: number) {
    super();
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}

class Circle extends Shape {
  private radius: number;
  constructor(radius: number) {
    super();
    this.radius = radius;
  }
  area(): number {
    return this.radius * this.radius * 3;
  }
}

export function areaOfBoth(n: number): number {
  const square: Shape = new Square(n);
  const circle: Shape = new Circle(n);
  return square.area() + circle.area();
}
