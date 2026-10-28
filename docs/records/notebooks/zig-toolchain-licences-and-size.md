# zig as the bundled C toolchain: licences and size (T-1 research)

Research for register item T-1 ("Bundle zig (clang, lld, libcs) as the
default. **research:** size, licences") in
[`open-questions.md`](../../open-questions.md). Measured 2026-10-28 against
zig 0.17.0 (released 2026-10-01; LLVM, Clang and LLD 22.1.8). The `lib/`
tree was measured in the Arch package `zig 0.17.0-1` (`/usr/lib/zig`);
official sizes come from ziglang.org's download index and the PyPI `ziglang`
wheels, which repackage the official binaries. No archive was downloaded or
extracted and nothing was built. Performance is measured separately. This is
engineering research, not legal advice.

## Summary

**Licences: safe to bundle, with conditions.** Nothing copyleft binds a
program nts builds, on any target. What zig links statically into a
program is permissive, or glibc code under its linking exception. What a
program only compiles against or references (headers, glibc's stub
libraries, Apple's `.tbd`, mingw-w64's import libraries) creates no
obligation. The conditions:

1. **Programs nts builds carry notices.** zig's compiler-rt (MIT, no runtime
   exception, with parts ported from musl and LLVM) is linked into every
   executable, so every program owes zig's, musl's and LLVM's texts.
   Windows programs add mingw-w64's CRT notices and WASI programs add
   wasi-libc's. Emit a per-target third-party notice file beside each
   artifact. That extends the rule `NOTICE` already states: "Ship notices
   for linked runtime components separately with built programs".
2. **nts's distribution ships a licence directory for zig**, extending
   `tooling/licenses/licenses.ts`. zig's own tree omits several texts its
   contents require. Add them: LGPL-2.1 (glibc), GPL-2.0 with the
   Linux-syscall-note (kernel headers), APSL-2.0 (Apple headers), zstd
   (BSD-3-Clause), zlib, and LLVM's third-party notices (at least the BSD
   regex and xxhash code). No source offer is owed.
3. **Drop 28 Darwin headers from nts's copy:** `simd/` (16), `xpc/` (11)
   and `launch.h`. They carry no licence grant and no open-source origin
   was found for them, so they appear to come from Apple's SDK, whose
   agreement forbids redistribution. No other bundled header includes them.

**Size: about 75–78 MB downloaded and 270–300 MB installed per host**,
trimmed to nts's targets (C only). Untrimmed it is about 87–90 MB and
330–360 MB. The zig binary dominates. It is one static executable of
about 145–170 MB (estimated; see Method) that can't be trimmed short of
building zig ourselves. The `lib/` tree shrinks from 187.7 MB (19,502
files) to 126.7 MB (9,479 files) by deleting whole directories: the BSD
libcs, other CPU architectures, C++ runtimes and tooling. The Windows headers alone are
72.6 MB of what remains. `std/`, compiler-rt and zig's libc have to stay
even for C-only builds, because zig compiles them from source on first use
for each target.

## What a program nts builds contains, per target

"Static" means code copied into the program. "Reference" means the program
records a dependency on a library on the user's system. "Compile" means
headers whose macros and inline functions reach the object code.

