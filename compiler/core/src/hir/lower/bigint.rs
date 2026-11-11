//! Exact BigInt/String relational comparisons, before numeric coercion.

use super::{BinOp, FuncBuilder, HirType, ManagedType, NodeId, OpKind, ValueId};
use super::{Diagnostic, Origin, Terminator, syntax};

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

impl FuncBuilder<'_> {
    /// `+x` with `x` a bigint, which is a `TypeError` whatever the value:
    /// implicit `ToNumber` of a `BigInt` throws. One fact for the lowering
    /// ([`Self::throw_to_number_of_a_bigint`]) and for the effect analysis
    /// that decides which handler can catch it.
    pub(super) fn plus_of_a_bigint(&self, id: NodeId) -> bool {
        self.kind_of(id) == Some(syntax::PREFIX_UNARY_EXPRESSION)
            && matches!(self.node(id).data, nts_semantic_schema::NodeData::Children { small, .. }
                if small & syntax::prefix_operator::MASK == syntax::prefix_operator::PLUS)
            && self
                .children(id)
                .last()
                .and_then(|operand| self.type_of(*operand))
                == Some(HirType::BigInt)
    }

    /// The `TypeError` `+1n` is. What follows the throw is unreachable, and
    /// answers NaN only so the expression has a value to be.
    pub(super) fn throw_to_number_of_a_bigint(
        &mut self,
        id: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        self.throw_provided_error(id, "TypeError", "Cannot convert a BigInt value to a number")?;
        let unreachable = self.new_block();
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: unreachable,
                args: Vec::new(),
            });
        }
        self.switch_to(unreachable);
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstFloat(f64::NAN), HirType::NUMBER, origin))
    }

    /// ECMAScript's exponentiation, which `**`, `**=` and `Math.pow` all spell.
    ///
    /// A call rather than an operation, because it is **not** C's `pow`: the
    /// specification says a base of 1 or -1 with an infinite exponent is NaN,
    /// where C99 says 1. The runtime holds that difference in one place; see
    /// `nts_math_pow`.
    pub(super) fn exponentiate(
        &mut self,
        id: NodeId,
        ty: HirType,
        base: ValueId,
        exponent: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        if self.values[base.0 as usize].ty == HirType::BigInt
            && self.values[exponent.0 as usize].ty == HirType::BigInt
        {
            // A negative exponent is a JavaScript RangeError, not a runtime
            // domain refusal. Lower its throw so a local or caller catch can
            // handle it, just as the radix guard does.
            if !matches!(self.values[exponent.0 as usize].kind, OpKind::ConstInt(n) if n >= 0) {
                let zero = self.push(OpKind::ConstInt(0), HirType::BigInt, origin.clone());
                let negative = self.push(
                    OpKind::Binary {
                        op: BinOp::Lt,
                        lhs: exponent,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                // Node v26.13.0/V8's observed text; this is oracle wording rather
                // than the specification's sentence about negative exponents.
                self.bigint_range_error_if(id, negative, "Exponent must be positive")?;
            }
            return Ok(self.runtime_call("nts_bigint_pow", vec![base, exponent], ty, origin));
        }
        if let OpKind::ConstFloat(power) = self.values[exponent.0 as usize].kind
            && let Some(folded) = self.fold_power(base, power, &ty, &origin)
        {
            return Ok(folded);
        }
        Ok(self.runtime_call("nts_math_pow", vec![base, exponent], ty, origin))
    }

    /// Lower bigint operator domain errors through the provided-error path,
    /// so both the local handler and a raising caller can catch them.
    fn bigint_range_error_if(
        &mut self,
        id: NodeId,
        invalid: ValueId,
        text: &str,
    ) -> Result<(), Diagnostic> {
        let throwing = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: invalid,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(throwing);
        let origin = self.origin(id);
        let message = self.push(
            OpKind::ConstString(text.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin,
        );
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// A zero bigint divisor throws before the backend's division/remainder.
    pub(super) fn require_bigint_divisor(
        &mut self,
        id: NodeId,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<(), Diagnostic> {
        if matches!(op, BinOp::Div | BinOp::Rem)
            && self.values[lhs.0 as usize].ty == HirType::BigInt
            && self.values[rhs.0 as usize].ty == HirType::BigInt
            && !matches!(self.values[rhs.0 as usize].kind, OpKind::ConstInt(n) if n != 0)
        {
            let origin = self.origin(id);
            let zero = self.push(OpKind::ConstInt(0), HirType::BigInt, origin.clone());
            let invalid = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: rhs,
                    rhs: zero,
                },
                HirType::Bool,
                origin,
            );
            self.bigint_range_error_if(id, invalid, "Division by zero")?;
        }
        Ok(())
    }

    /// `x ** k` for a literal `k`, where the operations spell it exactly.
    ///
    /// Worth doing because `nts_math_pow` lives in the runtime's translation
    /// unit, so the C compiler cannot see through it the way it sees through
    /// `pow` -- `x ** 2` would cost a call where the C++ it is measured against
    /// costs a multiply. `pow(x, 2)` is one of the calls clang folds itself,
    /// and this compiler has to fold its own.
    ///
    /// Three exponents, and the boundary was found by measurement rather than
    /// by reasoning:
    ///
    /// - `x ** 3` is **not** `x * x * x`. `pow` rounds the cube once and three
    ///   multiplications round twice, and they differ: at `x = -828.3432249414309`
    ///   the two answers are `-568369773.2487181` and `-568369773.2487183`.
    ///   A pool of interesting values agreed on every one of them, which is
    ///   what makes the case worth writing down.
    /// - `x ** -1` is **not** `1 / x` in practice, even though it is in theory:
    ///   both are the correctly rounded reciprocal, and V8's `pow` is not
    ///   correctly rounded at `x = -2.126284657577152e-37`. The specification
    ///   allows that -- `pow` is implementation-approximated -- so the fold
    ///   would be righter than node and would still be a difference.
    /// - `x ** 0.5` is not `sqrt(x)`: they disagree on `-0`, where `pow` gives
    ///   `+0` and `sqrt` gives `-0`.
    ///
    /// What is left is exact. `x * x` is the correctly rounded square for every
    /// double including the infinities, the zeros and NaN; `x ** 1` is `x`; and
    /// `x ** 0` is `1` for every base, NaN included, which the specification
    /// says before it says anything else about the base.
    // The comparisons here are exact on purpose: the exponent is a literal, and
    // folding `x ** 1.9999999999999998` as though it were `x ** 2` would be a
    // wrong answer rather than an imprecise one. A margin is what this lint
    // exists to suggest and is exactly what must not happen.
    #[allow(clippy::float_cmp)]
    fn fold_power(
        &mut self,
        base: ValueId,
        power: f64,
        ty: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        if power == 0.0 {
            return Some(self.push(OpKind::ConstFloat(1.0), ty.clone(), origin.clone()));
        }
        if power == 1.0 {
            return Some(base);
        }
        if power == 2.0 {
            return Some(self.push(
                OpKind::Binary {
                    op: BinOp::Mul,
                    lhs: base,
                    rhs: base,
                },
                ty.clone(),
                origin.clone(),
            ));
        }
        None
    }
}
