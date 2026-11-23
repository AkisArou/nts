// Exports named like libc functions, each beside a control that differs from it
// only in its name: `error` and `throwError`, `exit` and `leave`.
//
// **The exported name was a public ELF symbol, and the dynamic linker treats
// every one alike.** Defined with default visibility, `error` was exported and
// preemptible, so an addon's own call to it -- its wrapper's and its recursion's
// -- bound against node's global scope, where glibc's `error(status, errnum,
// format, ...)` came first: `a.error(6)` printed `node: ` and exited the process
// with status 64, while `a.throwError(6)` answered. A shared library lost its
// own calls the same way when a host `dlopen`ed it, and linked into a host it
// took glibc's place for every other object's `error@GLIBC_2.2.5` (#972).
//
// `exit` is spelled `exit_` for C, because `<stdlib.h>` declares it; that rule
// keeps the generated C compiling and never covered binding, and `error` is on
// no header list at all.
//
// Here the program runs as an executable, whose own definitions bind first, so
// this file agrees with node on every compiler: it is the specification, and an
// agreement guard on each backend. What breaks it is how a *shared object*
// binds, which `compiler/codegen/napi/tests/libc_named_exports.rs` (the addon,
// from C and LLVM) and `tooling/cli/tests/build.rs` (the addon and library
// products) load and call.
//
// Doubly recursive on purpose. A body LTO can inline is called without a
// symbol at all, and a linear recursion is a loop after tail-recursion
// elimination: both hid the defect from a build that otherwise had it. The
// bound stops every input the differential's pool offers -- a negative, a
// fraction, NaN, a large number -- within a few thousand calls.

export function error(n: number): number {
  if (!(n >= 2) || n > 20) return 1;
  return error(n - 1) + error(n - 2) * 2;
}

export function throwError(n: number): number {
  if (!(n >= 2) || n > 20) return 1;
  return throwError(n - 1) + throwError(n - 2) * 2;
}

export function exit(n: number): number {
  if (!(n >= 2) || n > 20) return 3;
  return exit(n - 1) * 2 + exit(n - 2);
}

export function leave(n: number): number {
  if (!(n >= 2) || n > 20) return 3;
  return leave(n - 1) * 2 + leave(n - 2);
}
