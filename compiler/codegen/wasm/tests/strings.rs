//! Direct string instructions and normalized ranges agree with Node methods.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;

use common::hir::{F64, U32, block, function, origin, program, value};
use nts_core::hir::{
    BinOp, BlockId, Callee, Func, Global, HirType, ManagedType, OpKind, Terminator, UnOp,
};

fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}

fn external(name: &str, helper: &str, params: &[HirType], result: HirType) -> Func {
    let mut f = function(name, params, result.clone());
    let args = params
        .iter()
        .enumerate()
        .map(|(at, ty)| {
            value(
                &mut f,
                OpKind::Param(u32::try_from(at).unwrap()),
                ty.clone(),
            )
        })
        .collect::<Vec<_>>();
    let out = value(
        &mut f,
        OpKind::Call {
            callee: Callee::External(helper.into()),
            args: args.clone(),
            frame: None,
        },
        result,
    );
    let mut ops = args;
    ops.push(out);
    f.blocks
        .push(block(&[], &ops, Terminator::Return(Some(out))));
    f
}

#[test]
fn builtin_strings_literals_live_globals_and_js_ranges_execute_exactly() {
    let mut funcs = vec![
        external("charAt", "nts_str_char_at", &[string(), F64], string()),
        external(
            "charCodeAtAlias",
            "nts_str_char_code_at_fn",
            &[string(), F64],
            F64,
        ),
        external(
            "substring",
            "nts_str_substring",
            &[string(), F64, F64],
            string(),
        ),
        external("slice", "nts_str_slice", &[string(), F64, F64], string()),
        external(
            "fromCharCode",
            "nts_string_from_char_code",
            &[F64],
            string(),
        ),
    ];
    for (name, ty) in [("length", F64), ("lengthU32", U32)] {
        let mut f = function(name, &[string()], ty.clone());
        let s = value(&mut f, OpKind::Param(0), string());
        let out = value(&mut f, OpKind::Length(s), ty);
        f.blocks
            .push(block(&[], &[s, out], Terminator::Return(Some(out))));
        funcs.push(f);
    }
    let mut f = function("charCodeAt", &[string(), F64], F64);
    let s = value(&mut f, OpKind::Param(0), string());
    let index = value(&mut f, OpKind::Param(1), F64);
    let out = value(
        &mut f,
        OpKind::StringUnitAt {
            string: s,
            index,
            checked: true,
        },
        F64,
    );
    f.blocks
        .push(block(&[], &[s, index, out], Terminator::Return(Some(out))));
    funcs.push(f);
    funcs.extend(operators());
    let mut f = function("literal", &[], string());
    let out = value(&mut f, OpKind::ConstString("\0é世😀�".into()), string());
    f.blocks
        .push(block(&[], &[out], Terminator::Return(Some(out))));
    funcs.push(f);
    funcs.extend(global_writers());
    funcs.push(global_reader("readDelimiter", string(), 0));
    funcs.push(global_reader("readCount", F64, 1));
    funcs.push(swap_strings());
    let mut p = program(funcs);
    p.public_api
        .retain(|(name, _)| name != nts_core::hir::lower::MODULE_INIT);
    for (name, ty, initial, deferred) in [
        ("delimiter", string(), 0.0, true),
        ("count", F64, 7.0, false),
    ] {
        p.globals.push(Global {
            name: name.into(),
            ty,
            written: None,
            constant: false,
            initial,
            exported: true,
            deferred,
            origin: origin(),
        });
        p.public_api.push((name.into(), name.into()));
    }
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    assert_eq!(emitted.manifest.features, [] as [std::string::String; 0]);
    // Literals are imported string constants: compile-time, not host imports.
    assert!(!emitted.manifest.imports.iter().any(|i| i.module == "'"));
    assert!(
        emitted
            .manifest
            .imports
            .iter()
            .any(|import| import.name == "inputDecline")
    );
    let report = common::run("strings", &emitted, "tooling/wasm/check-strings.mjs", &[]);
    assert!(report["cases"].as_u64().unwrap() > 10_000);
    assert_eq!(report["ignoredOptionsRefused"], true);
}

