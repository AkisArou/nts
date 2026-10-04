//! Owned scalar payloads, introduced after erasure elimination.
//!
//! Native `BigInts` stay unboxed in arithmetic and concrete slots. Only a live
//! erased boundary needs an immutable managed payload. Making that allocation
//! an ordinary call before escape analysis and ownership keeps `Erase` and
//! `Unerase` free: neither operation hides an allocation or an owned result.

use super::{Callee, Func, HirType, ManagedType, Op, OpKind, Program, ValueId};

pub(super) fn materialize(program: &mut Program) {
    for func in &mut program.funcs {
        materialize_func(func);
    }
}

fn materialize_func(func: &mut Func) {
    if !func.values.iter().any(|op| {
        matches!(op.kind, OpKind::Erase { value, .. } if func.value(value).ty == HirType::BigInt)
            || (op.ty == HirType::BigInt && matches!(op.kind, OpKind::Unerase { .. }))
    }) {
        return;
    }
    for block in 0..func.blocks.len() {
        let old = std::mem::take(&mut func.blocks[block].ops);
        let mut ops = Vec::with_capacity(old.len());
        for id in old {
            let op = func.value(id);
            let boundary = match op.kind {
                OpKind::Erase { value, .. }
                    if op.ty == HirType::Erased && func.value(value).ty == HirType::BigInt =>
                {
                    Some((true, value))
                }
                OpKind::Unerase { value }
                    if op.ty == HirType::BigInt && func.value(value).ty == HirType::Erased =>
                {
                    Some((false, value))
                }
                _ => None,
            };
            if let Some((erase, value)) = boundary {
                let origin = op.origin.clone();
                let storage = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
                func.values.push(Op {
                    kind: if erase {
                        OpKind::Call {
                            callee: Callee::External("nts_bigint_box".to_owned()),
                            args: vec![value],
                            frame: None,
                        }
                    } else {
                        OpKind::Unerase { value }
                    },
                    ty: HirType::Managed(ManagedType::BoxedBigInt),
                    origin,
                });
                ops.push(storage);
                if erase {
                    // The original op's absence remains Impossible: scalar
                    // BigInt has no missing-payload spelling before this pass.
                    if let OpKind::Erase { value, .. } = &mut func.values[id.0 as usize].kind {
                        *value = storage;
                    }
                } else {
                    func.values[id.0 as usize].kind = OpKind::Call {
                        callee: Callee::External("nts_bigint_unbox".to_owned()),
                        args: vec![storage],
                        frame: None,
                    };
                }
            }
            ops.push(id);
        }
        func.blocks[block].ops = ops;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Absent, Block, Terminator};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(nts_diagnostics::Location {
            file: nts_diagnostics::SourceId(0),
            span: nts_diagnostics::Span::new(0, 1),
        })
    }

    fn func(values: Vec<Op>, ops: Vec<ValueId>, result: ValueId) -> Func {
        Func {
            name: "boundary".to_owned(),
            params: Vec::new(),
            return_type: values[result.0 as usize].ty.clone(),
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: Terminator::Return(Some(result)),
            }],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
        }
    }

    fn value(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }

    #[test]
    fn live_erasure_materializes_an_owned_call_at_the_boundary() {
        let mut f = func(
            vec![
                value(OpKind::ConstInt(9), HirType::BigInt),
                value(
                    OpKind::Erase {
                        value: ValueId(0),
                        absent: Absent::Impossible,
                    },
                    HirType::Erased,
                ),
            ],
            vec![ValueId(0), ValueId(1)],
            ValueId(1),
        );
        materialize_func(&mut f);
        assert_eq!(f.blocks[0].ops, vec![ValueId(0), ValueId(2), ValueId(1)]);
        assert_eq!(f.values[2].ty, HirType::Managed(ManagedType::BoxedBigInt));
        assert!(
            matches!(&f.values[2].kind, OpKind::Call { callee: Callee::External(name), args, frame: None }
            if name == "nts_bigint_box" && args == &[ValueId(0)])
        );
        assert!(matches!(
            f.values[1].kind,
            OpKind::Erase {
                value: ValueId(2),
                absent: Absent::Impossible
            }
        ));
        // Re-running preparation cannot box an existing payload again.
        materialize_func(&mut f);
        assert_eq!(f.values.len(), 3);
    }

    #[test]
    fn licensed_read_unpacks_the_storage_without_an_owned_result() {
        let mut f = func(
            vec![
                value(OpKind::ConstUndefined, HirType::Erased),
                value(OpKind::Unerase { value: ValueId(0) }, HirType::BigInt),
            ],
            vec![ValueId(0), ValueId(1)],
            ValueId(1),
        );
        materialize_func(&mut f);
        assert_eq!(f.blocks[0].ops, vec![ValueId(0), ValueId(2), ValueId(1)]);
        assert!(matches!(
            f.values[2].kind,
            OpKind::Unerase { value: ValueId(0) }
        ));
        assert!(
            matches!(&f.values[1].kind, OpKind::Call { callee: Callee::External(name), args, .. }
            if name == "nts_bigint_unbox" && args == &[ValueId(2)])
        );
        assert_eq!(f.values[1].ty, HirType::BigInt);
    }

    #[test]
    fn dead_erasure_and_concrete_arithmetic_allocate_nothing() {
        let mut f = func(
            vec![
                value(OpKind::ConstInt(9), HirType::BigInt),
                value(
                    OpKind::Erase {
                        value: ValueId(0),
                        absent: Absent::Impossible,
                    },
                    HirType::Erased,
                ),
            ],
            vec![ValueId(0)],
            ValueId(0),
        );
        materialize_func(&mut f);
        assert_eq!(f.values.len(), 2);
        assert_eq!(f.blocks[0].ops, vec![ValueId(0)]);
    }

    #[test]
    fn recoverable_erasure_roundtrip_is_removed_before_materialization() {
        let mut f = func(
            vec![
                value(OpKind::ConstInt(9), HirType::BigInt),
                value(
                    OpKind::Erase {
                        value: ValueId(0),
                        absent: Absent::Impossible,
                    },
                    HirType::Erased,
                ),
                value(OpKind::Unerase { value: ValueId(1) }, HirType::BigInt),
            ],
            vec![ValueId(0), ValueId(1), ValueId(2)],
            ValueId(2),
        );
        super::super::simplify::simplify(&mut f);
        super::super::dce::eliminate(&mut f);
        materialize_func(&mut f);
        assert_eq!(f.blocks[0].ops, vec![ValueId(0)]);
        assert!(matches!(
            f.blocks[0].terminator,
            Terminator::Return(Some(ValueId(0)))
        ));
    }

    #[test]
    fn object_spelling_is_bounded_and_bigint_is_a_primitive_with_owned_storage() {
        use crate::hir::tags;
        assert_eq!(tags::of_representation(&HirType::BigInt), tags::BIGINT);
        assert_eq!(tags::of_reference(&ManagedType::BoxedBigInt), tags::BIGINT);
        assert!(!tags::payload_is_a_reference(&HirType::BigInt));
        assert!(tags::payload_is_a_reference(&HirType::Managed(
            ManagedType::BoxedBigInt
        )));
        assert_eq!(
            tags::of_spelling("bigint"),
            Some(tags::TagTest::Is(tags::BIGINT))
        );
    }
}
