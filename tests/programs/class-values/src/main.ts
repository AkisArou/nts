// A class used as a **value** rather than as a type.
//
// `err.constructor === TypeError` is how a program asks which error it caught,
// and `runtime/node` writes it 88 times — 64 of them as
// `override get ["constructor"](): unknown { return TypeError; }`, so that code
// checking the built-in agrees about a subclass. Every one was refused with
// "`TypeError` used as a value rather than as a type", which was true and was
// not a question about capability: 1,865 occurrences, the largest single
// refusal in the profile.
//
// What a value of a class has to be: one object per class, the same one
// wherever the name is written, `typeof` "function", and comparable by
// identity. That is a named function used as a value with a different source —
// so it is the same operation, an immortal static at a type in the token band,
// which `is_closure_type` answers yes to and which is therefore tagged
// FUNCTION with no special case anywhere.
//
// Empty, because nothing reads a field of it. Calling it is a separate feature
// and is refused by name: `TypeError(m)` is `new TypeError(m)` in JavaScript
// and would need the token to carry a `call` that constructs.

export function identityHolds(n: number): number {
  const a: unknown = TypeError;
  const b: unknown = TypeError;
  // Two mentions of one class are one object. If they were not, every
  // `=== TypeError` in a program would be false and nothing would say so.
  return (a === b ? 1 : 0) + (n > 0 ? 10 : 0);
}

export function classesAreDistinct(n: number): number {
  const a: unknown = TypeError;
  // All four provided error classes hold a `message` and a `name` and nothing
  // else, and a *token* holds nothing at all — so shape merges every one of
  // them into one layout unless something refuses to. Record 0096 said this
  // shape would recur; this is the third family it has recurred in.
  return (
    (a === TypeError ? 1 : 0) +
    (a === RangeError ? 10 : 0) +
    (a === Error ? 100 : 0) +
    (a === URIError ? 1000 : 0) +
    (n > 0 ? 10000 : 0)
  );
}

export function typeOfAClass(n: number): number {
  const v: unknown = TypeError;
  // `typeof TypeError` is "function", not "object". The tag falls out of the
  // token's type id being in the closure band rather than from a rule about
  // classes.
  //
  // One class rather than `n > 0 ? TypeError : RangeError`, and the reason is a
  // gap rather than a preference: the checker gives that conditional a single
  // object type rather than a union of the two constructors, so nothing here
  // sees two representations to erase and the backend declines the function
  // with `NTS2006 an object type with no layout`. Loud rather than wrong, and
  // named in the ledger. Nothing in `runtime/node` writes it -- the idiom is
  // `return TypeError` and `value === TypeError`, both of which are below.
  const answer = typeof v === "function" ? 1 : typeof v === "object" ? 2 : 3;
  return answer + (n > 0 ? 10 : 0);
}

function isProvided(value: unknown): boolean {
  return (
    value === Error ||
    value === TypeError ||
    value === RangeError ||
    value === URIError
  );
}

export function againstSomethingElse(n: number): number {
  // The negative, so the comparison cannot pass by answering yes to everything:
  // a string, a number and a plain object are all `unknown` here and none of
  // them is a class.
  const s: unknown = "TypeError";
  const d: unknown = n;
  return (
    (isProvided(s) ? 1 : 0) +
    (isProvided(d) ? 10 : 0) +
    (isProvided(TypeError) ? 100 : 0)
  );
}

// The idiom the refusal was found in: a subclass reporting the built-in its
// callers check against, through a getter the base also declares.
class Reported {
  get ["constructor"](): unknown {
    return Error;
  }
}

class ReportedNarrow extends Reported {
  override get ["constructor"](): unknown {
    return TypeError;
  }
}

export function throughAConstructorGetter(n: number): number {
  const r: Reported = n > 0 ? new ReportedNarrow() : new Reported();
  const c = r.constructor;
  return (c === TypeError ? 1 : 0) + (c === Error ? 10 : 0);
}
