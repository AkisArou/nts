# Runtime symbols: dynamic tables and bindings before and after

Issue #977. Every nts product links its own copy of the C runtime. At default
visibility, an addon published that runtime in its dynamic table, and two
addons loaded `RTLD_GLOBAL` in one node bound one's references to the other's
runtime.

## Cause

The runtime's definitions (`nts_runtime.c` with the vendored zmij and ffc,
`nts_unicode.c`, the host sources) had default visibility. A shared library's
version script (`local: *`) narrowed its table at link time. An `nts build`
addon has no version script, so its table held about 500 runtime symbols. A
static archive's runtime entered the table of any shared object that linked it.

## Change

- `runtime/c/nts_runtime.h` defines `NTS_RUNTIME_SYMBOLS_BEGIN` and `_END`.
  They expand to `#pragma GCC visibility push(hidden)` and `pop` on ELF and
  Mach-O under GCC and clang, and to nothing elsewhere (COFF exports only what
  a definition file names). The header brackets its declarations, now
  including `nts_string_view.h`.
- Every runtime source brackets everything it defines after its system
  includes. The glibc and Windows `<malloc.h>` includes moved to
  `nts_runtime.c`'s top.
- zmij's source re-includes `<assert.h>`, which has no include guard and
  declares `__assert_fail` again on every inclusion. Inside the region that
  declaration became hidden, and the link failed: `hidden symbol
  '__assert_fail' isn't defined`. zmij's source therefore stays outside the
  region, and its functions take hidden from its API header, which is inside.
  A libc declaration inside a region is always a loud link error like this
  one, never a misbinding.
- `addon.c`'s weak `nts_napi_set_env` default is inside the region.
- The LLVM backend defines `nts_closure_call_slot`, which the header declares;
  it is now `hidden` off COFF. Without that, the LLVM addon still published it.
- No runtime symbol is exported. A host reaches a product through the
  program's published names, and an addon through the Node-API entry points,
  which `node_api.h` declares with explicit default visibility.

## Measurement

