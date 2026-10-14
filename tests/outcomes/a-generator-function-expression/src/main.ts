// **Agrees since 9da2c4eac; a guard.** Until then, invalid HIR:
// `FellThrough { func: "Closure0#call", block: BlockId(0) }`.
// A generator *function expression* is lowered as an ordinary function: its
// empty body falls through where a generator object should be returned, a
// `return;` in it is a `ReturnType` mismatch, and a `yield` in it is refused as
// "a `yield` outside a generator". The declaration `function* g() {}` compiles.
//
// This fixture was `an-array-pattern-parameter-given-a-generator`, whose
// reduction carried the generator expression as the iterator argument, and
// the pattern read as the cause. It is incidental: `var iter = function* ()
// {}();` alone is the program. In the full test262 census at bd58854b9, 259 of
// the 263 FellThrough files contain a generator expression -- every dstr/ case
// builds its iterator this way -- and of the 1,281 files that contain one,
// none passes; 27 more are refused as a `yield` outside a generator.
//
// Control, measured as compiling: the same generator as a declaration. Not an
// arm here because invalid HIR costs the whole program.
var iter = (function* () {})();
observe("done", String(iter.next().done));
done();
