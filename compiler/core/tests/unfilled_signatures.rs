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

/// Every signature layout declares its `call`, implemented or not.
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
            .unwrap_or_else(|| panic!("`{declared}` is named by a layout and is not in the program"));
        assert!(
            func.abstract_declaration,
            "`{declared}` is a declaration and must carry no body",
        );
    }
}

/// The declaration's shape comes from the call, so the two agree.
///
/// `Blend` is `(a: number, b: number, c: number) => number` and nothing in the
/// program constructs one, so the only description of it that exists is the
/// call site's. A receiver and three doubles, returning a double -- and the
/// receiver typed as the signature rather than as any closure, because there is
/// no closure to type it as.
#[test]
fn the_declaration_matches_the_call_that_needed_it() {
    let Some(lowered) = lowered("keyed-closures") else {
        return;
    };
    let (layout, declared) = lowered
        .program
        .layouts
        .iter()
        .find_map(|layout| {
            let declared = layout.methods.iter().flatten().next()?;
            (layout.name == "Fn2_2_2__2").then_some((layout, declared))
        })
        .expect("the three-parameter signature has a layout and declares its call");
    let func = lowered
        .program
        .funcs
        .iter()
        .find(|func| &func.name == declared)
        .expect("the declaration is in the program");
    assert_eq!(
        func.params.len(),
        4,
        "a receiver and three arguments: {:?}",
        func.params.iter().map(|p| &p.ty).collect::<Vec<_>>(),
    );
    assert_eq!(func.return_type, HirType::NUMBER);
    let receiver = &func.params[0].ty;
    let HirType::Managed(ManagedType::Object(ty)) = receiver else {
        panic!("the receiver is an object: {receiver:?}");
    };
    assert!(
        layout.types.contains(ty),
        "the receiver is typed as the signature's own id, which is the only one \
         a backend can resolve a class from",
    );
    for param in &func.params[1..] {
        assert_eq!(param.ty, HirType::NUMBER);
    }
}
