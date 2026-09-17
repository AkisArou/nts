// A literal takes its shape from the slot it is being written into.
//
// Some literals decide nothing on their own. `[]` has element type `never`;
// `{ a: 1 }` has exactly the field it wrote, which is not the same type as an
// interface that also declares an optional one. Both need the slot to say what
// they are, and a compiler that lowers them at their *own* type and converts
// afterwards has to make a cast that was never necessary — an array of one
// element type is not a pointer to an array of another, so the conversion is
// refused and the program is refused with it.
//
// `lower_module_binding` has always lowered a deferred initializer *expecting*
// the global's type, and a call argument is lowered at its parameter's. A
// **local** declaration and a **return** did neither, so the same source
// compiled at module scope and refused inside a function:
//
//     const xs: Opts[] = [{ a: 1 }];                    // module scope: fine
//     function f() { const xs: Opts[] = [{ a: 1 }]; }   // refused
//
// Which is one fact with more than one derivation, and the two disagreed
// exactly where an optional property makes the literal's own type a different
// shape from the slot's.
//
// The controls below are the positions that already lowered: a call argument, a
// module-scope const, an element already typed as the slot wants. They are here
// because a fix that made the broken positions work by relaxing the
// *conversion* instead would have passed everything and given up a cast this
// compiler refuses on purpose.
//
// **Two of those controls were silently wrong, which is how this was found.**
// `throughACallArgument` and `fromModuleScope` compiled on every binary before
// this and answered 2 where node answers 105: the object literals inside the
// array were built at their own one-field types and stored into an array of a
// two-field one, so the reader took field 1 off an object that has no field 1.
// Nothing refused, so no refusal census could see it and every static check
// said the program was fine. They are controls that *failed*, and the reason
// they had never been noticed is that nobody had run them.
//
// # Slots this still refuses, named rather than left silent
//
// Four slots now build the value at the type they hold — a local declaration,
// a `return`, an object literal's property, and an array literal's element.
// Three do not, and they **refuse** rather than answer wrongly:
//
//     let xs: Opts[] = []; xs = [{ a: 1 }];      assignment to a variable
//     box.xs = [{ a: 1 }];                       assignment to a field
//     class Box { xs: Opts[] = [{ a: 1 }]; }     a field initializer
//
// Each needs the type of a `Place`, which `coerce_to_slot` computes on its way
// to coercing and does not expose. That is one extraction, not three, and it is
// deliberately not in this change: a refusal is an honest boundary and the half
// that was giving wrong answers is the half worth closing first.

interface Opts {
  a: number;
  b?: number;
}

interface Named {
  id: number;
  label?: string;
}

interface Row {
  cells: Opts[];
  tag?: number;
}

const atModuleScope: Opts[] = [{ a: 1 }];

/** The shape that refused: a local `const` whose annotation is the only thing
 *  that knows what the elements are. */
export function localConst(n: number): number {
  const xs: Opts[] = [{ a: n }, { a: 2, b: 3 }];
  return xs[0].a + (xs[0].b ?? 100) + xs[1].a + (xs[1].b ?? 200);
}

/** The same, at a `return`. A different slot and the same fact. */
export function returned(n: number): number {
  return make(n)[0].a + (make(n)[0].b ?? 100);
}

function make(n: number): Opts[] {
  return [{ a: n }];
}

/** The optional is supplied by some elements and not others, so the presence
 *  bit has to differ per element rather than per type. */
export function mixedPresence(n: number): number {
  const xs: Opts[] = [{ a: 1, b: n }, { a: 2 }, { a: 3, b: 4 }];
  let total = 0;
  for (const o of xs) {
    total += o.a * 10 + (o.b ?? 9);
  }
  return total;
}

/** An optional of a *reference* type, where absence is a null pointer rather
 *  than a tag beside a double. */
export function optionalString(n: number): string {
  const xs: Named[] = [{ id: n }, { id: 2, label: "two" }];
  return (xs[0].label ?? "none") + (xs[1].label ?? "none");
}

/** Nested: an array of objects holding an array of objects, so the slot's type
 *  has to reach two levels down. */
export function nested(n: number): number {
  const rows: Row[] = [{ cells: [{ a: n }] }, { cells: [{ a: 2, b: 3 }], tag: 7 }];
  return rows[0].cells[0].a + (rows[0].tag ?? 5) + rows[1].cells[0].a + (rows[1].tag ?? 5);
}

/** Control: a **call argument**, which was already lowered at its parameter's
 *  type and must still be. */
export function throughACallArgument(n: number): number {
  return takes([{ a: n }, { a: 2, b: 3 }]);
}

function takes(xs: Opts[]): number {
  return xs[0].a + (xs[0].b ?? 100) + xs[1].a;
}

/** Control: **module scope**, which is the derivation the other two were made
 *  to agree with. */
export function fromModuleScope(n: number): number {
  return atModuleScope[0].a + (atModuleScope[0].b ?? 50) + n;
}

/** Control: the element is already of the slot's type, so nothing has to be
 *  decided from context. This lowered before and after. */
export function alreadyTyped(n: number): number {
  const one: Opts = { a: n, b: 1 };
  const xs: Opts[] = [one];
  return xs[0].a + (xs[0].b ?? 0);
}

/** Control: an empty literal, whose element type the annotation has always
 *  supplied through its own path. */
export function emptyThenFilled(n: number): number {
  const xs: Opts[] = [];
  xs.push({ a: n });
  return xs[0].a + (xs[0].b ?? 11);
}

/** Control: the plain case with no optional property at all, where the
 *  literal's own type and the slot's are the same shape and the old path
 *  happened to be right. */
export function noOptionalAtAll(n: number): number {
  const xs: { a: number; b: number }[] = [{ a: n, b: 1 }];
  return xs[0].a + xs[0].b;
}
