// expect: NTS1001 a `next()` on an async generator, whose result is a promise
//
// Calling `next()` on an async generator is refused, in any position -- at
// module scope, as `await g().next()` in an async function, or as
// `g().next().then(...)`. The same generator consumed by `for await` compiles
// and runs (1, 2, end), so the generator is not the gap; the explicit
// iterator-protocol call is. `.return()` and `.throw()` refuse under another
// message ("a method `X` with no declaration in the hierarchy").
//
// test262's first root in 801 language and 22 built-ins files (census of
// 141c1ea81), 622 of them sole. **The sole count overstates the yield:** 702
// of those language files consume the result as `.next().then(...)`, and a
// statement stops at its first refusal, so `.then` on a promise -- "`X` on a
// promise, which has no method table here" -- stands behind this one,
// undiagnosed. Found by expressions/async-generator/expression-await-as-yield-
// operand.js and statements/async-generator/dstr/*.
async function* g() {
  yield 1;
}
async function main() {
  const r = await g().next();
  if (r.value !== 1) throw new Error("next() did not answer the first value");
}
main();
