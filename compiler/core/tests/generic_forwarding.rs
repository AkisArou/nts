//! A call written in a generic copy names its callee's copy through that copy's
//! own type arguments, never through the declared constraint (#896).
//!
//! `outer<T extends Box>(r: T) { return call(r) }` instantiated at an `Other`
//! that matches `Box` only structurally named `call<Box>` in `outer<Other>`:
//! `generics::unify` resolved `outer`'s `T` to its constraint before deferring,
//! so the call was pinned once for every copy of `outer`, and a `Box` copy was
//! handed an `Other`. Each test here fails on that mutation: restore the
//! constraint for declared parameters and every forwarded call names the
//! bound's copy again.
//!
//! The one parameter that still stands for its constraint is one no generic
//! declares, the polymorphic `this`, which keeps
//! `tests/programs/a-generic-called-with-this` compiling.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, Func, OpKind};

fn lowered(corpus: &str, name: &str) -> hir::lower::Lowered {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests")
        .join(corpus)
        .join(name)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("tests/{corpus}/{name} is checked in"));
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    hir::lower::lower(&snapshot)
}

fn func<'a>(lowered: &'a hir::lower::Lowered, name: &str) -> &'a Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| {
            let names: Vec<&str> = lowered
                .program
                .funcs
                .iter()
                .map(|f| f.name.as_str())
                .collect();
            panic!("`{name}` is lowered, in {names:?}")
        })
}

/// The direct callees `func` names whose name starts with `prefix`.
fn callees<'a>(func: &'a Func, prefix: &str) -> Vec<&'a str> {
    func.values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } if name.starts_with(prefix) => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

/// Every call to a lowered generic copy passes each argument at the type that
/// copy's parameter was laid out for. The defect handed a `managed<obj#6>` to
/// a copy whose parameter is `managed<obj#1>`.
fn every_copy_receives_its_own_types(lowered: &hir::lower::Lowered) {
    for caller in &lowered.program.funcs {
        for op in &caller.values {
            let OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            if !name.contains('<') {
                continue;
            }
            let Some(callee) = lowered.program.funcs.iter().find(|f| &f.name == name) else {
                continue;
            };
            for (arg, param) in args.iter().zip(&callee.params) {
                assert_eq!(
                    caller.values[arg.0 as usize].ty, param.ty,
                    "`{}` passes `{name}`'s `{}` the type its copy was laid out for",
                    caller.name, param.name
                );
            }
        }
    }
}

/// The copy names its callee at the copy's own suffix: one copy of `call`, at
/// `Other`'s, and none at the bound's.
fn forwards_its_own_argument(lowered: &hir::lower::Lowered, outer: &str) {
    let suffix = &outer[outer.find('<').expect("a copy")..];
    assert_eq!(
        callees(func(lowered, outer), "call<"),
        [format!("call{suffix}")],
        "`{outer}` calls `call`'s copy at its own type argument"
    );
    let copies: Vec<&str> = lowered
        .program
        .funcs
        .iter()
        .map(|f| f.name.as_str())
        .filter(|name| name.starts_with("call<"))
        .collect();
    assert_eq!(
        copies,
        [format!("call{suffix}")],
        "the bound's copy is not made"
    );
    every_copy_receives_its_own_types(lowered);
}

#[test]
fn a_generic_function_forwards_its_own_type_argument() {
    let lowered = lowered(
        "outcomes",
        "a-generic-calling-a-generic-pins-the-bound-for-a-structural-argument",
    );
    assert_eq!(lowered.diagnostics, [], "nothing is refused");
    let outer = lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name.starts_with("outer<"))
        .expect("`outer` has a copy")
        .name
        .clone();
    forwards_its_own_argument(&lowered, &outer);
}

#[test]
fn a_generic_method_forwards_its_own_type_argument() {
    let lowered = lowered(
        "outcomes",
        "a-generic-method-calling-a-generic-pins-the-bound-for-a-structural-argument",
    );
    // A generic method keeps its unspecialized body beside its copies, for its
    // slot (`class_members::copies_of_the_member`), and that body's `r: T` has
    // no representation: the one refusal, by name, on every compiler.
    let refused: Vec<&str> = lowered
        .diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message.as_str())
        .collect();
    assert_eq!(
        refused,
        [
            "a parameter of unrepresentable type (the type parameter `T`) is not supported by this lowering yet"
        ],
        "only the unspecialized body is refused"
    );
    let outer = lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name.starts_with("Forward#outer<"))
        .expect("`Forward#outer` has a copy")
        .name
        .clone();
    forwards_its_own_argument(&lowered, &outer);
}

/// A generic *class*'s copy names the callee through the class's binding:
/// `Holder<Other>#run` calls the copy `Holder`'s constructor stores an `Other`
/// for, and `call` has that copy only.
#[test]
fn a_generic_class_forwards_its_own_type_argument() {
    let lowered = lowered(
        "outcomes",
        "a-generic-class-calling-a-generic-pins-the-bound-for-a-structural-argument",
    );
    assert_eq!(lowered.diagnostics, [], "nothing is refused");
    let run = lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name.starts_with("Holder<") && f.name.ends_with("#run"))
        .expect("`Holder#run` has a copy");
    let constructor = func(&lowered, &run.name.replace("#run", "#constructor"));
    let called = callees(run, "call<");
    assert_eq!(called.len(), 1, "`{}` calls `call` once", run.name);
    let call = func(&lowered, called[0]);
    assert_eq!(
        call.params[0].ty, constructor.params[1].ty,
        "`{}` is the copy at what `Holder`'s copy holds",
        call.name
    );
    every_copy_receives_its_own_types(&lowered);
}

/// Copies of copies close: a generic forwarding its parameter to itself, or to
/// a partner that forwards it back, makes one copy per argument it is called
/// at, and each names the other's copy at the same argument.
#[test]
fn a_recursive_forwarding_generic_reaches_a_fixed_point() {
    let lowered = lowered(
        "programs",
        "a-recursive-generic-forwards-its-own-type-parameter",
    );
    assert_eq!(lowered.diagnostics, [], "nothing is refused");
    for (name, partner) in [("again", "again"), ("ping", "pong"), ("pong", "ping")] {
        let copies: Vec<&Func> = lowered
            .program
            .funcs
            .iter()
            .filter(|f| f.name.starts_with(&format!("{name}<")))
            .collect();
        assert_eq!(
            copies.len(),
            2,
            "`{name}` has one copy at `Box` and one at `Other`"
        );
        for copy in copies {
            let suffix = &copy.name[name.len()..];
            assert_eq!(
                callees(copy, &format!("{partner}<")),
                [format!("{partner}{suffix}")],
                "`{}` names `{partner}` at its own argument",
                copy.name
            );
        }
    }
    every_copy_receives_its_own_types(&lowered);
}

/// The polymorphic `this` is a type parameter no generic declares, and still
/// stands for its constraint: `addTo(this)` makes the one copy over the class,
/// which every subclass's receiver is valid for.
#[test]
fn the_polymorphic_this_still_pins_its_constraint() {
    let lowered = lowered("programs", "a-generic-called-with-this");
    assert_eq!(lowered.diagnostics, [], "nothing is refused");
    let names: Vec<&str> = lowered
        .program
        .funcs
        .iter()
        .map(|f| f.name.as_str())
        .collect();
    let copies: Vec<&str> = names
        .iter()
        .copied()
        .filter(|name| name.starts_with("addTo<"))
        .collect();
    assert_eq!(copies.len(), 1, "one copy over the class, in {names:?}");
    every_copy_receives_its_own_types(&lowered);
}