| target | component (zig 0.17 path) | what it is | licence | how it reaches the program | owed by whoever ships the program |
|---|---|---|---|---|---|
| all | compiler-rt (`lib/compiler_rt`) | integer and float helper routines, and the stack protector on mingw-w64 and WASI | MIT (zig); parts ported from musl (MIT) and LLVM compiler-rt (8.0: MIT; 13.0 and later: Apache-2.0 WITH LLVM-exception) | static, linked as an archive by default for every executable | zig's MIT notice, plus musl's and LLVM's for the ported parts |
| all | clang resource headers (`lib/include`) | `stdarg.h`, intrinsics | Apache-2.0 WITH LLVM-exception | compile | none: the exception covers object code |
| all | libunwind, libc++, libc++abi | C++ and unwinding runtimes | Apache-2.0 WITH LLVM-exception | **not linked for C**; only for C++, or static glibc | none |
| all | ubsan_rt (`lib/ubsan_rt.zig`) | sanitizer runtime | MIT (zig) | only with `-fsanitize=undefined` in full mode | zig's MIT notice |
| Linux glibc | `Scrt1.o`: `start.S`, `abi-note.S` | program entry | LGPL-2.1+ with glibc's linking exception | static | none |
| Linux glibc | `Scrt1.o`: `csu/init.c` | one constant, `_IO_stdin_used = 0x20001` | LGPL-2.1+, **no exception**, as in upstream glibc | static | none in practice: one integer, in every gcc or clang program on Linux |
| Linux glibc | `libc_nonshared.a`: `atexit`, `at_quick_exit`, `pthread_atfork`, `__stack_chk_fail_local`; `stat*` and `elf-init` for glibc ≤ 2.32 or 2.33 | small static parts of libc | LGPL-2.1+ with the linking exception | static, only the members used | none |
| Linux glibc | `libc.so.6`, `libm.so.6`, `ld-linux*` | stub libraries zig generates from `abilists`: symbols and versions, no code | n/a | link time only; the program runs on the system's glibc | none |
| Linux glibc | glibc headers (`generic-glibc`, `x86-linux-gnu`, `aarch64-linux-gnu`) | libc headers | LGPL-2.1+ | compile | none: within LGPL-2.1 §5 ("numerical parameters, data structure layouts… small inline functions (ten lines or less)") |
| Linux | kernel headers (`any-linux-any`, `x86-linux-any`, `aarch64-linux-any`) | Linux UAPI | mostly GPL-2.0 WITH Linux-syscall-note. In `any-linux-any`, every SPDX line (885 of 979 files have one) carries the note or is MIT or BSD | compile | none: the note covers "user programs that use kernel services by normal system calls" |
| Windows (x86-64, aarch64) | `crt2.o` (`crtexe.c`) | entry | public domain | static | none |
| Windows | `libmingw32.lib` members: startup, TLS, pseudo-relocations | CRT startup | public domain | static | none |
| Windows | `libmingw32.lib` members: `complex/*`, x87 long-double math, `powi`, `signgam`, `mingw_sformat` (scanf) | C99 extras | ZPL-2.1 | static, if used | reproduce mingw-w64 `COPYING` |
| Windows | `gdtoa/*`, `mingw_pformat.c` | float conversion; mingw's own printf | Lucent permission notice (HPND-style) | static, if used | Lucent notice |
| Windows | `getopt.c`; winpthreads | `getopt`; pthreads on Win32 | ISC and BSD-2-Clause; MIT | static, if used | their notices |
| Windows | zig's libc (`lib/c`, "zigc") | replaces many mingw-w64 functions | MIT (zig) | static | zig's MIT notice |
| Windows | import libraries for `kernel32`, `ntdll`, `api-ms-win-crt-*` | generated from mingw-w64 `.def` symbol lists; the default C runtime is UCRT | public domain lists | reference: the DLLs ship with Windows | none |
| Windows | mingw-w64 headers (`any-windows-any`, 1,613 files) | Win32, COM, CRT headers | mostly public domain, the rest permissive, except 91 Wine-derived LGPL-2.1+ headers (DirectX, DirectShow, XInput, WinHTTP, UI Automation, `propkey.h`…) and a GPL-2.0+ `stdarg.h` with GCC's exception | compile | none: the LGPL headers fall within §5; the GPL `stdarg.h` is never reached, because clang's own `lib/include` precedes `any-windows-any` in the search order (checked with `zig cc -E -v`) |
| macOS (arm64, x86-64) | compiler-rt only | no `crt1.o` and no libunwind on Apple targets | MIT | static | zig's MIT notice |
| macOS | `libc/darwin/libSystem.tbd` | text stub listing libSystem's exports, macOS 27.0 | Apple SDK-derived | link time only; references `/usr/lib/libSystem.B.dylib` | none |
| macOS | Darwin libc headers (`any-darwin-any`, 560 files) | copied by zig from a macOS SDK's `/usr/include` | APSL-2.0 (441 files), Apache-2.0 (23: libdispatch, `os/`), BSD, ISC or zlib (42), no grant in the file (54) | compile | none: every macOS program compiles against them |
| iOS | none from zig | zig ships no iOS libc; headers and stubs come from the real SDK (`NTS_IOS_SIMULATOR_SDK`) | Xcode and Apple SDKs Agreement | — | as Apple's agreement says |
| WASI (later) | wasi-libc's own code; musl top half; cloudlibc bottom half; dlmalloc; musl-fts | libc | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT; MIT; BSD-2-Clause; CC0; BSD-3-Clause | static | musl's and cloudlibc's notices, fts's if used |
| WASI, static musl | zig's libc | replaces many functions | MIT | static | zig's MIT notice |

