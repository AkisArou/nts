# Native environment read audit

Pin: bb5c6037ad04decdd7c5832997e810000e85943d; the actual 21-crate
compiler dependency closure (project/LS/LSP are absent). Production source
and build-script `std::env::var` / `var_os` calls are listed below, including
indirect keys of the native lazy-member and platform-cache helpers.

Before native initialization, nts snapshots every TSRS_* value (including
unknown future keys) as exact OsString bytes. Unreachable host settings and Rayon parser-worker
count are excluded; explicit checker count belongs to a separate native pool.
Session::cache_identity includes this immutable fingerprint, vendor manifest,
adapter sources/dependency lock/compiler identity, pinned checker mode,
compression/shared-graph build modes, cwd, library override and checker count.
No environment variable is changed. A subsequent environment change is an
assertion failure, preventing a stale identity from describing live reads.
Reachable set TSRS knobs produce one owned Message diagnostic (code 0) per
variable for the CLI to print as a note; diagnostics are deduplicated.
Canonical history is pinned with a public native setter; stable type ordering
is pinned in each program's native compiler options.

The build excludes shared-graph. TSRS_SHARED_GRAPH=1 may reach the upstream
reader (which emits its own disabled-feature message), but cannot enable the
graph. Child-process tests verify identical 1/4-checker facts both unset and
set, and distinct cache identities. They never mutate the parent environment.

