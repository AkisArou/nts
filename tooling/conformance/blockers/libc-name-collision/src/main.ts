// expect: emit-c --napi -> emits-addon result = access(
//
// An exported function whose name is also a libc symbol is **silently replaced
// by libc's**. The Node-API wrapper emits the bare name:
//
//     double result = access(a0, a1);
//
// and `access` is POSIX `access(2)` from `<unistd.h>`, which the build
// force-includes. So the addon calls libc with an `NtsString *` where a
// `const char *` is expected, and answers whatever that produces.
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
