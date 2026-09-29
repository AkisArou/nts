// expect: NTS1001 a constructor returning an object, which replaces the instance `new` would have answered
//
// The derived twin of a-base-constructor-returning-an-object: `return {}`
// after `super()` makes `{}` the result of `new`. Until f51f5a2cc nts ignored
// it and answered `this` (an outcomes record); now it refuses. Found by
// test262's statements/class/subclass/derived-class-return-override-with-
// object.js.
class Base {
  prop: number;
  constructor() {
    this.prop = 1;
  }
}
class Returning extends Base {
  constructor() {
    super();
    return {} as Returning;
  }
}
if (new Returning() instanceof Returning) throw new Error("the returned object was ignored");
