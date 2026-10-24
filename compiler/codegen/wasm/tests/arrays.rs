//! Packed/reference/erased arrays, exact indices and stable growth aliases.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, I32, U32, block, function, program, value};
use nts_core::hir::{
    Absent, ArrayFill, BinOp, BlockId, Func, HirType, ManagedType, OpKind, Terminator, ValueId,
};

fn array(element: HirType) -> HirType {
    HirType::Managed(ManagedType::Array(Box::new(element)))
}
fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}
fn op(f: &mut Func, ops: &mut Vec<ValueId>, kind: OpKind, ty: HirType) -> ValueId {
    let id = value(f, kind, ty);
    ops.push(id);
    id
}
fn finish(mut f: Func, ops: Vec<ValueId>, result: ValueId) -> Func {
    f.blocks.push(nts_core::hir::Block {
        params: vec![],
        ops,
        terminator: Terminator::Return(Some(result)),
    });
    f
}
fn set(f: &mut Func, ops: &mut Vec<ValueId>, a: ValueId, i: ValueId, v: ValueId, checked: bool) {
    op(
        f,
        ops,
        OpKind::ArraySet {
            array: a,
            index: i,
            value: v,
            checked,
        },
        HirType::Void,
    );
}
fn roundtrip(name: &str, element: HirType, index: HirType, checked: bool) -> Func {
    let mut f = function(name, &[element.clone(), index.clone()], element.clone());
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), element.clone());
    let i = op(&mut f, &mut ops, OpKind::Param(1), index);
    let len = op(&mut f, &mut ops, OpKind::ConstInt(2), U32);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Uninitialized,
        },
        array(element.clone()),
    );
    for n in [0, 1] {
        let at = op(&mut f, &mut ops, OpKind::ConstInt(n), U32);
        set(&mut f, &mut ops, a, at, input, false);
    }
    let result = op(
        &mut f,
        &mut ops,
        OpKind::ArrayGet {
            array: a,
            index: i,
            checked,
        },
        element,
    );
    finish(f, ops, result)
}
fn length(name: &str, index: HirType) -> Func {
    let mut f = function(name, std::slice::from_ref(&index), F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), index);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: input,
            fill: ArrayFill::Holes,
        },
        array(F64),
    );
    let result = op(&mut f, &mut ops, OpKind::Length(a), F64);
    finish(f, ops, result)
}
fn erased(name: &str, element: Option<HirType>) -> Func {
    let params = element.as_ref().map_or(vec![F64], |e| vec![e.clone(), F64]);
    let mut f = function(name, &params, I32);
    let mut ops = vec![];
    let len = op(&mut f, &mut ops, OpKind::ConstInt(3), U32);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Holes,
        },
        array(HirType::Erased),
    );
    if let Some(element) = element {
        let input = op(&mut f, &mut ops, OpKind::Param(0), element);
        let erased = op(
            &mut f,
            &mut ops,
            OpKind::Erase {
                value: input,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
        );
        let at = op(&mut f, &mut ops, OpKind::ConstInt(1), U32);
        set(&mut f, &mut ops, a, at, erased, true);
        let null = op(&mut f, &mut ops, OpKind::ConstNull, HirType::Erased);
        let at = op(&mut f, &mut ops, OpKind::ConstInt(2), U32);
        set(&mut f, &mut ops, a, at, null, false);
    }
    let input = op(
        &mut f,
        &mut ops,
        OpKind::Param(u32::try_from(params.len() - 1).unwrap()),
        F64,
    );
    let result = op(
        &mut f,
        &mut ops,
        OpKind::ArrayGet {
            array: a,
            index: input,
            checked: true,
        },
        HirType::Erased,
    );
    let tag = op(&mut f, &mut ops, OpKind::TagOf { value: result }, I32);
    finish(f, ops, tag)
}
fn nested() -> Func {
    let mut f = function("nested", &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let len = op(&mut f, &mut ops, OpKind::ConstInt(1), U32);
    let index = op(&mut f, &mut ops, OpKind::ConstInt(0), U32);
    let inner = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Holes,
        },
        array(F64),
    );
    set(&mut f, &mut ops, inner, index, input, true);
    let outer = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Holes,
        },
        array(array(F64)),
    );
    set(&mut f, &mut ops, outer, index, inner, false);
    let alias = op(
        &mut f,
        &mut ops,
        OpKind::ArrayGet {
            array: outer,
            index,
            checked: true,
        },
        array(F64),
    );
    let result = op(
        &mut f,
        &mut ops,
        OpKind::ArrayGet {
            array: alias,
            index,
            checked: true,
        },
        F64,
    );
    finish(f, ops, result)
}
fn grow() -> Func {
    let mut func = function("grow", &[U32], F64);
    let mut entry = vec![];
    let limit = op(&mut func, &mut entry, OpKind::Param(0), U32);
    let zero = op(&mut func, &mut entry, OpKind::ConstInt(0), U32);
    let storage = op(
        &mut func,
        &mut entry,
        OpKind::ArrayNew {
            length: zero,
            fill: ArrayFill::Holes,
        },
        array(F64),
    );
    let erased = op(
        &mut func,
        &mut entry,
        OpKind::Erase {
            value: storage,
            absent: Absent::Impossible,
            slots: Absent::Impossible,
        },
        HirType::Erased,
    );
    let alias = op(&mut func, &mut entry, OpKind::unerase(erased), array(F64));
    let sum0 = op(&mut func, &mut entry, OpKind::ConstFloat(0.0), F64);
    let fill_index = value(&mut func, OpKind::BlockParam(0), U32);
    let read_index = value(&mut func, OpKind::BlockParam(0), U32);
    let sum = value(&mut func, OpKind::BlockParam(1), F64);
    func.blocks.push(block(
        &[],
        &entry,
        Terminator::Jump {
            target: BlockId(1),
            args: vec![zero],
        },
    ));
    fill_loop(&mut func, limit, storage, fill_index, zero, sum0);
    read_loop(&mut func, limit, alias, read_index, sum);
    let mut end = vec![];
    let len = op(&mut func, &mut end, OpKind::Length(alias), F64);
    let total = op(
        &mut func,
        &mut end,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: sum,
            rhs: len,
        },
        F64,
    );
    let eq = op(
        &mut func,
        &mut end,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: storage,
            rhs: alias,
        },
        HirType::Bool,
    );
    let identity = op(&mut func, &mut end, OpKind::Convert(eq), F64);
    let result = op(
        &mut func,
        &mut end,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: total,
            rhs: identity,
        },
        F64,
    );
    func.blocks
        .push(block(&[], &end, Terminator::Return(Some(result))));
    func
}
fn fill_loop(
    func: &mut Func,
    limit: ValueId,
    storage: ValueId,
    fill_index: ValueId,
    zero: ValueId,
    sum0: ValueId,
) {
    let mut test = vec![];
    let cond = op(
        func,
        &mut test,
        OpKind::Binary {
            op: BinOp::Lt,
            lhs: fill_index,
            rhs: limit,
        },
        HirType::Bool,
    );
    func.blocks.push(block(
        &[fill_index],
        &test,
        Terminator::Branch {
            cond,
            then_target: BlockId(2),
            then_args: vec![],
            else_target: BlockId(3),
            else_args: vec![zero, sum0],
        },
    ));
    let mut fill = vec![];
    let item = op(func, &mut fill, OpKind::Convert(fill_index), F64);
    set(func, &mut fill, storage, fill_index, item, true);
    let one = op(func, &mut fill, OpKind::ConstInt(1), U32);
    let next = op(
        func,
        &mut fill,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: fill_index,
            rhs: one,
        },
        U32,
    );
    func.blocks.push(block(
        &[],
        &fill,
        Terminator::Jump {
            target: BlockId(1),
            args: vec![next],
        },
    ));
}
fn read_loop(func: &mut Func, limit: ValueId, alias: ValueId, read_index: ValueId, sum: ValueId) {
    let mut test = vec![];
    let cond = op(
        func,
        &mut test,
        OpKind::Binary {
            op: BinOp::Lt,
            lhs: read_index,
            rhs: limit,
        },
        HirType::Bool,
    );
    func.blocks.push(block(
        &[read_index, sum],
        &test,
        Terminator::Branch {
            cond,
            then_target: BlockId(4),
            then_args: vec![],
            else_target: BlockId(5),
            else_args: vec![],
        },
    ));
    let mut read = vec![];
    let item = op(
        func,
        &mut read,
        OpKind::ArrayGet {
            array: alias,
            index: read_index,
            checked: false,
        },
        F64,
    );
    let total = op(
        func,
        &mut read,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: sum,
            rhs: item,
        },
        F64,
    );
    let one = op(func, &mut read, OpKind::ConstInt(1), U32);
    let next = op(
        func,
        &mut read,
        OpKind::Binary {
            op: BinOp::Add,
            lhs: read_index,
            rhs: one,
        },
        U32,
    );
    func.blocks.push(block(
        &[],
        &read,
        Terminator::Jump {
            target: BlockId(3),
            args: vec![next, total],
        },
    ));
}
fn append() -> Func {
    let mut f = function("append", &[F64, F64], F64);
    let mut ops = vec![];
    let index = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let input = op(&mut f, &mut ops, OpKind::Param(1), F64);
    let len = op(&mut f, &mut ops, OpKind::ConstInt(0), U32);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Holes,
        },
        array(F64),
    );
    set(&mut f, &mut ops, a, index, input, true);
    let result = op(
        &mut f,
        &mut ops,
        OpKind::ArrayGet {
            array: a,
            index,
            checked: true,
        },
        F64,
    );
    finish(f, ops, result)
}

