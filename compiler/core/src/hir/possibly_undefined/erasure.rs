//! The dynamic boundary, lowered once before boxing and ownership.
use crate::hir::{Absent, Block, BlockId, Func, HirType, Op, OpKind, Program, Terminator, ValueId};

/// A genuine dynamic boundary chooses the tag after testing definedness. Do
/// this once in core, before `BigInt` boxing and ownership, so no emitter can
/// turn undefined into zero or allocate a payload on the absent branch.
pub(in crate::hir) fn lower_erasures(program: &mut Program) {
    for func in &mut program.funcs {
        lower_func_erasures(func);
    }
}

fn lower_func_erasures(func: &mut Func) {
    let initial_blocks = func.blocks.len();
    for at in 0..initial_blocks {
        if !func.blocks[at].ops.iter().any(|id| matches!(func.value(*id).kind,
            OpKind::Erase { value, .. } if matches!(func.value(value).ty, HirType::PossiblyUndefined(_)))) {
            continue;
        }
        let ops = std::mem::take(&mut func.blocks[at].ops);
        let terminator =
            std::mem::replace(&mut func.blocks[at].terminator, Terminator::Unreachable);
        let mut current = at;
        for id in ops {
            let OpKind::Erase { value, slots, .. } = func.value(id).kind else {
                func.blocks[current].ops.push(id);
                continue;
            };
            let HirType::PossiblyUndefined(payload) = func.value(value).ty.clone() else {
                func.blocks[current].ops.push(id);
                continue;
            };
            let origin = func.value(id).origin.clone();
            let mut append = |kind, ty| {
                let id = ValueId(u32::try_from(func.values.len()).expect("HIR value limit"));
                func.values.push(Op {
                    kind,
                    ty,
                    origin: origin.clone(),
                });
                id
            };
            let defined = append(OpKind::OptionalDefined(value), HirType::Bool);
            let read = append(OpKind::OptionalPayload(value), (*payload).clone());
            let erased = append(
                OpKind::Erase {
                    value: read,
                    absent: if payload.is_managed() {
                        Absent::Null
                    } else {
                        Absent::Impossible
                    },
                    slots,
                },
                HirType::Erased,
            );
            let absent = append(OpKind::ConstUndefined, HirType::Erased);
            let then_target = BlockId(u32::try_from(func.blocks.len()).expect("HIR block limit"));
            let else_target = BlockId(then_target.0 + 1);
            let join = BlockId(then_target.0 + 2);
            func.blocks[current].ops.push(defined);
            func.blocks[current].terminator = Terminator::Branch {
                cond: defined,
                then_target,
                then_args: vec![],
                else_target,
                else_args: vec![],
            };
            func.blocks.push(Block {
                params: vec![],
                ops: vec![read, erased],
                terminator: Terminator::Jump {
                    target: join,
                    args: vec![erased],
                },
            });
            func.blocks.push(Block {
                params: vec![],
                ops: vec![absent],
                terminator: Terminator::Jump {
                    target: join,
                    args: vec![absent],
                },
            });
            func.values[id.0 as usize].kind = OpKind::BlockParam(0);
            func.blocks.push(Block {
                params: vec![id],
                ops: vec![],
                terminator: Terminator::Unreachable,
            });
            current = join.0 as usize;
        }
        func.blocks[current].terminator = terminator;
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]
    use super::*;
    use crate::hir::{Callee, Param, ParamShape, facts::Facts};
    fn fixture(payload: HirType, count: u32) -> Program {
        let origin = nts_semantic_schema::Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 1),
        });
        let pair = HirType::PossiblyUndefined(Box::new(payload));
        let mut values = vec![Op {
            kind: OpKind::Param(0),
            ty: pair.clone(),
            origin: origin.clone(),
        }];
        for _ in 0..count {
            values.push(Op {
                kind: OpKind::Erase {
                    value: ValueId(0),
                    absent: Absent::Undefined,
                    slots: Absent::Impossible,
                },
                ty: HirType::Erased,
                origin: origin.clone(),
            });
        }
        let func = Func {
            name: "dynamicBoundary".into(),
            params: vec![Param {
                name: "x".into(),
                ty: pair,
                origin: origin.clone(),
                shape: ParamShape::Ordinary,
                known: Facts::TOP,
                written: None,
            }],
            return_type: HirType::Erased,
            values,
            blocks: vec![Block {
                params: vec![],
                ops: (0..=count).map(ValueId).collect(),
                terminator: Terminator::Return(Some(ValueId(count))),
            }],
            origin,
            exported: true,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: vec![],
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: Absent::Impossible,
            validation: None,
            written_return_elements: vec![],
        };
        Program {
            funcs: vec![func],
            ..Program::default()
        }
    }
    #[test]
    fn dynamic_boundary_tests_definedness_before_projecting_and_boxing() {
        let mut program = fixture(HirType::BigInt, 1);
        lower_erasures(&mut program);
        crate::hir::boxing::materialize(&mut program);
        assert_eq!(crate::hir::verify::verify(&program), Ok(()));
        let func = &program.funcs[0];
        let Terminator::Branch {
            then_target,
            else_target,
            ..
        } = func.blocks[0].terminator
        else {
            panic!("definedness branch")
        };
        let present = &func.blocks[then_target.0 as usize];
        let absent = &func.blocks[else_target.0 as usize];
        assert!(present.ops.iter().any(|id|matches!(&func.value(*id).kind,OpKind::Call{callee:Callee::External(name),..} if name=="nts_bigint_box")));
        assert_eq!(absent.ops.len(), 1);
        assert!(matches!(
            func.value(absent.ops[0]).kind,
            OpKind::ConstUndefined
        ));
        let mut corrupted = program.clone();
        corrupted.funcs[0].blocks[0].terminator = Terminator::Jump {
            target: then_target,
            args: vec![],
        };
        assert!(
            crate::hir::verify::verify(&corrupted).is_err(),
            "the payload must not become reachable without its test"
        );
    }
    #[test]
    fn many_dynamic_boundaries_rebuild_once_and_keep_every_pair() {
        for count in [1, 64, 256] {
            let mut program = fixture(HirType::NUMBER, count);
            lower_erasures(&mut program);
            assert_eq!(program.funcs[0].blocks.len(), 1 + 3 * count as usize);
            assert_eq!(program.funcs[0].values.len(), 1 + 5 * count as usize);
            assert_eq!(crate::hir::verify::verify(&program), Ok(()));
        }
    }
}
