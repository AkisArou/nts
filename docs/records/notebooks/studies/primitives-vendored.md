# Vendored study (zmij, simdutf, other candidates): report

Saved by MainClaude from the study's final message, 2026-10-22. Tree ~/.cache/nts-scratch/primitives/vendored/tree, branch compiler/prim-vendored, WIP 0c3c18e0e on main f7e6304e1:
- `compiler/core/src/hir/provided.rs`, `runtime/c/nts_text.c`, `benchmarks/cases/utf8-bulk/`;
- vendored sources (untracked) in third_party/{simdutf,zmij,rapidhash};
- binaries in bin-{main,b1,b2}, logs in bench/, differentials in probe/.

## zmij: take it

- **License and build:** MIT (or Boost-1.0), v1.2, commit d1682cb47e67. Plain C, unedited, its own translation unit with `-std=gnu11` (inline `asm`). 0.12 s compile, 33.8 KB code, +16.4 KB stripped in a program.
- **Layout:** zmij's text isn't JS's (`1e+20`, `1e-06`, `inf`), but its digits are. The prototype re-parses its text into digits and a point, then runs nts's existing ECMAScript layout. `-0`, NaN, the infinities and integers never reach zmij.
- **Correctness:** 1,999,259 doubles match node's `String(x)` exactly.
- **Cleaner later:** call `to_decimal_double` directly (static today; it needs an upstream export).
- **`toFixed`:** `zmij_write_fixed` rounds ties to even, where JS takes the larger value, so a tie fix-up is owed or the snprintf path stays.

**A/B** (one binary, `NTS_BENCH_VENDORED=zmij` on/off, CPU 4):

