# Owned landing payloads and preparation identity (#912, slice 1)

This slice establishes the ownership protocol for a surviving host. Preparation
retains the backend identity beside the product roots, using the existing
backend enum. `Func::raises` is required in every constructor and preserves the
builder's exception mode through clones and adapters. Seeding published raising
entries, sharing their bodies and narrowing #900's guard belong to activation;
the guard retains its current behavior in this slice.

`nts_uncaught` takes ownership of its thrown argument on every product, matching
`nts_raise`. A landing moves it into `landing->thrown`. The Node-API wrapper
converts it and calls `nts_value_release` once, including conversion failures
and registered foreign handle families. Unhandled-promise delivery retains its
borrowed reason; the callback path already owns its `nts_raise_take` result.

Compiled uncaught calls pass no separate message. Reading a message after
erasing its object kept the original reference alive beside the handover, and
the landing skipped its release. The runtime instead uses #478's descriptor
`message_offset`, or the JVM's existing `NtsThrownMessage` protocol. Both use
the layout owner's fixed string projection, without a getter or conversion.

## Pins and payload sensitivity

The clean baseline is `2fb3e0ce967509ce532d41eee6e91d739b0f4c8a`; the clean
candidate is `ae3482724baefb49c3e2186a135b7cf4641fbe23`. Their binary SHA-256s
are respectively `b11353cca6dc2a610103180b20e043f373a7e607536398611d6cb3a5b9593ccb`
and `a14eedf26b763af54f80f109170256b4f23689cce842ffcd40d492e8826f8a50`.

Each arm runs 100 calls in a fresh Node process, with reference counting,
poisoning and forced collection. C and LLVM give the same results:

| Arm | Baseline live bytes | Candidate live bytes | Baseline foreign references | Candidate foreign references |
|---|---:|---:|---:|---:|
| Return control | 0 | 0 | 0 | 0 |
| Throw borrowed string | 0 | 0 | 0 | 0 |
| Throw fresh string | 4,800 | 0 | 0 | 0 |
| Throw fresh RangeError | 11,200 | 0 | 0 | 0 |
| Convert foreign payload | 0 | 0 | 100 | 0 |
| Fail foreign-payload conversion | 0 | 0 | 100 | 0 |

The failure arm forwards the real Node-API call except when it deliberately
makes `napi_create_error` fail. The production converter's early return still
runs, and the wrapper releases through the registered family. The borrowed
string arm checks the landing and argument cleanup each release their own
reference. The Rust integration case checks the baseline after every call.

The initial fixture exported `error`, which bound to glibc's symbol. #972 owns
that defect; this fixture uses `throwError`. Its original input and failing raw
output are retained in `~/.cache/nts-scratch/972/`.

Thirty before/after uncaught-text observations agree exactly: five controls
on C, LLVM and the JVM, using each pin. They cover a source Error subclass,
provided RangeError, string, non-error object with a fixed message, and the same
object with a differently named field. Status is 1, stdout is empty and stderr
is unchanged. The JVM checks exercise its value-owned message protocol.

## Prepared HIR

The capture covers 30 runtime corpora and 1,114 program configurations. Each
program has open and closed Entry views. The intentionally invalid program's
two views are unchanged pre-lowering declines: identical exit 1, stdout and
stderr. They are reported separately from the 2,256 prepared views.

The 106,667 function views retain identical function sets and order. Of the
prepared views, 1,793 are byte-identical and 463 contain only the approved
exception-path changes. All 6,328 changed function views are listed by name,
with raw diffs, in the evidence below. The comparison permits:

- An owned-argument retain or move at `nts_uncaught`.
- The detail projection becoming typed null, including counting operations
  serving only the removed projection. A constant-folded detail must be the
  value stored in the thrown object's field.
- Consistent SSA ordinal normalization when removing counting operations
  renumbers later values. String literals, operators and operand graphs remain
  exact; raw diffs retain the original ordinals.

Every other operation and every analysis fact, read count, budget and cleanup
elision stays identical. Fourteen field-read-contract records update only
`body_sha256`, and only for functions whose changed bodies passed the rules
above. Their other decoded fields remain identical.

The checker has positive and adverse controls, including an unrelated detail
string, another use of a projected value, a changed callee, a normal-path
counting change, a changed literal, an unvalidated body hash and altered facts
or budgets. A real known-identical pin pair produces two exact views.

### Positive visit-count deltas

Contents analysis runs after counting insertion. These are the only increases,
each on both the open and Entry view. The per-function ledger retains every
addition and removal:

