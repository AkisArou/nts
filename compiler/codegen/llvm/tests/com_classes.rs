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