fn operators() -> Vec<Func> {
    let mut funcs = Vec::new();
    for (name, op, ty) in [
        ("eq", BinOp::Eq, HirType::Bool),
        ("ne", BinOp::Ne, HirType::Bool),
        ("lt", BinOp::Lt, HirType::Bool),
        ("le", BinOp::Le, HirType::Bool),
        ("gt", BinOp::Gt, HirType::Bool),
        ("ge", BinOp::Ge, HirType::Bool),
        ("concat", BinOp::Concat, string()),
    ] {
        let mut f = function(name, &[string(), string()], ty.clone());
        let lhs = value(&mut f, OpKind::Param(0), string());
        let rhs = value(&mut f, OpKind::Param(1), string());
        let out = value(&mut f, OpKind::Binary { op, lhs, rhs }, ty);
        f.blocks
            .push(block(&[], &[lhs, rhs, out], Terminator::Return(Some(out))));
        funcs.push(f);
    }
    funcs.push(null_test("isNull", BinOp::Eq, false));
    funcs.push(null_test("notNull", BinOp::Ne, true));
    for (name, op) in [("truthy", UnOp::Truthy), ("not", UnOp::Not)] {
        let mut f = function(name, &[string()], HirType::Bool);
        let s = value(&mut f, OpKind::Param(0), string());
        let out = value(&mut f, OpKind::Unary { op, operand: s }, HirType::Bool);
        f.blocks
            .push(block(&[], &[s, out], Terminator::Return(Some(out))));
        funcs.push(f);
    }
    funcs
}

/// `(k > 0 ? null : s) === null`, the null on either side: a null made in the
/// module, because the boundary declines one as a `string` argument.
fn null_test(name: &str, op: BinOp, null_on_left: bool) -> Func {
    let mut f = function(name, &[string(), F64], HirType::Bool);
    let s = value(&mut f, OpKind::Param(0), string());
    let k = value(&mut f, OpKind::Param(1), F64);
    let zero = value(&mut f, OpKind::ConstFloat(0.0), F64);
    let pick = value(
        &mut f,
        OpKind::Binary {
            op: BinOp::Gt,
            lhs: k,
            rhs: zero,
        },
        HirType::Bool,
    );
    f.blocks.push(block(
        &[],
        &[s, k, zero, pick],
        Terminator::Branch {
            cond: pick,
            then_target: BlockId(1),
            then_args: vec![],
            else_target: BlockId(2),
            else_args: vec![s],
        },
    ));
    let null = value(&mut f, OpKind::ConstNull, string());
    f.blocks.push(block(
        &[],
        &[null],
        Terminator::Jump {
            target: BlockId(2),
            args: vec![null],
        },
    ));
    let picked = value(&mut f, OpKind::BlockParam(0), string());
    let other = value(&mut f, OpKind::ConstNull, string());
    let (lhs, rhs) = if null_on_left {
        (other, picked)
    } else {
        (picked, other)
    };
    let out = value(&mut f, OpKind::Binary { op, lhs, rhs }, HirType::Bool);
    f.blocks.push(block(
        &[picked],
        &[other, out],
        Terminator::Return(Some(out)),
    ));
    f
}

#[test]
fn a_comparison_with_null_is_a_null_test_not_a_string_equality() {
    // Builtins are listed apart from ordinary imports (`Manifest::builtins`).
    let builtins = |funcs: Vec<Func>| -> Vec<String> {
        let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
        emitted
            .manifest
            .builtins
            .iter()
            .map(|i| i.name.clone())
            .collect()
    };
    let null_tests = builtins(vec![
        null_test("isNull", BinOp::Eq, false),
        null_test("notNull", BinOp::Ne, true),
    ]);
    assert!(
        !null_tests.iter().any(|name| name == "equals"),
        "{null_tests:?}"
    );
    // The control: two strings compared do import it, so the absence above is
    // the null test's and not a list that never holds `equals`.
    let control = builtins(operators().into_iter().filter(|f| f.name == "eq").collect());
    assert!(control.iter().any(|name| name == "equals"), "{control:?}");
}

fn global_writers() -> Vec<Func> {
    let mut funcs = Vec::new();
    let mut init = function(nts_core::hir::lower::MODULE_INIT, &[], HirType::Void);
    let delimiter = value(&mut init, OpKind::ConstString("-".into()), string());
    let set = value(
        &mut init,
        OpKind::GlobalSet {
            global: 0,
            value: delimiter,
        },
        HirType::Void,
    );
    init.blocks
        .push(block(&[], &[delimiter, set], Terminator::Return(None)));
    funcs.push(init);
    let mut setter = function("setDelimiter", &[string()], HirType::Void);
    let s = value(&mut setter, OpKind::Param(0), string());
    let set = value(
        &mut setter,
        OpKind::GlobalSet {
            global: 0,
            value: s,
        },
        HirType::Void,
    );
    setter
        .blocks
        .push(block(&[], &[s, set], Terminator::Return(None)));
    funcs.push(setter);
    funcs
}

