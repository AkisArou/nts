//! Determine declared parameter shapes and lower callee binding, defaults, and omitted arguments.

use super::{
    Absence, Branch, Diagnostic, Facts, FuncBuilder, HirType, LiteralValue, ManagedType, NodeId,
    OpKind, Origin, Param, ParamShape, PatternScope, SemanticSnapshot, TypeId, TypeKind, ValueId,
    absence_of_member, elision_patterns, in_a_slot, parameter_entries, syntax,
};

/// A declaration's parameters, in order.
pub(super) fn parameters_of(probe: &FuncBuilder, declaration: NodeId) -> Vec<NodeId> {
    probe
        .children(declaration)
        .into_iter()
        .filter(|child| probe.kind_of(*child) == Some(syntax::PARAMETER))
        .collect()
}

/// Which patterns require a `TypeError` check before consuming their source.
/// JavaScript requires it for object and array patterns: inferred reference
/// types do not guarantee a present value. A nested reference element stays
/// erased through this check; its array proves the representation on the
/// present path (`reference_element_for_pattern`).
///
/// TypeScript retains the existing exclusion for an object pattern directly
/// inside an array pattern, whose declared element representation is trusted.
/// One predicate selects both the guard and a parameter's throwing analysis.
pub(super) fn a_pattern_that_requires_coercion(probe: &FuncBuilder, pattern: NodeId) -> bool {
    match probe.kind_of(pattern) {
        Some(syntax::OBJECT_BINDING_PATTERN) => {
            in_javascript(probe, pattern)
                || !probe.syntactic_parent(pattern).is_some_and(|element| {
                    probe.syntactic_parent(element).is_some_and(|outer| {
                        probe.kind_of(outer) == Some(syntax::ARRAY_BINDING_PATTERN)
                    })
                })
        }
        Some(syntax::ARRAY_BINDING_PATTERN) => in_javascript(probe, pattern),
        _ => false,
    }
}

/// Whether `node` is in a JavaScript source, where the checker's types are inferred and
/// unchecked.
pub(super) fn in_javascript(probe: &FuncBuilder, node: NodeId) -> bool {
    let file = probe.node(node).origin.location.file;
    probe
        .snapshot
        .sources
        .get(file.0 as usize)
        .is_some_and(|source| {
            [".js", ".mjs", ".cjs", ".jsx"]
                .iter()
                .any(|extension| source.uri.ends_with(extension))
        })
}

/// Whether any pattern in this parameter can throw, which is what puts its function in
/// `Throwing::any`.
///
/// Over the whole pattern tree rather than the parameter's own name, because
/// `function f({ w: { x } }) {}` throws from the *inner* pattern when `w` is null -- 20 of
/// the recorded cases are exactly that shape.
pub(super) fn a_parameter_pattern_can_throw(probe: &FuncBuilder, parameter: NodeId) -> bool {
    let mut pending = probe.children(parameter);
    while let Some(at) = pending.pop() {
        if a_pattern_that_requires_coercion(probe, at)
            || elision_patterns::steps_what_arrives(probe, at)
        {
            return true;
        }
        if matches!(
            probe.kind_of(at),
            Some(
                syntax::OBJECT_BINDING_PATTERN
                    | syntax::ARRAY_BINDING_PATTERN
                    | syntax::BINDING_ELEMENT
            )
        ) {
            pending.extend(probe.children(at));
        }
    }
    false
}

/// Whether lowering a parameter binds the names it declares.
///
/// A forwarder -- a wrapper for a function or a method used as a value -- has no body
/// to read them, and binding a *pattern* parameter there runs the pattern's defaults
/// a second time. See [`FuncBuilder::lower_param_binding`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ParameterNames {
    Bound,
    Forwarded,
}

/// The values a declared type admits.
///
/// Only literal types and unions of them say anything useful; everything else
/// is as wide as its representation. Bounded so that a self-referential union
/// cannot make this recurse forever — the checker should not produce one, but a
/// stack overflow is a poor way to find out.
pub(super) fn known_values(snapshot: &SemanticSnapshot, ty: TypeId, depth: u32) -> Facts {
    const MAX_DEPTH: u32 = 8;
    if depth > MAX_DEPTH {
        return Facts::TOP;
    }
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return Facts::TOP;
    };
    match &record.kind {
        TypeKind::Literal(LiteralValue::Number(value)) => Facts::constant(*value),
        TypeKind::Union(members) => members.iter().fold(Facts::BOTTOM, |accumulated, member| {
            accumulated.join(known_values(snapshot, *member, depth + 1))
        }),
        _ => Facts::TOP,
    }
}

/// What a call has to supply for a parameter its argument list did not reach.
///
/// Two different absences. `f(a = 1)` has an expression to evaluate; `f(a?: T)`
/// has nothing written down at all, and the value is `undefined`.
#[derive(Debug, Clone, Copy)]
pub(super) enum Omitted {
    /// The declaration's initializer, evaluated at this call, and the
    /// declaration it came from.
    ///
    /// The declaration is carried because the initializer may *read the
    /// parameters before it* -- `f(a, b = a + 1)` -- and those names belong to
    /// the callee. Evaluating the default here is right, and it is where
    /// JavaScript evaluates one; what the caller has to do is bind the callee's
    /// names to the values it has already computed for them.
    Default(NodeId, NodeId),
    /// `undefined`, in whatever representation the parameter has.
    Absent,
}