fn wide(name: &str, constant: i128, element: HirType) -> Func {
    let mut f = function(name, &[], HirType::Bool);
    let mut ops = vec![];
    let input = op(
        &mut f,
        &mut ops,
        OpKind::ConstInt(constant),
        element.clone(),
    );
    let len = op(&mut f, &mut ops, OpKind::ConstInt(1), U32);
    let at = op(&mut f, &mut ops, OpKind::ConstInt(0), U32);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Uninitialized,
        },
        array(element.clone()),
    );
    set(&mut f, &mut ops, a, at, input, true);
    let read = op(
        &mut f,
        &mut ops,
        OpKind::ArrayGet {
            array: a,
            index: at,
            checked: false,
        },
        element,
    );
    let result = op(
        &mut f,
        &mut ops,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: input,
            rhs: read,
        },
        HirType::Bool,
    );
    finish(f, ops, result)
}
fn reference_append() -> Func {
    let mut f = function("referenceAppend", &[string()], HirType::Void);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), string());
    let zero = op(&mut f, &mut ops, OpKind::ConstInt(0), U32);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: zero,
            fill: ArrayFill::Holes,
        },
        array(string()),
    );
    set(&mut f, &mut ops, a, zero, input, true);
    f.blocks.push(nts_core::hir::Block {
        params: vec![],
        ops,
        terminator: Terminator::Return(None),
    });
    f
}
fn absent_array(name: &str, wrong: bool) -> Func {
    let mut f = function(name, &[], F64);
    let mut ops = vec![];
    let absent = if wrong {
        let input = op(&mut f, &mut ops, OpKind::ConstFloat(13.0), F64);
        let erased = op(
            &mut f,
            &mut ops,
            OpKind::Erase {
                value: input,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
        );
        op(&mut f, &mut ops, OpKind::unerase(erased), array(F64))
    } else {
        op(&mut f, &mut ops, OpKind::ConstNull, array(F64))
    };
    let result = op(&mut f, &mut ops, OpKind::Length(absent), F64);
    finish(f, ops, result)
}
#[test]
fn arrays_match_js_and_input_contracts() {
    let i64 = HirType::Int {
        bits: 64,
        signed: true,
    };
    let u64 = HirType::Int {
        bits: 64,
        signed: false,
    };
    let mut funcs = vec![
        grow(),
        append(),
        nested(),
        length("length", F64),
        length("length64", i64.clone()),
        length("lengthU64", u64.clone()),
        erased("defaultErased", None),
        erased("erasedNumber", Some(F64)),
        erased("erasedBoolean", Some(HirType::Bool)),
        erased("erasedString", Some(string())),
        wide("wideMin", i128::from(i64::MIN), i64.clone()),
        wide("wideMax", i128::from(i64::MAX), i64.clone()),
        wide("wideUnsignedMax", i128::from(u64::MAX), u64.clone()),
        reference_append(),
        absent_array("nullArray", false),
        absent_array("wrongArray", true),
    ];
    for (name, ty) in [
        (
            "i8",
            HirType::Int {
                bits: 8,
                signed: true,
            },
        ),
        (
            "u16",
            HirType::Int {
                bits: 16,
                signed: false,
            },
        ),
        ("i32", I32),
        ("u32", U32),
        ("i64", i64.clone()),
        ("u64", u64.clone()),
        ("f32", HirType::Float { bits: 32 }),
        ("f64", F64),
        ("boolean", HirType::Bool),
        ("string", string()),
    ] {
        funcs.push(roundtrip(name, ty, F64, true));
    }
    // Checked: an index from a parameter is no proof (`proven_access`).
    funcs.push(roundtrip("integerIndex", F64, I32, true));
    funcs.push(roundtrip(
        "floatIndex",
        F64,
        HirType::Float { bits: 32 },
        true,
    ));
    funcs.push(roundtrip("longIndex", F64, i64, true));
    funcs.push(roundtrip("unsignedLongIndex", F64, u64, true));
    let p = program(funcs);
    let emitted = nts_codegen_wasm::emit(&p).unwrap();
    nts_codegen_wasm::validate(&emitted.bytes).unwrap();
    assert!(
        wasmparser::Parser::new(0)
            .parse_all(&emitted.bytes)
            .filter_map(|p| match p.unwrap() {
                wasmparser::Payload::CodeSectionEntry(body) => Some(body),
                _ => None,
            })
            .any(|body| body
                .get_operators_reader()
                .unwrap()
                .into_iter()
                .any(|op| matches!(op.unwrap(), wasmparser::Operator::I32TruncF32S))),
        "f32 indices must spend the same whole/range proof as f64"
    );
    let report = common::run("arrays", &emitted, "tooling/wasm/check-arrays.mjs", &[]);
    assert!(report["cases"].as_u64().unwrap() > 1000);
    assert!(report["named_declines"].as_u64().unwrap() > 50);
}

/// `[v, v]` written and read back at `index`, a constant of type `ty`: with
/// `checked` false the core's proof that it is whole and inside the array --
/// which a constant past the backing's storage falsifies.
fn proven(name: &str, ty: &HirType, index: f64, checked: bool) -> Func {
    let mut f = function(name, &[F64], F64);
    let mut ops = vec![];
    let input = op(&mut f, &mut ops, OpKind::Param(0), F64);
    let len = op(&mut f, &mut ops, OpKind::ConstInt(2), U32);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Uninitialized,
        },
        array(F64),
    );
    let constant = |f: &mut Func, ops: &mut Vec<ValueId>, n: f64| {
        let kind = if matches!(ty, HirType::Float { .. }) {
            OpKind::ConstFloat(n)
        } else {
            #[allow(clippy::cast_possible_truncation, reason = "a test's small constant")]
            OpKind::ConstInt(n as i128)
        };
        op(f, ops, kind, ty.clone())
    };
    for n in [0.0, 1.0] {
        let at = constant(&mut f, &mut ops, n);
        set(&mut f, &mut ops, a, at, input, checked);
    }
    let at = constant(&mut f, &mut ops, index);
    set(&mut f, &mut ops, a, at, input, checked);
    let result = op(
        &mut f,
        &mut ops,
        OpKind::ArrayGet {
            array: a,
            index: at,
            checked,
        },
        F64,
    );
    finish(f, ops, result)
}