fn global_reader(name: &str, ty: HirType, global: u32) -> Func {
    let mut f = function(name, &[], ty.clone());
    let out = value(&mut f, OpKind::GlobalGet(global), ty);
    f.blocks
        .push(block(&[], &[out], Terminator::Return(Some(out))));
    f
}

fn swap_strings() -> Func {
    let mut f = function("swapStrings", &[string(), string(), U32], string());
    let first = value(&mut f, OpKind::Param(0), string());
    let second = value(&mut f, OpKind::Param(1), string());
    let count = value(&mut f, OpKind::Param(2), U32);
    let a = value(&mut f, OpKind::BlockParam(0), string());
    let b = value(&mut f, OpKind::BlockParam(1), string());
    let n = value(&mut f, OpKind::BlockParam(2), U32);
    let zero = value(&mut f, OpKind::ConstInt(0), U32);
    let done = value(
        &mut f,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: n,
            rhs: zero,
        },
        HirType::Bool,
    );
    let one = value(&mut f, OpKind::ConstInt(1), U32);
    let next = value(
        &mut f,
        OpKind::Binary {
            op: BinOp::Sub,
            lhs: n,
            rhs: one,
        },
        U32,
    );
    f.blocks = vec![
        block(
            &[],
            &[first, second, count],
            Terminator::Jump {
                target: BlockId(1),
                args: vec![first, second, count],
            },
        ),
        block(
            &[a, b, n],
            &[zero, done],
            Terminator::Branch {
                cond: done,
                then_target: BlockId(3),
                then_args: vec![],
                else_target: BlockId(2),
                else_args: vec![],
            },
        ),
        block(
            &[],
            &[one, next],
            Terminator::Jump {
                target: BlockId(1),
                args: vec![b, a, next],
            },
        ),
        block(&[], &[], Terminator::Return(Some(a))),
    ];
    f
}

/// `String.fromCharCode(code)` where `code` is an integer converted to
/// `number`, as the core passes one: `(param) -> convert -> call`.
fn from_converted(name: &str, code: HirType) -> Func {
    let mut f = function(name, std::slice::from_ref(&code), string());
    let param = value(&mut f, OpKind::Param(0), code);
    let number = value(&mut f, OpKind::Convert(param), F64);
    let out = value(
        &mut f,
        OpKind::Call {
            callee: Callee::External("nts_string_from_char_code".into()),
            args: vec![number],
            frame: None,
        },
        string(),
    );
    f.blocks.push(block(
        &[],
        &[param, number, out],
        Terminator::Return(Some(out)),
    ));
    f
}

/// A code converted from an integer goes to the helper as that integer, with
/// no `ToInt32` of a double; a byte is read from the one-byte table with no
/// call at all; and a unit past the table is the host's `String.fromCharCode`,
/// never `wasm:js-string`'s, which V8 makes by internalizing it.
#[test]
fn a_char_code_is_read_by_its_integer_and_made_past_the_table_by_the_host() {
    const U8: HirType = HirType::Int {
        bits: 8,
        signed: false,
    };
    let emitted = nts_codegen_wasm::emit(&program(vec![
        from_converted("fromByte", U8),
        from_converted("fromInt", common::hir::I32),
        external("fromNumber", "nts_string_from_char_code", &[F64], string()),
    ]))
    .unwrap();
    let calls = common::calls_by_name_with_imports(&emitted.bytes);
    let calls_of = |name: &str| calls.get(name).cloned().unwrap_or_default();
    let host = "nts:host/v1.fromCharCode";
    assert!(calls_of("fromByte").is_empty(), "{calls:?}");
    // The integer reaches the host, through the helper or with it inlined,
    // and takes no `ToInt32` on the way.
    let reaches_host = |name: &str| {
        let direct = calls_of(name);
        direct.iter().any(|callee| callee == host)
            || direct.iter().any(|callee| {
                callee == "string.fromCharCode"
                    && calls_of(callee).iter().any(|inner| inner == host)
            })
    };
    assert!(reaches_host("fromInt"), "{calls:?}");
    assert!(
        !calls_of("fromInt")
            .iter()
            .any(|callee| callee == "nts.toInt32"),
        "{calls:?}"
    );
    // The control: a double does take its `ToInt32`, so its absence above is
    // the integer's and not a path that never takes one.
    assert!(reaches_host("fromNumber"), "{calls:?}");
    assert!(
        calls_of("fromNumber")
            .iter()
            .any(|callee| callee == "nts.toInt32"),
        "{calls:?}"
    );
    assert!(
        !emitted
            .manifest
            .builtins
            .iter()
            .any(|i| i.name == "fromCharCode"),
        "{:?}",
        emitted.manifest.builtins
    );
}
