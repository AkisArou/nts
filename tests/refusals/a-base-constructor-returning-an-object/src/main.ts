// expect: NTS1001 a constructor returning an object, which replaces the instance `new` would have answered
//
// A constructor that returns an object makes that object the result of
// `new`, so the result is not an instance of the class. Until f51f5a2cc nts
// ignored the `return` and answered `this` (an outcomes record); now it
// refuses, since honouring it means handing back an object whose layout is
// not the class's. Found by test262's staging/sm/class/stringConstructor.js.
class Returning {
  constructor() {
    return {} as Returning;
  }
}
if (new Returning() instanceof Returning) throw new Error("the returned object was ignored");
