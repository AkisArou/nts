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
        lhs: ValueId,
        rhs: ValueId,
    ) -> Option<ValueId> {
        if !matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge) {
            return None;
        }
        let (integer, string, op) = match (
            &self.values[lhs.0 as usize].ty,
            &self.values[rhs.0 as usize].ty,
        ) {
            (HirType::BigInt, HirType::Managed(ManagedType::String)) => (lhs, rhs, op),
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
                (rhs, lhs, reversed)
            }
            _ => return None,
        };
        let origin = self.origin(id);
        let ordering = self.call_runtime(
            "nts_bigint_compare_string",
            vec![integer, string],
            HirType::NUMBER,
            &origin,
        );
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Some(self.push(
            OpKind::Binary { op, lhs: ordering, rhs: zero },
            HirType::Bool,
            origin,
        ))
    }
}
