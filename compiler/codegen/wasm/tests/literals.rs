//! A string literal a loop reads comes from a local set once at entry, not
//! from its imported global on every iteration (`literals::hoisted`).
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{block, function, program, value};
use nts_core::hir::{BinOp, BlockId, Func, HirType, ManagedType, OpKind, Terminator};

fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}

/// `matches(s, more)`: compares `s` with "in" on every turn of a loop while
/// `more` holds, then with "after", once.
fn matches() -> Func {
    let mut f = function("matches", &[string(), HirType::Bool], HirType::Bool);
    let s = value(&mut f, OpKind::Param(0), string());
    let more = value(&mut f, OpKind::Param(1), HirType::Bool);
    let inside = value(&mut f, OpKind::ConstString("in".into()), string());
    let after = value(&mut f, OpKind::ConstString("after".into()), string());
    let turn = value(
        &mut f,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: s,
            rhs: inside,
        },
        HirType::Bool,
    );
    let last = value(
        &mut f,
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: s,
            rhs: after,
        },
        HirType::Bool,
    );
    f.blocks = vec![
        block(
            &[],
            &[s, more, inside, after],
            Terminator::Jump {
                target: BlockId(1),
                args: vec![],
            },
        ),
        block(
            &[],
            &[turn],
            Terminator::Branch {
                cond: more,
                then_target: BlockId(1),
                then_args: vec![],
                else_target: BlockId(2),
                else_args: vec![],
            },
        ),
        block(&[], &[last], Terminator::Return(Some(last))),
    ];
    f
}

/// The imported global holding the literal `text`.
fn literal_global(bytes: &[u8], text: &str) -> u32 {
    let mut globals = 0;
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::ImportSection(imports) = payload.unwrap() {
            for import in imports.into_imports() {
                let import = import.unwrap();
                if let wasmparser::TypeRef::Global(_) = import.ty {
                    if import.name == text {
                        return globals;
                    }
                    globals += 1;
                }
            }
        }
    }
    panic!("no global imports the literal {text:?}")
}

/// Where the function bodies read `global`: for each read, whether it is
/// inside a `loop`.
fn reads_of(bytes: &[u8], global: u32) -> Vec<bool> {
    let mut reads = Vec::new();
    for payload in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::CodeSectionEntry(body) = payload.unwrap() {
            let mut reader = body.get_operators_reader().unwrap();
            let mut nesting: Vec<bool> = Vec::new();
            while !reader.eof() {
                match reader.read().unwrap() {
                    wasmparser::Operator::Loop { .. } => nesting.push(true),
                    wasmparser::Operator::Block { .. }
                    | wasmparser::Operator::If { .. }
                    | wasmparser::Operator::TryTable { .. } => nesting.push(false),
                    wasmparser::Operator::End => {
                        nesting.pop();
                    }
                    wasmparser::Operator::GlobalGet { global_index } if global_index == global => {
                        reads.push(nesting.contains(&true));
                    }
                    _ => {}
                }
            }
        }
    }
    reads
}

#[test]
fn a_literal_a_loop_reads_is_read_from_a_local() {
    let emitted = nts_codegen_wasm::emit(&program(vec![matches()])).unwrap();
    let inside = literal_global(&emitted.bytes, "in");
    assert_eq!(reads_of(&emitted.bytes, inside), vec![false]);
}