impl FuncBuilder<'_> {
    /// A parameter's default, as the expression node that produces it.
    ///
    /// The grammar puts it last -- `modifiers name ? : type = initializer` --
    /// so the last child is the initializer whenever it is not the name, the
    /// type annotation, or the `?`. A modifier cannot be last and neither can
    /// the `...` of a rest, which is what makes reading the end precise rather
    /// than a guess at which child is which.
    pub(super) fn default_of(&self, param: NodeId) -> Option<NodeId> {
        crate::hir::written_scalar::default_of(self.snapshot, param)
    }

    /// Whether an expression reads one of the parameters `declaration` declares.
    ///
    /// `f(a: number, b: number = a * 2)` is legal and this compiler cannot fill
    /// it: the default is lowered at the *call*, where `a` is the caller's
    /// argument expression rather than the callee's binding, and evaluating it
    /// twice is a different program whenever it has an effect. Naming the
    /// parameter it reads is worth more than saying it is complicated.
    /// The symbol of each declared parameter, in order.
    ///
    /// `None` for one whose name is a pattern rather than an identifier: a
    /// destructured parameter has no single symbol to bind, and a default that
    /// read one would find nothing here and be refused as an unbound name --
    /// which is the honest answer rather than a wrong binding.
    pub(super) fn parameter_symbols(&self, declaration: NodeId) -> Vec<Option<u32>> {
        self.children(declaration)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .map(|param| {
                self.children(param)
                    .into_iter()
                    .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                    .and_then(|name| self.node(name).symbol)
                    .map(|symbol| symbol.0)
            })
            .collect()
    }

    /// The argument a call passes for a parameter with a default: `value`, or
    /// the default where `value` is `undefined` -- which a passed argument can
    /// be as well as an omitted one, and JavaScript does not tell them apart.
    ///
    /// The default was evaluated only for an argument the call *omits*, so
    /// `function g(x = 5)` called `g(undefined)` -- in a `.js` file, where `x`
    /// is erased -- ran with `x` undefined. A value whose representation has no
    /// `undefined` (a number, a non-optional string) cannot be one, and is
    /// passed with no test.
    pub(super) fn unless_undefined(
        &mut self,
        call: NodeId,
        argument: NodeId,
        argument_ty: Option<TypeId>,
        value: ValueId,
        before: &[ValueId],
        receiver: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let Some((default, callee)) = self.declared_default(call, before.len()) else {
            return Ok(value);
        };
        if self.parameter_entry_for_call(call).is_some() || self.uniform_defaults_at(call) {
            return Ok(value);
        }
        // The literal cannot take the supplied-value arm. Defer its default
        // until every argument has run, then evaluate it directly at the slot's
        // representation, including a concrete numeric parameter.
        if self.undefined_argument(argument).is_some() {
            return self.lower_parameter_default(call, default, callee, before, receiver);
        }
        // The argument's *type* first: a `number` passed to `id: number | null =
        // null` is erased to fit the parameter, and a test of its tag would ask
        // what the checker already answered.
        if !self.admits_undefined(argument_ty) || self.is_the_undefined_literal(default) {
            return Ok(value);
        }
        let ty = self.values[value.0 as usize].ty.clone();
        let undefined = match ty {
            HirType::Erased => self.defaulted_when(argument, argument, value)?,
            // One null pointer stands for both absences, so the argument's
            // *type* has to say which: only `undefined` takes the default, and
            // a `null` the language keeps cannot be told from it.
            HirType::Managed(_) => {
                let absent = |kind: Absence| {
                    argument_ty.is_some_and(|ty| {
                        let parts = match self
                            .snapshot
                            .types
                            .get(ty.0 as usize)
                            .map(|record| &record.kind)
                        {
                            Some(TypeKind::Union(parts)) => parts.clone(),
                            _ => vec![ty],
                        };
                        parts
                            .iter()
                            .any(|part| absence_of_member(self.snapshot, *part) == Some(kind))
                    })
                };
                match (absent(Absence::Undefined), absent(Absence::Null)) {
                    (true, true) => {
                        return Err(self.unsupported(
                            argument,
                            "an argument that can be `null` or `undefined`, passed to a parameter with a default",
                        ));
                    }
                    (true, false) => self.absence_of(argument, value),
                    _ => None,
                }
            }
            _ => None,
        };
        let Some(undefined) = undefined else {
            return Ok(value);
        };
        let branch = Branch::ParameterDefault {
            call,
            default,
            callee,
            before: before.to_vec(),
            receiver,
        };
        self.lower_branching_value_at(argument, ty, undefined, branch, Branch::Value(value))
    }

    pub(super) fn is_the_undefined_literal(&self, node: NodeId) -> bool {
        self.builtin_binding_at(node) == Some(nts_semantic_schema::BuiltinBinding::Undefined)
    }

    /// Whether a value of type `ty` can be `undefined`: a union with
    /// `undefined` or `void` in it, or a type that says nothing about it --
    /// `any`, `unknown`, a type parameter. A type the snapshot does not have is
    /// answered yes, the conservative side.
    pub(super) fn admits_undefined(&self, ty: Option<TypeId>) -> bool {
        let kind = |ty: TypeId| {
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
        };
        let Some(ty) = ty else { return true };
        let parts = match kind(ty) {
            Some(TypeKind::Union(parts)) => parts.as_slice(),
            _ => std::slice::from_ref(&ty),
        };
        parts.iter().any(|part| {
            matches!(
                kind(*part),
                None | Some(
                    TypeKind::Any
                        | TypeKind::Unknown
                        | TypeKind::Evolving
                        | TypeKind::TypeParameter { .. }
                        | TypeKind::Undefined
                        | TypeKind::Void
                )
            )
        })
    }

    /// A parameter's default, evaluated at `call` for the argument at
    /// `args.len()`: in the callee's scope, with the parameters before it
    /// bound to `args` and `this` to `receiver`, and at the parameter's
    /// representation. For an argument the call omits, and for one it passes
    /// that is `undefined` (see [`Self::unless_undefined`]).
    pub(super) fn lower_parameter_default(
        &mut self,
        call: NodeId,
        node: NodeId,
        callee: NodeId,
        args: &[ValueId],
        receiver: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        if self.parameter_entry_for_call(call).is_some() {
            let origin = self.origin(node);
            return Ok(self.push(OpKind::ConstUndefined, HirType::Erased, origin));
        }
        self.check_caller_filled_default(node, callee)?;
        // A function-value call runs defaults in its uniform entry. Supplying
        // the initializer's result here would run it twice if that is undefined.
        if self.uniform_defaults_at(call) {
            let origin = self.origin(node);
            return Ok(self.push(OpKind::ConstUndefined, HirType::Erased, origin));
        }
        self.a_default_the_instance_cannot_answer(node, callee)?;
        // The parameters before this one, bound to what the call
        // already computed for them.
        //
        // `f(a, b = a + 1)` called as `f(2)` has to evaluate `a + 1`
        // with `a` meaning *the callee's* `a`, which is the value
        // sitting in `args[0]`. This used to be refused as "a
        // parameter default that reads `a`, another parameter",
        // which is 77 distinct sites in `runtime/node` -- and the
        // caller had the value the whole time.
        //
        // Saved and restored rather than inserted and dropped,
        // because a *recursive* call is the one case where the
        // caller has its own binding for the same symbol: `f`
        // calling `f(2)` would otherwise leave its own `a` pointing
        // at the argument it just passed.
        // **And `this` is the receiver of *this* call.**
        //
        // The same argument one paragraph up, for the other name a
        // default can read. JavaScript evaluates a default in the
        // callee's scope, where `this` is whatever the call was
        // made on; evaluating it here left `self.this` holding the
        // *caller's* receiver, which for a free function is
        // nothing at all. So `Buffer.prototype.toString(encoding?,
        // start = 0, end = this.length)` refused with ``this`
        // outside a method` -- a sentence about the source, which
        // says `this` inside a method -- at every call that omits
        // `end` from a function with no receiver of its own.
        //
        // 35 occurrences in `fs` alone, and `displayBytePath` is
        // one of them: eleven `fs` exports are behind that call.
        let outer_this = receiver.map(|receiver| self.this.replace(receiver));
        let names = self.parameter_symbols(callee);
        let mut shadowed = Vec::new();
        for (at, symbol) in names.iter().enumerate().take(args.len()) {
            let Some(symbol) = symbol else { continue };
            shadowed.push((*symbol, self.bindings.get(symbol).copied()));
            self.bindings.insert(*symbol, args[at]);
        }
        // **At the parameter's representation**, which is the
        // lesson the *argument* loop above already carries and this
        // one did not: "an array literal decides its own element
        // width when it is built, and `coerce` can only reject the
        // result". A default is an argument the caller did not
        // write, so the same thing decides its type.
        //
        // `function f(p: number[] = [])` refused with ``an array
        // literal that is not an array``: `[]` is typed `never[]`,
        // the checker saying the literal decides nothing and the
        // slot does -- and nothing was telling it what the slot is.
        // 36 files of the slice-1 `test/language` population reach
        // it through `method([x = 23] = [,])`, where the census
        // reported it as *a parameter of unrepresentable type (a
        // tuple)*, one cause under a message naming another.
        // The same scoped substitution the two paragraphs above make for
        // `this` and for the parameters before it, for the third thing a
        // default inherits from the call that evaluates it.
        let handled = self.a_default_inherits_the_handler(call, node);
        let want = self.parameter_representation(call, args.len());
        let lowered = match &want {
            Some(want) => self.lower_expecting(node, want),
            None => self.lower_expression(node),
        };
        for call in handled {
            self.raising_calls.remove(&call);
        }
        for (symbol, before) in shadowed {
            match before {
                Some(value) => self.bindings.insert(symbol, value),
                None => self.bindings.remove(&symbol),
            };
        }
        if let Some(outer) = outer_this {
            self.this = outer;
        }
        let value = lowered?;
        self.coerce_to_parameter(call, args.len(), value, node, self.read_type(node))
    }

    /// A foreign function's `@ntsDefault` for the `at`th argument the program
    /// wrote, when it left that one out: the declared value, at the C slot's
    /// own representation. `None` for every other call.
    pub(super) fn omitted_by_default(&mut self, at: usize, origin: &Origin) -> Option<ValueId> {
        use crate::hir::native::ParameterDefault;
        let (target, unwritten, _) = self.omitting_for.as_ref()?;
        let slot = target.c_index(at + unwritten)?;
        let (_, value) = target.defaults.iter().find(|(given, _)| *given == slot)?;
        let ty = target.parameters[slot].representation();
        let op = match (value, &ty) {
            (ParameterDefault::Null, _) => OpKind::ConstNull,
            (ParameterDefault::Int(value), HirType::Bool) => OpKind::ConstBool(*value != 0),
            (ParameterDefault::Int(value), _) => OpKind::ConstInt(i128::from(*value)),
        };
        Some(self.push(op, ty, origin.clone()))
    }

    /// The declaration that has the body, for a callee that may be an overload
    /// signature.
    ///
    /// TypeScript resolves a call to whichever *signature* it matched, and the
    /// signatures of an overloaded method are separate declarations with no
    /// bodies. Only one of them is emitted -- the implementation -- so a call
    /// built against the resolved signature's parameter list is built against
    /// the wrong one: `pick(a: number)` beside `pick(a: number, b?: number)`
    /// gives a call of two arguments to a function of three.
    ///
    /// The relation is over the declaration's siblings by name, which is the same
    /// relation `is_an_overload` reads. A declaration that already has a body
    /// is its own implementation and returns unchanged, so this is the identity
    /// for every call that is not to an overload.
    ///
    /// Indexed once after materialisation: native declarations have no body,
    /// so scanning their entire namespace at every wrapper/parameter query
    /// made lowering quadratic in the number of sibling declarations.
    ///
    /// **And the sibling relation is the one that matters, which is why this is now
    /// the only spelling.** There was a second `implementation_of` beside it,
    /// resolving the name's *symbol* and reading its declarations -- and a
    /// constructor is named by its keyword, so that one had no identifier to resolve
    /// and handed back the **signature**. The raising row is where the two parted
    /// company: `raising_copies` keyed its set on the signature of `Blob`'s
    /// four-overload constructor while `lower_class` skips a signature by
    /// `is_an_overload_signature` -- the sibling relation -- so the copy was never
    /// built, every `new Blob()` inside a raising body named
    /// `Blob#constructor@raises`, and `integrity` reported a cascade with no root.
    /// One relation, so "this node is skipped as a signature" and "this node is the
    /// implementation" cannot disagree.
    pub(super) fn implementation_of(&self, callee: NodeId) -> NodeId {
        self.snapshot.implementation_of(callee)
    }

    /// Whether each parameter of the function a call reaches is optional and
    /// whether it is a rest, in order.
    ///
    /// From the resolved signature ordinarily. From the **implementation's
    /// syntax** where the checker resolved the call to an overload signature,
    /// because only the implementation is emitted and its list is the one an
    /// argument list has to match.
    ///
    /// Off the syntax rather than off a signature, because the checker gives
    /// the implementation's declaration node the *overloaded* type -- its call
    /// signatures are the overloads, so asking `node_types` for it hands back
    /// one of the things being corrected for. The implementation's own list
    /// exists in exactly one place that is not an overload: the declaration.
    /// The signature this call's arguments answer to, when it is not the one
    /// the call node resolved to. See [`Self::callee_signature`].
    pub(super) fn overriding_signature(
        &self,
        call: NodeId,
    ) -> Option<&nts_semantic_schema::SignatureRecord> {
        if let Some((node, record)) = &self.delegated_signature
            && *node == call
        {
            return Some(record);
        }
        let (node, ty) = self.callee_signature?;
        if node != call {
            return None;
        }
        let TypeKind::Function(signature) = self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        self.snapshot.signatures.get(signature.0 as usize)
    }

    /// The parameters a call actually supplies, with a **fixed-arity rest
    /// expanded into its positions**.
    ///
    /// One list, and that is the point. A rest parameter typed by a
    /// fixed-length tuple is positional -- `(...args: [number]) => void` is the
    /// same type as `(a: number) => void` -- so its arity is asked by two
    /// questions this file used to answer separately: *is parameter `n` a rest*
    /// and *what type does parameter `n` have*. Two derivations of one arity is
    /// the shape that has produced three defects in as many days, and the JVM
    /// lane named it before this was written: "if C or LLVM builds the argument
    /// list from the callee's declaration while HIR builds it from the call,
    /// that is a second place the arity lives".
    ///
    /// So the expansion happens here and nowhere else, and both readers below
    /// are projections of it.
    ///
    /// A **union** of tuples is deliberately not expanded: `[] | [a, b?]` has no
    /// single arity, so it cannot be positional and stays the array
    /// `element_of_a_tuple_union` builds. The two readings meet at a question
    /// with a yes-or-no answer.
    pub(super) fn effective_parameters(&self, call: NodeId) -> Vec<(Option<TypeId>, bool, bool)> {
        let declared = self.declared_parameters(call);
        let mut out: Vec<(Option<TypeId>, bool, bool)> = Vec::new();
        for (ty, optional, rest) in declared {
            let positions = rest
                .then(|| ty.and_then(|ty| self.fixed_arity_positions(ty)))
                .flatten();
            match positions {
                Some(positions) => {
                    for position in positions {
                        out.push((Some(position), false, false));
                    }
                }
                None => out.push((ty, optional, rest)),
            }
        }
        out
    }

    /// The positions of a fixed-length tuple, or nothing.
    ///
    /// After substitution, because in a generic's copy the node still reads `A`.
    /// The positions of a fixed-arity tuple, or nothing for anything else.
    ///
    /// Three ways a tuple can be spelled at this point, and all three are here
    /// because each was found separately by a probe that did not build:
    ///
    /// - written out, `...args: [number, string]`;
    /// - a type parameter this copy substituted, `...args: A` with `A = [f64]`
    ///   -- and the representation cannot answer it, because an array is what
    ///   a tuple represents as and the arity is gone by then. That is what
    ///   `sources` is for;
    /// - an alias or constraint that resolves to one, which
    ///   [`Self::after_substitution`] already handled for object types.
    pub(super) fn fixed_arity_positions(&self, ty: TypeId) -> Option<Vec<TypeId>> {
        Some(self.tuple_shape(ty)?.elements.clone())
    }

    /// The checker's tuple shape after this copy's substitutions. Position
    /// kinds remain part of the answer; positions alone do not prove arity.
    pub(super) fn tuple_shape(&self, ty: TypeId) -> Option<&nts_semantic_schema::TupleType> {
        let ty = self
            .sources
            .get(&ty)
            .copied()
            .unwrap_or_else(|| self.after_substitution(ty));
        let TypeKind::Tuple(positions) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        Some(positions)
    }

    /// The parameters as the callee declares them, before any expansion.
    pub(super) fn declared_parameters(&self, call: NodeId) -> Vec<(Option<TypeId>, bool, bool)> {
        if let Some((site, declaration)) = self.argument_declaration
            && site == call
        {
            return self.parameters_declared_by(declaration);
        }
        if let Some(signature) = self.overriding_signature(call) {
            return signature
                .parameters
                .iter()
                .map(|parameter| (Some(parameter.ty), parameter.optional, parameter.rest))
                .collect();
        }
        let Some(target) = self.snapshot.call_targets.get(&call) else {
            return Vec::new();
        };
        // **The implementation's parameters, where the call resolved to an
        // overload signature.** The emitted function is the implementation's, so
        // its parameter is the slot an argument is going into. Reading the
        // resolved signature gave two wrong answers on one program: `p.pick(n)`
        // matched `pick(a: number)` and found no parameter at index 1 at all,
        // and `p.pick(n, 2)` coerced to an `f64` where the implementation's
        // `b?: number` is erased.
        if let Some(callee) = target.callee {
            let implementation = self.implementation_of(callee);
            if implementation != callee {
                return self.parameters_declared_by(implementation);
            }
        }
        self.snapshot
            .signatures
            .get(target.signature.0 as usize)
            .map(|signature| {
                signature
                    .parameters
                    .iter()
                    .map(|parameter| (Some(parameter.ty), parameter.optional, parameter.rest))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub(super) fn parameters_declared_by(
        &self,
        declaration: NodeId,
    ) -> Vec<(Option<TypeId>, bool, bool)> {
        self.children(declaration)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .map(|param| {
                let children = self.children(param);
                let rest = children
                    .iter()
                    .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN));
                let optional = self.default_of(param).is_some()
                    || children
                        .iter()
                        .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_TOKEN));
                (
                    self.snapshot.node_types.get(&param).copied(),
                    optional,
                    rest,
                )
            })
            .collect()
    }

    fn argument_callee(&self, call: NodeId) -> Option<NodeId> {
        self.argument_declaration
            .filter(|(site, _)| *site == call)
            .map(|(_, declaration)| declaration)
            .or_else(|| self.snapshot.call_targets.get(&call)?.callee)
    }

    pub(super) fn parameter_shapes(&self, call: NodeId) -> Vec<(bool, bool)> {
        self.effective_parameters(call)
            .into_iter()
            .map(|(_, optional, rest)| (optional, rest))
            .collect()
    }

    /// How many arguments a call's callee takes, where the call resolves to one
    /// that declares no rest: its parameters. `None` for a callee nothing
    /// resolved -- where no parameters is not known to mean none -- and for
    /// **any** rest, including one typed as a tuple that
    /// [`Self::effective_parameters`] expands position by position.
    ///
    /// The tuple case is why this reads the *declared* list. A variadic tuple,
    /// `...args: [string, ...number[]]`, reaches the snapshot without its rest
    /// marker, the same record as `[string, number]`
    /// (`outcomes/a-variadic-tuple-rest-expanded-as-fixed-arity`), so its
    /// expansion counts two. Answering two here would drop the arguments past
    /// it: `f("a", 1, 2)` compiled, answering a length of 2 where node answers 3,
    /// instead of the invalid HIR that record pins.
    pub(super) fn fixed_arity(&self, call: NodeId) -> Option<usize> {
        if self.overriding_signature(call).is_none()
            && !self.snapshot.call_targets.contains_key(&call)
            && self
                .argument_declaration
                .is_none_or(|(site, _)| site != call)
        {
            return None;
        }
        if self
            .declared_parameters(call)
            .iter()
            .any(|(_, _, rest)| *rest)
        {
            return None;
        }
        Some(self.parameter_shapes(call).len())
    }

    pub(super) fn parameter_type_id(&self, call: NodeId, at: usize) -> Option<TypeId> {
        self.effective_parameters(call).get(at)?.0
    }

    /// What a call has to supply for a parameter its argument list did not
    /// reach.
    ///
    /// Both are work at the *call* rather than a note on the declaration: a
    /// default has to be evaluated once per call that omits it, and an absence
    /// has to be a value in the argument list because the callee has a
    /// parameter for it either way.
    ///
    /// Refuses the same default `lower_param` refuses, in the same words. The
    /// declaration is not always lowered before the call -- and when it is, the
    /// call would otherwise fail here on the *parameter name*, reporting `a` as
    /// a name from an enclosing scope, which is true of the expression as this
    /// site sees it and says nothing about the cause.
    /// The default the callee declares for its parameter at `at`, and the
    /// callee: read from the implementation's parameter list, for the reason
    /// [`Self::omitted_after`] gives. The one answer both an omitted argument
    /// and a passed `undefined` take their default from.
    pub(super) fn declared_default(&self, call: NodeId, at: usize) -> Option<(NodeId, NodeId)> {
        let (parameter, callee) = self.declared_parameter(call, at)?;
        Some((self.default_of(parameter)?, callee))
    }

    /// The callee's parameter at `at`, and the callee, from the
    /// implementation's parameter list.
    pub(super) fn declared_parameter(&self, call: NodeId, at: usize) -> Option<(NodeId, NodeId)> {
        let callee = self.argument_callee(call)?;
        let parameter = self
            .children(self.implementation_of(callee))
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .nth(at)?;
        Some((parameter, callee))
    }

    pub(super) fn omitted_after(&self, call: NodeId, provided: usize) -> Vec<Omitted> {
        let callee = self.argument_callee(call);
        if callee.is_none() && !self.snapshot.call_targets.contains_key(&call) {
            return Vec::new();
        }
        // **The implementation's parameter list, not the one the checker
        // resolved to.**
        //
        // TypeScript matches a call against whichever *overload signature*
        // fits, and those are separate declarations with no bodies. Only the
        // implementation is emitted, so its list is the one a call has to be
        // built against: `p.pick(n)` matches `pick(a: number)` and lands on
        // `Picker#pick(this, a, b)`, which is where
        // `CallArgumentCount { expected: 3, found: 2 }` came from.
        let implementation = callee.map(|callee| self.implementation_of(callee));
        // The declaration's parameter list, where there is one. A shape says
        // *that* a parameter has a default; the default **expression** only
        // exists in the syntax.
        let declared: Vec<NodeId> = implementation
            .map(|callee| {
                self.children(callee)
                    .into_iter()
                    .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
                    .collect()
            })
            .unwrap_or_default();
        let parameters = self.parameter_shapes(call);
        let mut omitted = Vec::new();
        for (at, (optional, rest)) in parameters.into_iter().enumerate().skip(provided) {
            // The rest is `lower_arguments`'s to fill, not this function's:
            // filling it here would build the array it is supposed to collect,
            // and everything after a rest is inside it. So this stops and the
            // caller checks again once the defaults are in.
            //
            // The comment here used to say a rest parameter was refused at the
            // declaration, which stopped being true when rest parameters
            // landed. The `break` stayed correct and the reason for it did not,
            // and the gap between them was one missing empty array.
            if rest {
                break;
            }
            let declaration = declared.get(at).copied();
            if let Some((default, callee)) = self.declared_default(call, at) {
                omitted.push(Omitted::Default(default, callee));
                continue;
            }
            // **A parameter that is not optional is still absent in JavaScript**,
            // where a missing argument *is* `undefined` and no call is too short.
            // TypeScript rejects `f(1, 1)` against four parameters (TS2554), so
            // this arm is only reachable from a `.js` file under `checkJs: false`
            // -- which is what test262 is, and where every parameter is `any`.
            //
            // The condition is that the absence be **representable**: an erased
            // parameter holds `undefined` the way an optional one does, and a
            // concrete one does not, so `f(1)` against `(a: number, b: number)`
            // still refuses rather than inventing a zero. That is the whole of the
            // widening -- `optional` keeps its own behaviour exactly, and a
            // parameter with a default is taken above.
            //
            // It was invisible until `any` had a representation: before that an
            // erased parameter's function did not lower at all. What it left was
            // `CallArgumentCount { callee: "inner", expected: 4, found: 2 }`, which
            // is invalid HIR, so `emit-c` wrote nothing for the **whole program** --
            // 46 recorded test262 files, led by the block-scope shadowing group and
            // tagged templates.
            //
            // Only where the declaration agrees there is a parameter here. An
            // overload's signature and the implementation's parameter list are
            // two different lists, and passing against the wrong one would put
            // the arity out in the other direction.
            // **And the new clause needs the declaration, where `optional` does
            // not.** `parameter_shapes` answers from the *signature*, and for a
            // library method that is `lib.d.ts`'s list rather than the emitted
            // function's: `Iterator<T>.return?(value?: any)` declares a parameter
            // and the `Iterator#return` this program emits takes none, so filling
            // from the signature alone put the arity out **in the other
            // direction** -- `CallArgumentCount { callee: "Iterator<9931>#return",
            // expected: 1, found: 2 }`, in six runtime modules. Which is the
            // hazard the paragraph above already names, and `optional` is exempt
            // from it only because an optional parameter the implementation does
            // not have is not a parameter anyone passes.
            //
            // Caught by `emitted-diff` and by nothing else: `refusal-diff` reads 0
            // moves to a loss, because invalid HIR is a whole-program failure and
            // not a function that stopped compiling.
            let absence_is_representable = optional
                || (declaration.is_some()
                    && self.parameter_representation(call, at) == Some(HirType::Erased));
            if absence_is_representable && (callee.is_none() || declaration.is_some()) {
                omitted.push(Omitted::Absent);
            }
        }
        omitted
    }

    pub(super) fn lower_param(&mut self, id: NodeId, index: u32) -> Result<Vec<Param>, Diagnostic> {
        self.lower_param_binding(id, index, ParameterNames::Bound)
    }

    /// `lower_param`, told whether the parameter's names are to be bound.
    ///
    /// [`ParameterNames::Forwarded`] is for a **forwarder** -- a wrapper for a function or a
    /// method used as a value -- which has no body to read a name and whose binding
    /// of a *pattern* parameter would therefore only **run the pattern's defaults**,
    /// once here and once again in the function it forwards to.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_param_binding(
        &mut self,
        id: NodeId,
        index: u32,
        binds: ParameterNames,
    ) -> Result<Vec<Param>, Diagnostic> {
        let children = self.children(id);
        // A name, or a pattern standing where one would be. `function f({ x }:
        // P)` is one parameter carrying one value, and the pattern is what the
        // body reads out of it.
        let name_node = children
            .iter()
            .find(|child| {
                matches!(
                    self.kind_of(**child),
                    Some(
                        syntax::IDENTIFIER
                            | syntax::OBJECT_BINDING_PATTERN
                            | syntax::ARRAY_BINDING_PATTERN
                    )
                )
            })
            .copied()
            .ok_or_else(|| self.unsupported(id, "a parameter with no name"))?;

        // A `this` annotation is not a parameter. See [`Self::annotates_this`].
        if self.annotates_this(name_node) {
            return Ok(Vec::new());
        }

        // A parameter list that does not line up with the argument list, one
        // way or the other. Both were *silently* lowered as ordinary
        // parameters, which is the shape that matters: no diagnostic, and C
        // that does not compile. A default emitted a call with too few
        // arguments; a rest emitted a `double` cast to an array pointer
        // followed by the remaining arguments.
        //
        // A default needs the initializer evaluated at every call that omits
        // it, and a rest needs an array built there, so both are real work at
        // the *call* rather than a note on the declaration.
        // A rest parameter *is* an ordinary parameter of array type. What was
        // missing was never the declaration -- it is the call, which has to
        // gather its trailing arguments into that array; `lower_arguments` is
        // the other half of this.
        //
        // What is still refused is a rest whose element has no representation:
        // `...args: A` where `A extends unknown[]` has none until an
        // instantiation supplies one.
        //
        // A *union of tuples* is the other shape that arrives here, and it is
        // not the same refusal wearing a different type. See
        // [`Self::rest_element_of_a_tuple_union`].
        let is_rest = children
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN));

        // **A rest whose type is a fixed-length tuple is not variable-arity at
        // all.** `(...args: [number, string])` takes exactly two arguments, and
        // two of the three places that decide a signature's arity already said
        // so: [`Self::effective_parameters`] expands the declaration a *call*
        // resolves against, and a closure's synthesised `call` has expanded it
        // since it was written. Only this site still built an array, so the
        // three disagreed -- and because a parameter list mismatch is not a
        // diagnostic, the result was invalid HIR reported against the callee.
        //
        // The A/B that settled the direction: with the call side left alone,
        // the surviving error in both probes was `Closure#call` wanting a
        // scalar and being handed an array. The declaration is the odd one out,
        // and positional is also the representation worth having -- a
        // fixed-arity rest should cost what the same parameters written out
        // would, which is no allocation.
        //
        // The N parameters *are* the declaration. The array is then built from
        // them and bound to the name, so every read in the body -- `args[0]`,
        // `args.length`, `args.map(…)`, a capture, a reassignment -- goes
        // through the ordinary binding and needs to know nothing about any of
        // this. That is deliberate: a `positional_rests` side table consulted
        // at the four sites I first listed would have been wrong at the ten
        // others that read `bindings` directly. Where the uses are ones the
        // escape analysis can see through, the array has no live use left and
        // goes away; where the body genuinely needs an array, it gets one.
        if is_rest
            && let Some(positions) = self
                .snapshot
                .node_types
                .get(&name_node)
                .copied()
                .and_then(|ty| self.fixed_arity_positions(ty))
        {
            return self.lower_positional_rest(name_node, index, &positions);
        }

        let rest_array = if is_rest {
            match self.type_of(name_node) {
                Some(array @ HirType::Managed(ManagedType::Array(_))) => Some(array),
                _ => match self.rest_element_of_a_tuple_union(name_node) {
                    Some(element) => Some(HirType::Managed(ManagedType::Array(Box::new(element)))),
                    None => {
                        return Err(self.unsupported(
                            id,
                            "a rest parameter whose element type has no representation",
                        ));
                    }
                },
            }
        } else {
            None
        };
        // A default is supplied by the calls that omit it, which is where
        // JavaScript evaluates it. Reading an *earlier parameter* used to be
        // refused here, on the grounds that the call site cannot reach the
        // callee's scope -- and it does not have to: it has already computed
        // those arguments, and `lower_arguments` binds the callee's names to
        // them for exactly as long as the default is being lowered.
        //
        // Reading a *later* parameter is a different thing and TypeScript
        // refuses it itself (TS2372), so nothing here has to.

        let name = self
            .node(name_node)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map_or_else(|| format!("arg{index}"), str::to_owned);
        // The rest case has already decided, and for a tuple union it decided
        // something `type_of` cannot say. **An elision pattern nothing annotates
        // takes any iterable**: its type is the pattern's own `[any?]`, which says
        // nothing about what a caller passes, so it is erased -- as every direct
        // call to it is told. See [`elision_patterns::takes_any_iterable`].
        // **A structural specialisation re-types this parameter and nothing
        // else.** `readName(v: Named)` specialised over `Thing` takes a `Thing`
        // here, so the body's `v.name` reads Thing's layout at Thing's offset --
        // and every *other* mention of `Named` in the same function still means
        // `Named`, which is the distinction the first attempt got wrong by
        // substituting the type. See [`Structural`]. Asked first, because a
        // union with no representation of its own is copied over the member
        // its callers pass.
        let ty = match (self.retyped.get(&index), rest_array) {
            (Some(retyped), _) => retyped.clone(),
            (None, Some(array)) => array,
            (None, None) if elision_patterns::takes_any_iterable(self, id) => HirType::Erased,
            (None, None) => self
                .type_of(name_node)
                .ok_or_else(|| self.unrepresentable(name_node, "a parameter"))?,
        };
        // **A parameter is a slot after all**, and the reason is the calling
        // convention rather than a read. See [`in_a_slot`].
        let ty = in_a_slot(ty);
        if let Some(lent) = self.lent_hstring_param(name_node, index, &name, &ty) {
            return Ok(vec![lent]);
        }
        self.materialize(name_node, &ty)?;

        let origin = self.origin(name_node);
        // What the declared type says, before anything in the body is seen.
        let known = self
            .snapshot
            .node_types
            .get(&name_node)
            .map_or(Facts::TOP, |declared| {
                known_values(self.snapshot, *declared, 0)
            });
        let raw_default = self.parameter_defaults_in_entry() && self.default_of(id).is_some();
        let initializer = self
            .default_of(id)
            .filter(|_| raw_default && binds == ParameterNames::Bound);
        let input_type = if raw_default {
            HirType::Erased
        } else {
            ty.clone()
        };
        let value = self.push(OpKind::Param(index), input_type.clone(), origin.clone());
        let value = if let Some(initializer) = initializer {
            self.bind_parameter_default(value, initializer, &ty)?
        } else {
            value
        };
        // Bound by symbol, so every later mention of this name resolves to the
        // same value rather than to a fresh load. A pattern has no symbol of
        // its own -- its *elements* do, and each is a read of the parameter.
        if matches!(
            self.kind_of(name_node),
            Some(syntax::OBJECT_BINDING_PATTERN | syntax::ARRAY_BINDING_PATTERN)
        ) {
            // **Not in a forwarder**, which has no body to read the names and whose
            // binding would therefore only *run the pattern's defaults* -- once
            // here and once again in the function it forwards to. `#m([[x] =
            // init()])` handed out through `get m() { return this.#m }` called
            // `init()` twice; called directly, once. The argument goes through
            // whole and the real function destructures it, which is the only
            // place that should.
            if binds == ParameterNames::Bound {
                let scope = if self.parameter_entry.is_some() {
                    PatternScope::Parameters
                } else {
                    PatternScope::Local
                };
                self.bind_pattern(name_node, value, scope)?;
            }
        } else if let Some(symbol) = self.node(name_node).symbol
            && (binds == ParameterNames::Bound || self.parameter_entry.is_none())
        {
            // A parameter is a name like any other, and `callback =
            // asRequest(callback)` before a closure reads it is common enough
            // in the profile that missing this emitted C that did not compile.
            let value = self.open_cell(symbol.0, value, name_node);
            self.bindings.insert(symbol.0, value);
        }

        // What the declaration said, beyond the type. Both halves were already
        // computed above -- the rest check reads `DOT_DOT_DOT_TOKEN` and the
        // default check calls `default_of` -- and both were discarded.
        //
        // Order matters: a rest parameter cannot be optional or defaulted, and
        // `x?: T = e` is not legal TypeScript, so the three are exclusive and
        // the first match is the answer.
        let shape = if children
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN))
        {
            ParamShape::Rest
        } else if self.default_of(id).is_some() {
            ParamShape::Defaulted
        } else if children
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_TOKEN))
        {
            ParamShape::Optional
        } else {
            ParamShape::Ordinary
        };

        let parameter = Param {
            name,
            ty: ty.clone(),
            origin,
            shape,
            known,
            written: self.written_kind(name_node),
        };
        if input_type != ty {
            self.parameter_types.insert(
                index,
                parameter_entries::PublicInput {
                    parameter: parameter.clone(),
                    absent: self.absence_at_excluding(name_node, &ty, false),
                    slots: self.erased_slots_at(name_node, &ty),
                },
            );
            return Ok(vec![Param {
                ty: input_type,
                known: Facts::TOP,
                written: None,
                ..parameter
            }]);
        }
        Ok(vec![parameter])
    }
}
