//! `IteratorClose` is an action on the language's lexical unwind stack. The
//! iterator's return property is read only when that action is crossed.

use super::iterator_calls::Method;
use super::{
    BinOp, ClosureEntry, Diagnostic, Exit, FuncBuilder, Handler, HirType, ManagedType, OpKind,
    Terminator, ValueId, for_each_parts, syntax,
};
use crate::hir::tags;
use nts_semantic_schema::{Accessor, MemberKind, NodeId, TypeId, TypeKind};
use std::rc::Rc;

const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};
const TEXT: HirType = HirType::Managed(ManagedType::String);

#[derive(Clone, Copy)]
pub(super) struct Action {
    pub at: NodeId,
    pub iterator: ValueId,
}

#[derive(Clone)]
enum Return {
    Absent,
    Unavailable,
    Method {
        method: Rc<Method>,
        result: HirType,
        absent: super::Absent,
    },
    Value {
        getter: Option<Rc<Method>>,
        ty: TypeId,
        callable: bool,
    },
}

#[derive(Clone)]
struct Contract {
    receiver: TypeId,
    returns: Return,
}

pub(super) struct Selection {
    contracts: Vec<Contract>,
    direct: bool,
}

impl Selection {
    pub(super) fn resolve(probe: &FuncBuilder<'_>, receiver: TypeId) -> Option<Self> {
        let mut classes: Vec<_> = probe
            .hierarchy
            .name
            .keys()
            .copied()
            .filter(|ty| {
                !probe.hierarchy.faces.contains(ty) && probe.hierarchy.descends_from(*ty, receiver)
            })
            .collect();
        let direct =
            !probe.hierarchy.faces.contains(&receiver) && classes.iter().all(|ty| *ty == receiver);
        if direct {
            classes = vec![receiver];
        }
        // JVM instanceof includes descendants; test children before parents.
        classes.sort_by_key(|ty| {
            let mut depth = 0;
            let mut at = *ty;
            for _ in 0..64 {
                let Some(base) = probe.hierarchy.base.get(&at) else {
                    break;
                };
                at = *base;
                depth += 1;
            }
            (std::cmp::Reverse(depth), *ty)
        });
        let contracts: Vec<_> = classes
            .into_iter()
            .filter_map(|receiver| Contract::resolve(probe, receiver))
            .collect();
        if contracts.is_empty()
            || contracts
                .iter()
                .all(|c| matches!(c.returns, Return::Absent))
        {
            return None;
        }
        Some(Self { contracts, direct })
    }

    pub(super) fn methods(&self) -> Vec<Rc<Method>> {
        self.contracts
            .iter()
            .filter_map(|contract| match &contract.returns {
                Return::Method { method, .. } => Some(method.clone()),
                Return::Value { getter, .. } => getter.clone(),
                Return::Absent | Return::Unavailable => None,
            })
            .collect()
    }

    pub(super) fn calls_value(&self) -> bool {
        self.contracts
            .iter()
            .any(|contract| matches!(contract.returns, Return::Value { callable: true, .. }))
    }
}

impl Contract {
    fn resolve(probe: &FuncBuilder<'_>, receiver: TypeId) -> Option<Self> {
        let TypeKind::Object { properties } = &probe.snapshot.types.get(receiver.0 as usize)?.kind
        else {
            return None;
        };
        let returns = if let Some(property) =
            properties.iter().find(|property| property.name == "return")
        {
            match property.kind {
                MemberKind::Method if !probe.hierarchy.stores(receiver, "return") => {
                    match (
                        Method::resolve(probe, receiver, "return"),
                        probe.member_returns(receiver, "return"),
                        super::signature_key(probe.snapshot, property.ty),
                    ) {
                        (Some(method), Some(result), Some((_, ty))) => Return::Method {
                            method: Rc::new(method),
                            result,
                            absent: super::absent_of_result(probe.snapshot, ty),
                        },
                        _ => Return::Unavailable,
                    }
                }
                MemberKind::Accessor(Accessor::Set) => Return::Absent,
                MemberKind::Accessor(_) => match Method::resolve(probe, receiver, "get return") {
                    Some(getter) => Return::Value {
                        getter: Some(Rc::new(getter)),
                        ty: property.ty,
                        callable: function_type(probe, property.ty).is_some(),
                    },
                    None => Return::Unavailable,
                },
                MemberKind::Field | MemberKind::Method => Return::Value {
                    getter: None,
                    ty: property.ty,
                    callable: function_type(probe, property.ty).is_some(),
                },
            }
        } else {
            Return::Absent
        };
        Some(Self { receiver, returns })
    }
}

