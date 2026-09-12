// expect: a conversion to string from unknown
//
// An `unknown` interpolated into a template literal.
//
// Node's error constructors do this everywhere, and so do ours because they are
// ports of them:
//
//     internal/errors.ts:1299  super(`${parameter} is not a valid Brotli parameter`)
//     internal/errors.ts:1454  super(`Invalid value "${String(value)}" for header "${name}"`)
//
// where both `parameter` and `value` are declared `unknown`. **Seven sites in
// that file, on the path of 21 of the 22 modules** -- 147 diagnostic lines, more
// than any other construct remaining in `errors.ts` after the identifier regex
// cleared.
//
// # Both spellings, because they are not obviously the same
//
//     interpolated   `${value}`          the implicit conversion
//     explicit       `${String(value)}`  the call
//
// Node writes both, sometimes in adjacent constructors. If one lowers and the
// other does not, the fixture says which, and the count above splits.
//
// # The controls
//
// `fromString` and `fromNumber` interpolate a `string` and a `number`, which
// lower. So the refusal is about the **erased** type and not about template
// literals, and if either control ever refuses this fixture is about something
// else.
//
// # What it is actually blocked on, measured 2026-09-12
//
// The refusal used to read `a conversion to string from this type` and never
// named the type, so its 178 sites could not be counted by kind. Naming it
// answered in one pass: **176 are `unknown`**, 161 of them in `errors.ts`. The
// ledger row for this guessed `valueOf`/`toString` dispatch; `valueOf` is not in
// it at all.
//
// `nts_value_to_string` already exists in `runtime/c`, in LLVM's signature table
// and in the JVM's ops, and the lowering already emits it. What gates it is one
// predicate -- `spells_itself` admits a union of scalars and absences and
// refuses `Unknown`, because an `unknown` can hold an object.
//
// **The object tag is answerable and was built: a `toString` slot on the
// descriptor, `"[object Object]"` where the entry is null -- which is what an
// object whose chain adds nothing *is* -- and a join for an array. The function
// tag is not.** `String(fn)` in node is the function's *source text*, and this
// compiler keeps none: `Origin` carries a file and a line, not a span, and the
// text would have to be carried per closure in every backend.
//
// `tooling/sweep` generates `String(v)` over every shape including a closure, so
// admitting `unknown` makes a case compile that cannot be answered correctly --
// it failed as `NTS2006 closure class `Closure14` reached code generation with
// no method to call`, a closure that is only ever erased and never called. The
// whole of the object work was reverted on that, because a feature correct for
// seven tags and wrong for the eighth is the shape this project refuses.
//
// So this fixture is blocked on **function source retention**, which is a
// different feature from anything in the conversion.
//
// # Where it sits
//
// This is the erased-value family: an `unknown` holding a reference cannot cross
// the wrapper outward, and it cannot be turned into a string either. Whether one
// representation answers both is the compiler lane's question --
// `blockers/an-erased-reference-cannot-cross-outward` is the boundary half.
//
// # The census this fixture could not have supported until 2026-09-12
//
// The refusal used to read `a conversion to string from this type` and **never
// named the type**, so its 178 sites in `runtime/node` could not be counted by
// kind: an object wanting `ToPrimitive`, an array wanting `join` and an erased
// value wanting a tag dispatch are three different features behind one sentence.
// Naming it answered the question in one pass:
//
//     176  unknown
//       2  a union of an object | null
//       1  a union of an array | number | string
//
// and 161 of the 176 are in `internal/errors.ts`. So this fixture is not one of
// several roughly equal causes -- it is **almost the whole row**, and the work
// behind it is `ToString` of an erased value rather than `valueOf`/`toString`
// dispatch on a typed object, which is what the ledger row had suggested.

/** Control: a string interpolates. */
export function fromString(value: string): string {
  return `value is ${value}`;
}

/** Control: a number interpolates. */
export function fromNumber(value: number): string {
  return `value is ${value}`;
}

/** Under test: an erased value, interpolated. */
export function fromUnknown(value: unknown): string {
  return `value is ${value}`;
}

/** Under test: the same, spelled with an explicit call. */
export function fromUnknownExplicit(value: unknown): string {
  return `value is ${String(value)}`;
}
