# Windows

Windows programs written in TypeScript against Win32, the Windows Runtime and
WinUI 3, compiled to native code and cross-built from Linux. For anyone
writing a Windows program for nts or binding a Windows API. It builds on the
[native target](native.md) and its C interop. nts itself does not run on
Windows yet: native Windows is to be its third host, after Linux and macOS,
and WSL serves meanwhile ([native](native.md#decisions)).

## Targets and the toolchain

`target.windows({ arch, backend })` builds an x86-64 or arm64 PE on the C or
LLVM backend; a console executable imports only Windows' own DLLs.

- **Compiling and linking.** clang compiles against zig's mingw-w64 headers,
  which is what lets the witness run, and `zig cc` links: the mingw ABI. MSVC
  comes later, when a consumer needs an MSVC-built library; COM and the
  Windows Runtime are C vtable ABIs and do not depend on the choice. libuv is
  cross-built from its `src/win` (`tooling/windows/build-libuv.sh`).
- **LLP64.** `c_long` is 32 bits here; `c_long32` and `c_ulong32` spell
  Windows' `LONG` and `DWORD` as numbers whose C spelling is `long`. LLVM calls
  by Win64's convention (16-byte values by reference, `sret` results), from a
  runtime signature table clang generates for Win64.
- **Linking what is called.** `@ntsLibrary` names the import library a
  function needs, so a program links the libraries of the functions it calls
  and no others. A shared library ships its import `.lib` beside the `.dll`.
- **The Windows App SDK** is fetched at a pinned version
  (`tooling/windows/fetch-winappsdk.sh`); its bootstrapper is built beside a
  WinUI program and loaded at the first `Microsoft.*` activation.
- **Refused by name:** a bit-field record under Win64 (Microsoft's placement
  is not implemented), and on arm64 Windows an export that takes or returns an
  erased value or a `bigint`.

Nothing packages a program beyond its executable.

## Win32

Win32 is reached through `c:Windows.Win32.*` modules, one per metadata
namespace, generated from `Windows.Win32.winmd` by `nts bind-winmd`:

```ts
import type { HWND, LPARAM, LRESULT, WPARAM } from "c:Windows.Win32.Foundation";
import { GetModuleHandleW } from "c:Windows.Win32.System.LibraryLoader";
import { WM_TIMER } from "c:Windows.Win32.UI.WindowsAndMessaging";
```

- The metadata gives each item's meaning and clang gives its exact C type
  against the mingw headers; where the two disagree on a width, the item is
  refused, not guessed.
- Handles form a `Class` hierarchy from the metadata (`HBRUSH` passes as
  `HGDIOBJ`); handles the header makes one C type are one type.
- A constant is a declaration carrying its value
  (`/** @ntsConstant 275 */ export const WM_TIMER: c_uint;`), folded where it
  is read.
- A struct a function takes by value is `ByValue<T>`, written as its fields
  where that reads better.
- A window procedure is a TypeScript function; the program's own
  `GetMessageW` loop runs it.

## The Windows Runtime

`winrt:` modules are generated from `.winmd` metadata, and the surface is the
one the Windows Runtime's JavaScript projection had: types in PascalCase,
members in camelCase.

- **A call is a typed indirect call** through the receiver's COM table, at a
  slot fixed at compile time (`@ntsVtable`): one load and one call, with no
  run-time metadata. A failed HRESULT (`@ntsHresult`) is thrown as an `Error`
  with the system's text for it. A static is called on the class's activation
  factory, cached after the first use (`@ntsFactory`).
- **Classes and interfaces.** `new TextBlock()` activates the class; a
  composable class is constructed as itself; a class's members are reached
  through the interface that declares them, asked for with `QueryInterface`
  where needed. Generic interfaces carry their instantiation's IID.
  `instanceof` asks the object for the class's default interface.
- **Properties** come from each `get_X`/`put_X` pair; **events** are
  `addEventListener` and `removeEventListener`, and a function added twice is
  added once.
- **Values:** a primitive passed where any object is taken is boxed as an
  `IPropertyValue`, and one read back is unboxed. A struct holding a string is
  a plain object (`Copied<T>`); byte arrays are lent `Uint8Array`s, arrays of
  objects and strings cross both ways. `for…of` walks a vector by index and any
  other iterable by its iterator.

## WinUI 3

```ts
import { Application, Window } from "winrt:Microsoft.UI.Xaml";
import type { ILaunchActivatedEventArgs } from "winrt:Microsoft.UI.Xaml";

class App extends Application {
  onLaunched(args: ILaunchActivatedEventArgs | null): void {
    super.onLaunched(args);
    const window = new Window();
    window.title = "nts";
    window.activate();
  }
}

Application.start(() => { new App(); });
```

- **A class over a composable WinUI class is COM aggregation**, as C#'s
  projection composes it: the runtime makes an outer object per instance,
  answering the interfaces the class overrides, around the inner object the
  base's factory makes. Every other interface is the inner's.
- An override answers one slot (`@ntsOverride`); the slots a class leaves
  call the base's own implementation, and `super.x()` reaches it too. Fields,
  constructors (opening with `super()`), and overrides that answer records,
  strings or objects work as in C#. Custom layout panels
  (`measureOverride`, `arrangeOverride`) work.
- XAML runs only in a signed-in session, not in ssh's session 0, so a WinUI
  program is run as a scheduled task in the user's session
  (`tooling/windows/run.sh --interactive`).

## The event loop

libuv on Windows is IOCP, with no descriptor to watch, so the host
(`nts_win_host.c`) differs from GLib's and CoreFoundation's: a watcher thread
blocks on libuv's completion port with libuv's own timeout, puts back what it
dequeued, and posts one message to a message-only window, whose procedure pumps
libuv on the owner thread. The program's own message loop delivers that message
like any other, and so does every modal loop Windows runs for it (a message
box, a window being resized), so timers and promises keep running through
them. Every Windows executable attaches the host; a console program never
dispatches the message and runs on `uv_run` as usual.

## Memory at the boundary

- **COM objects are counted with `AddRef` and `Release`**, two slots of the
  object's table, under reference counting: a Windows Runtime method hands back
  an object the caller owns, released once the program is done with it, and a
  binding never declares `AddRef`, `Release` or `QueryInterface`. A foreign
  object lives to the end of everything that reaches it, not to its last
  read.
- **Event-handler cycles leak until the program unsubscribes.** A handler that
  captures its own event's source keeps both alive: no holder family is
  registered for delegates. The asynchronous bindings avoid the shape by
  handing the handler the object instead of capturing it
  ([memory](../foundations/memory.md#cycles-through-foreign-objects)).

## Strings at the boundary

- **Windows Runtime:** a `string` argument becomes an `HSTRING` for the call
  and is given back after it; a returned `HSTRING` is copied into a string and
  deleted. A string array crosses as a block of `HSTRING`s.
- **Win32:** a `W` function's `LPCWSTR` is `Utf16String`, lent in place when
  the string is already two bytes a unit. A lone surrogate passes unchanged
  (Windows' strings are WTF-16), and a U+0000 inside the string stops the
  program ([native](native.md#strings-at-the-boundary)).

## Errors in callbacks

An exception escaping a window procedure or an event handler is the program's
uncaught error. On Windows UI the rule is to report it and keep the loop
running; that is not built, and the program stops with status 1
([errors](../language/errors.md#callbacks-a-host-invokes)).

## What has run where

Windows programs run on a Windows 11 VM (x86-64), on both backends and both
memory providers: `tests/interop/windows-*` and `winui-hello`. arm64 PEs are
built and never run. Without the VM the Windows interop tests report `SKIP`.

## Open questions

- A bundled toolchain:
  [T-1](../open-questions.md#6-bindings-products-toolchains-dependencies).

## Decisions

- Win32 first, then WinRT and COM, then WinUI 3; the mingw ABI through zig
  now, MSVC later; a local Windows 11 VM runs what Linux builds
  ([notebook](../records/notebooks/windows-lane-goal.md)).
- The compiler is to run on native Windows, after Linux and macOS; WSL
  serves meanwhile (T-3; 10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
- No Windows machine or arm64 device is bought yet: Windows builds stay unrun
  at landing, and the hardware comes after a Mac (A-1; 10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
- The Win32 metadata surface, being permissively licensed, may be published;
  surfaces are otherwise generated on each machine (B-3; 10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
- Cycles through WinRT delegates and other host objects are collected in
  memory stage 7 ([memory](../foundations/memory.md#build-order); I-6, 10-28,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
- Windows programs may stay unrun at a landing whose only refusals are their
  platform skips ([log](../records/notebooks/decisions-log.md#team-and-process)).
- An exception escaping a callback on a UI target is reported, and the loop
  keeps running ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
