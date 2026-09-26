// A closure made in a `for (let ...)` *update* expression closes over the next
// iteration's copy of `i`: the update runs after the per-iteration copy is made.
// node: a[0]=1, a[2]=3. nts answers 0 and 2 -- the copy it captures is the old one.
// No diagnostic. Found by test262's
// test/language/statements/let/syntax/let-closure-inside-next-expression.js.
const a: Array<() => number> = [];
for (let i = 0; i < 3; a.push(function () { return i; }), ++i) { }
observe("a[0]", String(a[0]()));
observe("a[2]", String(a[2]()));
done();
