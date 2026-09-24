//! What a program does with the fields of an interface-typed value.
//!
//! Runs the frontend, so it skips only when `tsgo` is not built.
//!
//! The fixture is deliberately two files. "Is this receiver's type an
//! interface" goes through the symbol's declarations, and an import names an
//! alias that carries none of them — so a one-file fixture could not tell a
//! census that follows the alias from one that happened to be looking at the
//! declaration already.
//!
//! Every assertion here is an exact count rather than a bound. The census's
//! whole output is a number, and a test that accepted "at least one" would pass
//! over a rule that fired twice.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::receivers::{self, Access, Census, Form, Shape, Site};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn counted() -> Option<Census> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/receivers/tsconfig.json")
        .canonicalize_utf8()
        .expect("the receivers fixture is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(receivers::classify(&snapshot))
}

/// Every access to a member of that name. Each member is used once in the
/// fixture, so this is the access a case is about.
fn of<'a>(census: &'a Census, member: &str) -> Vec<&'a Site> {
    census
        .sites
        .iter()
        .filter(|site| site.member == member)
        .collect()
}

fn only<'a>(census: &'a Census, member: &str) -> &'a Site {
    let found = of(census, member);
    assert_eq!(found.len(), 1, "expected one access to {member}");
    found[0]
}

/// A dot through an interface-typed parameter. The base case, and the one every
/// other case is measured against.
#[test]
fn a_dotted_read_through_an_interface_is_one_access() {
    let Some(census) = counted() else { return };
    let site = only(&census, "forDots");
    assert_eq!(site.shape, Shape::Interface);
    assert_eq!(site.access, Access::Read);
    assert_eq!(site.form, Form::Dotted);
    assert_eq!(site.receiver, "Named");
    assert_eq!(site.owner, "dotted");
}

/// A literal key is a named field at a fixed offset, so it costs what a dot
/// costs.
///
/// `hir::lower`'s `names_a_property` routes `v["forKeys"]` into
/// `lower_property_access`, so a census that skipped element accesses would
/// undercount by exactly the reads a literal key performs.
#[test]
fn a_literal_key_names_a_field() {
    let Some(census) = counted() else { return };
    let site = only(&census, "forKeys");
    assert_eq!(site.shape, Shape::Interface);
    assert_eq!(site.form, Form::Keyed);
}

/// A computed index names no field, so it is not an access at all.
///
/// The pair with the case above is the point: the discrimination is the index's
/// *type* and not its text. Getting it backwards is what refused `Buffer.from`
/// and, under it, the whole of `string_decoder`.
#[test]
fn a_computed_index_names_no_field() {
    let Some(census) = counted() else { return };
    assert!(
        of(&census, "i").is_empty(),
        "a variable index is not a member name"
    );
    // `v.anything` on the same table is the dotted half, excluded for being a
    // table rather than for naming nothing.
    assert_eq!(census.excluded.index_signature, 1);
    assert!(of(&census, "anything").is_empty());
}

/// `const { forOne, forTwo } = v` is two field reads and zero property accesses.
///
/// The form a census keyed on `PROPERTY_ACCESS_EXPRESSION` loses entirely, which
/// is most of what `runtime/node` does with an options object.
#[test]
fn destructuring_reads_one_field_per_named_element() {
    let Some(census) = counted() else { return };
    for member in ["forOne", "forTwo"] {
        let site = only(&census, member);
        assert_eq!(site.form, Form::Destructured);
        assert_eq!(site.shape, Shape::Interface);
        assert_eq!(site.access, Access::Read);
    }
}

/// A spread reads the whole layout, so it is a multiplier and not a site.
///
/// Seven, because `Named` declares seven stored members. It is kept out of the
/// site list on purpose: adding one spread to a site total mixes a count of
/// places with a count of fields, which is the unit error this census is most
/// likely to be quoted as making.
#[test]
fn a_spread_reads_every_stored_field() {
    let Some(census) = counted() else { return };
    assert_eq!(census.spread_sites.len(), 1);
    let spread = &census.spread_sites[0];
    assert_eq!(spread.fields, 7);
    assert_eq!(spread.shape, Shape::Interface);
    assert_eq!(spread.form, Form::Spread);
    assert!(
        census.sites.iter().all(|site| site.form != Form::Spread),
        "a spread must not appear in the site list"
    );
}

