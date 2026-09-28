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
    // Constants are declarations of the module, with no values file beside.
    assert!(!out.join("Windows.Win32.UI.WindowsAndMessaging.values.ts").exists(), "a values file was written");
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
    assert!(messaging.contains("  /** @ntsConstant 275 */\n  export const WM_TIMER: c_uint;\n"), "no WM_TIMER");
    // `PWSTR` that is not read-only is a buffer the caller owns, not a lent
    // string: `LoadStringW` writes into it.
    assert!(
        messaging.contains("export function LoadStringW(hInstance: HINSTANCE | null, uID: c_uint, lpBuffer: Ptr<c_uint16>, cchBufferMax: c_int): c_int;"),
        "LoadStringW's buffer is not a writable UTF-16 pointer"
    );
    // The check is real: `SM_CMETRICS` counts the system metrics, and the
    // metadata (a newer SDK) and mingw's header disagree about how many. It is
    // refused rather than written with either number.
    assert!(!messaging.contains("export const SM_CMETRICS:"), "SM_CMETRICS was written despite disagreeing with the header");
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
    // A class is a TypeScript class of its constructors -- none, for one
    // nothing activates -- merged with its default interface, its others by
    // `as_` queries, and its idiomatic surface.
    assert!(
        module.contains("   * @ntsRuntimeClass Windows.Data.Json.JsonValue\n   */\n  export class JsonValue {\n    private constructor();\n  }"),
        "{module}"
    );
    assert!(module.contains("export interface JsonValue extends IJsonValue, JsonValueInterfaces, JsonValueMembers {}"), "{module}");
    assert!(module.contains("export namespace JsonValue {"), "{module}");
    // Every Windows Runtime interface is an `IInspectable`, the root of its
    // chain, so any object goes where any object is taken.
    assert!(module.contains("ComClass<\"Windows_Data_Json_IJsonValue\", IInspectable>"), "{module}");
    // A class's other interface, by the IID the Windows Runtime computes for
    // the instantiation: the value Windows answered `QueryInterface` for, in
    // `examples/interop/windows-winrt`.
    assert!(
        module.contains("@ntsQuery D44662BC-DCE3-59A8-9272-4B210F33908B\n     */\n    as_IVector(this: JsonArray): IVectorOfIJsonValue;"),
        "JsonArray is not queried for IVector<IJsonValue> by its computed IID:\n{module}"
    );
    assert!(module.contains("export interface JsonArray extends IJsonArray, JsonArrayInterfaces, JsonArrayMembers {}"), "{module}");
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
    // A generic interface's idiomatic surface is its own, on its own table:
    // `list.size`, `list.getAt(0)`, `list.append(v)`, for any `T`.
    let collections = std::fs::read_to_string(out.join("Windows.Foundation.Collections.d.ts")).unwrap();
    assert!(
        collections.contains("export type IVector<T> = ComClass<\"Windows_Foundation_Collections_IVector\", IInspectable> & IVectorMethods<T> & IVectorMembers<T>;"),
        "IVector<T> does not carry its surface"
    );
    assert!(collections.contains("     * @ntsGet 7 get_Size\n     */\n    readonly size: CNumber<\"uint32\">;"), "IVector<T> has no `size`");
    assert!(
        collections.contains("     * @ntsVtable 13 Append\n     * @ntsHresult\n     */\n    append(this: IVector<T>, value: T): void;"),
        "IVector<T> has no `append`"
    );
    // And it is walked by count, `for (const x of list)`.
    assert!(
        collections.contains("     * @ntsIterate get_Size GetAt\n     */\n    [Symbol.iterator](): Iterator<T>;"),
        "a vector is not iterable"
    );
    // Any other iterable by the iterator its `First` makes -- `IIterable<T>`
    // itself, which a `JsonObject`'s pairs are.
    assert!(
        collections.contains("     * @ntsIterate First\n     */\n    [Symbol.iterator](): Iterator<T>;"),
        "an iterable is not iterable"
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
    // A delegate is a type of its own name, as a parameter taking it spells
    // it; a generic one has no one IID, so no one type.
    assert!(
        module.contains("export type AsyncActionCompletedHandler = Delegate<(asyncInfo: IAsyncAction, asyncStatus: CEnum<AsyncStatus, c_int32>) => void, \"A4ED5C81-76C9-40BD-8BE6-B1D90FB20AE7\">;"),
        "{module}"
    );
    assert!(refused.contains("AsyncOperationCompletedHandler`1\ta generic delegate"), "{refused}");
    // An array of objects the callee allocated is an array of the
    // program's, each element perhaps `null`.
    assert!(module.contains("GetInspectableArray(this: IPropertyValue): { value: (IInspectable | null)[] };"), "{module}");
    // A sealed class's constructors are its activation factory's methods,
    // overloads the checker chooses between: `new Uri(text)`, `new
    // Uri(base, relative)`.
    assert!(
        module.contains(
            "   * @ntsRuntimeClass Windows.Foundation.Uri\n   */\n  export class Uri {\n    /**\n     * @ntsVtable 6 CreateUri\n     * @ntsHresult\n     * @ntsFactory Windows.Foundation.Uri 44A9796F-723E-4FDF-A218-033E75B0C084\n     */\n    constructor(uri: HString);\n    /**\n     * @ntsVtable 7 CreateWithRelativeUri\n     * @ntsHresult\n     * @ntsFactory Windows.Foundation.Uri 44A9796F-723E-4FDF-A218-033E75B0C084\n     */\n    constructor(baseUri: HString, relativeUri: HString);\n  }"
        ),
        "{module}"
    );
    // Strings both ways: `HSTRING`s lent for the call, and copied back out.
    assert!(module.contains("GetStringArray(this: IPropertyValue): { value: string[] };"), "{module}");
    assert!(
        module.contains("CreateStringArray(this: IPropertyValueStatics, value: Counted<HStrings, CNumber<\"uint32\">, \"before\">): Inspectable;"),
        "{module}"
    );
    // Structs both ways, as plain objects copied in and out.
    assert!(module.contains("GetPointArray(this: IPropertyValue): { value: Copied<Point>[] };"), "{module}");
    assert!(
        module.contains("CreatePointArray(this: IPropertyValueStatics, value: Counted<CopiedArray<Point>, CNumber<\"uint32\">, \"before\">): Inspectable;"),
        "{module}"
    );
    // And one the call is passed, as the handles of the interface it takes,
    // their count before them.
    assert!(
        module.contains("CreateInspectableArray(this: IPropertyValueStatics, value: Counted<CHandles<IInspectable>, CNumber<\"uint32\">, \"before\">): Inspectable;"),
        "{module}"
    );
    // An interface declares the IID it is asked for by, which an
    // `instanceof` of a class whose default it is reads.
    assert!(
        module.contains("  /**\n   * @ntsQuery 30D5A829-7FA4-4026-83BB-D75BAE4EA99E\n   */\n  export type IClosable = ComClass<"),
        "{module}"
    );
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
        imaging.contains("export type BitmapBounds = Struct<{ x: c_uint32; y: c_uint32; width: c_uint32; height: c_uint32 }, \"Windows_Graphics_Imaging_BitmapBounds\">;"),
        "{imaging}"
    );
    assert!(imaging.contains("put_Bounds(this: IBitmapTransform, value: ByValue<BitmapBounds> | Fields<BitmapBounds>): void;"), "{imaging}");
    assert!(imaging.contains("get_Bounds(this: IBitmapTransform): ByValue<BitmapBounds>;"), "{imaging}");
    assert!(foundation.contains("export type DateTime = Struct<{ universalTime: c_int64 }, \"Windows_Foundation_DateTime\">;"), "{foundation}");
    // `System.Guid`, which no `.winmd` defines, is `winrt:types`' struct; a
    // `ref const` struct is a `ConstPtr` to the caller's storage, lent.
    assert!(foundation.contains("function CreateNewGuid(): ByValue<Guid>;"), "{foundation}");
    assert!(
        foundation.contains("@ntsVtable 8 Equals\n     * @ntsNoEscape target\n     * @ntsNoEscape value\n")
            && foundation.contains("function Equals(target: ConstPtr<Guid>, value: ConstPtr<Guid>): boolean;"),
        "{foundation}"
    );
    assert!(globalization.contains("SetDateTime(this: ICalendar, value: ByValue<DateTime> | Fields<DateTime>): void;"), "{globalization}");
    // A class's static property: a variable of its namespace, `let` where it
    // is written as it is read, `const` where it is only read.
    assert!(
        globalization.contains("     * @ntsGet 6 get_PrimaryLanguageOverride\n     * @ntsSet 7 put_PrimaryLanguageOverride\n     * @ntsFactory Windows.Globalization.ApplicationLanguages 75B40847-0A4C-4A92-9565-FD63C95F7AED\n     */\n    let primaryLanguageOverride: HString;"),
        "no writable static property"
    );
    assert!(
        globalization.contains("     * @ntsGet 8 get_Languages\n     * @ntsFactory Windows.Globalization.ApplicationLanguages 75B40847-0A4C-4A92-9565-FD63C95F7AED\n     */\n    const languages: IVectorViewOfString;"),
        "no read-only static property"
    );
    // A class whose default interface is an instantiation is bound as it,
    // and named where a method answers it.
    assert!(
        imaging.contains("export interface BitmapPropertySet extends IMap<HString, IBitmapTypedValue>, BitmapPropertySetInterfaces, BitmapPropertySetMembers {}"),
        "{imaging}"
    );
    assert!(imaging.contains("): IAsyncOperationOfBitmapPropertySet;"), "{imaging}");
    assert!(!refused.contains("BitmapPropertySet"), "{refused}");
    let _ = std::fs::remove_dir_all(&out);
}

