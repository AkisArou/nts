# Structural type arguments carry their own throws (#888)

The throw graph and copy lowering resolve a generic receiver at the same type
argument. The graph joins those answers at the declaration; each lowered copy
selects its own member. Stored callable properties use the existing closure
protocol, including mapped properties with no authored declaration or supplier
symbol. The resolver retains unresolved members, and ordinary lowering gives its
existing diagnostic; no extra unresolved-call cut or speculative throwing edge is
introduced.

The source pin is `52531def6af1d015a70edbc6fc4a0d85de5314e5`, digest
`413e406688bfd92b649cacf2be08c5565f390f1d79669caa112da52e163517ea`.
The baseline is `e60a93b9b2fffa31a23738a643ada3cb2dcb6ec1`.

## Fixtures

C, LLVM, JVM, C-RC and LLVM-RC agree on all 4,060 cases across nine program
fixtures and controls. The three original outcome projects agree on 435 further
cases across those modes. Nothing is refused or declined in those candidate runs.

| Program family | Cases per mode | e60a | Candidate |
| --- | ---: | --- | --- |
| Own members, including literal methods and callable fields | 348 | 65 disagreements; 87 declined | agrees |
| 70/62 structural arguments | 58 | 26 disagreements | agrees |
| Mapped/Record quiet and throwing closures | 116 | 26 disagreements | agrees |
| Mapped/Record direct-call control | 116 | agrees | agrees |
| Subclass control | 29 | agrees | agrees |
| Nested-generic control | 29 | agrees | agrees |
| Static-constructor control | 58 | agrees | agrees |
| Getter-result extraction control | 29 | agrees | agrees |
| Declared Object-method control | 29 | agrees | agrees |

The undeclared Object-method refusal is genuine: generic `toString()` on an
object with no implementation is refused identically on both pins by ordinary
lowering, with "a method `toString` with no declaration in the hierarchy". The
prepared raw HIR is byte-identical. Supplying a declared implementation agrees in
all five modes. The former mapped-property refusal is now a positive program
fixture, with quiet calls and closures throwing inside a try.

## HIR and traversal

Prepared HIR was compared for 1,135 projects: both runtime corpora and the valid
program corpus, plus the original structural outcome. All 29 runtime projects
are byte-identical to e60a. Only four regression projects change, through raising
copies, closure entries and handler tests. There are no raw-hash changes outside
those classified function changes. The declaration join retains 131 quiet raising
forms at 261 calls, confined to the regression fixtures.

`git log -S 'seen.len() >= 64'` identifies
`1d4fb556d0d9ef4b560b87422992c69b80782d96` as introducing the cutoff. Its
comment describes a cyclic-constraint guard, rather than a compile-time budget.
The visited set handles cycles; the finite snapshot and its finite source lists
bound a walk by the vertices and edges it enumerates, without returning a subset.
The 70-source probe loses 13/29 answers with the cutoff restored on the resolver;
its 62-source control agrees. Main before #888 misses both structural throws.

Temporary instrumentation measured maximum visited sets of 28 for runtime/node
and 28 for runtime/web-platform. It was restored from the scratch copy and
verified with `git diff --exit-code HEAD`. This measurement predates the last
stored-member correction; the traversal and source enumeration code are unchanged.

## Test262 records

All five recorded C families reconcile with zero changes: language 8,401,
built-ins 1,085, Annex B 12, staging 59, harness 17 (9,574 total). Each ran
against the clean source pin through the `test262-records` admission owner.

## Compile counters

Production compile-time tripwires measured the candidate and e60a for the same
34 modules in each arm. NoGC's instruction-weighted ratio is 1.00044250
(+0.04425%); RC's is 1.00037182 (+0.03718%). The largest module ratios are
1.00324162 and 1.00094781 respectively. The same 12 NoGC rows and 11 RC rows
trip on both pins. These reproduce the main-owned compile-budget debt the
coordinator attributed to #851; no budget row was changed by #888.

