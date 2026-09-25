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
    declared_in("export interface IJsonValueMethods", 10, "GetBoolean", "GetBoolean(this: IJsonValue): boolean;");
    // `[out]` parameters are the result's fields beside `returnValue`, as
    // the Windows Runtime's JavaScript projection returned them; an object
    // written there may be null.
    assert!(
        module.contains(
            "@ntsVtable 7 TryParse\n     * @ntsHresult out\n     * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C\n     */\n    function TryParse(input: HString): { result: JsonValue | null; returnValue: boolean };"
        ),
        "TryParse's `[out]` parameter is not the field of its result:\n{module}"
    );
    assert!(refused.is_empty(), "Windows.Data.Json refused something:\n{refused}");
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

/// A struct is a `Struct` of its fields, tagged with the C name the compiler
/// defines it by, and crosses by value: `ByValue<T>` where a method takes or
/// answers one -- `BitmapBounds` sixteen bytes, `DateTime` eight, the two
/// sizes Win64 passes differently, both run in `examples/interop/windows-winrt`.
/// A method naming a class this binder refuses is refused with it, rather than
/// written naming a type nothing declares.
#[test]
fn winrt_structs_cross_by_value() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-structs-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Graphics.Imaging", "Windows.Globalization", "Windows.Foundation", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let imaging = std::fs::read_to_string(out.join("Windows.Graphics.Imaging.d.ts")).unwrap();
    let foundation = std::fs::read_to_string(out.join("Windows.Foundation.d.ts")).unwrap();
    let globalization = std::fs::read_to_string(out.join("Windows.Globalization.d.ts")).unwrap();
    let refused = std::fs::read_to_string(out.join("Windows.Graphics.Imaging.refused.txt")).unwrap();
    assert!(
        imaging.contains("export type BitmapBounds = Struct<{ X: c_uint32; Y: c_uint32; Width: c_uint32; Height: c_uint32 }, \"Windows_Graphics_Imaging_BitmapBounds\">;"),
        "{imaging}"
    );
    assert!(imaging.contains("put_Bounds(this: IBitmapTransform, value: ByValue<BitmapBounds>): void;"), "{imaging}");
    assert!(imaging.contains("get_Bounds(this: IBitmapTransform): ByValue<BitmapBounds>;"), "{imaging}");
    assert!(foundation.contains("export type DateTime = Struct<{ UniversalTime: c_int64 }, \"Windows_Foundation_DateTime\">;"), "{foundation}");
    // `System.Guid`, which no `.winmd` defines, is `winrt:types`' struct; a
    // `ref const` struct is a `ConstPtr` to the caller's storage, lent.
    assert!(foundation.contains("function CreateNewGuid(): ByValue<Guid>;"), "{foundation}");
    assert!(
        foundation.contains("@ntsVtable 8 Equals\n     * @ntsNoEscape target\n     * @ntsNoEscape value\n")
            && foundation.contains("function Equals(target: ConstPtr<Guid>, value: ConstPtr<Guid>): boolean;"),
        "{foundation}"
    );
    assert!(globalization.contains("SetDateTime(this: ICalendar, value: ByValue<DateTime>): void;"), "{globalization}");
    // A class whose default interface is an instantiation is bound as it,
    // and named where a method answers it.
    assert!(imaging.contains("export type BitmapPropertySet = IMap<HString, IBitmapTypedValue> & BitmapPropertySetInterfaces;"), "{imaging}");
    assert!(imaging.contains("): IAsyncOperationOfBitmapPropertySet;"), "{imaging}");
    assert!(!refused.contains("BitmapPropertySet"), "{refused}");
    let _ = std::fs::remove_dir_all(&out);
}

