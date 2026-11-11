//! Discover and emit bound-method and Function.bind wrappers with their retained arguments and receiver.

use super::{
    Absent, BinOp, Callee, ClosureInfo, ClosureSource, Diagnostic, Facts, Field, Func, FuncBuilder,
    HirType, ManagedType, MethodAccessor, NodeId, OpKind, Origin, Param, ParamShape,
    RAISING_SUFFIX, SymbolFlags, SymbolId, Terminator, TypeId, TypeKind, UniformArguments, ValueId,
    closure_body_name, closure_index, closure_names, closure_type, instance_type_of,
    literal_methods, member_dispatch_key, names_a_raising_copy, parameters_of,
    receiving_function_name, syntax, taken_as_a_closure, the_function_of,
};

/// One job per module an `import()` names: see [`ClosureSource::ModuleJob`].
/// Per module rather than per site, because what a job does depends only on the
/// module -- every `import()` of it settles with the same namespace or error.
/// One closure per `f.bind(...)` whose receiver is a function value: the bound
/// function it makes ([`ClosureSource::Bound`]). Refused in a generic context,
/// for the reason a reaction is: its fields are typed from the checker's types
/// at the site, which a copy re-types.
pub(super) fn bound_functions(probe: &FuncBuilder, closures: &mut Vec<ClosureInfo>) {
    for at in 0..probe.snapshot.nodes.len() {
        let site = NodeId(u32::try_from(at).unwrap_or(u32::MAX));
        if probe.kind_of(site) != Some(syntax::CALL_EXPRESSION) {
            continue;
        }
        let Some((receiver, method)) = probe
            .children(site)
            .first()
            .and_then(|callee| probe.member_access(*callee))
        else {
            continue;
        };
        let function = probe
            .snapshot
            .node_types
            .get(&receiver)
            .and_then(|ty| probe.snapshot.types.get(ty.0 as usize))
            .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)));
        if method != "bind" || !function {
            continue;
        }
        let generic = std::iter::successors(probe.node(site).parent, |at| probe.node(*at).parent)
            .any(|enclosing| {
                probe
                    .children(enclosing)
                    .into_iter()
                    .any(|child| probe.kind_of(child) == Some(syntax::TYPE_PARAMETER))
            });
        closures.push(ClosureInfo {
            source: ClosureSource::Bound,
            refusal: generic.then_some(A_BOUND_FUNCTION_IN_A_GENERIC),
            ..ClosureInfo::as_written(site)
        });
    }
}

/// Why a `bind` in a generic context is refused: see [`bound_functions`].
const A_BOUND_FUNCTION_IN_A_GENERIC: &str =
    "a `bind` inside a generic function or class, whose bound values a copy would re-type";

