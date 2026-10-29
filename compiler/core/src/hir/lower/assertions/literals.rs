//! Finite assertion domains come from the captured type graph. They are a
//! runtime admission test, never a source of optimizer value facts.

use super::{BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, ValueId};
use nts_semantic_schema::{LiteralValue, SemanticSnapshot, TypeId, TypeKind, TypeRecord};

const TYPE_BUDGET: usize = 256;
const MEMBER_BUDGET: usize = 128;

/// `None` is a non-finite type, `Err` an exhausted walk. Never turn exhaustion
/// into the weaker tag-only check. Charge edges before extending the worklist.
pub(super) fn members(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
) -> Result<Option<Vec<LiteralValue>>, ()> {
    from_types(&snapshot.types, ty)
}

fn from_types(types: &[TypeRecord], ty: TypeId) -> Result<Option<Vec<LiteralValue>>, ()> {
    let mut todo = vec![ty];
    let mut seen = rustc_hash::FxHashSet::default();
    let mut result = Vec::new();
    let mut remaining = TYPE_BUDGET;
    while let Some(ty) = todo.pop() {
        remaining = remaining.checked_sub(1).ok_or(())?;
        if !seen.insert(ty) {
            continue;
        }
        let record = types.get(ty.0 as usize).ok_or(())?;
        match &record.kind {
            TypeKind::Literal(value) => {
                if !result.contains(value) {
                    if result.len() == MEMBER_BUDGET {
                        return Err(());
                    }
                    result.push(value.clone());
                }
            }
            TypeKind::Union(parts) => {
                if parts.len() > remaining.saturating_sub(todo.len()) {
                    return Err(());
                }
                todo.extend(parts);
            }
            // Absence is checked separately by the same assertion plan.
            TypeKind::Null | TypeKind::Undefined | TypeKind::Void | TypeKind::Never => {}
            _ => return Ok(None),
        }
    }
    Ok((!result.is_empty()).then_some(result))
}

fn emit(
    builder: &mut FuncBuilder<'_>,
    id: NodeId,
    value: LiteralValue,
) -> Result<ValueId, Diagnostic> {
    let (kind, ty) = match value {
        LiteralValue::Number(value) => (OpKind::ConstFloat(value), HirType::NUMBER),
        LiteralValue::Boolean(value) => (OpKind::ConstBool(value), HirType::Bool),
        LiteralValue::String(value) => (
            OpKind::ConstString(value),
            HirType::Managed(ManagedType::String),
        ),
        LiteralValue::BigInt(digits) => {
            let value = super::super::parse_bigint(&digits).ok_or_else(|| {
                builder.unsupported(
                    id,
                    "a bigint literal assertion outside the supported 128-bit range",
                )
            })?;
            (OpKind::ConstInt(value), HirType::BigInt)
        }
    };
    Ok(builder.push(kind, ty, builder.origin(id)))
}

/// Establish membership before projecting a payload; erased unions keep their tag.
pub(super) fn lower(
    builder: &mut FuncBuilder<'_>,
    id: NodeId,
    value: ValueId,
    target: HirType,
    members: Vec<LiteralValue>,
    allowed: &[u32],
) -> Result<ValueId, Diagnostic> {
    let source = builder.children(id).first().copied().unwrap_or(id);
    let origin = builder.origin(id);
    let erased = builder.coerce(value, &HirType::Erased, source)?;
    let mut matched = builder.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
    for member in members {
        let literal = emit(builder, id, member)?;
        let literal = builder.coerce(literal, &HirType::Erased, id)?;
        let equal = builder.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: erased,
                rhs: literal,
            },
            HirType::Bool,
            origin.clone(),
        );
        matched = builder.push(
            OpKind::Binary {
                op: BinOp::BitOr,
                lhs: matched,
                rhs: equal,
            },
            HirType::Bool,
            origin.clone(),
        );
    }
    let mismatch = super::disallowed(builder, id, erased, matched, allowed);
    super::reject_when(
        builder,
        id,
        mismatch,
        "TypeError",
        "The asserted literal or enum value does not match the value",
    )?;
    if target == HirType::Erased {
        Ok(erased)
    } else {
        Ok(builder.push(OpKind::unerase(erased), target, origin))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn record(kind: TypeKind) -> TypeRecord {
        TypeRecord { kind, symbol: None }
    }
    #[test]
    fn literal_domains_deduplicate_shared_graphs_without_widening() {
        let types = vec![
            record(TypeKind::Union(vec![TypeId(1), TypeId(2), TypeId(1)])),
            record(TypeKind::Literal(LiteralValue::Number(64.))),
            record(TypeKind::Union(vec![TypeId(1), TypeId(3)])),
            record(TypeKind::Literal(LiteralValue::String("a".into()))),
        ];
        assert_eq!(
            from_types(&types, TypeId(0)),
            Ok(Some(vec![
                LiteralValue::Number(64.),
                LiteralValue::String("a".into())
            ]))
        );
        let types = vec![
            record(TypeKind::Union(vec![TypeId(1), TypeId(2)])),
            record(TypeKind::Literal(LiteralValue::Number(64.))),
            record(TypeKind::Number),
        ];
        assert_eq!(from_types(&types, TypeId(0)), Ok(None));
    }
    #[test]
    fn exhausted_literal_domains_never_become_tag_only_checks() {
        let wide = vec![
            record(TypeKind::Union(vec![TypeId(1); TYPE_BUDGET])),
            record(TypeKind::Literal(LiteralValue::Number(1.))),
        ];
        assert_eq!(from_types(&wide, TypeId(0)), Err(()));
        let mut distinct = vec![record(TypeKind::Union((1..=129).map(TypeId).collect()))];
        distinct.extend(
            (0..129).map(|n| record(TypeKind::Literal(LiteralValue::Number(f64::from(n))))),
        );
        assert_eq!(from_types(&distinct, TypeId(0)), Err(()));
        let cyclic = vec![record(TypeKind::Union(vec![TypeId(0)]))];
        assert_eq!(from_types(&cyclic, TypeId(0)), Ok(None));
    }
}