| Native call site | Environment key(s) | Disposition |
| --- | --- | --- |
| third_party/tsrs/crates/tsrs_checker/src/checker.rs:1819 | `TSRS_DEEP_NESTED` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/checker_09.rs:3525 | `TSRS_LAZY_UNAFFECTED` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/flowmemo.rs:53 | `TSRS_FLOW_MEMO` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/flowmemo.rs:64 | `TSRS_FLOW_MEMO_BITS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/infermemo.rs:66 | `TSRS_INFER_MEMO` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/infermemo.rs:86 | `TSRS_INFER_MEMO_STATS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/infermemo.rs:98 | `TSRS_INFER_MEMO_MIN_STEPS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/sitecount.rs:38 | `TSRS_SITE_COUNTS_TOP` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/unioncache.rs:50 | `TSRS_UNION_CACHE` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/unioncache.rs:63 | `TSRS_IA_MEMO` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/unioncache.rs:84 | `TSRS_UNION_CACHE_STATS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/unioncache.rs:100 | `TSRS_UNION_CACHE_BITS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/uniontrace.rs:33 | `TSRS_TRACE_UNION_REDUCTION` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/workcensus.rs:28 | `TSRS_WORK_CENSUS_SLOW` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/workcensus.rs:43 | `TSRS_WORK_CENSUS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_checker/src/workcensus.rs:649 | `TSRS_WORK_CENSUS_TOP` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/affinity.rs:68 | `TSRS_MODULE_AFFINITY` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/affinity.rs:77 | `TSRS_MODULE_AFFINITY_GAMMA` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/affinity.rs:82 | `TSRS_MODULE_AFFINITY_PASSES` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:299 | `TSRS_RELATION_CACHE_LIMIT` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:310 | `TSRS_LEAVES_FIRST` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:350 | `TSRS_MAX_MEMORY` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:361 | `TSRS_RETIRE_MIN` | ignored; checker recycling is explicitly disabled |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:417 | `TSRS_FILE_TIMES` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:1220 | `TSRS_CHECKER_ASSIGNMENT` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:1237 | `TSRS_HEAVY_SHARE_DIVISOR` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:1488 | `TSRS_STEAL_STICKY` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:1507 | `TSRS_STEAL_MAX_THIEVES` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:1740 | `TSRS_ASSIGNMENT_DUMP` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:1763 | `TSRS_CHECKER_COST_CACHE` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/checkerpool.rs:1903 | `TSRS_CHECKER_ASSIGNMENT` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/emitter.rs:215 | `TSRS_EMIT_MEM` | ignored; adapter never calls native emit |
| third_party/tsrs/crates/tsrs_compiler/src/fileregions.rs:107 | `TSRS_LAZY_DTS` | ignored; adapter never enables process-wide lazy declaration parsing |
| third_party/tsrs/crates/tsrs_compiler/src/fileregions.rs:153 | `TSRS_LAZY_DTS_SHARED` | ignored; adapter never enables process-wide lazy declaration parsing |
| third_party/tsrs/crates/tsrs_compiler/src/fileregions.rs:267 | `TSRS_FREE_LEAVES` | ignored; CLI leaf-settings reader is never called; LeafMode::Off |
| third_party/tsrs/crates/tsrs_compiler/src/program.rs:509 | `RAYON_NUM_THREADS` | ignored for semantic identity; config/checker count uses its own native pool; Rayon controls only parse/bind workers; child-process test preserves counts 1/4 and facts with value 2 |
| third_party/tsrs/crates/tsrs_compiler/src/sharedgraph.rs:24 | `TSRS_SHARED_GRAPH` | reachable reader; shared-graph feature is not compiled in, so value cannot enable it; captured and noted |
| third_party/tsrs/crates/tsrs_compiler/src/sharedgraph.rs:40 | `TSRS_SHARED_GRAPH_SEED_PERCENT` | ignored in this build; shared-graph feature is not compiled in; value conservatively fingerprinted |
| third_party/tsrs/crates/tsrs_compiler/src/sharedgraph.rs:223 | `TSRS_DEBUG_REGIONS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/splitcheck.rs:83 | `TSRS_SPLIT_FILES` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/splitcheck.rs:98 | `TSRS_SPLIT_PIECE_DIVISOR` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_compiler/src/splitcheck.rs:101 | `TSRS_SPLIT_MIN_SHARE` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_contentmapper/src/process.rs:188 | `PATH` | ignored; no content-mapper project/process host is installed |
| third_party/tsrs/crates/tsrs_core/build.rs:5 | `CARGO_FEATURE_PLAIN_PTRS` | build-only; Cargo feature/target configuration, captured by adapter build identity and native mode constants |
| third_party/tsrs/crates/tsrs_core/build.rs:6 | `CARGO_CFG_TARGET_FAMILY` | build-only; Cargo feature/target configuration, captured by adapter build identity and native mode constants |
| third_party/tsrs/crates/tsrs_core/src/allocator.rs:11 | `MIMALLOC_ALLOW_THP` | ignored; optional CLI allocator/THP initializer is never called |
| third_party/tsrs/crates/tsrs_core/src/arena.rs:680 | `TSRS_ARENA_POISON` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_core/src/compat.rs:24 | `TSRS_CHECKER_ASSIGNMENT` | ignored; adapter pins canonical history through public setter before initialization; no baseline harness is called |
| third_party/tsrs/crates/tsrs_core/src/compat.rs:46 | `TSRS_CHECKER_ASSIGNMENT` | ignored; adapter pins canonical history through public setter before initialization; no baseline harness is called |
| third_party/tsrs/crates/tsrs_core/src/compat.rs:47 | `TSRS_HISTORY` | ignored; adapter pins canonical history through public setter before initialization; no baseline harness is called |
| third_party/tsrs/crates/tsrs_core/src/festats.rs:72 | `TSRS_FRONTEND_STATS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_core/src/lazymembers.rs:23 | `TSRS_LAZY_MEMBERS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_core/src/lazymembers.rs:28 | `TSRS_LAZY_TUPLES`, `TSRS_LAZY_COND_MAPPER`, `TSRS_LAZY_PROP_CACHE`, `TSRS_LAZY_HAS_PROP`, `TSRS_LAZY_UNMATCHED`, `TSRS_LAZY_EMPTY`, `TSRS_LAZY_INFERENCE_MAPPERS` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_core/src/memsplit.rs:20 | `TSRS_MEM_SPLIT` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_core/src/ptr.rs:1713 | `TSRS_CHECK_SHARED` | reachable; captured in immutable process/cache identity |
| third_party/tsrs/crates/tsrs_core/src/sharedgraph.rs:158 | `TSRS_SHARED_GRAPH_PROTECT` | ignored in this build; shared-graph feature is not compiled in; value conservatively fingerprinted |
| third_party/tsrs/crates/tsrs_vfs/src/bundled/bundled.rs:25 | `TSRS_LIB_PATH` | ignored; adapter uses lib_path/explicit override, never default_lib_path |
| third_party/tsrs/crates/tsrs_vfs/src/osvfs/os.rs:169 | `LocalAppData`, `HOME`, `XDG_CACHE_HOME` | ignored for native resolution; global typings cache helper is not used (typings_location is empty); excluded because this helper is unused in the native path |

Other std::env reads: native osvfs current_exe/current_dir helpers are
used for host probing or CLI helpers, never to select the project cwd or
libraries (both explicit). The checker union trace reads current_dir only
for optional trace path shortening; its controlling TSRS value is captured.
Build env! inputs are compile-time native crate paths/metadata, fixed by the
vendor/adapter/compiler hashes. Cargo target-family and feature values are
build-only and reflected in COMPRESSED_PTRS and sharedgraph::COMPILED_IN.