/// An unchecked access's index is the core's proof, whole and inside the
/// array, so it is read and written with no test of its own -- an f64 index
/// converted exactly, as C casts it -- and a false proof past the backing's
/// storage traps rather than writing or reading there. The checked control
/// keeps its test and its refusal.
#[test]
fn a_proven_access_tests_nothing_and_a_false_proof_traps() {
    const PAST: f64 = 1_000_000.0;
    let emitted = nts_codegen_wasm::emit(&program(vec![
        proven("provenFloat", &F64, 1.0, false),
        proven("provenInteger", &U32, 1.0, false),
        proven("falseFloat", &F64, PAST, false),
        proven("falseInteger", &U32, PAST, false),
        proven("checkedFloat", &F64, 1.0, true),
    ]))
    .unwrap();
    let calls = common::calls_by_name(&emitted.bytes);
    // An access's own refusals; the allocation's length test is another's.
    let refuses = |name: &str| {
        calls[name]
            .iter()
            .any(|callee| callee.starts_with("refuse<") && callee.contains("past the end"))
    };
    for name in ["provenFloat", "provenInteger", "falseFloat", "falseInteger"] {
        assert!(!refuses(name), "{name}: {calls:?}");
    }
    assert!(refuses("checkedFloat"), "{calls:?}");
    let report = common::run(
        "proven-arrays",
        &emitted,
        "tooling/wasm/check-proven-arrays.ts",
        &[],
    );
    assert_eq!(report["proven"], 4, "{report}");
    assert_eq!(report["falseProofTraps"], 4, "{report}");
}

