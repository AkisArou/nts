//! A number erased from a 32-bit integer is erased from the integer: an i31
//! where it fits, a box where it does not, the forms `boxNumber` gives too.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{Absent, BinOp, Func, HirType, OpKind, Terminator, UnOp, ValueId};

const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};

struct Build {
    f: Func,
    ops: Vec<ValueId>,
}
impl Build {
    fn new(name: &str, params: &[HirType]) -> Self {
        Self {
            f: function(name, params, F64),
            ops: vec![],
        }
    }
    fn op(&mut self, kind: OpKind, ty: HirType) -> ValueId {
        let id = value(&mut self.f, kind, ty);
        self.ops.push(id);
        id
    }
    /// Erase an integer through the number it converts to, and read it back.
    fn round_trip(mut self, integer: ValueId) -> Func {
        let number = self.op(OpKind::Convert(integer), F64);
        let erased = self.op(
            OpKind::Erase {
                value: number,
                absent: Absent::Impossible,
            },
            HirType::Erased,
        );
        let back = self.op(OpKind::Unerase { value: erased }, F64);
        self.f
            .blocks
            .push(block(&[], &self.ops, Terminator::Return(Some(back))));
        self.f
    }
}
fn constant(name: &str, n: i128, ty: HirType) -> Func {
    let mut b = Build::new(name, &[]);
    let integer = b.op(OpKind::ConstInt(n), ty);
    b.round_trip(integer)
}
/// `x | 0`, or `x & 1023` when `masked`: the one difference between the pair.
fn from_param(name: &str, masked: bool) -> Func {
    let mut b = Build::new(name, &[F64]);
    let x = b.op(OpKind::Param(0), F64);
    let mut integer = b.op(
        OpKind::Unary {
            op: UnOp::ToInt32,
            operand: x,
        },
        I32,
    );
    if masked {
        let mask = b.op(OpKind::ConstInt(1023), I32);
        integer = b.op(
            OpKind::Binary {
                op: BinOp::BitAnd,
                lhs: integer,
                rhs: mask,
            },
            I32,
        );
    }
    b.round_trip(integer)
}
fn function_names(bytes: &[u8]) -> Vec<String> {
    let mut names = vec![];
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::CustomSection(section) = payload.unwrap()
            && let wasmparser::KnownCustom::Name(reader) = section.as_known()
        {
            for name in reader {
                if let wasmparser::Name::Function(map) = name.unwrap() {
                    for naming in map {
                        names.push(naming.unwrap().name.to_owned());
                    }
                }
            }
        }
    }
    names
}

#[test]
fn integers_erase_to_the_values_node_reads_back() {
    let funcs = vec![
        constant("fitsHigh", (1 << 30) - 1, I32),
        constant("fitsLow", -(1 << 30), I32),
        constant("aboveI31", 1 << 30, I32),
        constant("belowI31", -(1 << 30) - 1, I32),
        constant("i32Min", -(1 << 31), I32),
        constant("u32Small", 5, U32),
        constant("u32AboveI31", 1 << 30, U32),
        constant("u32Max", (1 << 32) - 1, U32),
        from_param("signed", false),
        from_param("masked", true),
    ];
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let output = common::run(
        "erased-integers",
        &emitted,
        "tooling/wasm/check-erased-integers.mjs",
        &[],
    );
    assert_eq!(output["cases"], 30, "{output}");
}

/// A masked integer fits by its definition, so erasing it needs no box at all;
/// the unmasked control keeps the box for the values that do not fit.
#[test]
fn an_integer_that_fits_by_its_definition_erases_without_a_box() {
    let names = |masked| {
        let emitted = nts_codegen_wasm::emit(&program(vec![from_param("probe", masked)])).unwrap();
        function_names(&emitted.bytes)
    };
    assert!(!names(true).iter().any(|n| n == "value.boxNumber"));
    assert!(names(false).iter().any(|n| n == "value.boxNumber"));
}