| Program | Validated exit-path changes | Net visits |
|---|---|---:|
| `a-printer-throw-reaches-its-language-caller` | `Printer#toString` and `#into`: retain borrowed receiver field `%10`; `retryCase`: remove release of owned `nts_raise_take` result `%61` | +1 |
| `a-uniform-call-binds-defaults-once` | `Closure5#call`: retain `%2`, the erased borrowed receiver field, immediately before handover | +1 |
| `calls-a-region-could-serve` | `lowerOfMade#region`: materialize one private typed-null detail; the old detail had folded to an existing operand | +1 |

The final audit admits exactly the four owned-retain views, checking their
exact op lists, borrowed-field producers, net +1 and unchanged remaining
outside text. The other two views are bounded by their one new null operation.
Increases beyond those validated exit-path operations are rejected.

### Runtime corpus visit counts

The table below is generated from the retained before/after listings. It
reports analysis work, not a runtime instruction cost.

| Corpus | Contents visits before → after | Δ | Accumulator visits before → after | Δ |
|---|---:|---:|---:|---:|
| runtime/ecmascript | 48,836 → 48,807 | -29 | 91,880 → 91,880 | +0 |
| runtime/node/assert | 103,245 → 102,657 | -588 | 123,853 → 123,853 | +0 |
| runtime/node/async_hooks | 10,369 → 10,166 | -203 | 14,714 → 14,714 | +0 |
| runtime/node/buffer | 11,989 → 11,772 | -217 | 20,468 → 20,464 | -4 |
| runtime/node/child_process | 91,781 → 91,123 | -658 | 148,474 → 148,470 | -4 |
| runtime/node/cluster | 100,210 → 99,447 | -763 | 163,395 → 163,391 | -4 |
| runtime/node/console | 81,019 → 80,464 | -555 | 131,913 → 131,913 | +0 |
| runtime/node/crypto | 101,501 → 100,543 | -958 | 199,105 → 199,087 | -18 |
| runtime/node/dgram | 96,449 → 95,665 | -784 | 156,099 → 156,095 | -4 |
| runtime/node/diagnostics_channel | 7,740 → 7,553 | -187 | 11,852 → 11,852 | +0 |
| runtime/node/dns | 29,538 → 29,289 | -249 | 33,561 → 33,561 | +0 |
| runtime/node/events | 101,617 → 101,034 | -583 | 121,494 → 121,494 | +0 |
| runtime/node/fs | 109,758 → 108,952 | -806 | 211,237 → 211,219 | -18 |
| runtime/node/http | 117,334 → 116,483 | -851 | 224,942 → 224,924 | -18 |
| runtime/node/net | 97,491 → 96,773 | -718 | 157,542 → 157,538 | -4 |
| runtime/node/os | 19,431 → 18,957 | -474 | 20,843 → 20,839 | -4 |
| runtime/node/path | 8,552 → 8,372 | -180 | 15,691 → 15,691 | +0 |
| runtime/node/perf_hooks | 81,489 → 80,837 | -652 | 137,365 → 137,365 | +0 |
| runtime/node/process | 120,241 → 119,120 | -1,121 | 222,295 → 222,277 | -18 |
| runtime/node/punycode | 869 → 864 | -5 | 1,709 → 1,709 | +0 |
| runtime/node/querystring | 30,347 → 30,125 | -222 | 27,876 → 27,872 | -4 |
| runtime/node/readline | 85,078 → 84,472 | -606 | 140,007 → 140,003 | -4 |
| runtime/node/stream | 87,183 → 86,562 | -621 | 173,969 → 173,951 | -18 |
| runtime/node/string_decoder | 11,995 → 11,778 | -217 | 20,478 → 20,474 | -4 |
| runtime/node/timers | 12,388 → 12,185 | -203 | 18,009 → 18,009 | +0 |
| runtime/node/tty | 24 → 24 | +0 | 53 → 53 | +0 |
| runtime/node/url | 19,339 → 19,125 | -214 | 36,934 → 36,930 | -4 |
| runtime/node/util | 78,220 → 77,706 | -514 | 126,792 → 126,792 | +0 |
| runtime/node/zlib | 100,143 → 99,363 | -780 | 190,646 → 190,628 | -18 |
| runtime/web-platform | 92,425 → 91,810 | -615 | 143,362 → 143,356 | -6 |

## Validation and evidence

The full `inner.ts --no-agree` run is green: formatting, clang-format, Clippy,
fresh compiler build, all touched crates and backend tests. The new payload,
uncaught-text and counting-move controls pass. The counting expectation change
is a separate commit with each removed uncaught release enumerated.

The five C test262 records (language, built-ins, annexB, staging and harness)
pass against the clean candidate pin: zero regressions, changed results,
missing cases or unstable outcomes. The landing-check result is reported
separately with the submitted commit.