Counts below are billions of instructions. Ratios divide candidate by e60a.

| Module | NoGC e60a | NoGC candidate | Ratio | RC e60a | RC candidate | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| runtime/node/assert | 203.917 | 203.984 | 1.000327 | 221.457 | 221.456 | 0.999994 |
| runtime/node/async_hooks | 3.313 | 3.313 | 1.000075 | 3.809 | 3.810 | 1.000179 |
| runtime/node/buffer | 6.309 | 6.310 | 1.000266 | 7.030 | 7.028 | 0.999755 |
| runtime/node/child_process | 280.297 | 280.355 | 1.000206 | 304.438 | 304.421 | 0.999944 |
| runtime/node/cluster | 322.839 | 322.994 | 1.000482 | 348.782 | 349.112 | 1.000948 |
| runtime/node/console | 218.408 | 218.525 | 1.000535 | 236.801 | 236.961 | 1.000678 |
| runtime/node/crypto | 338.205 | 338.307 | 1.000303 | 368.525 | 368.465 | 0.999837 |
| runtime/node/dgram | 295.618 | 295.783 | 1.000559 | 320.016 | 320.107 | 1.000282 |
| runtime/node/diagnostics_channel | 2.737 | 2.741 | 1.001480 | 3.115 | 3.116 | 1.000329 |
| runtime/node/dns | 14.122 | 14.119 | 0.999812 | 15.890 | 15.885 | 0.999742 |
| runtime/node/events | 197.263 | 197.159 | 0.999472 | 214.249 | 214.187 | 0.999711 |
| runtime/node/fs | 390.402 | 391.035 | 1.001621 | 426.551 | 426.491 | 0.999859 |
| runtime/node/http | 407.128 | 407.160 | 1.000078 | 440.651 | 441.000 | 1.000791 |
| runtime/node/net | 295.769 | 295.784 | 1.000049 | 320.910 | 321.203 | 1.000915 |
| runtime/node/os | 6.570 | 6.578 | 1.001329 | 7.360 | 7.365 | 1.000640 |
| runtime/node/path | 7.553 | 7.558 | 1.000620 | 8.121 | 8.126 | 1.000606 |
| runtime/node/perf_hooks | 222.651 | 222.766 | 1.000515 | 241.929 | 241.936 | 1.000032 |
| runtime/node/process | 399.306 | 399.530 | 1.000560 | 431.888 | 432.296 | 1.000946 |
| runtime/node/punycode | 0.775 | 0.775 | 1.000402 | 0.801 | 0.801 | 1.000374 |
| runtime/node/querystring | 7.356 | 7.363 | 1.000938 | 8.156 | 8.155 | 0.999793 |
| runtime/node/readline | 233.639 | 233.891 | 1.001075 | 253.199 | 253.382 | 1.000720 |
| runtime/node/stream | 268.979 | 268.916 | 0.999764 | 291.934 | 292.019 | 1.000290 |
| runtime/node/string_decoder | 6.382 | 6.394 | 1.001931 | 7.106 | 7.110 | 1.000534 |
| runtime/node/timers | 4.725 | 4.724 | 0.999963 | 5.586 | 5.585 | 0.999819 |
| runtime/node/tty | 0.050 | 0.050 | 0.999891 | 0.051 | 0.051 | 0.999827 |
| runtime/node/url | 25.084 | 25.093 | 1.000356 | 26.906 | 26.902 | 0.999868 |
| runtime/node/util | 209.006 | 209.003 | 0.999984 | 226.659 | 226.785 | 1.000557 |
| runtime/node/zlib | 367.723 | 368.042 | 1.000870 | 396.594 | 396.752 | 1.000399 |
| runtime/web-platform | 238.744 | 238.768 | 1.000101 | 257.635 | 257.794 | 1.000617 |
| tests/compile-time/escape-analysis-scaling | 1.585 | 1.588 | 1.001427 | 2.903 | 2.789 | 0.960584 |
| tests/compile-time/evolved-type-scaling | 1.224 | 1.224 | 1.000056 | 1.243 | 1.244 | 1.000717 |
| tests/compile-time/length-fold-scaling | 7.450 | 7.450 | 1.000088 | 7.798 | 7.799 | 1.000116 |
| tests/compile-time/literal-text-scaling | 12.725 | 12.766 | 1.003242 | 14.321 | 14.317 | 0.999723 |
| tests/compile-time/scalar-replacement-scaling | 8.555 | 8.575 | 1.002281 | 9.574 | 9.557 | 0.998212 |

