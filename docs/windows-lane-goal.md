# The Windows lane's goal

Written 2026-09-24 by the Windows lane session. It works beside MainClaude
(language features, test262), the GTK lane and the Apple lane. The user
decided three things:

- **Win32 first, then WinRT/COM, then WinUI 3.** WinUI 3 is the UI target,
  and Win32 is the substrate that proves the event loop and the binder with
  no SDK to fetch.
- **The mingw ABI via zig now, MSVC later**, when a consumer needs an
  MSVC-built library. COM and WinRT are C vtable ABIs, so neither depends on
  the choice.
- **A quickemu Windows 11 VM runs what this box builds**
  (`tooling/windows/vm.md`). nts never runs on Windows.

The lane may edit compiler and runtime code. It announces each edit to a
shared file to MainClaude first, and agrees seams with GTK and Apple before
either builds them.

## How TypeScript meets Windows

- **C and Win32** ride the C interop that exists: `c:` modules, bindings,
  the witness. Win32 bindings will come from `Windows.Win32.winmd` (W1).
- **WinRT is not C#'s projection.** A method call is a typed indirect call
  through the COM vtable at a slot known at compile time from `.winmd`
  metadata. That is one load and one call, with no runtime metadata, as the
  Apple lane's typed `objc_msgSend` is. Ownership is `AddRef`/`Release` on
  the counting seam `Family::counting()`, as `Family::Com` (W2).
- **The loop:** libuv on Windows is IOCP, and `uv_backend_fd` is -1, so the
  GTK and Apple fd adapters do not apply. A watcher thread blocking on the
  loop's IOCP wakes the UI thread (W1).

## W0, a TypeScript program runs on Windows: landed

| Commit | What |
|---|---|
| `863d54eb` | `ObjectFormat { Elf, MachO, Coff }` in `link_c`. It fixes a live defect: every Windows DLL exported the whole runtime and the CRT's internals, because a COFF link accepts `--version-script` and ignores it. A `.def` file names the exact set, and an unmatched name fails the link. |
| `be817840` | `windows_toolchain`: clang compiles against zig's mingw headers, because `zig cc` ignores `-fsyntax-only` and so cannot run the witness, and `zig cc` links. `tooling/windows/build-libuv.sh` cross-builds libuv's `src/win`. |
| `b918772d` | `sizeof<T>()` became `NativeSizeOf`, resolved per backend. It was folded to one target's size during lowering. |
| `f9a9d4ae` | LLP64: `NativeAbi { SysV, Win64 }`, a required backend argument. A `c_long` is an exact `i64` in HIR and a 32-bit slot on Windows. A constant that does not fit is refused, and a runtime value truncates as C's does. A bit-field record under Win64 is refused, because MS placement is not implemented. |
| `9941c67b`, `cc451a34` | `examples/interop/windows-hello`, `tooling/windows/run.sh`. |

**Measured on the VM (Windows 11 build 26200, x86_64):**

- **`windows-hello`** prints node's output byte for byte: case mapping,
  numbers, bigint, Map order, and the loop's order with libuv on IOCP. Both
  PEs import only Windows' own DLLs. The arm64 PE is built and never run.
- **The Win64 `long` agreement.** The C program from
  `a_c_long_with_bit_31_set_crosses_the_win64_slot_on_both_backends`, linked
  against real `long` helpers, prints `15` on Windows. That is the answer
  LLVM's program gives here against `int32_t` helpers.
- **The C interop examples on Windows** (`tooling/windows/interop-on-win.sh`):

| Result | Examples |
|---|---|
| **Pass on Windows** (5) | c-from-ts, native-buffer, native-closure, native-copy, ts-from-c |
| **Pass, checked by hand** (1) | library-module-state: the caller prints `total=12`. The script's `nm` check fails only because an lld-linked `.exe` carries no symbol table. |
| **Refused by the witness, correctly** (8) | Bound from Linux headers: native-epoll, native-inet, native-poll, native-rusage and native-uname (headers Windows lacks), native-fd and native-open (`read`/`write` have other types there), native-stat (`struct stat` differs). |
| **Linux-only consumer** (1) | native-callback: `caller.c` includes `sys/wait.h`. |
| **Partly run** (1) | native-string: its later arms run the caller inside `$(…)`, which the harness does not redirect. |

**Not done in W0:**

- **LLVM for Windows.** It writes no triple, and its runtime calls pass
  `NtsValue` by the System V rules; Win64 passes a 16-byte aggregate by
  reference. `nts build` refuses the LLVM backend for every target, so
  nothing ships it. The Win64 `long` rule is implemented and tested in LLVM
  anyway.
- **Bit-fields under Win64** need MS placement, and are refused until then.

## Next

1. **W1:** `nts bind-winmd` for a Win32 subset, `wstring` (UTF-16)
   crossing, the IOCP loop host (`runtime/c/nts_win_host.*`, API agreed with
   GTK first), and `examples/interop/windows-window`.
2. **W2:** COM/WinRT: `@ntsVtable` calls, `Family::Com`, HSTRING,
   activation, delegates, and `IAsyncOperation` as a Promise.
3. **W3:** WinUI 3. **W4:** the idiomatic layer, packaging, and a benchmark
   against C#/CsWinRT and C++/WinRT.

## Rules this lane keeps

- Two arms per claim, and assertions on the artifact rather than the status.
- Builds and tests run from `~/.cache/nts/windows/wt`.
- A commit lands by fast-forward only when main is its tested base, or when
  what moved since touches no code.
- **A result that did not run on Windows says so.** "Links" is not "runs",
  and an x86_64 run is not an arm64 run.
