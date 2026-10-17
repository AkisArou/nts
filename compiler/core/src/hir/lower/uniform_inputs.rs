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
use crate::hir::tags;

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
    absent: Absent,
}

fn primitive(ty: &HirType) -> bool {
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
                let absent = source.map_or(Absent::Impossible, |source| {
                    self.absence_at_excluding(source, &wanted, false)
                });
                Input {
                    source,
                    initializer,
                    delegated,
                    wanted,
                    absent,
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
            let source = input.source;
            let at = source.unwrap_or(info.node);
            let initializer = input.initializer;
            let wanted = &input.wanted;
            self.check_uniform_primitive(
                raw,
                (wanted, parameter.known, input.absent, initializer.is_some()),
                &self.origin(at),
                (&body.name, &parameter.name),
            );
            let value = if input.delegated {
                // That entry owns the initializer and its parameter cells.
                // Passing raw avoids running a default returning undefined twice.
                raw
            } else if let Some(initializer) = initializer {
                self.bind_parameter_default(raw, initializer, wanted)?
            } else if parameter.ty == HirType::Erased {
                raw
            } else {
                self.push(
                    OpKind::Unerase { value: raw },
                    parameter.ty.clone(),
                    parameter.origin.clone(),
                )
            };
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
        (ty, known, absent, defaulted): (&HirType, super::Facts, Absent, bool),
        origin: &Origin,
        names: (&str, &str),
    ) {
        let primary = match ty {
            HirType::Float { .. } | HirType::Int { .. } => tags::NUMBER,
            HirType::Bool => tags::BOOLEAN,
            HirType::BigInt | HirType::Managed(ManagedType::BoxedBigInt) => tags::BIGINT,
            HirType::Managed(ManagedType::String) => tags::STRING,
            HirType::Managed(ManagedType::Symbol) => tags::SYMBOL,
            // Reference storage/layout admission is separately scoped. An
            // OBJECT tag is deliberately not claimed as proof of storage here.
            _ => return,
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
        let narrowed = matches!(ty, HirType::Int { .. } | HirType::Float { bits: 32 })
            || (primary == tags::NUMBER && known != super::Facts::TOP);
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
        if narrowed {
            self.switch_to(numeric);
            self.check_uniform_numeric(raw, ty, known, names, origin);
            self.terminate(Terminator::Jump {
                target: accepted,
                args: Vec::new(),
            });
        }
        self.switch_to(accepted);
    }

    fn check_uniform_numeric(
        &mut self,
        raw: ValueId,
        ty: &HirType,
        known: super::Facts,
        names: (&str, &str),
        origin: &Origin,
    ) {
        let number = self.push(
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
                let end = 2_f64.powi(i32::from(*bits) - i32::from(*signed));
                let start = if *signed { -end } else { 0.0 };
                for (op, limit) in [(BinOp::Ge, start), (BinOp::Lt, end)] {
                    let bound =
                        self.push(OpKind::ConstFloat(limit), HirType::NUMBER, origin.clone());
                    self.require_uniform_comparison((op, number, bound), names, origin);
                }
                self.require_uniform_nonnegative_zero(number, names, origin);
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
            }
            _ => {}
        }
        self.check_uniform_number(number, known, names, origin);
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