**Copyleft that could reach a program, and why it doesn't bind:**

- glibc's crt and `libc_nonshared` sources carry the exception ("unlimited
  permission to link the compiled version of this file with other
  programs"). The exception is missing only from `csu/init.c`. That file is
  one integer constant, and upstream glibc's `crt1.o` links the same
  `init.o`, so every program built by any toolchain on Linux carries it.
- glibc's headers and mingw-w64's Wine-derived headers are LGPL-2.1+,
  within §5's header threshold for C. The C++ `.inl` headers
  (`d3dx9math.inl`) carry larger inline bodies, but nts emits C.
- The Linux kernel headers are GPL-2.0 under the syscall note, which
  exists for exactly this use.
- mingw-w64's GPL `stdarg.h` is shadowed by clang's.
- APSL-2.0's source obligation applies to modifications of Apple's files,
  not to programs compiled against them.

## What nts's distribution would redistribute

Each per-host package carries the zig executable, which statically
contains LLVM, Clang, LLD, zlib 1.3.1 and zstd 1.5.2 according to
zig-bootstrap. It also carries a `lib/` tree of sources and headers. The
release CI builds the Linux executable as `x86_64-linux-musl` with
`-Dstatic-llvm -Dstrip`, so musl is inside it. The Windows executable is a
`windows-gnu` build, so mingw-w64 CRT parts are inside it; that is inferred
from the target, not inspected.

| part | licence | condition on redistribution | text present in zig's tree? |
|---|---|---|---|
| zig compiler, `lib/std`, compiler-rt, zig's libc | MIT | keep the notice | yes (`LICENSE`) |
| LLVM, Clang, LLD, inside the executable | Apache-2.0 WITH LLVM-exception | ship the licence text (§4a). The exception covers only code embedded by compiling; it doesn't waive §4 for redistributing LLVM itself. llvm-project has no NOTICE file | as `lib/libcxx/LICENSE.TXT` etc. Keep a copy if nts drops `libcxx/` |
| LLVM's third-party code inside the executable | BSD-3-Clause (regex: Henry Spencer, UC Regents), BSD-2-Clause (xxhash), possibly more | reproduce the notices in documentation | **no** |
| zstd 1.5.2, inside the executable | BSD-3-Clause OR GPL-2.0 (take BSD) | reproduce the notice | **no** |
| zlib 1.3.1, inside the executable | zlib | none for binaries | **no** (ship it anyway) |
| musl, inside the Linux executable | MIT | keep the notice | yes (`lib/libc/musl/COPYRIGHT`; keep it even without WASI) |
| mingw-w64 CRT, libc++ and libunwind, inside the Windows executable | ZPL-2.1 and others; Apache-2.0 WITH LLVM-exception | the notices | yes (`lib/libc/mingw/COPYING`) |
| clang headers, libc++, libc++abi, libunwind, libtsan sources | Apache-2.0 WITH LLVM-exception | licence text | yes |
| glibc sources and headers | LGPL-2.1+ (plus the BSD, ISC and other notices in `LICENSES`) | "distribute a copy of this License" (§1) | **no**: only `LICENSES` is there, not `COPYING.LIB` |
| Linux UAPI headers | GPL-2.0 WITH Linux-syscall-note | a copy of the GPL and the note | **no** |
| mingw-w64 headers and CRT sources | public domain, ZPL-2.1, LGPL-2.1+ (Wine headers), BSD, ISC, MIT | ZPL notice; LGPL text | ZPL yes; LGPL **no** |
| Darwin headers and `libSystem.tbd` | APSL-2.0, Apache-2.0, BSD | APSL §2.1: keep notices and "include a copy of this License with every copy of Source Code" | **no** |
| Darwin `simd/`, `xpc/`, `launch.h` (28 files) | none stated; from the SDK | the Xcode and Apple SDKs Agreement §2.7 forbids redistributing the Apple Software "in whole or in part", except as its open-source components' licences permit | — **doubtful: drop them** |
| wasi-libc and musl sources | Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, CC0 | notices | yes |
| BSD libcs (`freebsd`, `netbsd`, `openbsd`) | BSD | notices | dropped by the trim |