/// A struct holding a string -- `TypeName`, which `Frame.Navigate` takes and
/// `SourcePageType` answers -- is a plain object copied at the call
/// (`Copied<T>`), and not refused: its string is an `HString` field.
#[test]
fn a_struct_holding_a_string_is_copied() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-copied-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.UI.Xaml.Controls", "Windows.UI.Xaml.Interop", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let interop = std::fs::read_to_string(out.join("Windows.UI.Xaml.Interop.d.ts")).unwrap();
    let controls = std::fs::read_to_string(out.join("Windows.UI.Xaml.Controls.d.ts")).unwrap();
    let refused = std::fs::read_to_string(out.join("Windows.UI.Xaml.Controls.refused.txt")).unwrap();
    assert!(
        interop.contains("export type TypeName = Struct<{ name: HString; kind: CEnum<TypeKind, c_int32> }, \"Windows_UI_Xaml_Interop_TypeName\">;"),
        "{interop}"
    );
    assert!(controls.contains("Navigate(this: IFrame, sourcePageType: Copied<TypeName>, parameter: Inspectable | null): boolean;"), "{controls}");
    assert!(controls.contains("sourcePageType: Copied<TypeName>;"), "{controls}");
    assert!(!refused.contains("TypeName"), "{refused}");
    let _ = std::fs::remove_dir_all(&out);
}