| row | Grisu | zmij | verdict |
|---|---|---|---|
| number-format-double, C | 4.53 µs | 3.90 µs | 1.16× gain; against node 0.48× → 0.42× |
| number-format-double, LLVM | 4.57 µs | 3.94 µs | 1.16× gain |
| number-format (integers; zmij isn't on this path), C | 647 ns | 706 ns | probable 7-9% loss |
| number-format, LLVM | 642 ns | 682 ns | same |

The integer row's probable loss is likely `always_inline` pulling the larger path into every caller, so keep the shortest-digits call out of line. Drivers: 22% fewer instructions. Micro: 71 → 50 ns per conversion.

**Recommendation:** replace Grisu in `nts_number_to_string_into`, keep `js_dtoa` for radix and precision.

## simdutf on native

- **Facts:** v9.2.1, Apache-2.0 or MIT, C++17. It builds with `-fno-exceptions -fno-rtti -DSIMDUTF_NO_LIBCXX=1` and links into a C program with no C++ standard library. Kernels: AVX-512, AVX2, SSE4.2, NEON and others, chosen at run time; no Wasm SIMD128 kernel.
- **node v24.20.0** builds simdutf 6.4.0 (from V8's third_party) behind Buffer, `byteLength` (above 128 bytes), `isUtf8`/`isAscii`, base64 and TextDecoder's fatal path.
- **Where nts needs it:**
  - `runtime/web-platform/src/core/utf8.ts`, a code point at a time (Buffer, TextEncoder, percent, websocket, webcrypto, node-utf8);
  - TextDecoder.decode (a closure plus `fromCodePoint` per code point: fetch `text()`, `json()`, `formData()`, Blob);
  - Buffer latin1/ascii/hex/base64 and `atob` (`+= fromCharCode` per byte);
  - the C runtime's `nts_string_from_utf8` and `nts_write_utf8`, both scalar;
  - `fs` passes bytes as `number[]`.
- **The prototype:** `hir/provided.rs` marks the codec functions (for now by file and name; the clean version is an `@ntsProvided` attribute plus a schema bump). `Backend::provides()` says C and LLVM provide it, so calls are replaced by `nts_utf8_length`/`write`/`decode`. `runtime/c/nts_text.c` matches the TypeScript's contract exactly; the JVM and Wasm still compile the TypeScript.
- **Correctness:** 18,054 checks equal node. **Main aborts on corners** (`nts: refused: index 0.5 is outside [0, 8)`): compiled nts refuses typed-array reads that JavaScript answers with `undefined`. That's runtimes-audit G7, in the compiler lane.

**A/B** (main against b2, CPU 4):

| row | main | simdutf | gain | against node |
|---|---|---|---|---|
| node-utf8, C | 29.4 µs | 9.28 µs | 3.17× | 0.79× → 0.25× |
| node-utf8, LLVM | 29.0 µs | 9.5 µs | 3.06× | |
| utf8-bulk (new), C | 388 µs | 46 µs | 8.4× | 0.90× → 0.10× |
| utf8-bulk, LLVM | 393 µs | 46 µs | 8.5× | |

- **Instructions:** 6× fewer per node-utf8 round trip, 19× fewer per utf8-bulk pair.
- **Without reference counting**, `utf8Decode`'s `+=` copies quadratically (448 MB peak).
- **Kernel:** encode is 28× scalar on 64 KB of ASCII, and only 0.7-2.5× at 50 bytes (why node only calls it above 128 bytes).

**Build:**

| simdutf build | compile | code |
|---|---|---|
| full, all x86 kernels | 8.7 s | 540 KB |
| AVX2 only | 3.75 s | 231 KB |
| subset (UTF-8, UTF-16, Latin-1, ASCII), all kernels | 4.1 s | 209 KB |
| subset, AVX2 only | 1.85 s | 91 KB |

The subset needs our own small shim. **Binary:** main 55.8 KB; with simdutf, all kernels, 568 KB; AVX2-only 244 KB; full LTO with virtual-function elimination **107 KB**. Hello world is unchanged.

## Other candidates

| Library | Verdict |
|---|---|
| fast_float (C99 port ffc.h) | `parseFloat`/`Number(s)`, today glibc `strtod` (locale-dependent). Next. |
| rapidhash | Only with a cached, per-process-seeded hash (the CVE-2025-27209 lesson). |
| ada | Not now; add a URL row with ada as the reference. |
| llhttp | Not now; same. |
| zlib (Chromium fork), brotli, zstd, c-ares | Vendor from node's tree, so bytes stay identical to node's. |
| nghttp2 | Later. |
| libuv | **Fix now:** host builds link the system libuv (`-luv`); build node's deps/uv into the cache, as cross builds already do. |
| OpenSSL 3.5.7 | Today `node:crypto` uses the system libcrypto. A decision. |
| ICU4C 78.3 | The data is about 11 MB compressed; ICU4X is a lighter alternative. |

## The vendoring scheme

1. **Pin** in a manifest, `third_party/vendored.json` (version, commit, file URLs with sha256, licenses, the family each backs; modelled on providers/icu/artifacts.json).
2. **Fetch** with a TypeScript tool run by bootstrap: unedited, gitignored under third_party/<name>/, sha256 checked. The trimmed simdutf comes from upstream's amalgamate.py.
3. **Ship:** the C crate embeds the sources, so a shipped `nts` needs no network, and the object cache compiles each once per toolchain, target and flags.
4. **Build** with clang or zig c++, each with its own flags, statically linked through the C driver, with no C++ standard library and no system package.
5. **Link only what's used,** with `--gc-sections`, or LTO with virtual-function elimination for simdutf.
6. **A vendored library is a backend's provider of a family** (text codec, number format, number parse, hash), decided by a core pass plus `Backend::provides()`; the runtime TypeScript stays the fallback.

## Staged plan

- **A.** zmij, out of line. Rows: number-format, number-format-double, plus a random-double row. Fixtures: the 2M differential, `-0`, `5e-324`, `MAX_VALUE`, and the 1e21 and 1e-7 boundaries.
- **B.** simdutf, the provided-codec pass (`@ntsProvided` plus a schema bump), and the C++ build path. Rows: node-utf8, utf8-bulk; the corners differential becomes a fixture.
- **C.** TextDecoder, Buffer latin1/base64, console output and file reads through it; then fast_float.
- **D.** libuv, zlib, brotli, zstd and c-ares from node's tree.