**Source offers:** none owed. No GPL or LGPL code is distributed in object
form: the executable contains none, and the LGPL and GPL files are shipped
as source. APSL's source obligation covers only modifications, and nts
would ship the files unmodified.

**Doubtful parts:**

- The 28 SDK-origin Darwin headers, above. zig redistributes them today and
  Apple's position on that is unknown. Nothing nts compiles needs them: no
  other header in the tree includes them, and `runtime/c` includes none.
- The current macOS-from-Linux path with a real SDK (`NTS_APPLE_SDK`) runs
  Apple's SDK on non-Apple hardware. The agreement (§2.5, §2.7) forbids
  that, independently of zig. Bundled zig headers are what lets libc-level
  code build without the SDK; AppKit and the other frameworks still need it.

## Size

All sizes in MB (10⁶ bytes). A host's package is its zig executable plus
one `lib/` tree; the tree is the same on every host.

**Published, zig 0.17.0:**

| host | official archive | bytes | PyPI wheel, deflate (bytes) |
|---|---|---|---|
| Linux x86-64 | `.tar.xz` | 57,332,648 | 101,011,302 |
| Linux aarch64 | `.tar.xz` | 52,877,280 | 97,992,724 |
| macOS arm64 | `.tar.xz` | 53,985,220 | 100,425,967 |
| macOS x86-64 | `.tar.xz` | 59,317,572 | 104,418,550 |
| Windows x86-64 | `.zip` | 100,268,137 | none published for 0.17.0 |
| Windows aarch64 | `.zip` | 95,992,853 | none published for 0.17.0 |

**The `lib/` tree, measured** (identical across hosts; disk is in 4 KiB
blocks; the compressed figures are one tar compressed whole):

| profile | contents | size | disk | files | `.tar.gz` (-6) | `.tar.xz` (-9) |
|---|---|---|---|---|---|---|
| full | as zig ships it | 187.7 | 238,708 KiB | 19,502 | 30.0 | 19.1 |
| A, conservative | B plus `lib/compiler` (8.1) and the C++ runtimes (11.0) | 145.7 | 174,456 KiB | 11,041 | 20.8 | 14.2 |
| **B, C only** | core plus Linux glibc (x86-64, aarch64), Windows (x86-64, aarch64), macOS, WASI | **126.7** | 151,952 KiB | 9,479 | **18.0** | 12.2 |
| B without Windows | B less mingw-w64 and its headers (72.6) | 54.1 | 71,608 KiB | 6,101 | 9.2 | — |

Profile B by part:

| part | size | files |
|---|---|---|
| core: `std` 17.2, `include` (clang headers) 13.4, compiler-rt 0.8, zig's libc 0.1, `zig.h` and runtimes 0.4 | 31.9 | 973 |
| Linux glibc: `libc/glibc` 0.9, headers 10.0 | 10.9 | 1,824 |
| Windows: `libc/mingw` without `lib32` and `libarm32` 4.9, `any-windows-any` 67.7 | 72.6 | 3,378 |
| macOS: `libSystem.tbd` 0.3, `any-darwin-any` 6.7 | 7.0 | 562 |
| WASI: `libc/wasi` 0.8, `libc/musl` 2.8 (the WASI build reads it), headers 0.7 | 4.3 | 2,742 |

Dropped from the full tree: the BSD libcs and their headers, Linux headers
for the other CPU architectures, musl's per-arch headers (static musl is
not a target), 32-bit Windows `.def` files, `libtsan`, `lldb`, `docs`, `init` and
`build-web`, plus `lib/compiler` and the C++ runtimes in profile B.

**The executable, derived** (see Method):

| host | compressed share of the xz archive | compressed share of the deflate archive | estimated uncompressed |
|---|---|---|---|
| Linux x86-64 | 38.1 | 59.5 | 162–171 |
| Linux aarch64 | 33.6 | 56.5 | 143–162 |
| macOS arm64 | 34.7 | 58.9 | 148–169 |
| Windows x86-64 | — | 58.8 | 160–169 |

**Per-host nts package, profile B** (executable plus 126.7 MB of `lib/`;
the download is an npm `.tgz`, gzip -6). The download figures come from
published sizes and depend on no estimate:

| host | installed | download | untrimmed: installed, download |
|---|---|---|---|
| Linux x86-64 | 289–297 | 77.5 | 351–359, 89.7 |
| Linux aarch64 | 270–289 | 74.5 | 332–351, 86.7 |
| macOS arm64 | 275–296 | 76.9 | 337–358, 89.1 |
| Windows x86-64 | 287–295 | 76.7 | 349–357, 89.0 |

Moving Windows support into an optional package would cut the default to
about 200–225 MB installed and 66–69 MB downloaded. Shipping `lib/` once
as a host-independent package saves registry storage but not install size.

**What can't be trimmed without patching zig:**

- The executable: one static binary holding LLVM, Clang and LLD for every
  LLVM target. Making it smaller means a custom zig-bootstrap build with
  fewer LLVM targets, which makes nts the maintainer of a zig build.
- `std/`, `compiler_rt/` and `c/`, even for C-only builds. zig compiles
  compiler-rt and its libc from Zig source on first use for each target,
  then caches them.
- clang's resource headers (`lib/include`).
- `lib/` must keep its internal layout. zig finds the tree relative to its
  executable (`lib/`, `lib/zig/`, `../lib/`, `../lib/zig/`), or through
  `ZIG_LIB_DIR` or `--zig-lib-dir`, but the paths inside it are hard-coded.
  Whole per-target directories can be deleted; nothing can be moved or
  merged.
- Deleted targets fail as `'stdio.h' file not found`, so nts must keep
  refusing unsupported targets before it runs zig.
- `any-windows-any` stays whole for Windows targets. Its weight is in
  IDL-generated COM headers (`mshtml.h` alone is 6.8 MB), and nts's Win32
  binder runs clang over these headers.
- Per-file trims inside the glibc, mingw-w64, musl and WASI source trees
  are unsafe, because zig's source lists change each release.

## Open uncertainties

- **The executable's uncompressed size is estimated, not measured.** Two
  calibrations bracket it (the ranges above). The brief ruled out
  downloading the archives; extracting one when T-1 is implemented settles
  it. The download sizes don't depend on this estimate.
- The official tarballs' `lib/` is assumed identical to Arch's (same
  version, 19,502 files), and the language reference is assumed to be the
  archives' only `doc/` file.
- Profile B was checked by preprocessing only: `zig cc -E` of typical
  headers for all seven nts target triples passed, with `ZIG_LIB_DIR`
  pointed at the trimmed tree. Linking, which builds the crt files and libc
  for each target, was not run. B keeps every source tree zig's glibc,
  mingw-w64 and WASI builds read. Dropping `lib/compiler` is untested.
- Which mingw-w64 members (ZPL, gdtoa, getopt) a typical nts program pulls
  in is unmeasured; it needs a linker map. Shipping all of mingw-w64's
  notices sidesteps the question.
- The full list of third-party notices inside LLVM, Clang and LLD is not
  enumerated. The regex and xxhash code is confirmed; the rest should be
  generated from llvm-project at `llvmorg-22.1.8`.
- zig-bootstrap's README at tag 0.17.0 says "LLVM, LLD, Clang 21.1.0",
  while the release notes and `zig cc --version` say 22.1.8. The release
  notes are taken as authoritative.
- zig states no position on attribution for compiler-rt in programs it
  builds, and none was found. The notice is recommended anyway because it
  costs nothing.

## Method

- **Licences:** read every licence and notice file under `/usr/lib/zig`,
  tallied licence headers per tree with `grep`, and read zig 0.17.0's
  `src/libs/{glibc,mingw,wasi_libc}.zig`, `src/target.zig`,
  `src/Compilation.zig` and `src/Compilation/Config.zig`. The latter two
  decide what is linked statically.
- **Header search order:** read from `zig cc -target <t> -E -v` on an empty
  file, run once per target.
