//! The addon declares and calls the C producer's actual method receiver ABI.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use crate::scratch;
use camino::Utf8Path;
use nts_core::hir;
use nts_frontend_ts::Frontend;
use std::process::Command;

#[test]
fn addon_method_prototypes_match_the_c_definitions_and_call_them() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize_utf8()
        .unwrap();
    let dir = scratch::ScratchDir::new(&root.join("target/napi-entry-abi"), "method");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(r#"{{"extends":"{root}/tsconfig.fixtures.json","files":["main.ts"]}}"#),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), r"
export class Base { value:number; constructor(n:number){this.value=n;} get():number{return this.value;} }
export class Child extends Base { constructor(n:number){super(n);} get():number{return this.value+1;} }
export class Third extends Base { constructor(n:number){super(n);} get():number{return this.value+2;} }
export function go(n:number):number { const values:Base[]=[new Base(n),new Child(n),new Third(n)]; return values[(((n|0)%3)+3)%3].get(); }
").unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&dir.join("tsconfig.json"))
        .unwrap();
    assert!(!snapshot.has_errors());
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            roots: hir::reachable::Roots::EntrySurface,
            ..hir::Options::default()
        },
    )
    .unwrap();
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let plan = nts_codegen_c::EntryAbi::for_addon(&prepared.program);
    let emitted = nts_codegen_c::emit_planned(&plan, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let entries = emitted
        .published_entries(&plan)
        .expect("matching C publication");
    let addon = nts_codegen_napi::emit_published(&entries);
    assert!(addon.skipped.is_empty(), "{:?}", addon.skipped);
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    let witness = prototype_witness(&prepared.program, emitted.writer.text(), &addon.source);
    std::fs::write(dir.join("witness.c"), &witness).unwrap();
    assert!(
        check_witness(&dir),
        "C producer/addon prototypes must agree: {witness}"
    );
    let mutant = witness.replacen("NtsHeader *", "void *", 1);
    std::fs::write(dir.join("witness.c"), mutant).unwrap();
    assert!(
        !check_witness(&dir),
        "a changed receiver prototype must fail compilation"
    );
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    std::fs::write(dir.join("addon.c"), addon.source).unwrap();
    let headers = root.join("third_party/node-source/src");
    assert!(
        headers.join("node_api.h").exists(),
        "Node-API headers required"
    );
    let linked = Command::new("clang")
        .current_dir(&dir)
        .args(["-std=c11", "-O1", "-shared", "-fPIC", "-I.", "-I"])
        .arg(headers)
        .args([
            "program.c",
            "addon.c",
            "nts_runtime.c",
            "-lm",
            "-o",
            "probe.node",
        ])
        .output()
        .unwrap();
    assert!(
        linked.status.success(),
        "{}",
        String::from_utf8_lossy(&linked.stderr)
    );
    let ran = Command::new("node").args(["-e", "const a=require(process.argv[1]); if(new a.Base(7).get()!==7||new a.Child(7).get()!==8||new a.Third(7).get()!==9) throw Error('method answer');"]).arg(dir.join("probe.node")).output().unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
}

fn prototype_witness(program: &hir::Program, source: &str, addon: &str) -> String {
    let abi = nts_codegen_c::EntryAbi::new(program);
    let mut text = String::from("#include \"nts_runtime.h\"\n");
    for line in source
        .lines()
        .filter(|line| line.starts_with("typedef struct NtsObj_"))
    {
        text.push_str(line);
        text.push('\n');
    }
    let mut count = 0;
    for function in &program.funcs {
        if abi.receiver_type(function) != Some("NtsHeader *") {
            continue;
        }
        let symbol = nts_codegen_c::c_identifier(&function.name);
        let needle = format!("{symbol}(");
        let Some(declaration) = addon
            .lines()
            .find(|line| line.contains(&needle) && line.ends_with(';'))
        else {
            continue;
        };
        let definition = source
            .lines()
            .find(|line| line.contains(&needle) && line.ends_with(';'))
            .expect("actual C prototype");
        text.push_str(definition);
        text.push('\n');
        text.push_str(declaration);
        text.push('\n');
        count += 1;
    }
    assert!(
        count >= 3,
        "three concrete virtual method prototypes must be witnessed"
    );
    text
}

fn check_witness(dir: &Utf8Path) -> bool {
    Command::new("clang")
        .current_dir(dir)
        .args(["-std=c11", "-Werror", "-I.", "-fsyntax-only", "witness.c"])
        .output()
        .unwrap()
        .status
        .success()
}
