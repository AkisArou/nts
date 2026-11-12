//! Physical class identities have one publisher before inventories and output.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use nts_core::hir::{Field, HirType, Layout, Program};
use nts_semantic_schema::{PropertyKey, TypeId};

mod common;
use crate::scratch;

fn class_project() -> (scratch::ScratchDir, Program) {
    use camino::Utf8Path;
    use nts_frontend_ts::Frontend;
    let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let dir = scratch::ScratchDir::new(&root.join("target/member-name-tests"), "class-owner");
    for module in ["left", "right"] {
        std::fs::create_dir_all(dir.join(module)).unwrap();
        std::fs::write(
            dir.join(format!("{module}/item.ts")),
            "export class Item { value: number = 42; }",
        )
        .unwrap();
    }
    std::fs::write(
        dir.join("main.ts"),
        "import {Item as Left} from './left/item.js';\n\
         import {Item as Right} from './right/item.js';\n\
         export function left(): Left { return new Left(); }\n\
         export function right(): Right { return new Right(); }\n\
         export function inspect(): number {\n\
           const value = new Left();\n\
           return (value instanceof Left ? 1 : 0) + (value instanceof Right ? 2 : 0);\n\
         }",
    )
    .unwrap();
    let config = dir.join("tsconfig.json");
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
    (dir, common::prepare(&snapshot).unwrap().program)
}

fn execute_java(dir: &camino::Utf8Path, emitted: nts_codegen_jvm::Emitted) {
    for class in emitted.classes {
        let file = dir.join(class.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, class.bytes).unwrap();
    }
    std::fs::write(dir.join("nts-runtime.jar"), nts_codegen_jvm::runtime_jar()).unwrap();
    std::fs::write(
        dir.join("Driver.java"),
        "public class Driver { public static void main(String[] args) {\n\
         if (nts.gen.Program.left().getClass() == nts.gen.Program.right().getClass())\n\
           throw new AssertionError(\"declaration identity\");\n\
         if (nts.gen.Program.inspect() != 1) throw new AssertionError(\"instanceof identity\");\n\
         System.out.println(42); } }",
    )
    .unwrap();
    for (label, args) in [
        ("javac", vec!["-cp", ".:nts-runtime.jar", "Driver.java"]),
        (
            "java",
            vec!["-Xverify:all", "-cp", ".:nts-runtime.jar", "Driver"],
        ),
    ] {
        let output = nts_codegen_jvm::toolchain::command(common::tool(label).unwrap())
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        std::fs::write(dir.join(format!("{label}.stdout")), &output.stdout).unwrap();
        std::fs::write(dir.join(format!("{label}.stderr")), &output.stderr).unwrap();
        assert!(
            output.status.success(),
            "{label}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        if label == "java" {
            assert_eq!(output.stdout, b"42\n");
        }
    }
}

#[test]
fn same_named_declarations_in_distinct_modules_keep_distinct_class_tokens() {
    let (dir, program) = class_project();
    let tokens: Vec<_> = program
        .layouts
        .iter()
        .flat_map(|layout| {
            program
                .classes_laid_out_as(layout)
                .into_iter()
                .filter(|class| class.name == "Item")
                .map(|class| {
                    (
                        class.symbol,
                        nts_codegen_jvm::types::identity_class_name("nts/gen", layout, class),
                    )
                })
        })
        .collect();
    assert_eq!(
        tokens.len(),
        2,
        "the actual source declarations must survive"
    );
    assert_ne!(tokens[0].0, tokens[1].0, "distinct producer declarations");
    assert_ne!(
        tokens[0].1, tokens[1].1,
        "declaration-specific class names must be injective"
    );
    for (module, (_, name)) in ["left", "right"].into_iter().zip(&tokens) {
        assert!(
            name.contains(module),
            "the source module must stay readable: {name}"
        );
    }
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    for (_, name) in tokens {
        assert_eq!(
            emitted
                .classes
                .iter()
                .filter(|class| class.binary_name == name)
                .count(),
            1
        );
    }
    execute_java(&dir, emitted);
}

