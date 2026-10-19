//! An interface inheriting fields splits along its declared chain: the
//! child's companion extends the parent's, an ancestor with no holder of
//! its own splits for its descendant's sake, and a concrete parent keeps
//! the floor. Execution against node is the shared fixture's
//! (`tests/programs/inherited-interface-fields`); this pins the facts
//! settlement derives from the declared graph.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{Layout, Program};
use nts_frontend_ts::{SemanticSource, TsgoApi};
use nts_jvm_emitter::Class;

fn prepared() -> Program {
    let tsgo = nts_frontend_ts::tsgo::locate().expect("tsgo is built");
    let config = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/inherited-faces/tsconfig.json")
        .canonicalize_utf8()
        .expect("checked-in fixture");
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).unwrap();
    nts_core::hir::prepare(&snapshot)
        .expect("valid HIR")
        .program
}

/// The layouts an interface declaration's instantiations live in.
fn layouts_of<'p>(program: &'p Program, identity_name: &str) -> Vec<&'p Layout> {
    let mut found: Vec<&Layout> = Vec::new();
    for identity in &program.interface_identities {
        if identity.name != identity_name {
            continue;
        }
        for id in &identity.types {
            if let Some(layout) = program.layout(*id)
                && !found.iter().any(|seen| std::ptr::eq(*seen, layout))
            {
                found.push(layout);
            }
        }
    }
    found
}

fn layout_of<'p>(program: &'p Program, identity_name: &str) -> &'p Layout {
    let found = layouts_of(program, identity_name);
    assert_eq!(found.len(), 1, "{identity_name} layouts: {}", found.len());
    found[0]
}

fn class<'c>(classes: &'c [Class], suffix: &str) -> &'c Class {
    classes
        .iter()
        .find(|class| class.path().ends_with(suffix))
        .unwrap_or_else(|| panic!("no class at {suffix}"))
}

#[test]
fn declared_ancestry_splits_the_chain_and_keeps_concrete_floors() {
    let program = prepared();
    let facts = nts_codegen_jvm::JvmProgram::new(&program);
    let parent = layout_of(&program, "Parent");
    let child = layout_of(&program, "WithParent");
    let middle = layout_of(&program, "Middle");
    let diamond = layout_of(&program, "Diamond");
    let concrete = layout_of(&program, "ChildOfClass");

    let same = |a: &[&Layout], b: &[&Layout]| {
        a.len() == b.len()
            && a.iter()
                .zip(b)
                .all(|(left, right)| std::ptr::eq(*left, *right))
    };
    assert!(same(&facts.declared_parents(child), &[parent]));
    assert!(same(&facts.declared_parents(middle), &[child]));
    assert_eq!(facts.declared_parents(diamond).len(), 2, "both arms");
    for face in [parent, child, middle, diamond] {
        assert!(facts.declared_proved(face), "{}", face.name);
        assert!(facts.is_split(face), "{}", face.name);
    }
    // Both generic instantiations and their children split, under
    // distinct layouts.
    let boxes = layouts_of(&program, "Box");
    assert_eq!(boxes.len(), 2, "Box<number> and Box<string>");
    for face in boxes
        .into_iter()
        .chain(layouts_of(&program, "NumBox"))
        .chain(layouts_of(&program, "StrBox"))
    {
        assert!(facts.is_split(face), "{}", face.name);
    }
    // A concrete parent is no declared interface chain: the floor stands.
    assert!(!facts.declared_proved(concrete));
    assert!(facts.declared_parents(concrete).is_empty());

    let emitted = nts_codegen_jvm::emit(&program);
    assert!(
        emitted.diagnostics.is_empty(),
        "{:?}",
        emitted
            .diagnostics
            .iter()
            .map(|d| format!("{} {}", d.code, d.message))
            .collect::<Vec<_>>()
    );
    // The child's companion names the parent's as a superinterface.
    let needle = b"Parent$Face";
    let child_face = class(&emitted.classes, "WithParent$Face.class");
    assert!(
        child_face
            .bytes
            .windows(needle.len())
            .any(|window| window == needle),
        "WithParent$Face extends Parent$Face"
    );
}
