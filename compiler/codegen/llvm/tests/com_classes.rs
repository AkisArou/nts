//! A class the program writes over a composable Windows Runtime class
//! (`class App extends Application`), on both backends: the overrides'
//! adapters, a table per overridable interface, the runtime's `NtsComClass`,
//! and its registration before `main`; and what lowering refuses, by name.
//!
//! Nothing here needs Windows. The C is checked by clang for
//! `x86_64-w64-windows-gnu` against zig's mingw headers and the IR compiled
//! for the same target; running it is `examples/interop/winui-hello`'s job,
//! on the lane's VM.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};
use std::process::Command;

/// `Microsoft.UI.Xaml.Application` as `bind-winmd` writes it, cut down: one
/// overridable interface of one slot, one of two, and a method to call.
const BINDING: &str = r#"declare module "winrt:Test.Xaml" {
  import type { CNumber } from "c:types";
  import type { ComClass, IInspectable } from "winrt:types";
  export interface IApplicationMethods {
    /**
     * @ntsVtable 17 Exit
     * @ntsHresult
     */
    Exit(this: IApplication): void;
  }
  export type IApplication = ComClass<"IApplication"> & IApplicationMethods;
  /**
   * @ntsComposable Test.Xaml.Application 9FD96657-5294-5A65-A1DB-4FEA143597DA 6 xaml
   */
  export class Application {
    /**
     * @ntsVtable 6 CreateInstance
     * @ntsHresult composable
     * @ntsFactory Test.Xaml.Application 9FD96657-5294-5A65-A1DB-4FEA143597DA
     */
    constructor();
    /**
     * @ntsOverride A33E81EF-C665-503B-8827-D27EF1720A06 6 OnLaunched
     */
    OnLaunched(args: IInspectable | null): void;
    /**
     * @ntsOverride 0B5ED9C1-0B2C-4B4C-8F5C-3D2A0F1E2D3C 6 First
     */
    First(): void;
    /**
     * @ntsOverride 0B5ED9C1-0B2C-4B4C-8F5C-3D2A0F1E2D3C 7 Second
     */
    Second(value: CNumber<"int32">, flag: boolean): void;
    /**
     * @ntsOverride 7C2B8F0E-5A61-4D3B-9E47-1F0A2B3C4D5E 6 Third
     */
    Third(): { found: CNumber<"int32">; returnValue: boolean };
    /**
     * @ntsOverride 7C2B8F0E-5A61-4D3B-9E47-1F0A2B3C4D5E 7 Fourth
     */
    Fourth(): void;
  }
  export interface Application extends IApplication {}
}
"#;

fn prepare(name: &str, source: &str) -> Option<(Utf8PathBuf, hir::Prepared)> {
    prepare_with(name, BINDING, source)
}

fn prepare_with(name: &str, binding: &str, source: &str) -> Option<(Utf8PathBuf, hir::Prepared)> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..").canonicalize_utf8().unwrap();
    let dir = root.join(format!("target/com-classes-tests/{}-{name}", std::process::id()));
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
    assert!(!snapshot.has_errors(), "{name}: {:?}", snapshot.diagnostics);
    Some((dir, hir::prepare(&snapshot).unwrap()))
}

const PROGRAM: &str = r#"import { Application } from "winrt:Test.Xaml";
let launched = 0;
class App extends Application {
  OnLaunched(): void {
    launched += 1;
    this.Exit();
  }
  First(): void {}
  Second(value: number, flag: boolean): void {
    if (flag) launched += value;
  }
}
export function start(): number {
  new App();
  return launched;
}
"#;