/// A struct's `boolean` field is one byte read as a boolean
/// (`CBool<c_uint8>`): `CorePhysicalKeyStatus`, which a key event answers,
/// is declared rather than refused.
#[test]
fn a_boolean_struct_field_is_a_one_byte_boolean() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-bool-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.UI.Core", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let module = std::fs::read_to_string(out.join("Windows.UI.Core.d.ts")).unwrap();
    assert!(
        module.contains("export type CorePhysicalKeyStatus = Struct<{ repeatCount: c_uint32; scanCode: c_uint32; isExtendedKey: CBool<c_uint8>; isMenuKeyDown: CBool<c_uint8>; wasKeyDown: CBool<c_uint8>; isKeyReleased: CBool<c_uint8> }, \"Windows_UI_Core_CorePhysicalKeyStatus\">;"),
        "{module}"
    );
    let _ = std::fs::remove_dir_all(&out);
}

/// A struct holding objects -- `HttpProgress`'s `IReference<UInt64>` -- is
/// declared with each as its handle, which may be null: it never crosses by
/// value (a copy would be a second owner), but what names it binds, and
/// `HttpClient.GetStringAsync`'s operation with it.
#[test]
fn a_struct_holding_objects_is_declared_so_http_binds() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-http-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Web.Http", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let module = std::fs::read_to_string(out.join("Windows.Web.Http.d.ts")).unwrap();
    let refused = std::fs::read_to_string(out.join("Windows.Web.Http.refused.txt")).unwrap();
    assert!(module.contains("totalBytesToSend: IReference<c_uint64> | null;"), "{module}");
    assert!(module.contains("getStringAsync(uri: IUriRuntimeClass | null): IAsyncOperationWithProgressOfStringHttpProgress;"), "{module}");
    assert!(!refused.contains("HttpProgress"), "{refused}");
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
    // `CopyToByteArray`'s array is the callee's, which this refused until it
    // was bound as a `Uint8Array`: `a_received_array_is_a_typed_array`.
    assert!(!refused.contains("CryptographicBuffer.CopyToByteArray"), "{refused}");
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