/// A composable class is constructed as itself: its public factory's methods
/// without the outer and inner objects, tagged for the compiler to supply
/// them. A protected factory, which only a subclass calls, is not bound.
/// Bytes: a `Uint8Array` borrowed in place, its `UINT32` length before it, and
/// `@ntsNoEscape` because the Windows Runtime's ABI forbids a callee to keep
/// an array it is lent. An `[in]` array is `const`; an `[out]` one the caller
/// allocates and the callee fills, so it is an argument too. One the callee
/// allocates (`CopyToByteArray`) is refused.
#[test]
fn winrt_byte_arrays_are_lent_in_place() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-bytes-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Storage.Streams", "Windows.Security.Cryptography", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let streams = std::fs::read_to_string(out.join("Windows.Storage.Streams.d.ts")).unwrap();
    let crypto = std::fs::read_to_string(out.join("Windows.Security.Cryptography.d.ts")).unwrap();
    let refused = std::fs::read_to_string(out.join("Windows.Security.Cryptography.refused.txt")).unwrap();
    assert!(
        streams.contains("@ntsNoEscape value\n     * @ntsHresult\n     */\n    WriteBytes(this: IDataWriter, value: Counted<CBytes<\"const uint8_t\">, CNumber<\"uint32\">, \"before\">): void;"),
        "{streams}"
    );
    assert!(
        streams.contains("@ntsNoEscape value\n     * @ntsHresult\n     */\n    ReadBytes(this: IDataReader, value: Counted<CBytes<\"uint8_t\">, CNumber<\"uint32\">, \"before\">): void;"),
        "{streams}"
    );
    assert!(crypto.contains("function CreateFromByteArray(value: Counted<CBytes<\"const uint8_t\">, CNumber<\"uint32\">, \"before\">): IBuffer;"), "{crypto}");
    assert!(refused.contains("CryptographicBuffer.CopyToByteArray\tan array"), "{refused}");
    let _ = std::fs::remove_dir_all(&out);
}

/// An instantiation whose members depend on its arguments -- a handler
/// whose IID is computed from them -- is declared for those arguments:
/// `IAsyncOperation<StorageFolder>` is `IAsyncOperationOfStorageFolder`,
/// with the `put_Completed` its generic interface could not declare. The IID
/// is the one Windows accepted in `examples/interop/windows-winrt`, where a
/// wrong one kept the completion from ever arriving.
#[test]
fn an_instantiation_declares_the_members_its_arguments_decide() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-specialized-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Storage", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let storage = std::fs::read_to_string(out.join("Windows.Storage.d.ts")).unwrap();
    assert!(storage.contains("GetFolderFromPathAsync(this: IStorageFolderStatics, path: HString): IAsyncOperationOfStorageFolder;"), "{storage}");
    assert!(
        storage.contains("export type IAsyncOperationOfStorageFolder = IAsyncOperation<IStorageFolder> & IAsyncOperationOfStorageFolderMethods;"),
        "{storage}"
    );
    assert!(
        storage.contains(
            "put_Completed(this: IAsyncOperationOfStorageFolder, handler: Delegate<(asyncInfo: IAsyncOperationOfStorageFolder, asyncStatus: CEnum<AsyncStatus, c_int32>) => void, \"C211026E-9E63-5452-BA54-3A07D6A96874\">): void;"
        ),
        "{storage}"
    );
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn composable_classes_are_constructed_as_themselves() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-composable-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.UI.Xaml.Controls", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let module = std::fs::read_to_string(out.join("Windows.UI.Xaml.Controls.d.ts")).unwrap();
    let button = &module[module.find("export namespace Button {").expect("no Button namespace")..];
    let button = &button[..button.find("\n  }").unwrap()];
    assert!(
        button.contains("@ntsHresult composable\n     * @ntsFactory Windows.UI.Xaml.Controls.Button ") && button.contains("function CreateInstance(): Button;"),
        "{button}"
    );
    // The factory interface's own method is that constructor, not a method
    // to call with an outer object and answer an inner one: refused, saying
    // so, rather than as the `[out]` parameter its inner object is.
    // A class whose default interface is an instantiation is that
    // instantiation: a panel's children are an `IVector<IUIElement>`.
    assert!(
        module.contains("export type UIElementCollection = IVector<IUIElement> & UIElementCollectionInterfaces;"),
        "UIElementCollection is not its IVector<IUIElement>:\n{}",
        module.lines().filter(|line| line.contains("UIElementCollection")).collect::<Vec<_>>().join("\n")
    );
    let refused = std::fs::read_to_string(out.join("Windows.UI.Xaml.Controls.refused.txt")).unwrap();
    assert!(
        refused.contains("IButtonFactory.CreateInstance\ta composable factory method, called as its class's constructor"),
        "{refused}"
    );
    // A class answers every interface of the classes it derives from, and a
    // parameter taking a class takes its default interface.
    let queries = &module[module.find("export interface ButtonInterfaces {").expect("no ButtonInterfaces")..];
    let queries = &queries[..queries.find("\n  }").unwrap()];
    for base in ["as_IButtonBase(this: Button)", "as_IContentControl(this: Button)", "as_IUIElement(this: Button)"] {
        assert!(queries.contains(base), "no {base}:\n{queries}");
    }
    assert!(!queries.contains("Overrides"), "an overridable interface is queried:\n{queries}");
    // `Control`'s factory is protected: a control is only ever a subclass.
    let control = &module[module.find("export namespace Control {").expect("no Control namespace")..];
    assert!(!control.split("\n  }").next().unwrap_or("").contains("CreateInstance"), "a protected factory was bound");
    let _ = std::fs::remove_dir_all(&out);
}

