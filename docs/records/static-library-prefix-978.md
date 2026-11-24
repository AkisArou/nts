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

Review tightened fragment validation to include the separating underscore.
`nts`, `nts_*`, `_`, `__*` and `_` followed by uppercase are reserved. Explicit
values refuse by value; defaults escape with `product_`. This keeps products
named `nts` or `nts_str` from defining runtime symbols such as `nts_checkpoint`,
`nts_release` or `nts_str_slice`, and keeps `_` from creating `__error`.

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
| tests/workspace/apps/linux-brownfield | explicit `acme` | both product configs express `acme_<C name>`; static applies it, shared emission pending #1005 |

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

The single requested landing-plan retry succeeded. Both selector records were
accepted as `stale-live`, and the earlier child-process `Unexpected EOF` did
not recur. Its plan defers interop, so the entire interop step was run
separately with the freshly built `nts-dev` compiler: PASS, 429 seconds of
execution, no failed fixtures. Both C and LLVM product callers passed,
including the overload host before its Windows-only execution skip. The
usual unavailable Mac/Windows execution skips remain. This standalone run
selects a compiler explicitly and is experimental evidence; the canonical
landing check is separate.

The first canonical check completed with 22 passing steps and only `records`
failing. The branch predated the accepted census refresh in `dc669ade61`;
changing the CLI producer made those old rows stale, and the census owner
correctly refused their hashes against newer accepted main. The coordinator
confirmed this cause. Rebasing onto `2017bf23a3de` carried the accepted records
and #936's revert forward without conflicts; no records were deleted and no
gate scripts changed. The first check's summary is
`/home/akisarou/.cache/nts-landing/runs/here-6f3de5ba6e61-1795493495170/summary.json`
(SHA-256 `27e78893beab6a87b2ee7aa146159dd8c3458fa39e4b51786c216c83d9605015`),
with `records.log` alongside it
(`7929644a243cdd6a3a1db2dc4a0996dea21ad477feba853b2ea36ede8fe09005`).

| Evidence | SHA-256 |
|---|---|
| `focused.log` | `99485745eca746095e1aee7cbd0cee143d91483dee7ec27eaac310c0293bd03b` |
| `before.log` | `4f7076d154eb2f87a56c3121e648a071daa862e69c0e03b9b99000fdefe371fe` |
| `inner-6.log` (before ABI-test helper) | `7b50d37a15ef067e9b360b049017ba26e5f3bc9335d91e55994ed801a99482bd` |
| `inner-7.log` (complete green run) | `e5ad17eadf147654d867ab645b7066c50e316b43f1625e97653ac073db3b47e7` |
| `test-layout.log` | `d3df20f3802ae4bec5f1f6d136bf6ac2153d768a9f7b68b87be88776e735dbb6` |
| `plan-retry.log` | `7db724f3a0df2f3f64e602bdff5877130479f7c3996f41182fee1632f33a843a` |
| `interop.log` (runner) | `25cb2327e80a72c85a01f68a5fb156c24063635b7567836cc288a28b6de38c80` |
| `interop-run/interop.log` (fixtures) | `a1b6e3da69cbd8ccbdf18194a581a0b0279a6311d869000bbdfdaed29720047d` |
| `interop-run/summary.json` | `c8550de1c7a8e131182c17e482b5cce709b0a22aff4a7212e5bc1b930120e8d3` |

## Review controls

Review of `870a1e99917cfec2efa35e8ade96aa8f03e40493` found that the prefix
fragment could itself enter the runtime namespace or complete C's reserved
double underscore. The expanded unit/refusal tables cover `nts`, `nts_str`,
`nts_`, `_`, `__` and `__private`, alongside the earlier controls. The host
matrix now includes reserved default product names and source exports named
`checkpoint`, `release` and `slice`: archive names, generated headers and host
results agree with the escaped policy on C and LLVM, while libc still answers.
The brownfield workspace check also asserts `acme_remember` in the static
header. Header initializer prose reads the frozen name and distinguishes
load-time construction from a raw caller's initialization responsibility.

