//! Actual source producers and emitted cache declarations share one identity.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use camino::Utf8Path;
use nts_core::hir::{self, StaticDeclaration, StaticValueKind};
use nts_frontend_ts::Frontend;
use nts_jvm_emitter::read;

use crate::test_common as common;
#[path = "../../../test-support/scratch.rs"]
mod scratch;

fn prepare(path: &Utf8Path, source: &str) -> hir::Program {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    std::fs::create_dir_all(path).unwrap();
    std::fs::write(path.join("main.ts"), source).unwrap();
    let config = path.join("tsconfig.json");
    std::fs::write(
        &config,
        format!("{{\"extends\":\"{root}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}"),
    )
    .unwrap();
    let snapshot = Frontend::new(&root)
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .unwrap();
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let prepared = common::prepare(&snapshot).unwrap();
    assert_eq!(
        prepared.program.refused_bodies().count(),
        0,
        "{:?}",
        prepared.program.uncompiled
    );
    prepared.program
}

fn named_function(program: &hir::Program, name: &str) -> nts_semantic_schema::TypeId {
    let found: Vec<_> = program.member_origins.values.iter().filter(|(_, value)| {
        matches!(value.kind, StaticValueKind::Function)
            && matches!(&value.declaration, StaticDeclaration::Named(source) if source.scopes.last().is_some_and(|scope| scope == name))
    }).map(|(&id, _)| id).collect();
    assert_eq!(
        found.len(),
        1,
        "one actual function value for {name}: {:?}",
        program.member_origins.values
    );
    found[0]
}

fn definitions(program: &hir::Program, id: nts_semantic_schema::TypeId) -> (String, String) {
    let facts = crate::JvmProgram::new(program);
    let ordinary = crate::closure_field(&facts, id).unwrap();
    let erased = crate::erased_field(&facts, id).unwrap();
    let emitted = crate::emit(program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .unwrap();
    let parsed = read::class_file(&class.bytes).unwrap();
    for name in [&ordinary, &erased] {
        assert_eq!(
            parsed
                .fields
                .iter()
                .filter(|field| field.name == *name)
                .count(),
            1,
            "actual unique cache definition {name}"
        );
    }
    (ordinary, erased)
}

fn directory(label: &str) -> scratch::ScratchDir {
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    scratch::ScratchDir::new(&root.join("target/member-source-tests"), label)
}

#[test]
fn closure_and_erased_cache_names_survive_unrelated_closure_insertion() {
    let dir = directory("cache-insertion");
    let source = "function saved(n: number): number { return n + 1; }\nexport function value(): unknown { return saved; }\nexport function check(): number { const callback = saved; return callback(41); }";
    let a = prepare(&dir, source);
    let original = named_function(&a, "saved");
    let b = prepare(
        &dir,
        &format!(
            "function unrelated(n: number): number {{ return n - 1; }}\nexport function extra(): unknown {{ return unrelated; }}\n{source}"
        ),
    );
    let inserted = named_function(&b, "saved");
    assert_ne!(
        original, inserted,
        "the control must move the actual closure ordinal"
    );
    let before = definitions(&a, original);
    let after = definitions(&b, inserted);
    println!(
        "CACHE_IDENTITY original={original:?} inserted={inserted:?} before={before:?} after={after:?}"
    );
    assert_eq!(before, after, "both cache roles retain source identity");
    assert!(before.0.contains("saved") && before.1.contains("saved"));
}

#[test]
fn missing_cache_source_fails_before_publication_and_restored_program_executes() {
    let dir = directory("cache-source");
    let mut program = prepare(
        &dir,
        "function saved(n: number): number { return n + 1; }\nexport function value(): unknown { return saved; }\nexport function check(): number { const callback = saved; return callback(41); }",
    );
    let id = named_function(&program, "saved");
    let owner = program.member_origins.values.remove(&id).unwrap();
    let missing = crate::emit(&program);
    assert!(
        missing.classes.is_empty(),
        "missing identity must publish no program"
    );
    assert!(
        missing
            .diagnostics
            .iter()
            .any(|d| d.code == "NTS4004" && d.message.contains("producer-owned source identity")),
        "{:?}",
        missing.diagnostics
    );
    program.member_origins.values.insert(id, owner);
    definitions(&program, id);
    let emitted = crate::emit(&program);
    for class in emitted.classes {
        let file = dir.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, class.bytes).unwrap();
    }
    std::fs::write(dir.join("nts-runtime.jar"), crate::runtime_jar()).unwrap();
    std::fs::write(dir.join("Driver.java"), "public class Driver { public static void main(String[] args) { if (nts.gen.Program.check() != 42) throw new AssertionError(\"value\"); if (nts.gen.Program.value() != nts.gen.Program.value()) throw new AssertionError(\"cache identity\"); System.out.println(42); } }").unwrap();
    for (tool, args) in [
        ("javac", vec!["-cp", ".:nts-runtime.jar", "Driver.java"]),
        (
            "java",
            vec!["-Xverify:all", "-cp", ".:nts-runtime.jar", "Driver"],
        ),
    ] {
        let output = crate::toolchain::command(common::tool(tool).unwrap())
            .args(args)
            .current_dir(&*dir)
            .output()
            .unwrap();
        std::fs::write(dir.join(format!("{tool}.stdout")), &output.stdout).unwrap();
        std::fs::write(dir.join(format!("{tool}.stderr")), &output.stderr).unwrap();
        assert!(
            output.status.success(),
            "{tool}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        if tool == "java" {
            assert_eq!(output.stdout, b"42\n");
        }
    }
}

