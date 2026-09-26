// A hoisted `var` whose type is inferred as `number`, read through a closure
// before its initializer runs, is `undefined` in JavaScript. nts answers a number.
// Annotating it `number | undefined` makes nts agree. Found by test262's
// identifier-resolution/S10.2.2_A1_T3.js.
function f1() {
  function f2() {
    return x;
  }
  const seen = f2();
  var x = 1;
  return seen;
}
observe("typeof", typeof f1());
done();
