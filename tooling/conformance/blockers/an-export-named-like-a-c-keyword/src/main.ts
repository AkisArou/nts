// expect: emit-c --napi -> emits-c NtsString * FILE = 0;
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
