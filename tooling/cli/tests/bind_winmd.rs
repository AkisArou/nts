//! `nts bind-winmd` against the real Win32 metadata and mingw's headers.
//!
//! Skipped without them: the metadata is 24 MB and fetched by
//! `tooling/windows/fetch-win32metadata.sh`, never committed, and the headers
//! come from zig. With them, this pins the declarations the Windows lane's
//! programs are built on, and that the check drops what the headers reject.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;
use std::process::Command;

fn winmd() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("NTS_WIN32_WINMD") {
        return Some(PathBuf::from(path));
    }
    let root = std::env::var_os("NTS_WINDOWS_ROOT").map_or_else(
        || PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".cache/nts/windows"),
        PathBuf::from,
    );
    let dir = std::fs::read_dir(root.join("metadata")).ok()?;
    dir.filter_map(Result::ok)
        .map(|entry| entry.path().join("Windows.Win32.winmd"))
        .find(|path| path.is_file())
}

#[test]
fn win32_bindings_carry_the_metadata_meaning_and_the_header_types() {
    let zig = Command::new("zig").arg("version").output().is_ok_and(|o| o.status.success());
    let Some(winmd) = winmd().filter(|_| zig) else {
        eprintln!("skipping: needs zig and the Win32 metadata (tooling/windows/fetch-win32metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winmd-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Win32.UI.WindowsAndMessaging", "Windows.Win32.System.LibraryLoader", "--out"])
        .arg(&out)
        .arg("--winmd")
        .arg(&winmd)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let read = |name: &str| std::fs::read_to_string(out.join(name)).unwrap();
    let messaging = read("Windows.Win32.UI.WindowsAndMessaging.d.ts");
    let foundation = read("Windows.Win32.Foundation.d.ts");
    let values = read("Windows.Win32.UI.WindowsAndMessaging.values.ts");
    let refused = read("Windows.Win32.UI.WindowsAndMessaging.refused.txt");

    // Meaning from the metadata: optional is `| null`, a read-only `PWSTR`
    // is a lent `Utf16String`, a flags parameter is its enum. Type from the
    // header: `DWORD` is `unsigned long`, a 32-bit `c_ulong32` on Windows.
    assert!(
        messaging.contains(
            "export function CreateWindowExW(dwExStyle: CEnum<WINDOW_EX_STYLE, c_ulong32>, lpClassName: Utf16String | null, \
             lpWindowName: Utf16String | null, dwStyle: CEnum<WINDOW_STYLE, c_ulong32>, X: c_int, Y: c_int, nWidth: c_int, \
             nHeight: c_int, hWndParent: HWND | null, hMenu: HMENU | null, hInstance: HINSTANCE | null, lpParam: Ptr<void> | null): HWND | null;"
        ),
        "CreateWindowExW is not what the metadata and <winuser.h> say together"
    );
    // The C tag comes from the header, where the metadata has only `MSG`.
    assert!(
        messaging.contains(
            "export type MSG = Struct<{ hwnd: HWND | null; message: c_uint; wParam: WPARAM; lParam: LPARAM; time: c_ulong32; pt: POINT }, \"tagMSG\">;"
        ),
        "MSG is not laid out as <winuser.h> declares it"
    );
    assert!(
        messaging.contains("export type WNDPROC = (param0: HWND, param1: c_uint, param2: WPARAM, param3: LPARAM) => LRESULT;"),
        "WNDPROC is not the callback <winuser.h> declares"
    );
    // A handle is the struct the header's DECLARE_HANDLE makes, and `HANDLE`
    // itself, which is `void *` there, is erased but kept distinct.
    // Each handle is a `Class`, and the metadata's `[AlsoUsableFor]` is its
    // parent: an `HWND` passes where a `HANDLE` is taken, with no cast.
    assert!(foundation.contains("export type HWND = Class<\"HWND__\", HANDLE>;"), "{foundation}");
    assert!(foundation.contains("export type HANDLE = Erased<Class<\"HANDLE\">>;"), "{foundation}");
    // Where the header makes a handle and its parent one C type, the
    // binding does too: `wc.hInstance = GetModuleHandleW(null)` typechecks.
    // Which of the two is spelled as the alias follows the order they are
    // reached in, and either is the same type.
    assert!(
        foundation.contains("export type HINSTANCE = HMODULE;") || foundation.contains("export type HMODULE = HINSTANCE;"),
        "{foundation}"
    );
    // A record a function takes by value is `ByValue<T>`, as bind-c writes it.
    assert!(
        messaging.contains("export function WindowFromPoint(Point: ByValue<POINT>): HWND | null;"),
        "WindowFromPoint does not take its POINT by value"
    );
    // The DLL, as the import library a program links when it calls this.
    let create = messaging.find("export function CreateWindowExW(").unwrap();
    let doc = &messaging[messaging[..create].rfind("/**").unwrap()..create];
    assert!(doc.contains("@ntsLibrary user32"), "CreateWindowExW does not name user32: {doc}");
    assert!(values.contains("export const WM_TIMER = 275 as c_uint;"), "no WM_TIMER");
    // `PWSTR` that is not read-only is a buffer the caller owns, not a lent
    // string: `LoadStringW` writes into it.
    assert!(
        messaging.contains("export function LoadStringW(hInstance: HINSTANCE | null, uID: c_uint, lpBuffer: Ptr<c_uint16>, cchBufferMax: c_int): c_int;"),
        "LoadStringW's buffer is not a writable UTF-16 pointer"
    );
    // The check is real: `SM_CMETRICS` counts the system metrics, and the
    // metadata (a newer SDK) and mingw's header disagree about how many. It is
    // refused rather than written with either number.
    assert!(!values.contains("export const SM_CMETRICS ="), "SM_CMETRICS was written despite disagreeing with the header");
    assert!(
        refused.lines().any(|line| line == "SM_CMETRICS\tits value disagrees with the header"),
        "SM_CMETRICS's refusal is not reported"
    );
    let functions = messaging.matches("export function ").count();
    assert!(functions >= 250, "only {functions} functions bound from WindowsAndMessaging");
    let _ = std::fs::remove_dir_all(&out);
}

