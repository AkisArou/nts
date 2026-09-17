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
// # Every slot, and the extraction that took the last three
//
// Nine positions now build the value at the type they hold: a module-scope
// initializer, a call argument, a local declaration, a `return`, an object
// literal's property, an array literal's element, a `push` argument, an
// assignment through any place, and a class field's initializer.
//
// The last three — assignment to a variable, to a field, and a field
// initializer — were one extraction rather than three fixes. `coerce_to_slot`
// computed the type of a `Place` on its way to coercing and did not expose it,
// so `slot_type` is that match with the coercion removed, asked twice: once
// before the value exists, to build it right, and once after, to convert what
// could not be. An array or view element is the one arm that is not shared,
// because it *narrows* rather than coerces — a `double` into a `uint8_t` slot
// is the language's modulo, not a C assignment — and that is a fact about the
// conversion, not about the type.
//
// Asking the place before lowering the value is also the order the evaluation
// rule already imposed: `xs[i()] = v()` evaluates the array, then the index,
// then the value, and JavaScript says so.

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

// Holding its final shape before the first case runs. `rc.sh` measures what is
// live after the first case against what is live at the end, and an empty
// module-scope array that is later assigned a one-element one reads as one
// object never given back — the same artefact, from the other end, that
// `examples/an-allocation-that-does-not-escape` was written around.
let reassigned: Opts[] = [{ a: 0 }];

/** A slot reached by **assignment** rather than by a declaration. */
export function assignedToAVariable(n: number): number {
  let xs: Opts[] = [];
  xs = [{ a: n }, { a: 2, b: 3 }];
  return xs[0].a + (xs[0].b ?? 40) + xs[1].a + (xs[1].b ?? 50);
}

/** Assignment to a **field**, whose type the layout declares. */
export function assignedToAField(n: number): number {
  const box = new Box();
  box.xs = [{ a: n }];
  return box.xs[0].a + (box.xs[0].b ?? 40);
}

/** A class **field initializer**, which runs in the constructor. */
export function aFieldInitializer(n: number): number {
  const box = new Box();
  return box.initial[0].a + (box.initial[0].b ?? 40) + n;
}

/** Assignment to an array **element**, which narrows rather than coerces and
 *  is the one arm `slot_type` does not answer for. */
export function assignedToAnElement(n: number): number {
  const xs: Opts[] = [{ a: 0 }];
  xs[0] = { a: n };
  return xs[0].a + (xs[0].b ?? 40);
}

/** Assignment to a **module-scope** slot, which is where the right derivation
 *  lived all along. */
export function assignedToAGlobal(n: number): number {
  reassigned = [{ a: n }];
  return reassigned[0].a + (reassigned[0].b ?? 40);
}

class Box {
  xs: Opts[] = [];
  initial: Opts[] = [{ a: 1 }];
}

/** A **type parameter** in the union, which is the shape
 *  `web-platform/src/streams/fifo.ts` is written in and which
 *  `blockers/type-parameter-optional` held as refusing until this landed. It is
 *  the same fact once more: `= undefined` is a literal that takes its type from
 *  where it sits, and sitting in a field initializer it was being told nothing,
 *  so `T | undefined` had no reference for it to stand in for. */
class Slot<T> {
  value: T | undefined = undefined;
}

export function genericSlotSet(n: number): number {
  const s = new Slot<number>();
  s.value = n;
  return s.value ?? 0;
}

export function genericSlotUnset(n: number): number {
  const s = new Slot<number>();
  return (s.value ?? 100) + n;
}

/** The same at a reference element, where absence is a null pointer rather than
 *  a tag beside a double. */
export function genericSlotOfStrings(n: number): number {
  const s = new Slot<string>();
  if (n > 0) {
    s.value = "set";
  }
  return (s.value ?? "none").length;
}
