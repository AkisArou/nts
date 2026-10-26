//! What a function is called (`hir::Program::function_names`): data beside each
//! closure class's descriptor, decided where the function is written. The
//! examples check every name against node on every backend; this checks the
//! table -- including the one entry the runtime computes, a bound function of
//! a target known only at run time -- and that a name is never a function the
//! program has to carry.
//!
//! Uses the linked in-process TypeScript frontend with one checker.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{self, FunctionName, OpKind};
use nts_frontend_ts::Frontend;

fn prepared() -> hir::Program {
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/programs/function-names/tsconfig.json")
        .canonicalize_utf8()
        .expect("the program is checked in");
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    hir::prepare(&snapshot).expect("valid HIR").program
}

#[test]
fn every_closure_is_named_where_it_is_written() {
    let program = prepared();
    let names: Vec<&FunctionName> = program
        .layouts
        .iter()
        .filter(|layout| layout.types.iter().any(|ty| hir::is_closure_type(*ty)))
        .filter_map(|layout| program.function_names.get(&layout.name))
        .collect();
    let is = |text: &str| FunctionName::Is(text.to_owned());
    // `const add = …`, and the arrow written as an argument.
    for expected in [is("add"), is("")] {
        assert!(names.contains(&&expected), "{expected:?} in {names:?}");
    }
    // Both binds: the one name the runtime makes, `"bound "` and the target's,
    // because field 0 holds the target at its signature.
    let bound = names
        .iter()
        .filter(|name| ***name == FunctionName::Bound)
        .count();
    assert_eq!(bound, 2, "{names:?}");
    assert!(
        program
            .funcs
            .iter()
            .all(|func| !func.name.contains("@name")),
        "a name is data, never a function"
    );
}

#[test]
fn a_name_the_type_settles_is_a_constant_and_any_other_is_asked() {
    let program = prepared();
    let names = program
        .funcs
        .iter()
        .find(|func| func.name == "names")
        .expect("`names` is exported");
    assert!(
        names
            .values
            .iter()
            .any(|op| op.kind == OpKind::ConstString("add".into())),
        "`add.name` is the constant `\"add\"`"
    );
    let asks = |func: &hir::Func| {
        func.values.iter().any(|op| {
            matches!(&op.kind, OpKind::Call { callee: hir::Callee::External(name), .. }
                if name == "nts_function_name")
        })
    };
    assert!(
        program.funcs.iter().any(asks),
        "`f.name` through a signature asks the runtime"
    );
}
