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

## W1, Win32 from TypeScript: where it stands

`examples/interop/windows-window` is a Win32 window whose window procedure is
TypeScript, closed by `await new Promise(r => setTimeout(() => r(), 30))`
while `GetMessageW` owns the thread. It is built by `nts build` alone and run
on the VM.

| Commit | What |
|---|---|
| `695f8a3d` | The witness compares a function's type with its header's (`__builtin_types_compatible_p(__typeof__(F), …)`), where it used to re-declare the function. The re-declaration made `-Winconsistent-dllimport` refuse every Win32 binding. `program.c` calls through the header when the witness checked the function and the header is included: `call *__imp_DispatchMessageW`, not an import thunk. |
| `266f3f9d` | `nts_win_host`: a watcher thread on libuv's IOCP wakes a message-only window, which pumps libuv inside the program's own message loop, modal loops included. Every Windows executable attaches it: 0.36 ms at the median, measured. |
| `a05a3584` | `Ptr<void>` as `void *`, and `F \| null` passing NULL for `null` (`SetTimer`'s `TIMERPROC`). |
| `bb805fea` | `windows-window`. |
| `e669f6f6` | `Utf16String`: a `string` crosses as `LPCWSTR`, lent in place when it is already two-byte. |
| `fbf1f439` | `c_long32`/`c_ulong32`: `LONG` and `DWORD` as numbers whose C spelling is `long`; refused on SysV, where `long` is 64 bits. |
| `f4637a6d` | `nts bind-winmd`: Win32 bindings from `Windows.Win32.winmd`, checked against the mingw headers. The metadata gives the meaning, clang gives the exact C type, and where they disagree on width the item is refused, not guessed. `nts build` binds `c:Windows.Win32.*` imports on demand into `types/winmd`. |
| `10c75d3b` | `windows-window` runs on generated bindings; the hand-written UTF-16 names are gone. |
| `908d084f` | `@ntsLibrary <name>`: a program links the import libraries of the functions it calls, and no others. |
| `4d2ff1ed` | Handles are a `Class` hierarchy from `[AlsoUsableFor]` (`HBRUSH` passes as `HGDIOBJ`); handles the header makes one C type (`HINSTANCE`/`HMODULE`) are one type. |
| `ad69e743` | A struct a function takes by value is `ByValue<T>` (`WindowFromPoint(POINT)`): 288 functions bound, 114 refused. windows-window asks `ChildWindowFromPointEx` for two points, `hit=1 miss=1`. |
| `c59dbed2` | LLVM: `Platform { abi, arch }`, and records by value under Win64 by clang's size rule (1/2/4/8 bytes an integer, else a pointer to a copy). arm64 refuses a record or erased value by name. |
| `cd9b923f` | A Win64 runtime signature table generated by clang (68 of 341 declarations differ from System V), and a drift check that fails in both directions. |
| `0833e7af` | LLVM calls the C runtime by Win64's convention: 16-byte values through entry-block slots, `sret` and `<2 x i64>` results. `opt -passes=lint` over every call; 94 Windows modules with mismatches before, 0 after. |
| `8daaa920` | `nts build` builds `backend: "llvm"` for every target: `program.ll` in `program.c`'s place, same runtime and link. |

**bind-winmd, measured:** `UI.WindowsAndMessaging` binds 282 functions, 89
types and 1,303 constants, and refuses 120 items, each with its reason in
`.refused.txt`. `Graphics.Gdi` binds 316 functions. `NTS_BIND_WINMD_KEEP=1`
keeps each probe and clang's answer.

**Measured on the VM:**
- `by=typescript` as built.
- `by=failsafe` with the host's attach removed, and again with only its schedule hook removed.
- A 1.5 s TypeScript timer inside the message loop used 31 ms of CPU over 2.4 s.

**Both backends run on Windows.** windows-hello and windows-window each
have an `…Llvm` product; both match their C builds on the VM.
`nts emit-llvm <tsconfig> --os windows` shows the Windows module on Linux.

**What bind-winmd does not bind yet:** COM
interfaces, and anything the header and metadata disagree on. The raw
Win32 surface is C-shaped (`CreateWindowExW` with twelve arguments); the
idiomatic layer on top of it is W4.

## W2, the Windows Runtime from TypeScript: where it stands

`examples/interop/windows-winrt` runs on Windows on both backends and both
providers. Each piece below is one line of its output, and a C oracle making
the same vtable calls on the VM measured the behaviour first.

- **Calls:** `@ntsVtable`, `@ntsHresult`, `@ntsFactory`, `Family::Com`,
  HSTRING both ways, and a failed HRESULT thrown with the system's text.
  (Landing now; the first three commits.)
- **bind-winmd for WinRT:**
  - interfaces slot for slot;
  - generics, with instantiation IIDs computed by the pinterface SHA-1;
  - `QueryInterface` by `as_X`, for a class's own interfaces and every base
    class's;
  - default constructors;
  - structs by value;
  - composable classes constructed as themselves.
- **Delegates and events:**
  - A TypeScript function is a COM delegate object whose `Invoke` is a
    per-signature adapter. The closure is lent until the object's count
    reaches zero.
  - The object is not agile: a source on another thread must marshal to the
    owner's.
  - A handler that throws ends the process naming the boundary; it never
    answers S_OK for a failure.
- **Not yet:**
  - `IAsyncOperation` as a Promise, which needs a decision about whether a
    console program's loop pumps messages (the user's to make).
  - `out` parameters other than the result.
  - Arrays.
  - Generic delegates whose IID depends on the interface's own parameters
    (`IObservableMap<K, V>.MapChanged`).

