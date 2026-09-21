// expect: nothing refused
//
// **Closed 2026-09-21**, and kept as the regression guard. Two copies of one
// fact were missing the same arm: a constructor has no `IDENTIFIER` child, so
// `member_key` could not name it and `is_an_overload_signature` answered
// "not an overload" for every constructor signature. Fixing that alone was not
// enough --- `implementation_of`'s own `named` closure had the identical hole,
// so `new C()` was padded to the arity of the overload the checker matched and
// the verifier reported `CallArgumentCount { expected: 2, found: 1 }`.
//
// The row went 36 sites to 5, and what is left is optional method
// declarations, which are a different construct with their own fixture.
//
// The account below is what the gap looked like from outside.
//
// ---
//
// TypeScript overload signatures are declarations with no body, and a class
// that offers two call shapes is written with one per shape plus the
// implementation. The lowering refuses the bodiless ones.
//
//     class Plain    { constructor(a: number) {...} }        -> lowers
//     class Overload { constructor(a: number);               -> REFUSED
//                      constructor(a: number, b: number);    -> REFUSED
//                      constructor(a: number, b = 0) {...} }
//
// `Plain` is the control and must stay clean, or the diagnostic reads as "a
// class constructor is refused", which is false and points at classes rather
// than at the signature form.
//
// The overloads here differ in arity and not in type, deliberately. The
// obvious spelling -- `constructor(a: number); constructor(a: string);` with a
// `number | string` implementation signature -- refuses a second time for "a
// parameter of unrepresentable type (a union of ...)", and a fixture with two
// causes cannot say which one a fix addressed.
//
// Seven of `buffer`'s forty-three root refusals are this, in two files:
// `Buffer` declares four constructor overloads and `Blob` declares four. Both
// are the real node surfaces -- `new Buffer(size)` and `new Buffer(string,
// encoding)` are different calls -- so there is no spelling of these classes
// that is both correct and free of the form.

export class Plain {
  a: number;
  constructor(a: number) {
    this.a = a;
  }
}

export class Overload {
  a: number;
  b: number;
  constructor(a: number);
  constructor(a: number, b: number);
  constructor(a: number, b = 0) {
    this.a = a;
    this.b = b;
  }
}
