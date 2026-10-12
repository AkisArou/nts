//! A program's export names are its own, whatever they are: the generated
//! glue's names live in a file of their own, so no export can collide with
//! one, and every local the glue declares is shadowed by none.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, block, function, origin, program, value};
use nts_core::hir::{BinOp, Func, Global, HirType, OpKind, Terminator};

/// The glue's own identifiers and helper names, plus the default export.
/// `sync` is the live global below. `then` is left out: a module exporting
/// it is a thenable to `import()`, in node as here.
const NAMES: &[&str] = &[
    "instantiate",
    "WasmInputDecline",
    "default",
    "main",
    "decline",
    "declineResult",
    "api",
    "create",
    "imports",
    "module",
    "x",
    "e0",
    "f0",
    "g0",
    "freeze",
    "Instance",
    "readFileSync",
    "__proto__",
];

/// `name(x) = x + k`.
fn plus(name: &str, k: f64) -> Func {
    let mut f = function(name, &[F64], F64);
    let x = value(&mut f, OpKind::Param(0), F64);
    let c = value(&mut f, OpKind::ConstFloat(k), F64);
    let out = value(
        &mut f,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: x,
            rhs: c,
        },
        F64,
    );
    f.blocks
        .push(block(&[], &[x, c, out], Terminator::Return(Some(out))));
    f
}

/// `bump(x)` assigns the global `sync`, so its binding is live.
fn bump() -> Func {
    let mut f = function("bump", &[F64], HirType::Void);
    let x = value(&mut f, OpKind::Param(0), F64);
    let set = value(
        &mut f,
        OpKind::GlobalSet {
            global: 0,
            value: x,
        },
        HirType::Void,
    );
    f.blocks
        .push(block(&[], &[x, set], Terminator::Return(None)));
    f
}

#[test]
fn export_names_never_collide_with_the_glue() {
    let mut funcs: Vec<_> = (0..NAMES.len())
        .map(|at| plus(NAMES[at], f64::from(u32::try_from(at).unwrap())))
        .collect();
    funcs.push(bump());
    let mut p = program(funcs);
    p.globals.push(Global {
        name: "sync".into(),
        ty: F64,
        written: None,
        constant: false,
        initial: 1.0,
        exported: true,
        deferred: false,
        origin: origin(),
    });
    p.public_api.push(("sync".into(), "sync".into()));
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    assert!(emitted.manifest.globals[0].live);
    let report = common::run("glue", &emitted, "tooling/wasm/check-glue.mjs", &[]);
    assert_eq!(report["exports"], NAMES.len() + 2);
}