All four focused tests passed. Against the reviewed compiler (SHA-256
`0c659209ab3829eb08f94b5380ab3e72f0e36c8763bcedf2f4fb7de1ed09084d`),
both prefix tests failed: explicit `nts` was accepted, and the default `nts`
product failed compilation with conflicting types for `nts_release`.
The comparison ran after committing the fixes, from a backed-up binary;
restoration completed with matching SHA-256
`7b5cef2e04d451fed5275301c755a760d5dcb8bb0ac618587e56411ec5bebc39`.

The complete inner run passed formatting, Clippy, fresh build, all selected
Rust tests and the native frontend check. Full interop passed again (537
seconds execution), including C and LLVM callers, with the usual unavailable
Mac/Windows execution skips. These standalone focused/interop runs select the
fresh compiler explicitly; the canonical landing check remains separate.

| Review evidence, under the same scratch directory | SHA-256 |
|---|---|
| `review-focused.log` | `dfe58c248ee88b40da0fa44eb99c8bdf619d83e8e8913e2701df64c667227efe` |
| `review-before.log` | `f3b83ee2e9a9c93357c948f7d891d252b65bdf3756d3a076920ec89a104ebf9e` |
| `review-inner.log` | `8e38a6e2e6459048ba0fecab72e0057240600712b8fb877f4a81403e8c32f30f` |
| `review-interop.log` | `66e806de61465bdae80cb4096942470eb93b55196655794343cc42c112469cba` |
| `review-interop-run/interop.log` | `97ba77446d9bb6206aabace0388fa997ec1b09ead2b876acf147e72beab9d0cb` |
| `review-interop-run/summary.json` | `224bb32aaf1c4b0801b54d68ae0cfe8e192b127342f9d51aaace43f5be518b5d` |

## Native-call namespace controls

LLVM's foreign declaration check still compared native callees with each
compiled function's original C spelling. It did not consume the frozen
SourceSymbols plan, so it rejected a prefixed `abs` export calling libc's
`abs`, while missing a native call colliding with the prefixed spelling.
The check now receives the emission and compares the frozen function names
over the same native-function set C checks.

The static-product matrix now exports `abs(n: c_int)` calling `c:stdlib`'s
`abs`. Its fixture includes the native ambient declarations. Both default
and explicit prefixes on C and LLVM pass the archive/header checks and the
linked hosts. The hosts call both the generated export and libc's `abs`, the
latter through a volatile function pointer; their answers agree with Node's
`Math.abs` oracle. The existing libc `error` and host-owned-name controls
also pass.

Two direct emitter tests compare the same prepared program on C and LLVM,
so C-first product emission cannot hide LLVM's collision policy:

| Export / native callee | Prefix | C and LLVM |
|---|---|---|
| `abs` / `abs` | raw emission | refuse collision |
| `abs` / `abs` | `lib` | accept |
| `twice` / `lib_twice` | raw emission | accept |
| `twice` / `lib_twice` | `lib` | refuse collision |

All six focused tests passed. The counterfactual ran after committing the
fix and fixture and separately reading the commit: the immutable compiler
pin from the green check of
`a509a6b0192a316816d00a641190ab7f34f96bd0` (SHA-256
`7b5cef2e04d451fed5275301c755a760d5dcb8bb0ac618587e56411ec5bebc39`)
failed the extended product matrix with the foreign `abs` collision on
LLVM. With only `native.rs` copied from that revision, both direct tests
failed on LLVM: the legal prefixed wrapper was refused and the real
prefixed collision was accepted. Backups restored the compiler and source
byte for byte; no checkout or stash was used.

The complete `inner.ts --no-agree` run on
`55672c14412c7d08020740d2958b6c2334b4531f` passed formatting, Clippy, the
fresh compiler build, all selected Rust/backend tests and the native frontend
check. Its LLVM integration harness passed all 222 tests, including both
new controls. The frontend phase's duration includes its admission wait.

| Native-call evidence, under the same scratch directory | SHA-256 |
|---|---|
| `native-focused-2.log` | `e034822eaf81d4869beb473631401c72b0d9264cd7094ac7bf78c13f83e670d5` |
| `native-counterfactual.log` | `feaa433bda6e3bdfc945038c927ef17be1e511b8272945a52b3f5d66cbbd593d` |
| `native-inner.log` | `a451d65a8a0149d62502b81548f068facce9ae3636e3360138070416320ca398` |