## Separate findings

The outcome/control pairs for the nested generic (#896), constructor-static
receiver (#915), and getter-returned callable (#921) preserve the independently
filed defects. Earlier paired probes found: #896 disagrees on all 29 inputs on C,
LLVM and their RC modes, while JVM declines with zero checked; #915 disagrees on
58/58 in every mode; #921 disagrees on 13/29 in every mode. Their controls agree.
These are separate lowering mechanisms from the actual-member resolution here.

## Raw evidence

Files are retained under `/home/akisarou/.cache/nts-scratch/888/`.
The following SHA-256 digests bind the raw output and decision tables.

| File under that directory | SHA-256 |
| --- | --- |
| `r3-final-pin.log` | `26e339bb72f3d876db48abcb59117fa8d2821a07d6ff036199cc5063a5102480` |
| `r3-final-focused.log` | `3da5d272a0e8d2f6003b1fa02b460e0eaadbb51e40e321659c0b7c1d18388a48` |
| `r3-focused-base.log` | `948534191b7f9ec65cc9866457893b55ff912aa053cab656730dea56824c766f` |
| `r3-final-original-outcomes.log` | `172b9f3eb36ac7497b04c048d052e357d057c50004d0f5bb63fb715b5cb55603` |
| `r3-final-unsupported-base.hir` | `0b45fdf44de7a90e9f2458eaff82d284dd207c8ed36266cb6ebcf61dcad1b45e` |
| `r3-final-unsupported-after.hir` | `0b45fdf44de7a90e9f2458eaff82d284dd207c8ed36266cb6ebcf61dcad1b45e` |
| `r3-final-unsupported-control-base.log` | `8ca4ad626281a61a988cd51b7d9a5dad589d5ddfbc390af63bb8e9cbeda26495` |
| `r3-final-unsupported-control-after.log` | `d6afaf6f17494e95d537ce973097398e323cd787140c18c7ed0814c7ab14144c` |
| `hir-r3-final/rows.json` | `c36fe1a9680a87ad43282119d83375b1606e23f2543e0bbbace12c3050d7bd5f` |
| `r3-final-test262.log` | `2e37d4dbd97f41b18a830cc1d458081cec17fd1e61f43275cbacd640ef4fba32` |
| `r3-final-compile-time-paired-nogc.tsv` | `11ef0066d8b8043ba6300b9d3dc4fd8f5c262d7e3cab7af5ee97b44d5c01956f` |
| `r3-final-compile-time-paired-rc.tsv` | `c7534d5259dfc667efcd04a7639e585bc2a60018b44ef3046213589351f29453` |
| `review-walk-max.log` | `702a9df519f47635ed0152685a7e43018be53ce9ace365dabd52e1ffb30ad6a8` |
| `cutoff-probes.log` | `5b10c0b979079317d7d1f4b33c10c59f077e55a9fc2d284afb2121c8c79d2560` |
| `review-final-other-outcomes-base.log` | `1b1997daeffaf510064ef76dd247cceafd9f624f675b7c6c5bdc9bf24ed54011` |
| `review-final-other-outcomes-after.log` | `9a9f6996b2786bdd66cfab7f817105ab671c56cf99f74e8b526820bbe85e929d` |