The programs are two addons, `alpha` (a `Map` and string case conversion) and
`beta` (an array and number formatting), plus a C library of each, built by
`nts build`. "before" is pin `e02a24aa9a9f` (#972); "after" is this change's
`nts-dev` compiler.

| Product | Check | Before | After |
|---|---|---|---|
| addon `alpha` (C) | defined dynamic symbols | 501 | 2: the Node-API entry points |
| addon `beta` (C) | defined dynamic symbols | 500 | 2: the Node-API entry points |
| both, `RTLD_GLOBAL`, alpha first | beta's references bound to alpha's definitions (`LD_DEBUG=bindings`) | 57 (`nts_alloc`, `nts_release`, `nts_promise_subscribe`, `nts_desc_string1`, ...) | 0 |
| both, `RTLD_GLOBAL` | answers | as node | as node |
| library `alphac` (C), `betallvm` (LLVM) | defined dynamic symbols | exports + version node | the same, byte-identical tables |
| static archive `alphastatic` | defined global symbols at default visibility | 503 | 5: the program's |
| a plugin `.so` linking that archive | defined dynamic symbols | 504 | 6: its entry and the program's |

The answers agreed before as well: two runtimes from one compiler run the same
code. The defect is the cross-binding itself: one addon allocated, released and
queued reactions through another's runtime while its inlined paths used its
own. An alpha built by an older pin (`0c3672ffb605`, whose runtime differs in
about 360 lines) beside a current beta also answered correctly, so the record
claims no wrong answer.

### Instruction counts

The program is a hot loop of runtime calls (string concatenation, array push
and truncation), 20,000,000 iterations, counted with `perf stat -e
instructions:u -r 5` under `with-lock.sh --key perf-count` on CPU 4.

| Product | Before | After | Ratio |
|---|---|---|---|
| library, from a C host | 5,211,145,673 | 5,211,145,658 | 1.000 (identical) |
| addon, in node | 5,239,910,681 | 5,304,313,827 | 1.012 (worse) |
| node `-e 0`, for scale | 92,101,868 | 87,408,523 | noise |

The library's code is unchanged: its version script already let the linker
make every runtime call direct. The addon now calls the runtime directly rather
than through the PLT (142 `nts_*@plt` call sites before, none after), and its
loop function is the same 675 instructions. With every runtime function known
to be internal, LTO inlined `nts_buffer_root` into `nts_release_counted`
(104 to 154 lines). That adds a `__tls_get_addr` call to the release slow path's
frame and costs about 3 instructions per iteration. That is an inlining
heuristic on a cold path, not a visibility cost. `__tls_get_addr` is about 12%
of this addon's instructions both before and after: the runtime's thread-local
environment uses the general-dynamic model in a shared object.

### Benchmark rows (executables)

`nts-bench --count` gives net user instructions per operation, counted on
CPUs 16-31. "Before" and "after" are each an `nts-dev` `nts-bench`, the first
built with main's runtime and backend files (`5c00b70387`) and the second with
this change. Every compiled column's band is 1 basis point.

| Row | nts C before | nts C after | ratio | nts LLVM before | nts LLVM after | ratio |
|---|---|---|---|---|---|---|
| array-methods | 46,584 | 46,584 | 1.000 | 46,584 | 46,584 | 1.000 |
| case-convert | 36,519 | 36,519 | 1.000 | 36,385 | 36,385 | 1.000 |
| clbg-binary-trees | 53,447,179 | 53,447,179 | 1.000 | 53,447,174 | 53,447,174 | 1.000 |
| clbg-k-nucleotide | 17,421,956 | 17,421,956 | 1.000 | 17,414,049 | 17,414,049 | 1.000 |
| closures | 7,246 | 7,246 | 1.000 | 7,246 | 7,246 | 1.000 |
| event-loop-promises | 287,398 | 287,398 | 1.000 | 286,028 | 286,028 | 1.000 |
| bigint | not counted | 2,585 | -- | not counted | 2,582 | -- |
| clbg-fannkuch-redux | `--` | `--` | -- | `--` | `--` | -- |

Every row is identical, which is the expected result: an executable exports
nothing, so LTO had already internalized the runtime. bigint's "before" run
failed twice in its node oracle ("node oracle did not complete"), which is
outside nts; its after run counted. clbg-fannkuch-redux has no nts columns on
either side. awfy-json was not counted, because it fails to build on main
(`-Wunneeded-internal-declaration` on `__nts_dispatch_75`), as the published
`results/benchmarks/full.md` shows. No benchmark row runs an addon or a shared
library, so the PIC effect is the hot-loop count above.

## Proof

- `compiler/codegen/napi/tests/two_addons.rs` builds `alpha` on C and `beta` on
  LLVM and loads both `RTLD_GLOBAL` in both orders. Each table must be exactly
  the two entry points, no binding may cross, and both must answer as node.
- `compiler/codegen/c/tests/runtime_visibility.rs` names every `runtime/c`
  source, so a new one fails until it is listed. It compiles each Linux source
  with no flag: none may define a default-visibility global, and linked as one
  shared object they publish nothing.
- `compiler/codegen/llvm/tests/signatures.rs` asserts that clang sees every
  helper the header declares as hidden off COFF.
- `tooling/cli/tests/build.rs`: the shared library's table is exactly its
  exports, and a plugin linking a static archive publishes only the program's
  symbols while still calling `nts_checkpoint`.
- Apple and Windows are unrun by policy. On Apple the macros are the same
  pragma as ELF; on Windows they are empty.

### Counterfactual

Main's 16 runtime and backend files were copied into the working tree over
the committed change, and `inner.ts --no-agree --keep-going` was run. These
went red:

- `two_addons` (`alpha (C)'s dynamic table holds more than its Node-API entry points`);
- `runtime_visibility::no_runtime_source_exports_a_symbol`;
- the three non-COFF `signatures` tables;
- `a_static_archive_linked_into_a_plugin_keeps_its_runtime_inside`, which
  listed the archive's runtime.

`every_runtime_source_is_named_by_the_visibility_check`, the two Windows
tables, `libc_named_exports` and `a_shared_library_publishes_its_entry_and_nothing_else`
passed on both sides. The files were then copied back from their saved copies.

Raw output: `~/.cache/nts-scratch/977/measure/`.

| File | SHA-256 |
|---|---|
| `before/alpha.node.nm` | `ea96dfed579e54d12751d5b15aefae2949cfe783f5b82bc472b1bd068a40d3a5` |
| `after/alpha.node.nm` | `a90c24ba3ee301b05834b8eb0c8f55a9bfa9bbb978e55715c9349158a06730a8` |
| `before/beta.node.nm` | `701a4c371806fc73e360957b698fdcac8dde29e01ed766c3e2c07d69d1b076aa` |
| `after/beta.node.nm` | `112a7c3f59d424f79ff8e29a405814dbe106ba08f08bc33581a1431d8ee965e7` |
| `before/libalphac.so.nm`, `after/libalphac.so.nm` | `22b50e16443e8fff43538c1c48d8727a68a37a92a40dee7ecd649fdca72db8ea` |
| `before/libbetallvm.so.nm`, `after/libbetallvm.so.nm` | `8bcfff0d4eeb1ce82a204d15721267cb22a1affe0144ca7aa56e453fd6ee10f6` |
| `before/host-plugin.so.nm` | `ae68304fa77cc947d65790f9d9c319575b916f8689234803ad78abec4445a4eb` |
| `after/host-plugin.so.nm` | `1c383d1df50649252ecf3e3a29a7caf732f9b1888d51c49e9a7da4e6a1df6646` |
| `bindings.txt` | `a02ee912c29d4a3d706ebbd70adc7dcfd5f86567d36158c9565b4609c9aa7f07` |
| `hot-counts.txt` | `6479a4f97a2f511d627e263ed23392448247268da72fcfad777d577b93ca0b1d` |
| `count-header.txt` | `57fd96438e07f21d3aa651cdcd50865e9c2d86f617a8b7a2598636d8a9ce4717` |
| `count-before.tsv` | `be66927750098ef54ea7aa57899dcc490b8366124f2cb7d91e9eaa44d5f49578` |
| `count-after.tsv` | `25105c6cb4063e7a8d4e7ceeeb2c3ae9b35c19fb5004a96c272418e9700a7c0b` |