/// Each override is an adapter taking the interface pointer and the ABI's
/// arguments, calling the compiled method with the instance; each interface
/// a table of the outer object's six slots and then the adapters in slot
/// order; the class its runtime descriptor, registered by a constructor; and
/// `new App()` the runtime composing it by name. Both backends, compiled for
/// Windows.
#[test]
fn a_class_over_a_composable_class_is_composed_by_the_runtime() {
    let Some((dir, prepared)) = prepare("shape", PROGRAM) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let adapter = text.lines().find(|line| line.starts_with("static int32_t nts_com_adapter_App_2(")).unwrap_or_else(|| panic!("no adapter for Second:\n{text}"));
    assert!(adapter.contains("nts_com_outer_instance(a0)") && adapter.contains("nts_callback_enter();"), "{adapter}");
    // `OnLaunched()` takes none of the slot's parameters: the adapter is
    // still called with them, and passes on only the instance.
    let launched = text.lines().find(|line| line.starts_with("static int32_t nts_com_adapter_App_0(")).unwrap();
    assert!(launched.contains("(void * a0, void * a1)") && launched.contains("nts_com_outer_instance(a0)); nts_callback_leave();"), "{launched}");
    let tables: Vec<&str> = text.lines().filter(|line| line.starts_with("static const void *const nts_com_table_App_")).collect();
    assert_eq!(tables.len(), 2, "one table per overridable interface:\n{text}");
    assert!(
        tables[1].contains("(const void *)nts_com_outer_trust, (const void *)nts_com_adapter_App_1, (const void *)nts_com_adapter_App_2 }"),
        "the second interface's slots 6 and 7 are not First and Second:\n{}",
        tables[1]
    );
    assert!(text.contains("static NtsComClass nts_com_class_App = { \"App\", \"Test.Xaml.Application\", "), "{text}");
    assert!(text.contains(", 6u, nts_com_interfaces_App, 2u, true, 0, 0 };"), "the slot, the interfaces, the xaml flag or the maker:\n{text}");
    assert!(text.contains("nts_com_register(&nts_com_class_App);"), "{text}");
    assert!(text.contains("nts_com_compose_named("), "`new App()` does not compose:\n{text}");
    windows_syntax(&dir, &c);

    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let ir = &llvm.text;
    assert!(ir.contains("define internal i32 @nts_com_adapter_App_2(ptr %a0, i32 %a1, i1 zeroext %a2)"), "{ir}");
    assert!(ir.contains("[8 x ptr] [ptr @nts_com_outer_query,"), "the two-override table:\n{ir}");
    // The `int32` converted to the `number` the compiled method takes.
    assert!(ir.contains("%p1 = sitofp i32 %a1 to double"), "{ir}");
    assert!(ir.contains("i32 6, ptr @nts_com_interfaces_App, i32 2, i8 1, ptr null, ptr null }"), "{ir}");
    assert_eq!(ir.matches("@llvm.global_ctors").count(), 1, "{ir}");
    assert!(ir.contains("ptr @nts_com_register_classes"), "{ir}");
    std::fs::write(dir.join("program.ll"), ir).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// A parameter's extension follows its type in LLVM (`i1 zeroext %a0`); a
/// result's precedes it. A delegate taking a `boolean` was spelled the
/// result's way, which is not IR, and no fixture's delegate took one.
#[test]
fn a_delegate_taking_a_boolean_is_ir() {
    const EVENTS: &str = r#"declare module "winrt:Test.Events" {
  import type { ComClass, Delegate } from "winrt:types";
  export interface ISourceMethods {
    /**
     * @ntsVtable 6 Watch
     * @ntsHresult
     */
    Watch(this: ISource, handler: Delegate<(flag: boolean) => void, "F4637D4A-0760-5431-BFC0-24EB1D4F6C4F">): void;
  }
  export type ISource = ComClass<"ISource"> & ISourceMethods;
}
"#;
    let source = "import type { ISource } from \"winrt:Test.Events\";\nexport function watch(source: ISource): number {\n  let seen = 0;\n  source.Watch((flag) => {\n    if (flag) seen += 1;\n  });\n  return seen;\n}\n";
    let Some((dir, prepared)) = prepare_with("delegate-bool", EVENTS, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("(ptr %self, i1 zeroext %a0)"), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// Layout overrides as `bind-winmd` writes `FrameworkElement`'s, cut down.
const LAYOUT: &str = r#"declare module "winrt:Test.Layout" {
  import type { ByValue, CNumber, Struct, c_float } from "c:types";
  import type { ComClass, HString, IInspectable } from "winrt:types";
  export type Size = Struct<{ Width: c_float; Height: c_float }, "Test_Size">;
  export type Rect = Struct<{ X: c_float; Y: c_float; Width: c_float; Height: c_float }, "Test_Rect">;
  /**
   * @ntsComposable Test.Layout.Element 9FD96657-5294-5A65-A1DB-4FEA143597DA 6
   */
  export class Element {
    constructor();
    /**
     * @ntsOverride FFC6FD98-F38C-5904-9CE4-97A3427CF4BA 6 MeasureOverride
     */
    MeasureOverride(availableSize: ByValue<Size>): ByValue<Size>;
    /**
     * @ntsOverride FFC6FD98-F38C-5904-9CE4-97A3427CF4BA 7 ArrangeOverride
     */
    ArrangeOverride(finalRect: ByValue<Rect>): void;
    /**
     * @ntsOverride FFC6FD98-F38C-5904-9CE4-97A3427CF4BA 8 OnApplyTemplate
     */
    OnApplyTemplate(): void;
    /**
     * @ntsOverride FFC6FD98-F38C-5904-9CE4-97A3427CF4BA 9 GoToElementStateCore
     */
    GoToElementStateCore(stateName: HString, useTransitions: boolean): boolean;
    /**
     * @ntsOverride 2B7E1A55-8C3F-4D21-A6E9-0F4B8D2C7E13 6 Allowed
     */
    Allowed(level: CNumber<"int32">): boolean;
    /**
     * @ntsOverride 2B7E1A55-8C3F-4D21-A6E9-0F4B8D2C7E13 7 Peer
     */
    Peer(): IInspectable | null;
    /**
     * @ntsOverride 2B7E1A55-8C3F-4D21-A6E9-0F4B8D2C7E13 8 Name
     */
    Name(): HString;
  }
  export type IElement = ComClass<"IElement">;
  export interface Element extends IElement {}
}
"#;

/// A record by value in a forwarded slot is passed on as Win64 passes it:
/// C spells the record, whose definition the program carries though no value
/// of its holds one, and LLVM an 8-byte `Size` as an `i64` and a 16-byte
/// `Rect` as the address of the caller's copy -- integer registers, which is
/// what matters: on Windows a `Size` read from a float register made layout
/// give the button no width. Overriding `OnApplyTemplate` alone is
/// `IFrameworkElementOverrides` as C# overrides it.
#[test]
fn a_forwarded_record_is_passed_as_win64_passes_it() {
    let source = "import { Element } from \"winrt:Test.Layout\";\nlet applied = 0;\nclass Panel extends Element {\n  OnApplyTemplate(): void {\n    applied += 1;\n  }\n}\nexport function start(): number {\n  new Panel();\n  return applied;\n}\n";
    let Some((dir, prepared)) = prepare_with("forward-record", LAYOUT, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.contains("static int32_t nts_com_forward_Panel_0(void * a0, struct Test_Size a1, void * a2)"), "{text}");
    assert!(text.contains("static int32_t nts_com_forward_Panel_1(void * a0, struct Test_Rect a1)"), "{text}");
    // A string is its `HSTRING` handle, and the `boolean` result its pointer.
    assert!(text.contains("static int32_t nts_com_forward_Panel_2(void * a0, void * a1, bool a2, void * a3)"), "{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("@nts_com_forward_Panel_0(ptr %a0, i64 %a1, ptr %a2)"), "{}", llvm.text);
    assert!(llvm.text.contains("@nts_com_forward_Panel_1(ptr %a0, ptr %a1)"), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// An override answering a value, as C# writes `MeasureOverride`: the record
/// it takes is the address of the adapter's copy, and the record it answers
/// is written straight through the slot's result pointer, which the compiled
/// method takes last; a `boolean` is stored there as the byte it is. Its
/// `super.MeasureOverride(available)` answers the base's record through the
/// same convention.
#[test]
fn an_override_answers_through_the_result_pointer() {
    let source = "import { Element } from \"winrt:Test.Layout\";\nimport type { Size } from \"winrt:Test.Layout\";\nimport type { ByValue } from \"c:types\";\nclass Panel extends Element {\n  MeasureOverride(available: ByValue<Size>): ByValue<Size> {\n    return super.MeasureOverride(available);\n  }\n  Allowed(level: number): boolean {\n    return level > 2;\n  }\n}\nexport function start(): void {\n  new Panel();\n}\n";
    let Some((dir, prepared)) = prepare_with("results", LAYOUT, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let measure = text.lines().find(|line| line.starts_with("static int32_t nts_com_adapter_Panel_0(")).unwrap_or_else(|| panic!("{text}"));
    assert!(measure.contains("(void * a0, struct Test_Size a1, struct Test_Size *out)") && measure.contains("&a1") && measure.contains(")out);"), "{measure}");
    let allowed = text.lines().find(|line| line.starts_with("static int32_t nts_com_adapter_Panel_1(")).unwrap_or_else(|| panic!("{text}"));
    assert!(allowed.contains("(void * a0, int32_t a1, bool *out)") && allowed.contains("*out = (bool)"), "{allowed}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("@nts_com_adapter_Panel_0(ptr %a0, i64 %a1, ptr %out)"), "{}", llvm.text);
    assert!(llvm.text.contains("%byte = zext i1 %r to i8\n  store i8 %byte, ptr %out"), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// Fields, as C#'s `App` has them: the object holding them is made by the
/// class's maker (`App#state`, entered as an entry point) before the base is
/// composed, kept by the outer object, and lent by `nts_com_state` wherever
/// the program reads one -- in an override through `this`, and from outside
/// through the instance.
#[test]
fn a_composed_class_keeps_its_fields_in_its_outer_object() {
    let source = "import { Application } from \"winrt:Test.Xaml\";\nimport type { IInspectable } from \"winrt:types\";\nclass App extends Application {\n  count = 0;\n  name = \"app\";\n  OnLaunched(_args: IInspectable | null): void {\n    this.count += 1;\n  }\n}\nexport function start(): string {\n  const app = new App();\n  return app.name + String(app.count);\n}\n";
    let Some((dir, prepared)) = prepare("fields", source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.contains("static void *nts_com_state_App(void) { nts_callback_enter();"), "no maker entry:\n{text}");
    assert!(text.contains(", 0, nts_com_state_App };"), "the descriptor does not name the maker:\n{text}");
    assert!(text.matches("nts_com_state(").count() >= 3, "a field is not read through the outer object:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("ptr null, ptr @nts_com_state_App }"), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// A string the Windows Runtime lends an override arrives as its `HSTRING`
/// and is bound to a string holding its text, copied rather than taken: the
/// caller still owns the handle (`nts_string_copy_hstring`, not
/// `nts_string_from_hstring`, which deletes it).
#[test]
fn a_string_argument_is_the_text_of_the_lent_hstring() {
    let source = "import { Element } from \"winrt:Test.Layout\";\nlet last = \"\";\nclass Panel extends Element {\n  GoToElementStateCore(stateName: string, useTransitions: boolean): boolean {\n    last = stateName;\n    return useTransitions && stateName.length > 0;\n  }\n}\nexport function start(): string {\n  new Panel();\n  return last;\n}\n";
    let Some((dir, prepared)) = prepare_with("hstring", LAYOUT, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let adapter = text.lines().find(|line| line.starts_with("static int32_t nts_com_adapter_Panel_0(")).unwrap_or_else(|| panic!("{text}"));
    assert!(adapter.contains("(void * a0, void * a1, bool a2, bool *out)"), "{adapter}");
    assert!(text.contains("nts_string_copy_hstring("), "the lent HSTRING is not copied:\n{text}");
    assert!(!text.contains("nts_string_from_hstring("), "the lent HSTRING is taken, and deleted:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// A constructor, as C#'s `public App(string name) { ... }`: `new App("ada")`
/// calls `App#new`, whose `super()` composes the instance -- its fields
/// already made -- and whose body then runs with `this`.
#[test]
fn a_composed_class_constructor_runs_after_its_composition() {
    let source = "import { Application } from \"winrt:Test.Xaml\";\nimport type { IInspectable } from \"winrt:types\";\nclass App extends Application {\n  label = \"\";\n  constructor(name: string) {\n    super();\n    this.label = \"hello \" + name;\n  }\n  OnLaunched(_args: IInspectable | null): void {}\n}\nexport function start(): string {\n  return new App(\"ada\").label;\n}\n";
    let Some((dir, prepared)) = prepare("constructor", source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let start = text.lines().position(|line| line.contains(" App__new(") && line.ends_with('{')).unwrap_or_else(|| panic!("no App#new:\n{text}"));
    let body = text.lines().skip(start + 1).take_while(|line| *line != "}").collect::<Vec<_>>().join("\n");
    assert!(body.contains("nts_com_compose_named("), "the constructor does not compose:\n{body}");
    assert!(body.contains("nts_com_state("), "the body does not write a field:\n{body}");
    assert!(text.contains("App__new("), "`new App(...)` does not call the constructor:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// An override answering an object, as `OnCreateAutomationPeer` does: the
/// slot's result pointer takes a reference the caller owns, which
/// `nts_com_answer` makes of the one the method answers under either
/// provider.
#[test]
fn an_override_answers_an_object_the_caller_owns() {
    let source = "import { Element } from \"winrt:Test.Layout\";\nimport type { IInspectable } from \"winrt:types\";\nclass Panel extends Element {\n  kept: IInspectable | null = null;\n  Allowed(_level: number): boolean {\n    return true;\n  }\n  Peer(): IInspectable | null {\n    return this.kept;\n  }\n}\nexport function start(): void {\n  new Panel();\n}\n";
    let Some((dir, prepared)) = prepare_with("object-result", LAYOUT, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let adapter = text.lines().find(|line| line.starts_with("static int32_t nts_com_adapter_Panel_1(")).unwrap_or_else(|| panic!("{text}"));
    assert!(adapter.contains("(void * a0, void **out)") && adapter.contains("*out = nts_com_answer((void *)"), "{adapter}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("%answered = call ptr @nts_com_answer(ptr %r)"), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// An override answering a string: the slot writes an `HSTRING` of its own,
/// which the caller owns -- made from the method's string, and not a
/// reference to it (`nts_com_answer_string`, not `nts_string_to_hstring`,
/// whose fast-pass header lives in the caller's frame).
#[test]
fn an_override_answers_a_string_as_an_hstring_of_its_own() {
    let source = "import { Element } from \"winrt:Test.Layout\";\nclass Panel extends Element {\n  Name(): string {\n    return \"panel\";\n  }\n}\nexport function start(): void {\n  new Panel();\n}\n";
    let Some((dir, prepared)) = prepare_with("string-result", LAYOUT, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let adapter = text.lines().find(|line| line.starts_with("static int32_t nts_com_adapter_Panel_0(")).unwrap_or_else(|| panic!("{text}"));
    assert!(adapter.contains("(void * a0, void **out)") && adapter.contains("*out = nts_com_answer_string((NtsString *)"), "{adapter}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("%answered = call ptr @nts_com_answer_string(ptr %r)"), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// A method that overrides nothing is the program's own: a function taking
/// the instance, called directly -- through `this` in an override, and on an
/// instance from outside -- where it was refused as overriding nothing.
#[test]
fn a_composed_class_has_methods_of_its_own() {
    let source = "import { Application } from \"winrt:Test.Xaml\";\nimport type { IInspectable } from \"winrt:types\";\nclass App extends Application {\n  count = 0;\n  bump(by: number): number {\n    this.count += by;\n    return this.count;\n  }\n  OnLaunched(_args: IInspectable | null): void {\n    this.bump(1);\n  }\n}\nexport function start(): number {\n  return new App().bump(2);\n}\n";
    let Some((dir, prepared)) = prepare("own-method", source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.matches("App__bump(").count() >= 3, "the method is not defined and called twice:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
}

/// A class's idiomatic surface, as `bind-winmd` writes it: `WidgetMembers`
/// on the class implementing the interfaces, `GadgetMembers` inheriting it.
const SURFACE: &str = r#"declare module "winrt:Test.Surface" {
  import type { CNumber } from "c:types";
  import type { ComClass } from "winrt:types";
  export type IWidget = ComClass<"IWidget">;
  export type IGadget = ComClass<"IGadget">;
  export interface WidgetMembers {
    /**
     * @ntsGet 6 get_Size
     * @ntsSet 7 put_Size
     * @ntsVia 11111111-2222-3333-4444-555555555555 IWidget
     */
    size: CNumber<"int32">;
    /**
     * @ntsVtable 6 Refresh
     * @ntsHresult
     * @ntsVia 66666666-7777-8888-9999-AAAAAAAAAAAA
     */
    refresh(): void;
  }
  export interface GadgetMembers extends WidgetMembers {}
  export type Widget = IWidget & WidgetMembers;
  export type Gadget = IGadget & GadgetMembers;
}
"#;

/// Properties and camelCase methods of a class's surface, each called
/// through its interface: a receiver of exactly the class a default
/// interface's member names is that interface already and is not asked
/// again; a member of another interface, or one a subclass inherits, is
/// asked for (`nts_com_query`) and given back after the call.
#[test]
fn a_surface_member_is_called_through_its_interface() {
    let source = "import type { Gadget, Widget } from \"winrt:Test.Surface\";\nexport function own(w: Widget): number {\n  w.size = 3;\n  return w.size;\n}\nexport function other(w: Widget): void {\n  w.refresh();\n}\nexport function inherited(g: Gadget): number {\n  return g.size;\n}\n";
    let Some((dir, prepared)) = prepare_with("surface", SURFACE, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let body = |name: &str| {
        let start = text.lines().position(|line| line.contains(&format!(" {name}(")) && line.ends_with('{')).unwrap_or_else(|| panic!("no {name}:\n{text}"));
        text.lines().skip(start + 1).take_while(|line| *line != "}").collect::<Vec<_>>().join("\n")
    };
    let own = body("own");
    assert!(!own.contains("nts_com_query("), "the class's own handle is asked for its default interface:\n{own}");
    assert!(own.contains("[7])(") && own.contains("[6])("), "the setter and getter slots are not called:\n{own}");
    let other = body("other");
    assert!(other.contains("nts_com_query(") && other.contains("nts_com_release("), "another interface's member is not asked for and given back:\n{other}");
    let inherited = body("inherited");
    assert!(inherited.contains("nts_com_query("), "a subclass's instance is not asked for the base's interface:\n{inherited}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// The camelCase name is the one other a slot's method may be declared
/// under: any other name disagrees with the slot and is refused.
#[test]
fn a_surface_name_other_than_the_slots_is_refused() {
    let binding = SURFACE.replace("    refresh(): void;", "    reload(): void;");
    let source = "import type { Widget } from \"winrt:Test.Surface\";\nexport function other(w: Widget): void {\n  w.reload();\n}\n";
    let Some((_, prepared)) = prepare_with("surface-name", &binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("@ntsVtable 6 Refresh on a declaration of another name")),
        "{:?}",
        prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>()
    );
}

/// `new Application()` of the binding's own class, as JavaScript writes
/// `new Window()`: its factory's `CreateInstance`, called on the factory as
/// the static of that name is, with no outer object -- not the runtime's
/// composition, which is a class of the program's over it.
#[test]
fn a_bindings_composable_class_is_made_by_its_factory() {
    let source = "import { Application } from \"winrt:Test.Xaml\";\nexport function start(): void {\n  new Application();\n}\n";
    let Some((dir, prepared)) = prepare("new-binding-class", source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.contains("nts_winrt_factory(") && text.contains("[6])("), "not the factory's slot 6:\n{text}");
    assert!(!text.contains("nts_com_compose_named("), "composed as a class of the program's:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
}

/// `super.OnLaunched(args)` in an override is the base's own implementation
/// of the interface, from the runtime (`nts_com_base`, which answers the
/// program's reference), called through the override's slot with its
/// HRESULT checked -- not a call of the program's own method, which would
/// recurse.
#[test]
fn super_in_an_override_calls_the_base_through_its_slot() {
    let source = "import { Application } from \"winrt:Test.Xaml\";\nimport type { IInspectable } from \"winrt:types\";\nclass App extends Application {\n  OnLaunched(args: IInspectable | null): void {\n    super.OnLaunched(args);\n  }\n}\nexport function start(): void {\n  new App();\n}\n";
    let Some((dir, prepared)) = prepare("super", source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let start = text.lines().position(|line| line.contains(" App__OnLaunched(") && line.ends_with('{')).unwrap_or_else(|| panic!("no definition:\n{text}"));
    let body = text.lines().skip(start + 1).take_while(|line| *line != "}").collect::<Vec<_>>().join("\n");
    assert!(body.contains("nts_com_base("), "the base's implementation is not asked for:\n{body}");
    assert!(body.contains("[6])("), "no call through slot 6:\n{body}");
    assert!(body.contains("nts_hresult_message("), "the HRESULT is not checked:\n{body}");
    assert!(!body.contains("App__OnLaunched("), "the override calls itself:\n{body}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("call ptr @nts_com_base("), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// The C with mingw's headers, checked by clang: `-fsyntax-only` is ignored
/// by `zig cc`, so clang itself.
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

/// A class overriding part of an interface, as C# lets it: each slot it
/// leaves is a forwarder calling the same slot of the base's own
/// implementation with the same arguments -- `Second`'s `int32` and `bool`
/// passed through, not converted -- so the table has no gap.
#[test]
fn a_slot_the_class_leaves_is_forwarded_to_its_base() {
    let source = "import { Application } from \"winrt:Test.Xaml\";\nclass App extends Application {\n  First(): void {}\n}\nexport function start(): void {\n  new App();\n}\n";
    let Some((dir, prepared)) = prepare("forward", source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    let forward = text.lines().find(|line| line.starts_with("static int32_t nts_com_forward_App_0(")).unwrap_or_else(|| panic!("no forwarder:\n{text}"));
    assert!(
        forward.contains("(void * a0, int32_t a1, bool a2)")
            && forward.contains("nts_com_outer_base(a0)")
            && forward.contains("[7])(base, a1, a2);"),
        "{forward}"
    );
    let table = text.lines().find(|line| line.starts_with("static const void *const nts_com_table_App_0[]")).unwrap();
    assert!(table.ends_with("(const void *)nts_com_adapter_App_0, (const void *)nts_com_forward_App_0 };"), "{table}");
    windows_syntax(&dir, &c);

    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("define internal i32 @nts_com_forward_App_0(ptr %a0, i32 %a1, i1 zeroext %a2)"), "{}", llvm.text);
    assert!(llvm.text.contains("call i32 %base.fn(ptr %base, i32 %a1, i1 zeroext %a2)"), "{}", llvm.text);
    std::fs::write(dir.join("program.ll"), &llvm.text).unwrap();
    let compiled = Command::new("clang")
        .current_dir(&dir)
        .args(["--target=x86_64-w64-windows-gnu", "-O2", "-Wno-override-module", "-c", "program.ll", "-o", "program.o"])
        .output()
        .unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
}

/// What a composed class cannot be yet, refused where it is written, naming
/// it: an interface overridden in part whose other slot cannot be forwarded,
/// a constructor that does not open with its `super()`, and a field
/// initialiser that could reach the half-made instance.
#[test]
fn what_a_composed_class_cannot_hold_is_refused_by_name() {
    let head = "import { Application } from \"winrt:Test.Xaml\";\nimport type { IInspectable } from \"winrt:types\";\n";
    let tail = "export function start(): void {\n  new App();\n}\n";
    for (name, body, refusal) in [
        ("unforwardable", "  Fourth(): void {}\n", "`Third`, whose base's is forwarded to and cannot be: a result the binding spells as `out` parameters' fields"),
        ("late-super", "  constructor() {\n    const early = 1;\n    super();\n    void early;\n  }\n  OnLaunched(_args: IInspectable | null): void {}\n", "does not open with its `super()`"),
        ("reaching-initializer", "  me = this;\n  OnLaunched(_args: IInspectable | null): void {}\n", "a field initialiser of a class extending a foreign class"),
    ] {
        let source = format!("{head}class App extends Application {{\n{body}}}\n{tail}");
        let Some((_, prepared)) = prepare(name, &source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        let messages: Vec<&String> = prepared.diagnostics.iter().map(|d| &d.message).collect();
        assert!(
            messages.iter().any(|m| m.contains(refusal)),
            "{name}: expected a refusal naming {refusal:?}, got {messages:?}"
        );
    }
}

/// A button and its base, as `bind-winmd` writes a default interface over a
/// base class's: the derived type carries the base's tag in its chain, and an
/// `@ntsQuery` names the base interface's IID.
const UPCAST: &str = r#"declare module "winrt:Test.Upcast" {
  import type { ComClass } from "winrt:types";
  export type IElement = ComClass<"Test_IElement"> & IElementMethods;
  export type IButton = ComClass<"Test_IButton", IElement> & IButtonMethods & IElementMethods;
  export type IWindow = ComClass<"Test_IWindow"> & IWindowMethods;
  export interface IElementMethods {}
  export interface IButtonMethods {
    /**
     * @ntsQuery 0B0B0B0B-1111-2222-3333-444444444444
     */
    as_IElement(this: IButton): IElement;
  }
  export interface IWindowMethods {
    /**
     * @ntsVtable 6 put_Content
     * @ntsHresult
     */
    put_Content(this: IWindow, value: IElement | null): void;
  }
}
"#;

/// A derived class's handle where its base's is expected (`window.content =
/// button`) is asked for the base's interface (`nts_com_query`) -- a COM
/// object's interfaces are different pointers, so relabelling the one it has
/// would call the base's slots through the button's table.
#[test]
fn a_handle_passed_as_its_base_is_asked_for_the_base_interface() {
    let source = "import type { IButton, IWindow } from \"winrt:Test.Upcast\";\nexport function show(w: IWindow, b: IButton): void {\n  w.put_Content(b);\n}\n";
    let Some((dir, prepared)) = prepare_with("upcast", UPCAST, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    // The IID's first word, `Data1 | Data2 << 32 | Data3 << 48`.
    let first = 0x0B0B_0B0B_u64 | (0x1111 << 32) | (0x2222 << 48);
    assert!(text.contains("nts_com_query(") && text.contains(&first.to_string()), "not asked for the base's IID:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("nts_com_query"), "the IR does not ask:\n{}", llvm.text);
}

/// A class's events as `bind-winmd` writes them: a map from each event's
/// name to its listener, an `Event<F, IID, Slots>` naming the interface and
/// its `add_`/`remove_` slots, and `addEventListener` over the map.
const EVENTS: &str = r#"declare module "winrt:Test.Events" {
  import type { ComClass, Event, IInspectable } from "winrt:types";
  export type IButton = ComClass<"Test_IButton">;
  export interface ButtonEventMap {
    click: Event<(sender: IInspectable, e: IInspectable) => void, "A856E674-B0B6-4BC3-BBA8-1BA06E40D4B5", "0B0B0B0B-1111-2222-3333-444444444444 14 15">;
  }
  export interface ButtonMembers {
    /**
     * @ntsListener add
     */
    addEventListener<K extends keyof ButtonEventMap>(type: K, listener: ButtonEventMap[K]): void;
    /**
     * @ntsListener remove
     */
    removeEventListener<K extends keyof ButtonEventMap>(type: K, listener: ButtonEventMap[K]): void;
  }
  export type Button = IButton & ButtonMembers;
}
"#;

/// `addEventListener("click", f)`: the runtime's `nts_winrt_listen`, handed
/// the event the listener's type names -- the interface and its slots -- and
/// `f` made a delegate of the event's IID; `removeEventListener` the
/// runtime's `nts_winrt_unlisten`, over the same event and `f` itself. Each
/// answers an HRESULT, which is thrown when it fails.
#[test]
fn an_event_listener_is_added_and_removed_by_the_runtime() {
    let source = "import type { Button } from \"winrt:Test.Events\";\nlet clicks = 0;\nconst onClick = (): void => {\n  clicks += 1;\n};\nexport function wire(b: Button): number {\n  b.addEventListener(\"click\", onClick);\n  b.removeEventListener(\"click\", onClick);\n  return clicks;\n}\n";
    let Some((dir, prepared)) = prepare_with("events", EVENTS, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics);
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.contains("nts_winrt_listen(") && text.contains("nts_winrt_unlisten("), "not the runtime's:\n{text}");
    // The event's interface as two words, the first `Data1 | Data2 << 32 |
    // Data3 << 48`.
    let first = 0x0B0B_0B0B_u64 | (0x1111 << 32) | (0x2222 << 48);
    assert!(text.contains(&first.to_string()), "not the event the type names:\n{text}");
    // One delegate, the addition's: a removal passes the function.
    assert_eq!(text.matches("nts_com_delegate(").count(), 1, "a removal made a delegate:\n{text}");
    assert!(text.contains("nts_com_delegate("), "the listener is not made a delegate:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("@nts_winrt_listen("), "the IR does not listen:\n{}", llvm.text);
}

/// A listener whose type is a plain function, naming no event, is refused
/// by name: there is no interface or slot to add it through.
#[test]
fn a_listener_naming_no_event_is_refused() {
    let binding = EVENTS.replace(
        "Event<(sender: IInspectable, e: IInspectable) => void, \"A856E674-B0B6-4BC3-BBA8-1BA06E40D4B5\", \"0B0B0B0B-1111-2222-3333-444444444444 14 15\">",
        "(sender: IInspectable, e: IInspectable) => void",
    );
    let source = "import type { Button } from \"winrt:Test.Events\";\nexport function wire(b: Button): void {\n  b.addEventListener(\"click\", () => {});\n}\n";
    let Some((_, prepared)) = prepare_with("events-no-event", &binding, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(
        prepared.diagnostics.iter().any(|d| d.message.contains("an event listener whose type names no event")),
        "{:?}",
        prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>()
    );
}

/// A generic interface as `bind-winmd` writes it, with its own surface.
const GENERIC: &str = r#"declare module "winrt:Test.Generic" {
  import type { CNumber } from "c:types";
  import type { ComClass, IInspectable } from "winrt:types";
  export interface IVectorMethods<T> {
    /**
     * @ntsVtable 6 GetAt
     * @ntsHresult
     */
    GetAt(this: IVector<T>, index: CNumber<"uint32">): T;
    /**
     * @ntsVtable 7 get_Size
     * @ntsHresult
     */
    get_Size(this: IVector<T>): CNumber<"uint32">;
  }
  export interface IVectorMembers<T> {
    /**
     * @ntsVtable 6 GetAt
     * @ntsHresult
     */
    getAt(this: IVector<T>, index: CNumber<"uint32">): T;
    /**
     * @ntsGet 7 get_Size
     */
    readonly size: CNumber<"uint32">;
    /**
     * @ntsIterate get_Size GetAt
     */
    [Symbol.iterator](): Iterator<T>;
  }
  export type IVector<T> = ComClass<"Test_IVector"> & IVectorMethods<T> & IVectorMembers<T>;
  export type Things = IVector<IInspectable>;
}
"#;

/// An instantiation's own surface: `list.size` through the getter's slot and
/// `list.getAt(i)` through its own, on the instantiation's table -- whether
/// the receiver is spelled as the instantiation or by an alias of it.
#[test]
fn a_generic_interfaces_surface_is_called_on_its_own_table() {
    let source = "import type { IInspectable } from \"winrt:types\";\nimport type { IVector, Things } from \"winrt:Test.Generic\";\nexport function count(v: IVector<IInspectable>): number {\n  return v.size;\n}\nexport function first(v: Things): IInspectable {\n  return v.getAt(0);\n}\n";
    let Some((dir, prepared)) = prepare_with("generic", GENERIC, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>());
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.contains("[7])(") && text.contains("[6])("), "not the slots:\n{text}");
    assert!(!text.contains("nts_com_query("), "an instantiation is asked for itself:\n{text}");
    windows_syntax(&dir, &c);
}

/// `for (const x of list)` over a vector: `GetAt(i)` while `i < get_Size()`,
/// the size asked each turn as an array's `length` is -- two slot calls, no
/// iterator object and no query. `Array.from(list)` walks it the same way.
/// (`[...list]` is a copy, which only an array has.)
#[test]
fn a_vector_is_walked_by_count_through_its_own_table() {
    let source = "import type { IInspectable } from \"winrt:types\";\nimport type { IVector } from \"winrt:Test.Generic\";\nexport function count(v: IVector<IInspectable>): number {\n  let n = 0;\n  for (const item of v) {\n    if (item !== null) n += 1;\n  }\n  return n;\n}\nexport function copied(v: IVector<IInspectable>): number {\n  return Array.from(v).length;\n}\n";
    let Some((dir, prepared)) = prepare_with("vector-walk", GENERIC, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>());
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.contains("[7])(") && text.contains("[6])("), "not get_Size and GetAt:\n{text}");
    assert!(!text.contains("nts_com_query("), "a vector is asked for another interface to be walked:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
}

/// A class's static property as `bind-winmd` writes it: a variable of its
/// namespace, read and written through its statics factory's slots.
const STATICS: &str = r#"declare module "winrt:Test.Statics" {
  import type { CNumber } from "c:types";
  export namespace Clock {
    /**
     * @ntsGet 6 get_Ticks
     * @ntsSet 7 put_Ticks
     * @ntsFactory Test.Statics.Clock 0B0B0B0B-1111-2222-3333-444444444444
     */
    let ticks: CNumber<"int32">;
  }
}
"#;

/// `Clock.ticks` and `Clock.ticks = n`: the getter's and the setter's slot
/// on the class's statics factory, which the call supplies as a static
/// method's receiver -- the namespace written before it is no value.
#[test]
fn a_static_property_is_called_on_its_factory() {
    let source = "import { Clock } from \"winrt:Test.Statics\";\nexport function tick(): number {\n  Clock.ticks = Clock.ticks + 1;\n  return Clock.ticks;\n}\n";
    let Some((dir, prepared)) = prepare_with("statics", STATICS, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>());
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert!(text.contains("nts_winrt_factory("), "not on the factory:\n{text}");
    assert!(text.contains("[6])(") && text.contains("[7])("), "not the getter's and setter's slots:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
}

/// A method and a property taking any object, as `bind-winmd` writes them:
/// `Inspectable | null`.
const BOXING: &str = r#"declare module "winrt:Test.Boxing" {
  import type { ComClass, IInspectable, Inspectable } from "winrt:types";
  export interface IHolderMethods {
    /**
     * @ntsVtable 6 Put
     * @ntsHresult
     */
    Put(this: IHolder, value: Inspectable | null): void;
    /**
     * @ntsVtable 7 get_Content
     * @ntsHresult
     */
    get_Content(this: IHolder): IInspectable;
  }
  export interface IHolderMembers {
    /**
     * @ntsGet 7 get_Content
     */
    get content(): IInspectable;
    /**
     * @ntsSet 8 put_Content
     */
    set content(value: Inspectable | null);
  }
  export type IHolder = ComClass<"Test_IHolder"> & IHolderMethods & IHolderMembers;
}
"#;

/// A string, number or boolean where the Windows Runtime takes an object is
/// boxed by the runtime (`nts_winrt_box`) and the box given back after the
/// call; an object is passed as itself. `holder.content = "Press"` is the
/// same, through the setter's slot.
#[test]
fn a_primitive_where_an_object_is_taken_is_boxed() {
    let source = "import type { IHolder } from \"winrt:Test.Boxing\";\nexport function fill(h: IHolder): void {\n  h.Put(\"text\");\n  h.Put(4.5);\n  h.Put(h.content);\n  h.content = \"Press\";\n}\n";
    let Some((dir, prepared)) = prepare_with("boxing", BOXING, source) else {
        eprintln!("skipped: no tsgo");
        return;
    };
    assert!(prepared.diagnostics.is_empty(), "{:?}", prepared.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>());
    let c = nts_codegen_c::emit(&prepared.program, nts_core::hir::native::NativeAbi::Win64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    let text = c.writer.text();
    assert_eq!(text.matches("nts_winrt_box(").count(), 3, "not the string, the number and the property's string boxed:\n{text}");
    assert!(text.matches("nts_com_release(").count() >= 3, "a box is not given back:\n{text}");
    windows_syntax(&dir, &c);
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::WIN64_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    assert!(llvm.text.contains("@nts_winrt_box("), "the IR does not box:\n{}", llvm.text);
}
