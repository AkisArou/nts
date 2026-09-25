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
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    Some((dir, hir::prepare(&snapshot).unwrap()))
}

/// `Windows.Data.Json` as `examples/interop/windows-winrt` binds it, with
/// `{method}` spliced into `IJsonValueMethods` and `{function}` beside
/// `Parse` for the refusal cases.
fn binding(method: &str, function: &str) -> String {
    format!(
        r#"declare module "winrt:Windows.Data.Json" {{
  import type {{ c_double }} from "c:types";
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
    GetNumber(this: IJsonValue): c_double;
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
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    for (slot, what) in [(6, "Parse"), (7, "Stringify"), (9, "GetNumber")] {
        assert!(text.contains("(*(void ***)") && text.contains(&format!("[{slot}])(")), "no call through slot {slot} ({what}):\n{text}");
    }
    assert!(text.contains("nts_winrt_factory("), "a static is not called on its factory:\n{text}");
    // The factory's IID crosses as the two words of its bytes, both above
    // 2^53, and exactly: widening them through a double on the way rounded
    // the low bits away, and Windows answered E_NOINTERFACE.
    for word in ["5251530675620369482", "6644118215154181009"] {
        assert!(text.contains(word), "the IID word {word} does not reach the C exactly:\n{text}");
    }
    assert!(text.contains("nts_com_take("), "the object Parse writes is not taken:\n{text}");
    assert!(text.contains("nts_hresult_message("), "no HRESULT is checked:\n{text}");
    assert!(text.contains("nts_string_from_hstring("), "the HSTRING Stringify writes is not read:\n{text}");
    // No symbol is declared for a method with none.
    assert!(!text.contains("Parse("), "a prototype or call names `Parse` as a symbol:\n{text}");

    windows_syntax(&dir, &emitted);
}

/// The program as `nts build` compiles it for Windows, with mingw's headers,
/// checked by clang: `-fsyntax-only` is ignored by `zig cc`, so clang itself.
fn windows_syntax(dir: &Utf8Path, emitted: &nts_codegen_c::Emitted) {
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let zig = Command::new("zig").arg("env").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
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
            "--target=x86_64-w64-windows-gnu", "-nostdlibinc", "-isystem", &format!("{headers}/x86_64-windows-gnu"),
            "-isystem", &format!("{headers}/generic-mingw"), "-isystem", &format!("{headers}/x86_64-windows-any"),
            "-isystem", &format!("{headers}/any-windows-any"), "-std=c11", "-Wall", "-Werror", "-fsyntax-only",
            "program.c", "nts_winrt.c",
        ])
        .output()
        .unwrap();
    assert!(checked.status.success(), "{}", String::from_utf8_lossy(&checked.stderr));
}

/// Each claim a binding can get wrong is refused where it is read, naming it,
/// rather than lowered into a call to the wrong slot or through no receiver.
#[test]
fn a_com_binding_that_cannot_be_right_is_refused_by_name() {
    let method_named = |slot_and_name: &str, method: &str| {
        format!("    /**\n     * @ntsVtable {slot_and_name}\n     * @ntsHresult\n     */\n    {method}(this: IJsonValue): c_double;")
    };
    // (name, method spliced in, function spliced in, the call, the refusal)
    let cases: [(&str, String, String, &str, &str); 7] = [
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
            "    /**\n     * @ntsVtable 10 GetBoolean\n     * @ntsHresult\n     * @ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C\n     */\n    GetBoolean(this: IJsonValue): c_double;".to_owned(),
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
    ];
    for (name, method, function, call, refusal) in cases {
        let imports = if function.is_empty() { "Parse" } else { &format!("Parse, {}", call.split('(').next().unwrap()) };
        let source = format!(
            "import {{ {imports} }} from \"winrt:Windows.Data.Json\";\nexport function run(): void {{\n  {call};\n}}\n"
        );
        let Some((_, prepared)) = prepare(name, &binding(&method, &function), &source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains(refusal)),
            "{name}: expected a refusal containing {refusal:?}, got {:?}",
            prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>()
        );
    }
}