#[test]
fn source_class_spelling_is_stable_and_escapes_module_paths_injectively() {
    let (_, program) = class_project();
    let (layout, class) = program
        .layouts
        .iter()
        .find_map(|layout| {
            program
                .classes_laid_out_as(layout)
                .into_iter()
                .find(|class| class.name == "Item")
                .map(|class| (layout, class))
        })
        .unwrap();
    let original = nts_codegen_jvm::types::identity_class_name("nts/gen", layout, class);
    let mut reordered = program.clone();
    reordered.funcs.reverse();
    let mut unrelated = reordered.funcs[0].clone();
    unrelated.name = "unrelated".to_owned();
    reordered.funcs.insert(0, unrelated);
    let same = reordered
        .classes
        .iter()
        .find(|other| other.symbol == class.symbol)
        .unwrap();
    let physical = reordered
        .layouts
        .iter()
        .find(|other| other.types == layout.types)
        .unwrap();
    assert_eq!(
        nts_codegen_jvm::types::identity_class_name("nts/gen", physical, same),
        original
    );
    let mut changed = class.clone();
    changed.symbol += 1000;
    changed.source.as_mut().unwrap().symbol = changed.symbol;
    assert_eq!(
        nts_codegen_jvm::types::identity_class_name("nts/gen", layout, &changed),
        original,
        "semantic table ordinals never enter the name"
    );
    let mut names = std::collections::BTreeSet::new();
    for module in [
        "left-item.ts",
        "left_item.ts",
        "a/b.ts",
        "a$2f$b.ts",
        "a.b.ts",
        "日本.ts",
    ] {
        changed.source.as_mut().unwrap().module = format!("nts-workspace:///{module}");
        assert!(
            names.insert(nts_codegen_jvm::types::identity_class_name(
                "nts/gen", layout, &changed
            )),
            "module escape collision for {module}"
        );
    }
    changed.source = None;
    changed.name = "Type7".to_owned();
    assert!(
        nts_codegen_jvm::types::identity_class_name("nts/gen", layout, &changed)
            .ends_with("__Type7"),
        "an unnamed/synthetic owner has its explicit producer name, never a guessed source"
    );
}

fn fixture(different: bool, distinct: bool) -> Program {
    let mut layouts: Vec<_> = [1, 2]
        .into_iter()
        .map(|id| Layout {
            name: if distinct && id == 2 {
                "Other"
            } else {
                "Repeated"
            }
            .into(),
            types: vec![TypeId(id)],
            fields: Vec::new(),
            methods: Vec::new(),
            interfaces: Vec::new(),
            base: None,
        })
        .collect();
    if different {
        layouts[1].fields.push(Field {
            name: PropertyKey::from("padding"),
            ty: HirType::NUMBER,
            written: None,
            declared_by: Some(TypeId(2)),
            readonly: false,
        });
    }
    Program {
        layouts,
        ..Program::default()
    }
}

#[test]
fn distinct_identities_stay_distinct() {
    let control = nts_codegen_jvm::emit(&fixture(false, true));
    assert!(control.is_complete(), "{:?}", control.diagnostics);
    for name in ["nts/gen/Repeated", "nts/gen/Other"] {
        assert_eq!(
            control
                .classes
                .iter()
                .filter(|class| class.binary_name == name)
                .count(),
            1,
            "distinct class identity {name}"
        );
    }
}

#[test]
fn different_physical_owners_are_named_and_no_ambiguous_program_is_published() {
    for different_fields in [false, true] {
        let emitted = nts_codegen_jvm::emit(&fixture(different_fields, false));
        assert!(
            emitted.classes.is_empty(),
            "a conflicting identity must not select either definition"
        );
        assert!(
            emitted
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "NTS4004"
                    && diagnostic.message.contains("nts/gen/Repeated")
                    && diagnostic.message.contains("different publication owners")),
            "{:?}",
            emitted.diagnostics
        );
    }
}
