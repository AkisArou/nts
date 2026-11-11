//! Resolve a `CallExpression` target, choose its entry route, and finish a typed call result.

use super::{
    Callee, Diagnostic, FuncBuilder, HirType, Lent, ManagedType, MemberKey, NodeId, OpKind,
    PropertyKey, Settled, TypeId, TypeKind, ValueId, is_a_dynamic_import, members_of,
    signature_key, spelling_of, syntax,
};

impl FuncBuilder<'_> {
    /// Whether an expression's type is a signature -- so its value is a closure.
    pub(super) fn is_function_typed(&self, id: NodeId) -> bool {
        self.snapshot
            .node_types
            .get(&id)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
    }

    /// What `typeof` answers for a value, where its representation fixes it.
    ///
    /// A *declared* signature keeps its TypeScript type id rather than a
    /// synthetic closure one -- `cb?: (x: number) => number` is stored as the
    /// function type itself -- so the closure-id test alone calls it an object.
    /// It is the same value either way, and `typeof` says `"function"` for
    /// both. A synthetic id is above every real one, so the lookup simply
    /// misses for cells, frames and closures, and the free function answers.
    pub(super) fn spelling_for(&self, ty: &HirType) -> Option<&'static str> {
        if let HirType::Managed(ManagedType::Object(id)) = ty
            && self
                .snapshot
                .types
                .get(id.0 as usize)
                .is_some_and(|record| matches!(record.kind, TypeKind::Function(_)))
        {
            return Some("function");
        }
        spelling_of(ty)
    }

    /// Whether a callee names a function or class declaration rather than a
    /// value that happens to hold one.
    ///
    /// This is what separates `f(x)` the static call from `f(x)` the dispatch,
    /// and it is a question about the *declaration*, not about the spelling. A
    /// name with no declaration at all is one this compilation cannot see, which
    /// means an import: a direct call to a definition the linker supplies.
    fn names_a_declared_function(&self, id: NodeId) -> bool {
        let Some(symbol) = self.node(id).symbol else {
            return false;
        };
        // A local binding shadows nothing here -- a parameter and a function
        // declaration never share a symbol -- but if the name is bound to a
        // value in this frame, that value is what is being called.
        if self.bindings.contains_key(&symbol.0) {
            return false;
        }
        if self.parameter_body_functions.contains_key(&symbol.0) {
            return true;
        }
        // Imports name their alias at the use site. Classify the declaration
        // it denotes, so discovering a callable type does not turn a direct
        // imported call into a closure dispatch.
        let symbol = self.denoted_symbol(symbol);
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return false;
        };
        record.declarations.is_empty()
            || record.declarations.iter().any(|declaration| {
                matches!(
                    self.kind_of(*declaration),
                    Some(
                        syntax::FUNCTION_DECLARATION
                            | syntax::CLASS_DECLARATION
                            | syntax::METHOD_DECLARATION
                            | syntax::METHOD_SIGNATURE
                    )
                )
            })
    }

    /// Whether a declaration carries an implementation.
    ///
    /// What separates a function this program *defines* from one it only names:
    /// an ambient `declare`, an overload signature, and a method signature on an
    /// interface all lack one.
    pub(super) fn has_a_body(&self, id: NodeId) -> bool {
        self.children(id)
            .into_iter()
            .any(|child| self.kind_of(child) == Some(syntax::BLOCK))
    }

    /// Whether this program defines the function a call resolved to, and so
    /// whether the call is a direct one or a call to C.
    ///
    /// Through `implementation_of`, because the declaration a call resolves to
    /// need not be the one with the body -- an overload signature has none,
    /// and the implementation beside it does. `lower_call` chooses the callee
    /// by it and `parameter_representation` types an `object` parameter by
    /// it, so the two cannot disagree about an overloaded function. So does
    /// [`Self::emitted_callee_name`], the reader this sentence listed two of
    /// and which was asking the resolved declaration directly.
    pub(super) fn defines(&self, declaration: NodeId) -> bool {
        self.has_a_body(self.implementation_of(declaration))
    }

    /// The name a direct call is emitted under, which is the name on the
    /// **implementation**.
    ///
    /// Not the name at the call site: `import { scale as by }` puts `by` here
    /// and `scale` on the function, and a call has to name the function.
    ///
    /// Through [`Self::implementation_of`], for the reason [`Self::defines`]
    /// gives, and this was the reader that did not. `qualified_names` skips a
    /// bodiless function declaration deliberately -- a signature is not a thing
    /// to emit -- so where the checker resolves a call to a *signature*, asking
    /// `qualified` about that node answers nothing and the fallback spells the
    /// **bare** name. For an ambiguous name that is the one name which by
    /// construction cannot exist: two modules declaring `writeFile` means the
    /// program emits `writeFile@async` and `writeFile@promises` and nothing
    /// else.
    ///
    /// The result was `` it calls `writeFile`, which nothing in this program
    /// defines `` -- seven of those over `runtime/node`'s `fs` alone
    /// (`writeFile`, `readFile`, `opendir`, `lstat`, `rm`, `rmdir`, `statfs`),
    /// each a cascade blaming a name no refusal can be recorded against,
    /// because there is no such function to refuse.
    ///
    /// So all three halves of one call site now agree about which declaration
    /// the call is against: the **arity** through `parameter_representation`,
    /// the **externality** through `defines`, and the **name** here. The name
    /// was the half that decided what got emitted.
    pub(super) fn emitted_callee_name(
        &self,
        declaration: Option<NodeId>,
        callee_node: NodeId,
    ) -> Result<String, Diagnostic> {
        declaration
            .map(|declaration| self.implementation_of(declaration))
            .and_then(|declaration| {
                self.qualified
                    .get(&declaration)
                    .cloned()
                    .or_else(|| self.declared_name(declaration))
            })
            .or_else(|| {
                self.node(callee_node)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
            .ok_or_else(|| self.unsupported(callee_node, "a computed callee"))
    }

    /// One method or constructor of a class, as a function taking the instance.
    ///
    /// There is no dispatch to arrange. The checker resolved every call site, so
    /// `c.advance()` names one target and lowers to a static call with `c` as
    /// the first argument — which is what a method *is* once the receiver is
    /// explicit. A vtable only becomes necessary where a call site has more than
    /// one possible target, and TypeScript tells us when that is.
    /// One method, of one class — or of one *instantiation* of a generic class,
    /// which is a different class with the same source.
    ///
    /// `instance` is the instantiated object type. Its properties the checker
    /// already substituted, so the layout needs nothing; what needs the
    /// substitution this builder carries is the body, whose nodes are shared
    /// with every other copy.
    /// Whether this member is an overload *signature* rather than a method.
    ///
    /// A declaration of a call shape, with the implementation beside it. It is
    /// not a member to emit and it is not a gap either -- every call resolving
    /// to it is built against the implementation, by `implementation_of`, and
    /// answers correctly. So it is **skipped**, the way a `static` member is
    /// skipped on a class's second copy, rather than refused.
    ///
    /// It was refused for one afternoon, in words that named it accurately, and
    /// the words were the problem: NTS1001 is what this compiler cannot do, and
    /// 83 sites in `runtime/node` then reported a gap for something handled
    /// exactly. A plain overloaded *function*'s signatures had never said
    /// anything, so the two paths disagreed about the same construct.
    ///
    /// From the *siblings* rather than from the member itself, because a
    /// signature looks exactly like a method whose body this lowering failed to
    /// find. What separates them is that a same-named sibling has the body.
    /// `abstract` is excluded on both sides: an abstract method is meant to have
    /// none, and an abstract declaration beside its own implementation is not
    /// legal TypeScript.
    pub(super) fn is_an_overload_signature(&mut self, class: NodeId, member: NodeId) -> bool {
        let modifiers = self.node(member).modifiers;
        if modifiers.contains(nts_semantic_schema::DeclarationModifiers::ABSTRACT)
            || self.has_a_body(member)
        {
            return false;
        }
        let Some(name) = self.member_key(member) else {
            return false;
        };
        // Collected first, because the checks below take `&mut self` and a
        // closure holding the iterator would hold a borrow across them.
        let siblings: Vec<NodeId> = members_of(self.snapshot, self.foreign, class)
            .into_iter()
            .filter(|sibling| *sibling != member)
            .collect();
        siblings.into_iter().any(|sibling| {
            self.member_key(sibling).as_ref() == Some(&name) && self.has_a_body(sibling)
        })
    }

    /// A method's parameter and result types, from its declaration's
    /// signature.
    pub(super) fn method_signature(
        &self,
        method: NodeId,
    ) -> Result<(Vec<HirType>, HirType), Diagnostic> {
        let signature = self
            .snapshot
            .node_types
            .get(&method)
            .and_then(|ty| signature_key(self.snapshot, *ty))
            .ok_or_else(|| self.unrepresentable(method, "a method's signature"))?;
        let parameters = signature
            .0
            .iter()
            .map(|ty| {
                self.represent(*ty)
                    .ok_or_else(|| self.unrepresentable(method, "a method's parameter"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let returns = self
            .represent(signature.1)
            .ok_or_else(|| self.unrepresentable(method, "a method's result"))?;
        Ok((parameters, returns))
    }

    /// A call the frontend did not resolve, which is a missing pass rather than
    /// an unsupported construct.
    pub(super) fn unresolved_call(&self, id: NodeId) -> Diagnostic {
        Diagnostic::error(
            "NTS1002",
            "this call was not resolved to a target; the frontend's call \
             resolution pass has to run before lowering",
            self.location(id),
        )
    }

    /// Whether a call is written `f?.(x)`.
    ///
    /// Asked before the target lookup in [`Self::lower_call`], because an
    /// optional call is on a *value* and the frontend has no single target to
    /// resolve it to.
    pub(super) fn is_optional_call(&self, id: NodeId) -> bool {
        self.children(id)
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_DOT_TOKEN))
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_call(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        if let Some(callee) = self.children(id).first().copied() {
            self.check_class_binding(callee)?;
        }
        // `import(...)`: a call whose callee is the keyword, which nothing below
        // can name -- it read as "a computed callee", which is what 624 of the
        // 704 test262 files under that message were.
        if is_a_dynamic_import(self, id) {
            return self.lower_dynamic_import(id);
        }
        // Before the target lookup, because `resolve` is a parameter rather
        // than a function: the frontend has nothing to resolve it to, and the
        // call is not a call at all once the executor is inlined.
        if let Some(settled) = self.lower_settler_call(id)? {
            return Ok(settled);
        }
        self.a_raising_body_carries_this_call(id)?;
        if self.is_optional_call(id) {
            return self.lower_optional_call(id);
        }
        let Some(target) = self.snapshot.call_targets.get(&id) else {
            return Err(self.unresolved_call(id));
        };

        let children = self.children(id);
        let callee_node = *children
            .first()
            .ok_or_else(|| self.unsupported(id, "a call with no callee"))?;
        // Explicit type arguments are flattened in among the arguments, so
        // `f<number>(x)` would otherwise lower `number` as a value.
        let arguments = self.arguments_of(id);

        // `super(...)` and `super.method()`. The base is known statically -- a
        // class extends at most one -- so both are ordinary static calls with
        // `this` as the receiver, which is what they are once `this` is
        // explicit.
        if self.kind_of(callee_node) == Some(syntax::SUPER_KEYWORD) {
            return self.lower_super(id, "constructor", &arguments);
        }
        if self.kind_of(callee_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee_node);
            if let [target, member] = parts.as_slice()
                && self.kind_of(*target) == Some(syntax::SUPER_KEYWORD)
            {
                let name = self.literal_name(*member).ok_or_else(|| {
                    self.unsupported(*member, "a method whose name the program computes")
                })?;
                return self.lower_super(id, &name, &arguments);
            }
        }

        // The calls that are not calls, in one place.
        if let Some(special) = self.lower_special_call(id, callee_node, &arguments) {
            return special;
        }

        // `Body.jupiter()` — a *static* method. It looks like a method call and
        // is not one: the thing before the dot is a class, which is a type
        // rather than a value, so lowering it as a receiver would ask for the
        // value of something that has none.
        //
        // Recognized from the checker's resolved target rather than from the
        // syntax, so an aliased import resolves the same as a plain name.
        if let Some(callee) = target.callee
            && self
                .node(callee)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::STATIC)
            && let Some(class_name) = self.declaring_class_name(callee)
        {
            return self.lower_static_call(id, &class_name, callee, &arguments);
        }

        // `PropertySet.create()` — a runtime class's default constructor.
        if let Some(activated) = self.activation_call(id, target, &arguments) {
            return activated;
        }

        // A function a binding declares with `@ntsCall`: a call to the
        // program's function it names, with the same arguments, as a static
        // member's is -- there is no receiver to put first.
        if target
            .callee
            .is_some_and(|callee| self.kind_of(callee) == Some(syntax::FUNCTION_DECLARATION))
            && let Some(function) = self.called_method(id)?
        {
            return self.lower_called_method(id, None, function, &arguments);
        }

        // `JsonValue.Parse(x)` — a function a namespace declares. The thing
        // before the dot is a namespace, which has no value to be a receiver,
        // so this is a call to the function, as `Parse(x)` would be.
        let in_namespace = target
            .callee
            .is_some_and(|callee| self.kind_of(callee) == Some(syntax::FUNCTION_DECLARATION))
            && self.kind_of(callee_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
            && self.children(callee_node).first().is_some_and(|object| {
                self.names_a_namespace(*object)
                    || target
                        .callee
                        .is_some_and(|callee| self.declared_in_namespace_of(*object, callee))
            });

        // `c.advance()` — a method call. The receiver becomes the first
        // argument, which is what a method is once it is explicit.
        if !in_namespace && self.names_a_property(callee_node) {
            return self.lower_method_call(id, callee_node, &arguments);
        }

        // `f(x)` where `f` is a parameter, a local, or `pick(1)(x)` where it is
        // another call's result: the callee is a *value*, not a function, so
        // there is nothing to call directly. It holds a closure, which is an
        // object with one method, and this is a dispatch through that method's
        // slot with the closure itself as the receiver.
        // The checker resolved this call, so ask it rather than the name. An
        // imported `scale` is bound to an *import specifier*, not to the
        // function declaration, so asking the name gave "not a declared
        // function" and sent every cross-module call down the closure path --
        // where it was refused for reading a name from an enclosing scope.
        let declaration = self.direct_callee(target.callee, callee_node);
        let locally_bound = self
            .node(callee_node)
            .symbol
            .is_some_and(|symbol| self.bindings.contains_key(&symbol.0));
        if locally_bound
            || (declaration.is_none()
                && self.is_function_typed(callee_node)
                && !self.names_a_declared_function(callee_node))
        {
            return self.lower_closure_call(id, callee_node, &arguments);
        }

        let name = self.emitted_callee_name(declaration, callee_node)?;
        // And the copy made for *this* call's instantiation, where the callee
        // is generic. There is one copy per distinct substitution and the
        // suffix is what tells them apart.
        let specialization = self.calls.suffix(id).map_or("", String::as_str);
        let name = format!("{name}{specialization}{}", self.raising_suffix_of(id));

        // A callee inside the compiled program becomes a static call; one outside
        // it is still typed exactly, and the definition comes from elsewhere.
        //
        // "Inside" means *defined* here, not merely declared here. A
        // `declare function` has a declaration node and no body, and calling it
        // directly would name a function this program never emits.
        // Through `implementation_of`, because an *overload signature* has no
        // body and the implementation beside it does. Asking the resolved
        // declaration directly called an overloaded function external and
        // emitted only a prototype for it: `undefined reference to 'pick'` from
        // the linker, on a program that reported no refusal at all.
        //
        // Methods did not have this because a method call takes its name from
        // the hierarchy rather than from the declaration; a plain function has
        // only the declaration to ask.
        // **Asked of the declaration this call actually names**, which is
        // `direct_callee`'s answer and not the checker's raw one. They differ for
        // a name that *holds* a function: for a call through a variable whose type
        // is a function type, `target.callee` is the annotation -- a
        // `FUNCTION_TYPE` node, which has no body -- while `declaration` is the
        // function the initializer names, which may well have one.
        //
        // Asking the wrong one made `defined` false for every such call and sent
        // it down the *native* path, where the name it had already resolved
        // (`declaration`'s, not the annotation's) was treated as a C symbol:
        //
        //     const jsx: (t: number, k: number) => number = prod;
        //     jsx(1, 10)
        //
        //     foreign function `prod`'s parameter `t` (which wants a c_int or
        //     Float64 brand, a boolean, or a string), a type with no native ABI
        //
        // -- a C ABI refused for a TypeScript function defined two lines up. The
        // React lane reported it from `export const jsx = isDevelopment ? jsxDEV
        // : jsxProd`, the last thing between their entry points and compiling.
        //
        // **The native path is still right when the resolved declaration has no
        // body**, which is the case that makes this a one-line change rather than
        // a new rule: `export const now: () => Timestamp = nts_hrtime_ns` in
        // `runtime/node/internal/time.ts` resolves to a `declare`d helper and
        // must stay a call to `nts_hrtime_ns`. Both readings agree there and
        // always did; only a resolved declaration *with* a body was answered
        // wrongly.
        //
        // The mistake is this function's own: `direct_callee` arrived with
        // `97584f66` and `61ada67e` and `defined` was left asking the question it
        // had asked before there was anything better to ask.
        let defined = declaration.is_some_and(|declaration| self.defines(declaration));

        // A callee with no declaration in the compiled set at all. A `declare
        // function` the *program* wrote is an FFI import and stays external --
        // the linker or the platform supplies it, which is the whole point of
        // writing one. A name declared only by `lib.d.ts` is not that: it is a
        // builtin this compiler has not implemented, and emitting a call to it
        // produced a prototype, a link error, and no diagnostic at all.
        //
        // `isNaN(x)` compiled to `call.extern isNaN` and failed at link time
        // with no source location. It was my own regression from making
        // `declare function` external, and the two are told apart by whether
        // the checker resolved the call to a declaration node: the decoded file
        // set is the program's own sources, so a `lib.d.ts` declaration has
        // none.
        // Some of those `lib.d.ts` names are builtins this compiler *does*
        // provide, and they are taken before the refusal below.
        if target.callee.is_none()
            && let Some(provided) = self.lower_provided_builtin(id, &name, &arguments)
        {
            return provided;
        }
        if let Some(lowered) = self.lower_bound_global_call(id, callee_node, &arguments) {
            return lowered;
        }
        if target.callee.is_none() {
            // Three different failures wore one sentence. A name the checker
            // resolved to no declaration is either a builtin this compiler has
            // not implemented, or a name from a package whose implementation is
            // not in this program -- and the second is far commoner now that
            // dependencies are acquired, because a package that publishes only
            // generated JavaScript has nothing to acquire. Reporting it as a
            // missing builtin sends its reader to `hir::builtin`, where nothing
            // is missing.
            //
            // The location stays on the call. Pointing at the import instead
            // reads better and attributes the failure to a node outside the
            // function being walked, which costs the *caller* its own
            // diagnostic: `run` came back as "a declaration outside every walk".
            // And a third wearing it, found by probing the ledger row for
            // *calling* a class value rather than by a report. `TypeError(m)`
            // is what JavaScript makes `new TypeError(m)`, TypeScript accepts
            // it, and it arrives here with no declaration -- so it read as a
            // builtin this compiler does not provide, which is false twice
            // over: the class is the second entry in `hir::builtin`, and a
            // reader sent there finds nothing missing to add.
            //
            // What is missing is a `call` that constructs. Only a *provided*
            // class reaches this arm: a class the program declares is TS2348
            // before the compiler sees it, so the list is the whole of it.
            return Err(self.refuse_nameless(id, &self.no_such_callee(callee_node, &name)));
        }
        let callee = if defined {
            Callee::Direct(name)
        } else if declaration.is_none() {
            // **No declaration is never a C function.** A native call is to a
            // function something declares; this is a call through a value the
            // checker could not call a function, and what is left of it here
            // is the variable's name. It went to `native_callee` and became a
            // call to a C symbol of that name: undefined at link time
            // (`probeParams` in test262's `scope-paramsbody-var-open`, a
            // `var` a default parameter assigns, typed `null | (() => ...)`
            // where the call is), or, for a variable named like a libc
            // function, that function.
            return Err(self.unsupported(id, &self.called_without_a_function(callee_node, &name)));
        } else {
            let signature = &self.snapshot.signatures[target.signature.0 as usize];
            self.native_callee(id, declaration, name, signature)?
        };

        // A runtime class's static is called on its factory.
        let factory = match &callee {
            Callee::Native(target) => target
                .vtable
                .as_ref()
                .and_then(|vtable| vtable.factory.clone()),
            _ => None,
        };
        let receiver = factory.map(|factory| self.factory_receiver(&factory, id));
        let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, receiver)?;
        self.finish_call(id, callee, args, lent, declaration)
    }

    /// The call itself, then what a native one owes after it: the string it
    /// returned read into one the program owns, and what it was lent given
    /// back.
    pub(super) fn finish_call(
        &mut self,
        id: NodeId,
        callee: Callee,
        args: Vec<ValueId>,
        lent: Vec<Lent>,
        declaration: Option<NodeId>,
    ) -> Result<ValueId, Diagnostic> {
        self.finish_call_typed(id, callee, args, lent, declaration, None)
    }

    /// [`Self::finish_call`] for a call that is not the node at `id` -- one a
    /// tag makes, whose value is not what the checker typed the node:
    /// `gtk_label_get_type()` inside `new GtkLabel(…)` is a `GType`, not a
    /// `GtkLabel`. `ty` is the call's own type there.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn finish_call_typed(
        &mut self,
        id: NodeId,
        callee: Callee,
        args: Vec<ValueId>,
        lent: Vec<Lent>,
        declaration: Option<NodeId>,
        ty: Option<HirType>,
    ) -> Result<ValueId, Diagnostic> {
        let returned = match &callee {
            Callee::Native(target) => target
                .returns_string
                .clone()
                .map(|string| (target.clone(), string)),
            _ => None,
        };
        // A bridged array's call is the `NSArray` the message returns; the
        // program's array is read out of it below.
        let (bridged, sent) = match &callee {
            Callee::Native(target) if target.returns_array.is_some() => (
                target.returns_array.clone(),
                Some(target.result.representation()),
            ),
            _ => (None, None),
        };
        // And a bridged dictionary's, which becomes a map; and a set's.
        let (dictionary, sent) = match &callee {
            Callee::Native(target) if target.returns_dictionary.is_some() => (
                target.returns_dictionary.clone(),
                Some(target.result.representation()),
            ),
            _ => (None, sent),
        };
        let (returned_set, sent) = match &callee {
            Callee::Native(target) if target.returns_set.is_some() => (
                target.returns_set.clone(),
                Some(target.result.representation()),
            ),
            _ => (None, sent),
        };
        // `AsNumber<C>`: the function whose 64-bit result is read exactly.
        let as_number = match &callee {
            Callee::Native(target) if target.result_as_number => Some(target.name.clone()),
            _ => None,
        };
        let result_as = match &callee {
            Callee::Native(target) => target
                .result_as
                .as_ref()
                .map(crate::hir::native::Type::representation),
            _ => None,
        };
        // What the program sees of a record result: the storage it was written
        // into, which `lower_call_arguments` made the last argument.
        let destination = match &callee {
            Callee::Native(target) if target.destination().is_some() => args.last().copied(),
            _ => None,
        };
        let typed = ty.clone();
        let hresult = matches!(&callee, Callee::Native(target) if target.hresult);
        if hresult {
            return self.finish_hresult_call(id, callee, args, lent, declaration, typed);
        }
        // A boxed record the function returns: the call is C's pointer, and
        // the program's value is the box made of it below.
        // Asked of the declaration called, not of the call node's target: a
        // call the lowering makes itself at the same node -- the record's
        // `get_type`, below -- has a declaration of its own.
        let boxed = match &callee {
            Callee::Native(target) => declaration
                .and_then(|declaration| self.declared_result_type(declaration))
                .and_then(|returned| crate::hir::native::schema::boxed(self.snapshot, returned))
                .map(|record| (record, target.returns_owned, target.result.representation())),
            _ => None,
        };
        let pointer_ty = boxed.as_ref().map(|(_, _, pointer)| pointer.clone());
        let call = self.push_call(id, callee, args, declaration, pointer_ty.or(sent).or(ty))?;
        let call = match &boxed {
            Some((record, owned, _)) => self.box_record(id, call, record, *owned)?,
            None => call,
        };
        // A failure is checked *before* the result is read: a function that
        // reports one returns nothing meaningful -- GLib returns NULL where it
        // promised a string -- and reading that would end the process rather
        // than throw. The failing path gives back what was lent and throws;
        // the other reads the result and then gives back, in that order, since
        // a result may point into something lent.
        let errors: Vec<(ValueId, String)> = lent
            .iter()
            .filter_map(|lent| match lent {
                Lent::Error { slot, converter } => Some((*slot, converter.clone())),
                _ => None,
            })
            .collect();
        for (slot, converter) in errors {
            self.throw_if_reported(id, slot, &converter, &lent)?;
        }
        let value = match (returned, result_as) {
            _ if returned_set.is_some() => {
                let ty = typed
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "a returned set"))?;
                self.read_ns_set(
                    id,
                    call,
                    returned_set
                        .as_ref()
                        .unwrap_or(&crate::hir::native::Bridged::String),
                    ty,
                )?
            }
            _ if dictionary.is_some() => {
                let ty = typed
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "a returned dictionary"))?;
                self.read_ns_dictionary(
                    id,
                    call,
                    dictionary
                        .as_ref()
                        .unwrap_or(&crate::hir::native::Bridged::String),
                    ty,
                )?
            }
            _ if bridged.is_some() => {
                let ty = typed
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "a returned array"))?;
                self.read_ns_array(
                    id,
                    call,
                    bridged
                        .as_ref()
                        .unwrap_or(&crate::hir::native::Bridged::String),
                    ty,
                )?
            }
            (Some((target, string)), _) => {
                self.read_native_string(id, call, &target, &string, typed)?
            }
            // The handle GIR says it is, from the ancestor C declares.
            (None, Some(ty)) => self.push(OpKind::Convert(call), ty, self.origin(id)),
            (None, None) => match &as_number {
                Some(function) => {
                    self.exact_as_number(id, call, &format!("`{function}` answered"))?
                }
                None => call,
            },
        };
        let value = destination.unwrap_or(value);
        self.give_back(id, lent)?;
        Ok(value)
    }

    /// The function an `@ntsCall` method or ambient function names, when the
    /// call at `id` resolved to one: the program's only defined `function` of
    /// that name. Two, or none, is refused -- a name that could mean either is
    /// not a binding.
    pub(super) fn called_method(&self, id: NodeId) -> Result<Option<NodeId>, Diagnostic> {
        let Some(declaration) = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| target.callee)
        else {
            return Ok(None);
        };
        // An interface's method, or a method of an Objective-C class a binding
        // declares: Swift's `async` form of one, whose body is the values
        // module's (`nts bind-objc --values`).
        let objc_member = self.kind_of(declaration) == Some(syntax::METHOD_DECLARATION)
            && self.objc_class_member(declaration).is_some();
        // Or a function a binding declares and does not define: the copying
        // form of a C function that hands back an array, whose body is the
        // companion module's -- `g_strsplit_set`'s, copying each string out.
        let ambient_function = self.kind_of(declaration) == Some(syntax::FUNCTION_DECLARATION)
            && !self.has_a_body(declaration);
        if self.kind_of(declaration) != Some(syntax::METHOD_SIGNATURE)
            && !objc_member
            && !ambient_function
        {
            return Ok(None);
        }
        let Some(name) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.call.clone())
        else {
            return Ok(None);
        };
        let mut found = (0..self.snapshot.nodes.len())
            .map(|at| NodeId(u32::try_from(at).unwrap_or(u32::MAX)))
            .filter(|node| {
                self.kind_of(*node) == Some(syntax::FUNCTION_DECLARATION)
                    && self.has_a_body(*node)
                    && self.declared_name(*node).as_deref() == Some(name.as_str())
            });
        match (found.next(), found.next()) {
            (Some(function), None) => Ok(Some(function)),
            (None, _) => Err(self.unsupported(
                id,
                &format!("@ntsCall naming `{name}`, which this program does not define"),
            )),
            (Some(_), Some(_)) => Err(self.unsupported(
                id,
                &format!("@ntsCall naming `{name}`, which this program defines twice"),
            )),
        }
    }

    /// The declaration a call resolves to, when it is a plain function.
    ///
    /// Not ahead of a local binding, which is the guard
    /// `names_a_declared_function` makes and this must not lose: a name bound to
    /// a value in this frame *is* that value, whatever the checker resolved the
    /// name to elsewhere, and calling it is a dispatch rather than a static
    /// call.
    ///
    /// **And not ahead of a module-scope variable whose initializer chose**,
    /// which is the same sentence one scope out and was a *silent wrong answer*
    /// until 2026-09-26:
    ///
    /// ```ts
    /// function first(x: number): number { return x + 1; }
    /// function second(x: number): number { return x * 2; }
    /// export const pick = true ? second : first;   // must be `second`
    /// export function use(x: number): number { return pick(x); }
    /// ```
    ///
    /// `use` called **`first`** -- the first-declared, whichever arm the
    /// condition picks -- and 27 of 29 cases disagreed with node. It is React's
    /// `export const jsx = __DEV__ ? jsxDEV : jsxProd`, so a compiled React ran
    /// whichever of the two was written first.
    ///
    /// `CallTarget::callee` is the checker's `getResolvedSignature().declaration`,
    /// and two functions of one shape are **one type**: the checker keeps one
    /// candidate and naming it is a guess. It is a callee only when the callee
    /// *expression* names it, and `locally_bound` was the only place that said
    /// so -- module scope has no `bindings` entry, so nothing objected.
    ///
    /// **Narrow on purpose: a variable whose initializer is a plain identifier
    /// is still trusted.** `const pick = fast` has exactly one candidate and
    /// resolving to it is right, which is why that form compiles today and keeps
    /// doing so. What is distrusted is an initializer that *chose* -- a
    /// conditional, a call, anything but a single name -- and the shape is
    /// checked rather than the arity of candidates because the candidates are
    /// exactly what the checker has already collapsed.
    ///
    /// An **import** is untouched: its symbol is declared by an import
    /// specifier, not by a variable declaration, so a cross-module call keeps
    /// its direct callee. That was the hazard in the first formulation of this
    /// guard, which asked "does the name declare the callee" and would have made
    /// every imported call indirect.
    ///
    /// A distrusted call falls through to the value path, where a module-scope
    /// name holding a function is already refused by name (`storable`). So this
    /// turns a wrong answer into the refusal its annotated spelling already had
    /// -- the honest sibling it should have had all along.
    pub(super) fn direct_callee(
        &self,
        resolved: Option<NodeId>,
        callee_node: NodeId,
    ) -> Option<NodeId> {
        let symbol = self.node(callee_node).symbol;
        if symbol.is_some_and(|symbol| self.bindings.contains_key(&symbol.0)) {
            return None;
        }
        match symbol.map_or(Settled::NotAVariable, |symbol| {
            self.initializer_settles(symbol.0)
        }) {
            // **The arm, not the checker's guess.** Where the initializer chose
            // and the choice is decided, the one candidate is computable here
            // and `resolved` is still whichever of the two the checker kept --
            // so trusting it would answer the same wrong question with a nicer
            // reason.
            Settled::Names(declaration) => Some(declaration),
            Settled::Unsettled => None,
            Settled::NotAVariable => resolved.filter(|declaration| {
                self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION)
            }),
        }
    }

    /// **A receiver a copy re-typed from `any`.** The checker resolved such a
    /// call on an `any`, so its target names no callee: no parameters, and an
    /// `any` result. The method the class declares is the one called, so its
    /// function type is what the arguments and the result answer to -- without
    /// it `p.shift(by)` dropped `by` and typed `shift`'s result erased.
    fn signature_behind_any(
        &self,
        id: NodeId,
        type_id: TypeId,
        member_name: &str,
    ) -> Option<TypeId> {
        self.snapshot
            .call_targets
            .get(&id)
            .is_none_or(|target| target.callee.is_none())
            .then(|| {
                self.access_key(id, member_name)
                    .and_then(|key| self.member_declaration(type_id, &key))
            })
            .flatten()
            .and_then(|declaration| self.snapshot.node_types.get(&declaration).copied())
    }

    /// A method call's arguments, answering to [`Self::signature_behind_any`]
    /// where it applies, and the result type that signature declares.
    pub(super) fn method_arguments(
        &mut self,
        id: NodeId,
        type_id: TypeId,
        member_name: &str,
        arguments: &[NodeId],
        receiver: ValueId,
    ) -> Result<(Vec<ValueId>, Option<HirType>), Diagnostic> {
        let declared = self.signature_behind_any(id, type_id, member_name);
        let outer = declared.map(|function_ty| self.callee_signature.replace((id, function_ty)));
        let returns = self
            .overriding_signature(id)
            .map(|signature| signature.return_type);
        let lowered = self.lower_arguments_on(id, arguments, receiver);
        if let Some(outer) = outer {
            self.callee_signature = outer;
        }
        let result = returns.and_then(|return_type| self.represent(return_type));
        Ok((lowered?, result))
    }

    /// The node that declares a member of a type, where one does.
    ///
    /// The checker's property list is flattened, so an inherited member is here
    /// too and its declaration is the base's -- which is the answer wanted: the
    /// frame is reserved on the node that carries the body.
    pub(super) fn member_declaration(
        &self,
        type_id: TypeId,
        member_name: &PropertyKey,
    ) -> Option<NodeId> {
        let TypeKind::Object { properties } = &self.snapshot.types.get(type_id.0 as usize)?.kind
        else {
            return None;
        };
        properties
            .iter()
            .find(|property| &property.name == member_name)?
            .declaration
    }

    /// The callee a method name resolves to on a receiver's type.
    ///
    /// Virtual where the hierarchy says the method is overridden, direct
    /// otherwise, and named `Owner#member` either way -- the naming that keeps
    /// two classes' `ref` apart.
    ///
    /// Split out of [`Self::lower_object_method`] because the iteration
    /// protocol calls methods the source never writes. `for (const x of it)`
    /// calls `[Symbol.iterator]()` and then `next()` repeatedly, with no call
    /// node to lower and no argument list to walk; resolving those by hand
    /// would be a second rule that agrees with this one until it does not.
    pub(super) fn callee_for(
        &mut self,
        id: NodeId,
        type_id: TypeId,
        member_name: &str,
    ) -> Result<Callee, Diagnostic> {
        let suffix = self.raising_suffix_of(id);
        self.method_callee(
            id,
            type_id,
            &MemberKey::method(self.required_access_key(id, member_name)?),
            suffix,
        )
    }
}