/// The directory of Windows Runtime contract `.winmd`s, as
/// `tooling/windows/fetch-winrt-metadata.sh` leaves it.
fn winrt_metadata() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("NTS_WINRT_METADATA") {
        return Some(PathBuf::from(path));
    }
    let root = std::env::var_os("NTS_WINDOWS_ROOT").map_or_else(
        || PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".cache/nts/windows"),
        PathBuf::from,
    );
    std::fs::read_dir(root.join("metadata"))
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.join("Windows.Foundation.UniversalApiContract.winmd").is_file())
}

/// A Windows Runtime namespace, read off the contract metadata alone: each
/// method's slot and name as the metadata gives them, a class's statics on its
/// factory as the static interface's IID, and what is not bound yet refused
/// by name.
///
/// **The pairs are the metadata's, checked against the C oracle that ran on
/// Windows**: `Parse` is slot 6 of `IJsonValueStatics`, `Stringify` 7 and
/// `GetNumber` 9 of `IJsonValue` -- the calls `examples/interop/windows-winrt`
/// makes, and the ones a hand-written oracle made first. A binder that
/// numbered from 0, or skipped a refused method's slot, fails here.
#[test]
fn winrt_bindings_are_the_metadata_slot_for_slot() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Data.Json", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let module = std::fs::read_to_string(out.join("Windows.Data.Json.d.ts")).unwrap();
    let refused = std::fs::read_to_string(out.join("Windows.Data.Json.refused.txt")).unwrap();
    // Within `scope`, the first declaration after `@ntsVtable <slot> <name>`.
    let declared_in = |scope: &str, slot: u32, name: &str, rest: &str| {
        let within = &module[module.find(scope).unwrap_or_else(|| panic!("no `{scope}`:\n{module}"))..];
        let tag = format!("@ntsVtable {slot} {name}\n");
        let at = within.find(&tag).unwrap_or_else(|| panic!("no `{tag}` in `{scope}`:\n{module}"));
        let after = &within[at..];
        let line = after.lines().find(|line| line.trim_start().starts_with(name) || line.contains(&format!("function {name}("))).unwrap();
        assert!(line.contains(rest), "{name} at slot {slot}: {line}");
    };
    declared_in("export interface IJsonValueMethods", 7, "Stringify", "Stringify(this: IJsonValue): HString;");
    declared_in("export interface IJsonValueMethods", 9, "GetNumber", "GetNumber(this: IJsonValue): CNumber<\"double\">;");
    declared_in("export namespace JsonValue", 6, "Parse", "function Parse(input: HString): JsonValue;");
    assert!(
        module.contains("@ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C"),
        "JsonValue's statics are not on its factory as IJsonValueStatics:\n{module}"
    );
    // A class is its default interface, and its others by `as_` queries.
    assert!(module.contains("export type JsonValue = IJsonValue & JsonValueInterfaces;"), "{module}");
    assert!(module.contains("export namespace JsonValue {"), "{module}");
    assert!(module.contains("ComClass<\"Windows_Data_Json_IJsonValue\">"), "{module}");
    // A class's other interface, by the IID the Windows Runtime computes for
    // the instantiation: the value Windows answered `QueryInterface` for, in
    // `examples/interop/windows-winrt`.
    assert!(
        module.contains("@ntsQuery D44662BC-DCE3-59A8-9272-4B210F33908B\n     */\n    as_IVector(this: JsonArray): IVector<IJsonValue>;"),
        "JsonArray is not queried for IVector<IJsonValue> by its computed IID:\n{module}"
    );
    assert!(module.contains("export type JsonArray = IJsonArray & JsonArrayInterfaces;"), "{module}");
    // Refused, each with the reason, and not written.
    assert!(refused.contains("IJsonValueStatics.TryParse\tan `out` parameter"), "{refused}");
    declared_in("export interface IJsonValueMethods", 10, "GetBoolean", "GetBoolean(this: IJsonValue): boolean;");
    assert!(!module.contains("TryParse("), "a refused method was written:\n{module}");
}

