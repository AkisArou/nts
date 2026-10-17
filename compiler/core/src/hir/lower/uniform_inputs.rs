//! Implementation-side primitive admission and defaults for uniform calls.
//!
//! The ordinary typed body keeps its ABI. Defaults already owned by a
//! parameter entry stay there; caller-filled defaults gain an implementation
//! prefix in the uniform entry, in the closure's original environment.

use nts_diagnostics::Diagnostic;
use nts_semantic_schema::{NodeId, syntax};

use super::{
    Absent, BinOp, Callee, ClosureInfo, ClosureSource, Func, FuncBuilder, HirType, ManagedType, Op,
    OpKind, Origin, Param, ParamShape, Terminator, UnOp, ValueId,
};
use crate::hir::{native, tags};

pub(super) struct Plan {
    pub(super) needed: bool,
    pub(super) binds_defaults: bool,
    leading: usize,
    inputs: Vec<Input>,
}

struct Input {
    source: Option<NodeId>,
    initializer: Option<NodeId>,
    delegated: bool,
    wanted: HirType,
    numeric: HirType,
    absent: Absent,
    known: super::Facts,
    bigint_range: Option<(i128, i128)>,
}

impl Input {
    fn narrowed(&self) -> bool {
        matches!(
            self.numeric,
            HirType::Int { .. } | HirType::Float { bits: 32 }
        ) || (matches!(self.numeric, HirType::Float { .. }) && self.known != super::Facts::TOP)
            || self.bigint_range.is_some()
    }
}

/// A native spelling is a store contract even when lowering keeps the body
/// input as `number`. Use it to build guards, never to seed the raw parameter.
#[allow(clippy::cast_precision_loss)]
fn numeric_contract(parameter: &Param, wanted: &HirType) -> (HirType, super::Facts) {
    if matches!(wanted, HirType::Float { .. } | HirType::Int { .. })
        && let Some(kind) = parameter.written
    {
        let known = kind
            .range_on(native::Targets::ALL)
            .map_or(super::Facts::TOP, |(lo, hi)| {
                super::Facts::new(lo as f64, hi as f64, true, false, false)
            });
        (
            kind.width_on(native::Targets::ALL),
            parameter.known.narrow(known),
        )
    } else {
        (wanted.clone(), parameter.known)
    }
}

pub(super) fn primitive(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Float { .. }
            | HirType::Int { .. }
            | HirType::Bool
            | HirType::BigInt
            | HirType::Managed(
                ManagedType::BoxedBigInt | ManagedType::String | ManagedType::Symbol
            )
    )
}

