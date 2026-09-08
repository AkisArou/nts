// expect: emit-c --napi -> emits-c double access_(
//
// FIXED, and kept as a guard on the escape. The C symbol is `access_` now while
// the JavaScript name stays `access`, so nothing in the addon's own translation
// units carries a name libc also has. Verified behaviourally as well as by the
// emitted text: an export named `access` answers `-2`, `0`, `-2` for a missing,
// existing and empty path, which is ENOENT and correct and agrees with node.
//
// **Two fixes were needed and they close opposite directions.** The escape above
// stops a program's `strlen` preempting libc's *for the runtime*, which makes 58
// such calls in `nts_runtime.c`. `build.sh` linking addons with
// `-fvisibility=hidden` stops libc preempting the *program*: that took
// `punycode.node` from 360 exported dynamic symbols to 2, and among the 358 were
// the bundled QuickJS internals. An escape list cannot close that direction,
// because the risk there is libc's dynamic symbol table rather than any header.
//
// An exported function whose name is also a libc symbol is **silently replaced
// by libc's at load time**. The wrapper emits the bare name:
//
//     double result = access(a0, a1);
//
// so the addon calls libc's `access(2)` with an `NtsString *` where a
// `const char *` is expected, and answers whatever that produces.
//
// **The mechanism is ELF symbol preemption, not a header.** There is no
// conflicting declaration and clang emits no warning: `addon.c` declares
// `double access(NtsString *, double);` before the call, and `program.c` defines
// it. `nm` confirms the addon *defines* the symbol — `T access`. But a shared
// object linked without `-Bsymbolic` routes even calls to its **own** global
// functions through the PLT, and the dynamic linker resolves them against the
// global symbol table, where libc's `access` was bound first. So the definition
// is present, correct, and never called.
//
// Node's own `fs` is unaffected, which is how the mechanism was pinned: node and
// libuv resolved their `access` before the addon loaded, so the addon's
// definition does not interpose on them. The damage is confined to the addon
// calling out instead of in.
//
// That makes the fix a link or naming decision rather than a lowering one:
// `-fvisibility=hidden` on the emitted translation units, `-Bsymbolic` on the
// addon, or emitting program functions under a prefix that cannot collide. The
// third is the only one that also protects a *static* helper, though a `static`
// function is already safe — verified separately: an internal `read` emits as
// `static double read(double)` and compiles and runs correctly, because a
// static definition has no dynamic symbol to preempt.
//
// **Measured, not inferred.** A probe exporting `access` over `nts_fs_access`
// answered `0` for every input — a missing path, an empty path, a root-only
// path, an existing file. Renaming the export to `probeAccess` and changing
// nothing else gave `-2` for a missing path, `0` for an existing one and `-2`
// for an empty one, which is ENOENT and correct and agrees with node. **The
// binding was right the whole time; the emitted C was calling a different
// function.**
//
// It fails in the worst available way. There is no refusal, no clang error --
// the call type-checks well enough to compile with a warning nobody reads --
// the addon links, loads, and returns plausible values. Every instrument in this
// repository reports success.
//
// **The reach is most of POSIX, in the module with the most native surface.**
// `fs` exports `access`, `open`, `read`, `write`, `close`, `link`, `unlink`,
// `rename`, `chmod`, `chown`, `stat`, `truncate`, `mkdir`, `rmdir` — every one
// of those is a libc symbol, and `fs` declares 133 bindings behind them. `net`
// and `dgram` have `connect`, `listen`, `bind`, `send` and `socket`.
//
// Found with `tooling/conformance/binding-probe.sh`, which builds an addon
// around a few of a module's bindings without compiling the module — so this was
// reachable today rather than after `fs` compiles, which is the point of that
// tool. It is the first defect it found and it found it in its first run.
declare function nts_fs_access(path: string, mode: number): number;

export function access(path: string, mode: number): number {
  return nts_fs_access(path, mode);
}