/// An array of `length`, a constant `kind` of type `ty`, answering its length.
fn constant_length(name: &str, kind: OpKind, ty: HirType) -> Func {
    let mut f = function(name, &[], F64);
    let mut ops = vec![];
    let len = op(&mut f, &mut ops, kind, ty);
    let a = op(
        &mut f,
        &mut ops,
        OpKind::ArrayNew {
            length: len,
            fill: ArrayFill::Holes,
        },
        array(F64),
    );
    let result = op(&mut f, &mut ops, OpKind::Length(a), F64);
    finish(f, ops, result)
}

/// The operators of the defined function `name`, by their debug names.
fn operators(bytes: &[u8], name: &str) -> Vec<String> {
    let names = common::function_names(bytes);
    let mut imported = 0;
    let mut defined = 0;
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        match payload.unwrap() {
            wasmparser::Payload::ImportSection(reader) => {
                imported += reader
                    .into_imports()
                    .filter(|import| {
                        matches!(import.as_ref().unwrap().ty, wasmparser::TypeRef::Func(_))
                    })
                    .count();
            }
            wasmparser::Payload::CodeSectionEntry(body) => {
                if names[imported + defined] == name {
                    return body
                        .get_operators_reader()
                        .unwrap()
                        .into_iter()
                        .map(|op| format!("{:?}", op.unwrap()))
                        .collect();
                }
                defined += 1;
            }
            _ => {}
        }
    }
    panic!("no function `{name}` in {names:?}");
}

