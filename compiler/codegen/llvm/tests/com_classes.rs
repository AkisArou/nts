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
    assert!(text.contains(", 6u, nts_com_interfaces_App, 2u, true, 0 };"), "the slot, the interfaces or the xaml flag:\n{text}");
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
    assert!(ir.contains("i32 6, ptr @nts_com_interfaces_App, i32 2, i8 1, ptr null }"), "{ir}");
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
/// a constructor, and a field.
#[test]
fn what_a_composed_class_cannot_hold_is_refused_by_name() {
    let head = "import { Application } from \"winrt:Test.Xaml\";\nimport type { IInspectable } from \"winrt:types\";\n";
    let tail = "export function start(): void {\n  new App();\n}\n";
    for (name, body, refusal) in [
        ("unforwardable", "  Fourth(): void {}\n", "`Third`, whose base's is forwarded to and cannot be: a result the binding spells as `out` parameters' fields"),
        ("constructor", "  constructor() {\n    super();\n  }\n  OnLaunched(_args: IInspectable | null): void {}\n", "constructor"),
        ("field", "  count = 0;\n  OnLaunched(_args: IInspectable | null): void {}\n", "field"),
    ] {
        let source = format!("{head}class App extends Application {{\n{body}}}\n{tail}");
        let Some((_, prepared)) = prepare(name, &source) else {
            eprintln!("skipped: no tsgo");
            return;
        };
        let messages: Vec<&String> = prepared.diagnostics.iter().map(|d| &d.message).collect();
        assert!(
            messages.iter().any(|m| m.contains("composable") && m.contains(refusal)),
            "{name}: expected a refusal naming {refusal:?}, got {messages:?}"
        );
    }
}
