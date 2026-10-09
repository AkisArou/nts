//! COM and Windows Runtime calls (`@ntsVtable`, `@ntsHresult`, `@ntsFactory`):
//! what lowering refuses, and the C a call through a table becomes.
//!
//! Nothing here needs Windows. The program is checked by clang for
//! `x86_64-windows-gnu` against zig's mingw headers, which is what `nts build`
//! compiles it with; running it is `examples/interop/windows-winrt`'s job, on
//! the lane's VM.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

fn prepare(name: &str, binding: &str, source: &str) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = root.join(format!("target/com-c-tests/{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts","binding.d.ts","{root}/runtime/native/libc.d.ts","{root}/runtime/winrt/winrt.d.ts"]}}"#
        ),
    )
    .unwrap();
    std::fs::write(dir.join("binding.d.ts"), binding).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((
        dir,
        hir::prepare(&snapshot)
            .unwrap_or_else(|refused| panic!("{}", refused.render(&snapshot.sources))),
    ))
}

/// `Windows.Data.Json` as `examples/interop/windows-winrt` binds it, with
/// `{method}` spliced into `IJsonValueMethods` and `{function}` beside
/// `Parse` for the refusal cases.
fn binding(method: &str, function: &str) -> String {
    format!(
        r#"declare module "winrt:Windows.Data.Json" {{
  import type {{ Float64 }} from "@nts/scalars";
  import type {{ ComClass, HString }} from "winrt:types";
  export interface IJsonValueMethods {{
    /**
     * @ntsVtable 7 Stringify
     * @ntsHresult
     */
    Stringify(this: IJsonValue): HString;
    /**
     * @ntsVtable 9 GetNumber
     * @ntsHresult
     */
    GetNumber(this: IJsonValue): Float64;
{method}
  }}
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
{function}
}}
"#
    )
}

const PROGRAM: &str = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(): string {
  const value = Parse("42.5");
  return value.Stringify() + String(value.GetNumber());
}
"#;