/// An async operation is awaitable as itself: each specialisation declares
/// `then`, naming with `@ntsCall` a function the values module beside it
/// defines, which subscribes `Completed` and decides by the status it is
/// handed. The generic interface answers `IAsyncInfo`, which does not depend
/// on its arguments, so an awaited operation still reports its status.
#[test]
fn an_async_operation_is_awaitable_as_itself() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-then-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Storage", "Windows.Foundation", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let storage = std::fs::read_to_string(out.join("Windows.Storage.d.ts")).unwrap();
    assert!(storage.contains("@ntsCall nts_then_IAsyncOperationOfStorageFolder"), "{storage}");
    assert!(
        storage.contains(
            "then(this: IAsyncOperationOfStorageFolder, onFulfilled: (value: IStorageFolder) => unknown, onRejected: (reason: unknown) => unknown): void;"
        ),
        "{storage}"
    );
    let values = std::fs::read_to_string(out.join("Windows.Storage.values.ts")).unwrap();
    assert!(values.contains("export function nts_then_IAsyncOperationOfStorageFolder("), "{values}");
    for arm in [
        "if (status === AsyncStatus.Completed) {",
        "onFulfilled(completed.GetResults());",
        "if (status === AsyncStatus.Canceled) {",
        "canceled.name = \"Canceled\";",
        "completed.GetResults();\n      } catch (error) {\n        onRejected(error);",
    ] {
        assert!(values.contains(arm), "{arm}\n{values}");
    }
    assert!(values.contains("import { AsyncStatus } from \"winrt:Windows.Foundation\";"), "{values}");
    let foundation = std::fs::read_to_string(out.join("Windows.Foundation.d.ts")).unwrap();
    assert!(foundation.contains("as_IAsyncInfo(this: IAsyncOperation<TResult>): IAsyncInfo;"), "{foundation}");
    // An action completes with nothing: its callback takes `void`, which is
    // what `await` on one is, and its function fulfils with `undefined`.
    assert!(
        foundation.contains(
            "then(this: IAsyncAction, onFulfilled: (value: void) => unknown, onRejected: (reason: unknown) => unknown): void;"
        ),
        "{foundation}"
    );
    let foundation_values = std::fs::read_to_string(out.join("Windows.Foundation.values.ts")).unwrap();
    assert!(foundation_values.contains("export function nts_then_IAsyncAction("), "{foundation_values}");
    assert!(foundation_values.contains("onFulfilled(undefined);"), "{foundation_values}");
    let _ = std::fs::remove_dir_all(&out);
}

