//! Which closures the JVM backend builds, and what an uncallable one answers.
//!
//! Frozen against hand-edited HIR rather than against a source construct that
//! lowering refuses today: a refusal is retired the day the feature lands, and
//! the shape these pin -- a value the arena keeps after every block dropped it,
//! a closure layout every body of which is gone -- is about the backend, not
//! about any one construct. The compiler lane's wave 6d059ae95 reached both
//! from a refused imported wrapper (2026-10-04); see fabc7730a.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

mod common;

/// Two closures stored as values at one signature, so each is a class under
/// the signature's callable base and is called through the uniform entry.
const SOURCE: &str = "const fs: Array<(x: number) => number> = [(x: number): number => x * 2, (x: number): number => x + 1];\n\
                      export function run(n: number): number {\n  return fs[n & 1]!(n);\n}\n";

/// The same, with one closure that can throw and a caller that catches: the
/// signature's root then has the raising uniform entry, `erased_call$raises`,
/// which `SOURCE`'s does not.
const RAISING_SOURCE: &str = "const fs: Array<(x: number) => number> = [\n\
                              (x: number): number => { if (x > 100) { throw new Error(\"big\"); } return x * 2; },\n\
                              (x: number): number => x + 1,\n];\n\
                              export function run(n: number): number {\n  try {\n    return fs[n & 1]!(n);\n  } catch (e) {\n    return -1;\n  }\n}\n";

fn lowered(name: &str) -> Option<(hir::Program, std::path::PathBuf)> {
    lowered_from(name, SOURCE)
}

fn lowered_from(name: &str, source: &str) -> Option<(hir::Program, std::path::PathBuf)> {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP dead_closures/{name}: NTS_TSGO is not set");
        return None;
    };
    let dir = std::env::temp_dir().join(format!("nts-dead-closures-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).unwrap();
    let fixtures = common::repository().join("tsconfig.fixtures.json");
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            "{{\"extends\": {:?}, \"include\": [\"src\"]}}\n",
            fixtures.display().to_string()
        ),
    )
    .unwrap();
    std::fs::write(dir.join("src/main.ts"), source).unwrap();
    let tsconfig = Utf8PathBuf::from_path_buf(dir.join("tsconfig.json")).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot");
    let prepared = hir::prepare_with(
        &snapshot,
        &hir::Options {
            provider: hir::Provider::NoGc,
            ..hir::Options::default()
        },
    )
    .expect("prepared");
    Some((prepared.program, dir))
}

fn closure_type(program: &hir::Program, layout: &str) -> nts_semantic_schema::TypeId {
    program
        .layouts
        .iter()
        .find(|l| l.name == layout)
        .expect("the closure layout")
        .types[0]
}

/// Append a `ClosureStatic` of `Closure0` to `module#init`'s arena; when `live`,
/// also hold it in the entry block and have the first `array.set` store it.
fn with_closure_static(program: &mut hir::Program, live: bool) {
    let ty = closure_type(program, "Closure0");
    let init = program
        .funcs
        .iter_mut()
        .find(|f| f.name == "module#init")
        .expect("module#init");
    let origin = init.values[0].origin.clone();
    let id = hir::ValueId(u32::try_from(init.values.len()).unwrap());
    init.values.push(hir::Op {
        kind: hir::OpKind::ClosureStatic,
        ty: hir::HirType::Managed(hir::ManagedType::Object(ty)),
        origin,
    });
    if live {
        let entry = &mut init.blocks[0];
        let at = entry
            .ops
            .iter()
            .position(|v| matches!(init.values[v.0 as usize].kind, hir::OpKind::ArraySet { .. }))
            .expect("an array.set");
        let set = entry.ops[at];
        entry.ops.insert(at, id);
        if let hir::OpKind::ArraySet { value, .. } = &mut init.values[set.0 as usize].kind {
            *value = id;
        }
    }
}

fn program_class(program: &hir::Program) -> Vec<u8> {
    let emitted = nts_codegen_jvm::emit(program);
    emitted
        .classes
        .iter()
        .find(|c| c.path().ends_with("nts/gen/Program.class"))
        .expect("Program")
        .bytes
        .clone()
}

fn names(bytes: &[u8], needle: &str) -> bool {
    bytes.windows(needle.len()).any(|w| w == needle.as_bytes())
}

