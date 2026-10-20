// run: check
// The program is `case.js`: unchecked JavaScript, as test262 is.
//
// `[,]` over a generator steps the iterator once (IteratorStep for the
// elision), so the generator body runs to its first `yield` and adds 10:
// node answers 11. C and LLVM answer 1 -- the elision steps nothing -- and
// the JVM declines the parameter store, a generator where an array of
// erased values is declared (NTS4001), which is what found it: test262 dstr
// `ary-ptrn-elision-exhausted` and its relatives. The control,
// tests/programs/an-elision-pattern-over-an-array, differs only in passing
// an array.
//
// **Since 2026-10-20 the elision steps the generator**: an unannotated
// elision parameter is erased (`elision_patterns::takes_any_iterable`), and
// an elision over an erased value steps whatever arrived. The record is a
// guard now; a change that gives the parameter its pattern's array type again
// shows here.
export { probe } from "./case.js";
