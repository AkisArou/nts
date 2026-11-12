//! Compiler protocols cannot capture an authored Java facade, even in a base.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::Frontend;
use nts_jvm_emitter::read;
use std::process::Command;

mod common;
use crate::scratch;

const SOURCE: &str = r"
export class Base {
  nts$print(): string { return 'authored'; }
  /* quoted protocol lookalike */
}
export class Derived extends Base {
  message: string = 'kept';
  toString(): string { return this.message; }
}
export function make(): Derived { return new Derived(); }
export function check(): string { return make().nts$print(); }
export function printed(): string { return String(make()); }
";

fn project(path: &Utf8Path, root: &Utf8Path, source: &str) -> Utf8PathBuf {
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("main.ts"), source).unwrap();
    let config = path.join("tsconfig.json");
    std::fs::write(
        &config,
        format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
    )
    .unwrap();
    config
}

#[test]
fn runtime_protocol_members_are_not_typescript_identifiers() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = scratch::ScratchDir::new(&root.join("target/member-name-tests"), "identifier");
    for (index, member) in nts_codegen_jvm::generated_members::SPECIMENS
        .iter()
        .enumerate()
    {
        let config = project(
            &dir.join(format!("role-{index}")),
            &root,
            &format!("export class Example {{ {member}(): number {{ return 7; }} }}"),
        );
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("the frontend must measure the identifier, not skip capture");
        assert!(
            snapshot.has_errors()
                && snapshot
                    .diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.code == "TS1127"),
            "generated member {member:?} must not parse as an authored identifier: {:?}",
            snapshot.diagnostics
        );
    }
}

#[test]
fn internal_body_names_keep_source_identity_across_function_order() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = scratch::ScratchDir::new(&root.join("target/member-name-tests"), "body-identity");
    let config = project(
        &dir,
        &root,
        "function helper(n: number): number { return n < 1 ? 1 : helper(n - 1) + 1; }\n\
         export function run(n: number): number { return helper(n); }",
    );
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let program = common::prepare(&snapshot).unwrap().program;
    let expected = format!("{}helper", nts_codegen_jvm::generated_members::BODY_PREFIX);
    let mut reordered = program.clone();
    reordered.funcs.reverse();
    let mut inserted = program.clone();
    let mut unrelated = inserted
        .funcs
        .iter()
        .find(|f| f.name == "helper")
        .unwrap()
        .clone();
    unrelated.name = "unrelated".to_owned();
    inserted.funcs.insert(0, unrelated);
    for variant in [&program, &reordered, &inserted] {
        nts_core::hir::verify::verify(variant).unwrap();
        let helper = variant.funcs.iter().find(|f| f.name == "helper").unwrap();
        let names = nts_codegen_jvm::JvmProgram::new(variant);
        assert_eq!(names.implementation_name(helper), expected);
        let emitted = nts_codegen_jvm::emit(variant);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        let class = emitted
            .classes
            .iter()
            .find(|c| c.binary_name == "nts/gen/Program")
            .unwrap();
        let class = read::class_file(&class.bytes).unwrap();
        assert!(class.methods.iter().any(|method| {
            method.name == expected
                && method.descriptor == "(D)D"
                && method
                    .code
                    .as_ref()
                    .is_some_and(|code| !code.bytes.is_empty())
        }));
    }
}