## W3, WinUI 3: where it stands

`examples/interop/winui-hello` runs on Windows, in the signed-in session, on
both backends and both providers:
- an unpackaged program bootstraps the Windows App SDK 1.8;
- `Application.Start` runs a TypeScript callback;
- a `Window` holds a `Button` whose TypeScript `Click` handler UI Automation
  presses;
- a `setTimeout` fires from inside XAML's loop, and `Exit` returns from
  `Start`.

- **The SDK** is fetched by `tooling/windows/fetch-winappsdk.sh`, pinned in
  `winrt.rs`. The bootstrapper is built beside the program and loaded on its
  first `Microsoft.*` activation.
- **The session:** XAML fails fast (0xC000027B) in ssh's session 0, so
  `run.sh --interactive` runs a GUI program as a scheduled task in the
  user's session.
- **Next:**
  - `class App extends Application`, meaning COM aggregation with an outer
    object of the program's. Apple's `extends NSObject` has the
    registration shape to share.
  - XAML controls' default styles, which need the application to be an
    object of the program's: measured with a C oracle on the VM. A plain
    `Application` answers `get_Resources` with E_UNEXPECTED, and a `Button`
    without WinUI's resources has no template (`ActualWidth` 0). An outer
    object aggregating `Application` changes both. It implements
    `IApplicationOverrides.OnLaunched` and `IXamlMetadataProvider`, delegating
    the provider to `XamlControlsXamlMetaDataProvider`. `Resources` works, and
    merging `XamlControlsResources` in `OnLaunched` templates the button
    (`ActualWidth` 24). `XamlControlsResources` asks the application for
    its metadata provider while it activates. No `resources.pri` is involved.
    So the milestone is `class App extends Application`, with the metadata
    provider supplied for the program.
  - The idiomatic layer (W4).

## Next

1. **W1 is closed.** One named gap: under LLVM on Win64, an exported
   function taking or returning an erased value or a `bigint` is refused (7
   functions in 3 examples); it needs a C-convention entry beside it.
2. **W2's rest** as listed above, then **W3's** subclassing.
3. **W4:** the idiomatic layer, packaging, and a benchmark against
   C#/CsWinRT and C++/WinRT.

## Rules this lane keeps

- Two arms per claim, and assertions on the artifact rather than the status.
- Builds and tests run from `~/.cache/nts/windows/wt`.
- A commit lands by fast-forward only when main is its tested base, or when
  what moved since touches no code.
- **A result that did not run on Windows says so.** "Links" is not "runs",
  and an x86_64 run is not an arm64 run.