/// An operation whose result is a struct -- `LoadMoreItemsAsync`'s
/// `LoadMoreItemsResult` -- fulfils with the struct as a plain object
/// (`Copied<T>`): `GetResults` answers storage in the frame, which a callback
/// cannot be handed, so the values module copies each field out of it.
#[test]
fn a_struct_result_is_fulfilled_as_a_plain_object() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-struct-then-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.UI.Xaml.Data", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let data = std::fs::read_to_string(out.join("Windows.UI.Xaml.Data.d.ts")).unwrap();
    assert!(
        data.contains(
            "then(this: IAsyncOperationOfLoadMoreItemsResult, onFulfilled: (value: Copied<LoadMoreItemsResult>) => unknown, onRejected: (reason: unknown) => unknown): void;"
        ),
        "{data}"
    );
    let values = std::fs::read_to_string(out.join("Windows.UI.Xaml.Data.values.ts")).unwrap();
    assert!(
        values.contains("const result = completed.GetResults();\n        onFulfilled({ count: result.count });"),
        "{values}"
    );
    assert!(values.contains("import type { Copied } from \"winrt:types\";"), "{values}");
    let refused = std::fs::read_to_string(out.join("Windows.UI.Xaml.Data.refused.txt")).unwrap();
    assert!(!refused.contains(".then"), "{refused}");
    let _ = std::fs::remove_dir_all(&out);
}

/// An array of an enum is an array of its 32-bit underlying integer, as any
/// array of numbers is: `GetPreferredInteractionMode` takes an `Int32Array`
/// of `UserInteractionMode` members, and an array one answers is one too.
#[test]
fn an_enum_array_is_its_integer_typed_array() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-enum-array-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.UI.ViewManagement", "Windows.Media.Devices", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let view = std::fs::read_to_string(out.join("Windows.UI.ViewManagement.d.ts")).unwrap();
    assert!(
        view.contains("getPreferredInteractionMode(supportedModes: Counted<CElements<Int32Array, \"const int32_t\">, CNumber<\"uint32\">, \"before\">): CEnum<UserInteractionMode, c_int32>;"),
        "{view}"
    );
    let devices = std::fs::read_to_string(out.join("Windows.Media.Devices.d.ts")).unwrap();
    assert!(devices.contains("get_SupportedModes(this: IDigitalWindowControl): Int32Array;"), "{devices}");
    let _ = std::fs::remove_dir_all(&out);
}

/// An array the callee fills (`FillArray`) is the program's, passed in and
/// written into: objects (`GetMany` of an `IVector<IJsonValue>`) as
/// `FilledHandles`, strings as `FilledStrings`, structs (`DistortPoints`'s
/// `results`) as `FilledArray`, booleans (`GetCurrentReading`'s buttons) as
/// `FilledBooleans` -- and a `boolean[]` a call reads as `Booleans`.
#[test]
fn an_array_the_callee_fills_is_the_programs() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-filled-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Data.Json", "Windows.Media.Devices.Core", "Windows.Globalization", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let json = std::fs::read_to_string(out.join("Windows.Data.Json.d.ts")).unwrap();
    assert!(
        json.contains("GetMany(this: IVectorOfIJsonValue, startIndex: CNumber<\"uint32\">, items: Counted<FilledHandles<IJsonValue>, CNumber<\"uint32\">, \"before\">): CNumber<\"uint32\">;"),
        "{json}"
    );
    let core = std::fs::read_to_string(out.join("Windows.Media.Devices.Core.d.ts")).unwrap();
    assert!(
        core.contains("distortPoints(inputs: Counted<CopiedArray<Point>, CNumber<\"uint32\">, \"before\">, results: Counted<FilledArray<Point>, CNumber<\"uint32\">, \"before\">): void;"),
        "{core}"
    );
    let system = std::fs::read_to_string(out.join("Windows.System.d.ts")).unwrap();
    assert!(
        system.contains("GetMany(this: IVectorViewOfString, startIndex: CNumber<\"uint32\">, items: Counted<FilledStrings, CNumber<\"uint32\">, \"before\">): CNumber<\"uint32\">;"),
        "{system}"
    );
    let _ = std::fs::remove_dir_all(&out);
    // Booleans, whose `boolean[]` elements are the Windows Runtime's bytes:
    // lent in place, to read or to fill.
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Gaming.Input", "Windows.Foundation.Diagnostics", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let gaming = std::fs::read_to_string(out.join("Windows.Gaming.Input.d.ts")).unwrap();
    assert!(gaming.contains("buttonArray: Counted<FilledBooleans, CNumber<\"uint32\">, \"before\">"), "{gaming}");
    let diagnostics = std::fs::read_to_string(out.join("Windows.Foundation.Diagnostics.d.ts")).unwrap();
    assert!(diagnostics.contains("addBooleanArray(name: HString, value: Counted<Booleans, CNumber<\"uint32\">, \"before\">): void;"), "{diagnostics}");
    let _ = std::fs::remove_dir_all(&out);
}

