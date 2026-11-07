> **Record, copied 2026-11-07** from `~/Projects/nts-playground`, a design
> experiment outside the repository, before that folder was deleted. These are
> its notes only: the patched checker it built on (`tsgo`, which nts no longer
> uses) and its example, test and runtime folders were not kept. Links below
> to those folders no longer resolve.

# nts-playground: scalar numbers

Typed numbers for nts's TypeScript (`Int32`, `Uint8`, `Float32`, C's `c_int`,
Apple's `CGFloat`, Win32's `LPARAM` ...), checked by a patched TypeScript
checker. Nothing here is in the nts repository yet.

**Adopting it into nts?** Read `DESIGN.md` "Where this goes in nts" first: one
range analysis in nts's compiler (`facts.rs`) for safety and speed, calls into
C, Java and wasm strict (proven or a compile error), and this patched checker
frozen as the reference.

**Start with the tour, `scalars/`.** Open its files in Neovim here (`.nvim.lua`
serves them with the patched checker, so hovers and errors are the real ones).

| File | What it shows |
|---|---|
| `scalars/scalars.d.ts` | the library: every scalar type, C's own types as per-target tables, `AsNumber`, `CBool`, `CEnum`, and the conversions in `"nts:scalars"` |
| `scalars/1-plain-js.ts` | **case 1**: plain `number`/`bigint` code is plain TypeScript |
| `scalars/2-scalars-in-app.ts` | **case 2**: an app that writes scalar types in its own code |
| `scalars/checks.ts` | every rule, one claim per line |
| `scalars/<platform>/` | a binding, then three cases for that platform |
| `.../3-calling-*.ts` | **case 3**: a JavaScript developer calls the platform and never writes a scalar |
| `.../4-*-and-scalars.ts` | **case 4**: an app that keeps the platform's kinds and writes its own |
| `.../5-called-from-*.ts` | **case 5**: the platform calls TypeScript -- exports and callbacks, from both developers' sides |

The platforms:

| folder | binding |
|---|---|
| `c/` | a C library, as a binding generator declares it from its headers |
| `jvm/` | Android and Java classes, and a Kotlin object |
| `wasm/` | a component from its WIT, and SQLite's C API compiled to wasm32 |
| `windows/` | Win32 |
| `macos/` | AppKit |
| `ios/` | UIKit and libdispatch |
| `gtk/` | GTK 4 and GLib |

The types, complete:

| JavaScript | C | Rust | Zig |
|---|---|---|---|
| `Int8` `Uint8` `Int16` `Uint16` `Int32` `Uint32` | `int8_t` ... `uint32_t` | `i8` ... `u32` | `i8` ... `u32` |
| `BigInt64` `BigUint64` `BigInt128` `BigUint128` (bigints) | `int64_t` `uint64_t` `__int128` | `i64` `u64` `i128` `u128` | same |
| `Float16` `Float32` `Float64` `Float80` `Float128` | `_Float16` `float` `double` x87 `long double` `__float128` | `f16` `f32` `f64` -- `f128` | `f16` ... `f128` |
| C's own, per target: `c_char` `c_int` `c_long` `c_size_t` `c_wchar_t` `c_wint_t` `c_longdouble` ... | `char` `int` `long` `size_t` ... | `core::ffi::c_*` | `c_*` |

The five cases, a line or two each:

```ts
let count = 0; count++;                     // 1: number, as in node
const s = u8 + u8;                          // 2: Int16 & Uint16 (0..510); `const b: Uint8 = s` is an error
crc16(buf, buf.length);                     // 3: a plain number goes in, checked at the call;
crc16(buf, 70000);                          //    a known-wrong one is a compile error
crc16(buf, Uint16.clamp(len));              // 4: say what happens to a value that may not fit
sort_ints(xs, xs.length, (a, b) => Math.sign(a - b));  // 5: C calls this; a throw there would abort
```

| | |
|---|---|
| `REPORT-2026-10-08.md` | the overnight work in one page, and the calls awaiting your confirmation |
| `DESIGN.md` | the rules, why, the backends, the limitations, what is open |
| `DECISIONS.md` | every decision you made and every commitment, with its status |
| `QUESTIONS.md` | what is still to settle for adoption into nts: the user's calls, strict calls, the library, the backends |
| `AUDIT-2026-10-08.md` | what the October 8 audit found, and why it had been missed |
| `PERF.md` | checking time against unpatched tsgo |
| `JVM-UNSIGNED-BUG.md` | a latent defect in nts's JVM backend that scalars would expose |
| `runtime/` | `runtime.js`, the conversions under node, and their oracle |
| `./test.sh` (or `./test.sh quick`) | every test; it also rebuilds `tsgo-scalars` |
| `tsgo/` (branch `scalars-v2`) | the patched checker |
