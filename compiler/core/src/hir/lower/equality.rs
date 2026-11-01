//! Loose equality for unions whose members never require primitive conversion.
//!
//! Representation erasure does not erase a union's admission contract. Compare
//! admitted values strictly, with the additional null/undefined equivalence;
//! check that contract at the use before relying on it.

use rustc_hash::FxHashSet;

use super::{
    Absence, BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, TypeKind, UnOp,
    ValueId, absence_of_member, syntax,
};
use crate::hir::tags;

const fn bit(tag: u32) -> u32 {
    1 << tag
}
const ABSENT: u32 = bit(tags::NULL) | bit(tags::UNDEFINED);
const OBJECTS: u32 = bit(tags::OBJECT)
    | bit(tags::FUNCTION)
    | bit(tags::HANDLE_GOBJECT)
    | bit(tags::HANDLE_OBJC)
    | bit(tags::HANDLE_COM)
    | bit(tags::HANDLE_HOST);

impl FuncBuilder<'_> {
    pub(super) fn lower_union_equality(
        &mut self,
        id: NodeId,
        nodes: [NodeId; 2],
        token: u16,
        values: [ValueId; 2],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(
            token,
            syntax::EQUALS_EQUALS_TOKEN | syntax::EXCLAMATION_EQUALS_TOKEN
        ) || !self.coercing_comparison(nodes[0], nodes[1])
        {
            return None;
        }
        let left = self.equality_tags(nodes[0])?;
        let right = self.equality_tags(nodes[1])?;
        if !without_conversion(left, right) {
            return None;
        }
        Some((|| {
            let lhs = self.checked_equality_value(nodes[0], values[0], left)?;
            let rhs = self.checked_equality_value(nodes[1], values[1], right)?;
            let origin = self.origin(id);
            let mut equal = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs,
                    rhs,
                },
                HirType::Bool,
                origin.clone(),
            );
            if left & ABSENT != 0 && right & ABSENT != 0 {
                // All other tag pairs are strict equality. Null and undefined
                // are the sole additional equivalence in these admitted sets.
                let left_absent = self.absence_of(nodes[0], lhs).ok_or_else(|| {
                    self.unsupported(id, "an erased equality operand without an absence test")
                })?;
                let right_absent = self.absence_of(nodes[1], rhs).ok_or_else(|| {
                    self.unsupported(id, "an erased equality operand without an absence test")
                })?;
                let both = self.push(
                    OpKind::Binary {
                        op: BinOp::BitAnd,
                        lhs: left_absent,
                        rhs: right_absent,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                equal = self.push(
                    OpKind::Binary {
                        op: BinOp::BitOr,
                        lhs: equal,
                        rhs: both,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
            }
            if token == syntax::EXCLAMATION_EQUALS_TOKEN {
                equal = self.push(
                    OpKind::Unary {
                        op: UnOp::Not,
                        operand: equal,
                    },
                    HirType::Bool,
                    origin,
                );
            }
            Ok(equal)
        })())
    }

    fn equality_tags(&self, node: NodeId) -> Option<u32> {
        let mut pending = vec![self.read_type(node)?];
        let mut seen = FxHashSet::default();
        let mut tags = 0;
        while let Some(ty) = pending.pop() {
            if !seen.insert(ty) {
                continue;
            }
            // Source substitutions preserve union members. The representation
            // helper `after_substitution` can collapse a nullable reference to
            // its object shape, which would discard the admitted absence.
            if let Some(source) = self.sources.get(&ty).filter(|source| **source != ty) {
                pending.push(*source);
                continue;
            }
            let record = self.snapshot.types.get(ty.0 as usize)?;
            if let TypeKind::Union(members) = &record.kind {
                pending.extend(members);
                continue;
            }
            if let Some(absence) = absence_of_member(self.snapshot, ty) {
                tags |= bit(match absence {
                    Absence::Null => tags::NULL,
                    Absence::Undefined => tags::UNDEFINED,
                });
                continue;
            }
            // Branded machine scalars can represent a language bigint with an
            // integer. Do not infer its language kind from that storage here.
            if matches!(record.kind, TypeKind::Intersection(_)) {
                return None;
            }
            tags |= match self.represent(ty)? {
                HirType::Bool => bit(tags::BOOLEAN),
                HirType::Int { .. } | HirType::Float { .. } => bit(tags::NUMBER),
                HirType::BigInt | HirType::Managed(ManagedType::BoxedBigInt) => bit(tags::BIGINT),
                HirType::Managed(ManagedType::String) => bit(tags::STRING),
                HirType::Managed(ManagedType::Symbol) => bit(tags::SYMBOL),
                HirType::Managed(_) => OBJECTS,
                _ => return None,
            };
        }
        (tags != 0).then_some(tags)
    }

    fn checked_equality_value(
        &mut self,
        node: NodeId,
        value: ValueId,
        admitted: u32,
    ) -> Result<ValueId, Diagnostic> {
        let value = self.coerce(value, &HirType::Erased, node)?;
        let origin = self.origin(node);
        let tag_ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = self.push(OpKind::TagOf { value }, tag_ty.clone(), origin.clone());
        let mut accepted = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
        for expected in 0..32 {
            if admitted & bit(expected) == 0 {
                continue;
            }
            let expected = self.push(
                OpKind::ConstInt(i128::from(expected)),
                tag_ty.clone(),
                origin.clone(),
            );
            let matches = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: tag,
                    rhs: expected,
                },
                HirType::Bool,
                origin.clone(),
            );
            accepted = self.push(
                OpKind::Binary {
                    op: BinOp::BitOr,
                    lhs: accepted,
                    rhs: matches,
                },
                HirType::Bool,
                origin.clone(),
            );
        }
        let rejected = self.push(
            OpKind::Unary {
                op: UnOp::Not,
                operand: accepted,
            },
            HirType::Bool,
            origin,
        );
        super::assertions::decline_when(
            self,
            node,
            rejected,
            "a loose-equality operand outside its declared non-coercing union",
        )?;
        Ok(value)
    }
}

fn without_conversion(left: u32, right: u32) -> bool {
    // Remove absences, and partition functions, managed objects and native
    // handles into the language's one Object kind. Every remaining pair must
    // name the same single kind; a union of two primitive kinds can coerce.
    let group = |tags: u32| {
        (tags & !(ABSENT | OBJECTS))
            | if tags & OBJECTS != 0 {
                bit(tags::OBJECT)
            } else {
                0
            }
    };
    let (left, right) = (group(left), group(right));
    left == 0 || right == 0 || left == right && left.count_ones() == 1
}