- **The executable's compressed share:** each host's published archive size
  minus the `lib/` tree compressed the same way here. For xz, a tar at -9
  plus the language reference. For deflate, per-file zlib -6 (as the
  wheels' `zipfile` writes it), zip headers and the wheel's RECORD (SHA-256
  lines, computed); the Windows zip uses its longer entry names and no
  RECORD.
- **Uncompressed estimate:** that share multiplied by the deflate ratio
  (2.87) of the code and read-only sections (`.text`, `.rodata`,
  `.eh_frame`, `.data.rel.ro`) of Arch's `libLLVM.so.22.1`,
  `libclang-cpp.so.22.1` and `zig`: 257.3 MB raw, 89.7 MB at gzip -6. The
  same sample's xz ratio (4.27; 60.3 MB at xz -9) gives each range's lower
  end. The sample is x86-64 ELF, so the aarch64 ranges are wider. Windows
  has no xz archive, so its lower end applies Linux x86-64's spread.
- Arch's own zig executable (26 MB) is not representative: it loads the
  system's LLVM, Clang and LLD (277 MB with them).

## Sources

Local (Arch `zig 0.17.0-1`):

- `/usr/share/licenses/zig/LICENSE`
- `/usr/lib/zig/libc/glibc/LICENSES`
- `/usr/lib/zig/libc/glibc/csu/init.c`
- `/usr/lib/zig/libc/glibc/sysdeps/x86_64/start.S`
- `/usr/lib/zig/libc/glibc/stdlib/atexit.c`
- `/usr/lib/zig/libc/mingw/COPYING`
- `/usr/lib/zig/libc/mingw/gdtoa/dtoa.c`
- `/usr/lib/zig/libc/mingw/misc/getopt.c`
- `/usr/lib/zig/libc/mingw/winpthreads/thread.c`
- `/usr/lib/zig/libc/include/any-windows-any/stdarg.h`
- `/usr/lib/zig/libc/include/any-windows-any/d3d9.h`
- `/usr/lib/zig/libc/musl/COPYRIGHT`
- `/usr/lib/zig/libc/wasi/LICENSE` and `libc-bottom-half/cloudlibc/LICENSE`
- `/usr/lib/zig/libc/darwin/libSystem.tbd`
- `/usr/lib/zig/libc/include/any-darwin-any/`
- `/usr/lib/zig/libcxx/LICENSE.TXT`
- `/usr/lib/zig/compiler_rt/` (its "Ported from musl" and LLVM notes)
- `/usr/lib/zig/c.zig`

zig:

- Download index and sizes: <https://ziglang.org/download/index.json>
- Versions of LLVM and the bundled libcs:
  <https://ziglang.org/download/0.17.0/release-notes.html>
- `glibc.zig`:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/src/libs/glibc.zig>
- `mingw.zig`:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/src/libs/mingw.zig>
- `wasi_libc.zig`:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/src/libs/wasi_libc.zig>
- `target.zig`:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/src/target.zig>
- `Compilation.zig`:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/src/Compilation.zig>
- `Compilation/Config.zig`:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/src/Compilation/Config.zig>
- How the Darwin headers are collected:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/tools/fetch_them_macos_headers.zig>
- Install layout:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/README.md>
- Release build flags:
  <https://codeberg.org/ziglang/zig/raw/tag/0.17.0/ci/x86_64-linux-release.sh>
- zig-bootstrap's components:
  <https://codeberg.org/ziglang/zig-bootstrap/raw/tag/0.17.0/README.md>
- PyPI wheels: <https://pypi.org/pypi/ziglang/0.17.0/json>
- How the wheels are built:
  <https://raw.githubusercontent.com/ziglang/zig-pypi/main/make_wheels.py>

Upstreams and licences:

- glibc's `csu/init.c`:
  <https://raw.githubusercontent.com/bminor/glibc/master/csu/init.c>
- glibc's `csu/Makefile`:
  <https://raw.githubusercontent.com/bminor/glibc/master/csu/Makefile>
- LLVM's regex (BSD-3-Clause):
  <https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/llvm/lib/Support/regcomp.c>
- LLVM's xxhash (BSD-2-Clause):
  <https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-22.1.8/llvm/lib/Support/xxhash.cpp>
- llvm-project's root (no NOTICE file):
  <https://github.com/llvm/llvm-project/tree/llvmorg-22.1.8>
- zstd's dual licence:
  <https://raw.githubusercontent.com/facebook/zstd/v1.5.2/README.md>
- LGPL-2.1 §1 and §5:
  <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.en.html>
- Linux-syscall-note: <https://spdx.org/licenses/Linux-syscall-note.html>
- APSL-2.0: <https://spdx.org/licenses/APSL-2.0.html>
- Xcode and Apple SDKs Agreement (§2.2, §2.5, §2.7):
  <https://www.apple.com/legal/sla/docs/xcode.pdf>
- `os/workgroup` is libdispatch's (Apache-2.0):
  <https://opensource.apple.com/source/libdispatch/libdispatch-1271.120.2/os/workgroup.h.auto.html>
