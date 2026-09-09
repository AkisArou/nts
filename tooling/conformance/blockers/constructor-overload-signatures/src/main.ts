// expect: a method without a body
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