impl FuncBuilder<'_> {
    fn uniform_owner(&self, info: &ClosureInfo) -> Option<NodeId> {
        match info.source {
            ClosureSource::Authored => Some(info.node),
            ClosureSource::Function | ClosureSource::Method => {
                Some(self.implementation_of(info.node))
            }
            _ => None,
        }
    }

    pub(super) fn uniform_input_plan(&self, body: &Func, info: &ClosureInfo) -> Plan {
        let declarations = self.uniform_declarations(info);
        let bound_absences = self.uniform_bound_absences(info);
        let owns_defaults = self
            .uniform_owner(info)
            .is_some_and(|owner| self.owns_parameter_defaults(owner));
        let leading = if info.reads_this {
            super::super::UNIFORM_ARGUMENTS
        } else {
            1
        };
        let inputs: Vec<_> = body.params[leading..]
            .iter()
            .enumerate()
            .map(|(position, parameter)| {
                let declaration = declarations.get(position).copied();
                let source = declaration.and_then(|declaration| self.parameter_name(declaration));
                let initializer = declaration.and_then(|declaration| self.default_of(declaration));
                let delegated = initializer.is_some() && owns_defaults;
                let wanted = if delegated {
                    source
                        .and_then(|source| self.type_of(source))
                        .unwrap_or_else(|| parameter.ty.clone())
                } else {
                    parameter.ty.clone()
                };
                let absent = source.map_or_else(
                    || {
                        if tags::payload_is_a_reference(&wanted) {
                            bound_absences
                                .get(position)
                                .copied()
                                .unwrap_or(Absent::Impossible)
                        } else {
                            Absent::Impossible
                        }
                    },
                    |source| self.absence_at_excluding(source, &wanted, false),
                );
                let bigint_range = (wanted == HirType::BigInt)
                    .then(|| parameter.written?.range_on(native::Targets::ALL))
                    .flatten();
                let (numeric, known) = numeric_contract(parameter, &wanted);
                Input {
                    source,
                    initializer,
                    delegated,
                    wanted,
                    numeric,
                    absent,
                    known,
                    bigint_range,
                }
            })
            .collect();
        let binds_defaults =
            !owns_defaults && inputs.iter().any(|input| input.initializer.is_some());
        Plan {
            needed: binds_defaults || inputs.iter().any(|input| primitive(&input.wanted)),
            binds_defaults,
            leading,
            inputs,
        }
    }

    fn uniform_bound_absences(&self, info: &ClosureInfo) -> Vec<Absent> {
        if info.source != ClosureSource::Bound {
            return Vec::new();
        }
        let Some(super::TypeKind::Function(signature)) = self
            .snapshot
            .node_types
            .get(&info.node)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .map(|record| &record.kind)
        else {
            return Vec::new();
        };
        self.snapshot
            .signatures
            .get(signature.0 as usize)
            .and_then(|signature| self.bound_parameter_types(info.node, signature).ok())
            .unwrap_or_default()
            .into_iter()
            .map(|(_, ty)| super::absent_of_result(self.snapshot, ty))
            .collect()
    }

    /// A bound body forwards its own parameters without a source argument
    /// node. The `bind` expression's function type cannot say which absence a
    /// null string/symbol pointer carries; its positional parameter type can.
    pub(super) fn erase_bound_inputs(&mut self, info: &ClosureInfo, args: &mut [ValueId]) {
        for (argument, absent) in args.iter_mut().zip(self.uniform_bound_absences(info)) {
            let ty = &self.values[argument.0 as usize].ty;
            if primitive(ty) && tags::payload_is_a_reference(ty) && absent != Absent::Impossible {
                *argument = self.push(
                    OpKind::Erase {
                        value: *argument,
                        absent,
                        slots: Absent::Impossible,
                    },
                    HirType::Erased,
                    self.origin(info.node),
                );
            }
        }
    }

    /// Align the source declarations with the actual positional body ABI.
    /// A fixed tuple rest expands to several inputs, all from the same
    /// declaration; it cannot have an initializer or a later parameter.
    fn uniform_declarations(&self, info: &ClosureInfo) -> Vec<NodeId> {
        let Some(owner) = self.uniform_owner(info) else {
            return Vec::new();
        };
        let mut declarations = Vec::new();
        for parameter in super::parameters_of(self, owner) {
            let Some(name) = self.parameter_name(parameter) else {
                continue;
            };
            if self.annotates_this(name) {
                continue;
            }
            let rest = self
                .children(parameter)
                .into_iter()
                .any(|child| self.kind_of(child) == Some(syntax::DOT_DOT_DOT_TOKEN));
            let count = if rest {
                self.snapshot
                    .node_types
                    .get(&name)
                    .copied()
                    .and_then(|ty| self.fixed_arity_positions(ty))
                    .map_or(1, |positions| positions.len())
            } else {
                1
            };
            declarations.extend(std::iter::repeat_n(parameter, count));
        }
        declarations
    }

    fn parameter_name(&self, declaration: NodeId) -> Option<NodeId> {
        self.children(declaration).into_iter().find(|child| {
            matches!(
                self.kind_of(*child),
                Some(
                    syntax::IDENTIFIER
                        | syntax::ARRAY_BINDING_PATTERN
                        | syntax::OBJECT_BINDING_PATTERN
                )
            )
        })
    }

    pub(super) fn uniform_entry(
        &mut self,
        name: String,
        body: &Func,
        (params, values): (Vec<Param>, Vec<Op>),
        (info, plan): (&ClosureInfo, &Plan),
        result_absent: Absent,
    ) -> Result<Func, Diagnostic> {
        self.values = values;
        self.returns = HirType::Erased;
        self.in_closure = true;
        let receiver = ValueId(0);
        let binds_defaults = plan.binds_defaults;
        if binds_defaults {
            self.this = Some(receiver);
            self.bind_own_name(info.node, receiver);
            if info.source.binds_receiver() {
                self.bind_receiver(info.node, receiver, &body.origin)?;
            } else {
                self.bind_captures(receiver, info, &body.origin)?;
            }
        }
        let leading = plan.leading;
        let mut args = vec![receiver];
        if info.reads_this {
            let this = ValueId(u32::try_from(super::super::UNIFORM_THIS).unwrap_or(u32::MAX));
            args.push(this);
            if binds_defaults {
                self.this = Some(self.receive_this(info.node, this)?);
            }
        }
        for (position, parameter) in body.params[leading..].iter().enumerate() {
            let raw = ValueId(
                u32::try_from(position + super::super::UNIFORM_ARGUMENTS).unwrap_or(u32::MAX),
            );
            let input = &plan.inputs[position];
            if binds_defaults
                && let Some(initializer) = input.initializer
                && let Some(owner) = self.uniform_owner(info)
            {
                // Unsupported capturing defaults must keep the same named
                // refusal when ownership moves from the caller to this entry.
                self.check_caller_filled_default(initializer, owner)?;
            }
            let source = input.source;
            let at = source.unwrap_or(info.node);
            let value = self.uniform_value(raw, input, parameter, at, &body.name)?;
            args.push(value);
            if binds_defaults
                && parameter.shape != ParamShape::Rest
                && let Some(source) = source
                && self.kind_of(source) == Some(syntax::IDENTIFIER)
                && let Some(symbol) = self.node(source).symbol
            {
                let value = self.open_cell(symbol.0, value, source);
                self.bindings.insert(symbol.0, value);
            }
        }
        if binds_defaults {
            self.forward_uniform_bindings(body, plan, &mut args)?;
        }
        let answered = self.push(
            OpKind::Call {
                callee: Callee::Direct(body.name.clone()),
                args,
                frame: None,
            },
            body.return_type.clone(),
            body.origin.clone(),
        );
        let answer = match &body.return_type {
            HirType::Erased => answered,
            ty if matches!(ty, HirType::Void | HirType::Never) || !super::result_crosses(ty) => {
                self.push(OpKind::ConstUndefined, HirType::Erased, body.origin.clone())
            }
            _ => self.push(
                OpKind::Erase {
                    value: answered,
                    absent: result_absent,
                    slots: Absent::Impossible,
                },
                HirType::Erased,
                body.origin.clone(),
            ),
        };
        self.terminate(Terminator::Return(Some(answer)));
        Ok(self.finish(name, params, HirType::Erased, body.origin.clone(), false))
    }

    fn uniform_value(
        &mut self,
        raw: ValueId,
        input: &Input,
        parameter: &Param,
        at: NodeId,
        body: &str,
    ) -> Result<ValueId, Diagnostic> {
        let selected = if input.narrowed() && !input.delegated {
            if let Some(initializer) = input.initializer {
                self.bind_parameter_default(raw, initializer, &HirType::Erased)?
            } else {
                raw
            }
        } else {
            raw
        };
        let checked = self.check_uniform_primitive(
            selected,
            input,
            input.initializer.is_some() && (input.delegated || !input.narrowed()),
            &self.origin(at),
            (body, &parameter.name),
        );
        if input.delegated {
            // The existing parameter entry owns the initializer and its cells.
            return Ok(raw);
        }
        if let Some(checked) = checked {
            // Keep the checked value as the conversion's input. In particular
            // a float32 body's number slot retains its rounded provenance when
            // the store validator looks through this final representation step.
            return Ok(self.push(
                OpKind::Convert(checked),
                parameter.ty.clone(),
                parameter.origin.clone(),
            ));
        }
        if let Some(initializer) = input.initializer {
            self.bind_parameter_default(raw, initializer, &input.wanted)
        } else if parameter.ty == HirType::Erased {
            Ok(raw)
        } else {
            Ok(self.push(
                OpKind::Unerase { value: raw },
                parameter.ty.clone(),
                parameter.origin.clone(),
            ))
        }
    }

    fn forward_uniform_bindings(
        &mut self,
        body: &Func,
        plan: &Plan,
        args: &mut [ValueId],
    ) -> Result<(), Diagnostic> {
        // A later initializer may assign an earlier parameter. Hand the
        // body the final binding, rather than its value at first binding.
        for (position, parameter) in body.params[plan.leading..].iter().enumerate() {
            if parameter.shape == ParamShape::Rest {
                continue;
            }
            if let Some(source) = plan.inputs[position].source
                && self.kind_of(source) == Some(syntax::IDENTIFIER)
                && let Some(symbol) = self.node(source).symbol
                && let Some(bound) = self.bindings.get(&symbol.0).copied()
            {
                args[plan.leading + position] =
                    self.read_cell(symbol.0, bound, source)?.unwrap_or(bound);
            }
        }
        Ok(())
    }

    fn check_uniform_primitive(
        &mut self,
        raw: ValueId,
        input: &Input,
        defaulted: bool,
        origin: &Origin,
        names: (&str, &str),
    ) -> Option<ValueId> {
        let ty = &input.wanted;
        let absent = input.absent;
        let primary = match ty {
            HirType::Float { .. } | HirType::Int { .. } => tags::NUMBER,
            HirType::Bool => tags::BOOLEAN,
            HirType::BigInt | HirType::Managed(ManagedType::BoxedBigInt) => tags::BIGINT,
            HirType::Managed(ManagedType::String) => tags::STRING,
            HirType::Managed(ManagedType::Symbol) => tags::SYMBOL,
            // Reference storage/layout admission is separately scoped. An
            // OBJECT tag is deliberately not claimed as proof of storage here.
            _ => return None,
        };
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = self.push(
            OpKind::TagOf { value: raw },
            unsigned.clone(),
            origin.clone(),
        );
        let accepted = self.new_block();
        let narrowed = input.narrowed();
        let numeric = if narrowed { self.new_block() } else { accepted };
        let mut allowed = vec![(primary, numeric)];
        if defaulted || absent == Absent::Undefined {
            allowed.push((tags::UNDEFINED, accepted));
        }
        if absent == Absent::Null {
            allowed.push((tags::NULL, accepted));
        }
        for (candidate, target) in allowed {
            let next = self.new_block();
            let expected = self.push(
                OpKind::ConstInt(i128::from(candidate)),
                unsigned.clone(),
                origin.clone(),
            );
            let condition = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: tag,
                    rhs: expected,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.terminate(Terminator::Branch {
                cond: condition,
                then_target: target,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(next);
        }
        self.uniform_mismatch(names, origin);
        let checked = if narrowed {
            self.switch_to(numeric);
            let checked = if let Some(range) = input.bigint_range {
                self.check_uniform_bigint(raw, range, names, origin)
            } else {
                self.check_uniform_numeric(raw, &input.numeric, input.known, names, origin)
            };
            self.terminate(Terminator::Jump {
                target: accepted,
                args: Vec::new(),
            });
            Some(checked)
        } else {
            None
        };
        self.switch_to(accepted);
        // A default/absence arm bypasses the numeric checks. Only return a
        // checked SSA value when its definition dominates every admitted arm.
        if defaulted || absent != Absent::Impossible {
            None
        } else {
            checked
        }
    }

    fn check_uniform_numeric(
        &mut self,
        raw: ValueId,
        ty: &HirType,
        known: super::Facts,
        names: (&str, &str),
        origin: &Origin,
    ) -> ValueId {
        let mut number = self.push(
            OpKind::Unerase { value: raw },
            HirType::NUMBER,
            origin.clone(),
        );
        match ty {
            HirType::Int { bits, signed } => {
                let truncated = self.push(
                    OpKind::Unary {
                        op: UnOp::Trunc,
                        operand: number,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                self.require_uniform_comparison((BinOp::Eq, number, truncated), names, origin);
                number = truncated;
                let end = 2_f64.powi(i32::from(*bits) - i32::from(*signed));
                let start = if *signed { -end } else { 0.0 };
                for (op, limit) in [(BinOp::Ge, start), (BinOp::Lt, end)] {
                    let bound =
                        self.push(OpKind::ConstFloat(limit), HirType::NUMBER, origin.clone());
                    self.require_uniform_comparison((op, number, bound), names, origin);
                }
                self.require_uniform_nonnegative_zero(number, names, origin);
                // The check rejects -0; +0 preserves every accepted value and
                // lets the existing number analysis carry that fact onward.
                let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
                number = self.push(
                    OpKind::Binary {
                        op: BinOp::Add,
                        lhs: number,
                        rhs: zero,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
            }
            HirType::Float { bits: 32 } => {
                let rounded = self.push(OpKind::Convert(number), ty.clone(), origin.clone());
                let widened = self.push(OpKind::Convert(rounded), HirType::NUMBER, origin.clone());
                let equal = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: number,
                        rhs: widened,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                let accepted = self.new_block();
                let nan = self.new_block();
                self.terminate(Terminator::Branch {
                    cond: equal,
                    then_target: accepted,
                    then_args: Vec::new(),
                    else_target: nan,
                    else_args: Vec::new(),
                });
                self.switch_to(nan);
                self.require_uniform_comparison((BinOp::Ne, number, number), names, origin);
                self.terminate(Terminator::Jump {
                    target: accepted,
                    args: Vec::new(),
                });
                self.switch_to(accepted);
                number = widened;
            }
            _ => {}
        }
        self.check_uniform_number(number, known, names, origin);
        number
    }

    fn check_uniform_bigint(
        &mut self,
        raw: ValueId,
        (lo, hi): (i128, i128),
        names: (&str, &str),
        origin: &Origin,
    ) -> ValueId {
        let number = self.push(
            OpKind::Unerase { value: raw },
            HirType::BigInt,
            origin.clone(),
        );
        for (op, limit) in [(BinOp::Ge, lo), (BinOp::Le, hi)] {
            let bound = self.push(OpKind::ConstInt(limit), HirType::BigInt, origin.clone());
            self.require_uniform_comparison((op, number, bound), names, origin);
        }
        number
    }

    fn require_uniform_comparison(
        &mut self,
        (op, lhs, rhs): (BinOp, ValueId, ValueId),
        names: (&str, &str),
        origin: &Origin,
    ) {
        let valid = self.push(
            OpKind::Binary { op, lhs, rhs },
            HirType::Bool,
            origin.clone(),
        );
        self.require_uniform(valid, names, origin);
    }

    fn require_uniform_nonnegative_zero(
        &mut self,
        number: ValueId,
        names: (&str, &str),
        origin: &Origin,
    ) {
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let reciprocal = self.push(
            OpKind::Binary {
                op: BinOp::Div,
                lhs: one,
                rhs: number,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let minus_infinity = self.push(
            OpKind::ConstFloat(f64::NEG_INFINITY),
            HirType::NUMBER,
            origin.clone(),
        );
        self.require_uniform_comparison((BinOp::Ne, reciprocal, minus_infinity), names, origin);
    }

    fn check_uniform_number(
        &mut self,
        number: ValueId,
        known: super::Facts,
        names: (&str, &str),
        origin: &Origin,
    ) {
        if known == super::Facts::TOP {
            return;
        }
        // A declared bound may still admit NaN. It lies outside the interval,
        // so preserve that arm independently of the ordered comparisons.
        let accepted = known.maybe_nan.then(|| self.new_block());
        if let Some(accepted) = accepted {
            let valid = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: number,
                    rhs: number,
                },
                HirType::Bool,
                origin.clone(),
            );
            let numeric = self.new_block();
            self.terminate(Terminator::Branch {
                cond: valid,
                then_target: numeric,
                then_args: Vec::new(),
                else_target: accepted,
                else_args: Vec::new(),
            });
            self.switch_to(numeric);
        } else {
            self.require_uniform_comparison((BinOp::Eq, number, number), names, origin);
        }
        for (op, bound) in [(BinOp::Ge, known.lo), (BinOp::Le, known.hi)] {
            if bound.is_infinite() {
                continue;
            }
            let limit = self.push(OpKind::ConstFloat(bound), HirType::NUMBER, origin.clone());
            self.require_uniform_comparison((op, number, limit), names, origin);
        }
        if known.whole {
            let truncated = self.push(
                OpKind::Unary {
                    op: UnOp::Trunc,
                    operand: number,
                },
                HirType::NUMBER,
                origin.clone(),
            );
            self.require_uniform_comparison((BinOp::Eq, number, truncated), names, origin);
        }
        if !known.maybe_negative_zero {
            self.require_uniform_nonnegative_zero(number, names, origin);
        }
        if let Some(accepted) = accepted {
            self.terminate(Terminator::Jump {
                target: accepted,
                args: Vec::new(),
            });
            self.switch_to(accepted);
        }
    }

    fn require_uniform(&mut self, condition: ValueId, names: (&str, &str), origin: &Origin) {
        let good = self.new_block();
        let bad = self.new_block();
        self.terminate(Terminator::Branch {
            cond: condition,
            then_target: good,
            then_args: Vec::new(),
            else_target: bad,
            else_args: Vec::new(),
        });
        self.switch_to(bad);
        self.uniform_mismatch(names, origin);
        self.switch_to(good);
    }

    fn uniform_mismatch(&mut self, (body, parameter): (&str, &str), origin: &Origin) {
        let reason = self.push(OpKind::ConstString(format!(
            "calling `{body}` through an erased signature with an argument not admitted by parameter `{parameter}`"
        )), HirType::Managed(ManagedType::String), origin.clone());
        self.runtime_call("nts_refused", vec![reason], HirType::Void, origin.clone());
        self.terminate(Terminator::Unreachable);
    }
}
