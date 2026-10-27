# Count-free sort verification

The source commit is byte-identical to the measured checkpoint 3f25d11da; the series puts results last. Native timing compares against the landed typed-release pin 1612a840b.

Rust format, workspace clippy with warnings denied, the touched/core and all four backend test crates, and the native frontend tests passed (1,849 tests in the Rust inner run). After rebasing onto the landed typed-release base, the executed sort sanitizer/collection test and typed-release descriptor/ABI test passed again. The whole workspace was built with plain cargo build --release before preparing the paired binaries.

The native guard covers C and LLVM, NoGC and counted POISON with ASan/UBSan. It forces a real collection at closure entry, including partial merge states, and checks zero RC storage after each iteration. The raw-HIR guard distinguishes the old managed merge stores from the two uint32 buffers. Focused agreement covers all eight fixture exports on four backends and both native RC arms (232 comparisons per arm); the previous compiler preserves answers but fails the new storage-shape guard.

## Recorded test262 sets

Every recorded outcome reconciles unchanged: no regression, changed, new-fail or missing row. Passing and recorded-failing outcomes are kept distinct. Existing pass-floor and accepted-negative warnings were not re-recorded in this change.

| Set | Pass | Recorded cases |
|---|---:|---:|
| language | 6974 | 8367 |
| builtins | 828 | 1034 |
| annexB | 9 | 12 |
| staging | 53 | 58 |
| harness | 17 | 17 |

## Broad before/after comparisons

| Backend | RC | Unchanged examples | Regressed / changed / unstable / not measured |
|---|---|---:|---|
| c | off | 769 | 0 / 0 / 0 / 0 |
| llvm | off | 769 | 0 / 0 / 0 / 0 |
| jvm | off | 769 | 0 / 0 / 0 / 0 |
| wasm | off | 769 | 0 / 0 / 0 / 0 |
| c | counted + POISON | 769 | 0 / 0 / 0 / 0 |
| llvm | counted + POISON | 769 | 0 / 0 / 0 / 0 |

Wasm preserves the known array-with typed-hole backend refusal in both compilers. On the other arms, 747 examples agree fully, ten are partial and twelve publish nothing that the differential drives. The comparison checks those partial and empty outcomes too; unchanged is not a claim that every example fully agrees. No new wrong or unmeasured outcome appears.

## Runtime corpus

The gate's c-compiles command ran over every runtime project with both compilers. The separate refusal-state comparison and counted emitted-program comparison cover runtime/node plus web-platform. Raw outputs and the exact commands are retained in the scratch directory below.

### c-compiles-before

```text
compiler /home/akisarou/.cache/nts-pins/1612a840bb06/nts (sha256:82f82c4cf310eb42), clang -std=c11 -fsyntax-only
  29 of 29 project(s) compile, 90.4 MB of C, 0 reused emissions, in 269 s
```

### c-compiles-after

```text
compiler /home/akisarou/Projects/nts-lanes/compiler-helper/target/release/nts (sha256:15ba76aa1f87884a), clang -std=c11 -fsyntax-only
  29 of 29 project(s) compile, 90.5 MB of C, 0 reused emissions, in 303 s
```

### refusals

```text
before /home/akisarou/.cache/nts-pins/1612a840bb06/nts
  after  /home/akisarou/Projects/nts-lanes/compiler-helper/target/release/nts
  before from 1612a840bb06
  after  from provenance unknown: not built by pin.ts
  29 of 29 project(s) compared; 0 move(s) to a loss
```

### emitted-rc