/// An array the callee allocates and hands back (`ReceiveArray`) is a typed
/// array of the program's: `CopyToByteArray`'s `[out] byte[]&` answers a
/// `Uint8Array`, and `IPropertyValue.GetInt32Array` an `Int32Array`. An
/// element no typed array holds is refused, and named.
#[test]
fn a_received_array_is_a_typed_array() {
    let Some(metadata) = winrt_metadata() else {
        eprintln!("skipping: needs the Windows Runtime metadata (tooling/windows/fetch-winrt-metadata.sh)");
        return;
    };
    let out = std::env::temp_dir().join(format!("nts-bind-winrt-received-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&out);
    let run = Command::new(env!("CARGO_BIN_EXE_nts"))
        .args(["bind-winmd", "Windows.Security.Cryptography", "Windows.Foundation", "--out"])
        .arg(&out)
        .env("NTS_WINRT_METADATA", &metadata)
        .output()
        .unwrap();
    assert!(run.status.success(), "{}", String::from_utf8_lossy(&run.stderr));
    let crypto = std::fs::read_to_string(out.join("Windows.Security.Cryptography.d.ts")).unwrap();
    assert!(crypto.contains("function CopyToByteArray(buffer: IBuffer | null): { value: Uint8Array };"), "{crypto}");
    let foundation = std::fs::read_to_string(out.join("Windows.Foundation.d.ts")).unwrap();
    assert!(foundation.contains("GetInt32Array(this: IPropertyValue): { value: Int32Array };"), "{foundation}");
    // The way in: a numeric array other than bytes is a typed array whose
    // elements are borrowed in place, spelled as C spells its element.
    assert!(
        foundation.contains(
            "CreateInt32Array(this: IPropertyValueStatics, value: Counted<CElements<Int32Array, \"const int32_t\">, CNumber<\"uint32\">, \"before\">): Inspectable;"
        ),
        "{foundation}"
    );
    let refused = std::fs::read_to_string(out.join("Windows.Foundation.refused.txt")).unwrap();
    // Booleans are copied into a `boolean[]`; characters, UTF-16 code units
    // as a single one crosses, into a `Uint16Array`. A `Guid` is refused.
    assert!(foundation.contains("GetBooleanArray(this: IPropertyValue): { value: boolean[] };"), "{foundation}");
    assert!(foundation.contains("GetChar16Array(this: IPropertyValue): { value: Uint16Array };"), "{foundation}");
    assert!(refused.contains("IPropertyValue.GetGuidArray\tan array of `System.Guid`, which no typed array holds"), "{refused}");
    let _ = std::fs::remove_dir_all(&out);
}

/// A name two interfaces give as methods is overloaded, as C# overloads it:
/// `IFrame.Navigate` and `IFrame2.Navigate`, one argument apart -- and
/// across a class and its base.
fn overloads_are_declared(module: &str) {
    for overload in [
        "navigate(sourcePageType: Copied<TypeName>, parameter: Inspectable | null): boolean;",
        "navigate(sourcePageType: Copied<TypeName>, parameter: Inspectable | null, infoOverride: INavigationTransitionInfo | null): boolean;",
    ] {
        assert!(module.contains(overload), "no overload {overload}");
    }
    // And across a class and its base: `MenuFlyout`'s own `showAt(target,
    // point)` beside `FlyoutBase`'s two, declared again on `MenuFlyout`,
    // since `extends` needs a base's signatures among the class's.
    let menu = &module[module.find("export interface MenuFlyoutMembers").expect("no MenuFlyoutMembers")..];
    let menu = &menu[..menu.find("\n  }").unwrap()];
    for overload in [
        "showAt(targetElement: IUIElement | null, point: ByValue<Point> | Fields<Point>): void;",
        "showAt(placementTarget: IFrameworkElement | null): void;",
    ] {
        assert!(menu.contains(overload), "no overload {overload}:\n{menu}");
    }
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
    overloads_are_declared(&module);
    // An `IReference<T>` -- C#'s `T?` -- is read as `T | null`, a struct as
    // a plain object; one is still passed as the reference.
    // Set as it is read: one property, the reference made for the call.
    assert!(
        module.contains(
            "     * @ntsGet 6 get_Date\n     * @ntsSet 7 put_Date\n     * @ntsReference value 5541D8A7-497C-5AA4-86FC-7713ADBF2A2C 14\n"
        ),
        "no reference tag on date"
    );
    assert!(module.contains("    date: Copied<DateTime> | null;"), "no nullable date");
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
    // instantiation: a panel's children are an `IVector<IUIElement>`, the
    // specialisation that declares the members its argument decides
    // (`ReplaceAll` takes the `IUIElement`s' handles).
    assert!(
        module.contains("export interface UIElementCollection extends IVectorOfUIElement, UIElementCollectionInterfaces, UIElementCollectionMembers {}"),
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
    // A composable class is also a class to extend, as C# extends it: its
    // factory and `CreateInstance`'s slot, a constructor as visible as the
    // factory, and an overridable method per slot of each overridable
    // interface -- its own, and those of the classes it derives from.
    let class = |name: &str| {
        let at = module.find(&format!("   * @ntsComposable Windows.UI.Xaml.Controls.{name} ")).unwrap_or_else(|| panic!("no @ntsComposable {name}"));
        let form = &module[at..];
        form[..form.find("\n  }").unwrap()].to_owned()
    };
    let button = class("Button");
    // `new Button()`: the constructor is the factory's `CreateInstance`,
    // tagged as the static of that name is.
    assert!(
        button.contains("Button 80A13C19-843A-451C-8CF5-44C701B0E216 6\n   */\n  export class Button {\n    /**\n     * @ntsVtable 6 CreateInstance\n     * @ntsHresult composable\n     * @ntsFactory Windows.UI.Xaml.Controls.Button 80A13C19-843A-451C-8CF5-44C701B0E216\n     */\n    constructor();"),
        "{button}"
    );
    assert!(
        button.contains("@ntsOverride 5F4C0B10-E38E-4B5D-BE1A-5ED04246A635 6 OnContentChanged\n     */\n    onContentChanged(oldContent: IInspectable | null, newContent: IInspectable | null): void;"),
        "{button}"
    );
    let control = class("Control");
    assert!(control.contains("     */\n    protected constructor();"), "{control}");
    assert!(control.contains("@ntsOverride A09691DF-9824-41FE-B530-B0D8990E64C1 6 OnPointerEntered"), "{control}");
    assert!(module.contains("export interface Button extends IButton, ButtonInterfaces, ButtonMembers {}"), "the class form does not carry its instances' methods");
    // A record a call takes by value may be written as its fields; an
    // override's stays the record, since its adapter reads the ABI type from
    // the declaration.
    let xaml = std::fs::read_to_string(out.join("Windows.UI.Xaml.d.ts")).unwrap();
    assert!(xaml.contains("    Measure(this: IUIElement, availableSize: ByValue<Size> | Fields<Size>): void;"), "Measure does not take its fields");
    assert!(module.contains("    measureOverride(availableSize: ByValue<Size>): ByValue<Size>;"), "an override's record is spelled with its fields");
    // A property of any object takes and answers a string, number or
    // boolean too (`Inspectable`): boxed for the setter, unboxed from the
    // getter.
    // The idiomatic surface: declared once, on the class implementing the
    // interface, and inherited along the class chain; a property as its
    // getter and setter, a `get`/`set` pair where they spell differently;
    // each member called through its interface, and the default interface's
    // naming its class, whose own handle needs no asking.
    let surface = |name: &str| {
        let at = module.find(&format!("  export interface {name}Members")).unwrap_or_else(|| panic!("no {name}Members"));
        let form = &module[at..];
        form[..form.find("\n  }").unwrap()].to_owned()
    };
    let content_control = surface("ContentControl");
    assert!(content_control.starts_with("  export interface ContentControlMembers extends ControlMembers {"), "{content_control}");
    assert!(
        content_control.contains("     * @ntsGet 6 get_Content\n     * @ntsVia A26DD1DC-CD44-435C-BE94-01D6241C231C Windows_UI_Xaml_Controls_IContentControl\n     */\n    get content(): Inspectable;")
            && content_control.contains("     * @ntsSet 7 put_Content\n     * @ntsVia A26DD1DC-CD44-435C-BE94-01D6241C231C Windows_UI_Xaml_Controls_IContentControl\n     */\n    set content(value: Inspectable | null);"),
        "{content_control}"
    );
    let button_surface = surface("Button");
    assert!(button_surface.starts_with("  export interface ButtonMembers extends ButtonBaseMembers {"), "{button_surface}");
    assert!(button_surface.contains("     * @ntsVia 09108F87-DF6C-4180-9B3A-E60845825811\n     */\n    get flyout(): FlyoutBase;"), "{button_surface}");
    assert!(!button_surface.contains("content"), "a base's member is repeated on the class:\n{button_surface}");
    assert!(module.contains("export interface Button extends IButton, ButtonInterfaces, ButtonMembers {}"), "the class does not carry its surface");
    // A default interface is its class's base's in the chain, so a button
    // goes where a content control is taken, and carries the base classes'
    // methods as one flat list, not their types.
    assert!(
        module.contains("export type IButton = ComClass<\"Windows_UI_Xaml_Controls_IButton\", IButtonBase> & IButtonMethods & IButtonBaseMethods & IContentControlMethods & IControlMethods & IFrameworkElementMethods & IUIElementMethods & IDependencyObjectMethods;"),
        "IButton is not in its base's chain"
    );
    // Events by the lower-cased name `addEventListener` takes, each a
    // listener naming its interface and `add_`/`remove_` slots; the map
    // inherited along the class chain, and `addEventListener` declared where
    // a class raises events of its own.
    assert!(module.contains("export interface ButtonEventMap extends ButtonBaseEventMap {"), "the event map is not inherited");
    assert!(
        module.contains("    isenabledchanged: Event<(sender: IInspectable, e: DependencyPropertyChangedEventArgs) => void, \"09223E5A-75BE-4499-8180-1DDC005421C0\", \"A8912263-2951-4F58-A9C5-5A134EAA7F07 43 44\">;"),
        "IsEnabledChanged is not an event of IControl's slots 43 and 44"
    );
    assert!(
        module.contains("     * @ntsListener add\n     */\n    addEventListener<K extends keyof ControlEventMap>(type: K, listener: ControlEventMap[K]): void;"),
        "Control does not listen over its events"
    );
    // A static beside its ABI name, one slot.
    assert!(module.contains("     * @ntsFactory Windows.UI.Xaml.Controls.Button 80A13C19-843A-451C-8CF5-44C701B0E216\n     */\n    function createInstance(): Button;"), "no camelCase static");
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
    assert!(module.contains("export class LaunchActivatedEventArgs {"), "the local one is not declared");
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
