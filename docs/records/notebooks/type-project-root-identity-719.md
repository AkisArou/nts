# Type-project transport ignores root spelling (#719 follow-up)

The first real records delta had precise identities for every product project.
Its application skipped all six type-check rows because recording used a resolved
root while the apply entry supplied a trailing separator. The checker tested
`startsWith(root + sep)`, so the doubled separator left local Program reads and
options as absolute host names. The same delta and checkout with a resolved root
apply the five products; only tooling correctly stays stale after the main move.

## Actual delta replay

The original core delta was measured at 422e0084a083 and applied at 582b7dce160e.
Its retained apply log names all six type rows as sources changed. A private Git
checkout at the exact latter source, with the records installation copied, replays
that delta without changing any shared records. Both arms restore their private
record bytes afterward.

| Root spelling at the same checkout | Applied | Skipped | Interpretation |
|---|---:|---:|---|
| Trailing separator | 1 | 6 | Oracle row applies; all type rows incorrectly miss |
| Resolved root | 6 | 1 | Oracle and five product rows apply; tooling correctly misses |

| Type project | Resolved-root digest equals original delta | Application |
|---|---|---|
| compiler/codegen/jvm/tsconfig.json | Exact | Applied |
| runtime/node/tsconfig.bindings.json | Exact | Applied |
| runtime/web-platform/test/wpt/tsconfig.json | Exact | Applied |
| tooling/conformance/ecmascript/icu-compiled/tsconfig.c.json | Exact | Applied |
| tooling/conformance/ecmascript/icu-compiled/tsconfig.jvm.json | Exact | Applied |
| tooling/tsconfig.json | Different after the actual tooling edit | Correctly skipped |

The product read graphs are not broadened to the whole repository. No product
source or diagnostic limit changes here. The five product rows remain pending;
the next ordinary records cycle owns their initial publication.

## Decision and controls

The recorder entry resolves one ROOT and supplies it to recording and applying.
The checker uses relative containment for Program reads and absolute options,
so caller spelling cannot turn a local input into an absolute host identity.
The family, core audit root, record format and may-only-fall policy stay intact.

The checker hashes itself in its recipe. Consequently the actual code change
moves all six recipe-bound keys by design. A separate private load hook executes
the exact old algorithm over the fix's unchanged on-disk inputs and recipe: its
normal-root key equals the fix for all six projects. Resolved options and module
inventories also compare equal across the real old and new commits; the five
product read maps are unchanged. Tooling's reads include the edited tool/test
files. This isolates the options replacer change without hiding the intentional
recipe change.

The six-project transport control records one real delta, compares identities
under both root spellings, applies all six rows with either spelling, and requires
identical records. The exact-main checker counterfactual fails the named
separator-identity assertion; the fixed controls pass.

| Proof | Actual result |
|---|---|
| Normal-root algorithm isolation | All six keys exact under identical fixed inputs/recipe |
| Main checker counterfactual | Named separator-identity assertion fails |
| Focused controls at cfe982516490 | 16/16; strict, timing and host audits zero |
| Existing tooling row, tool-written --record | 5,662 to 5,662 diagnostics; inventory 999 to 1,009; products pending |
| Inner at d7eb14ff16f0 | Formatting 4 s, Clippy 1 s, build 1 s, tests 363 s; green |
| Supported at ac7ce0e47897 | All 17 selected PASS: build plus 16 summary rows |
| Supported tooling | 2,805 pass, zero fail; two existing Unicode TODO |
| Supported completion | CLI 0/null; canonical, dirty 0, no experiments; complete cleanup and diagnostics; temporary removed |

For that original supported run, only records-only a6d77585a3fe followed the inner's base. All six own paths and all
1,632 Rust source blobs are byte-identical after rebase. The 976 retained actual
dep-info texts exclude that oracle-count row and the later writer-generated
selector record, with zero parsing errors. Inner stays attributed to its actual
source; it is not relabelled as a new run.

The normal selector writer retains the exact 57 targets and byte-identical full
selection payload, including every role table. Its only changed file-key row is
results/oracle-counts/benchmarks/cases/jetstream-lazy-collections.json, bringing
the inherited key current with a6's data. The production decoder verifies that
attribution. The root fix itself adds no Rust selection reach. No generated
record is hand-merged. The selector-only commit from this original writer is
excluded from the final branch, as described below.