/// An array whose length is whole and at most 2^32 - 1 by its value -- a
/// constant -- or by its type -- an unsigned integer of 32 bits or fewer --
/// is allocated with no test of that length and no refusal for it; a constant
/// that is not one keeps both, and refuses when run -- 2^32 - 1 as an f32 is
/// 2^32, one past. A signed 32-bit length is tested for its sign alone, never
/// against 2^32 - 1, which it cannot pass.
#[test]
fn a_length_whole_by_its_value_or_type_is_not_tested() {
    let emitted = nts_codegen_wasm::emit(&program(vec![
        constant_length("zero", OpKind::ConstInt(0), I32),
        constant_length("three", OpKind::ConstFloat(3.0), F64),
        constant_length("negativeZero", OpKind::ConstFloat(-0.0), F64),
        constant_length("half", OpKind::ConstFloat(2.5), F64),
        constant_length("negative", OpKind::ConstInt(-1), I32),
        constant_length(
            "roundedPast",
            OpKind::ConstFloat(f64::from(u32::MAX)),
            HirType::Float { bits: 32 },
        ),
        length("signed", I32),
        length("unsigned", U32),
    ]))
    .unwrap();
    nts_codegen_wasm::validate(&emitted.bytes).unwrap();
    let calls = common::calls_by_name(&emitted.bytes);
    let tested = |name: &str| {
        calls[name]
            .iter()
            .any(|callee| callee.starts_with("refuse<") && callee.contains("not a whole number"))
    };
    for name in ["zero", "three", "negativeZero", "unsigned"] {
        assert!(!tested(name), "{name}: {calls:?}");
    }
    for name in ["half", "negative", "roundedPast", "signed"] {
        assert!(tested(name), "{name}: {calls:?}");
    }
    for name in ["signed", "unsigned"] {
        let ops = operators(&emitted.bytes, name);
        assert!(!ops.iter().any(|op| op == "F64Le"), "{name}: {ops:?}");
    }
    let report = common::run(
        "array-lengths",
        &emitted,
        "tooling/wasm/check-array-lengths.ts",
        &[],
    );
    assert_eq!(report["allocated"], 133, "{report}");
    assert_eq!(report["refused"], 5, "{report}");
}
