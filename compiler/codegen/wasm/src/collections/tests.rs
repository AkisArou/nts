//! Execute the actual cursor and capacity emitters, including synthetic
//! boundary sizes which must be checked without allocating those sizes.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::*;
use crate::ir::Inst;
use std::io::Write;
use std::process::{Command, Stdio};
use wasm_encoder::{
    CodeSection, ExportKind, ExportSection, FieldType, FunctionSection, Module, StorageType,
    TypeSection,
};

fn module() -> Vec<u8> {
    let c = Collection {
        key: KeyKind::Number,
        value: None,
        table: false,
        wrapper: 2,
        keys: 1,
        values: None,
        ints: 0,
        base: 0,
        descriptor: 0,
        generation: None,
    };
    let mut types = TypeSection::new();
    types.ty().array(&StorageType::Val(ValType::I32), true);
    types.ty().array(&StorageType::Val(ValType::F64), true);
    types.ty().struct_(
        [
            ValType::I32,
            ValType::I32,
            concrete(1),
            concrete(0),
            concrete(0),
        ]
        .map(|ty| FieldType {
            element_type: StorageType::Val(ty),
            mutable: true,
        }),
    );
    types
        .ty()
        .function([concrete(2), ValType::I32], [ValType::I32]);
    types.ty().function([ValType::I32], [ValType::I32]);
    types.ty().function([concrete(2)], []);
    types
        .ty()
        .function([concrete(2), ValType::F64, ValType::I32], [ValType::I32]);
    types
        .ty()
        .function([concrete(2), ValType::F64, ValType::I32], []);
    types
        .ty()
        .function([ValType::I32, ValType::I32], [ValType::I32]);

    let mut capacity = Function::new([ValType::I32]);
    growth_capacity(&mut capacity, 0, 1);
    capacity.instructions(&[I::LocalGet(1), I::End]);
    let mut append = Function::new([]);
    append.instruction(&I::LocalGet(0));
    require_below(&mut append, MAX_ENTRIES);
    append.instructions(&[I::LocalGet(0), I::I32Const(1), I::I32Add, I::End]);

    let cursor = cursor_probe();
    let growing = growth_probe(&c);
    let mut find = Function::new([]);
    find.instructions(&[I::I32Const(0), I::End]);
    let putting = put_probe(&c);
    let mut functions = FunctionSection::new();
    for ty in [3, 4, 4, 4, 5, 4, 6, 7, 8] {
        functions.function(ty);
    }
    let mut exports = ExportSection::new();
    for (name, at) in [
        ("capacity", 1),
        ("append", 2),
        ("cursor", 3),
        ("grow", 5),
        ("put", 8),
    ] {
        exports.export(name, ExportKind::Func, at);
    }
    let mut code = CodeSection::new();
    for body in [
        next(&c),
        capacity,
        append,
        cursor,
        grow(&c),
        growing,
        find,
        put_body(&c, Func::by_hand(6), Func::by_hand(4)),
        putting,
    ] {
        let mut encoded = wasm_encoder::Function::new_with_locals_types(body.locals);
        for inst in body.code.insts {
            let i = match inst {
                Inst::Op(i) => i,
                Inst::Call(f) if f == Func::by_hand(4) => I::Call(4),
                Inst::Call(f) if f == Func::by_hand(6) => I::Call(6),
                other => panic!("unexpected symbol {other:?}"),
            };
            encoded.instruction(&i);
        }
        code.function(&encoded);
    }
    let mut module = Module::new();
    module
        .section(&types)
        .section(&functions)
        .section(&exports)
        .section(&code);
    module.finish()
}

fn cursor_probe() -> Function {
    // A real numeric Set shape, with holes at entries 1 and 3. These are
    // hashes rather than keys: Next must consult liveness, not key values.
    let mut cursor = Function::new([]);
    cursor.instructions(&[
        I::I32Const(3),
        I::I32Const(5),
        I::I32Const(5),
        I::ArrayNewDefault(1),
        I::I32Const(1),
        I::I32Const(0),
        I::I32Const(2),
        I::I32Const(0),
        I::I32Const(3),
        I::ArrayNewFixed {
            array_type_index: 0,
            array_size: 5,
        },
        I::I32Const(16),
        I::ArrayNewDefault(0),
        I::StructNew(2),
        I::LocalGet(0),
        I::Call(0),
        I::End,
    ]);
    cursor
}

