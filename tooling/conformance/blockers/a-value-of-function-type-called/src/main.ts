// expect: a value of type `Function` called as a function

// Calling a value whose **type** is `Function`, which says a function is there
// and not which one.
//
// This is what `new Function(source)` and `Function(source)` produce, and it is
// dynamic code: the body is a string read at run time, so there is nothing for
// an ahead-of-time compiler to compile. The refusal is not going away, and the
// sentence is the point of this fixture.
//
// **It used to name the variable instead.** Nine files of the slice-1
// `test/language` population refused with
//
//     `f`, a builtin this compiler does not provide
//
// under four different names — `f`, `fn`, `MyFunction`, `_13_0_12_fun` — which
// sends a reader to `hir::builtin` to add a builtin called `f`. Every one of
// them is `Function`, so one message was carrying two causes and the count for
// the real one was nine files short.
//
// The test that separates them is `SymbolRecord::declarations`, which the
// schema already documents: "empty for a symbol declared outside the decoded
// file set". `f` is an ordinary `var` in the source, so it has a declaration;
// `eval` has none. A binding-table lookup was tried first and **never fired**,
// because the maps it asked are the lowering's own — a symbol whose declaration
// the lowering already refused is absent from them, which is exactly this case.

// The shape is the corpus's, verbatim: a module-scope `var` initialised from
// `Function(...)` and then called. Writing `new Function(...)` inside a
// function instead refuses one step earlier — `a `new` of unrepresentable type
// (`Function`)` — and never reaches the call, so the fixture would pin a
// different sentence than the one it is named for.

var f = Function("eval = 42;");
f();

export function stillCompilesAroundIt(n: number): number {
  return n;
}
