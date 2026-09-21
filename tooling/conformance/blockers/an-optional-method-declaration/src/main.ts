// expect: NTS1001 a method without a body
//
// An **optional method declaration**: a signature a subclass may provide, with
// no implementation beside it.
//
//     _final?(callback: WriteCallback): void;
//
// `runtime/node/stream` writes five of these -- `_final?`, `_construct?` on
// `Writable`, `Duplex` and `Readable` -- and they are what is left of the *a
// method without a body* row after overloaded constructors were fixed: 36
// sites to 5.
//
// # It is not an overload signature and must not be treated as one
//
// `is_an_overload_signature` identifies a signature by finding a same-named
// sibling **with a body**. There is none here, by design: the class declares
// that a subclass *may* define `_final`, and the base checks `if (this._final)`
// before calling it. Skipping the member the way an overload is skipped would
// emit a class whose method nothing defines, and a call through it would reach
// a function that was never written -- which is the failure
// `collect_anonymous_objects` records one container over, "registering the
// second makes `declaring` resolve a call to a function nobody wrote".
//
// So the refusal is right, and the message is accurate for it: there is a
// method here and this lowering has no body for it.
//
// # What closing it would mean
//
// The member is optional, so the honest representation is a slot that may hold
// a function and may hold nothing -- which is what `_writev: WritevCallback |
// null = null` on the same class already is, and that one lowers. The
// difference is spelling: a `?` method is a declaration, a nullable field is
// storage. Teaching the lowering to read the first as the second is a narrow
// change, and the guard it needs is that nothing calls it unconditionally.

export class Base {
  n = 1;

  _final?(callback: (e: Error | null) => void): void;

  finish(): number {
    return this.n;
  }
}
