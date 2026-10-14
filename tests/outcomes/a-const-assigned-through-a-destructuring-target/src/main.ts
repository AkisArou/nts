// Assigning to a `const` through a destructuring target -- `[c] = [1]` --
// must throw a TypeError at run time; nts assigns nothing and goes on. Found
// by test262's {expressions/assignment,statements/for-of}/dstr/*-put-const.js,
// 74 of the "assert.throws: nothing was thrown" family. The control assigns a
// `let` through the same target and agrees.
const c: number | null = null;
let v: number | null = null;
let toConst = "none";
let toLet = "none";
try {
  // @ts-expect-error -- JavaScript: a TypeError at run time
  [c] = [1];
} catch (e) {
  toConst = e instanceof TypeError ? "TypeError" : "another error";
}
try {
  [v] = [1];
} catch (e) {
  toLet = "threw";
}
observe("const target", toConst);
observe("let target", toLet + "/" + String(v));
done();
