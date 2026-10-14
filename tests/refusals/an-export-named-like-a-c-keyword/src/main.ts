// expect: emit-c --napi -> addon-compiles
//
// **Fixed 2026-09-11**, and the expectation moved from reproducing the defect to
// guarding against it. What follows is why the fix is a namespace and not a
// list.
// control: exports.plain === "ordinary"
//
// An exported name that is a C standard identifier, emitted verbatim as a C
// global.
//
// Found implementing `node:dns`, where both names are node's **documented public
// API**: `dns.EOF` and `dns.FILE` are constants node publishes, alongside
// `NODATA`, `SERVFAIL` and twenty more. The emitted C is
//
//     NtsString * FILE = 0;
//     NtsString * EOF = 0;
//
// and `<stdio.h>` has already defined `FILE` as a type and `EOF` as
// `#define EOF (-1)`. clang reports `redefinition of 'FILE' as different kind of
// symbol` and, for the macro, `unexpected type name` at the substituted text.
//
// # The fix: the header names, where every namespace already looks
//
// `EOF_` and `FILE_`, through the suffix rule `c_identifier` already applies to
// C keywords and to the `<math.h>`, `<string.h>` and POSIX names.
// `HEADER_MACROS` adds the object-like macros and type names from the headers
// the emitted C actually includes, and it is bounded by those includes rather
// than by all of C.
//
// **A namespace on globals was tried first and was the weaker answer.** Prefixing
// every module-scope global with `nts_g_` closes this collision and only this
// one: the same `EOF` reaches a **struct member** and the `offsetof` in a
// descriptor's reference map by the same route, and a prefix on globals covers
// neither. One rule in `c_identifier` covers all three, because all three take
// the name from the same JavaScript identifier.
//
// That was found by the Node lane trying the workaround -- moving the constants
// into an object literal -- and hitting `result->EOF` instead. A fix verified
// only against the global would have looked complete.
//
// # It is the *wrapper* that fails to compile, not the program
//
// `program.c` compiles: it includes `nts_runtime.h` and nothing that defines
// `FILE`. `addon.c` includes `node_api.h`, which reaches `<stdio.h>`, and that
// is where the collision lands. So the expectation here is `emits-c` on the
// unqualified declaration rather than `fails-to-compile` -- the emission is the
// defect, and whether it *bites* depends on which headers the translation unit
// happens to pull in.
//
// That distinction cost two wrong expectations before this one. `compiles`
// passed, because it compiles the program. `addon-compiles` reproduced, but it
// is a guard form, so a real defect read as `REGRESSED`.
//
// # Why this is not "do not name things that"
//
// The names are not ours to choose. A profile that rehosts node's libraries
// publishes the names node publishes, and `dns.FILE` and `dns.EOF` are two of
// the twenty-four error constants `node:dns` exports. The same hazard sits under
// any module with a constant called `NULL`, `BUFSIZ`, `EXIT_SUCCESS` or one of
// the `E*` errno macros.
//
// # The macro is the worse half
//
// `FILE` is a type, so the collision is a redefinition and the diagnostic names
// it. `EOF` is a **macro**: the preprocessor substitutes before the compiler
// sees a declaration, so `NtsString * EOF = 0;` becomes `NtsString * (-1) = 0;`
// and the error is `expected identifier or '('` at a token nobody wrote.
//
// A namespace on emitted module-scope globals fixes both. Everything else in the
// emitted program already carries one, which is why this appears only here.

export const EOF = "end";
export const FILE = "file";
export const plain = "ordinary";