/// A method is dispatched and an accessor is a call. Neither is storage.
///
/// The one-liner that record 0331 reverted turned on exactly this distinction,
/// so a census that could not make it would be measuring the wrong thing. The
/// *type* cannot make it either: `describe(): string` and
/// `describe: () => string` declare members of the same type.
#[test]
fn a_method_and_an_accessor_are_not_field_accesses() {
    let Some(census) = counted() else { return };
    assert!(of(&census, "describe").is_empty());
    assert!(of(&census, "derived").is_empty());
    assert_eq!(census.excluded.not_stored, 2);
    // The control: a field declared beside them is counted, so the exclusion is
    // the member's kind and not the interface it belongs to.
    assert_eq!(only(&census, "stored").shape, Shape::Interface);
}

/// `v.forStrings.length` is one access, not two.
///
/// The receiver of `.length` is a `string`, which is not a generated struct. If
/// this ever reads two, the census is answering about the expression's own type
/// rather than about its receiver's.
#[test]
fn a_read_through_a_string_is_not_a_field_access() {
    let Some(census) = counted() else { return };
    assert_eq!(only(&census, "forStrings").shape, Shape::Interface);
    assert!(of(&census, "length").is_empty());
    assert_eq!(census.excluded.not_a_struct, 1);
}

/// A write costs what a read costs, and a compound assignment is one access.
///
/// `FieldSet` goes through the same offset, so reporting only reads because the
/// blocker's sentence says "field read" would understate the cost. And
/// `v.forCompound += 1` both loads and stores at one place: counting it as a
/// read plus a write would double one access.
#[test]
fn a_write_is_counted_and_a_compound_assignment_once() {
    let Some(census) = counted() else { return };
    assert_eq!(only(&census, "forWriting").access, Access::Write);
    assert_eq!(only(&census, "forCompound").access, Access::ReadModifyWrite);
}

/// The bracket's two arms answer differently on the same program.
///
/// Neither proxy is the real relation — record 0294 rules that set out of reach
/// — so what a test can check is that they *disagree*, which is what makes them
/// a bracket rather than one number printed twice.
#[test]
fn the_two_inhabitability_proxies_disagree() {
    let Some(census) = counted() else { return };
    // `Sayer implements Declared`, so the heritage clause finds it. Read
    // through the interface, not the constructor's write through `this`.
    let declared = of(&census, "declaredField")
        .into_iter()
        .find(|site| site.shape == Shape::Interface)
        .expect("the interface read");
    assert!(declared.implemented);
    // `Quiet` covers every member of `Named` and says nothing about it: visible
    // to the structural proxy and invisible to the declared one. This is the
    // case `examples/a-structural-cast-that-is-a-prefix` crashes on, so a
    // narrow rule keyed on `implements` would not have spared it.
    let dots = only(&census, "forDots");
    assert!(dots.satisfied);
    assert!(!dots.implemented);
    // Nothing covers `Uninhabitable`, which is the only shape a narrow rule
    // could safely leave at a fixed offset.
    let nobody = only(&census, "nobodyHasThis");
    assert!(!nobody.satisfied);
    assert!(!nobody.implemented);
    assert!(
        census.through_implemented() < census.through_satisfied(),
        "the arms must bracket rather than coincide"
    );
}

/// The sound figure is smaller than the broad one and larger than zero.
///
/// This is the number the design decision needs, and it is neither arm of the
/// bracket: every interface a class could inhabit **by member name**, plus any
/// the proxies could not examine. Names over-approximate real assignability, so
/// the set is safe; an unexamined interface joins it rather than being read as
/// uninhabitable.
///
/// `Named` is covered by `Quiet` without either saying so, and `Declared` is
/// named in `Sayer`'s heritage clause, so both are in. `Mixed` and
/// `Uninhabitable` are in no class, so they are out — and they are what makes
/// this assertion a check rather than a restatement of `through_interfaces`.
#[test]
fn the_sound_narrow_figure_is_between_zero_and_the_broad_one() {
    let Some(census) = counted() else { return };
    let sound = census.through_possibly_inhabited();
    assert_eq!(sound, 8);
    assert!(sound < census.through_interfaces());
    assert!(sound > census.through_implemented());
    // Nothing unexamined here, so the sound set is exactly the structural one.
    assert_eq!(sound, census.through_satisfied());
    assert_eq!(census.excluded.interfaces_unexamined, 0);
    // And the figure is only sound while every class was examined: an
    // unexamined class could inhabit anything. This is the precondition the
    // number rests on, so it is asserted rather than assumed.
    assert_eq!(census.excluded.classes_unexamined, 0);
}

