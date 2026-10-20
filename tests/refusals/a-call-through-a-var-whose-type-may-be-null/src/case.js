// A call at module scope through a `var` whose type there is
// `null | (() => string)`: declared `null` and assigned a function only
// inside a default parameter's initializer, which narrows nothing at the call.
// With no declaration to call, lowering made it a native call to a C symbol
// named `f` -- undefined at link time, as test262's `scope-paramsbody-var-open`
// cases are (21 of them) -- or, for a variable named like a libc function,
// that function. It is refused by name now, which cuts the statement.
//
// The control is `fromG`'s line: the same call through a `var` declared with
// its function, which compiles to a closure call with no refusal.

var f = null;
((_ = (f = function () {
  return "a";
})) => {})();
var fromF = f();

var g = function () {
  return "b";
};
var fromG = g();