/// Close need not be represented for a body with no possible abrupt exit.
/// Function bodies nested in it do not run as part of this iteration.
pub(super) fn may_leave(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    let mut pending = guarded_regions(probe, at);
    while let Some(at) = pending.pop() {
        let kind = probe.kind_of(at);
        if super::names_a_body(kind) {
            continue;
        }
        if matches!(
            kind,
            Some(
                syntax::BREAK_STATEMENT
                    | syntax::CONTINUE_STATEMENT
                    | syntax::RETURN_STATEMENT
                    | syntax::THROW_STATEMENT
                    | syntax::CALL_EXPRESSION
                    | syntax::NEW_EXPRESSION
                    | syntax::AWAIT_EXPRESSION
            )
        ) || probe.reads_an_accessor(at)
            || probe.module.initialization.can_raise_at(at)
            || super::an_operator_that_can_raise(probe, at)
        {
            return true;
        }
        pending.extend(super::children_that_run(probe, at));
    }
    false
}

/// A close can introduce a new throw only when replacing a non-throw
/// completion. On a throwing body path its own failure is discarded.
pub(super) fn may_leave_without_throw(probe: &FuncBuilder<'_>, at: NodeId) -> bool {
    if probe.kind_of(at) != Some(syntax::FOR_OF_STATEMENT) {
        return false;
    }
    let mut pending = guarded_regions(probe, at);
    while let Some(node) = pending.pop() {
        let kind = probe.kind_of(node);
        if super::names_a_body(kind) {
            continue;
        }
        if matches!(
            kind,
            Some(syntax::RETURN_STATEMENT | syntax::BREAK_STATEMENT)
        ) || kind == Some(syntax::CONTINUE_STATEMENT) && !probe.children(node).is_empty()
        {
            return true;
        }
        pending.extend(super::children_that_run(probe, node));
    }
    false
}

/// The region after a successful `IteratorValue`. Acquisition/stepping stay outside.
pub(super) fn guarded_regions(probe: &FuncBuilder<'_>, at: NodeId) -> Vec<NodeId> {
    if probe.kind_of(at) == Some(syntax::FOR_OF_STATEMENT)
        && let Some((_, [head, _, body])) = for_each_parts(probe, at)
    {
        return vec![head, body];
    }
    if probe.kind_of(at) == Some(syntax::CALL_EXPRESSION) {
        let arguments = probe.arguments_of(at);
        if let [_, callback] = arguments.as_slice()
            && probe.inlines_as_a_callback(*callback)
            && let Some(body) = probe.children(*callback).last()
        {
            return vec![*body];
        }
    }
    Vec::new()
}