Supported owner wall is 724.749 s, summary wall 719.955 s, and the enclosing CLI
976.122 s including its pre-run planning. There is no retry directory or killed
step. These timings describe the actual loaded run, not a performance claim.
Exact-tip metadata readiness is required separately before submission, with the
strict check last and no oracle session; inner and supported own their seals.

## Retained evidence and excluded setup failures

Raw machine evidence is
/home/akisarou/.cache/nts-scratch/719/raw-root-evidence-v1.json, SHA-256
87922195cbf2317cfae2b49164132cf45fbea7a4c50b8c95545581e3436c2d6b.
It binds 1,161 artifacts / 26,082,760 bytes and 133 Git receipts, including the
explicit absence of this new record. Independent verification reports zero
errors. Source revisions remain under refs/cited/719-root-evidence-*.

The actual supported run is
/home/akisarou/.cache/nts-landing/runs/here-ac7ce0e47897-1794839185153.
The original delta and real apply log are bound by the manifest; the private
replay is apply-root-attribution-v1/result.json. Its SHA-256 is
790d55fbd8c29bd68f7940c6edfeae42250e7e4c4ea10e15ecb1caa9b4d33754.

The first normal-identity probe failed generated-loader syntax before computing
identities. Its successor uses literal generation and checks both generated
modules before running. Supported V1 refused an existing scratch directory
before launching the CLI; the old evidence was untouched. Both failures remain
separate and are excluded from the green proof. No cap, floor, timeout, compiler,
product behavior or recorded benchmark policy changes.

## Accepted-record rebase after the first queue

The first queue, a9a991c5f245-c3092303, rebased onto records-only
1d3edbc4e84d and checked c236813e4707. That intervening records commit changed
the same jetstream-lazy-collections oracle-count input that the branch writer
had refreshed for a6. The records guard correctly refused the edited stale
selector candidate. The complete run also had an independent oracle image
disposal assertion failure at oracle-dependencies.test.ts:138, with 2,804
tooling passes, one failure and the two existing Unicode TODOs. Both failures
remain excluded from green proof; cleanup and diagnostics completed. The
process-observation correction at 687d4d446f53 (Part of #797) owns the
oracle-dependencies:138 failure; its supplied process view removes this
fixture's machine-wide process-scan dependency without weakening the guard.

The accepted retry drops the selector-only commit and inherits main's exact
rust-runtime.json. The root fix itself changes no selector input or target role;
the earlier writer/production-decoder comparison established that its only
changed key row was the intervening oracle-count input. An unchanged accepted
record may remain stale-live, with conservative selection. No guard is relaxed,
no record is deleted and no key is hand-edited. #798's normal writer owns the
next refresh.

The clean rebase at f14b452dff58 retains all seven code/record/doc blobs exactly
from the previously authenticated tip. All 1,632 Rust source blobs equal actual
inner source d7eb14ff16f0. The 976 retained dependency texts exclude the only
later input, the oracle-count file. Inner and the focused controls stay bound
to their actual original sources.

| Repeated proof at f14b452dff58 | Actual result |
|---|---|
| Supported selection | All 17 selected PASS: build plus 16 summary rows |
| Tooling | 2,805 pass, zero fail; two existing Unicode TODOs |
| Completion | CLI 0/null; canonical, dirty 0, no experiments |
| Cleanup | Complete scope cleanup and diagnostics; temporary removed; unit inactive |
| Actual wall | Landing owner 653.572 s; summary 648.718 s; CLI 866.589 s including planning |

These are loaded-run observations, with no speed claim. The exact supported run
is /home/akisarou/.cache/nts-landing/runs/here-f14b452dff58-1794842599540.
The original manifest above remains immutable. Its finite supplement is
/home/akisarou/.cache/nts-scratch/719/raw-root-post-records-evidence-v1.json,
SHA-256 a1b7b13f7df907eb5fa1b51e8f89c6a3ec98e9112c839a70219d48a40377f427.
It binds 98 artifacts / 8,704,931 bytes and 36 Git receipts, including the
accepted-record equality, rebase/dependency comparison, refused queue and actual
repeated supported run. Verification of both manifests reports zero errors.
Exact-tip metadata readiness is repeated after this Markdown-only supplement,
with the strict check last; it starts no oracle session.