/// Two tags on one line are one tag with the second's text in it: the reader
/// takes a tag to the end of its line. The case `windows-winrt` was first
/// written with, refused rather than read as a three-word slot.
#[test]
fn tags_on_one_line_are_refused_as_one_tag() {
    let method = "    /** @ntsVtable 10 GetBoolean @ntsHresult */\n    GetBoolean(this: IJsonValue): c_double;";
    let source = "import { Parse } from \"winrt:Windows.Data.Json\";\nexport function run(): void {\n  Parse(\"1\").GetBoolean();\n}\n";
    let Some((_, prepared)) = prepare("one-line", &binding(method, ""), source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("names the slot and the method")),
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
  import type { c_double } from "c:types";
  import type { ComClass, HString } from "winrt:types";
  export interface IJsonValueMethods {
    /**
     * @ntsVtable 9 GetNumber
     * @ntsHresult
     */
    GetNumber(this: IJsonValue): c_double;
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
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    assert!(text.contains("nts_winrt_factory(") && text.contains("[6])("), "Parse is not called on its factory:\n{text}");
}

/// `@ntsQuery` is a runtime call that answers the object as another of its
/// interfaces; one with arguments, or an IID that is not one, is refused.
#[test]
fn a_query_is_a_runtime_call_and_a_wrong_one_is_refused() {
    let binding = |extra: &str| {
        format!(
            r#"declare module "winrt:Windows.Data.Json" {{
  import type {{ ComClass, HString }} from "winrt:types";
  import type {{ CNumber }} from "c:types";
  export interface IJsonValueMethods {{
    /**
     * @ntsVtable 9 GetNumber
     * @ntsHresult
     */
    GetNumber(this: IJsonValue): CNumber<"double">;
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
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let text = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64).writer.text().to_owned();
    assert!(text.contains("nts_com_query("), "no QueryInterface:\n{text}");

    for (name, extra, call, refusal) in [
        (
            "query-args",
            "    /**\n     * @ntsQuery A3219ECB-F0B3-4DCD-BEEE-19D48CD3ED1E\n     */\n    as_Other(this: JsonValue, n: CNumber<\"double\">): IJsonValue;",
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
        let source = format!("import {{ JsonValue }} from \"winrt:Windows.Data.Json\";\nexport function run(): void {{\n  {call};\n}}\n");
        let Some((_, prepared)) = prepare(name, &binding(extra), &source) else { return };
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains(refusal)),
            "{name}: {:?}",
            prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>()
        );
    }
}

/// `Windows.Foundation`'s `IMemoryBufferReference`, as `bind-winmd` writes it:
/// an event whose handler is a `Delegate`, with `{handler}` as its function
/// type and `{iid}` as the delegate's interface.
fn events(handler: &str, iid: &str) -> String {
    format!(
        r#"declare module "winrt:Windows.Foundation" {{
  import type {{ CNumber }} from "c:types";
  import type {{ ComClass, Delegate, EventRegistrationToken, IInspectable }} from "winrt:types";
  export interface IMemoryBufferReferenceMethods {{
    /**
     * @ntsVtable 6 get_Capacity
     * @ntsHresult
     */
    get_Capacity(this: IMemoryBufferReference): CNumber<"uint32">;
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
    let binding = events("(sender: IMemoryBufferReference, args: IInspectable) => void", "F4637D4A-0760-5431-BFC0-24EB1D4F6C4F");
    let source = "import type { IMemoryBufferReference } from \"winrt:Windows.Foundation\";\nexport function watch(reference: IMemoryBufferReference): number {\n  let seen = 0;\n  reference.add_Closed((sender) => {\n    seen += sender.get_Capacity();\n  });\n  return seen;\n}\n";
    let Some((dir, prepared)) = prepare("delegate", &binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let emitted = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = emitted.writer.text();
    let adapter = text.lines().find(|line| line.starts_with("static int32_t nts_com_invoke_")).unwrap_or_else(|| panic!("no Invoke adapter:\n{text}"));
    assert!(
        adapter.contains("(void *self, struct Windows_Foundation_IMemoryBufferReference * a0, struct IInspectable * a1)")
            && adapter.contains("d->bridge)(a0, a1, d->context); return 0;"),
        "{adapter}"
    );
    for (what, wanted) in [("the object", "nts_com_delegate("), ("the lend", "nts_closure_lend("), ("the give-back", "nts_com_release(")] {
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
        ("delegate-result", "() => CNumber<\"int32\">", "F4637D4A-0760-5431-BFC0-24EB1D4F6C4F", "returns a value"),
        ("delegate-iid", "() => void", "F4637D4A", "not 8-4-4-4-12 hexadecimal digits"),
    ] {
        let Some((_, prepared)) = prepare(name, &events(handler, iid), source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        assert!(
            prepared.diagnostics.iter().any(|d| d.message.contains(refusal)),
            "{name}: expected {refusal:?}, got {:?}",
            prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>()
        );
    }
}
