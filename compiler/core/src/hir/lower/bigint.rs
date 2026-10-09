//! Exact BigInt/String relational comparisons, before numeric coercion.

use super::{BinOp, FuncBuilder, HirType, ManagedType, NodeId, OpKind, ValueId};

impl FuncBuilder<'_> {
    /// `StringToBigInt` can fail without throwing. Its ordering result is NaN
    /// then, so all four ordered comparisons with zero answer false. Only the
    /// ordering is a number: neither original operand is converted to double.
    pub(super) fn bigint_string_comparison(
        &mut self,
        id: NodeId,
        op: BinOp,
        lhs_node: NodeId,
        rhs_node: NodeId,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Option<ValueId> {
        if !matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge) {
            return None;
        }
        let (integer, string, string_node, op) = match (
            &self.values[lhs.0 as usize].ty,
            &self.values[rhs.0 as usize].ty,
        ) {
            (HirType::BigInt, HirType::Managed(ManagedType::String)) => (lhs, rhs, rhs_node, op),
            (HirType::Managed(ManagedType::String), HirType::BigInt) => {
                // Both expressions have already run in source order. Reverse
                // the comparison, never their evaluation, for the one helper.
                let reversed = match op {
                    BinOp::Lt => BinOp::Gt,
                    BinOp::Le => BinOp::Ge,
                    BinOp::Gt => BinOp::Lt,
                    BinOp::Ge => BinOp::Le,
                    _ => unreachable!("only relational operators reach here"),
                };
                (rhs, lhs, lhs_node, reversed)
            }
            _ => return None,
        };
        let origin = self.origin(id);
        // A nullable string has the same pointer representation as a string,
        // but null compares numerically as exact zero. The source type still
        // distinguishes it from undefined, which compares incomparably. Reuse
        // that absence fact and branch when an absence is admitted. A type
        // admitting both absences has an erased representation instead.
        let absences = self.absences_of(string_node);
        let missing = if absences.as_deref() == Some(&[super::super::tags::NULL]) {
            let zero = self.push(OpKind::ConstInt(0), HirType::BigInt, origin.clone());
            Some(self.push(
                OpKind::Binary {
                    op,
                    lhs: integer,
                    rhs: zero,
                },
                HirType::Bool,
                origin.clone(),
            ))
        } else if absences.as_deref() == Some(&[super::super::tags::UNDEFINED]) {
            Some(self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone()))
        } else {
            None
        };
        if let Some(missing) = missing {
            return Some(self.unless_null(string, missing, &origin, |this| {
                this.bigint_string_ordering(id, op, integer, string)
            }));
        }
        Some(self.bigint_string_ordering(id, op, integer, string))
    }

    fn bigint_string_ordering(
        &mut self,
        id: NodeId,
        op: BinOp,
        integer: ValueId,
        string: ValueId,
    ) -> ValueId {
        let origin = self.origin(id);
        let ordering = self.call_runtime(
            "nts_bigint_compare_string",
            vec![integer, string],
            HirType::NUMBER,
            &origin,
        );
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.push(
            OpKind::Binary {
                op,
                lhs: ordering,
                rhs: zero,
            },
            HirType::Bool,
            origin,
        )
    }
}