fn run(path: &Utf8Path, label: &str, command: &mut Command) -> Vec<u8> {
    let output = command.current_dir(path).output().unwrap();
    std::fs::write(path.join(format!("{label}.stdout")), &output.stdout).unwrap();
    std::fs::write(path.join(format!("{label}.stderr")), &output.stderr).unwrap();
    assert!(
        output.status.success(),
        "{label}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn an_unallocated_family_face_declares_the_catalogued_member() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = scratch::ScratchDir::new(&root.join("target/member-name-tests"), "family");
    let source = "interface Point { readonly x: number; }\n\
        export class Holder { padding: number = -1; x: number = 42; }\n\
        export function project(value: Point): number { return value.x; }\n\
        export function make(): Holder { return new Holder(); }\n\
        export function check(): number { return project(new Holder()); }";
    for (case, source) in [
        ("control", source.replace("value: Point", "value: Holder")),
        ("subject", source.to_owned()),
    ] {
        let path = dir.join(case);
        let config = project(&path, &root, &source);
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = common::prepare(&snapshot).unwrap();
        assert_eq!(prepared.program.refused_bodies().count(), 0);
        let emitted = nts_codegen_jvm::emit(&prepared.program);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        let mut call = String::new();
        if case == "subject" {
            let face = prepared
                .program
                .layouts
                .iter()
                .find(|layout| layout.name == "Point")
                .unwrap();
            let family = prepared
                .program
                .interface_access
                .families
                .iter()
                .find(|family| face.types.contains(&family.face))
                .unwrap();
            let slot = family.getter.slot as usize;
            assert!(face.methods.get(slot).is_none_or(Option::is_none));
            let member = nts_codegen_jvm::JvmProgram::new(&prepared.program)
                .dispatch_name(slot)
                .unwrap();
            for name in ["Point", "Point$Face", "Holder"] {
                let class = emitted
                    .classes
                    .iter()
                    .find(|class| class.binary_name == format!("nts/gen/{name}"))
                    .unwrap();
                let parsed = read::class_file(&class.bytes).unwrap();
                assert!(
                    parsed.methods.iter().any(|method| method.name == member
                        && method.descriptor == "()D"
                        && (name == "Point$Face"
                            || method
                                .code
                                .as_ref()
                                .is_some_and(|code| !code.bytes.is_empty()))),
                    "{name} must publish the actual catalogue definition {member}()D"
                );
            }
            call = format!(
                "if (((Number)nts.gen.Point$Face.class.getMethod({member:?}).invoke(nts.gen.Program.make())).doubleValue() != 42) throw new AssertionError(\"family call\");"
            );
        }
        for class in emitted.classes {
            let file = path.join(class.path());
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, class.bytes).unwrap();
        }
        std::fs::write(path.join("nts-runtime.jar"), nts_codegen_jvm::runtime_jar()).unwrap();
        std::fs::write(
            path.join("Driver.java"),
            format!(
                "public class Driver {{ public static void main(String[] args) throws Exception {{ {call} if (nts.gen.Program.check() != 42) throw new AssertionError(\"control\"); System.out.println(42); }} }}"
            ),
        )
        .unwrap();
        run(
            &path,
            "javac",
            nts_codegen_jvm::toolchain::command(common::tool("javac").expect("javac required"))
                .args(["-cp", ".:nts-runtime.jar", "Driver.java"]),
        );
        assert_eq!(
            run(
                &path,
                "java",
                nts_codegen_jvm::toolchain::command(common::tool("java").expect("java required"))
                    .args(["-Xverify:all", "-cp", ".:nts-runtime.jar", "Driver"]),
            ),
            b"42\n"
        );
    }
}