Raw output is under `~/.cache/nts-scratch/912/`. The original captures and
initial strict checker results remain intact; the separately hashed checker
and final bounded audit re-analyze those captures without changing them.

| File | SHA-256 |
|---|---|
| `slice1-inner-6.log` | `4d78643f16cc24b4421d29b335dbf2c7df5892111fc576ad6465b8026b45610c` |
| `slice1/hir-final-audit/summary.json` | `de9edb25a7601213fea420dfb0c30fb72f4f6cf7f02d01feb28063f76c011484` |
| `slice1/hir-complete-v3/changed-functions.jsonl` | `31b1d91947da8fada0dea15e9f6061b1611ef4d2537cb45dbb79775cb18adff3` |
| `slice1/hir-complete-v3/changed-functions.tsv` | `8d64d4aa08b0f76d51045d1f674cb96eaaf17fef708980408240ee1b22e17f5b` |
| `slice1/hir-complete-v3/analysis-visits.jsonl` | `191e9b103803d3f602e148f5079c0c4514a01e9d1910f16226007b9ad10a42b9` |
| `slice1/hir-complete-v3/body-provenance.jsonl` | `783c79a8ac93b2669e139e0029db617e02be07e2e802c5d50d88c1fdaa429e80` |
| `slice1/hir-complete-v3/new-null-details.jsonl` | `1c8b862de2262fb1b80b71d9a1a7318de1d07a23837f9cd869024861cf9ebff5` |
| `slice1/hir-final-audit/visit-increase-exit-ops.jsonl` | `f978656e05cabcac4943412cabb02ed778f9f706d3c092bb8801a0e55688ba28` |
| `slice1/corpus-visit-counts.json` | `7d1dffad0cee05db00a0fd451462ca545794d8d59dd3295ec3aa933e0581e49d` |
| `slice1/payload/before-2fb3e0ce96/summary.json` | `aa12bdab8e109438452273a793fa672948cb327a61c7400d1108d552f21de1a0` |
| `slice1/payload/after-ae3482724b/summary.json` | `bb3c4e23372ec994fac467651053ad23295ae1988b3c1ff233e93e247360eee4` |
| `slice1/uncaught-text/summary.json` | `b9e8afcd698de5bb2cfe86c67b56416b82e6e0bb5b08f0584296fc3a4e18d6cc` |
| `scripts/slice_hir_compare_v3.py` | `f90ca6cbcb9c48d0d686dc1755807080ebf14a5444bf3d44fe967f74da35bc27` |
| `scripts/finalize_hir_v3.py` | `bc2f87c7bd28e9467dcb2ca0b7855f81c68366593abdf4f728010d79762ab354` |
| `slice1/hir-validator-controls-v3.json` | `cd17d43df328867b9060cf9fc5dd08faf0cea082efc3cf69bde02c2ff0b14d17` |
| `slice1/hir-complete/results.jsonl` | `abb0bf3749a3021d798e49340ccafa676ca1c9811cc7aecb1c1d9d2a8225c650` |
| `slice1/hir-complete-v3/summary.json` | `dd0e0c0a88fa662d2509e5ab0827be6c4a33aeee739ffcc893b83f980e07d236` |
| `slice1/hir-complete-v3/pre-lowering-declines.jsonl` | `dfc1515976edeac48355f04264dfe5036d7e235bd0e403abfd4822d5559478e5` |
| `scripts/validate_hir_captures_v3.py` | `10c877c9a057455622dd850af4f9f576a8492ac979bd3885633e9860d5b9bb18` |
| `scripts/slice1-hir-controls-v3.py` | `2f376cb90164e557356948bb282b14992173c341e3c124d05d5533957f87206f` |
| `scripts/slice1_payload.py` | `cab9cd281bc6307802388311be2ad3ab29216ef6a60647fd0eb1d70f6cfad1b0` |
| `scripts/slice1-text.py` | `aedfa55d5854c663eca22bef83195524a296f6b0e08c79ebf2f769b842d1af74` |
| `slice1/test262-language.log` | `e20e0f1ebaaad7c0fb54d7ec2d80c7c8ba7b1bdbddd7dc443150f1f3156af4fc` |
| `slice1/test262-builtins.log` | `7fc134faf5efde28b8c2a38986f4ebf8fcd190b019df23438b12c55e25081321` |
| `slice1/test262-annexb.log` | `1053d82382ab929732b2b0d6ba50aeb3f2ef9272d5246dd89b2d8f4de65a69a5` |
| `slice1/test262-staging.log` | `522fd7bc852899e10bd507fb37ad447022d397035f29457c238219ff544eabf6` |
| `slice1/test262-harness.log` | `916f6dc113facd2a3f0ef5ded739d2051f85636b0231999167d60022faf8e5ad` |
