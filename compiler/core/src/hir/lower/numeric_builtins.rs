//! Lower Number methods and parsing entry points with the required argument and integer conversion.

use super::{
    BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, NumericBuiltin, OpKind, Origin,
    Terminator, UnOp, ValueId,
};

impl FuncBuilder<'_> {
    /// `n.toString(radix)`, with node's domain check in front of it.
    ///
    /// Lifted out of [`Self::lower_method_call`] for length, and the split is
    /// where it would be anyway: everything here is about the *argument* having
    /// a domain, and nothing above it is.
    fn lower_radix_to_string(
        &mut self,
        id: NodeId,
        value: ValueId,
        radix: ValueId,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let origin = origin.clone();
        // `(5).toString(1)` is a `RangeError` in node and a string
        // here, until this. The differential found it on the first run
        // -- it feeds arbitrary numbers, and nine of its cases were a
        // radix node refuses -- which is the whole argument for
        // comparing against node rather than against an expectation:
        // nothing in the source or the fixture says the argument has a
        // domain, and node says so nine times.
        //
        // The bound belongs here rather than in the runtime because a
        // provided `RangeError` is a *class*, and the runtime has no
        // way to construct one. That asymmetry is what
        // `throw_provided_error_text` exists for.
        //
        // The specification bounds `ToIntegerOrInfinity(radix)`, not the
        // number, and the two comparisons below are that bound exactly, with
        // no truncation emitted (`guard_repeat_count` makes the same move):
        // the integer is below 2 precisely when `!(radix >= 2)` -- which a
        // `NaN` satisfies, as `ToIntegerOrInfinity(NaN)` is 0 -- and above
        // 36 precisely when `radix >= 37`. Comparing the number itself let a
        // `NaN` through to the runtime's `(int)` and threw for `36.5`, which
        // node reads as base 36. The Wasm lane found both.
        let throwing = self.new_block();
        let carry_on = self.new_block();
        let two = self.push(OpKind::ConstFloat(2.0), HirType::NUMBER, origin.clone());
        let at_least_two = self.push(
            OpKind::Binary {
                op: BinOp::Ge,
                lhs: radix,
                rhs: two,
            },
            HirType::Bool,
            origin.clone(),
        );
        let checking = self.new_block();
        self.terminate(Terminator::Branch {
            cond: at_least_two,
            then_target: checking,
            then_args: Vec::new(),
            else_target: throwing,
            else_args: Vec::new(),
        });

        self.switch_to(checking);
        let thirty_seven = self.push(OpKind::ConstFloat(37.0), HirType::NUMBER, origin.clone());
        let above = self.push(
            OpKind::Binary {
                op: BinOp::Ge,
                lhs: radix,
                rhs: thirty_seven,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: above,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        // Node's exact sentence, and it names no value: `RangeError:
        // toString() radix must be between 2 and 36`.
        let text = HirType::Managed(ManagedType::String);
        let message = self.push(
            OpKind::ConstString("toString() radix must be between 2 and 36".into()),
            text,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }

        self.switch_to(carry_on);
        Ok(self.runtime_call(
            "nts_number_to_string_radix",
            vec![value, radix],
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// The methods a **number** receiver has here.
    ///
    /// Its own function because `lower_method_on` is at the line limit and this
    /// is the self-contained part: every arm tests the same `name` and none of
    /// them looks at anything the caller still needs.
    pub(super) fn lower_number_method(
        &mut self,
        id: NodeId,
        receiver_node: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .unwrap_or_default();
        if name == "toString" && arguments.is_empty() {
            return self.as_string(receiver_node, receiver);
        }
        // `n.toString(radix)`, which is three calls from every module's
        // front door: `ERR_INVALID_ARG_TYPE` renders the offending value
        // into its message, rendering a control character means a hex
        // escape, and `code.toString(16)` is that escape. A module cannot
        // validate an argument without this, and validating arguments is
        // what node's entry points do first.
        //
        // The receiver is widened to `f64` because the runtime takes one
        // and an `i32` receiver is common -- `charCodeAt` gives one.
        if name == "toString" && arguments.len() == 1 {
            let radix = self.lower_expression(arguments[0])?;
            let radix = self.builtin_number_argument(
                (id, arguments[0]),
                NumericBuiltin::NumberMethod(&name),
                1,
                radix,
            )?;
            let radix = self.coerce(radix, &HirType::NUMBER, arguments[0])?;
            let value = self.coerce(receiver, &HirType::NUMBER, receiver_node)?;
            let origin = self.origin(id);

            return self.lower_radix_to_string(id, value, radix, &origin);
        }
        // `n.toFixed(d)`, which the widened statement fuzzer reached and
        // nothing else had: 14 draws in 3,000 cases, and the only wall in
        // that run that was not already a decision.
        //
        // The digits are range-checked the way `toString`'s radix is, in
        // node's own sentence, because the specification throws for the
        // same reason: a `RangeError` at run time is the answer, and there
        // is nowhere at compile time to put it.
        if name == "toFixed" && arguments.len() == 1 {
            let digits = self.lower_expression(arguments[0])?;
            let digits = self.builtin_number_argument(
                (id, arguments[0]),
                NumericBuiltin::NumberMethod(&name),
                1,
                digits,
            )?;
            let digits = self.coerce(digits, &HirType::NUMBER, arguments[0])?;
            let value = self.coerce(receiver, &HirType::NUMBER, receiver_node)?;
            let origin = self.origin(id);

            return self.lower_fixed_to_string(id, value, digits, &origin);
        }
        Err(self.unsupported(id, &format!("`{name}` on a number")))
    }

    /// `ToIntegerOrInfinity` after the caller has performed `ToNumber`.
    ///
    /// Truncation preserves infinities. A zero or NaN becomes positive zero;
    /// comparing the truncated magnitude with zero handles both without any
    /// float-to-integer cast. Domain checks must read this result, and the
    /// runtime receives the same integer that was checked.
    fn lower_to_integer_or_infinity(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        // Keep constant calls such as `toFixed(3)` free of conversion control
        // flow on every backend. Numeric signs are pure too; do not evaluate
        // a load, call, conversion or a narrower float as a literal.
        let mut literal = value;
        let mut negative = false;
        loop {
            let argument = &self.values[literal.0 as usize];
            if argument.ty != HirType::NUMBER {
                break;
            }
            match argument.kind {
                OpKind::ConstFloat(number) => {
                    let whole = (if negative { -number } else { number }).trunc();
                    let integer = if whole.is_nan() || whole == 0.0 {
                        0.0
                    } else {
                        whole
                    };
                    if integer.to_bits() == number.to_bits() {
                        return literal;
                    }
                    return self.push(OpKind::ConstFloat(integer), HirType::NUMBER, origin.clone());
                }
                OpKind::Unary {
                    op: UnOp::Neg,
                    operand,
                } => {
                    literal = operand;
                    negative = !negative;
                }
                _ => break,
            }
        }
        let whole = self.push(
            OpKind::Unary {
                op: UnOp::Trunc,
                operand: value,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let magnitude = self.push(
            OpKind::Unary {
                op: UnOp::Abs,
                operand: whole,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let nonzero = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: magnitude,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let keep = self.new_block();
        let carry_on = self.new_block();
        let integer = self.push_block_param(carry_on, HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Branch {
            cond: nonzero,
            then_target: keep,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: vec![zero],
        });
        self.switch_to(keep);
        self.terminate(Terminator::Jump {
            target: carry_on,
            args: vec![whole],
        });
        self.switch_to(carry_on);
        integer
    }

    /// `n.toFixed(d)`, with the domain the specification gives it.
    ///
    /// The same shape as [`Self::lower_radix_to_string`] and for the same
    /// reason: the bound belongs here rather than in the runtime because a
    /// provided `RangeError` is a *class* and the runtime has no way to
    /// construct one.
    ///
    /// `nts_number_to_fixed` carries why the formatting is not `printf` -- the
    /// specification rounds half *away from zero* and C rounds half to even,
    /// which disagree on every exact tie.
    fn lower_fixed_to_string(
        &mut self,
        id: NodeId,
        value: ValueId,
        digits: ValueId,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let origin = origin.clone();
        let digits = self.lower_to_integer_or_infinity(digits, &origin);
        let throwing = self.new_block();
        let carry_on = self.new_block();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let below = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: digits,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let checking = self.new_block();
        self.terminate(Terminator::Branch {
            cond: below,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: checking,
            else_args: Vec::new(),
        });

        self.switch_to(checking);
        let hundred = self.push(OpKind::ConstFloat(100.0), HirType::NUMBER, origin.clone());
        let above = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: digits,
                rhs: hundred,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: above,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        // Node's exact sentence: `RangeError: toFixed() digits argument must be
        // between 0 and 100`.
        let text = HirType::Managed(ManagedType::String);
        let message = self.push(
            OpKind::ConstString("toFixed() digits argument must be between 0 and 100".into()),
            text,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }

        self.switch_to(carry_on);
        Ok(self.runtime_call(
            "nts_number_to_fixed",
            vec![value, digits],
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// A global function this compiler implements, if this call names one.
    ///
    /// `None` means the name is not one of them, which is a different answer
    /// from `Some(Err(..))`: the second is a builtin that is provided and was
    /// given something it cannot take, and it says so rather than falling
    /// through to "a builtin this compiler does not provide".
    /// `parseInt(string, radix)`.
    ///
    /// The radix defaults to **zero** rather than to ten, because zero is what
    /// the specification's "decide from the text" is: `parseInt("0x1f")` is 31
    /// and `parseInt("0x1f", 10)` is 0. Passing ten as the default would answer
    /// the second for both.
    pub(super) fn lower_parse_int(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(text) = arguments.first() else {
            return Err(self.unsupported(id, "`parseInt` with no argument"));
        };
        let values = self.builtin_raw_arguments(NumericBuiltin::ParseRadix, arguments, None)?;
        let value = values[0];
        let value = self.coerce(value, &HirType::Managed(ManagedType::String), *text)?;
        let origin = self.origin(id);
        let radix = match arguments.get(1) {
            // ToNumber precedes ToInt32: unchecked JavaScript can pass a
            // boolean or undefined. Normalize it before the shared integer
            // operation, whose constant folding and int32 identity apply at
            // the call site instead of inside an out-of-line parser.
            Some(node) => {
                let number = self.builtin_number_argument(
                    (id, *node),
                    NumericBuiltin::ParseRadix,
                    2,
                    values[1],
                )?;
                self.coerce(number, &HirType::NUMBER, *node)?
            }
            None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };
        let radix = self.push(
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: radix,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        Ok(self.runtime_call("nts_parse_int", vec![value, radix], HirType::NUMBER, origin))
    }

    /// `parseFloat(string)`.
    ///
    /// No radix, so no default to get wrong -- the grammar decides, and
    /// `nts_parse_float` is where it lives. What it is *not* is `Number(s)`:
    /// `Number("12abc")` is NaN and `parseFloat("12abc")` is 12, which is the
    /// same difference `lower_parse_int` records.
    pub(super) fn lower_parse_float(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(text) = arguments.first() else {
            return Err(self.unsupported(id, "`parseFloat` with no argument"));
        };
        let value = self.lower_expression(*text)?;
        let value = self.coerce(value, &HirType::Managed(ManagedType::String), *text)?;
        let origin = self.origin(id);
        Ok(self.runtime_call("nts_parse_float", vec![value], HirType::NUMBER, origin))
    }

    /// `encodeURI`, `encodeURIComponent`, `decodeURI` and `decodeURIComponent`.
    ///
    /// The runtime does the transcoding and answers `NULL` for input the other
    /// direction could not have produced -- a truncated escape, an overlong
    /// encoding, an unpaired surrogate. **A runtime function here cannot
    /// throw**, so the `URIError` is raised from this side, which is the same
    /// split `lower_repeat` makes for its `RangeError`.
    ///
    /// The message is node's, character for character. `querystring.parse`
    /// catches this by class and not by text, but a message that differs from
    /// node's is a difference a test can see and there is no reason to have
    /// one.
    pub(super) fn lower_uri(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        encode: bool,
        component: bool,
    ) -> Result<ValueId, Diagnostic> {
        let Some(text) = arguments.first() else {
            return Err(self.unsupported(id, "a URI builtin with no argument"));
        };
        let value = self.lower_expression(*text)?;
        let value = self.coerce(value, &HirType::Managed(ManagedType::String), *text)?;
        let origin = self.origin(id);
        let flag = self.push(
            OpKind::ConstFloat(if component { 1.0 } else { 0.0 }),
            HirType::NUMBER,
            origin.clone(),
        );
        let callee = if encode {
            "nts_encode_uri"
        } else {
            "nts_decode_uri"
        };
        let string = HirType::Managed(ManagedType::String);
        let built = self.runtime_call(callee, vec![value, flag], string.clone(), origin.clone());

        // `NULL` is the refusal, and it is tested here rather than left to the
        // caller: every use of the result reads a length or a unit through it,
        // so an untested `NULL` is a load from address zero rather than the
        // `URIError` the language specifies.
        let nothing = self.push(OpKind::ConstNull, string, origin.clone());
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: built,
                rhs: nothing,
            },
            HirType::Bool,
            origin.clone(),
        );
        let throwing = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: failed,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(throwing);
        self.throw_provided_error(id, "URIError", "URI malformed")?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(built)
    }
}
