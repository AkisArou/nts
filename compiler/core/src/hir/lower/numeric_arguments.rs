//! Primitive `ToNumber` at language-defined builtin argument positions.
//!
//! A helper's `f64` parameter also stores array elements and native arguments;
//! its representation grants no conversion. This catalog is the semantic
//! authority. Only `undefined` selects a default: `null`
//! always follows `ToNumber(null)` to positive zero.

use super::{
    BinOp, BlockId, Diagnostic, FuncBuilder, HirType, ManagedType, MethodsOf, NodeId, OpKind,
    Terminator, ValueId, syntax,
};
use crate::hir::tags;

#[derive(Clone, Copy)]
pub(super) enum Builtin<'a> {
    Method(MethodsOf, &'a str),
    Math,
    GlobalPredicate,
    NumberPredicate,
    StringFactory,
    NumberMethod(&'a str),
    BigIntWidth,
    ParseRadix,
    TypedOf { bigint: bool },
}

#[derive(Clone, Copy)]
enum Undefined {
    ToNumber,
    Constant(f64),
}

/// Positions count source arguments from one, excluding the receiver.
fn contract(builtin: Builtin<'_>, position: usize) -> Option<Undefined> {
    use Builtin as B;
    use MethodsOf::{Array, String};
    use Undefined::{Constant, ToNumber};
    match (builtin, position) {
        (
            B::Method(_, "slice")
            | B::Method(String, "substring" | "substr" | "lastIndexOf" | "endsWith"),
            2,
        )
        | (B::Method(Array, "fill" | "copyWithin"), 3) => Some(Constant(f64::INFINITY)),
        (B::Method(String, "split"), 2) => Some(Constant(4_294_967_295.0)),
        (B::NumberMethod("toString"), 1) => Some(Constant(10.0)),
        (B::Math | B::StringFactory | B::TypedOf { bigint: false }, 1..)
        | (
            B::GlobalPredicate
            | B::BigIntWidth
            | B::NumberMethod("toFixed")
            | B::Method(_, "at" | "slice")
            | B::Method(Array, "splice" | "toSpliced" | "with" | "copyWithin")
            | B::Method(
                String,
                "charAt" | "charCodeAt" | "codePointAt" | "substring" | "substr" | "repeat"
                | "padStart" | "padEnd",
            ),
            1,
        )
        | (
            B::ParseRadix
            | B::Method(
                Array,
                "splice" | "toSpliced" | "lastIndexOf" | "fill" | "copyWithin" | "indexOf"
                | "includes",
            )
            | B::Method(String, "indexOf" | "includes" | "startsWith"),
            2,
        ) => Some(ToNumber),
        // Number predicates, array values/needles, BigInt elements, and every
        // other unlisted position are storage rather than a conversion point.
        _ => None,
    }
}

impl FuncBuilder<'_> {
    pub(super) fn builtin_string_unit_at(
        &mut self,
        at: NodeId,
        string: ValueId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let value = self.builtin_raw_argument(
            argument,
            contract(Builtin::Method(MethodsOf::String, "charCodeAt"), 1).is_some(),
        )?;
        let index = self.builtin_number_argument(
            (at, argument),
            Builtin::Method(MethodsOf::String, "charCodeAt"),
            1,
            value,
        )?;
        Ok(self.push(
            OpKind::StringUnitAt {
                string,
                index,
                checked: true,
            },
            HirType::NUMBER,
            self.origin(at),
        ))
    }

    /// Evaluate before conversion, retaining ordinary admission at storage,
    /// needle and text positions. Only a caller that owns ignored surplus
    /// arguments may supply its admitted arity in `ignored_after`.
    pub(super) fn builtin_raw_arguments(
        &mut self,
        builtin: Builtin<'_>,
        arguments: &[NodeId],
        ignored_after: Option<usize>,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        arguments
            .iter()
            .enumerate()
            .map(|(index, source)| {
                let position = index + 1;
                let raw_absence = contract(builtin, position).is_some()
                    || ignored_after.is_some_and(|arity| position > arity);
                self.builtin_raw_argument(*source, raw_absence)
            })
            .collect()
    }

    fn builtin_raw_argument(
        &mut self,
        source: NodeId,
        raw_absence: bool,
    ) -> Result<ValueId, Diagnostic> {
        if !raw_absence {
            return self.lower_expression(source);
        }
        let literal = self.through_parentheses(source);
        let absence = if self.kind_of(literal) == Some(syntax::NULL_KEYWORD) {
            Some(OpKind::ConstNull)
        } else if self.is_the_undefined_literal(literal) {
            Some(OpKind::ConstUndefined)
        } else {
            None
        };
        if let Some(absence) = absence {
            // The call's number parameter is not the literal's representation:
            // raw evaluation precedes the builtin's ToNumber/default policy.
            return self.absent_at(absence, Some(HirType::Erased), source);
        }
        self.lower_expression(source)
    }

    /// Evaluate the source list before a builtin can throw while converting it.
    pub(super) fn builtin_arguments(
        &mut self,
        at: NodeId,
        builtin: Builtin<'_>,
        arguments: &[NodeId],
    ) -> Result<Vec<ValueId>, Diagnostic> {
        let values = self.builtin_raw_arguments(builtin, arguments, None)?;
        arguments
            .iter()
            .zip(values)
            .enumerate()
            .map(|(index, (source, value))| {
                self.builtin_number_argument((at, *source), builtin, index + 1, value)
            })
            .collect()
    }

    pub(super) fn builtin_number_argument(
        &mut self,
        site: (NodeId, NodeId),
        builtin: Builtin<'_>,
        position: usize,
        value: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let Some(undefined) = contract(builtin, position) else {
            return Ok(value);
        };
        self.convert_builtin_number(site, value, undefined)
    }

    fn convert_builtin_number(
        &mut self,
        (at, source): (NodeId, NodeId),
        value: ValueId,
        undefined: Undefined,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(at);
        // Literal absences have no native scalar payload to erase. This is a
        // semantic numeric argument position, so consume the actual constant
        // with its catalog policy before asking for a representation change.
        match self.values[value.0 as usize].kind {
            OpKind::ConstUndefined => return Ok(self.builtin_undefined_value(at, undefined)),
            OpKind::ConstNull => {
                return Ok(self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin));
            }
            _ => {}
        }
        let native = match self.values[value.0 as usize].ty {
            // An i32 is already a JavaScript number. Keep its width, as a
            // StringUnitAt index does, instead of pinning its loop to f64.
            HirType::Int { .. } | HirType::Float { .. } => Some(value),
            HirType::Bool => Some(self.push(OpKind::Convert(value), HirType::NUMBER, origin)),
            HirType::BigInt => Some(self.numeric_type_error(at, "BigInt")?),
            // A nullable managed symbol has the same pointer representation.
            // Only the source can prove the pointer cannot be an absence;
            // otherwise erasure below preserves its null/undefined tag.
            HirType::Managed(ManagedType::Symbol)
                if self
                    .absences_of(source)
                    .is_some_and(|absent| absent.is_empty()) =>
            {
                Some(self.numeric_type_error(at, "Symbol")?)
            }
            _ => None,
        };
        if let Some(value) = native {
            return Ok(value);
        }
        let value = self.coerce(value, &HirType::Erased, source)?;
        self.tagged_builtin_number(at, value, undefined)
    }

    fn tagged_builtin_number(
        &mut self,
        at: NodeId,
        value: ValueId,
        undefined: Undefined,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(at);
        let tag = self.push(OpKind::TagOf { value }, I32, origin.clone());
        let merge = NumericMerge::new(self, at);
        let number = self.new_block();
        let cold = self.new_block();
        let is_number = is_tag(self, at, tag, tags::NUMBER);
        self.terminate(Terminator::Branch {
            cond: is_number,
            then_target: number,
            then_args: Vec::new(),
            else_target: cold,
            else_args: Vec::new(),
        });
        self.switch_to(number);
        let number = self.push(OpKind::unerase(value), HirType::NUMBER, origin);
        merge.jump(self, number);
        self.switch_to(cold);
        self.non_number_builtin(at, (value, tag), undefined, &merge)?;
        self.switch_to(merge.block);
        Ok(merge.value)
    }

    fn non_number_builtin(
        &mut self,
        at: NodeId,
        (value, tag): (ValueId, ValueId),
        undefined: Undefined,
        merge: &NumericMerge,
    ) -> Result<(), Diagnostic> {
        let absent = self.new_block();
        let next = self.new_block();
        let is_undefined = is_tag(self, at, tag, tags::UNDEFINED);
        self.terminate(Terminator::Branch {
            cond: is_undefined,
            then_target: absent,
            then_args: Vec::new(),
            else_target: next,
            else_args: Vec::new(),
        });
        self.switch_to(absent);
        let default = self.builtin_undefined_value(at, undefined);
        merge.jump(self, default);
        self.switch_to(next);
        for (expected, name) in [(tags::SYMBOL, "Symbol"), (tags::BIGINT, "BigInt")] {
            let throwing = self.new_block();
            let next = self.new_block();
            let matches = is_tag(self, at, tag, expected);
            self.terminate(Terminator::Branch {
                cond: matches,
                then_target: throwing,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(throwing);
            self.numeric_type_error(at, name)?;
            self.terminate(Terminator::Unreachable);
            self.switch_to(next);
        }
        self.primitive_builtin_number(at, value, tag, merge);
        Ok(())
    }

    fn builtin_undefined_value(&mut self, at: NodeId, undefined: Undefined) -> ValueId {
        let origin = self.origin(at);
        match undefined {
            Undefined::ToNumber => self.push(OpKind::ConstFloat(f64::NAN), HirType::NUMBER, origin),
            Undefined::Constant(number) => {
                self.push(OpKind::ConstFloat(number), HirType::NUMBER, origin)
            }
        }
    }

    fn primitive_builtin_number(
        &mut self,
        at: NodeId,
        value: ValueId,
        tag: ValueId,
        merge: &NumericMerge,
    ) {
        let primitive = self.new_block();
        for allowed in [tags::BOOLEAN, tags::STRING, tags::NULL] {
            let next = self.new_block();
            let matches = is_tag(self, at, tag, allowed);
            self.terminate(Terminator::Branch {
                cond: matches,
                then_target: primitive,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(next);
        }
        let origin = self.origin(at);
        let reason = self.push(OpKind::ConstString(
            "an object converted to a number, whose ToPrimitive conversion this compiler does not yet perform".to_owned().into(),
        ), HirType::Managed(ManagedType::String), origin.clone());
        self.runtime_call("nts_refused", vec![reason], HirType::Void, origin.clone());
        self.terminate(Terminator::Unreachable);
        self.switch_to(primitive);
        let converted =
            self.runtime_call("nts_value_to_number", vec![value], HirType::NUMBER, origin);
        merge.jump(self, converted);
    }

    fn numeric_type_error(&mut self, at: NodeId, kind: &str) -> Result<ValueId, Diagnostic> {
        self.throw_provided_error(
            at,
            "TypeError",
            &format!("Cannot convert a {kind} value to a number"),
        )?;
        let unreachable = self.new_block();
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: unreachable,
                args: Vec::new(),
            });
        }
        self.switch_to(unreachable);
        Ok(self.push(
            OpKind::ConstFloat(f64::NAN),
            HirType::NUMBER,
            self.origin(at),
        ))
    }
}

const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};

struct NumericMerge {
    block: BlockId,
    value: ValueId,
}

impl NumericMerge {
    fn new(builder: &mut FuncBuilder<'_>, at: NodeId) -> Self {
        let block = builder.new_block();
        let value = builder.push_block_param(block, HirType::NUMBER, builder.origin(at));
        Self { block, value }
    }

    fn jump(&self, builder: &mut FuncBuilder<'_>, value: ValueId) {
        builder.terminate(Terminator::Jump {
            target: self.block,
            args: vec![value],
        });
    }
}

fn is_tag(builder: &mut FuncBuilder<'_>, at: NodeId, tag: ValueId, expected: u32) -> ValueId {
    let origin = builder.origin(at);
    let expected = builder.push(OpKind::ConstInt(i128::from(expected)), I32, origin.clone());
    builder.push(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: tag,
            rhs: expected,
        },
        HirType::Bool,
        origin,
    )
}
