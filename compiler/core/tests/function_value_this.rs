//! A call through a function value passes its `this` to the uniform entry.
//!
//! JavaScript gives every call a `this`: `undefined` for `f()`, `o` for
//! `o.f()`, `r` for `f.call(r)` and `f.apply(r, list)`. A closure's uniform
//! entries take it after the closure and before the arguments
//! (`hir::UNIFORM_THIS`), so a body that reads `this` can be given one
//! (`docs/function-receivers.md`). No body reads it yet, so no program's answer
//! can show whether it arrives; what is asserted here is *what each call
//! passes*, which is the fact step 2 rests on.
//!
//! Skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, Callee, HirType, OpKind};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered() -> Option<hir::lower::Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/function-value-this/tsconfig.json")
        .canonicalize_utf8()
        .expect("the function-value-this program is checked in");
    let snapshot = TsgoApi::for_compilation(tsgo)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    Some(hir::lower::lower(&snapshot))
}

/// What the one call through a function value in `name` passes as its `this`:
/// the operation that makes it, looking through the erasure.
fn this_passed(program: &hir::Program, name: &str) -> OpKind {
    let func = program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .unwrap_or_else(|| panic!("`{name}` is lowered"));
    let calls: Vec<&Vec<hir::ValueId>> = func
        .values
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Call {
                callee: Callee::Closure { slot },
                args,
                ..
            } if Some(*slot) == program.erased_call_slot => Some(args),
            _ => None,
        })
        .collect();
    let [args] = calls.as_slice() else {
        panic!("`{name}` calls through one uniform entry: {calls:?}");
    };
    let this = &func.values[args[hir::UNIFORM_THIS].0 as usize];
    assert_eq!(
        this.ty,
        HirType::Erased,
        "`{name}` passes its `this` erased"
    );
    match this.kind {
        OpKind::Erase { value, .. } => func.values[value.0 as usize].kind.clone(),
        ref kind => kind.clone(),
    }
}

#[test]
fn each_call_through_a_function_value_passes_the_this_javascript_gives_it() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP function_value_this: tsgo is not built");
        return;
    };
    let program = &lowered.program;
    // `f(1)`, and `f.call(undefined, 4)`, which says so.
    assert_eq!(this_passed(program, "plain"), OpKind::ConstUndefined);
    assert_eq!(
        this_passed(program, "throughCallOfUndefined"),
        OpKind::ConstUndefined
    );
    // `o.handle(2)`: the object the field was read from.
    assert_eq!(this_passed(program, "throughAField"), OpKind::Param(0));
    // `f.call(r, 3)` and `f.apply(r, [5])`: the `r` written.
    assert_eq!(this_passed(program, "throughCall"), OpKind::Param(1));
    assert_eq!(this_passed(program, "throughApply"), OpKind::Param(1));
}

#[test]
fn every_uniform_entry_takes_an_erased_this_before_its_arguments() {
    let Some(lowered) = lowered() else {
        eprintln!("SKIP function_value_this: tsgo is not built");
        return;
    };
    let program = &lowered.program;
    let width = program
        .funcs
        .iter()
        .filter(|func| func.name.ends_with("#erased_call"))
        .map(|func| {
            let this = &func.params[hir::UNIFORM_THIS];
            assert_eq!(
                (this.name.as_str(), &this.ty),
                ("this_argument", &HirType::Erased),
                "{}",
                func.name
            );
            func.params.len() - hir::UNIFORM_ARGUMENTS
        })
        .collect::<Vec<_>>();
    // A closure and a signature layout per handler: one width for all of them,
    // which is what lets a site that knows only the signature make the call.
    assert!(width.len() >= 2, "{width:?}");
    assert!(width.windows(2).all(|pair| pair[0] == pair[1]), "{width:?}");
}
