// expect: emit-c --napi -> emits-addon napi_create_double(env, (double)nts_export_flag()
//
// The expectation named `(double)flag` until the wrapper started reading value
// exports through a file-scope function -- see
// `value-export-named-like-a-wrapper-local` for why it has to. `flag` is still
// published and still crosses; only its spelling at the read moved. That is a
// CHANGED this fixture reported correctly and a person had to look at, which is
// the outcome the three verdicts exist to produce.
//
// FIXED, kept as a guard. `export const x = f()` binds a value, not `f`.
//
// `lower::initializer_function` exists so that `export const alias = impl`
// publishes `impl` under the name `alias` -- the binding decides what the addon
// calls it, the initializer decides what it calls. It found the function by
// asking the initializer node for a symbol and then, failing that, its **last
// child**, which covers `= f` and `= ns.f` without asking which one it is.
//
// A call with no arguments has exactly one child: its callee. So `= f()`
// resolved to `f`, and the export was published as a *wrapper for f* --
// `napi_create_function(env, "flag", ..., nts_napi_platform, ...)`. The name
// crossed as a **callable**, where the source says it is a number.
//
// # The controls, and the one that matters
//
// `alias` is the case the resolution exists for and must keep working; it
// publishes as a function. `literal` is a value with no call in it at all.
// `flag` is the subject.
//
// `computed` is here because **the first version of this fixture used it and
// proved nothing.** `impl(21)` has two children, callee and argument, so the
// last child is the literal `21`, which carries no symbol, so the resolution
// already declined it. Written that way the fixture reported identical output
// from both compilers and would have been filed as evidence there was no bug.
// A call with an argument and a call without one are different shapes here, and
// only the second reaches the defect.
//
// # Where it is in the corpus, and why it never produced a wrong binding
//
// Fourteen sites: thirteen in `fs/src/constants.ts` -- `export const O_CREAT =
// nts_fs_o_creat()` and its siblings, the POSIX flags that are read from the
// platform rather than fixed by the standard -- and `ZLIB_VERNUM` in zlib's.
//
// Every one of them calls a *native binding*, which has no compiled body and so
// no wrapper either way. So none of them crossed as a callable; what they did
// was produce twenty-six lines of `is a namespace member whose function has no
// wrapper` about numbers. The defect is demonstrated by `flag` below, where the
// callee is a compiled function, and the corpus shows what it cost short of
// that.
//
// `NEW_EXPRESSION` is refused for the same reason: `= new Thing()` binds an
// instance, and its last child is equally likely to carry a symbol.

export function impl(n: number): number {
  return n * 2;
}

export function platform(): number {
  return 64;
}

// Control. The resolution this function exists for.
export const alias = impl;

// Control. A call with an argument, which was already declined -- and reads as
// a passing subject if it is mistaken for one.
export const computed = impl(21);

// Control. No call at all.
export const literal = 7;

// The subject. A call with no arguments, whose callee is compiled.
export const flag = platform();
