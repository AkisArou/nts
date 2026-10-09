//! A signature no closure fills still has to declare what a call reaches.
//!
//! # The two halves, and why one of them hid the other
//!
//! `materialize` gives a type a layout because a *signature* mentions it, since
//! nothing constructs one. It walked an array's element and a promise's settled
//! value and stopped there, so `Map<string, Step>` and `Set<Step>` -- a table of
//! handlers, which is what shared source is made of -- answered `NTS2006 an
//! object type with no layout` and got no further.
//!
//! Walking into them produced the second half. A signature layout is empty
//! until something *implements* it: `relate_closures_to_signatures` iterates
//! closures, and a signature with no closure gets no `call` declaration. So a
//! materialized signature was a layout with a hole where its one method should
//! be.
//!
//! The C and LLVM backends compiled it and were right to: a closure call
//! dispatches through the receiver's own descriptor, so the static layout's
//! table is never read. The JVM has to name a method and a descriptor at the
//! call site, and refused with `NTS4001 a closure call through a slot its type
//! declares nothing for`. Two backends agreeing is not evidence when the thing
//! they agree about is one they never look at.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// A signature only a container mentions gets a layout.
///
/// `Weigh` appears exactly twice in that file: as a `Map`'s value type and as a
/// `Map`'s key type. `Blend` appears once, as a `Set`'s element type. Nothing
/// constructs either, so before `materialize_within` walked a map and a set
/// neither had a layout at all -- and a signature type with no layout is a call
/// the backend cannot emit.
///
/// # Asserted on the layouts rather than on the diagnostics
///
/// `NTS2006 an object type with no layout` is raised by the **C emitter**, not
/// by the lowering -- a layout is resolved where code is generated. So
/// `Lowered::is_complete` is true for a program that refuses, and a test
/// written against it passes with the walk removed. This one was, and it did.
#[test]
fn a_signature_only_a_container_mentions_gets_a_layout() {
    let Some(lowered) = lowered("keyed-closures") else {
        return;
    };
    let named: Vec<&str> = lowered
        .program
        .layouts
        .iter()
        .map(|layout| layout.name.as_str())
        .filter(|name| name.starts_with("Fn"))
        .collect();
    for wanted in ["Fn2__2", "Fn2_2__2", "Fn2_2_2__2"] {
        assert!(
            named.contains(&wanted),
            "`{wanted}` is named by a container's type and needs a layout: {named:?}",
        );
    }
    // And nothing was refused *by the lowering* either, which is a weaker claim
    // than it looks -- see above -- and is here so that a refusal appearing at
    // this stage is still noticed.
    assert!(
        lowered.is_complete(),
        "{:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>(),
    );
}

/// Every signature layout declares the entry its calls go through.
///
/// `Step` has three arrows and would have been declared anyway. `Weigh` and
/// `Blend` have none -- their layouts exist only because a `Map`'s value type
/// and a `Set`'s element type named them -- and they are the case this asserts.
#[test]
fn a_signature_with_no_closure_still_declares_its_call() {
    let Some(lowered) = lowered("keyed-closures") else {
        return;
    };
    let signatures: Vec<&hir::Layout> = lowered
        .program
        .layouts
        .iter()
        .filter(|layout| layout.name.starts_with("Fn") && layout.name.contains("__"))
        .collect();
    assert!(
        signatures.len() >= 3,
        "three function types in that file: {:?}",
        signatures.iter().map(|l| &l.name).collect::<Vec<_>>(),
    );
    for layout in signatures {
        let declared = layout.methods.iter().flatten().next().unwrap_or_else(|| {
            panic!(
                "`{}` declares nothing, so a call through it reaches no method",
                layout.name,
            )
        });
        let func = lowered
            .program
            .funcs
            .iter()
            .find(|func| &func.name == declared)
            .unwrap_or_else(|| {
                panic!("`{declared}` is named by a layout and is not in the program")
            });
        assert!(
            func.abstract_declaration,
            "`{declared}` is a declaration and must carry no body",
        );
    }
}

/// The declaration and the bodies that override it are one shape.
///
/// `Blend` is `(a: number, b: number, c: number) => number` and nothing in the
/// program constructs one, so before the erased entry existed the only
/// description of it anywhere was the call site's, reconstructed by
/// `declare_unfilled_signatures` -- and that test asserted the reconstruction: a
/// receiver and three doubles, returning a double.
///
/// **There is nothing to reconstruct now, and that is the point.** Every
/// signature-typed call is made in the uniform ABI, so the declaration's shape is
/// fixed rather than inferred, and the property worth pinning moved with it: the
/// declaration a signature layout carries and the entry a closure class fills it
/// with have to be the *same* shape, or an override is not an override and the
/// JVM says so at class load. `uniform_params` builds both for exactly that
/// reason, and this is the arm that fails if one side is edited alone.
#[test]
fn the_declaration_and_the_entries_that_override_it_are_one_shape() {
    let Some(lowered) = lowered("keyed-closures") else {
        return;
    };
    let (layout, declared) = lowered
        .program
        .layouts
        .iter()
        .find_map(|layout| {
            let declared = layout
                .methods
                .iter()
                .flatten()
                .find(|name| name.ends_with("#erased_call"))?;
            (layout.name == "Fn2_2_2__2").then_some((layout, declared))
        })
        .expect("the three-parameter signature has a layout and declares its erased call");
    let declaration = lowered
        .program
        .funcs
        .iter()
        .find(|func| &func.name == declared)
        .expect("the declaration is in the program");
    assert!(
        declaration.abstract_declaration,
        "`{declared}` is a declaration and must carry no body",
    );
    assert_eq!(declaration.return_type, HirType::Erased);

    // The receiver is the signature's own id, which is the only one a backend
    // can resolve a class from -- and the reason the two had to be matched by
    // signature rather than by identity in `relate_closures_to_signatures`.
    let receiver = &declaration.params[0].ty;
    let HirType::Managed(ManagedType::Object(ty)) = receiver else {
        panic!("the receiver is an object: {receiver:?}");
    };
    assert!(
        layout.types.contains(ty),
        "the receiver is typed as the signature's own id",
    );
    for param in &declaration.params[1..] {
        assert_eq!(param.ty, HirType::Erased, "every argument crosses erased");
    }

    // And the same shape a closure class's own entry has. Compared against a
    // real one rather than against a constant, because a constant here would be
    // this file's opinion of the ABI and the whole defect class is two
    // derivations of one fact.
    let filled = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name.starts_with("Closure") && func.name.ends_with("#erased_call"))
        .expect("`keyed-closures` has arrows, so some closure class fills the slot");
    assert_eq!(
        declaration.params.len(),
        filled.params.len(),
        "`{}` and `{}` are the same entry at two classes",
        declaration.name,
        filled.name,
    );
    assert_eq!(declaration.return_type, filled.return_type);
    for (declared, implemented) in declaration.params[1..].iter().zip(&filled.params[1..]) {
        assert_eq!(declared.ty, implemented.ty);
    }
}
