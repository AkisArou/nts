//! How each kind of object prints (`hir::Program::printed`): the one table
//! every backend reads, `runtime/c` and LLVM off a descriptor's `to_string`
//! and the JVM through a generated `nts$print`. The examples check the text
//! against node; this checks the decision, including the one an example
//! cannot -- a function's text, which differs from node's on purpose.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Printed};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/printed/tsconfig.json")
        .canonicalize_utf8()
        .expect("the printed program is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// The answer for the layout named `name`.
fn printed<'p>(program: &'p hir::Program, name: &str) -> &'p Printed {
    program
        .printed
        .get(name)
        .unwrap_or_else(|| panic!("`{name}` has an answer: {:?}", program.printed))
}

#[test]
fn every_kind_of_object_prints_as_its_type_says() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP printed: tsgo is not built");
        return;
    };
    let program = &lowered.program;
    assert_eq!(printed(program, "Plain"), &Printed::Object);
    assert_eq!(
        printed(program, "Labelled"),
        &Printed::By("Labelled#toString".to_owned())
    );
    // The `Error` rule, written by the compiler for each error layout over
    // that layout's own fields: `Error`, `TypeError` and the rest can be
    // layouts with no base relation, so no one function can take them all.
    assert_eq!(
        printed(program, "Failure"),
        &Printed::By("Failure@toString".to_owned())
    );
    let failure = program
        .layouts
        .iter()
        .find(|layout| layout.name == "Failure")
        .and_then(|layout| layout.types.first().copied())
        .expect("Failure is laid out");
    let rule = program
        .funcs
        .iter()
        .find(|func| func.name == "Failure@toString")
        .expect("the rule a descriptor names is a function of the program");
    assert_eq!(
        rule.params.first().map(|param| &param.ty),
        Some(&hir::HirType::Managed(hir::ManagedType::Object(failure))),
        "and takes that layout, not a base it may not have"
    );
    // A closure: a function's text, which node would give as its source.
    let closures: Vec<&Printed> = program
        .layouts
        .iter()
        .filter(|layout| layout.types.iter().any(|ty| hir::is_closure_type(*ty)))
        .map(|layout| printed(program, &layout.name))
        .collect();
    assert!(!closures.is_empty(), "the program converts a closure");
    assert!(closures.iter().all(|answer| **answer == Printed::Function));
    // Refused by name: a tuple, and a literal whose own `toString` is a member
    // the runtime cannot name through a descriptor.
    let answers = |which: &dyn Fn(&hir::Layout) -> bool| -> Vec<&Printed> {
        program
            .layouts
            .iter()
            .filter(|layout| which(layout))
            .map(|layout| printed(program, &layout.name))
            .collect()
    };
    let tuples = answers(&|layout| hir::is_tuple_layout_name(&layout.name));
    let own = answers(&|layout| layout.fields.iter().any(|field| field.name == "toString"));
    for (what, found) in [("tuple", tuples), ("own toString member", own)] {
        assert!(!found.is_empty(), "the program converts a {what}");
        assert!(
            found.iter().all(|answer| **answer == Printed::Refused),
            "a {what} refuses: {found:?}"
        );
    }
}

/// Where the type settles how an object prints, the conversion is its direct
/// form (`printed::devirtualize`): a constant, a call of the one `toString`,
/// a typed join -- and never the runtime's descriptor dispatch, which every
/// answer would survive, so only this says the pass ran.
#[test]
fn a_conversion_the_type_settles_is_direct() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP printed: tsgo is not built");
        return;
    };
    let typed = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == "typed")
        .expect("`typed` is lowered");
    let calls: Vec<String> = typed
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            hir::OpKind::Call {
                callee: hir::Callee::Direct(name) | hir::Callee::External(name),
                ..
            } => Some(name.clone()),
            _ => None,
        })
        .collect();
    let constant = typed
        .values
        .iter()
        .any(|op| matches!(&op.kind, hir::OpKind::ConstString(text) if text == "[object Object]"));
    assert!(
        constant,
        "a class with no `toString` is a constant: {calls:?}"
    );
    for direct in [
        "Labelled#toString",
        "Failure@toString",
        "nts_array_join_num",
        "nts_array_join_str",
    ] {
        assert!(
            calls.iter().any(|call| call == direct),
            "`{direct}` is called directly: {calls:?}"
        );
    }
    assert!(
        !calls.iter().any(|call| call == "nts_value_to_string"),
        "and nothing goes through the runtime: {calls:?}"
    );
}