#[test]
fn symbol_keys_keep_actual_binding_identity_instead_of_equal_descriptions() {
    let dir = directory("symbol-bindings");
    let program = prepare(
        &dir,
        "const left = Symbol('same');\nconst right = Symbol('same');\nexport class Pair { [left]: number = 17; [right]: number = 25; }\nexport function check(): number { const pair = new Pair(); return pair[left] + pair[right]; }",
    );
    let pair = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Pair")
        .unwrap();
    let names: Vec<_> = pair
        .fields
        .iter()
        .map(|field| super::property(&program, &field.name).unwrap())
        .collect();
    assert_eq!(names.len(), 2);
    assert_ne!(names[0], names[1]);
    assert!(
        names.iter().any(|key| key.contains("left"))
            && names.iter().any(|key| key.contains("right"))
    );
    let emitted = crate::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let facts = crate::JvmProgram::new(&program);
    let class_name = crate::types::class_name(crate::types::DEFAULT_PACKAGE, pair);
    let class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == class_name)
        .unwrap();
    let parsed = read::class_file(&class.bytes).unwrap();
    for at in 0..pair.fields.len() {
        let expected = crate::hierarchy::field_name(&facts, pair, at).unwrap();
        assert!(parsed.fields.iter().any(|field| field.name == expected));
    }
}

#[test]
fn generator_resume_uses_its_fixed_catalogue_role_in_actual_definitions() {
    let dir = directory("generator-resume");
    let program = prepare(
        &dir,
        "export function check(): number { const iter = (function* () { yield 42; })(); return iter.next().done ? 0 : 42; }",
    );
    let emitted = crate::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let definitions: Vec<_> = emitted
        .classes
        .iter()
        .flat_map(|class| {
            let parsed = read::class_file(&class.bytes).unwrap();
            parsed
                .methods
                .into_iter()
                .filter(|method| method.name == crate::generated_members::RESUME)
                .map(move |method| (class.binary_name.clone(), method))
        })
        .collect();
    assert!(
        !definitions.is_empty(),
        "a real generator must publish the catalogue resume method"
    );
    assert!(
        definitions.iter().any(|(_, method)| method.code.is_some()),
        "a resume body must be emitted"
    );
}

#[test]
fn a_missing_generator_protocol_fact_is_named_and_no_generator_needs_none() {
    let dir = directory("generator-source-fact");
    let mut program = prepare(
        &dir,
        "export function check(): number { const iter = (function* () { yield 42; })(); return iter.next().done ? 0 : 42; }",
    );
    assert!(program.member_origins.generator_resume.take().is_some());
    let emitted = crate::emit(&program);
    assert!(emitted.classes.is_empty());
    assert!(
        emitted
            .diagnostics
            .iter()
            .any(|error| error.code == "NTS4004"
                && error
                    .message
                    .contains("generator resume has no producer-owned slot identity")),
        "{:?}",
        emitted.diagnostics
    );
    let ordinary = prepare(&dir, "export function check(): number { return 42; }");
    assert!(ordinary.member_origins.generator_resume.is_none());
    let emitted = crate::emit(&ordinary);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
}