fn growth_probe(c: &Collection) -> Function {
    // Oversized used with tiny arrays: the actual Grow body must trap at
    // its explicit bound, before attempting an allocation or a copy.
    let mut growing = Function::new([concrete(2)]);
    growing.instructions(&[
        I::I32Const(0),
        I::LocalGet(0),
        I::I32Const(0),
        I::ArrayNewDefault(1),
        I::I32Const(0),
        I::ArrayNewDefault(0),
        I::I32Const(16),
        I::ArrayNewDefault(0),
        I::StructNew(2),
        I::LocalTee(1),
        I::Call(4),
        I::LocalGet(1),
        field(c, c.key_field()),
        I::ArrayLen,
        I::End,
    ]);
    growing
}

fn put_probe(c: &Collection) -> Function {
    // Isolate Put's capacity contract from probing: slot zero is either
    // empty or already holds the key. No large backing is allocated, and
    // an existing-key update at the cap must still return successfully.
    let mut putting = Function::new([concrete(2)]);
    putting.instructions(&[
        I::LocalGet(1),
        I::LocalGet(0),
        I::I32Const(0),
        I::ArrayNewDefault(1),
        I::I32Const(0),
        I::ArrayNewDefault(0),
        I::LocalGet(1),
        I::ArrayNewFixed {
            array_type_index: 0,
            array_size: 1,
        },
        I::StructNew(2),
        I::LocalTee(2),
        I::F64Const(42.0.into()),
        I::I32Const(1),
        I::Call(7),
        I::LocalGet(2),
        field(c, c.used()),
        I::End,
    ]);
    putting
}

fn run(script: &str) {
    let mut child = Command::new("node")
        .args(["-e", script, &MAX_ENTRIES.to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("node");
    child.stdin.take().unwrap().write_all(&module()).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_cursor_is_signed_i32_and_skips_holes() {
    run(r"
const assert = require('node:assert/strict');
const {cursor} = new WebAssembly.Instance(new WebAssembly.Module(require('node:fs').readFileSync(0))).exports;
for (const [from, expected] of [[-2147483648,-1],[-2,-1],[-1,-1],[0,0],[1,2],[2,2],[3,4],[4,4],[5,-1],[6,-1],[2147483647,-1]]) {
  assert.equal(cursor(from), expected, `cursor(${from})`);
}
");
}

#[test]
fn collection_growth_and_append_check_before_overflow_or_allocation() {
    assert!(u32::try_from(MAX_ENTRIES).unwrap().is_power_of_two());
    assert!(MAX_ENTRIES <= crate::arrays::capacity(&HirType::NUMBER));
    assert!(
        MAX_ENTRIES * 2
            <= crate::arrays::capacity(&HirType::Int {
                bits: 32,
                signed: true
            })
    );
    assert!(f64::from(MAX_ENTRIES) < nts_core::hir::facts::MAX_LENGTH);
    run(r"
const assert = require('node:assert/strict');
const {capacity,append,grow,put} = new WebAssembly.Instance(new WebAssembly.Module(require('node:fs').readFileSync(0))).exports;
const max = Number(process.argv[1]);
for (const [used, expected] of [[0,8],[1,8],[4,8],[8,16],[max/2,max]]) {
  assert.equal(capacity(used), expected);
}
assert.equal(append(0), 1);
assert.equal(append(max - 1), max);
assert.equal(grow(0), 8);
assert.equal(put(0, 0), 1);
assert.equal(put(max, 1), max);
const boundTrap = error => error instanceof WebAssembly.RuntimeError && /unreachable/.test(error.message);
for (const used of [max/2 + 1,max,2147483647,-1,-2147483648]) {
  assert.throws(() => capacity(used), boundTrap, `capacity(${used})`);
  assert.throws(() => grow(used), boundTrap, `grow(${used})`);
}
for (const used of [max,max+1,2147483647,-1,-2147483648]) {
  assert.throws(() => append(used), boundTrap, `append(${used})`);
  assert.throws(() => put(used, 0), boundTrap, `put(${used})`);
}
");
}
