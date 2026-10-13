// expect: NTS1001 an erased value where a concrete representation is wanted
//
// **A field an interface types `unknown`, narrowed by `typeof` to a string and
// returned, is refused once a class that holds the field as a `string` is
// converted to the interface.** `nameOf`'s `return named.displayName` is the
// refused read; the `typeof` test above it lowers. `nameOf(held)` is called
// with the `Named` itself, so the refused copy is the one this program runs:
// it prints nothing, and node prints `Ctx` and `none`.
//
// **Control**, measured and not kept in this file: the same program with
// `Context`'s field written `displayName: unknown`, a one-line difference. It
// compiles on both compilers below and prints node's lines.
//
// **New since da4a2a4a8, and the refusal moved.** That compiler refused the
// conversion `const held: Named = context` ("`Context` has no field of that
// name and type") and compiled `nameOf`. Main at efc71ad44 accepts the
// conversion (stage B's field views) and refuses the narrowed read instead.
//
// **Found by the React lane, and the precondition is not reduced.**
// getComponentNameFromFiber.ts:56 and :70, and getComponentNameFromType.ts:35,
// :46, :53 and :103, are this read through a module-local
// `interface Named { displayName?: unknown; ... }`. They compiled on
// da4a2a4a8 and are refused now, which refuses getComponentNameFromFiber,
// getUserTypeName, logComponentRender, logComponentEffect and collectNames.
// React has no static conversion into either `Named`: every value arrives as
// `value as Named` from `unknown`. So what gives the field a `string` owner
// there is something other than this file's `held` line. Read that way here,
// with no conversion, this program compiles on both compilers and answers
// `none` where node answers `Ctx`; that wrong answer is filed separately as
// outcomes/a-string-field-read-through-a-cast-of-unknown.
interface Named {
  readonly displayName?: unknown;
}

class Context {
  displayName: string = "";
}

function nameOf(named: Named): string {
  if (typeof named.displayName === "string") {
    return named.displayName;
  }
  return "none";
}

const context = new Context();
context.displayName = "Ctx";
const held: Named = context;
console.log(nameOf(held));
console.log(nameOf({ displayName: 3 }));
