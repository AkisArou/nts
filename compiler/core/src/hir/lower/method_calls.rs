//! Choose and lower a receiver call, including static, registered, virtual, and builtin methods.

use super::{
    Branch, Callee, Diagnostic, FuncBuilder, HirType, ManagedType, MemberKey, MethodAccessor,
    MethodsOf, NodeId, NodeKind, NumericBuiltin, OpKind, Place, RAISING_SUFFIX, Terminator, TypeId,
    TypeKind, ValueId, access, callable_fields, is_static_member, member_dispatch_key,
    named_representation, syntax,
};

impl FuncBuilder<'_> {
    /// A call to a statically resolved target.
    ///
    /// Requires the frontend's call resolution: without it there is no way to
    /// know *which* function a call site reaches, and guessing from the callee's
    /// spelling would pick the wrong overload silently. Refusing is the honest
    /// answer, and the diagnostic says what is missing rather than what is
    /// unsupported.
    /// `c.advance()` — a call whose receiver is the thing before the dot.
    ///
    /// Which method runs depends on what the receiver *is*: a string's methods
    /// are the runtime's, an array's are the runtime's with the element type
    /// deciding which, and an object's are the program's own.
    pub(super) fn lower_method_call(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let parts = self.children(callee_node);

        // `a?.b()` -- three children, because the `?.` is a token of its own
        // between the receiver and the member. Handled before the two-child
        // destructure below rather than falling through it, which is where it
        // used to land and be refused by name.
        if let [receiver_node, dot, member] = parts.as_slice()
            && self.node(*dot).kind == NodeKind::Syntax(syntax::QUESTION_DOT_TOKEN)
        {
            let (receiver_node, member) = (*receiver_node, *member);
            if let Some(&receiver) = self.chain_present.get(&callee_node) {
                return self.lower_method_on(id, receiver, receiver_node, member, arguments);
            }
            if self.pending_chain(receiver_node) {
                return self.lower_chain(id);
            }
            return self.lower_optional_method_call(id, receiver_node, member, arguments);
        }

        let [receiver_node, member] = parts.as_slice() else {
            return Err(self.unsupported(
                callee_node,
                "a method callee that is not a receiver and a member",
            ));
        };
        let (receiver_node, member) = (*receiver_node, *member);
        // A **call** is a link too, and it short-circuits with the rest of the
        // chain. Without this, `a?.p.m()` and `a?.m().m2()` lowered as a call
        // on the absent value and aborted the compiled program.
        if self.pending_chain(receiver_node) {
            return self.lower_chain(id);
        }
        // A static operation of a class a binding implements, before the class
        // is read as a value: lib.dom's `URL` has no value here to read.
        if let Some(function) = self.delegated_static(receiver_node, member) {
            return self.lower_delegated_call(id, function, arguments);
        }
        let (receiver, guard) = access::receiver(self, receiver_node)?;
        if let Some(guard) = guard {
            let key = self
                .indexed_member_name(callee_node, member)
                .or_else(|| self.literal_name(member))
                .ok_or_else(|| self.unsupported(callee_node, "a computed property name"))?;
            let key = access::named_key(self, callee_node, member, key)?;
            access::require(self, callee_node, &guard, &key, false)?;
        }
        self.lower_method_on(id, receiver, receiver_node, member, arguments)
    }

    /// `a?.b(...)` -- the receiver's absence short-circuits the whole call.
    ///
    /// The same three steps as [`Self::lower_optional_access`], with a method
    /// call where that one has a member read: ask whether the receiver has room
    /// for an absence, narrow it where it does, and branch. The arguments are
    /// evaluated **inside** the present arm, because `a?.b(f())` does not call
    /// `f` when `a` is absent.
    fn lower_optional_method_call(
        &mut self,
        id: NodeId,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(receiver_node)?;
        let Some(absent) = self.absence_of(receiver_node, receiver) else {
            // A receiver with no room for an absence is never absent, so this is
            // an ordinary method call. TypeScript permits the shape and reports
            // it as unnecessary.
            return self.lower_method_on(id, receiver, receiver_node, member, arguments);
        };
        let present = self.present_of(receiver_node, receiver);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::MethodOn(receiver, receiver_node, member, present),
        )
    }

    /// A call on a native receiver: a C function a binding declares on it, a
    /// function of the program's that `@ntsCall` names, a method of a class
    /// the program writes over an Objective-C class, or a closure one of its
    /// fields holds. `None` for anything else, which the arms after it take.
    fn call_on_native(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<Option<ValueId>, Diagnostic> {
        if let Some(method) = self.native_method(id) {
            return self
                .lower_native_method_call(id, (receiver, receiver_node), method, member, arguments)
                .map(Some);
        }
        // `forEach` of a collection a binding implements, which spells only
        // `length` and `item`: lib.dom's `NodeListOf<T>.forEach`.
        if self.literal_name(member).as_deref() == Some("forEach")
            && let [callback] = arguments
            && self.inlines_as_a_callback(*callback)
            && self.delegated_collection(receiver_node).is_some()
        {
            return self
                .lower_delegated_for_each(id, (receiver, receiver_node), *callback)
                .map(Some);
        }
        if let Some((declaration, record)) = self.delegated_method(receiver_node, member, arguments)
        {
            // The call's arguments are the bound member's -- its optional
            // parameters, its `@ntsDefault`s, its ABI types -- and not the ones
            // lib.dom.d.ts declares, which the checker resolved the call to.
            let outer = self.delegated_signature.replace((id, record.clone()));
            let spread = self.spread_for(id, &record, arguments);
            let answer = self.lower_native_method_call_as(
                id,
                (receiver, receiver_node),
                (declaration, record),
                member,
                arguments,
            );
            self.dictionary_slots = spread;
            self.delegated_signature = outer;
            return answer.map(Some);
        }
        if let Some(function) = self.called_method(id)? {
            return self
                .lower_called_method(id, Some(receiver), function, arguments)
                .map(Some);
        }
        if let Some(method) = self.program_objc_method(id) {
            return self
                .lower_program_objc_call(id, receiver, method, arguments)
                .map(Some);
        }
        self.program_objc_field_call(id, receiver, member, arguments)
    }

    /// `this.started()`: a field of a class the program writes over an
    /// Objective-C class that holds a closure, read from the object its ivar
    /// holds and called as any closure is. `None` for any other member.
    fn program_objc_field_call(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(name) = self.literal_name(member) else {
            return Ok(None);
        };
        let Some(Place::Field { object, field }) =
            self.program_objc_instance_place(id, receiver, &name)?
        else {
            return Ok(None);
        };
        let Some(&callee) = self.children(id).first() else {
            return Ok(None);
        };
        let ty = self
            .type_of(callee)
            .ok_or_else(|| self.unrepresentable(callee, "a field holding a function"))?;
        self.check_this_is_passed(id)?;
        let origin = self.origin(id);
        let closure = self.push(OpKind::FieldGet { object, field }, ty, origin);
        self.call_through_closure(id, callee, closure, None, arguments)
            .map(Some)
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_method_on(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // A method a binding declares on a C handle -- a boxed record's box
        // among them: the C function itself, or one of the program's own
        // functions that `@ntsCall` names.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::NativePointer(_)
                | HirType::Managed(ManagedType::Object(TypeId(crate::hir::BOXED_RECORD)))
        ) && let Some(called) =
            self.call_on_native(id, (receiver, receiver_node), member, arguments)?
        {
            return Ok(called);
        }

        // `big.toString()` is the same `ToString` one type over, and
        // [`Self::as_string`] has picked `nts_bigint_to_string` for a `BigInt`
        // receiver since the day bigints landed. **Nothing reached it from
        // here**: the guard below names `Float` and `Int` and not `BigInt`, so
        // `"" + big` rendered a bigint and `big.toString()` refused with
        // `a method call on something without methods` -- today `` `toString` on a
        // bigint, which has no method table here `` -- one spelling of one
        // operation working and the other not.
        //
        // The helper exists in all three runtimes and in `hir::runtime`, so
        // this adds no surface; it connects surface that was already built.
        // Narrow on purpose: only the zero-argument spelling. `toString(radix)`
        // would need a second parameter the helper does not take, and falling
        // through to the refusal below is the honest answer for it.
        if matches!(self.values[receiver.0 as usize].ty, HirType::BigInt)
            && self
                .node(member)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                == Some("toString")
            && arguments.is_empty()
        {
            return self.as_string(receiver_node, receiver);
        }

        // `n.toString()` is `ToString` spelled as a method. A number has no
        // other method this compiler provides, so the arm is exact rather than
        // a first guess.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Float { .. } | HirType::Int { .. }
        ) {
            return self.lower_number_method(id, receiver_node, receiver, member, arguments);
        }

        // `valueOf` and `toString` on a string are the string. Not a runtime
        // call, because there is nothing for one to do: the specification says
        // the result *is* the receiver, and a helper returning it would hand
        // back a reference the caller does not own.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        ) && arguments.is_empty()
            && matches!(
                self.node(member)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8()),
                Some("valueOf" | "toString")
            )
        {
            return Ok(receiver);
        }

        // A string's methods are the runtime's, not the program's: there is
        // no `String` class here to resolve a call against.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        ) {
            return self.lower_string_method(id, receiver, member, arguments);
        }
        // A view takes the same two steps as an array, and for the same reason:
        // `class Bytes extends Uint8Array` declares its own methods, and the
        // representation says how the bytes are arranged rather than what
        // declared them. The fall-through differs -- an array has the runtime's
        // helpers behind it and a view does not yet -- so the second half is a
        // refusal that names the method instead.
        if matches!(
            self.values[receiver.0 as usize].ty,
            HirType::Managed(ManagedType::View(_))
        ) {
            return self.lower_view_method(id, receiver, receiver_node, member, arguments);
        }

        if let HirType::Managed(ManagedType::Array(element)) =
            self.values[receiver.0 as usize].ty.clone()
        {
            // A class whose instances *are* an array -- one extending a typed
            // array and adding no storage -- still declares methods, and they
            // are in the hierarchy under its own name. The representation says
            // how the bytes are arranged and nothing about what declared them,
            // so the member is resolved from the type the *checker* gives the
            // receiver. Without this, `buf.fill(0)` asked the runtime's array
            // helpers for a method the program wrote.
            // Through the polymorphic `this` first. Inside `class Buffer
            // extends Uint8Array`, `this.at8(...)` gives the receiver the
            // *this* type -- a type parameter constrained to `Buffer` -- and
            // the hierarchy is keyed by the class, so asking it about a type
            // parameter found nothing and the call fell through to the
            // runtime's array helpers. 34 refusals in the node profile were
            // `at8` and `checkInt`, which are Buffer's own methods called on
            // its own `this`.
            if let Some(declared) = self
                .snapshot
                .node_types
                .get(&receiver_node)
                .copied()
                .map(|ty| self.class_behind(ty))
                && let Some(key) = self.property_key(member)
                && self
                    .hierarchy
                    .declaring(declared, &MemberKey::method(key))
                    .is_some()
            {
                return self.lower_object_method(id, receiver, declared, member, arguments);
            }
            return self.lower_array_method(id, receiver, &element, member, arguments);
        }

        if let table @ HirType::Managed(ManagedType::Map(_, _) | ManagedType::Set(_)) =
            self.values[receiver.0 as usize].ty.clone()
        {
            return self.lower_table_method(id, receiver, &table, member, arguments);
        }

        if let HirType::Managed(ManagedType::Date) = self.values[receiver.0 as usize].ty {
            return self.lower_date_method(id, receiver, member, arguments);
        }

        if let HirType::Managed(ManagedType::Buffer) = self.values[receiver.0 as usize].ty {
            return self.lower_buffer_method(id, receiver, member, arguments);
        }

        if let HirType::Managed(ManagedType::DataView) = self.values[receiver.0 as usize].ty {
            return self.lower_data_view_method(id, receiver, member, arguments);
        }

        if let HirType::Managed(ManagedType::Symbol) = self.values[receiver.0 as usize].ty {
            return self.symbol_method(id, receiver, member, arguments);
        }

        let held = self.values[receiver.0 as usize].ty.clone();
        if let Some(settled) =
            self.capability_settle(id, receiver, receiver_node, member, arguments, &held)
        {
            return settled;
        }
        // After the capability, which is a promise too and answers `resolve`.
        if let Some(reacted) = self.promise_reaction(id, receiver, &held) {
            return reacted;
        }
        if let Some(own) = self.own_property_call(id, receiver, &held, member, arguments) {
            return own;
        }
        // A union of classes, erased: a test per arm and that arm's call. Before
        // the refusal below, and only for an erased receiver -- everything else
        // reaching here has no arms to build a chain out of.
        if held == HirType::Erased
            && let Some(chain) = self.open_call(id, receiver, receiver_node, member, arguments)
        {
            return chain;
        }
        if let Some(call) = self.registered_class_method_call(id, receiver, &held, arguments) {
            return call;
        }
        let HirType::Managed(ManagedType::Object(type_id)) = held else {
            return Err(self.no_method_table(id, member, &held));
        };
        self.lower_object_method(id, receiver, type_id, member, arguments)
    }

    /// A method of a class the program writes over a `GObject` class or a
    /// composable Windows Runtime class, called on one of its instances -- a
    /// handle, which has no method table: the compiled method itself, with
    /// the handle as `this`. Static, which is right while no class of the
    /// program's overrides another's own method; an override of the runtime
    /// class's is dispatched by the runtime, not here. `None` for any other
    /// call.
    fn registered_class_method_call(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        held: &HirType,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(held, HirType::NativePointer(_)) {
            return None;
        }
        let declaration = self.snapshot.call_targets.get(&id)?.callee?;
        if self.kind_of(declaration) != Some(syntax::METHOD_DECLARATION)
            || is_static_member(self.snapshot, declaration)
        {
            return None;
        }
        // The class the method is a member of: its members are in a list, so
        // the class is a parent or two up.
        let class =
            std::iter::successors(self.node(declaration).parent, |at| self.node(*at).parent)
                .take(3)
                .find(|at| self.kind_of(*at) == Some(syntax::CLASS_DECLARATION))?;
        if crate::hir::native::gobject_parent(self.snapshot, class).is_none()
            && !crate::hir::native::extends_com(self.snapshot, class)
        {
            return None;
        }
        let owner = self.children(class).into_iter().find_map(|child| {
            (self.kind_of(child) == Some(syntax::IDENTIFIER))
                .then(|| {
                    self.node(child)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })
                .flatten()
        })?;
        let name = self.member_name(declaration)?;
        let callee = Callee::Direct(format!("{owner}#{name}"));
        Some(
            self.lower_call_arguments(id, &callee, arguments, None)
                .and_then(|(mut args, lent)| {
                    args.insert(0, receiver);
                    self.finish_call(id, callee, args, lent, Some(declaration))
                }),
        )
    }

    /// A method call whose receiver is a representation with no methods of its
    /// own, named.
    ///
    /// **Name what the receiver is.** Everything above the arm that calls this is
    /// a representation with methods -- a string, an array, a map, a date, a
    /// buffer, a view, a symbol -- so what reaches here is every *other*
    /// representation at once: a promise, an erased value the arms could not be
    /// built for, a number, a native pointer. One sentence for all of them, and
    /// `something` was carrying the whole difference.
    ///
    /// It matters because the causes behind it are not one item. A promise
    /// receiver is `.then`/`.catch`/`.finally`, which has its own ✗ row and its
    /// own design; an erased receiver is a value the program has not narrowed and
    /// whose union is not a set of classes [`Self::open_call`] can chain; a number
    /// receiver is `n.toFixed()`. Ranking a census by this message put all three
    /// under one heading, which is the same thing `on a typed array` was doing to
    /// 27 sites and `a property the type does not declare` did before that.
    ///
    /// The method is named too, in the house style of every other member refusal,
    /// because the representation alone does not say whether a promise site is
    /// `.then` -- a designed row with a scoped fix -- or something else that fell
    /// through to here.
    fn no_method_table(&self, id: NodeId, member: NodeId, held: &HirType) -> Diagnostic {
        let called = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .unwrap_or_default();
        self.unsupported(
            id,
            &format!(
                "`{called}` on {}, which has no method table here",
                named_representation(held)
            ),
        )
    }

    /// A built-in method's arguments, appended to `args` after its receiver,
    /// each read the way the method reads it.
    ///
    /// **An index that may be `undefined` is what the method says `undefined`
    /// is**, which is not one thing: `xs.slice(1, undefined)` runs to the end,
    /// and `xs.splice(1, undefined)` removes nothing. `numeric_arguments`
    /// owns both the conversion and that undefined policy.
    /// Lowered as it was, the erased value met the helper's `double` through
    /// an unerase nothing had tested, and C, LLVM, the JVM and RC all read an
    /// undefined `end` as `0` -- an empty slice, and agreeing with node only
    /// where `0` happened to be the answer, as `splice`'s count is.
    pub(super) fn lower_method_arguments(
        &mut self,
        id: NodeId,
        (receiver, method): (MethodsOf, &str),
        arguments: &[NodeId],
        args: &mut Vec<ValueId>,
    ) -> Result<(), Diagnostic> {
        let values =
            self.builtin_raw_arguments(NumericBuiltin::Method(receiver, method), arguments, None)?;
        for (argument, value) in arguments.iter().zip(values) {
            let position = args.len();
            let value = self.builtin_number_argument(
                (id, *argument),
                NumericBuiltin::Method(receiver, method),
                position,
                value,
            )?;
            args.push(value);
        }
        Ok(())
    }

    pub(super) fn lower_called_method(
        &mut self,
        id: NodeId,
        receiver: Option<ValueId>,
        function: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .qualified
            .get(&function)
            .cloned()
            .or_else(|| self.declared_name(function))
            .ok_or_else(|| self.unsupported(id, "an @ntsCall function with no name"))?;
        // Against the function's own parameters, not the call's signature:
        // that is the binding's method, which has neither a body nor the
        // defaults the function gives what the program left out --
        // `file.query_info_async("standard::type")` against a wrapper taking
        // `flags: c_uint = 0 as c_uint` and two more after it.
        let parameters: Vec<NodeId> = self
            .children(function)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .collect();
        let want = |this: &Self, parameter: NodeId| {
            this.type_of(parameter).ok_or_else(|| {
                this.unsupported(id, "an @ntsCall function parameter of unrepresentable type")
            })
        };
        // The receiver is the function's first parameter; a static member's
        // call has none.
        let skip = usize::from(receiver.is_some());
        let mut args = Vec::new();
        if let Some(receiver) = receiver {
            let first = parameters.first().ok_or_else(|| {
                self.unsupported(id, "an @ntsCall function that takes no receiver")
            })?;
            let first = want(self, *first)?;
            args.push(self.coerce(receiver, &first, id)?);
        }
        for (at, argument) in arguments.iter().enumerate() {
            let parameter = parameters
                .get(at + skip)
                .copied()
                .filter(|_| self.kind_of(*argument) != Some(syntax::SPREAD_ELEMENT))
                .ok_or_else(|| {
                    self.unsupported(
                        *argument,
                        "an argument an @ntsCall function has no parameter for",
                    )
                })?;
            let ty = want(self, parameter)?;
            let value = self.lower_expecting(*argument, &ty)?;
            args.push(self.coerce(value, &ty, *argument)?);
        }
        // Each left out, its default -- only a constant one. These are
        // lowered after every written argument, which for an arbitrary
        // default would run it out of order with an argument to its right,
        // and in a scope where the parameters before it are not bound. A
        // constant has neither problem, and it is what a binding writes.
        for parameter in parameters.iter().skip(skip + arguments.len()) {
            let default = self.default_of(*parameter).ok_or_else(|| {
                self.unsupported(
                    id,
                    "an argument left out where the @ntsCall function has no default for it",
                )
            })?;
            if !self.is_constant(default) {
                return Err(self.unsupported(default, "an @ntsCall default that is not a constant, which this lowering cannot evaluate at the call"));
            }
            let ty = want(self, *parameter)?;
            let value = self.lower_expecting(default, &ty)?;
            args.push(self.coerce(value, &ty, default)?);
        }
        self.push_call(id, Callee::Direct(name), args, Some(function), None)
    }

    /// A literal, `null`, or one of those negated, parenthesized or cast --
    /// `0 as c_uint`: an expression whose value does not depend on where or
    /// when it is evaluated.
    fn is_constant(&self, node: NodeId) -> bool {
        match self.kind_of(node) {
            Some(
                syntax::NUMERIC_LITERAL
                | syntax::STRING_LITERAL
                | syntax::TRUE_KEYWORD
                | syntax::FALSE_KEYWORD
                | syntax::NULL_KEYWORD,
            ) => true,
            Some(
                syntax::AS_EXPRESSION
                | syntax::PARENTHESIZED_EXPRESSION
                | syntax::PREFIX_UNARY_EXPRESSION,
            ) => self
                .children(node)
                .first()
                .is_some_and(|inner| self.is_constant(*inner)),
            _ => false,
        }
    }

    /// `Class.member(...)`: an ordinary direct call to a function with no
    /// receiver.
    pub(super) fn lower_static_call(
        &mut self,
        id: NodeId,
        class_name: &str,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // A class method's `@ntsCall`: Swift's `async` form of one --
        // `NSAnimationContext.runAnimationGroup` -- whose body is the values
        // module's function, taking no receiver.
        if let Some(function) = self.called_method(id)? {
            return self.lower_called_method(id, None, function, arguments);
        }
        // The *last* child. `Box.#check` is an object beside a name, and
        // looking for the first identifier found `Box` -- which named the
        // method after its class for every static call whose receiver is a
        // plain name, and found nothing at all when the name was `#check`.
        // The declaration's own name -- `member` is the `MethodDeclaration`
        // here, not a property access. Through the shared resolver, because
        // `#check` is a name and the private-identifier kind is not the
        // identifier kind: reading only identifiers left a private static
        // method nameless, and the members declared after it in the same class
        // were then neither lowered nor refused.
        let member_name = self.member_name(member).ok_or_else(|| {
            self.unsupported(member, "a static method whose name the program computes")
        })?;
        // A class method of an Objective-C class: a message to the class.
        if let Some(target) = self.snapshot.call_targets.get(&id).copied()
            && let Some(declaration) = target
                .callee
                .filter(|d| self.objc_class_member(*d).is_some_and(|m| m.is_static))
        {
            let signature = self.snapshot.signatures[target.signature.0 as usize].clone();
            let callee = self.native_callee(id, Some(declaration), member_name, &signature)?;
            let (args, lent) = self.lower_call_arguments(id, &callee, arguments, None)?;
            return self.finish_call(id, callee, args, lent, Some(declaration));
        }

        let args = self.lower_arguments(id, arguments)?;
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a call result"))?;
        self.materialize(id, &ty)?;
        // **A bound static, selected the way an instance call already is.**
        // `callee_for` resolves a bound member reached through a receiver; a
        // static has no receiver to dispatch on, so it arrives here instead --
        // and this was the one call shape the binding never reached. It is not
        // an edge of the surface: `Integer.parseInt`, `Math.abs` and every
        // factory method in the JDK are statics.
        let bound = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|it| it.callee)
            .map(|declaration| self.location(declaration))
            .and_then(|at| self.foreign.get(&(at.file.0, at.span.end)))
            .map(|row| row.key.clone());
        // **A static is a second place that names a member, and it needed the
        // raising suffix too.** `callee_for` resolves an *instance* member and a
        // static has no receiver to dispatch on, so it arrives here instead -- and
        // `eb92ee8f9`, which made a method copyable, left this path calling the
        // ordinary entry: `try { C.raises(n) } catch` ended the program on the
        // `throw` where node catches, on 10 of 10 cases, with nothing refusing.
        // Before that commit the call refused by name, so this is a refusal turned
        // into a wrong answer, which is the one direction this work must never go.
        //
        // No virtual arm, which is the difference from `callee_for`: a static is not
        // overridden through a slot, so there is always a name to suffix.
        //
        let suffix = self.raising_suffix_of(id);
        let emitted_member = member_dispatch_key(self, member)
            .ok_or_else(|| {
                self.unsupported(member, "a static method whose name the program computes")
            })?
            .emitted_name();
        let callee = match bound {
            Some(key) => Callee::External(key),
            None => Callee::Direct(format!("{class_name}.{emitted_member}{suffix}")),
        };
        // The declaration also identifies a generator's concrete frame. The
        // shared call path marks it before a for-of asks how to resume it.
        self.push_call(id, callee, args, Some(member), Some(ty))
    }

    /// `receiver.member(args)` on an **erased** receiver whose type is a union of
    /// classes that each declare the method: a test per arm, that arm's call
    /// behind it, and a named abort where nothing matches.
    ///
    /// # No new operation, which is the finding
    ///
    /// [`OpKind::OpenFieldGet`] exists because a field read has to stay *inside*
    /// one HIR block: C and LLVM render a member read as an expression, and
    /// wrapping it in a chain of tests would put basic blocks in the middle of a
    /// block they are emitting statement by statement -- which is what
    /// `open_chains` builds `alwaysinline` helpers to avoid.
    ///
    /// A **call** has no such constraint. `Terminator::Branch` and a merge with a
    /// block parameter are what this file already builds for `a ? b() : c()`, so
    /// the chain is ordinary control flow: every backend renders it today, there
    /// is no op to add, no `verify` rule to write and no three-backend emission
    /// to keep in agreement. An op here would have been three copies of a shape
    /// the lowering can say once.
    ///
    /// # What has to be true
    ///
    /// - The receiver is `HirType::Erased`. A concrete receiver has a method
    ///   table and takes the ordinary path.
    /// - Its checker type is a union of **two or more** members, each of which is
    ///   a class the hierarchy has a declaration of the method for. One that is
    ///   not is not an arm a test could dispatch through, and the call stays
    ///   refused by the sentence naming the receiver -- rather than becoming a
    ///   chain with a hole in it.
    /// - Every arm has a layout, because the test is `instanceof` and that is
    ///   what it compares against.
    ///
    /// The arguments are lowered **once**, before the first test: a call
    /// evaluates its arguments before it runs, and an arm that lowered them
    /// itself would run their side effects once per test taken.
    ///
    /// Each arm unerases to **its own** type and never to the union.
    /// `hierarchy::declared`'s doc is what that rule costs when it is broken: "a
    /// value erased from `A` and unerased to `C` is a `checkcast nts/gen/C` that
    /// throws", which record 0289 paid seventeen times in one example.
    ///
    /// # The end of the chain
    ///
    /// The last arm takes its test like every other, and no-match calls
    /// `nts_no_arm_of` -- which names the member *and the value's own layout* --
    /// before an unreachable terminator. A fallthrough into the last arm would
    /// turn a wrong arm set into a call through the wrong class, and
    /// `Terminator::Unreachable` alone is `__builtin_unreachable()` in C, which
    /// turns it into a segfault. The set over-approximates by construction, so
    /// this is unreachable; the point is that a violation says so.
    fn open_call(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        let member_name = self.called_member_name(member)?;
        let ty = *self.snapshot.node_types.get(&receiver_node)?;
        let TypeKind::Union(members) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let members = members.clone();
        if members.len() < 2 {
            return None;
        }
        let mut arms: Vec<(TypeId, Callee)> = Vec::with_capacity(members.len());
        for arm in &members {
            let class = self.class_behind(*arm);
            self.hierarchy.declaring(
                class,
                &MemberKey::method(self.access_key(id, &member_name)?),
            )?;
            // The test compares against a layout, so every arm needs one. Asked
            // before anything is emitted, because a chain with one arm missing is
            // worse than a refusal naming the receiver.
            self.layout_of(id, class).ok()?;
            arms.push((class, self.callee_for(id, class, &member_name).ok()?));
        }
        Some(self.chain_of_calls(id, receiver, &member_name, arms, arguments))
    }

    /// The chain [`Self::open_call`] decided on, emitted.
    fn chain_of_calls(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member_name: &str,
        arms: Vec<(TypeId, Callee)>,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a call result"))?;
        let args = self.lower_arguments_on(id, arguments, receiver)?;
        // A `void` call has no value to merge, exactly as a `void` conditional
        // has none: the C backend declares no variable for one, so a block
        // parameter carrying it would be read in the merge as an identifier
        // nothing declared.
        let carries = !matches!(ty, HirType::Void);
        let merge = self.new_block();
        let merged = carries.then(|| self.push_block_param(merge, ty.clone(), origin.clone()));
        for (class, callee) in arms {
            let classes = self.classes_under(class);
            let is = self.push(
                OpKind::InstanceOf {
                    value: receiver,
                    classes,
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            );
            let taken = self.new_block();
            let next = self.new_block();
            self.terminate(Terminator::Branch {
                cond: is,
                then_target: taken,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(taken);
            let object = self.push(
                OpKind::unerase(receiver),
                HirType::Managed(ManagedType::Object(class)),
                origin.clone(),
            );
            let mut call_args = vec![object];
            call_args.extend(args.iter().copied());
            let answer = self.push(
                OpKind::Call {
                    callee,
                    args: call_args,
                    frame: None,
                },
                ty.clone(),
                origin.clone(),
            );
            self.terminate(Terminator::Jump {
                target: merge,
                args: if carries { vec![answer] } else { Vec::new() },
            });
            self.switch_to(next);
        }
        let name = self.push(
            OpKind::ConstString(member_name.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.push(
            OpKind::Call {
                callee: Callee::External("nts_no_arm_of".to_owned()),
                args: vec![receiver, name],
                frame: None,
            },
            HirType::Void,
            origin.clone(),
        );
        self.terminate(Terminator::Unreachable);
        self.switch_to(merge);
        Ok(match merged {
            Some(value) => value,
            None => self.push(OpKind::ConstUndefined, ty, origin),
        })
    }

    #[expect(
        clippy::too_many_lines,
        reason = "keep semantic text and key projection beside its existing dispatch"
    )]
    pub(super) fn lower_object_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        type_id: TypeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // [`Self::literal_name`] rather than the node's text, because the
        // decoder carries none on a literal: `o["twice"]()` names its method
        // with a `STRING_LITERAL`, and reading `.text` there answered `None`
        // for a name the program spells in full. Three call paths -- a string's
        // methods, an array's and an object's -- each read it the same wrong
        // way, so a bracketed method call was refused as "a computed method
        // name" on every receiver there is.
        let member_name = self
            .called_member_name(member)
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;
        let key = self.required_access_key(id, &member_name)?;
        if let Some(contract) = self.projected_callable(type_id, &key) {
            let object = self
                .children(id)
                .first()
                .and_then(|callee| self.children(*callee).first().copied())
                .unwrap_or(id);
            return self.start_callable(
                id,
                receiver,
                object,
                member,
                contract,
                callable_fields::Action::Call,
            );
        }

        // `g.next()` on a generator **held as a value** rather than walked.
        if member_name == "next"
            && self
                .generator_element_of(&self.values[receiver.0 as usize].ty.clone())
                .is_some()
        {
            return self.generator_next(id, receiver, member, arguments);
        }

        // A method nothing in the hierarchy declares. Falling back to the
        // receiver's own type named a function this program never emits: on a
        // class extending the provided `Error`, `e.toString()` became `call
        // E#toString`, and the failure was a missing symbol at link time rather
        // than a diagnostic here. `toString` is a real member of the declared
        // `Error` and is not one this compiler provides, which is the same
        // shape as reading `.stack`.
        // A *field* holding a closure, called. `o.f(x)` where `f: (x) => y` is
        // storage, not a method: nothing declares it in the hierarchy because
        // there is nothing to declare, and the value to call is in the object.
        //
        // Asked before the hierarchy, because a name cannot be both: a method
        // is not in the layout and a field is not in the dispatch table.
        // Through [`Self::field_named`], so a **tuple position** resolves here as
        // it does for a read: `t[1]()` arrives as a member named `1` where the
        // layout spells the field `_1`, and asking `index_of` alone found nothing
        // and refused with "a method `1` with no declaration in the hierarchy" --
        // for a tuple element holding a closure, which is what `[state, setState]`
        // is, and so what `useState`, `useReducer`, `useTransition` and
        // `useActionState` return.
        if let Some(layout) = self.layout_of(id, type_id).ok()
            && let Some(field) = self.field_named(
                type_id,
                &layout,
                &self.required_access_key(id, &member_name)?,
            )
            && let Some(declared) = layout.fields.get(field as usize)
            && matches!(declared.ty, HirType::Managed(ManagedType::Object(_)))
        {
            let access = self.node(member).parent.unwrap_or(member);
            let held = self.member_of(access, receiver, &member_name)?;
            return self.call_through_closure(id, member, held, Some(receiver), arguments);
        }

        // **A getter returning a function, called where it is read.**
        // `new C().f(n)` is two operations that look like one: read `f`, which
        // *runs the getter*, then call what it answered. The branch above is
        // the same shape for a field, and this was refused as `a method \`f\`
        // with no declaration in the hierarchy` -- a true sentence about a
        // question that should not have been asked, since the hierarchy has
        // `get f` and no method at all.
        //
        // It is the link above `a method used as a value`: the corpus writes
        // `get method() { return this.#method; }` and then `new C().method([])`,
        // so the read had to produce a function object before this could call
        // one.
        // **Through `member_of`, not a second copy of the getter call.** Asking
        // the checker for the result type here gave `managed<obj#28>` where the
        // getter function returns `managed<obj#20>` -- two anonymous types for
        // one thing -- and a value whose type nothing had laid out makes the
        // program **invalid HIR**: `emit-c` prints `refusing to emit code from
        // invalid HIR`, writes nothing and exits 0. `member_of` is where a
        // getter read is resolved for every other reader, so it decides this
        // one too.
        if self
            .accessor_callee(
                member,
                type_id,
                &self.required_access_key(member, &member_name)?,
                MethodAccessor::Get,
            )?
            .is_some()
        {
            let access = self.node(member).parent.unwrap_or(member);
            let held = self.member_of(access, receiver, &member_name)?;
            // **The value's own type needs a layout, and only here.** A getter
            // returning a function gives its result an anonymous function type
            // that nothing else in the program names; a type reaching HIR
            // without one is *invalid HIR* rather than a refusal. Materialized
            // at the **call** rather than at the read, because a read whose
            // closure is refused must not bring the class into existence --
            // doing it in `member_of` built a `call` for a generator method
            // that had already been declined, and the program failed
            // verification instead of refusing.
            let held_ty = self.values[held.0 as usize].ty.clone();
            self.materialize(member, &held_ty)?;
            return self.call_through_closure(id, member, held, Some(receiver), arguments);
        }

        // **An optional property holding a function**, which is not the same
        // slot as a union with `undefined` in it and was refused while that one
        // lowered.
        //
        //     run:  ((n: number) => number) | undefined     managed<obj#4>
        //     run?: (n: number) => number                   erased
        //
        // An optional property has a third state -- *absent*, as against
        // present-and-undefined -- so it cannot be a nullable pointer and lays
        // out erased. The branch above asks for a closure object and does not
        // fire, and the hierarchy has nothing to declare, so the refusal read
        // `a method `run` with no declaration in the hierarchy` -- which names
        // neither the optionality nor the field.
        //
        // The licence to unerase is the checker's own: `o.run(x)` only
        // typechecks where `o.run` has been narrowed to the function, so the
        // narrowed type is on the name being read. Where it has not been
        // narrowed this asks for a closure object, does not get one, and falls
        // through to the refusal as before.
        //
        // 42 sites in `runtime/node` report this message across at least three
        // unlike causes, so this closes one of them rather than the count.
        // `async_hooks`'s `emitInit` is the one that was walked to: `hook.init`
        // is declared `init?: (...) => void`, and it is the first link under
        // `asRequest` and every `nextTick` caller.
        if let Ok(layout) = self.layout_of(id, type_id)
            && let Some(key) = self.property_key(member)
            && let Some(field) = layout.index_of_key(&key)
            && let Some(declared) = layout.fields.get(field as usize)
            && declared.ty == HirType::Erased
            && let Some(narrowed) = self.type_of(member)
            && matches!(narrowed, HirType::Managed(ManagedType::Object(_)))
            // **And the checker must have narrowed the absence away.** The
            // representation cannot say so on its own: `F` and `F | undefined`
            // are both a pointer, because a nullable reference is what the one
            // spare pointer value is for. So the *type* is asked, not its
            // width.
            //
            // Without this, `o.run!(x)` on an absent property would unerase a
            // tag that says absent and call through whatever the payload bits
            // are. Node throws `TypeError: o.run is not a function` there; a
            // null call is not that, and it is the one outcome worse than the
            // refusal this branch replaces.
            && self
                .snapshot
                .node_types
                .get(&member)
                .copied()
                .is_some_and(|ty| !self.admits_absence(ty))
        {
            let origin = self.origin(member);
            let held = self.push(
                OpKind::FieldGet {
                    object: receiver,
                    field,
                },
                HirType::Erased,
                origin.clone(),
            );
            let held = self.push(OpKind::unerase(held), narrowed, origin);
            return self.call_through_closure(id, member, held, Some(receiver), arguments);
        }

        // `f.call(receiver, ...rest)`, which is how this profile invokes a
        // stored callback without making the holder the JavaScript receiver.
        // Asked before the hierarchy for the same reason a field holding a
        // closure is: `call` is not a member of anything here, and the
        // hierarchy answering "no declaration" was the whole refusal.
        if member_name == "call"
            && let Some(function_ty) = self.function_type_of_receiver(member, type_id)
        {
            return self.lower_call_with_receiver(id, member, receiver, function_ty, arguments);
        }
        if member_name == "apply"
            && let Some(function_ty) = self.function_type_of_receiver(member, type_id)
        {
            return self.lower_apply_with_receiver(id, member, receiver, function_ty, arguments);
        }
        if member_name == "bind" && self.function_type_of_receiver(member, type_id).is_some() {
            return self.lower_bind(id, receiver, arguments);
        }

        let callee = self.callee_for(id, type_id, &member_name)?;

        let (lowered, declared_result) =
            self.method_arguments(id, type_id, &member_name, arguments, receiver)?;
        let mut args = vec![receiver];
        args.extend(lowered);
        // Calling a generator produces its **frame**, not the `Generator<T, …>`
        // the checker says -- that interface describes an object this compiler
        // does not build. The plain-call path says the same thing three hundred
        // lines away and reads the declaration out of `call_targets`; a method
        // call has a receiver type and a member name, and
        // `PropertyRecord::declaration` is what turns those into the same node.
        let reserved = self
            .member_declaration(type_id, &self.required_access_key(id, &member_name)?)
            .and_then(|declaration| self.generators.get(&declaration).copied());
        let ty = reserved
            .map(|index| HirType::Managed(ManagedType::Object(crate::hir::generator_frame(index))))
            .or(declared_result)
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unrepresentable(id, "a call result"))?;
        let origin = self.origin(id);
        let call = self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        );
        // **A method call needs the flag test too, and this is the third push that
        // needed telling.** `push_call` has it for a plain call and
        // `finish_closure_call` for a dispatch; a method goes through neither, so a
        // call naming `Class#m@raises` set the flag and nobody looked -- `caught`
        // returned the copy's dummy zero where node answers -1, on 29 of 29 cases.
        //
        // Three push sites and one question is the shape that keeps costing here: the
        // first version of the net for this lived in `test_for_a_raise` and never
        // fired for a method for exactly this reason.
        self.test_for_a_raise(id);
        Ok(self.note_generator_call(call, reserved))
    }

    /// [`Self::callee_for`], told whether to name the raising copy rather than
    /// asking the call node: a method value's wrapper calls the method with no
    /// node of its own to ask ([`Self::wrapped_call`]).
    pub(super) fn method_callee(
        &mut self,
        id: NodeId,
        type_id: TypeId,
        member: &MemberKey,
        suffix: &'static str,
    ) -> Result<Callee, Diagnostic> {
        let member_name = &member.key;
        let emitted = member.emitted_name();
        // **A bound foreign member, selected by the declaration the checker
        // resolved to.** `call_targets` is keyed by call node -- the `id` this
        // function already receives -- and its `callee` is the declaration
        // after overload resolution, which is the only thing that selects among
        // overloads: 4,973 of 52,171 member names in a generated Android SDK
        // binding carry more than one, and 1,870 overload sets have two members
        // at the same arity, so neither the name nor the arity is enough.
        if let Some(declaration) = self.snapshot.call_targets.get(&id).and_then(|it| it.callee) {
            let at = self.location(declaration);
            if let Some(bound) = self.foreign.get(&(at.file.0, at.span.end)) {
                return Ok(Callee::External(bound.key.clone()));
            }
        }
        let Some(declaring) = self.hierarchy.declaring(type_id, member) else {
            return Err(self.unsupported(
                id,
                &format!("a method `{member_name}` with no declaration in the hierarchy"),
            ));
        };
        let owner = match self.hierarchy.name.get(&declaring) {
            Some(name) => name.clone(),
            None => self.layout_of(id, declaring)?.name,
        };
        // **The raising copy of a method is reached by naming it** where the dispatch is
        // direct: a member no subclass overrides is already a `Callee::Direct` here, and
        // the copy is that name with the suffix -- which is why a method needed no table
        // index the way a closure did.
        //
        // **And where the dispatch is virtual the copy has its own slot**, which this
        // refused for want of until `number_raising_member_slots` allocated one. Naming
        // the plain entry instead would run a body that ends the program on an uncaught
        // `throw`, with the flag test the site just emitted watching a flag nothing sets.
        // This is the one place that knows direct from virtual, so it is the one place
        // that chooses: `call_within` admits any callee with a raising copy and leaves
        // the distinction here, rather than deriving it a second time from the
        // receiver's type.
        if self.hierarchy.overridden(type_id, member)
            && let Some(slot) = self.hierarchy.slot_for(type_id, member, false)
        {
            // **And the raising copy has a slot of its own now**, which this refused
            // for want of. A member no subclass overrides is a `Callee::Direct` and its
            // copy is that name with the suffix; a virtual one had no name to suffix, so
            // the call named the ordinary entry -- whose body ends the program on an
            // uncaught `throw` while the flag test the site emitted watched a flag
            // nothing sets -- and refusing was the only honest answer.
            //
            // `number_raising_member_slots` allocates the index and
            // `fill_raising_member_slots` fills it per class, with the copy or, for an
            // override that cannot raise, with the ordinary entry.
            if !suffix.is_empty() {
                let Some(slot) = self.hierarchy.slot_for(type_id, member, true) else {
                    let why = self.why_the_raising_slot_is_missing(type_id, member);
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "a call inside a `try` to `{member_name}`, which a subclass \
                             overrides: {why}"
                        ),
                    ));
                };
                return Ok(Callee::Virtual {
                    slot,
                    declared: format!("{owner}#{emitted}{RAISING_SUFFIX}"),
                });
            }
            return Ok(Callee::Virtual {
                slot,
                declared: format!("{owner}#{emitted}"),
            });
        }
        Ok(Callee::Direct(format!("{owner}#{emitted}{suffix}")))
    }
}
