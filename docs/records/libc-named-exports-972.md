# Exports named like libc functions: binding before and after

Issue #972. A Node addon or native shared library exporting `error` called
glibc's `error(status, errnum, format, ...)` instead of its own function, and a
library exporting it took glibc's place for every other loaded object.

## Cause

The emitted program defines its ABI-public functions with default
visibility, which on ELF makes each an exported, preemptible symbol. The
dynamic linker then binds the object's own references, and other objects'
references to the same name, by global scope order:

- an addon is loaded after node and libc, so its wrapper's and its program's
  own calls to `error` reached glibc's;
- a library a host `dlopen`s is in the same position;
- a library a host links comes before libc, and glibc's loader accepts an
  unversioned definition for a versioned reference, so another object's
  `error@GLIBC_2.2.5` bound to the library's.

`exit` is spelled `exit_` for C because `<stdlib.h>` declares it. That list
keeps the generated C compiling; it never governed binding, and `error` is on
no header list.

## Change

- `compiler/codegen/napi`: `addon.c` declares every program symbol it reaches
  inside a `#pragma GCC visibility push(hidden)` region (ELF and Mach-O),
  closed before `NAPI_MODULE_INIT`. The linker gives a symbol the most
  constraining visibility of the declarations it merges, so the program's
  definitions become local to the addon whichever backend produced them, and
  every call binds inside. No build flag is involved.
- `tooling/cli`: a shared library's version script names a version node, its
  file name or soname in the characters `ld.bfd` accepts. The library's own
  references then require `name@<node>`, which libc's definitions do not
  satisfy, and other objects' versioned references skip the library's
  definitions. Exported names are unchanged.

Rejected, measured: protected visibility on the published definitions fixed
the library's own calls but not its preempting of others. It also breaks hosts
that take an export's address from a non-PIE executable: ld.bfd warns and
pointer equality fails, and lld refuses with `cannot preempt symbol`. Build
flags (`-fvisibility=hidden`, `-Bsymbolic`) were rejected because a fact every
builder must remember is how the `nts build` addon came to lack it.

## Measurement

Program: `tests/programs/an-addon-export-named-like-a-libc-function`, the
exports `error` and `exit` beside the controls `throwError` and `leave`, each
called on 4.5. Products built by `nts build` (addon on C; libraries on C and
LLVM). Hosts:

- `dlopen`: loads the library after libc and calls each export;
- `linked`: links the library and a second library that calls glibc
  `error(0, 0, msg)`.

"before" is pin `ae3482724bae`; "after" is this change's `nts-dev` compiler.

| Product | Check | Before | After |
|---|---|---|---|
| addon (C) | `error(4.5)` / `throwError(4.5)` | `node: `, exit 160 / 11 | 11 / 11 |
| addon (C) | defined dynamic symbols | 504, including `error`, `throwError`, `exit_`, `leave` | 500, none of the program's |
| library (C) | `dlopen` host `error(4.5)` / `throwError(4.5)` | glibc `error()`, exit 4 / 11 | 11 / 11 |
| library (LLVM) | `dlopen` host `error(4.5)` / `throwError(4.5)` | glibc `error()`, exit 136 / 11 | 11 / 11 |
| library (C and LLVM) | second library's glibc `error()` | never printed (bound to the library) | printed |
| library (C and LLVM) | exported names | `error exit_ leave throwError` | the same, each `@@lib<name>.so` |

The addon's remaining 500 symbols are the runtime's (`nts_*`, vendored); that
is #977.

Raw output: `~/.cache/nts-scratch/972/measure/`:

| File | SHA-256 |
|---|---|
| `pin-behaviour.txt` | `382b63b2179f5b3407af569e9b7359fead78bccb17fa88c7ab0af9dea3d3adfe` |
| `after-behaviour.txt` | `29ef603bc8c38d9a07e7bbf2a9366eadfd1ddf50b8f58ab02e00c7d4dc474a5a` |
| `pin-addon.node.nm` | `798ffaac17f6a8daa7fd9c6ed866d1e67ed78123f99b376581101a7536eee5cb` |
| `after-addon.node.nm` | `0946a27c14cb6b66cb0f2def33c2cbc60ae34ab965ba3bca6873959c81865056` |
| `pin-libprobe.so.nm` | `34bac0aaf9959078c9cbfd4b55c70451f872be6774f5c29086b17297033efc18` |
| `after-libprobe.so.nm` | `4fd851e57b28cf876521d993869abf590895ee8dd6b03c8ceaea48514f5b61da` |
| `pin-libprobellvm.so.nm` | `5afa295566c3559fad9c4aa79457334339636457b4dbef3da124a6411c96973c` |
| `after-libprobellvm.so.nm` | `4e5f413933a3d4a9d61ec9406ceb51650ab0955cfb10459420d261a5a4b7e538` |

Experiments on hand-linked variants of the same objects (anonymous or named
script, default or protected definitions, ld.bfd and lld, dotted and hyphened
node names) are in `~/.cache/nts-scratch/972/visibility/`.

## Notes

- A body LTO can inline, or a linear recursion that tail-recursion
  elimination turns into a loop, is called without a symbol: the first
  probes passed on the broken compiler for that reason. The fixture is doubly
  recursive.
- The `tests/programs` fixture runs as an executable in agree, whose own
  definitions bind first, so it agrees with node before and after. The
  binding proof is `compiler/codegen/napi/tests/libc_named_exports.rs` (addon,
  C and LLVM) and `tooling/cli/tests/build.rs`
  `products_exporting_libc_names_call_their_own_and_leave_libcs_alone` (addon
  and both library backends).
- Static-library exports enter the host executable's namespace; their unread
  `prefix` field is #978.
- The version node is glibc's remedy. musl's loader, and bionic's before API
  23, ignore version names, so a library loaded there still binds its own
  call to an export named like a libc function by scope order.