impl FuncBuilder<'_> {
    pub(super) fn lower_iterator_body(
        &mut self,
        at: NodeId,
        iterator: ValueId,
        depth: usize,
        regions: &[NodeId],
        lower: impl FnOnce(&mut Self) -> Result<(), Diagnostic>,
    ) -> Result<(), Diagnostic> {
        if self.iterators.closes_at(at).is_none() {
            return lower(self);
        }
        let mut handled = Vec::new();
        for region in regions {
            if let Some((call, why)) = self.call_within(*region, &mut handled) {
                return Err(self.unsupported(
                    call,
                    &format!("an iterator body whose throw cannot reach IteratorClose: {why}"),
                ));
            }
        }
        self.raising_calls.extend(handled);
        let entry = self.bindings.clone();
        self.exits.push(Exit::Iterator(Action { at, iterator }));
        self.breakables[depth].continues_at = self.exits.len();
        self.exits.push(Exit::Handler(Handler {
            block: None,
            edges: Vec::new(),
            rejections: Vec::new(),
        }));
        let lowered = lower(self);
        let Some(Exit::Handler(frame)) = self.exits.pop() else {
            unreachable!("pushed above")
        };
        let result = lowered.and_then(|()| {
            let tail = self.current;
            let open = !self.is_terminated();
            if let Some(handler) = frame.block {
                let origin = self.origin(at);
                self.lower_arm(|this| {
                    let thrown = this.open_handler(handler, &frame, &entry, &origin);
                    this.switch_to(handler);
                    this.throw_erased(at, thrown, thrown, &HirType::Erased)
                })?;
                self.current = tail;
                if !open {
                    self.terminate(Terminator::Unreachable);
                }
            }
            Ok(())
        });
        self.exits.pop();
        result
    }

    pub(super) fn close_iterator(
        &mut self,
        action: Action,
        pending: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        if pending.is_none() {
            return self.iterator_return(action, true);
        }
        // The original throw wins over GetMethod, the call, and its result.
        // Catch the secondary completion locally; the outer payload stays SSA.
        let entry = self.bindings.clone();
        self.exits.push(Exit::Handler(Handler {
            block: None,
            edges: Vec::new(),
            rejections: Vec::new(),
        }));
        let closed = self.iterator_return(action, false);
        let Some(Exit::Handler(frame)) = self.exits.pop() else {
            unreachable!("pushed above")
        };
        closed?;
        let join = self.new_block();
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: join,
                args: Vec::new(),
            });
        }
        if let Some(handler) = frame.block {
            let origin = self.origin(action.at);
            self.lower_arm(|this| {
                this.open_handler(handler, &frame, &entry, &origin);
                this.switch_to(handler);
                this.terminate(Terminator::Jump {
                    target: join,
                    args: Vec::new(),
                });
                Ok(())
            })?;
        }
        self.switch_to(join);
        Ok(())
    }

    fn iterator_return(&mut self, action: Action, validate: bool) -> Result<(), Diagnostic> {
        let Some(selection) = self.iterators.closes_at(action.at) else {
            return Ok(());
        };
        if selection.direct {
            return self.iterator_return_contract(action, &selection.contracts[0], validate);
        }
        let origin = self.origin(action.at);
        let erased = self.erased(action.iterator, &origin);
        let join = self.new_block();
        for contract in &selection.contracts {
            let yes = self.new_block();
            let no = self.new_block();
            let test = self.push(
                OpKind::InstanceOf {
                    value: erased,
                    classes: vec![contract.receiver],
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: yes,
                then_args: Vec::new(),
                else_target: no,
                else_args: Vec::new(),
            });
            self.switch_to(yes);
            self.lower_arm(|this| {
                let iterator = this.push(
                    OpKind::Unerase { value: erased },
                    HirType::Managed(ManagedType::Object(contract.receiver)),
                    origin.clone(),
                );
                this.iterator_return_contract(Action { iterator, ..action }, contract, validate)?;
                if !this.is_terminated() {
                    this.terminate(Terminator::Jump {
                        target: join,
                        args: Vec::new(),
                    });
                }
                Ok(())
            })?;
            self.switch_to(no);
        }
        // The interface's implementations above are the admitted source set.
        self.terminate(Terminator::Unreachable);
        self.switch_to(join);
        Ok(())
    }

    fn iterator_return_contract(
        &mut self,
        action: Action,
        contract: &Contract,
        validate: bool,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(action.at);
        let result = match &contract.returns {
            Return::Absent => return Ok(()),
            Return::Unavailable => return Err(self.unsupported(action.at, "an IteratorClose return member whose existing callable representation is unavailable")),
            Return::Method { method, result, absent } => {
                let (callee, raises) =
                    self.iterator_method(action.at, contract.receiver, &method.key)?;
                let value = self.push(
                    OpKind::Call {
                        callee,
                        args: vec![action.iterator],
                        frame: None,
                    },
                    result.clone(),
                    origin.clone(),
                );
                if raises {
                    self.iterator_raise_test(action.at, &origin)?;
                }
                if *result == HirType::Erased || *result == HirType::Void {
                    value
                } else {
                    self.push(OpKind::Erase { value, absent: *absent, slots: super::Absent::Impossible }, HirType::Erased, origin.clone())
                }
            }
            Return::Value { getter, ty, .. } => {
                let representation = self.represent(*ty).ok_or_else(|| {
                    self.unrepresentable(action.at, "an iterator return property")
                })?;
                let value = if let Some(getter) = getter {
                    let (callee, raises) =
                        self.iterator_method(action.at, contract.receiver, &getter.key)?;
                    let value = self.push(
                        OpKind::Call {
                            callee,
                            args: vec![action.iterator],
                            frame: None,
                        },
                        representation.clone(),
                        origin.clone(),
                    );
                    if raises {
                        self.iterator_raise_test(action.at, &origin)?;
                    }
                    value
                } else {
                    let layout = self.layout_of(action.at, contract.receiver)?;
                    let field = layout.index_of("return").ok_or_else(|| {
                        self.unrepresentable(action.at, "an iterator return field")
                    })?;
                    self.push(
                        OpKind::FieldGet {
                            object: action.iterator,
                            field,
                        },
                        layout.fields[field as usize].ty.clone(),
                        origin.clone(),
                    )
                };
                return self.iterator_return_value(action, value, *ty, validate);
            }
        };
        if validate {
            self.validate_iterator_return(action.at, result)?;
        }
        Ok(())
    }

    fn iterator_return_value(
        &mut self,
        action: Action,
        value: ValueId,
        ty: TypeId,
        validate: bool,
    ) -> Result<(), Diagnostic> {
        let at = action.at;
        let origin = self.origin(at);
        let erased = if self.values[value.0 as usize].ty == HirType::Erased {
            value
        } else {
            self.push(
                OpKind::Erase {
                    value,
                    absent: super::absent_of_result(self.snapshot, ty),
                    slots: super::Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            )
        };
        let tag = self.push(OpKind::TagOf { value: erased }, I32, origin.clone());
        let join = self.new_block();
        for absent in [tags::UNDEFINED, tags::NULL] {
            let next = self.new_block();
            let test = self.iterator_tag_test(at, tag, absent);
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: join,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(next);
        }
        if let Some(function_type) = function_type(self, ty) {
            let callable = self.new_block();
            let noncallable = self.new_block();
            let test = self.iterator_tag_test(at, tag, tags::FUNCTION);
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: callable,
                then_args: Vec::new(),
                else_target: noncallable,
                else_args: Vec::new(),
            });
            self.switch_to(callable);
            self.lower_arm(|this| {
                let function = if this.values[value.0 as usize].ty == HirType::Erased {
                    let ty = this
                        .represent(function_type)
                        .ok_or_else(|| this.unrepresentable(at, "an iterator return function"))?;
                    this.layout_of(at, function_type)?;
                    this.push(OpKind::Unerase { value: erased }, ty, origin.clone())
                } else {
                    value
                };
                let result = this.call_iterator_return(action, function)?;
                if validate {
                    this.validate_iterator_return(at, result)?;
                }
                if !this.is_terminated() {
                    this.terminate(Terminator::Jump {
                        target: join,
                        args: Vec::new(),
                    });
                }
                Ok(())
            })?;
            self.switch_to(noncallable);
        }
        if function_type(self, ty).is_none() && unknown_callable(self, ty) {
            let refused = self.new_block();
            let primitive = self.new_block();
            let callable = self.iterator_tag_test(at, tag, tags::FUNCTION);
            self.terminate(Terminator::Branch {
                cond: callable,
                then_target: refused,
                then_args: Vec::new(),
                else_target: primitive,
                else_args: Vec::new(),
            });
            self.switch_to(refused);
            let reason = self.push(OpKind::ConstString("IteratorClose of an erased return function, whose callable representation this compiler does not yet carry".into()), TEXT, origin.clone());
            self.runtime_call("nts_refused", vec![reason], HirType::Void, origin.clone());
            self.terminate(Terminator::Unreachable);
            self.switch_to(primitive);
        }
        self.iterator_noncallable(at, erased, tag)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: join,
                args: Vec::new(),
            });
        }
        self.switch_to(join);
        Ok(())
    }

    fn call_iterator_return(
        &mut self,
        action: Action,
        function: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let catches = self.raises || !self.exits.is_empty();
        let slot = if catches && self.hierarchy.closures_carry {
            self.hierarchy.raising_call_slot
        } else if !catches {
            self.hierarchy.erased_call_slot
        } else {
            None
        };
        let slot = slot.ok_or_else(|| {
            self.unsupported(
                action.at,
                "an IteratorClose callback without a carriable uniform entry",
            )
        })?;
        let result = self.call_a_closure_entry(
            action.at,
            ClosureEntry::Uniform(slot),
            Some(action.iterator),
            vec![function],
            &HirType::Erased,
        )?;
        if catches {
            self.iterator_raise_test(action.at, &self.origin(action.at))?;
        }
        Ok(result)
    }

    fn iterator_tag_test(&mut self, at: NodeId, tag: ValueId, expected: u32) -> ValueId {
        let origin = self.origin(at);
        let expected = self.push(OpKind::ConstInt(i128::from(expected)), I32, origin.clone());
        self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: tag,
                rhs: expected,
            },
            HirType::Bool,
            origin,
        )
    }

    fn validate_iterator_return(&mut self, at: NodeId, value: ValueId) -> Result<(), Diagnostic> {
        let origin = self.origin(at);
        let value = if self.values[value.0 as usize].ty == HirType::Void {
            self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone())
        } else {
            self.coerce(value, &HirType::Erased, at)?
        };
        let tag = self.push(OpKind::TagOf { value }, I32, origin.clone());
        let valid = self.new_block();
        // ECMAScript Type(Object) includes callable and host objects, not null.
        for object in [
            tags::FUNCTION,
            tags::OBJECT,
            tags::HANDLE_GOBJECT,
            tags::HANDLE_OBJC,
            tags::HANDLE_COM,
            tags::HANDLE_HOST,
        ] {
            let next = self.new_block();
            let test = self.iterator_tag_test(at, tag, object);
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: valid,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(next);
        }
        let description = self.runtime_call(
            "nts_access_key_description",
            vec![value],
            TEXT,
            origin.clone(),
        );
        let prefix = self.push(
            OpKind::ConstString("Iterator result ".into()),
            TEXT,
            origin.clone(),
        );
        let suffix = self.push(
            OpKind::ConstString(" is not an object".into()),
            TEXT,
            origin.clone(),
        );
        let message = self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs: prefix,
                rhs: description,
            },
            TEXT,
            origin.clone(),
        );
        let message = self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs: message,
                rhs: suffix,
            },
            TEXT,
            origin,
        );
        self.throw_provided_error_text(at, "TypeError", message)?;
        self.switch_to(valid);
        Ok(())
    }

    fn iterator_noncallable(
        &mut self,
        at: NodeId,
        value: ValueId,
        tag: ValueId,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(at);
        for (kind, prefix, suffix) in [
            (tags::NUMBER, "number ", " is not a function"),
            (tags::BOOLEAN, "boolean ", " is not a function"),
            (tags::STRING, "string \"", "\" is not a function"),
        ] {
            let yes = self.new_block();
            let no = self.new_block();
            let test = self.iterator_tag_test(at, tag, kind);
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: yes,
                then_args: Vec::new(),
                else_target: no,
                else_args: Vec::new(),
            });
            self.switch_to(yes);
            self.lower_arm(|this| {
                let description = this.runtime_call(
                    "nts_access_key_description",
                    vec![value],
                    TEXT,
                    origin.clone(),
                );
                let prefix = this.push(OpKind::ConstString(prefix.into()), TEXT, origin.clone());
                let suffix = this.push(OpKind::ConstString(suffix.into()), TEXT, origin.clone());
                let message = this.push(
                    OpKind::Binary {
                        op: BinOp::Concat,
                        lhs: prefix,
                        rhs: description,
                    },
                    TEXT,
                    origin.clone(),
                );
                let message = this.push(
                    OpKind::Binary {
                        op: BinOp::Concat,
                        lhs: message,
                        rhs: suffix,
                    },
                    TEXT,
                    origin.clone(),
                );
                this.throw_provided_error_text(at, "TypeError", message)
            })?;
            self.switch_to(no);
        }
        for (kind, message) in [
            (tags::SYMBOL, "symbol is not a function"),
            (tags::BIGINT, "bigint is not a function"),
        ] {
            let yes = self.new_block();
            let no = self.new_block();
            let test = self.iterator_tag_test(at, tag, kind);
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: yes,
                then_args: Vec::new(),
                else_target: no,
                else_args: Vec::new(),
            });
            self.switch_to(yes);
            self.lower_arm(|this| this.throw_provided_error(at, "TypeError", message))?;
            self.switch_to(no);
        }
        self.throw_provided_error(at, "TypeError", "object is not a function")
    }
}

fn function_type(probe: &FuncBuilder<'_>, ty: TypeId) -> Option<TypeId> {
    match &probe.snapshot.types[ty.0 as usize].kind {
        TypeKind::Function(_) => Some(ty),
        TypeKind::Union(members) => members.iter().copied().find(|ty| {
            matches!(
                probe.snapshot.types[ty.0 as usize].kind,
                TypeKind::Function(_)
            )
        }),
        _ => None,
    }
}

fn unknown_callable(probe: &FuncBuilder<'_>, ty: TypeId) -> bool {
    let mut pending = vec![ty];
    let mut seen = rustc_hash::FxHashSet::default();
    while let Some(ty) = pending.pop() {
        if !seen.insert(ty) {
            continue;
        }
        match &probe.snapshot.types[ty.0 as usize].kind {
            TypeKind::Any | TypeKind::Unknown | TypeKind::Object { .. } => return true,
            TypeKind::Union(members) | TypeKind::Intersection(members) => {
                pending.extend(members.iter().copied())
            }
            _ => {}
        }
    }
    false
}
