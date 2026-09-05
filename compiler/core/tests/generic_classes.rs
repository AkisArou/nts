//! A generic class is lowered once per instantiation, and never was.
//!
//! Every piece of the machinery existed: `copies_of` loops over
//! instantiations, `lower_method_of` takes one, `Substitution` maps the
//! parameters and `instantiation_suffix` names the copy. What was missing was
//! the ability to find the class's type **parameters**.
//!
//! [`hir::generics::instantiations`] groups the checker's types by declaring
//! symbol and then looks for the declaration among them, in order to zip its
//! arguments against each instantiation's. It only considered types that had
//! been *decomposed* — and `class Holder<T> { v: T }` is not, because `v` has
//! no width. So the declaration was never in the group, no declaration was
//! found, and `continue` dropped every instantiation with it. `copies_of` then
//! fell back to lowering the class as itself, where `T` has no representation,
//! and refused one member at a time.
//!
//! The three tests here pin three separate decisions, and each fails on its
//! own mutation:
//!
//! - the declaration joins its group even undecomposed
//! - **which** member of the group is the declaration
//! - a `static` member is one function, not one per copy
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, HirType, ManagedType};
use nts_frontend_ts::SemanticSource;

fn lowered(name: &str) -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{name} is checked in"));
    let snapshot = nts_frontend_ts::TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

fn names(lowered: &hir::lower::Lowered) -> Vec<&str> {
    lowered
        .program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .collect()
}

/// Every exported function of the fixture lowers, and nothing is refused.
///
/// The blunt one, and the one the feature is: before this change **all twelve**
/// were refused. It fails on the mutation that requires the declaration to have
/// been decomposed before it may join its own group.
#[test]
fn a_generic_class_is_lowered_once_per_instantiation() {
    let Some(lowered) = lowered("generic-classes") else {
        return;
    };
    assert_eq!(
        lowered.diagnostics, [],
        "no member of a generic class may be refused"
    );

    let names = names(&lowered);
    // A copy reaching a method it does **not** declare, which needs the copy to
    // have a base: the checker answers `getBaseTypes` for a declaration, and an
    // instantiation is a reference to one, so `Labelled<number>` has none of its
    // own. `origin` is on `Tagged` and overridden nowhere.
    assert!(
        names.contains(&"Tagged#origin"),
        "the inherited method is emitted, in {names:?}"
    );
    assert!(
        !names.iter().any(|name| name.contains("Labelled") && name.contains("#origin")),
        "and it is inherited rather than copied per instantiation, in {names:?}"
    );

    // Two instantiations of `Box`, at types of different width, each with its
    // own three members. A single erased copy would give three functions here
    // rather than six, and one layout for both.
    let boxes: Vec<&&str> = names
        .iter()
        .filter(|name| name.starts_with("Box<") && name.contains("#get"))
        .collect();
    assert_eq!(
        boxes.len(),
        4,
        "one `Box#get` per instantiation, in {names:?}"
    );

    // And the copies are distinct in the way that matters: `get` returns what
    // the instantiation put there, not an erased value.
    let returns: Vec<&HirType> = lowered
        .program
        .funcs
        .iter()
        .filter(|func| func.name.starts_with("Box<") && func.name.contains("#get"))
        .map(|func| &func.return_type)
        .collect();
    assert!(
        returns.iter().any(|ty| matches!(ty, HirType::Float { .. })),
        "the `Box<number>` copy returns a float, in {returns:?}"
    );
    assert!(
        returns
            .iter()
            .any(|ty| matches!(ty, HirType::Managed(ManagedType::String))),
        "the `Box<string>` copy returns a string, in {returns:?}"
    );
}

/// Which member of the group is the declaration is not decided by shape.
///
/// `widthOf<A, B>(entry: Entry<B, A>)` is declared before `class Entry<K, V>`,
/// so *two* types in the group have all-parameter arguments. Picking the wrong
/// one builds a substitution over `A` and `B`, which the class body never
/// mentions, and `key: K` is then a parameter of unrepresentable type.
///
/// Fails on the mutation that drops the declaration lookup and keeps only the
/// all-arguments-are-parameters search.
#[test]
fn the_declaration_is_the_class_declarations_own_type() {
    let Some(lowered) = lowered("generic-classes") else {
        return;
    };
    let constructor = lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name.starts_with("Entry<") && func.name.contains("#constructor"))
        .expect("`Entry` is instantiated once, at <number, string>");

    // `key: K` is the number and `value: V` is the string. A substitution built
    // against the wrong declaration either refuses these or reverses them, and
    // reversing them is the failure with no diagnostic.
    let parameters: Vec<&HirType> = constructor
        .params
        .iter()
        .skip(1)
        .map(|param| &param.ty)
        .collect();
    assert!(
        matches!(parameters.first(), Some(HirType::Float { .. })),
        "`key: K` is `number` here, in {parameters:?}"
    );
    assert!(
        matches!(
            parameters.get(1),
            Some(HirType::Managed(ManagedType::String))
        ),
        "`value: V` is `string` here, in {parameters:?}"
    );
}

/// A `static` member is one function however many copies the class has.
///
/// TypeScript forbids a static member from referencing a class type parameter,
/// so there is nothing for a substitution to change — and a call site writing
/// `Factory.of(n)` names no instantiation, so it could not pick a copy if there
/// were several. `Factory` is instantiated twice in the fixture.
///
/// Fails both ways: naming the static for a copy leaves the call with nothing
/// to reach, and emitting it per copy defines it twice.
#[test]
fn a_static_member_of_a_generic_class_is_emitted_once() {
    let Some(lowered) = lowered("generic-classes") else {
        return;
    };
    let names = names(&lowered);
    let statics: Vec<&&str> = names.iter().filter(|name| name.contains(".of")).collect();
    assert_eq!(
        statics,
        [&"Factory.of"],
        "one `Factory.of`, unqualified, in {names:?}"
    );

    // The instance members of the same class *are* per copy, so this is not the
    // whole class being named without its instantiation.
    let unwraps = names
        .iter()
        .filter(|name| name.starts_with("Factory<") && name.contains("#unwrap"))
        .count();
    assert_eq!(unwraps, 2, "one `Factory#unwrap` per copy, in {names:?}");
}

/// The shapes that have no instantiation to copy from are refused, not guessed.
///
/// Each export of the fixture must be refused, and the file says why for each:
/// a generic base at a type parameter, a generic method on a generic class, and
/// a class constructing itself at its own parameters.
#[test]
fn a_generic_class_with_no_copy_to_make_is_refused() {
    let Some(lowered) = lowered("generic-classes-unsupported") else {
        return;
    };
    // The member that cannot be copied, for each of the three. The exported
    // functions calling them survive this stage and are dropped by
    // `drop_callers_of_refused` afterwards, which is a later question than the
    // one here: what matters is that no body was emitted for a copy that could
    // not be made.
    let names = names(&lowered);
    for member in ["#read", "#map", "#swapped"] {
        assert!(
            !names.iter().any(|name| name.contains(member)),
            "`{member}` has no instantiation to copy from and must be refused, in {names:?}"
        );
    }
    // A `Boxed<T>` copy would need `Container<number>` as its base, and nothing
    // in the program names that type -- so the class contributes nothing at all
    // rather than a constructor with no base.
    assert!(
        !names.iter().any(|name| name.starts_with("Boxed")),
        "a generic base at a type parameter leaves no copy, in {names:?}"
    );
    assert!(
        !lowered.diagnostics.is_empty(),
        "a refusal says why, rather than silently emitting nothing"
    );
}
