# Static native library namespaces (#978)

The native product's Rust config did not deserialize `prefix`. SourceSymbols
chose unprefixed public names, and a static link could put a TypeScript
`error` in the host executable's namespace, preempting libc throughout the
process. The prefix is now resolved before emission and frozen once in the
source symbol plan shared by C and LLVM. Header declarations, publication
lists, definitions, references and the library constructor consume that plan.

An explicit prefix is validated with its value in the refusal. The default
normalizes product-name punctuation to `_` and escapes an empty/invalid initial
or reserved namespace with `product_`. Both routes validate an ASCII identifier
fragment, which is always followed by `_` and a name: `main` and `int` are valid,
and a product named `int` gives `int_error`. `probe-llvm` and `probe_llvm` both give `probe_llvm`; explicit
prefixes distinguish this deliberate default collision. The resulting public name is
`<prefix>_<existing C spelling>`. Raw emissions and other product kinds keep
their names; shared-library prefix support is tracked by #1005.

## Consumer inventory

There are 23 static-product configs under `tests/interop`: 22 have C consumers,
and `chromium-surface` checks building and archive membership without calling
source exports. The workspace fixture contributes one more static product.
Every migrated C consumer includes the generated `program.h`; none keeps a
hand-written declaration of a generated export. Native library declarations
such as `pollfd_size` are unrelated and retain their native names.

| Fixture | Static ABI prefix | Consumer change |
|---|---|---|
| c-from-ts | default `lib` | generated function names |
| chromium-surface | defaults `app`, `appLlvm` | build-only; no caller to rename |
| library-module-state | default `lib` | generated function name |
| native-bigint-constants | explicit `lib`, both backends | generated function names |
| native-buffer | default `lib` | generated function name |
| native-callback | default `lib` | generated function names |
| native-closure | default `lib` | generated function names |
| native-copy | default `lib` | generated function names |
| native-epoll | default `lib` | generated functions and initializer |
| native-fd | default `lib` | generated function calls and pointers |
| native-inet | default `lib` | generated functions and initializer |
| native-open | default `lib` | generated functions and initializer |
| native-pointer-bits | explicit `lib`, both backends | generated function names |
| native-pointer-constants | explicit `lib`, both backends | generated function names |
| native-poll | default `lib` | generated function names |
| native-private-names | explicit `lib`, both backends | generated function name; original caller retained separately for raw NoGC emission |
| native-rusage | default `lib` | generated function names |
| native-stat | default `lib` | generated function names |
| native-string | default `lib` | generated function names |
| native-uname | default `uname` | generated function names |
| native-void-pointer | explicit `lib`, both backends | generated function names |
| ts-from-c | default `lib` | generated function names; header-local helpers and type aliases retain their names |
| windows-resource-atoms/overloads | explicit `lib`, both backends | generated function names |
| tests/workspace/apps/linux-brownfield | default `sdkStatic` | static config uses its default; shared config unchanged |

Eight LLVM native-ABI tests reuse these same C callers: native-closure,
native-string, native-callback, native-poll, native-fd,
native-pointer-constants, native-bigint-constants and native-pointer-bits.
They now resolve each fixture's real config through `nts_build::config::resolve`
and select its product through `config::product` (the named `c` product for
the three dual-product fixtures). SourceSymbols resolves that product's
namespace, and one frozen plan supplies C, LLVM and the closure-cycle caller.
The hosts are not duplicated. Native-private-names retains its separate raw
caller because that control specifically tests raw emission.

The paused Chromium runtime has separate consumers outside this inventory.
`runtime/chromium/embedder/probe.c` spells generated calls directly,
`embedder/program/check.ts` checks their old spellings, and
`tooling/chromium/app.ts` recognizes the old initializer spelling in its
module-state guard. The coordinator deferred their migration to #1006 under
the paused Chromium group #581. The owed rule names their standalone `verify.ts` workflow;
the full-check executable step list contains no Chromium execution step.

## Proof

Hand-run evidence is kept in `/home/akisarou/.cache/nts-scratch/978/`.
The focused run passed seven tests covering the C/LLVM static prefix matrix,
header and archive names, host calls agreeing with Node, libc `error` observed
on stderr both directly and through another shared object, raw emission,
initialization, and unchanged app/addon/shared-library names. The final
fragment-policy CLI suite also passed all 181 tests, including explicit
`main`/`int` prefixes and invalid-value refusals.

The regression was also run against the immutable compiler from the green
landing of `446c05700ede0775efd46d9f9fc9cfb14817f153` (compiler SHA-256
`25e1f138b63cc20282dfd3024dee1283aa54a862fad479820d996963d9770d00`).
It failed at the first archive assertion: `c_default: missing error`, because
the archive exported raw `error` instead of `c_default_error`. This comparison
ran after committing the fix, using a copied compiler and a backup of the
fixed binary. The copied immutable binary's read-only mode initially blocked
the wrapper's restoration; restoring write permission and copying the backup
back restored matching SHA-256 hashes before the subsequent fresh builds.

Before the ABI-test helper, the complete no-fail-fast inner run had exactly
eight LLVM native-ABI failures: each reused a migrated caller with raw emission.
The other targets completed, rather than being skipped after that failure.
The harness inventory check accepts 31 harnesses and 350 case files.
After the helper, all eight passed together in the complete `inner.ts --no-agree`
run. Formatting, Clippy, fresh compiler build, selected Rust tests and the
native frontend invariant check all passed. Admission waits are included in
the logged step durations.

| Evidence | SHA-256 |
|---|---|
| `focused.log` | `99485745eca746095e1aee7cbd0cee143d91483dee7ec27eaac310c0293bd03b` |
| `before.log` | `4f7076d154eb2f87a56c3121e648a071daa862e69c0e03b9b99000fdefe371fe` |
| `inner-6.log` (before ABI-test helper) | `7b50d37a15ef067e9b360b049017ba26e5f3bc9335d91e55994ed801a99482bd` |
| `inner-7.log` (complete green run) | `e5ad17eadf147654d867ab645b7066c50e316b43f1625e97653ac073db3b47e7` |
| `test-layout.log` | `d3df20f3802ae4bec5f1f6d136bf6ac2153d768a9f7b68b87be88776e735dbb6` |
