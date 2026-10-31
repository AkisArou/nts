//! One implementation can ignore different argument types in distinct roles.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../../test-support/scratch.rs"]
mod scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

fn source(selector: &str) -> String {
    format!(
        r"
interface Numeric {{ read(n:number):number; }}
interface Textual {{ {selector}(s:string):number; }}
class Both implements Numeric, Textual {{
  read():number {{ return 17; }}
  text():number {{ return 17; }}
}}
class NumberA implements Numeric {{ read(n:number):number {{ return n; }} }}
class NumberB implements Numeric {{ read(n:number):number {{ return n+1; }} }}
class TextA implements Textual {{
  read(s:string):number {{ return s.length; }}
  text(s:string):number {{ return s.length; }}
}}
class TextB implements Textual {{
  read(s:string):number {{ return s.length+1; }}
  text(s:string):number {{ return s.length+1; }}
}}
function numberCall(value:Numeric,n:number):number {{ return value.read(n); }}
function textCall(value:Textual,s:string):number {{ return value.{selector}(s); }}
export function run(n:number):number {{
  const both=new Both();
  const numbers:Numeric[]=[both,new NumberA(),new NumberB()];
  const texts:Textual[]=[both,new TextA(),new TextB()];
  const at=(((n|0)%3)+3)%3;
  return numberCall(numbers[at],n)+textCall(texts[at],'abc');
}}
"
    )
}

#[test]
fn different_unused_role_tails_preserve_the_actual_function_type() {
    // Only the textual member selection changes. Both methods and their
    // bodies exist in both sources, and both return 34 at the observed input.
    execute("text");
    execute("read");
}

fn execute(selector: &str) {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = scratch::ScratchDir::new(&root.join("target/role-intersection-tests"), selector);
    std::fs::write(dir.join("main.ts"), source(selector)).unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = hir::prepare(&snapshot).unwrap();
    let readers = prepared
        .program
        .funcs
        .iter()
        .flat_map(|f| {
            f.blocks
                .iter()
                .flat_map(|block| &block.ops)
                .map(|id| f.value(*id))
        })
        .filter(|op| {
            matches!(
                &op.kind,
                hir::OpKind::Call {
                    callee: hir::Callee::Virtual { .. },
                    ..
                }
            )
        })
        .count();
    assert!(readers >= 2, "the test requires both virtual roles");
    if selector == "read" {
        assert_normalized_roles(&prepared.program);
    }
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    std::fs::write(dir.join("program.h"), &emitted.header).unwrap();
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(
        dir.join("caller.c"),
        "#include \"program.h\"\nint main(void){return run(0.0)==34.0 ? 0 : 2;}\n",
    )
    .unwrap();
    let linked = Command::new("clang")
        .current_dir(&dir)
        .args([
            "-std=c11",
            "-O1",
            "-g",
            "-fsanitize=function",
            "-fno-sanitize-recover=all",
            "-I.",
            "program.c",
            "caller.c",
            "nts_runtime.c",
            "-lm",
            "-o",
            "caller",
        ])
        .output()
        .unwrap();
    assert!(
        linked.status.success(),
        "{}",
        String::from_utf8_lossy(&linked.stderr)
    );
    let ran = Command::new(dir.join("caller")).output().unwrap();
    assert!(
        ran.status.success(),
        "{selector}: {} {}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(
        ran.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
}

fn assert_normalized_roles(program: &hir::Program) {
    let mut roles = Vec::new();
    for function in &program.funcs {
        for id in function.blocks.iter().flat_map(|b| &b.ops) {
            if let hir::OpKind::Call {
                callee: hir::Callee::Virtual { slot, declared },
                args,
                ..
            } = &function.value(*id).kind
            {
                roles.push((*slot, declared.as_str(), function.value(args[1]).ty.clone()));
            }
        }
    }
    let numeric = roles
        .iter()
        .find(|(_, _, ty)| *ty == hir::HirType::Float { bits: 64 })
        .unwrap();
    let textual = roles
        .iter()
        .find(|(_, _, ty)| *ty == hir::HirType::Managed(hir::ManagedType::String))
        .unwrap();
    let layout = program.layouts.iter().find(|l| l.name == "Both").unwrap();
    let numeric_name = layout.methods[numeric.0 as usize].as_deref().unwrap();
    let textual_name = layout.methods[textual.0 as usize].as_deref().unwrap();
    let numeric_body = program
        .funcs
        .iter()
        .find(|f| f.name == numeric_name)
        .unwrap();
    let textual_body = program
        .funcs
        .iter()
        .find(|f| f.name == textual_name)
        .unwrap();
    assert!(!std::ptr::eq(numeric_body, textual_body));
    assert_eq!(numeric_body.params[1].ty, numeric.2);
    assert_eq!(textual_body.params[1].ty, textual.2);
    assert_ne!(
        program.native_column(numeric.0),
        program.native_column(textual.0)
    );
    eprintln!("numeric={numeric:?} => {numeric_name}; textual={textual:?} => {textual_name}");
}