```text
before /home/akisarou/.cache/nts-pins/1612a840bb06/nts, after /home/akisarou/Projects/nts-lanes/compiler-helper/target/release/nts (both pinned), 29 project(s) in 392 s
  before from 1612a840bb06
  after  from provenance unknown: not built by pin.ts
  provider: reference counting (--rc)

  runtime/node/assert
    functions  5 changed, 0 added, 0 removed, of 1345; +3878 bytes
    helpers    nts_array_new 194 -> 206, nts_array_slice_ref 21 -> 15, nts_retain 1208 -> 1202, nts_release 3608 -> 3610
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/node/child_process
    functions  5 changed, 0 added, 0 removed, of 1806; +3878 bytes
    helpers    nts_array_new 237 -> 249, nts_array_slice_ref 23 -> 17, nts_retain 1464 -> 1458, nts_release 4671 -> 4673
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams____search_params__sort

  runtime/node/cluster
    functions  7 changed, 0 added, 0 removed, of 1949; +5071 bytes
    helpers    nts_array_new 252 -> 268, nts_array_slice_ref 30 -> 22, nts_retain 1581 -> 1573, nts_release 5064 -> 5066
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, PerformanceObserverEntryList__constructor, URLSearchParams____search_params__sort, filterBufferMapByNameAndType

  runtime/node/console
    functions  5 changed, 0 added, 0 removed, of 1380; +3878 bytes
    helpers    nts_array_new 198 -> 210, nts_array_slice_ref 21 -> 15, nts_retain 1237 -> 1231, nts_release 3722 -> 3724
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/node/crypto
    functions  5 changed, 0 added, 0 removed, of 1963; +3878 bytes
    helpers    nts_array_new 294 -> 306, nts_array_slice_ref 31 -> 25, nts_retain 1645 -> 1639, nts_release 5205 -> 5207
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/node/dgram
    functions  7 changed, 0 added, 0 removed, of 1931; +5071 bytes
    helpers    nts_array_new 243 -> 259, nts_array_slice_ref 28 -> 20, nts_retain 1557 -> 1549, nts_release 4832 -> 4834
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, PerformanceObserverEntryList__constructor, URLSearchParams____search_params__sort, filterBufferMapByNameAndType

  runtime/node/dns
    functions  3 changed, 0 added, 0 removed, of 723; +1357 bytes
    helpers    nts_array_new 84 -> 88, nts_array_slice_ref 6 -> 4, nts_retain 338 -> 336
    in         (declarations), PerformanceObserverEntryList__constructor, filterBufferMapByNameAndType

  runtime/node/events
    functions  5 changed, 0 added, 0 removed, of 1313; +3878 bytes
    helpers    nts_array_new 194 -> 206, nts_array_slice_ref 21 -> 15, nts_retain 1189 -> 1183, nts_release 3472 -> 3474
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/node/fs
    functions  5 changed, 0 added, 0 removed, of 2127; +3878 bytes
    helpers    nts_array_new 275 -> 287, nts_array_slice_ref 24 -> 18, nts_retain 1671 -> 1665, nts_release 5360 -> 5362
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams____search_params__sort

  runtime/node/http
    functions  7 changed, 0 added, 0 removed, of 2155; +5071 bytes
    helpers    nts_array_new 283 -> 299, nts_array_slice_ref 32 -> 24, nts_retain 1771 -> 1763, nts_release 5761 -> 5763
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, PerformanceObserverEntryList__constructor, URLSearchParams____search_params__sort, filterBufferMapByNameAndType

  runtime/node/net
    functions  7 changed, 0 added, 0 removed, of 1906; +5071 bytes
    helpers    nts_array_new 245 -> 261, nts_array_slice_ref 28 -> 20, nts_retain 1546 -> 1538, nts_release 4832 -> 4834
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, PerformanceObserverEntryList__constructor, URLSearchParams____search_params__sort, filterBufferMapByNameAndType

  runtime/node/perf_hooks
    functions  7 changed, 0 added, 0 removed, of 1509; +5068 bytes
    helpers    nts_array_new 198 -> 214, nts_array_slice_ref 26 -> 18, nts_retain 1318 -> 1310, nts_release 3867 -> 3869
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, PerformanceObserverEntryList__constructor, URLSearchParams__sort, filterBufferMapByNameAndType

  runtime/node/process
    functions  7 changed, 0 added, 0 removed, of 2200; +5071 bytes
    helpers    nts_array_new 290 -> 306, nts_array_slice_ref 30 -> 22, nts_retain 1743 -> 1735, nts_release 5778 -> 5780
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, PerformanceObserverEntryList__constructor, URLSearchParams____search_params__sort, filterBufferMapByNameAndType

  runtime/node/readline
    functions  5 changed, 0 added, 0 removed, of 1630; +3878 bytes
    helpers    nts_array_new 211 -> 223, nts_array_slice_ref 22 -> 16, nts_retain 1370 -> 1364, nts_release 4175 -> 4177
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/node/stream
    functions  5 changed, 0 added, 0 removed, of 1702; +3878 bytes
    helpers    nts_array_new 231 -> 243, nts_array_slice_ref 21 -> 15, nts_retain 1390 -> 1384, nts_release 4274 -> 4276
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/node/util
    functions  5 changed, 0 added, 0 removed, of 1370; +3878 bytes
    helpers    nts_array_new 196 -> 208, nts_array_slice_ref 21 -> 15, nts_retain 1222 -> 1216, nts_release 3648 -> 3650
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/node/zlib
    functions  5 changed, 0 added, 0 removed, of 1729; +3878 bytes
    helpers    nts_array_new 237 -> 249, nts_array_slice_ref 21 -> 15, nts_retain 1406 -> 1400, nts_release 4476 -> 4478
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  runtime/web-platform
    functions  5 changed, 0 added, 0 removed, of 1340; +3878 bytes
    helpers    nts_array_new 246 -> 258, nts_array_slice_ref 22 -> 16, nts_retain 1614 -> 1608, nts_release 4315 -> 4317
    in         (declarations), CookieJar__evict, CookieJar__evict____raises, Headers______private#_u#a___sorted, URLSearchParams__sort

  of 29 measured project(s), under reference counting: 18 emit a different program, 0 the same program renumbered, 0 the same program refusing differently, 11 byte-identical with the same refusals
  the compiled axis for them: add --axis (assert child_process cluster console crypto dgram dns events fs http net perf_hooks process readline stream util zlib)
```

The source dry run and the source-plus-results dry run owe the same compiler checks; results add only the nine tree checks, all green. No gate selector or recorded baseline was edited.

Raw checks: /home/akisarou/.cache/nts-scratch/runtime-20261027/count-free-sort-validation2 and /home/akisarou/.cache/nts-scratch/runtime-20261027/count-free-sort-runtime-audit. Paired raw data and exact workload commands: /home/akisarou/.cache/nts-scratch/runtime-20261027/count-free-sort-ab. No later integer-cursor or C comparison mechanism is included.