#[test]
fn authored_and_inherited_protocol_lookalikes_keep_their_facades() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = scratch::ScratchDir::new(&root.join("target/member-name-tests"), "facade");
    for (case, member) in [("control", "ordinary"), ("subject", "nts$print")] {
        let path = dir.join(case);
        let source = SOURCE.replace("nts$print", member).replace(
            "/* quoted protocol lookalike */",
            &format!(
                "'{}'(): string {{ return 'quoted'; }}",
                nts_codegen_jvm::types::PRINT
            ),
        );
        let config = project(&path, &root, &source);
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
        let prepared = common::prepare(&snapshot).unwrap();
        assert_eq!(prepared.program.refused_bodies().count(), 0);
        let emitted = nts_codegen_jvm::emit(&prepared.program);
        assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
        for name in ["Base", "Derived", "Program"] {
            let class = emitted
                .classes
                .iter()
                .find(|class| class.binary_name == format!("nts/gen/{name}"))
                .expect("every published class must actually survive emission");
            let parsed = read::class_file(&class.bytes).unwrap();
            let expected = match name {
                "Base" => member,
                "Derived" => nts_codegen_jvm::types::PRINT,
                _ => "check",
            };
            assert!(
                parsed.methods.iter().any(|method| method.name == expected
                    && method.descriptor == "()Ljava/lang/String;"
                    && method
                        .code
                        .as_ref()
                        .is_some_and(|code| !code.bytes.is_empty())),
                "{case}/{name} lacks the actual definition/signature of {expected}"
            );
        }
        for class in emitted.classes {
            let file = path.join(class.path());
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, class.bytes).unwrap();
        }
        std::fs::write(path.join("nts-runtime.jar"), nts_codegen_jvm::runtime_jar()).unwrap();
        std::fs::write(
            path.join("Driver.java"),
            format!(
                "public class Driver {{ public static void main(String[] args) {{\n\
                 System.out.println(nts.gen.Program.make().{member}());\n\
                 System.out.println(nts.gen.Program.check());\n\
                 System.out.println(nts.gen.Program.printed());\n\
                 System.out.println(nts.rt.NtsValue.valueToString(\
                 nts.rt.NtsValue.ofObject(nts.gen.Program.make())));\n\
                 System.out.println(nts.gen.Program.make().{}());\n\
                 }} }}\n",
                nts_codegen_common::symbols::jvm_member_name(nts_codegen_jvm::types::PRINT),
            ),
        )
        .unwrap();
        run(
            &path,
            "javac",
            nts_codegen_jvm::toolchain::command(common::tool("javac").expect("javac required"))
                .args(["-cp", ".:nts-runtime.jar", "Driver.java"]),
        );
        assert_eq!(
            run(
                &path,
                "java",
                nts_codegen_jvm::toolchain::command(common::tool("java").expect("java required"))
                    .args(["-Xverify:all", "-cp", ".:nts-runtime.jar", "Driver"]),
            ),
            b"authored\nauthored\nkept\nkept\nquoted\n"
        );
    }
}

#[test]
fn catalogue_sources_are_fresh_and_exclusive() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let output = Command::new("node")
        .args(["compiler/codegen/jvm/generate-members.ts", "--check"])
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn exclusivity_cannot_be_bypassed_by_a_literal_nul() {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let output = Command::new("node")
        .args(["--test", "compiler/codegen/jvm/member-scanner.test.ts"])
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn roles_and_exact_keys_have_disjoint_names() {
    use nts_codegen_jvm::generated_members as names;
    let mut all: std::collections::BTreeSet<String> = names::SPECIMENS
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    assert_eq!(all.len(), names::SPECIMENS.len());
    for key in [1, 16, usize::MAX] {
        for name in [
            names::storage_field(&key.to_string()),
            names::defined(&key.to_string()),
            names::global(&key.to_string()),
            names::body(&key.to_string()),
            names::guarded_dispatch(&key.to_string()),
            names::face_field(&key.to_string()),
            names::template(&key.to_string()),
        ] {
            assert!(all.insert(name));
        }
    }
    for key in [
        "",
        "a/b",
        "a.b",
        "a$b",
        "a$2f$b",
        "Parser#skipWhiteSpace",
        "Parser$23$skipWhiteSpace",
        "a¢b",
        "東京",
        "a\u{200c}b",
        "a\u{200d}b",
    ] {
        assert!(all.insert(names::body(key)));
        assert!(all.insert(names::global(key)));
        assert!(all.insert(names::closure(key)));
        assert!(all.insert(names::erased_closure(key)));
    }
    assert_eq!(
        names::body("Parser#skipWhiteSpace"),
        format!("{}Parser$23$skipWhiteSpace", names::BODY_PREFIX)
    );
    assert_eq!(names::body("東京"), format!("{}東京", names::BODY_PREFIX));
    for name in all {
        assert!(nts_codegen_common::symbols::dex_can_spell(&name));
        assert!(name.starts_with(names::PREFIX));
        assert_ne!(
            nts_codegen_common::symbols::jvm_member_name(&name),
            name,
            "generated names must never be remangled"
        );
    }
}