/// A class receiver reads at a fixed offset today and would keep doing so.
#[test]
fn a_class_receiver_is_not_in_the_numerator() {
    let Some(census) = counted() else { return };
    assert_eq!(only(&census, "ownToItself").shape, Shape::ClassInstance);
}

/// A constructor's `this.field = v` is a field access.
///
/// `this` is a type parameter constrained to its class, so the first version of
/// this pass counted none of them: the numerator was right and the
/// **denominator** was short by every write a constructor makes, which inflated
/// the one percentage the census exists to produce.
#[test]
fn a_write_through_this_is_counted() {
    let Some(census) = counted() else { return };
    // Two accesses to the one name: `Sayer`'s constructor writes it through
    // `this`, and `declared` reads it through the interface. The pair is what
    // makes this a check -- a census blind to `this` reports only the read.
    let both = of(&census, "declaredField");
    assert_eq!(both.len(), 2);
    let through_this = both
        .iter()
        .find(|site| site.access == Access::Write)
        .expect("the constructor's write");
    assert_eq!(through_this.shape, Shape::ClassInstance);
    assert_eq!(through_this.receiver, "Sayer");
    assert!(
        both.iter().any(|site| site.shape == Shape::Interface),
        "and the interface read beside it"
    );
}

/// The totals, so a change to any rule above moves a number here too.
#[test]
fn the_totals_are_what_the_cases_add_up_to() {
    let Some(census) = counted() else { return };
    assert_eq!(census.total_fields(), 13);
    assert_eq!(census.through_interfaces(), 10);
    assert_eq!(census.through(Shape::ClassInstance), 2);
    assert_eq!(census.distinct_interface_members(), 10);
}

/// The two denominators differ, which is the whole reason there are two.
///
/// `Math.PI` is a library receiver: it reads no slot this program lays out, so
/// counting it dilutes the share. A library *interface* inhabited by a literal we
/// built would read at a fixed offset and belong in it, and nothing here can tell
/// the two apart — a symbol with no declaration in the decoded set says nothing
/// about which it is. So the true share lies between the two, and this asserts
/// they are actually distinct rather than one number printed twice.
#[test]
fn the_library_bucket_gives_a_second_denominator() {
    let Some(census) = counted() else { return };
    assert_eq!(census.through(Shape::Library), 1);
    assert_eq!(census.generated_fields(), 12);
    assert!(census.generated_fields() < census.total_fields());
}

/// A module member is not a field access, so it must not reach the denominator.
///
/// `names_a_property` states it: "A module's member is not one: there is no
/// receiver, so a call through it is a plain call and an access is a plain
/// name." Found by this census's own `unclear` row, which read 305 in
/// `runtime/node` and turned out to be module namespaces rather than
/// undecomposed types -- 170 of them `zlib/src/constants`.
///
/// The paired assertion is the one that matters: the access is **counted as an
/// exclusion** and the total is unchanged, so this distinguishes "excluded" from
/// "never looked at".
#[test]
fn a_module_member_is_not_a_field_access() {
    let Some(census) = counted() else { return };
    assert_eq!(census.excluded.module_member, 1);
    assert!(of(&census, "LIMIT").is_empty());
    assert_eq!(census.total_fields(), 13);
}

/// **The density control**, and the reason this census may key on receiver
/// expressions at all.
///
/// `schema.rs` calls `node_types` "sparse on purpose", which would make a
/// receiver census undercount in proportion to what the lowering happened to ask
/// about — error correlated with subject. `resolve_types` says the opposite:
/// "a type for every addressable node of one file". This asserts which is true
/// rather than believing either, and it is the assertion that would fail first
/// if the frontend ever narrowed what it resolves.
#[test]
fn every_receiver_carries_a_type() {
    let Some(census) = counted() else { return };
    assert_eq!(census.excluded.untyped_receiver, 0);
    assert_eq!(census.excluded.member_not_declared, 0);
}
