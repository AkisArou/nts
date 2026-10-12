//! A public global reads through the same conversion as a result: 64-bit
//! integers as safe numbers or a named refusal, unsigned read as unsigned,
//! booleans canonical, strings primitive.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{block, function, origin, program, value};
use nts_core::hir::{Func, Global, HirType, ManagedType, OpKind, Terminator};

const U64: HirType = HirType::Int {
    bits: 64,
    signed: false,
};
const I64: HirType = HirType::Int {
    bits: 64,
    signed: true,
};
fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}

/// A function storing one constant into each listed global.
fn setter(name: &str, writes: &[(u32, OpKind, HirType)]) -> Func {
    let mut f = function(name, &[], HirType::Void);
    let mut ops = vec![];
    for (global, kind, ty) in writes {
        let stored = value(&mut f, kind.clone(), ty.clone());
        let set = value(
            &mut f,
            OpKind::GlobalSet {
                global: *global,
                value: stored,
            },
            HirType::Void,
        );
        ops.extend([stored, set]);
    }
    f.blocks.push(block(&[], &ops, Terminator::Return(None)));
    f
}

#[test]
fn public_globals_read_through_the_result_conversion() {
    let mut init = setter(
        nts_core::hir::lower::MODULE_INIT,
        &[
            (2, OpKind::ConstBool(false), HirType::Bool),
            (3, OpKind::ConstString("start".into()), string()),
        ],
    );
    init.exported = false;
    let funcs = vec![
        init,
        setter(
            "setWide",
            &[
                (0, OpKind::ConstInt(i128::from(u64::MAX)), U64),
                (1, OpKind::ConstInt(i128::from(i64::MIN)), I64),
            ],
        ),
        setter(
            "setSmall",
            &[
                (0, OpKind::ConstInt((1 << 53) - 1), U64),
                (1, OpKind::ConstInt(-5), I64),
            ],
        ),
        setter(
            "setFlags",
            &[
                (2, OpKind::ConstBool(true), HirType::Bool),
                (3, OpKind::ConstString("x".into()), string()),
            ],
        ),
    ];
    let mut p = program(funcs);
    p.public_api
        .retain(|(name, _)| name != nts_core::hir::lower::MODULE_INIT);
    for (name, ty, deferred) in [
        ("wideUnsigned", U64, false),
        ("wideSigned", I64, false),
        ("flag", HirType::Bool, true),
        ("text", string(), true),
    ] {
        p.globals.push(Global {
            name: name.into(),
            ty,
            written: None,
            constant: false,
            initial: 0.0,
            exported: true,
            deferred,
            origin: origin(),
        });
        p.public_api.push((name.into(), name.into()));
    }
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    let report = common::run("globals", &emitted, "tooling/wasm/check-globals.mjs", &[]);
    assert_eq!(report["cases"], 9);
}
