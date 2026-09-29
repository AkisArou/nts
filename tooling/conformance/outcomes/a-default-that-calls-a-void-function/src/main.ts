// C that does not compile: `vN undeclared` and "invalid use of void
// expression". A destructuring default whose initializer calls a function
// returning nothing -- `{ w = counter() }` with `counter(): void` -- assigns
// the void call's result to a value it never declares. The default is not
// taken here (w is null), so the program never needs the value. Found by
// test262's generators/dstr/{ary,obj}-ptrn-*-init-skipped.js and
// ary-ptrn-elem-ary-rest-iter.js, whose `counter` has no return, reproduced
// from the census's layout (tooling/census/materialise262.ts); a generator is
// not needed. A program that does not compile erases every arm, so the control
// is its own fixture: a-default-that-calls-a-number-function, which differs
// in the return type only.
let initCount = 0;
function counter(): void { initCount += 1; }
let seen = "none";
function h({ w = counter() }: { w?: unknown }) {
  seen = String(w === null) + "," + String(initCount);
}
h({ w: null });
observe("seen", seen);
done();