/// An event: `add_Closed` takes its handler as a `Delegate` whose function is
/// the delegate's `Invoke` with the instantiation's arguments, and whose IID
/// is the one computed for `TypedEventHandler<IMemoryBufferReference,
/// Object>` -- the IID Windows asked the delegate object for, in
/// `examples/interop/windows-winrt` and in the C oracle before it. An
/// interface's required interfaces are `as_` queries on it too, since every
/// object implementing it answers them: `reference.as_IClosable()`. A
/// delegate a method answers is refused.
#[test]
fn winrt_events_take_delegates_by_their_computed_iid() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-events-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Foundation", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let module = std::fs::read_to_string(out.join("Windows.Foundation.d.ts")).unwrap();
    let refused = std::fs::read_to_string(out.join("Windows.Foundation.refused.txt")).unwrap();
    assert!(
        module.contains("add_Closed(this: IMemoryBufferReference, handler: Delegate<(sender: IMemoryBufferReference, args: IInspectable) => void, \"F4637D4A-0760-5431-BFC0-24EB1D4F6C4F\">): EventRegistrationToken;"),
        "{module}"
    );
    assert!(module.contains("remove_Closed(this: IMemoryBufferReference, cookie: EventRegistrationToken): void;"), "{module}");
    assert!(
        module.contains("@ntsQuery 30D5A829-7FA4-4026-83BB-D75BAE4EA99E\n     */\n    as_IClosable(this: IMemoryBufferReference): IClosable;"),
        "{module}"
    );
    assert!(refused.contains("IAsyncOperation.get_Completed\t`AsyncOperationCompletedHandler`, a delegate as a result"), "{refused}");
    let _ = std::fs::remove_dir_all(&out);
}