/// Two namespaces declaring one name: `Microsoft.UI.Xaml` declares
/// `LaunchActivatedEventArgs` and names `Windows.ApplicationModel.
/// Activation`'s, which it imports under its namespace's path. Needs the
/// Windows App SDK (tooling/windows/fetch-winappsdk.sh).
#[test]
fn a_name_two_namespaces_declare_is_imported_under_its_path() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    // The release `winrt.rs` pins, read as `fetch-winappsdk.sh` reads it, so a
    // new pin cannot turn this into a skip.
    let pinned = include_str!("../src/bind_winmd/winrt.rs")
        .lines()
        .find_map(|line| line.split("WINAPPSDK_VERSION: &str = \"").nth(1))
        .and_then(|rest| rest.split('"').next())
        .expect("WINAPPSDK_VERSION");
    let sdk = metadata.parent().map(|root| root.join(format!("winappsdk-{pinned}")));
    let Some(sdk) = sdk.filter(|sdk| sdk.join("Microsoft.UI.Xaml.winmd").is_file()) else {
        eprintln!("skipping: needs the Windows App SDK (tooling/windows/fetch-winappsdk.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-alias-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Microsoft.UI.Xaml", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", std::env::join_paths([&metadata, &sdk]).unwrap())
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let module = std::fs::read_to_string(out.join("Microsoft.UI.Xaml.d.ts")).unwrap();
    assert!(module.contains("export type LaunchActivatedEventArgs = "), "the local one is not declared");
    assert!(
        module.contains("LaunchActivatedEventArgs as Windows_ApplicationModel_Activation_LaunchActivatedEventArgs"),
        "the other is not imported under its path"
    );
    let _ = std::fs::remove_dir_all(&out);
}

/// The runtime bootstraps the Windows App SDK release the bindings are made
/// from: `NTS_WINAPPSDK_MAJOR_MINOR` in `nts_winrt.c` is the major and minor
/// version of `WINAPPSDK_VERSION`, as `MddBootstrapInitialize2` spells them.
#[test]
fn the_runtime_bootstraps_the_release_bound() {
    let pinned = include_str!("../src/bind_winmd/winrt.rs")
        .lines()
        .find_map(|line| line.split("WINAPPSDK_VERSION: &str = \"").nth(1))
        .and_then(|rest| rest.split('"').next())
        .expect("WINAPPSDK_VERSION");
    let mut parts = pinned.split('.').map(|part| part.parse::<u32>().unwrap());
    let (major, minor) = (parts.next().unwrap(), parts.next().unwrap());
    let runtime = include_str!("../../../runtime/c/nts_winrt.c");
    let defined = runtime
        .lines()
        .find_map(|line| line.strip_prefix("#define NTS_WINAPPSDK_MAJOR_MINOR "))
        .expect("NTS_WINAPPSDK_MAJOR_MINOR");
    let value = u32::from_str_radix(defined.trim().trim_start_matches("0x").trim_end_matches('u'), 16).unwrap();
    assert_eq!(value, (major << 16) | minor, "the runtime bootstraps {value:#010x}, the bindings are {pinned}");
}