/// A method is a call through slot N of the receiver's table; a static is one
/// on the class's factory; each HRESULT is checked before the slot C wrote is
/// read; and the C is what mingw's clang accepts for Windows.
#[test]
fn a_com_method_is_a_call_through_its_table() {
    let Some((dir, prepared)) = prepare("shape", &binding("", ""), PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for (slot, what) in [(6, "Parse"), (7, "Stringify"), (9, "GetNumber")] {
        assert!(
            text.contains("(*(void ***)") && text.contains(&format!("[{slot}])(")),
            "no call through slot {slot} ({what}):\n{text}"
        );
    }
    assert!(
        text.contains("nts_winrt_factory("),
        "a static is not called on its factory:\n{text}"
    );
    // The factory's IID crosses as the two words of its bytes, both above
    // 2^53, and exactly: widening them through a double on the way rounded
    // the low bits away, and Windows answered E_NOINTERFACE.
    for word in ["5251530675620369482", "6644118215154181009"] {
        assert!(
            text.contains(word),
            "the IID word {word} does not reach the C exactly:\n{text}"
        );
    }
    assert!(
        text.contains("nts_com_take("),
        "the object Parse writes is not taken:\n{text}"
    );
    assert!(
        text.contains("nts_hresult_message("),
        "no HRESULT is checked:\n{text}"
    );
    assert!(
        text.contains("nts_string_from_hstring("),
        "the HSTRING Stringify writes is not read:\n{text}"
    );
    // No symbol is declared for a method with none.
    assert!(
        !text.contains("Parse("),
        "a prototype or call names `Parse` as a symbol:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// The program as `nts build` compiles it for Windows, with mingw's headers,
/// checked by clang: `-fsyntax-only` is ignored by `zig cc`, so clang itself.
fn windows_syntax(dir: &Utf8Path, emitted: &nts_codegen_c::Emitted) {
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let zig = Command::new("zig")
        .arg("env")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    let Some(lib) = zig
        .as_deref()
        .and_then(|env| env.split_once("lib_dir"))
        .and_then(|(_, rest)| rest.split('"').nth(1).map(str::to_owned))
    else {
        eprintln!("skipped the Windows compile: no zig for mingw headers");
        return;
    };
    let headers = format!("{lib}/libc/include");
    let checked = Command::new("clang")
        .current_dir(dir)
        .args([
            "--target=x86_64-w64-windows-gnu",
            "-nostdlibinc",
            "-isystem",
            &format!("{headers}/x86_64-windows-gnu"),
            "-isystem",
            &format!("{headers}/generic-mingw"),
            "-isystem",
            &format!("{headers}/x86_64-windows-any"),
            "-isystem",
            &format!("{headers}/any-windows-any"),
            "-std=c11",
            "-Wall",
            "-Werror",
            "-fsyntax-only",
            "program.c",
            "nts_winrt.c",
        ])
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
}

/// Each claim a binding can get wrong is refused where it is read, naming it,
/// rather than lowered into a call to the wrong slot or through no receiver.
#[test]
fn a_com_binding_that_cannot_be_right_is_refused_by_name() {
    let method_named = |slot_and_name: &str, method: &str| {
        format!(
            "    /**\n     * @ntsVtable {slot_and_name}\n     * @ntsHresult\n     */\n    {method}(this: IJsonValue): Float64;"
        )
    };
    // (name, method spliced in, function spliced in, the call, the refusal)
    let cases: [(&str, String, String, &str, &str); 9] = [
        (
            "mismatched",
            method_named("9 GetNumber", "GetString"),
            String::new(),
            "Parse(\"1\").GetString()",
            "the slot's method and the declaration disagree",
        ),
        (
            "iunknown",
            method_named("1 AddRef", "AddRef"),
            String::new(),
            "Parse(\"1\").AddRef()",
            "slots 0 to 2, which are IUnknown's",
        ),
        (
            "no-name",
            method_named("9", "GetNumber2"),
            String::new(),
            "Parse(\"1\").GetNumber2()",
            "names the slot and the method",
        ),
        (
            "factory-on-method",
            "    /**\n     * @ntsVtable 10 GetBoolean\n     * @ntsHresult\n     * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C\n     */\n    GetBoolean(this: IJsonValue): Float64;".to_owned(),
            String::new(),
            "Parse(\"1\").GetBoolean()",
            "@ntsFactory on a method",
        ),
        (
            "no-receiver",
            String::new(),
            "  /**\n   * @ntsVtable 6 Loose\n   * @ntsHresult\n   */\n  export function Loose(input: HString): IJsonValue;".to_owned(),
            "Loose(\"1\")",
            "neither an instance (`this`) nor an @ntsFactory",
        ),
        (
            "bad-iid",
            String::new(),
            "  /**\n   * @ntsVtable 6 Odd\n   * @ntsHresult\n   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A\n   */\n  export function Odd(input: HString): IJsonValue;".to_owned(),
            "Odd(\"1\")",
            "not 8-4-4-4-12 hexadecimal digits",
        ),
        (
            "c-string-result",
            "    /**\n     * @ntsVtable 8 GetString\n     * @ntsHresult\n     */\n    GetString(this: IJsonValue): string;".to_owned(),
            String::new(),
            "Parse(\"1\").GetString()",
            "a Windows Runtime string is `HString`",
        ),
        (
            "out-retval-first",
            String::new(),
            format!("{OUT_TAGS}  export function Early(input: HString): {{ returnValue: boolean; result: IJsonValue | null }};"),
            "Early(\"1\")",
            "`returnValue`, the `[out, retval]`, before an `[out]` parameter",
        ),
        (
            "out-not-a-literal",
            String::new(),
            format!("{OUT_TAGS}  export function Bare(input: HString): IJsonValue;"),
            "Bare(\"1\")",
            "not an object type literal",
        ),
    ];
    for (name, method, function, call, refusal) in cases {
        let imports = if function.is_empty() {
            "Parse"
        } else {
            &format!("Parse, {}", call.split('(').next().unwrap())
        };
        let source = format!(
            "import {{ {imports} }} from \"winrt:Windows.Data.Json\";\nexport function run(): void {{\n  {call};\n}}\n"
        );
        let Some((_, prepared)) = prepare(name, &binding(&method, &function), &source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(
            prepared
                .diagnostics
                .iter()
                .any(|d| d.message.contains(refusal)),
            "{name}: expected a refusal containing {refusal:?}, got {:?}",
            prepared
                .diagnostics
                .iter()
                .map(|d| &d.message)
                .collect::<Vec<_>>()
        );
    }
}

/// `@ntsHresult out` on `IJsonValueStatics`' slot 7, as `bind-winmd` writes
/// `TryParse`, less the function line.
const OUT_TAGS: &str = "  /**\n   * @ntsVtable 7 TryParse\n   * @ntsHresult out\n   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C\n   */\n";

/// `[out]` parameters are the result's fields: one slot of the compiler's per
/// field, in C's order after the declared arguments, each read as a result is
/// -- the object `nts_com_take`n, the `boolean` a byte compared with zero --
/// and the object holding them made only once the HRESULT says the call
/// succeeded, so a failed one throws with nothing allocated.
#[test]
fn out_parameters_are_the_fields_of_the_result() {
    let function = format!(
        "{OUT_TAGS}  export function TryParse(input: HString): {{ result: IJsonValue | null; returnValue: boolean }};"
    );
    let source = r#"import { TryParse } from "winrt:Windows.Data.Json";
export function run(): string {
  const parsed = TryParse("1");
  return String(parsed.returnValue) + (parsed.result === null ? "none" : parsed.result.Stringify());
}
"#;
    let Some((dir, prepared)) = prepare("out", &binding("", &function), source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    // The receiver, the string, then the two slots: four arguments.
    let call = text
        .find("[7])(")
        .unwrap_or_else(|| panic!("no call through slot 7:\n{text}"))
        + "[7])(".len();
    let arguments = text[call..]
        .split_once(')')
        .map_or(0, |(inside, _)| inside.matches(',').count() + 1);
    assert_eq!(
        arguments, 4,
        "TryParse is not called with its receiver, input and two slots:\n{text}"
    );
    assert!(
        text.contains("nts_com_take("),
        "the object written to `result` is not taken:\n{text}"
    );
    let checked = text
        .find("nts_hresult_message(")
        .unwrap_or_else(|| panic!("no HRESULT is checked:\n{text}"));
    for field in ["->result = ", "->returnValue = "] {
        let stored = text
            .find(field)
            .unwrap_or_else(|| panic!("no store to `{field}`:\n{text}"));
        assert!(
            stored > checked,
            "`{field}` is stored before the HRESULT is checked:\n{text}"
        );
    }

    windows_syntax(&dir, &emitted);
}

/// `TypeName`, a struct holding a string, as `Frame.Navigate` takes it and
/// `SourcePageType` answers it: `Copied<T>`, a plain object copied at the
/// call. `{program}` is spliced into `run`.
fn copied(program: &str) -> (String, String) {
    let binding = r#"declare module "winrt:Windows.UI.Xaml.Interop" {
  import type { CEnum, Struct } from "c:types";
  import type { Int32 } from "@nts/scalars";
  import type { ComClass, Copied, HString } from "winrt:types";
  export const enum TypeKind { Primitive = 0, Metadata = 1, Custom = 2 }
  export type TypeName = Struct<{ name: HString; kind: CEnum<TypeKind, Int32> }, "Windows_UI_Xaml_Interop_TypeName">;
  export interface IFrameMethods {
    /**
     * @ntsVtable 10 Navigate
     * @ntsHresult
     */
    Navigate(this: IFrame, sourcePageType: Copied<TypeName>): boolean;
    /**
     * @ntsVtable 11 get_SourcePageType
     * @ntsHresult
     */
    get_SourcePageType(this: IFrame): Copied<TypeName>;
  }
  export type IFrame = ComClass<"IFrame"> & IFrameMethods;
}
"#;
    let source = format!(
        r#"import {{ type IFrame, TypeKind }} from "winrt:Windows.UI.Xaml.Interop";
export function run(frame: IFrame): string {{
{program}
}}
"#
    );
    (binding.to_owned(), source)
}

/// In, a literal is written straight into the struct in the frame -- no
/// object is built -- and an object the program holds is copied into one,
/// each string an HSTRING lent for the call and given back after it. Out, the
/// struct is copied into a new object, its HSTRING into a `string`, deleted.
#[test]
fn a_struct_holding_a_string_is_copied_at_the_call() {
    let (binding, source) = copied(
        r#"  const held: Copied<TypeName> = { name: "App.Held", kind: TypeKind.Custom };
  const literal = frame.Navigate({ name: "App.Page", kind: TypeKind.Metadata });
  const copied = frame.Navigate(held);
  const page = frame.get_SourcePageType();
  return String(literal) + String(copied) + page.name + String(page.kind);"#,
    );
    // A held record is written as the struct's copy, which keeps each
    // field's C type: inferred, `kind` would be a plain number C's `int32_t`
    // cannot be proven to take.
    let source = source.replace(
        "import { type IFrame, TypeKind }",
        "import type { Copied } from \"winrt:types\";\nimport { type IFrame, type TypeName, TypeKind }",
    );
    let Some((dir, prepared)) = prepare("copied", &binding, &source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(
        text.contains("struct Windows_UI_Xaml_Interop_TypeName {\n    struct HSTRING__ * name;\n    int32_t kind;\n};"),
        "the struct does not hold an HSTRING and its kind:\n{text}"
    );
    // Two arguments, each passed by value, each string lent and given back
    // on both of the call's paths.
    assert_eq!(
        text.matches("nts_string_to_hstring(").count(),
        2,
        "not one HSTRING per argument:\n{text}"
    );
    assert_eq!(
        text.matches("nts_hstring_release(").count(),
        4,
        "an HSTRING is not given back on both paths:\n{text}"
    );
    assert_eq!(
        text.matches("struct Windows_UI_Xaml_Interop_TypeName, void *))")
            .count(),
        2,
        "not passed by value:\n{text}"
    );
    // The literal's fields are stored into the struct, not into an object:
    // the only objects given a `kind` are the one held and the result.
    assert_eq!(
        text.matches("->kind = ").count(),
        2,
        "the literal was built as an object:\n{text}"
    );
    let copied_out = text
        .find("nts_string_from_hstring(")
        .unwrap_or_else(|| panic!("the result's HSTRING is not copied out:\n{text}"));
    let checked = text
        .rfind("[11])(")
        .unwrap_or_else(|| panic!("no call through slot 11:\n{text}"));
    assert!(
        copied_out > checked,
        "the result is read before the call:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// A struct `[out]` parameter -- `TryGetVector2(name, out value)` -- is a
/// field of the call's value, which no storage can be: its slot is copied
/// out into an object of the field's own type, once the HRESULT says it was
/// written, beside the other fields.
#[test]
fn a_struct_out_parameter_is_copied_into_its_field() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { Struct } from "c:types";
  import type { Float32 } from "@nts/scalars";
  import type { ComClass, Copied, HString } from "winrt:types";
  export type Vector2 = Struct<{ x: Float32; y: Float32 }, "Windows_Foundation_Numerics_Vector2">;
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 TryGetVector2
     * @ntsHresult out
     */
    TryGetVector2(this: IJsonValue, name: HString): { value: Copied<Vector2>; returnValue: boolean };
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
}
"#;
    let source = r#"import type { IJsonValue } from "winrt:Windows.Data.Json";
export function run(set: IJsonValue): string {
  const got = set.TryGetVector2("v");
  return String(got.returnValue) + String(got.value.x + got.value.y);
}
"#;
    let Some((dir, prepared)) = prepare("out-struct", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    // The receiver, the name, and the two slots: the struct's and the flag's.
    let call = text
        .find("[10])(")
        .unwrap_or_else(|| panic!("no call through slot 10:\n{text}"))
        + "[10])(".len();
    let arguments = text[call..]
        .split_once(')')
        .map_or(0, |(inside, _)| inside.matches(',').count() + 1);
    assert_eq!(
        arguments, 4,
        "TryGetVector2 is not called with its receiver, name and two slots:\n{text}"
    );
    for field in ["->x = ", "->y = ", "->value = ", "->returnValue = "] {
        assert!(text.contains(field), "no store to `{field}`:\n{text}");
    }

    windows_syntax(&dir, &emitted);
}

/// An array of objects the callee allocated (`ReceiveArray` of interfaces):
/// its count and block written through two slots, then moved into an array
/// of the program's made for them, which owns each, and the block freed --
/// read on the call's own block, before the HRESULT is checked.
#[test]
fn a_received_array_of_objects_is_an_array_of_the_program_s() {
    let method = "    /**\n     * @ntsVtable 38 GetInspectableArray\n     * @ntsHresult out\n     */\n    GetInspectableArray(this: IJsonValue): { value: (IJsonValue | null)[] };";
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(): number {
  return Parse("[]").GetInspectableArray().value.length;
}
"#;
    let Some((dir, prepared)) = prepare("received-handles", &binding(method, ""), source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let call = text
        .find("[38])(")
        .unwrap_or_else(|| panic!("no call through slot 38:\n{text}"))
        + "[38])(".len();
    let arguments = text[call..]
        .split_once(')')
        .map_or(0, |(inside, _)| inside.matches(',').count() + 1);
    assert_eq!(
        arguments, 3,
        "not called with its receiver, the count slot and the block slot:\n{text}"
    );
    let after = &text[call..];
    let moved = after
        .find("nts_winrt_received_handles(")
        .unwrap_or_else(|| panic!("the block is not moved into an array:\n{text}"));
    let checked = after
        .find("nts_hresult_message(")
        .unwrap_or_else(|| panic!("no HRESULT is checked:\n{text}"));
    assert!(
        moved < checked,
        "the block is read after the branch, not on the call's own block:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// An array of objects where a call takes an array of one interface: an
/// array whose elements are that interface is lent as its element block, in
/// place; one of another interface is asked, element by element, for the one
/// the call takes -- a COM object's interfaces are different pointers -- into
/// a block given back after the call.
#[test]
fn an_array_of_objects_is_lent_as_the_interface_the_call_takes() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { CHandles, Counted } from "c:types";
  import type { Uint32 } from "@nts/scalars";
  import type { ComClass, HString } from "winrt:types";
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 ReplaceAll
     * @ntsHresult
     * @ntsNoEscape items
     */
    ReplaceAll(this: IJsonValue, items: Counted<CHandles<IJsonValue>, Uint32, "before">): void;
  }
  /**
   * @ntsQuery A3219ECB-F0B3-4DCD-BEEE-19D48CD3ED1E
   */
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  export interface IJsonObjectMethods {}
  export type IJsonObject = ComClass<"IJsonObject", IJsonValue> & IJsonObjectMethods & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
  export namespace JsonObject {
    /**
     * @ntsVtable 6 Parse
     * @ntsHresult
     * @ntsFactory Windows.Data.Json.JsonObject 2289F159-54DE-45D8-ABCC-22603FA066A0
     */
    function Parse(input: HString): IJsonObject;
  }
}
"#;
    let source = r#"import { JsonObject, Parse, type IJsonObject, type IJsonValue } from "winrt:Windows.Data.Json";
export function run(): number {
  const target = Parse("[]");
  const values: IJsonValue[] = [Parse("1"), Parse("2")];
  target.ReplaceAll(values);
  const objects: IJsonObject[] = [JsonObject.Parse("{}")];
  target.ReplaceAll(objects);
  return values.length + objects.length;
}
"#;
    let Some((dir, prepared)) = prepare("handles", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert_eq!(
        text.matches("nts_array_handles(").count(),
        1,
        "the array of the interface itself is not lent in place:\n{text}"
    );
    assert_eq!(
        text.matches("nts_com_query_array(").count(),
        1,
        "the array of another interface is not asked for the one taken:\n{text}"
    );
    // Given back on both of the call's paths, the array's last use.
    assert_eq!(
        text.matches("nts_com_release_array(").count(),
        2,
        "the queried block is not given back on both paths:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// Strings both ways: a `string[]` a call takes (`HStrings`) is a block of
/// `HSTRING`s, each lent for the call and all given back after it on both of
/// its paths; one a call hands back is each `HSTRING` copied into a `string`
/// of an array of the program's and deleted, read on the call's own block.
#[test]
fn a_string_array_is_lent_and_received_as_hstrings() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { Counted } from "c:types";
  import type { Uint32 } from "@nts/scalars";
  import type { ComClass, HString, HStrings } from "winrt:types";
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 SetNames
     * @ntsHresult
     * @ntsNoEscape names
     */
    SetNames(this: IJsonValue, names: Counted<HStrings, Uint32, "before">): void;
    /**
     * @ntsVtable 11 GetNames
     * @ntsHresult out
     */
    GetNames(this: IJsonValue): { value: string[] };
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
"#;
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(): string {
  const value = Parse("[]");
  value.SetNames(["a", "", "c"]);
  return value.GetNames().value.join("|");
}
"#;
    let Some((dir, prepared)) = prepare("hstrings", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert_eq!(
        text.matches("nts_strings_to_hstrings(").count(),
        1,
        "the strings are not lent as HSTRINGs:\n{text}"
    );
    assert_eq!(
        text.matches("nts_hstrings_release(").count(),
        2,
        "the HSTRINGs are not given back on both paths:\n{text}"
    );
    let call = text
        .find("[11])(")
        .unwrap_or_else(|| panic!("no call through slot 11:\n{text}"))
        + "[11])(".len();
    let after = &text[call..];
    let received = after
        .find("nts_winrt_received_strings(")
        .unwrap_or_else(|| panic!("the strings handed back are not received:\n{text}"));
    let checked = after
        .find("nts_hresult_message(")
        .unwrap_or_else(|| panic!("no HRESULT is checked:\n{text}"));
    assert!(
        received < checked,
        "the block is read after the branch, not on the call's own block:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// Arrays of structs both ways, as plain objects: an array a call takes
/// (`CopiedArray<T>`) is copied into a block of the structs from COM's task
/// allocator, freed after the call on both of its paths; one it hands back is
/// copied out into objects of the program's, and the callee's block freed.
#[test]
fn an_array_of_structs_is_copied_both_ways() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { Counted, Struct } from "c:types";
  import type { Float32, Uint32 } from "@nts/scalars";
  import type { ComClass, Copied, CopiedArray, HString } from "winrt:types";
  export type Point = Struct<{ x: Float32; y: Float32 }, "Windows_Foundation_Point">;
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 Convert
     * @ntsHresult
     * @ntsNoEscape points
     */
    Convert(this: IJsonValue, points: Counted<CopiedArray<Point>, Uint32, "before">): Copied<Point>[];
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
"#;
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(): number {
  const converted = Parse("[]").Convert([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  return converted[1].x + converted[0].y;
}
"#;
    let Some((dir, prepared)) = prepare("records", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert_eq!(
        text.matches("nts_winrt_alloc(").count(),
        1,
        "the array is not copied into one block:\n{text}"
    );
    assert_eq!(
        text.matches("nts_winrt_free(").count(),
        3,
        "the lent block on both paths and the received one are not all freed:\n{text}"
    );
    let call = text
        .find("[10])(")
        .unwrap_or_else(|| panic!("no call through slot 10:\n{text}"))
        + "[10])(".len();
    let arguments = text[call..]
        .split_once(')')
        .map_or(0, |(inside, _)| inside.matches(',').count() + 1);
    assert_eq!(
        arguments, 5,
        "not called with its receiver, the count, the block, and the two slots:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// Arrays the callee fills, which the program passes and the call writes
/// into: objects in the array's own block (`FilledHandles`, lent in place
/// once emptied), and strings and structs (`FilledStrings`, `FilledArray`)
/// in a zeroed block of the call's, copied into the array on both of the
/// call's paths and freed.
#[test]
fn arrays_the_callee_fills_are_written_into_the_programs() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { Counted, Struct } from "c:types";
  import type { Float32, Uint32 } from "@nts/scalars";
  import type { ComClass, FilledArray, FilledHandles, FilledStrings, HString } from "winrt:types";
  export type Point = Struct<{ x: Float32; y: Float32 }, "Windows_Foundation_Point">;
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 GetMany
     * @ntsHresult
     */
    GetMany(this: IJsonValue, items: Counted<FilledHandles<IJsonValue>, Uint32, "before">): Uint32;
    /**
     * @ntsVtable 11 GetStrings
     * @ntsHresult
     */
    GetStrings(this: IJsonValue, items: Counted<FilledStrings, Uint32, "before">): Uint32;
    /**
     * @ntsVtable 12 GetPoints
     * @ntsHresult
     */
    GetPoints(this: IJsonValue, items: Counted<FilledArray<Point>, Uint32, "before">): void;
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
"#;
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
import type { IJsonValue } from "winrt:Windows.Data.Json";
export function run(): number {
  const value = Parse("[]");
  const items: (IJsonValue | null)[] = [null, null];
  const texts = ["", ""];
  const points = [{ x: 0, y: 0 }];
  value.GetPoints(points);
  return value.GetMany(items) + value.GetStrings(texts) + texts[0].length + points[0].x;
}
"#;
    let Some((dir, prepared)) = prepare("filled", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert_eq!(
        text.matches("nts_winrt_array_items(").count(),
        1,
        "the objects' own block is not lent:\n{text}"
    );
    assert_eq!(
        text.matches("nts_array_handles(").count(),
        0,
        "a filled array is lent as one C reads, which refuses its NULLs:\n{text}"
    );
    assert_eq!(
        text.matches("nts_winrt_alloc(").count(),
        2,
        "the strings and the structs are not each given a block:\n{text}"
    );
    assert_eq!(
        text.matches("nts_winrt_free(").count(),
        4,
        "each block is not freed on both of its call's paths:\n{text}"
    );
    assert_eq!(
        text.matches("nts_string_from_hstring(").count(),
        2,
        "the strings are not copied in on both paths:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// Arrays of booleans, whose one-byte elements are the Windows Runtime's:
/// lent in place to a call that reads them (`Booleans`) or fills them
/// (`FilledBooleans`), with no block of the call's, and one handed back
/// (`ReceiveArray`) copied into a `boolean[]` and the block freed.
#[test]
fn a_boolean_array_is_lent_in_place_and_received_by_copy() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { Counted } from "c:types";
  import type { Uint32 } from "@nts/scalars";
  import type { Booleans, ComClass, FilledBooleans, HString } from "winrt:types";
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 Take
     * @ntsHresult
     */
    Take(this: IJsonValue, flags: Counted<Booleans, Uint32, "before">): void;
    /**
     * @ntsVtable 11 Fill
     * @ntsHresult
     */
    Fill(this: IJsonValue, flags: Counted<FilledBooleans, Uint32, "before">): void;
    /**
     * @ntsVtable 12 Give
     * @ntsHresult
     */
    Give(this: IJsonValue): boolean[];
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
"#;
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(): number {
  const value = Parse("[]");
  value.Take([true, false]);
  const filled = [false, false];
  value.Fill(filled);
  const given = value.Give();
  return (filled[0] ? 1 : 0) + (given[0] ? 2 : 0) + given.length;
}
"#;
    let Some((dir, prepared)) = prepare("booleans", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert_eq!(
        text.matches("nts_winrt_array_items(").count(),
        2,
        "the two arrays are not lent in place:\n{text}"
    );
    assert_eq!(
        text.matches("nts_winrt_alloc(").count(),
        0,
        "a boolean array is copied into a block:\n{text}"
    );
    assert_eq!(
        text.matches("nts_winrt_free(").count(),
        1,
        "the received block is not freed:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// A name two interfaces give as methods, declared as overloads (as
/// bind-winmd declares `Frame.navigate`): each call goes through the slot of
/// the overload the checker chose, not the first declared.
#[test]
fn an_overloaded_method_calls_the_slot_the_checker_chose() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { ComClass, HString } from "winrt:types";
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 17 Go
     * @ntsHresult
     */
    go(this: IJsonValue, to: HString, with_: HString): boolean;
    /**
     * @ntsVtable 23 Go
     * @ntsHresult
     */
    go(this: IJsonValue, to: HString): boolean;
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
"#;
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(): boolean {
  const value = Parse("[]");
  return value.go("a") && value.go("a", "b");
}
"#;
    let Some((dir, prepared)) = prepare("overloads", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let arguments = |slot: &str| {
        let call = text
            .find(&format!("[{slot}])("))
            .unwrap_or_else(|| panic!("no call through slot {slot}:\n{text}"))
            + slot.len()
            + 4;
        text[call..]
            .split_once(')')
            .map_or(0, |(inside, _)| inside.matches(',').count() + 1)
    };
    assert_eq!(
        arguments("23"),
        3,
        "the one-argument overload is not slot 23's call (receiver, string, slot):\n{text}"
    );
    assert_eq!(
        arguments("17"),
        4,
        "the two-argument overload is not slot 17's call:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// An `IReference<T>` read as `T | null`: the reference written to the
/// result slot, `null` where there is none, and otherwise its `get_Value`
/// (slot 6) read into a local -- a boolean as one byte, a struct copied
/// into a plain object -- and the reference given back.
#[test]
fn a_reference_is_read_as_its_value_or_null() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { Struct } from "c:types";
  import type { Float32 } from "@nts/scalars";
  import type { ComClass, Copied, HString } from "winrt:types";
  export type Point = Struct<{ x: Float32; y: Float32 }, "Windows_Foundation_Point">;
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 get_Checked
     * @ntsHresult
     */
    get_Checked(this: IJsonValue): boolean | null;
    /**
     * @ntsVtable 11 get_Where
     * @ntsHresult
     */
    get_Where(this: IJsonValue): Copied<Point> | null;
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
"#;
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(): number {
  const value = Parse("[]");
  const checked = value.get_Checked();
  const where = value.get_Where();
  return (checked === null ? 2 : checked ? 1 : 0) + (where === null ? 0 : where.x);
}
"#;
    let Some((dir, prepared)) = prepare("references", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let run = &text[text.find("run(").expect("no run")..];
    assert_eq!(
        run.matches("[6])(").count(),
        3,
        "not Parse and two `get_Value`s through slot 6:\n{run}"
    );
    assert!(
        run.matches("nts_com_release(").count() >= 2,
        "a reference is not given back:\n{run}"
    );

    windows_syntax(&dir, &emitted);
}

/// A `T | null` passed where the Windows Runtime takes an `IReference<T>`
/// (`@ntsReference`): NULL for `null`, and otherwise the value written into
/// a local and made into a reference of the instantiation's IID for the call
/// (`nts_winrt_reference`), given back after it.
#[test]
fn a_value_or_null_is_passed_as_a_reference_made_for_the_call() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { ComClass, HString } from "winrt:types";
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 10 put_Checked
     * @ntsHresult
     * @ntsReference value 3C00FD60-2950-5939-A21A-2D12C5A01B8A 11
     */
    put_Checked(this: IJsonValue, value: boolean | null): void;
  }
  export type IJsonValue = ComClass<"IJsonValue"> & IJsonValueMethods;
  /**
   * @ntsVtable 6 Parse
   * @ntsHresult
   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
   */
  export function Parse(input: HString): IJsonValue;
}
"#;
    let source = r#"import { Parse } from "winrt:Windows.Data.Json";
export function run(flag: boolean | null): void {
  Parse("[]").put_Checked(flag);
}
"#;
    let Some((dir, prepared)) = prepare("reference-arguments", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let run = &text[text.find("run(").expect("no run")..];
    assert_eq!(
        run.matches("nts_winrt_reference(").count(),
        1,
        "no reference made for the call:\n{run}"
    );
    let made = run.find("nts_winrt_reference(").unwrap_or(0);
    let called = run
        .find("[10])(")
        .unwrap_or_else(|| panic!("no call through slot 10:\n{run}"));
    assert!(
        made < called,
        "the reference is made after the call:\n{run}"
    );
    assert!(
        run[called..].contains("nts_com_release("),
        "the reference is not given back after the call:\n{run}"
    );

    windows_syntax(&dir, &emitted);
}

/// A declared number nothing gives a value -- no initializer, no literal
/// type, no `@ntsConstant` -- is refused where it is read, saying how to give
/// it one. It read as the `0` its slot held, with no diagnostic.
#[test]
fn a_declared_number_with_no_value_is_refused() {
    let binding = "declare module \"c:Probe\" {\n  import type { c_uint } from \"@nts/scalars\";\n  export const UNTAGGED: c_uint;\n}\n";
    let source = "import { UNTAGGED } from \"c:Probe\";\nexport function run(message: number): boolean {\n  return message === UNTAGGED;\n}\n";
    let Some((_dir, prepared)) = prepare("valueless-constant", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    let said: Vec<&str> = prepared
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert!(
        said.iter().any(
            |message| message.contains("a declared `const` no one gives a value")
                && message.contains("declare it with its value")
        ),
        "{said:?}"
    );
}

/// A binding's constant (`@ntsConstant`), as Win32's are declared: imported
/// from its module by name, and read as the number itself -- nothing
/// declared in C for it, nothing linked. A value that is not a number is
/// refused.
#[test]
fn a_bound_constant_is_its_number_where_it_is_read() {
    let binding = r#"declare module "c:Windows.Win32.UI.WindowsAndMessaging" {
  import type { c_uint } from "@nts/scalars";
  /** @ntsConstant 15 */
  export const WM_PAINT: c_uint;
  /** @ntsConstant 0x0F */
  export const WM_HEX: c_uint;
}
"#;
    let source = r#"import { WM_PAINT } from "c:Windows.Win32.UI.WindowsAndMessaging";
export function run(message: number): boolean {
  return message === WM_PAINT;
}
"#;
    let Some((_dir, prepared)) = prepare("bound-constant", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(
        !text.contains("WM_PAINT"),
        "the constant is declared or linked rather than folded:\n{text}"
    );
    assert!(
        text.contains("15"),
        "the constant's value is not what the read is:\n{text}"
    );

    let refused = r#"import { WM_HEX } from "c:Windows.Win32.UI.WindowsAndMessaging";
export function run(message: number): boolean {
  return message === WM_HEX;
}
"#;
    let Some((_dir, prepared)) = prepare("bound-constant-refused", binding, refused) else {
        return;
    };
    let said: Vec<&str> = prepared
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert!(
        said.iter()
            .any(|message| message.contains("`@ntsConstant 0x0F`, which is not a number")),
        "{said:?}"
    );
}

/// A sealed runtime class (`@ntsRuntimeClass`), declared as a TypeScript
/// class of its constructors: `new Uri()` activates it (`@ntsActivate`), and
/// `new Uri(text)` calls the activation factory's method the checker chose,
/// on the class's factory.
fn sealed(program: &str) -> (String, String) {
    let binding = r#"declare module "winrt:Windows.Foundation" {
  import type { ComClass, HString } from "winrt:types";
  export interface IUriMethods {
    /**
     * @ntsVtable 6 get_AbsoluteUri
     * @ntsHresult
     */
    get_AbsoluteUri(this: IUri): HString;
  }
  export type IUri = ComClass<"IUri"> & IUriMethods;
  /**
   * @ntsRuntimeClass Windows.Foundation.Uri
   */
  export class Uri {
    /**
     * @ntsActivate Windows.Foundation.Uri 9E365E57-48B2-4160-956F-C7385120BBFC
     */
    constructor();
    /**
     * @ntsVtable 6 CreateUri
     * @ntsHresult
     * @ntsFactory Windows.Foundation.Uri 44A9796F-723E-4FDF-A218-033E75B0C084
     */
    constructor(uri: HString);
  }
  export interface Uri extends IUri {}
}
"#;
    (binding.to_owned(), program.to_owned())
}

#[test]
fn a_sealed_class_is_constructed_by_the_constructor_the_checker_chose() {
    let (binding, source) = sealed(
        r#"import { Uri } from "winrt:Windows.Foundation";
export function run(): string {
  return new Uri().get_AbsoluteUri() + new Uri("https://example.com/").get_AbsoluteUri();
}
"#,
    );
    let Some((dir, prepared)) = prepare("sealed", &binding, &source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert_eq!(
        text.matches("nts_winrt_activate(").count(),
        1,
        "the default constructor is not an activation:\n{text}"
    );
    assert_eq!(
        text.matches("nts_winrt_factory(").count(),
        1,
        "the factory constructor is not called on the class's factory:\n{text}"
    );
    assert!(
        text.contains("nts_string_to_hstring("),
        "the constructor's string is not lent as an HSTRING:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// A class of the program's written over a sealed runtime class is refused,
/// naming why: only a composable class makes an object a subclass composes.
#[test]
fn a_class_over_a_sealed_class_is_refused() {
    let (binding, source) = sealed(
        r#"import { Uri } from "winrt:Windows.Foundation";
class Mine extends Uri {}
export function run(): string {
  return new Mine("https://example.com/").get_AbsoluteUri();
}
"#,
    );
    let Some((_, prepared)) = prepare("sealed-over", &binding, &source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.iter().any(|d| d
            .message
            .contains("composable Windows Runtime class can be extended")),
        "a class over a sealed class was not refused by name: {:?}",
        prepared.diagnostics
    );
}

/// A struct holding a string is only ever `Copied<T>`: as storage the
/// program holds, no one would own its HSTRING, so it is no native type at
/// all and the declaration taking it is refused.
#[test]
fn a_struct_holding_a_string_is_never_storage() {
    let (binding, source) = copied(r#"  return frame.Held(local<TypeName>()) ? "yes" : "no";"#);
    let binding = binding
        .replace(
            "  export interface IFrameMethods {",
            "  import type { ByValue } from \"c:types\";\n  export interface IFrameMethods {\n    /**\n     * @ntsVtable 12 Held\n     * @ntsHresult\n     */\n    Held(this: IFrame, sourcePageType: ByValue<TypeName>): boolean;",
        );
    let source = source.replace(
        "import { type IFrame, TypeKind }",
        "import { local } from \"c:memory\";\nimport { type IFrame, type TypeName }",
    );
    let Some((_, prepared)) = prepare("copied-storage", &binding, &source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.iter().any(|d| d
            .message
            .contains("`Held`'s parameter `sourcePageType`")
            && d.message.contains("only ever `Copied<T>`")),
        "a struct holding a string was taken as storage: {:?}",
        prepared.diagnostics
    );
}

/// A runtime class's static taking bytes: the factory is C parameter 0, which
/// the declaration does not spell, so every index recorded before it was
/// prepended moves up one -- the count's array, and the parameter
/// `@ntsNoEscape` names. Left where they were, the count pointed at itself and
/// was never passed, and the no-escape marked the factory.
#[test]
fn a_static_taking_bytes_passes_the_count_before_them() {
    let function = "  /**\n   * @ntsVtable 9 FromBytes\n   * @ntsNoEscape value\n   * @ntsHresult\n   * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C\n   */\n  export function FromBytes(value: Counted<CBytes<\"const uint8_t\">, Uint32, \"before\">): IJsonValue;";
    let binding = binding("", function).replace(
        "import type { Float64 } from \"@nts/scalars\";",
        "import type { CBytes, Counted } from \"c:types\"; import type { Float64, Int32, Uint32 } from \"@nts/scalars\";",
    );
    let source = "import { FromBytes } from \"winrt:Windows.Data.Json\";\nexport function run(): string {\n  return FromBytes(new Uint8Array([1, 2, 3])).Stringify();\n}\n";
    let Some((dir, prepared)) = prepare("bytes", &binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared
            .diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    // The factory, the count, the bytes, the result slot.
    let call = text
        .find("[9])(")
        .unwrap_or_else(|| panic!("no call through slot 9:\n{text}"))
        + "[9])(".len();
    let arguments = text[call..]
        .split_once(')')
        .map_or(0, |(inside, _)| inside.matches(',').count() + 1);
    assert_eq!(
        arguments, 4,
        "FromBytes is not called with the factory, the count, the bytes and the slot:\n{text}"
    );
    assert!(
        text.contains("nts_view_bytes("),
        "the bytes are not lent in place:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// A handle held at module scope is a global: a pointer that starts null and
/// that `module#init` assigns, which a function reads. It was refused as "a
/// module-scope variable of a native pointer, which a global has no storage
/// for", so a program kept its window or its app object in `main()`.
#[test]
fn a_handle_at_module_scope_is_a_global() {
    let source = "import { Parse } from \"winrt:Windows.Data.Json\";\nconst value = Parse(\"42.5\");\nexport function run(): string {\n  return value.Stringify();\n}\n";
    let Some((dir, prepared)) = prepare("global", &binding("", ""), source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared
            .diagnostics
            .iter()
            .map(|d| &d.message)
            .collect::<Vec<_>>()
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(
        text.contains("IJsonValue * value = 0;"),
        "the handle is not a global starting null:\n{text}"
    );

    windows_syntax(&dir, &emitted);
}

/// Two tags on one line are one tag with the second's text in it: the reader
/// takes a tag to the end of its line. The case `windows-winrt` was first
/// written with, refused rather than read as a three-word slot.
#[test]
fn tags_on_one_line_are_refused_as_one_tag() {
    let method = "    /** @ntsVtable 10 GetBoolean @ntsHresult */\n    GetBoolean(this: IJsonValue): Float64;";
    let source = "import { Parse } from \"winrt:Windows.Data.Json\";\nexport function run(): void {\n  Parse(\"1\").GetBoolean();\n}\n";
    let Some((_, prepared)) = prepare("one-line", &binding(method, ""), source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared
            .diagnostics
            .iter()
            .any(|d| d.message.contains("names the slot and the method")),
        "{:?}",
        prepared.diagnostics
    );
}

/// A runtime class's static, declared in a namespace of the class's name as
/// `bind-winmd` writes it, is a call to that function: `JsonValue.Parse(x)`
/// is `Parse(x)` on the class's factory, and the namespace, which has no
/// value, is not lowered as a receiver.
#[test]
fn a_static_in_a_namespace_is_called_on_its_factory() {
    let binding = r#"declare module "winrt:Windows.Data.Json" {
  import type { Float64 } from "@nts/scalars";
  import type { ComClass, HString } from "winrt:types";
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 9 GetNumber
     * @ntsHresult
     */
    GetNumber(this: IJsonValue): Float64;
  }
  export type IJsonValue = ComClass<"Windows_Data_Json_IJsonValue"> & IJsonValueMethods;
  export type JsonValue = IJsonValue;
  export namespace JsonValue {
    /**
     * @ntsVtable 6 Parse
     * @ntsHresult
     * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
     */
    function Parse(input: HString): JsonValue;
  }
}
"#;
    let source = "import { JsonValue } from \"winrt:Windows.Data.Json\";\nexport function run(): number {\n  return JsonValue.Parse(\"7.5\").GetNumber();\n}\n";
    let Some((_, prepared)) = prepare("namespace", binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(
        text.contains("nts_winrt_factory(") && text.contains("[6])("),
        "Parse is not called on its factory:\n{text}"
    );
}

/// `@ntsQuery` is a runtime call that answers the object as another of its
/// interfaces; one with arguments, or an IID that is not one, is refused.
#[test]
fn a_query_is_a_runtime_call_and_a_wrong_one_is_refused() {
    let binding = |extra: &str| {
        format!(
            r#"declare module "winrt:Windows.Data.Json" {{
  import type {{ ComClass, HString }} from "winrt:types";
  import type {{ Float64 }} from "@nts/scalars";
  export interface IJsonValueMethods {{
    /**
     * @ntsVtable 9 GetNumber
     * @ntsHresult
     */
    GetNumber(this: IJsonValue): Float64;
  }}
  export type IJsonValue = ComClass<"Windows_Data_Json_IJsonValue"> & IJsonValueMethods;
  export interface JsonValueInterfaces {{
    /**
     * @ntsQuery A3219ECB-F0B3-4DCD-BEEE-19D48CD3ED1E
     */
    as_IJsonValue(this: JsonValue): IJsonValue;
{extra}
  }}
  export type JsonValue = IJsonValue & JsonValueInterfaces;
  export namespace JsonValue {{
    /**
     * @ntsVtable 6 Parse
     * @ntsHresult
     * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C
     */
    function Parse(input: HString): JsonValue;
  }}
}}
"#
        )
    };
    let source = "import { JsonValue } from \"winrt:Windows.Data.Json\";\nexport function run(): number {\n  return JsonValue.Parse(\"1\").as_IJsonValue().GetNumber();\n}\n";
    let Some((_, prepared)) = prepare("query", &binding(""), source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let text = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64)
        .writer
        .text()
        .to_owned();
    assert!(
        text.contains("nts_com_query("),
        "no QueryInterface:\n{text}"
    );

    for (name, extra, call, refusal) in [
        (
            "query-args",
            "    /**\n     * @ntsQuery A3219ECB-F0B3-4DCD-BEEE-19D48CD3ED1E\n     */\n    as_Other(this: JsonValue, n: Float64): IJsonValue;",
            "JsonValue.Parse(\"1\").as_Other(1)",
            "takes arguments beside `this`",
        ),
        (
            "query-iid",
            "    /**\n     * @ntsQuery A3219ECB\n     */\n    as_Other(this: JsonValue): IJsonValue;",
            "JsonValue.Parse(\"1\").as_Other()",
            "not 8-4-4-4-12 hexadecimal digits",
        ),
    ] {
        let source = format!(
            "import {{ JsonValue }} from \"winrt:Windows.Data.Json\";\nexport function run(): void {{\n  {call};\n}}\n"
        );
        let Some((_, prepared)) = prepare(name, &binding(extra), &source) else {
            return;
        };
        assert!(
            prepared
                .diagnostics
                .iter()
                .any(|d| d.message.contains(refusal)),
            "{name}: {:?}",
            prepared
                .diagnostics
                .iter()
                .map(|d| &d.message)
                .collect::<Vec<_>>()
        );
    }
}

/// `Windows.Foundation`'s `IMemoryBufferReference`, as `bind-winmd` writes it:
/// an event whose handler is a `Delegate`, with `{handler}` as its function
/// type and `{iid}` as the delegate's interface.
fn events(handler: &str, iid: &str) -> String {
    format!(
        r#"declare module "winrt:Windows.Foundation" {{
  import type {{ Int32, Uint32 }} from "@nts/scalars";
  import type {{ ComClass, Delegate, EventRegistrationToken, IInspectable }} from "winrt:types";
  export interface IMemoryBufferReferenceMethods {{
    /**
     * @ntsVtable 6 get_Capacity
     * @ntsHresult
     */
    get_Capacity(this: IMemoryBufferReference): Uint32;
    /**
     * @ntsVtable 7 add_Closed
     * @ntsHresult
     */
    add_Closed(this: IMemoryBufferReference, handler: Delegate<{handler}, "{iid}">): EventRegistrationToken;
  }}
  export type IMemoryBufferReference = ComClass<"Windows_Foundation_IMemoryBufferReference"> & IMemoryBufferReferenceMethods;
  export type Unused = IInspectable;
}}
"#
    )
}

/// A TypeScript function where a delegate is taken is a COM object made for
/// the call: one `Invoke` adapter per signature, which reads the bridge and
/// the context from the object and answers `S_OK`; the closure lent to it; and
/// the caller's reference given back after the call.
#[test]
fn a_delegate_is_an_object_whose_invoke_calls_the_closure() {
    let binding = events(
        "(sender: IMemoryBufferReference, args: IInspectable) => void",
        "F4637D4A-0760-5431-BFC0-24EB1D4F6C4F",
    );
    let source = "import type { IMemoryBufferReference } from \"winrt:Windows.Foundation\";\nexport function watch(reference: IMemoryBufferReference): number {\n  let seen = 0;\n  reference.add_Closed((sender) => {\n    seen += sender.get_Capacity();\n  });\n  return seen;\n}\n";
    let Some((dir, prepared)) = prepare("delegate", &binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::LLP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let adapter = text
        .lines()
        .find(|line| line.starts_with("static int32_t nts_com_invoke_"))
        .unwrap_or_else(|| panic!("no Invoke adapter:\n{text}"));
    assert!(
        adapter.contains("(void *self, struct Windows_Foundation_IMemoryBufferReference * a0, struct IInspectable * a1)")
            && adapter.contains("d->bridge)(a0, a1, d->context); return 0;"),
        "{adapter}"
    );
    for (what, wanted) in [
        ("the object", "nts_com_delegate("),
        ("the lend", "nts_closure_lend("),
        ("the give-back", "nts_com_release("),
    ] {
        assert!(text.contains(wanted), "no {what}:\n{text}");
    }
    windows_syntax(&dir, &emitted);
}

/// A delegate whose function returns a value, or whose IID is not one, is
/// refused where the call is lowered.
#[test]
fn a_delegate_that_cannot_be_built_is_refused_by_name() {
    let source = "import type { IMemoryBufferReference } from \"winrt:Windows.Foundation\";\nexport function watch(reference: IMemoryBufferReference): void {\n  reference.add_Closed(() => 1);\n}\n";
    for (name, handler, iid, refusal) in [
        (
            "delegate-result",
            "() => Int32",
            "F4637D4A-0760-5431-BFC0-24EB1D4F6C4F",
            "returns a value",
        ),
        (
            "delegate-iid",
            "() => void",
            "F4637D4A",
            "not 8-4-4-4-12 hexadecimal digits",
        ),
    ] {
        let Some((_, prepared)) = prepare(name, &events(handler, iid), source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(
            prepared
                .diagnostics
                .iter()
                .any(|d| d.message.contains(refusal)),
            "{name}: expected {refusal:?}, got {:?}",
            prepared
                .diagnostics
                .iter()
                .map(|d| &d.message)
                .collect::<Vec<_>>()
        );
    }
}