impl FuncBuilder<'_> {
    /// What a bound function holds and takes, from the `bind` call's node: its
    /// fields -- the function, the `this`, the bound arguments at the types the
    /// function declares for them -- and its own parameters and result, from the
    /// signature the checker gives the call. One derivation for the site that
    /// fills the fields and the body that reads them.
    fn bound_shape(
        &mut self,
        site: NodeId,
    ) -> Result<(Vec<Field>, Vec<Param>, HirType), Diagnostic> {
        let callee = *self
            .children(site)
            .first()
            .ok_or_else(|| self.unsupported(site, "a `bind` with no callee"))?;
        let (function, _) = self
            .member_access(callee)
            .ok_or_else(|| self.unsupported(site, "a `bind` not on a member"))?;
        let signature_of = |this: &Self, node: NodeId| {
            this.snapshot
                .node_types
                .get(&node)
                .and_then(|ty| this.snapshot.types.get(ty.0 as usize))
                .and_then(|record| match record.kind {
                    TypeKind::Function(signature) => {
                        this.snapshot.signatures.get(signature.0 as usize)
                    }
                    _ => None,
                })
                .cloned()
        };
        let (Some(target), Some(result)) = (signature_of(self, function), signature_of(self, site))
        else {
            return Err(
                self.unsupported(site, "a `bind` whose function or result has no signature")
            );
        };
        let bound = self.arguments_of(site).len().saturating_sub(1);
        let function_ty = self
            .type_of(function)
            .ok_or_else(|| self.unrepresentable(function, "a bound function"))?;
        let mut fields = vec![
            Field {
                name: ("function".to_owned()).into(),
                ty: function_ty,
                readonly: true,
                declared_by: None,
                written: None,
            },
            Field {
                name: ("this".to_owned()).into(),
                ty: HirType::Erased,
                readonly: true,
                declared_by: None,
                written: None,
            },
        ];
        for (at, parameter) in target.parameters.iter().take(bound).enumerate() {
            if parameter.rest {
                return Err(self.unsupported(site, "a `bind` that binds into a rest parameter"));
            }
            let ty = self
                .represent(parameter.ty)
                .ok_or_else(|| self.unrepresentable(site, "a bound argument"))?;
            fields.push(Field {
                name: format!("bound{at}").into(),
                ty,
                readonly: true,
                declared_by: None,
                written: None,
            });
        }
        let params = self.bound_parameters(site, &result)?;
        let returns = self
            .represent(result.return_type)
            .ok_or_else(|| self.unrepresentable(site, "a bound function's result"))?;
        Ok((fields, params, returns))
    }

    /// A bound function's own parameters: the closure, then what remains of the
    /// function's after the bound ones, from the signature the checker gives the
    /// `bind` call. Parameter zero's type is the caller's to set.
    fn bound_parameters(
        &mut self,
        site: NodeId,
        result: &nts_semantic_schema::SignatureRecord,
    ) -> Result<Vec<Param>, Diagnostic> {
        let origin = self.origin(site);
        let mut params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: HirType::Managed(ManagedType::Object(TypeId(0))),
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        for (name, ty) in self.bound_parameter_types(site, result)? {
            let ty = self
                .represent(ty)
                .ok_or_else(|| self.unrepresentable(site, "a bound function's parameter"))?;
            params.push(Param {
                name,
                shape: ParamShape::Ordinary,
                ty,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
        }
        Ok(params)
    }

    /// The bound body's ABI and its uniform entry read the same positional
    /// source types, including the elements of `bind`'s tuple rest.
    pub(super) fn bound_parameter_types(
        &self,
        site: NodeId,
        result: &nts_semantic_schema::SignatureRecord,
    ) -> Result<Vec<(String, TypeId)>, Diagnostic> {
        // `bind`'s own declaration types its result `(...args: A) => R`, so the
        // checker's signature is one rest parameter whose type is the tuple of
        // what remains -- which is exactly that many parameters, one per
        // element. A rest of an array type is not, and is refused.
        let mut remaining: Vec<(String, TypeId)> = Vec::new();
        for parameter in &result.parameters {
            if !parameter.rest {
                remaining.push((parameter.name.clone(), parameter.ty));
                continue;
            }
            let Some(TypeKind::Tuple(elements)) = self
                .snapshot
                .types
                .get(parameter.ty.0 as usize)
                .map(|record| &record.kind)
            else {
                return Err(self.unsupported(
                    site,
                    "a bound function whose remaining parameters end in a rest",
                ));
            };
            for (at, element) in elements.elements.iter().enumerate() {
                remaining.push((format!("{}{at}", parameter.name), *element));
            }
        }
        Ok(remaining)
    }

    /// The body of a bound function ([`ClosureSource::Bound`]): read the
    /// function, the `this` and the bound arguments back, and call the function
    /// through the entry any call of a function value takes, the bound
    /// arguments before its own.
    pub(super) fn lower_bound_function(
        &mut self,
        index: usize,
        info: &ClosureInfo,
    ) -> Result<Func, Diagnostic> {
        let site = info.node;
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(site, reason));
        }
        let (fields, mut params, returns) = self.bound_shape(site)?;
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        params[0].ty = receiver_ty.clone();
        let origin = self.origin(site);
        let receiver = self.push(OpKind::Param(0), receiver_ty, origin.clone());
        let mut own = Vec::new();
        for (at, param) in params.iter().enumerate().skip(1) {
            let at = u32::try_from(at).unwrap_or(u32::MAX);
            own.push(self.push(OpKind::Param(at), param.ty.clone(), origin.clone()));
        }
        // The layout first: parameter zero is the closure itself, and
        // materialising it looks its layout up.
        self.layouts
            .push(self.closure_layout(index, fields.clone()));
        for field in &fields {
            self.materialize(site, &field.ty)?;
        }
        for param in &params {
            self.materialize(site, &param.ty)?;
        }
        let read = |this: &mut Self, at: usize| {
            let field = u32::try_from(at).unwrap_or(u32::MAX);
            this.push(
                OpKind::FieldGet {
                    object: receiver,
                    field,
                },
                fields[at].ty.clone(),
                origin.clone(),
            )
        };
        let function = read(self, 0);
        let this = read(self, 1);
        let mut args = vec![function];
        for at in 2..fields.len() {
            args.push(read(self, at));
        }
        let own_at = args.len();
        args.extend(own);
        let callee_node = *self
            .children(site)
            .first()
            .ok_or_else(|| self.unsupported(site, "a `bind` with no callee"))?;
        // Inside the raising variant the call is at the raising entry, so a raise
        // goes on to this body's caller; the call has no node to ask. The test
        // after it returns a zero of this body's result, which is what
        // `self.returns` is for: unset, it was `void`, and a bound function
        // returning a number returned nothing (`ReturnType`, invalid HIR).
        let raising = self.raises && self.hierarchy.raising_call_slot.is_some();
        let callee = self.closure_entry(site, callee_node, function, raising)?;
        self.erase_bound_inputs(info, &mut args[own_at..]);
        let sources = self
            .arguments_of(site)
            .into_iter()
            .skip(1)
            .map(|node| (node, self.read_type(node)))
            .collect();
        self.argument_sources
            .insert(site, UniformArguments::new(sources));
        self.returns = returns.clone();
        let answered = self.call_a_closure_entry(site, callee, Some(this), args, &returns)?;
        let carried = (!matches!(returns, HirType::Void | HirType::Never)).then_some(answered);
        self.terminate(Terminator::Return(carried));
        Ok(self.finish(name, params, returns, origin, false))
    }

    /// Whether bound arguments beyond the signature's stored positions cannot
    /// be observed by the actual target. A signature alone is not a proof: its
    /// implementation may have more parameters, a rest, or read `arguments`.
    fn bound_extras_are_ignored(&self, function: ValueId, stored: usize) -> bool {
        let HirType::Managed(ManagedType::Object(class)) = self.values[function.0 as usize].ty
        else {
            return false;
        };
        if !crate::hir::is_closure_type(class) {
            return false;
        }
        let Some(info) = self.closures.get(closure_index(class)) else {
            return false;
        };
        if !matches!(
            info.source,
            ClosureSource::Authored | ClosureSource::Function
        ) {
            return false;
        }
        let declaration = self.implementation_of(the_function_of(self, info.node));
        let kind = self.kind_of(declaration);
        if !matches!(
            kind,
            Some(
                syntax::FUNCTION_DECLARATION | syntax::FUNCTION_EXPRESSION | syntax::ARROW_FUNCTION
            )
        ) || (kind != Some(syntax::ARROW_FUNCTION)
            && !self
                .children(declaration)
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::BLOCK)))
        {
            return false;
        }
        let parameters: Vec<_> = parameters_of(self, declaration)
            .into_iter()
            .filter(|parameter| {
                !self
                    .children(*parameter)
                    .iter()
                    .any(|child| self.annotates_this(*child))
            })
            .collect();
        if parameters.len() > stored
            || parameters.iter().any(|parameter| {
                self.children(*parameter)
                    .iter()
                    .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN))
            })
        {
            return false;
        }
        // Conservative over nested syntax too, including an arrow capturing
        // the target's arguments. Nothing inspects a signature's arity to
        // conclude that these values are unobservable.
        let mut pending = vec![declaration];
        while let Some(node) = pending.pop() {
            if self.kind_of(node) == Some(syntax::IDENTIFIER)
                && self.builtin_binding_at(node)
                    == Some(nts_semantic_schema::BuiltinBinding::Arguments)
            {
                return false;
            }
            pending.extend(self.children(node));
        }
        true
    }

    /// `f.bind(r, ...bound)`: the bound function ([`ClosureSource::Bound`]), its
    /// fields filled here. `r` is the `this` the call writes, `undefined` where
    /// it writes none, lowered as `.call` lowers its own.
    pub(super) fn lower_bind(
        &mut self,
        id: NodeId,
        function: ValueId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(index) = self
            .closures
            .iter()
            .position(|closure| closure.source == ClosureSource::Bound && closure.node == id)
        else {
            return Err(self.unsupported(id, "a `bind` the closure collector did not see"));
        };
        if let Some(reason) = self.closures[index].refusal {
            return Err(self.unsupported(id, reason));
        }
        let (fields, _, _) = self.bound_shape(id)?;
        let stored = fields.len().saturating_sub(2);
        if arguments.len().saturating_sub(1) > stored
            && !self.bound_extras_are_ignored(function, stored)
        {
            return Err(self.unsupported(
                id,
                "a `bind` with extra arguments whose target is not a known body that ignores them",
            ));
        }
        let origin = self.origin(id);
        let this = match arguments.first() {
            Some(given) => self.lower_this_argument(*given)?,
            None => self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone()),
        };
        let mut bound = Vec::new();
        for (at, argument) in arguments.iter().skip(1).enumerate() {
            if let Some(field) = fields.get(2 + at) {
                let ty = field.ty.clone();
                let value = self.lower_expecting(*argument, &ty)?;
                bound.push(self.coerce(value, &ty, *argument)?);
            } else {
                // Even an ignored value is evaluated once, at bind time and
                // in order, including any exception it throws.
                self.lower_for_its_effects(*argument)?;
            }
        }
        self.used_closures.push(index);
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(index))),
            origin.clone(),
        );
        self.field_set(object, 0, function, &origin);
        self.field_set(object, 1, this, &origin);
        for (at, value) in bound.into_iter().enumerate() {
            let field = u32::try_from(2 + at).unwrap_or(u32::MAX);
            self.field_set(object, field, value, &origin);
        }
        self.layouts.push(self.closure_layout(index, fields));
        Ok(object)
    }

    /// The representation of a name bound to a `const` arrow, where it is one.
    ///
    /// **The same answer the creating side gives**, which is the whole of why
    /// this exists. A closure's captures are typed twice: the enclosing
    /// function stores the value and takes `self.values[value].ty`, and the
    /// body reads it back and took `type_of(capture.at)` -- the *checker's*
    /// type, which for a captured arrow is its function type and has no layout.
    /// One closure capturing another therefore emitted
    ///
    /// ```text
    ///     field.set %2.0 = %1            managed<closure#0>   the store
    ///     %1 = field.get %0.0            managed<obj#4>       the read
    /// ```
    ///
    /// and the C backend said `an object type with no layout: type 4`. The two
    /// sides' `Field` lists are merged by `collect_layouts`, which the comment
    /// there calls "the check that the two sides agree"; it merged them without
    /// noticing, because a field's *name* and index agreed and only its type did
    /// not.
    ///
    /// `const` only, and the soundness argument is
    /// [`closure_typed_global`](super::closure_typed_global)'s word for word: a slot typed by a closure holds
    /// exactly the closure it was typed by, and a `let` may be reassigned with a
    /// different arrow, which is a different layout. A `let` falls through to
    /// the checker's type and is refused there as it was before.
    ///
    /// **And a nested `function` declaration is the other spelling.** One that
    /// captures is lowered as a closure body ([`not_a_plain_function`](super::not_a_plain_function)), so the
    /// declaration *is* the closure node and there is no initializer to look
    /// through. Without this arm the field was typed at the checker's answer for
    /// the name -- the function type -- while the value stored in it was the
    /// closure object, and `stored_capture` refused the pair by name. A
    /// declaration cannot be reassigned at all, so the `const` argument above
    /// applies to it a fortiori.
    pub(super) fn closure_bound_to(&self, symbol: u32) -> Option<HirType> {
        let declarations = &self.snapshot.symbols.get(symbol as usize)?.declarations;
        let node = match declarations
            .iter()
            .copied()
            .find(|node| self.kind_of(*node) == Some(syntax::FUNCTION_DECLARATION))
        {
            Some(declaration) if taken_as_a_closure(&self.closures, declaration) => declaration,
            // A nested declaration that captures nothing is an ordinary function
            // reached by name, and has no closure to be typed at.
            Some(_) => return None,
            None => {
                let declaration = declarations
                    .iter()
                    .copied()
                    .find(|node| self.kind_of(*node) == Some(syntax::VARIABLE_DECLARATION))?;
                if self.declaration_kind(declaration) != nts_semantic_schema::VariableKind::Const {
                    return None;
                }
                // Either way a closure is written: `closure_typed_global` asks
                // the same of a module-scope `const`. Asking for an arrow alone
                // typed a `function` expression's field at the checker's
                // function type while the closure object was stored in it, and
                // `stored_capture` refused the pair, as "a parameter this copy
                // re-typed" where no copy was involved
                // (`blockers/a-function-expression-captured-by-another`).
                self.children(declaration).into_iter().find(|child| {
                    matches!(
                        self.kind_of(*child),
                        Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
                    )
                })?
            }
        };
        // A refused closure has no layout to name, so this answers `None` and
        // the capture is refused with that closure's own reason rather than
        // with a missing layout.
        let index = self
            .closures
            .iter()
            .position(|closure| closure.node == node && closure.refusal.is_none())?;
        Some(HirType::Managed(ManagedType::Object(closure_type(index))))
    }

    /// Read a closure's captures back out of its object and bind them.
    ///
    /// Returns the fields, which the layout is then built from -- and the
    /// creation side builds the same list, so the two are checked against each
    /// other by `collect_layouts` merging them into one layout rather than two.
    /// What a wrapping closure's body calls, and with what.
    ///
    /// **A method's forwarding call is the one its call sites make.**
    /// `c.twice(n)` is `call.virtual[slot] C#twice(c, n)`, so a `c.twice` read
    /// as a value must dispatch the same way -- a `Callee::Direct` here would
    /// run the base's body for a receiver whose class overrides it, which is a
    /// wrong answer rather than a missing one.
    ///
    /// The receiver is field 0, read by [`Self::bind_receiver`] and left in
    /// `self.this`; it goes in front of the forwarded parameters, exactly where
    /// the method declares it. A free function and a static method have no
    /// receiver and are called directly.
    /// The forwarding body of a wrapper: one call to the function or method it
    /// stands for.
    ///
    /// **A wrapper has no body of its own**, which keeps the wrapped function's one
    /// definition the only one -- re-lowering the declaration's body here would
    /// compile it twice and give recursion two things to mean. Its own function
    /// because it is its own kind of body, and because the raise it has to carry is
    /// a question only a *built* body raises: see
    /// [`Self::wrapper_callee_that_raises`].
    pub(super) fn lower_wrapper_body(
        &mut self,
        index: usize,
        info: &ClosureInfo,
        (this_argument, forwarded): (Option<ValueId>, Vec<ValueId>),
        params: Vec<Param>,
        return_type: HirType,
    ) -> Result<Func, Diagnostic> {
        let id = info.node;
        let name = closure_body_name(index, info.reads_this);
        let origin = self.origin(id);

        // The name the wrapped function is *emitted* under, which is not
        // always the name written on it: where two modules declare the same
        // one, `Naming` qualifies both apart, and the definition is emitted
        // under the qualified name.
        //
        // Reading the identifier's text instead called a name that does not
        // exist. Nothing said so -- the call was to a function the program
        // does not define, the wrapper was refused for calling something
        // refused, and the wrapper *is* the closure's only method -- so the
        // vtable came out null and the compiled program dereferenced it.
        // `path` has `isPosixPathSeparator` in both `posix.ts` and
        // `win32.ts` and passes it to `normalizeString`, which is exactly
        // this shape.
        if forwarded.len() + 1 + usize::from(this_argument.is_some()) != params.len() {
            return Err(self.unsupported(
                id,
                "a function used as a value whose parameters are not plain names",
            ));
        }
        let (callee, args) = self.wrapped_call(id, info, this_argument, forwarded)?;
        // **A wrapper has to carry its callee's raise too, and nothing did it.**
        // Its body is one call *built* here rather than lowered from source, so
        // `raising_suffix_of` and `test_for_a_raise` -- both keyed on a call node
        // -- never see it. Inside a raising variant the wrapper called the plain
        // function, and the `throw` sailed past the very flag test the dispatch
        // had just set up.
        //
        // `tests/programs/a-callbacks-throw-inside-a-try`'s `call(thrower)` arm is the
        // witness, and its three sibling spellings -- an arrow at the call site,
        // a function expression, an arrow held in a `const` -- were all fine,
        // because those bodies *are* nodes. Four spellings of one construct and
        // only the fourth could see it, which is why that fixture has four.
        let callee = self.wrapper_callee_that_raises(id, info, callee)?;
        let names_a_raising_copy = names_a_raising_copy(&callee);
        let call = self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            return_type.clone(),
            origin.clone(),
        );
        if names_a_raising_copy {
            // **`self.returns` is what the raise path returns a zero of**, and the
            // wrapper path never set it: the non-wrapper body below saves and
            // restores it, because a wrapper had no `return` of its own to type.
            // Without this the test's no-handler branch took whatever the last body
            // left there and emitted `Return(None)` at a `double` --
            // `ReturnType { func: "Closure364#call@raises", expected: Float { bits:
            // 64 }, found: None }`, 111 invalid-HIR modules across the corpora from
            // one unset field. Saved and restored on the same terms, because
            // closures nest.
            let outer = std::mem::replace(&mut self.returns, return_type.clone());
            self.emit_the_raise_test(&origin);
            self.returns = outer;
        }
        let carried = (!matches!(return_type, HirType::Void)).then_some(call);
        self.terminate(Terminator::Return(carried));
        Ok(self.finish(name, params, return_type, origin, false))
    }

    /// The callee a wrapper's forwarding call names inside a **raising** variant:
    /// the raising copy where one exists, and a refusal where the callee can raise
    /// and there is none.
    ///
    /// The refusal is what `lower_wanted_closures` turns into the entry that aborts
    /// by name, so a `try` reaching such a wrapper declines loudly rather than losing
    /// the `throw`. A method's raising copy is named by [`Self::wrapped_call`], which
    /// knows the receiver's type and so direct from virtual.
    ///
    /// Outside a raising variant this is the identity, which is what keeps the
    /// ordinary path exactly as it was.
    pub(super) fn wrapper_callee_that_raises(
        &self,
        id: NodeId,
        info: &ClosureInfo,
        callee: Callee,
    ) -> Result<Callee, Diagnostic> {
        if !self.raises {
            return Ok(callee);
        }
        // **The symbol of a declaration, found through the declaration list.** A
        // `FunctionDeclaration` node carries no symbol in this encoding -- its name
        // child does -- so asking the node gave `None` for every wrapper, the test
        // below answered "cannot raise", and the rename never happened. The same
        // trap as a `Parameter` node, two functions over; `thenable_job` reads it
        // this way for the same reason.
        let can_raise = self
            .snapshot
            .symbols
            .iter()
            .position(|record| record.declarations.contains(&info.node))
            .and_then(|at| u32::try_from(at).ok())
            .is_some_and(|symbol| self.throwing.contains(&symbol));
        if !can_raise {
            return Ok(callee);
        }
        // **The implementation's copy, which is the one that exists.** For an
        // overloaded function `info.node` is the first signature -- what the name
        // resolves to -- while copies are keyed by the body built
        // (`eligible_declarations` goes through `implementation_of`), so the lookup
        // missed and every `try` reaching the wrapper aborted by name.
        if info.source == ClosureSource::Function
            && self.raising.contains(&self.implementation_of(info.node))
            && let Callee::Direct(name) = callee
        {
            return Ok(Callee::Direct(format!("{name}{RAISING_SUFFIX}")));
        }
        // A method's is named, direct or by its raising slot, by
        // [`Self::wrapped_call`], which knows the receiver's type. Checked here
        // rather than trusted: a plain callee passed on would let the `throw` end
        // the program from inside a `try` that compiled.
        if info.source == ClosureSource::Method && names_a_raising_copy(&callee) {
            return Ok(callee);
        }
        Err(self.unsupported(
            id,
            "a function used as a value inside a body that carries a `throw` back to its \
             caller, where what it forwards to has no raising copy to call",
        ))
    }

    fn wrapped_call(
        &mut self,
        id: NodeId,
        info: &ClosureInfo,
        this_argument: Option<ValueId>,
        forwarded: Vec<ValueId>,
    ) -> Result<(Callee, Vec<ValueId>), Diagnostic> {
        if !info.source.binds_receiver() {
            if let Some(helper) = self.intrinsic_declared_by(id) {
                return Ok((Callee::External(helper), forwarded));
            }
            let called = self
                .qualified
                .get(&id)
                .cloned()
                .or_else(|| self.static_method_name(id))
                .or_else(|| self.declared_name(id))
                .ok_or_else(|| self.unsupported(id, "a function declaration with no name"))?;
            // A declaration that reads its own `this` is called at the body
            // taking it, with the call's.
            if let Some(this) = this_argument {
                let mut args = vec![this];
                args.extend(forwarded);
                return Ok((Callee::Direct(receiving_function_name(&called)), args));
            }
            return Ok((Callee::Direct(called), forwarded));
        }
        let receiver = self
            .this
            .ok_or_else(|| self.unsupported(id, "a bound method with no receiver"))?;
        let HirType::Managed(ManagedType::Object(owner)) =
            self.values[receiver.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(id, "a bound method whose receiver is not an object"));
        };
        // `member_name_of` rather than `declared_name`: a private method's name
        // node is a `PRIVATE_IDENTIFIER`, and `declared_name` looks for an
        // `IDENTIFIER` -- so `#twice` reported "a method declaration with no
        // name" while every public method beside it worked.
        let member = member_dispatch_key(self, id)
            .ok_or_else(|| self.unsupported(id, "a method declaration with no name"))?;
        // Inside a raising variant, the method's raising copy where it has one;
        // `wrapper_callee_that_raises` refuses where it has none.
        let suffix = if self.raises && self.raising.contains(&self.implementation_of(id)) {
            RAISING_SUFFIX
        } else {
            ""
        };
        let callee = self.method_callee(id, owner, &member, suffix)?;
        let receiver = match this_argument {
            Some(this) => self.method_receiver(id, &callee, receiver, this)?,
            None => receiver,
        };
        let mut args = vec![receiver];
        args.extend(forwarded);
        Ok((callee, args))
    }

    /// The receiver a method taken as a value calls its method with, where the
    /// body reads `this`: the call's `this`, not the object it was read from.
    /// JavaScript does not bind a method read off an object
    /// (`docs/records/notebooks/function-receivers.md`).
    ///
    /// The implementation that runs is the read object's, though, and a call
    /// dispatches only on the receiver it passes. So where a subclass overrides
    /// the method, the call's `this` must be the read object itself, and
    /// anything else stops by name. Every use in the runtime has that shape:
    /// `this._writev = this._writeVector` is called back on the same stream,
    /// `this.equal = this.strictEqual` on the same `assert`. Where nothing
    /// overrides it the callee is one function, and the call's `this` only has
    /// to be proven an instance of the declaring class, as a `function`'s is
    /// ([`Self::receive_this`]).
    fn method_receiver(
        &mut self,
        id: NodeId,
        callee: &Callee,
        read: ValueId,
        this: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        if matches!(callee, Callee::Direct(_)) {
            return self.receive_this(id, this);
        }
        let origin = self.origin(id);
        let erased = self.push(
            OpKind::Erase {
                value: read,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
            origin.clone(),
        );
        let same = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: this,
                rhs: erased,
            },
            HirType::Bool,
            origin.clone(),
        );
        let refused = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: same,
            then_target: carry_on,
            then_args: Vec::new(),
            else_target: refused,
            else_args: Vec::new(),
        });
        self.switch_to(refused);
        let what = self.push(
            OpKind::ConstString(
                "a method taken as a value from one object and called with another as its \
                 `this`, where a subclass overrides it"
                    .to_owned()
                    .into(),
            ),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.runtime_call("nts_refused", vec![what], HirType::Void, origin);
        self.terminate(Terminator::Unreachable);
        self.switch_to(carry_on);
        Ok(read)
    }

    /// The receiver a bound method's closure carries, as its field 0.
    ///
    /// Read out of the closure object and left in `self.this`, which is where
    /// the forwarding call below picks it up -- and which is also what makes
    /// the method's own `this` work if the body is ever lowered here rather
    /// than forwarded to.
    ///
    /// The field's type is the *declaring class's instance type*, not the
    /// receiver's type at the read: a `D` read through a `C`-typed name binds a
    /// closure whose field is a `C`, and the virtual call then dispatches on
    /// what is actually there. Storing the narrower type would make one closure
    /// class per receiver type for one method.
    pub(super) fn bind_receiver(
        &mut self,
        method: NodeId,
        closure: ValueId,
        origin: &Origin,
    ) -> Result<Field, Diagnostic> {
        let owner = self
            .enclosing_class(method)
            .and_then(|class| instance_type_of(self.snapshot, class))
            .ok_or_else(|| self.unsupported(method, "a method declared outside a class"))?;
        let ty = HirType::Managed(ManagedType::Object(owner));
        let value = self.push(
            OpKind::FieldGet {
                object: closure,
                field: 0,
            },
            ty.clone(),
            origin.clone(),
        );
        self.this = Some(value);
        Ok(Field {
            name: ("this".to_owned()).into(),
            ty,
            readonly: true,
            declared_by: None,
            written: None,
        })
    }

    /// Why a property is not on a layout.
    ///
    /// Usually because the type does not have it. On an error it can instead be
    /// a member of the *declared* `Error` that this compiler chose not to
    /// provide, and saying which is the difference between "you misspelled it"
    /// and "a compiled binary keeps no record of the frames it came through".
    /// The single static closure a receiverless declaration is used as.
    ///
    /// A free function and a *static* method are the same shape here: nothing
    /// is captured, so one instance serves the whole program and the identity
    /// JavaScript gives -- `finish === finish` -- falls out. An instance method
    /// needs an object per read and goes through `bound_method` instead.
    pub(super) fn wrapping_closure(&mut self, symbol: SymbolId, at: NodeId) -> Option<ValueId> {
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        let index = record.declarations.iter().find_map(|declaration| {
            self.closures.iter().position(|closure| {
                closure.source == ClosureSource::Function && closure.node == *declaration
            })
        })?;
        if self.closures[index].refusal.is_some() {
            return None;
        }
        self.used_closures.push(index);
        self.layouts.push(self.closure_layout(index, Vec::new()));
        let ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(at);
        Some(self.push(OpKind::ClosureStatic, ty, origin))
    }

    /// A member the layout has no slot for: a getter, a method, or neither.
    ///
    /// Both of the first two *look* like a field read in source and are not
    /// storage -- which is why an accessor may not be laid out as a field:
    /// emitting the load would read whatever sits at that offset. The third is
    /// the refusal, which names the member.
    pub(super) fn member_that_is_not_a_field(
        &mut self,
        id: NodeId,
        value: ValueId,
        type_id: TypeId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(answer) = self.function_name(id, value, type_id, member_name)? {
            return Ok(answer);
        }
        if let Some(callee) = self.accessor_callee(
            id,
            type_id,
            &self.required_access_key(id, member_name)?,
            MethodAccessor::Get,
        )? {
            let ty = self
                .type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "a getter"))?;
            let origin = self.origin(id);
            return Ok(self.push_an_accessor_call(id, callee, vec![value], ty, origin));
        }
        if literal_methods::supplies_method_value(
            self,
            type_id,
            &self.required_access_key(id, member_name)?,
        ) {
            return Err(Diagnostic::error(
                "NTS1001",
                format!(
                    "reading literal method `{member_name}` as a value through another interface \
                    is not supported; call it directly, or read it from the literal's own type"
                ),
                self.location(id),
            ));
        }
        if let Some(bound) = self.bound_method(id, value, member_name)? {
            return Ok(bound);
        }
        if let Some(narrowed) = self.through_a_narrowed_class(id, value, type_id, member_name)? {
            return Ok(narrowed);
        }
        // **A fixed-arity tuple's `length` is its arity, folded.** There is
        // nothing to read: the count is in the type, TypeScript gives it the
        // literal number, and every position exists by construction.
        //
        // Reached only where the tuple is laid out as a **struct**, which is what
        // `tuple_representation` gives one whose positions differ in storage
        // width. A uniform tuple represents as an array and its `length` is
        // answered one path earlier, by the array member -- correctly, and at run
        // time, which this is the compile-time half of.
        //
        // **It is here because the struct half had no answer at all**, and that
        // was invisible while a mixed-width *rest* was bound to an array by
        // mistake: `(function(a, b, c, d, e, ...args) { return args.length })
        // (1,2,3,4,5)` gathers an **empty** tuple, which used to reach this path
        // through `Object(ty)` before empty tuples shared array storage. The
        // array representation had been supplying `length` by accident, and
        // fixing the representation published the gap --
        // `test/language/rest-parameters/rest-index.js` -- and a written
        // `const pair: [string, number]` refused on `pair.length` all along,
        // measured on the binary before that fix. So this is a hole the other
        // change uncovered rather than one it made.
        // This fold relies on the flat tuple representation and its admission
        // checks, including refusal of a literal whose element count differs
        // from the layout's position count. Snapshot element kinds and readonly
        // do not certify runtime extent or exclude a writable alias. Carrying
        // those facts must not loosen these checks or authorize a new fold.
        // A variable-extent tuple needs its runtime extent represented before
        // that admission can change.
        // `outcomes/a-variadic-tuple-rest-expanded-as-fixed-arity` records the
        // same missing fact from the other side, where it already costs a program:
        // the rest is expanded as that many parameters and every call of a
        // different length is `CallArgumentCount`, measured as pre-existing.
        if member_name == "length"
            && let Some(positions) = self.fixed_arity_positions(type_id)
        {
            let origin = self.origin(id);
            #[allow(clippy::cast_precision_loss)]
            let count = positions.len() as f64;
            return Ok(self.push(OpKind::ConstFloat(count), HirType::NUMBER, origin));
        }
        Err(self.absent_member(id, type_id, member_name))
    }

    /// `if (x instanceof Sub) x.own`, where `x` is declared at the base.
    ///
    /// The checker narrows `x` to `Sub` inside the guard and says so on the
    /// **node**; the *value* keeps the representation its declaration gave it,
    /// which is a pointer at the base. So the member is looked up in the base's
    /// layout, is not there, and the read refused -- with a sentence about the
    /// base, which is the type the program had already stopped talking about.
    ///
    /// Reported by the React lane, whose reconciler models tag-dependent fibre
    /// fields as a sealed base-class hierarchy: a base-typed field is an 8-byte
    /// `Managed(Object)` where a union of the same classes is a 16-byte `Erased`,
    /// so this is what lets those fields be pointer-sized.
    ///
    /// # Why it goes through the erased pair
    ///
    /// The narrowing is a **downcast**, and the three backends do not agree
    /// about what one costs. C and LLVM need nothing -- `put_bases_first`
    /// guarantees the base is a prefix, so the pointer is already right -- and
    /// the JVM needs a `checkcast`, which is the instruction `Unerase` already
    /// emits. Erasing and reading back is therefore the downcast every backend
    /// already has, rather than a fourth op for a fact three of them state
    /// differently.
    ///
    /// `Absent::Impossible` because the narrowed type is `Sub` and not
    /// `Sub | null`: whatever the declaration allowed, the guard has ruled the
    /// absence out, which is the whole reason the read is licensed here.
    fn through_a_narrowed_class(
        &mut self,
        id: NodeId,
        value: ValueId,
        declared: TypeId,
        member_name: &str,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let receiver = self.children(id).first().copied();
        let Some(HirType::Managed(ManagedType::Object(narrowed))) =
            receiver.and_then(|at| self.type_of(at))
        else {
            return Ok(None);
        };
        if narrowed == declared {
            return Ok(None);
        }
        // Only *down* the chain the program declares, and only for a member the
        // narrowed class really has. A cast to an unrelated type that happens to
        // declare the name is the pointer cast this compiler refuses by name
        // everywhere else.
        let Ok(layout) = self.layout_of(id, narrowed) else {
            return Ok(None);
        };
        if layout
            .index_of_key(&self.required_access_key(id, member_name)?)
            .is_none()
        {
            return Ok(None);
        }
        let mut base = layout.base;
        let mut steps = 0;
        while let Some(at) = base {
            if at == declared {
                let origin = self.origin(id);
                let erased = self.push(
                    OpKind::Erase {
                        value,
                        absent: Absent::Impossible,
                        slots: Absent::Impossible,
                    },
                    HirType::Erased,
                    origin.clone(),
                );
                let cast = self.push(
                    OpKind::unerase(erased),
                    HirType::Managed(ManagedType::Object(narrowed)),
                    origin,
                );
                return self.member_of(id, cast, member_name).map(Some);
            }
            // A bound rather than an algorithm, for the reason `walk::denoted`'s
            // is: a cycle here would be a program this compiler cannot have
            // built, and looping on one is worse than missing the read.
            steps += 1;
            if steps > 16 {
                return Ok(None);
            }
            base = self.layout_of(id, at).ok().and_then(|it| it.base);
        }
        Ok(None)
    }

    /// `c.twice` where `twice` is a method -- a closure carrying the receiver.
    ///
    /// **A method read rather than called.** A method is not storage -- it
    /// lives in the dispatch table -- so the layout has no field for it, and
    /// the read arrives one line from `absent_member` saying so. JavaScript's
    /// answer is a function object, and `collect_closures` has already made a
    /// class for it.
    ///
    /// `None` when this is not one, so the caller's refusal still names the
    /// member. `Some` builds the object: the class was made by
    /// `collect_closures`, which saw the same read and filed the method's
    /// declaration; here it is instantiated and field 0 is filled.
    ///
    /// **One object per read.** `c.twice !== c.twice` in JavaScript, and a
    /// static instance -- what a *free* function used as a value gets -- would
    /// have to hold one receiver for the whole program.
    fn bound_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member_name: &str,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(member) = self.children(id).last().copied() else {
            return Ok(None);
        };
        let Some(symbol) = self.node(member).symbol else {
            return Ok(None);
        };
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return Ok(None);
        };
        if !record.flags.contains(SymbolFlags::METHOD) {
            return Ok(None);
        }
        let Some(index) = record.declarations.iter().find_map(|declaration| {
            self.closures.iter().position(|closure| {
                closure.source == ClosureSource::Method && closure.node == *declaration
            })
        }) else {
            return Ok(None);
        };
        let info = self.closures[index].clone();
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(id, reason));
        }
        self.used_closures.push(index);

        let origin = self.origin(id);
        let ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            ty.clone(),
            origin.clone(),
        );
        let held = self.values[receiver.0 as usize].ty.clone();
        self.field_set(object, 0, receiver, &origin);
        self.layouts.push(self.closure_layout(
            index,
            vec![Field {
                name: ("this".to_owned()).into(),
                ty: held,
                readonly: true,
                declared_by: None,
                written: None,
            }],
        ));
        let _ = member_name;
        Ok(Some(object))
    }
}
