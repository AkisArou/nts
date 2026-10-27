//! Which closures the JVM backend builds, and what an uncallable one answers.
//!
//! Frozen against hand-edited HIR rather than against a source construct that
//! lowering refuses today: a refusal is retired the day the feature lands, and
//! the shape these pin -- a value the arena keeps after every block dropped it,
//! a closure layout every body of which is gone -- is about the backend, not
//! about any one construct. The compiler lane's wave 6d059ae95 reached both
//! from a refused imported wrapper (2026-10-04); see fabc7730a.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::Frontend;

mod common;

/// Two closures stored as values at one signature, so each is a class under
/// the signature's callable base and is called through the uniform entry.
/// The second declares fewer parameters than the call passes, which is what
/// keeps the signature off `Program::typed_signatures`: with two that agree,
/// the call is typed, nothing calls the uniform entry, and prune removes it
/// (`TYPED_SOURCE`).
const SOURCE: &str = "const fs: Array<(x: number) => number> = [(x: number): number => x * 2, (): number => 1];\n\
                      export function run(n: number): number {\n  return fs[n & 1]!(n);\n}\n";

/// Two closures that agree with the signature they are stored at, so the call
/// through it is typed: `invokevirtual` of the signature class's own `call`.
const TYPED_SOURCE: &str = "const fs: Array<(x: number) => number> = [(x: number): number => x * 2, (x: number): number => x + 1];\n\
                            export function run(n: number): number {\n  return fs[n & 1]!(n);\n}\n";

/// The same, with one closure that can throw and a caller that catches: the
/// signature's root then has the raising uniform entry, `erased_call$raises`,
/// which `SOURCE`'s does not.
const RAISING_SOURCE: &str = "const fs: Array<(x: number) => number> = [\n\
                              (x: number): number => { if (x > 100) { throw new Error(\"big\"); } return x * 2; },\n\
                              (x: number): number => x + 1,\n];\n\
                              export function run(n: number): number {\n  try {\n    return fs[n & 1]!(n);\n  } catch (e) {\n    return -1;\n  }\n}\n";

fn lowered(name: &str) -> (hir::Program, std::path::PathBuf) {
    lowered_from(name, SOURCE)
}

fn lowered_from(name: &str, source: &str) -> (hir::Program, std::path::PathBuf) {
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
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot");
    let prepared = common::prepare(&snapshot).expect("prepared");
    (prepared.program, dir)
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
    let (mut dead, _) = lowered("dead");
    let (mut live, _) = lowered("live");
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
    let Some(said) = uncallable("uncallable", SOURCE, false, Entry::Uniform) else {
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
    let Some(said) = uncallable("uncallable-raising", RAISING_SOURCE, true, Entry::Uniform) else {
        return;
    };
    assert!(
        said.contains("erased_call$raises: nts: refused at run time: `Closure1` has no `erased_call$raises` to call"),
        "the raising stub refuses by name as the missing-feature abort: {said}"
    );
}

/// The typed entry's twin: under a signature the core calls typed, the call
/// is `invokevirtual` of the signature class's own `call`, so a closure under
/// it with no body is given a `call` that refuses by name, where it would
/// otherwise inherit the abstract one and be an `AbstractMethodError`.
#[test]
fn an_uncallable_closure_under_a_typed_signature_refuses_by_name() {
    let Some(said) = uncallable("uncallable-typed", TYPED_SOURCE, false, Entry::Typed) else {
        return;
    };
    assert!(
        said.contains("call: nts: refused at run time: `Closure1` has no `call` to call"),
        "the typed stub refuses by name as the missing-feature abort: {said}"
    );
}

/// Which entries a fixture's call reaches, asserted before anything is taken
/// away: the uniform-stub tests went vacuous the day the call they relied on
/// became typed and prune removed the uniform entry they called.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Entry {
    /// The call takes the uniform entries; no signature is typed.
    Uniform,
    /// The call takes a typed signature's own `call`.
    Typed,
}

/// Empty `Closure1`'s methods, emit, and call every entry of the kind `entry`
/// names from Java under `-Xverify:all`; what each one said, a line apiece.
/// `raising` asserts the fixture still has a `@raises` body, which is what
/// makes the root's raising entry.
fn uncallable(name: &str, source: &str, raising: bool, entry: Entry) -> Option<String> {
    let (mut program, dir) = lowered_from(name, source);
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
    assert_eq!(
        program.typed_signatures.is_empty(),
        entry == Entry::Uniform,
        "the fixture's typed signatures: {:?}",
        program.typed_signatures
    );
    let reached = match entry {
        Entry::Uniform => "m.getName().startsWith(\"erased_call\")",
        Entry::Typed => "m.getName().equals(\"call\")",
    };
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
    // A typed entry takes its parameters at their representations, narrowed
    // with the signature, so each argument is one of its parameter's type: a
    // primitive is zero, anything else `undefined`.
    std::fs::write(
        out.join("Drive.java"),
        format!(
            "public class Drive {{ public static void main(String[] a) throws Exception {{\n\
             Class<?> c = Class.forName(\"nts.gen.Closure1\");\n\
             Object it = c.getDeclaredConstructor().newInstance();\n\
             for (java.lang.reflect.Method m : c.getDeclaredMethods()) {{\n\
               if (!{reached}) continue;\n\
               Class<?>[] types = m.getParameterTypes();\n\
               Object[] args = new Object[types.length];\n\
               for (int i = 0; i < args.length; i++) args[i] = types[i] == double.class ? (Object) 0.0 : types[i] == int.class ? (Object) 0 : types[i] == long.class ? (Object) 0L : types[i] == boolean.class ? (Object) false : (Object) nts.rt.NtsValue.UNDEFINED_VALUE;\n\
               try {{ m.invoke(it, args); System.out.println(m.getName() + \" answered\"); }}\n\
               catch (java.lang.reflect.InvocationTargetException e) {{ System.out.println(m.getName() + \": \" + e.getCause().getMessage()); }}\n\
             }}\n}}}}\n"
        ),
    )
    .unwrap();
    let cp = format!("{}:{}", out.display(), jar.display());
    let compiled = nts_codegen_jvm::toolchain::command(&javac)
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
    let ran = nts_codegen_jvm::toolchain::command(&java)
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
        "no entry of a bodiless closure may answer: {said}"
    );
    Some(said)
}
