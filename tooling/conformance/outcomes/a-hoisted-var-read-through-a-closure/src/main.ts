// A hoisted `var` read through a closure before its initializer is undefined.
// Its number-typed cell cannot represent that value, and the forward-read guard
// stops by name, explaining that JavaScript gives undefined here. Before frame
// objects were fully initialized, an uninitialized ready
// flag could instead let the read answer a number. Removing this stop requires
// undefined-capable storage and transport through every consumer. Found by test262's
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
