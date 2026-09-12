// A class token stored where its **own** `typeof` is declared.
//
//     class Holder { readonly kind: typeof Message = Message }
//
// This lowered on C and LLVM and was declined by the JVM until 2026-09-12, and
// the difference is the whole point of the fixture: on a backend that lays out
// base-first the token and the slot coincide and nothing notices, and on one
// that relates classes **by name** they are two unrelated final classes.
//
//     NTS4001 storing a `Ctor_Message` where a `Fn3__1` is declared,
//             and the first does not extend the second here
//
// A closure already carried the relation this needs: `relate_closures_to_signatures`
// gives every closure layout the signature layout of its function type as its
// base. A class token is the *other* thing that is a value of a function type,
// and was not getting it. It does now, from one function used by both the
// provided-error tokens and the program's own — written once because the first
// version went into one arm and the failing example took the other.
//
// The base alone, with no abstract declaration beside it. A closure needs one
// because a call through an `Fn{ty}`-typed value has to reach a method; nothing
// dispatches a call to a class token, which exists to have an address.
//
// # What this does not cover, and the row that says so
//
// A token meeting a slot declared for a **different** class —
// `cond ? TypeError : RangeError`, or a field holding two classes — is a
// separate thing and still refused on the JVM. There the checker collapses the
// conditional to a single constructor type, so `Ctor_Other` meets a `Fn3__1`
// declared from `typeof Message`: two genuinely different signatures rather
// than two ids for one, which no base can relate. `examples/a-class-stored-and-compared`
// is that case and is still the JVM's one failing example.
//
// Worth stating because the comparison half agrees on C and LLVM, and checking
// only those would read as the feature working.

class Message {
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

/** Under test: a field declared as the class's own `typeof`. */
class Holder {
  readonly kind: typeof Message;
  constructor() {
    this.kind = Message;
  }
}

export function fromAField(n: number): number {
  const h = new Holder();
  return h.kind === Message ? (n & 7) : 0;
}

/** Under test: the same through a local, which is a different slot. */
export function fromALocal(n: number): number {
  const kind: typeof Message = Message;
  return kind === Message ? (n & 7) + 1 : 0;
}

/** Under test: through a parameter, so the token crosses a call. */
function holds(kind: typeof Message, n: number): number {
  return kind === Message ? n : 0;
}

export function throughAParameter(n: number): number {
  return holds(Message, n & 7);
}

/**
 * Control: a provided error class, whose token comes from the other arm.
 *
 * The two arms differ only in where the token's index comes from — a
 * compile-time list here, the program's own count above — and both needed the
 * base. This control is why the fix is in one function rather than two.
 */
export function aProvidedError(n: number): number {
  const kind: typeof TypeError = TypeError;
  return kind === TypeError ? (n & 7) + 2 : 0;
}