/// The arena keeps a value after every block has dropped it, and building a
/// singleton for one allocated, in `<clinit>`, an instance nothing executable
/// does. The control holds the same op in a block and reads it.
#[test]
fn a_closure_static_no_block_holds_gets_no_singleton() {
    let Some((mut dead, _)) = lowered("dead") else {
        return;
    };
    let Some((mut live, _)) = lowered("live") else {
        return;
    };
    with_closure_static(&mut dead, false);
    with_closure_static(&mut live, true);
    assert!(
        !names(&program_class(&dead), "closure$Closure0"),
        "an excised ClosureStatic built a singleton"
    );
    assert!(
        names(&program_class(&live), "closure$Closure0"),
        "the control: a held, read ClosureStatic builds one"
    );
}

/// A closure layout every body of which is gone, under a callable base: each
/// uniform entry exists and refuses by name, rather than being left abstract
/// (an `AbstractMethodError`) or bridged to a body it does not have.
#[test]
fn an_uncallable_closure_refuses_by_name() {
    let Some(said) = uncallable("uncallable", SOURCE, false) else {
        return;
    };
    assert!(
        said.contains(
            "erased_call: nts: refused at run time: `Closure1` has no `erased_call` to call"
        ),
        "the stub refuses by name as the missing-feature abort: {said}"
    );
}

/// The raising entry's sibling: its refusal is a separate stub, and a fixture
/// without a raising body would leave it untested while the test above passed.
/// So the fixture's raising body is asserted before it is taken away.
#[test]
fn an_uncallable_closure_refuses_its_raising_entry_by_name() {
    let Some(said) = uncallable("uncallable-raising", RAISING_SOURCE, true) else {
        return;
    };
    assert!(
        said.contains("erased_call$raises: nts: refused at run time: `Closure1` has no `erased_call$raises` to call"),
        "the raising stub refuses by name as the missing-feature abort: {said}"
    );
}

/// Empty `Closure1`'s methods, emit, and call every uniform entry it has from
/// Java under `-Xverify:all`; what each one said, a line apiece. `raising`
/// asserts the fixture still has a `@raises` body, which is what makes the
/// root's raising entry.
fn uncallable(name: &str, source: &str, raising: bool) -> Option<String> {
    let (mut program, dir) = lowered_from(name, source)?;
    let Some(java) = common::tool("java") else {
        eprintln!("SKIP dead_closures/{name}: no JDK");
        return None;
    };
    let javac = common::tool("javac").expect("javac beside java");
    let raises = program.funcs.iter().any(|f| f.name.ends_with("@raises"));
    assert_eq!(
        raises,
        raising,
        "the fixture's raising bodies: {:?}",
        program.funcs.iter().map(|f| &f.name).collect::<Vec<_>>()
    );
    for layout in program.layouts.iter_mut().filter(|l| l.name == "Closure1") {
        layout.methods.iter_mut().for_each(|m| *m = None);
    }
    let emitted = nts_codegen_jvm::emit(&program);
    let out = dir.join("out");
    for class in &emitted.classes {
        let path = out.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    std::fs::write(
        out.join("Drive.java"),
        "public class Drive { public static void main(String[] a) throws Exception {\n\
         Class<?> c = Class.forName(\"nts.gen.Closure1\");\n\
         Object it = c.getDeclaredConstructor().newInstance();\n\
         for (java.lang.reflect.Method m : c.getDeclaredMethods()) {\n\
           if (!m.getName().startsWith(\"erased_call\")) continue;\n\
           Object[] args = new Object[m.getParameterCount()];\n\
           java.util.Arrays.fill(args, nts.rt.NtsValue.UNDEFINED_VALUE);\n\
           try { m.invoke(it, args); System.out.println(m.getName() + \" answered\"); }\n\
           catch (java.lang.reflect.InvocationTargetException e) { System.out.println(m.getName() + \": \" + e.getCause().getMessage()); }\n\
         }\n}}\n",
    )
    .unwrap();
    let cp = format!("{}:{}", out.display(), jar.display());
    let compiled = Command::new(&javac)
        .args(["-cp", &cp, "-d"])
        .arg(&out)
        .arg(out.join("Drive.java"))
        .output()
        .unwrap();
    assert!(
        compiled.status.success(),
        "{}",
        String::from_utf8_lossy(&compiled.stderr)
    );
    let ran = Command::new(&java)
        .args(["-Xverify:all", "-cp", &cp, "Drive"])
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout).into_owned();
    assert!(
        ran.status.success(),
        "{said}{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(
        !said.contains("answered"),
        "no uniform entry of a bodiless closure may answer: {said}"
    );
    Some(said)
}
