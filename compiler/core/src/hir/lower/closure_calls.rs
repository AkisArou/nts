//! Call a closure at its selected entry and implement Function.call/apply argument and receiver semantics.

use super::{
    ArrayFill, Callee, ClosureEntry, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind,
    TypeId, UniformArguments, UniformSite, ValueId, absent_of_result, closure_names,
    receiving_call_name, signature_key, syntax,
};

impl FuncBuilder<'_> {
    /// `f(x)` where `f` holds a closure.
    ///
    /// The receiver goes first, exactly as it does for a method, and the slot
    /// is the one every closure's `call` occupies. What makes the single slot
    /// safe is that the call spells its own signature: two closure types
    /// sharing an index are never confused, because neither call site consults
    /// the other's types.
    pub(super) fn lower_closure_call(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(callee_node)?;
        self.call_through_closure(id, callee_node, receiver, None, arguments)
    }

    /// The checker's function type for the receiver of a `.call`.
    ///
    /// **Not the value's own type.** A function made from a declaration or an
    /// arrow is a *closure class* here, and its id is synthetic -- above
    /// `SYNTHETIC_TYPE_FLOOR`, with no record in the snapshot at all -- so
    /// asking it for a signature answers nothing. `const f = twoArgs; f.call(…)`
    /// refused for that reason while `emit`'s `callback.call(…)` worked, because
    /// `callback` is a field declared `Listener` and a declared type survives.
    ///
    /// The signature is a property of the source the receiver was read from, so
    /// it comes from the object node of the property access rather than from
    /// the lowered value.
    pub(super) fn function_type_of_receiver(
        &self,
        member: NodeId,
        type_id: TypeId,
    ) -> Option<TypeId> {
        if signature_key(self.snapshot, type_id).is_some() {
            return Some(type_id);
        }
        let access = self.node(member).parent?;
        let object = self.children(access).first().copied()?;
        let ty = *self.snapshot.node_types.get(&object)?;
        signature_key(self.snapshot, ty).map(|_| ty)
    }

    /// The function `f.call(...)` or `f.apply(...)` calls: `f`, where it is a
    /// function value. The lowering makes such a call a call of `f` through the
    /// entry every call of a function value takes ([`Self::lower_call_with_receiver`],
    /// [`Self::lower_apply_with_receiver`]), asking [`Self::function_type_of_receiver`]
    /// as this does, so the questions about what a call reaches -- can it
    /// raise, is it held in a value, is it compiled code -- ask about `f`.
    ///
    /// The checker resolves the callee to `CallableFunction.call`, a provided
    /// signature with no body, and every one of those questions answered for
    /// it: "cannot raise". So `try { f.call(r) }` handled nothing, and a `throw`
    /// from `f` ended the program where node catches it -- a declared `f`, a
    /// `function` expression, and the same through a bound function's body.
    pub(super) fn through_call_or_apply(&self, call: NodeId) -> Option<NodeId> {
        let callee = self.through_assertions(*self.children(call).first()?);
        let (function, name) = self.member_access(callee)?;
        let member = *self.children(callee).last()?;
        let ty = *self.snapshot.node_types.get(&function)?;
        (matches!(name.as_str(), "call" | "apply")
            && self.function_type_of_receiver(member, ty).is_some())
        .then_some(function)
    }

    /// `f.call(receiver, ...rest)` -- an explicit JavaScript receiver.
    ///
    /// ```text
    /// const callback = handler.callback;
    /// const result = callback.call(this, ...args);
    /// ```
    ///
    /// That is `EventEmitter#emit`, and the comment above it says why the
    /// receiver is written: calling `handler.callback(...)` would make the
    /// private `ListenerRecord` the receiver and leak an implementation detail
    /// as `this`. It refused as ``a method `call` with no declaration in the
    /// hierarchy``, and under it sat `http.createServer` and every stream.
    ///
    /// # Who reads the receiver
    ///
    /// A call through a function value hands it to the uniform entry, as every
    /// such call hands its `this` ([`super::UNIFORM_THIS`](crate::hir::UNIFORM_THIS)), and a body that
    /// reads its own `this` takes it (`docs/records/notebooks/function-receivers.md`): a
    /// `function` expression or declaration, and a method taken as a value
    /// ([`Self::method_receiver`]). An arrow has no `this` of its own, and the
    /// enclosing one is captured at the arrow rather than passed at the call.
    ///
    /// `apply` passes its receiver the same way and its arguments as an array:
    /// [`Self::lower_apply_with_receiver`].
    pub(super) fn lower_call_with_receiver(
        &mut self,
        id: NodeId,
        member: NodeId,
        function: ValueId,
        function_ty: TypeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some((given, rest)) = arguments.split_first() else {
            // `f.call()` -- no receiver written, so `undefined`.
            return self.call_through_closure(id, member, function, None, &[]);
        };
        let this = self.lower_this_argument(*given)?;
        // Set after the receiver is lowered and restored after the call, so it
        // covers exactly this call's argument list.
        let outer = self.callee_signature.replace((id, function_ty));
        let called = self.call_through_closure(id, member, function, Some(this), rest);
        self.callee_signature = outer;
        called
    }

    /// The `this` written at `f.call(this, ...)` or `f.apply(this, list)`, as the
    /// erased value a uniform closure entry takes ([`super::UNIFORM_THIS`](crate::hir::UNIFORM_THIS)).
    ///
    /// Lowered expecting an erased value, as an argument to an `unknown`
    /// parameter is, so `undefined` and `null` are values here: lowered for
    /// their effects alone, they refused the call as ``null` or `undefined`
    /// where what it stands in for is not a reference``.
    pub(super) fn lower_this_argument(&mut self, given: NodeId) -> Result<ValueId, Diagnostic> {
        let this = self.lower_expecting(given, &HirType::Erased)?;
        self.coerce(this, &HirType::Erased, given)
    }

    /// Which body a call of a function value reaches, and so which arguments it
    /// takes.
    ///
    /// Split out because `apply` needs the same answer and supplies its
    /// arguments differently.
    pub(super) fn closure_callee(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        receiver: ValueId,
    ) -> Result<ClosureEntry, Diagnostic> {
        let raising = self.dispatches_to_a_raising_entry(id);
        self.closure_entry(id, callee_node, receiver, raising)
    }

    /// [`Self::closure_callee`], told whether the call dispatches at the raising
    /// entry rather than asking the call node: a call a body makes with no node
    /// of its own -- a bound function's -- has nothing to ask.
    pub(super) fn closure_entry(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        receiver: ValueId,
        raising: bool,
    ) -> Result<ClosureEntry, Diagnostic> {
        let HirType::Managed(ManagedType::Object(_)) = self.values[receiver.0 as usize].ty else {
            return Err(self.unsupported(callee_node, "a call of something that is not a function"));
        };
        // Knowing the closure's identity does not prove its arguments fit its
        // body. In particular string, nullable string and optional string share
        // pointer storage. Start with the uniform entry; call_directly can
        // recover the typed body only after Erase.absent proves admission and
        // that a default cannot run. Otherwise it keeps the known uniform entry.
        let slot = if raising {
            self.hierarchy.raising_call_slot
        } else {
            self.hierarchy.erased_call_slot
        };
        slot.map(ClosureEntry).ok_or_else(|| {
            self.unsupported(
                id,
                "a call of a function value in a program with no closures",
            )
        })
    }

    /// Whether this call's uniform entry owns its parameter defaults.
    pub(super) fn uniform_defaults_at(&self, call: NodeId) -> bool {
        self.argument_sources
            .get(&call)
            .is_some_and(|arguments| arguments.typed_references.is_none())
    }

    /// `f.apply(receiver, list)` -- the arguments as one array.
    ///
    /// The receiver is passed as [`Self::lower_call_with_receiver`] passes it,
    /// which is the half these two share. What they do not share is the
    /// arguments: `call` takes them positionally and `apply` takes them as an
    /// array, so this is a different lowering rather than the same one under
    /// another name.
    ///
    /// **The array is copied, not passed through.** A rest parameter is fresh on
    /// every call in JavaScript, so handing the caller's array to the callee
    /// would alias it -- `function f(...xs) { xs.push(1) }` would reach back
    /// into `args`. Concatenating onto an empty one is what `gather_rest` does
    /// for a spread and for the same reason.
    ///
    /// What this does *not* do is the positional case: `f.apply(r, [a, b])`
    /// where the callee takes `(a, b)` rather than a rest needs the arity of a
    /// literal, which is `tests/programs/a-fixed-arity-rest-is-positional`. At the
    /// twelve `.apply` sites in this tree the callee's parameter is a rest and
    /// the argument is the array that filled it -- `fn.apply(thisArg, args)`
    /// with `fn: (...args: A) => T` and `args: A` -- so this is the shape the
    /// corpus has.
    pub(super) fn lower_apply_with_receiver(
        &mut self,
        id: NodeId,
        member: NodeId,
        function: ValueId,
        function_ty: TypeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [given, list] = arguments else {
            return Err(self.unsupported(id, "an `apply` that is not a receiver and a list"));
        };
        let this = self.lower_this_argument(*given)?;
        // The callee's signature, not `Function.prototype.apply`'s. See
        // `Self::callee_signature`.
        let outer = self.callee_signature.replace((id, function_ty));
        let built = self.apply_through_closure(id, member, function, this, *list);
        self.callee_signature = outer;
        built
    }

    fn apply_through_closure(
        &mut self,
        id: NodeId,
        member: NodeId,
        function: ValueId,
        this: ValueId,
        list: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let shapes = self.parameter_shapes(id);
        let Some(at) = shapes.iter().position(|(_, rest)| *rest) else {
            // **The positional case, which the fixture predicted would close
            // with the other one.** `f.apply(r, [a, b])` where the callee takes
            // `(a, b)` needs the *arity of the list*, which is the same thing a
            // fixed-arity rest needed from the other side -- there a tuple
            // becomes parameters, here it becomes arguments.
            //
            // This path also became load-bearing for a shape that used to take
            // the branch above: a rest typed by a fixed-length tuple is no
            // longer a rest by the time `parameter_shapes` is asked, so
            // `fn.apply(thisArg, args)` with `fn: (...args: [number]) => T`
            // arrives here now. Both readings want the same code.
            return self.apply_positionally(id, member, function, this, list, shapes.len());
        };
        if at != 0 {
            return Err(self.unsupported(
                id,
                "an `apply` whose callee takes arguments before its rest",
            ));
        }
        let ty = self
            .parameter_type_id(id, at)
            .and_then(|ty| match self.represent(ty) {
                Some(array @ HirType::Managed(ManagedType::Array(_))) => Some(array),
                _ => self.tuple_union_as_array(ty),
            })
            .ok_or_else(|| self.unsupported(id, "an `apply` whose rest has no representation"))?;
        let HirType::Managed(ManagedType::Array(element)) = ty.clone() else {
            return Err(self.unsupported(id, "an `apply` whose rest is not an array"));
        };
        let callee = self.closure_callee(id, member, function)?;
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let empty = self.push(
            OpKind::ArrayNew {
                length: zero,
                fill: ArrayFill::Holes,
            },
            ty.clone(),
            origin,
        );
        let gathered = self.concat_onto(id, &element, &ty, empty, &[list])?;
        self.finish_closure_call(id, function, Some(this), callee, vec![function, gathered])
    }

    /// `f.apply(receiver, list)` onto a callee that takes its arguments
    /// positionally.
    ///
    /// Two ways the arity can be known, and both are needed. A literal written
    /// at the call site carries it syntactically -- `[a, b]` is two arguments
    /// whatever the checker widened its type to, and `fn.apply(undefined, [x])`
    /// against `(x: number) => number` widens to `number[]`, so asking the type
    /// alone answers nothing. A *value* carries it only when its type is a
    /// tuple, which is the `(...args: A) => T` shape once `A` is pinned.
    ///
    /// Anything else is refused by name. An array of unknown length cannot fill
    /// a fixed parameter list, and the alternative -- a run-time length check
    /// and a throw -- puts a failure on a path TypeScript proved safe.
    fn apply_positionally(
        &mut self,
        id: NodeId,
        member: NodeId,
        function: ValueId,
        this: ValueId,
        list: NodeId,
        wanted: usize,
    ) -> Result<ValueId, Diagnostic> {
        let spread = self
            .children(list)
            .into_iter()
            .any(|child| self.kind_of(child) == Some(syntax::SPREAD_ELEMENT));
        let literal = self.kind_of(list) == Some(syntax::ARRAY_LITERAL_EXPRESSION) && !spread;

        let elements: Vec<NodeId> = if literal {
            self.children(list)
        } else {
            Vec::new()
        };
        let positions = self
            .snapshot
            .node_types
            .get(&list)
            .copied()
            .and_then(|ty| self.fixed_arity_positions(ty));

        // The count has to match the parameter list exactly. TypeScript checks
        // this, so a mismatch here means the arity was read from the wrong
        // place -- which is a refusal rather than an argument list built to the
        // wrong length and handed to the verifier.
        let found = if literal {
            elements.len()
        } else {
            match &positions {
                Some(positions) => positions.len(),
                None => {
                    return Err(self.unsupported(
                        id,
                        "an `apply` whose list has no arity the compiler can see",
                    ));
                }
            }
        };
        if found != wanted {
            return Err(self.unsupported(id, "an `apply` whose list is not the callee's arity"));
        }

        let callee = self.closure_callee(id, member, function)?;
        let mut args = vec![function];
        let mut sources = Vec::new();
        if literal {
            for (at, element) in elements.iter().enumerate() {
                let value = match self.parameter_representation(id, at) {
                    Some(want) => self.lower_expecting(*element, &want)?,
                    None => self.lower_expression(*element)?,
                };
                args.push(self.coerce_to_parameter(
                    id,
                    at,
                    value,
                    *element,
                    self.read_type(*element),
                )?);
                sources.push((*element, self.read_type(*element)));
            }
        } else {
            let positions = positions.unwrap_or_default();
            let array = self.lower_expression(list)?;
            for (at, position) in positions.iter().enumerate() {
                let want = self
                    .represent(*position)
                    .ok_or_else(|| self.unrepresentable(list, "an `apply` list position"))?;
                let value = self.read_a_position(array, at, &want, list)?;
                args.push(self.coerce_to_parameter(id, at, value, list, Some(*position))?);
                sources.push((list, Some(*position)));
            }
        }
        let typed_references = self.known_reference_path(id, function, &args[1..]);
        self.argument_sources.insert(
            id,
            UniformArguments {
                sources,
                typed_references,
            },
        );
        self.finish_closure_call(id, function, Some(this), callee, args)
    }

    /// One position of an array being read out to fill a positional argument.
    ///
    /// **The read is at the array's element type, not at the position's.** A
    /// tuple whose positions disagree represents as an array of `Erased` --
    /// record 0285 -- so an `ArrayGet` typed at what the position *declares*
    /// claims a concrete object came out of an erased slot, and the verifier
    /// says so: `an array element read, expected Erased, found
    /// Managed(Object(..))`. Five addons stopped building on exactly that.
    ///
    /// The unerase afterwards is the same one `element_of` does for a tuple
    /// index, licensed the same way: the position's declared type says what is
    /// in that slot.
    pub(super) fn read_a_position(
        &mut self,
        array: ValueId,
        at: usize,
        want: &HirType,
        node: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        // **A tuple has two representations and this end knew one of them.** The
        // other end had the same gap, and the pair is why
        // `tests/programs/a-rest-tuple-stored-in-a-field-and-spread` held two arms
        // failing two ways: `tuple_representation` sends a tuple of mixed storage
        // widths to a struct -- `[string, number]` is a pointer beside a double,
        // and no array of one element width holds both -- so a spread of one
        // arrives here as `Managed(Object(ty))` and got a refusal whose sentence
        // is about arrays.
        //
        // Read by **field**, because that is what the layout is: `layout_of`'s own
        // comment says `[string, number]` *is* a two-field struct whose fields are
        // named `0`, `1` in position order, which is exactly the index this
        // function is given. So the position is the field and no mapping is
        // needed -- and asking the layout rather than assuming that is what keeps
        // this the same fact the builder writes.
        if let HirType::Managed(ManagedType::Object(tuple)) = self.values[array.0 as usize].ty {
            return self.read_a_struct_position(array, tuple, at, want, node);
        }
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[array.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(node, "a spread of something that is not an array"));
        };
        let origin = self.origin(node);
        #[allow(clippy::cast_precision_loss)]
        let index = at as f64;
        let index = self.push(OpKind::ConstFloat(index), HirType::NUMBER, origin.clone());
        let read = self.push(
            OpKind::ArrayGet {
                array,
                index,
                checked: true,
            },
            (*element).clone(),
            origin.clone(),
        );
        if *element == HirType::Erased && *want != HirType::Erased {
            return Ok(self.push(OpKind::unerase(read), want.clone(), origin));
        }
        Ok(read)
    }

    /// Which field of a tuple's struct holds position `at`, and what it holds.
    ///
    /// **One resolver for the two ends.** `gather_a_rest_into_a_struct` writes
    /// these positions and `read_a_struct_position` reads them, and a builder and
    /// a reader that each decide "the field index is the position" agree by
    /// coincidence -- which holds until one of them is edited. This is that
    /// decision, once, and it is made by *asking the layout* for the name
    /// `tuple_layout` gives position `at`.
    ///
    /// `_0` and not `0`, because the name reaches C as a struct member and `v->1`
    /// is not C. That spelling is `tuple_layout`'s and is stated in its own
    /// comment as free to change, which is the reason not to hard-code the index
    /// here: a tuple has no names of its own, so the only thing tying the two
    /// ends together is this function.
    pub(super) fn tuple_field_at(
        &mut self,
        node: NodeId,
        tuple: TypeId,
        at: usize,
    ) -> Option<(u32, HirType)> {
        let layout = self.layout_of(node, tuple).ok()?;
        let field = layout.index_of(&format!("_{at}"))?;
        let slot = layout.fields.get(field as usize)?.ty.clone();
        Some((field, slot))
    }

    /// One position of a tuple laid out as a struct, for
    /// [`Self::read_a_position`].
    fn read_a_struct_position(
        &mut self,
        object: ValueId,
        tuple: TypeId,
        at: usize,
        want: &HirType,
        node: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let Some((field, slot)) = self.tuple_field_at(node, tuple, at) else {
            return Err(self.unsupported(
                node,
                &format!("a spread reading position {at} of a tuple that is not laid out with it"),
            ));
        };
        let origin = self.origin(node);
        let read = self.push(
            OpKind::FieldGet { object, field },
            slot.clone(),
            origin.clone(),
        );
        if slot == HirType::Erased && *want != HirType::Erased {
            return Ok(self.push(OpKind::unerase(read), want.clone(), origin));
        }
        Ok(read)
    }

    /// The call itself, given the closure value already in hand.
    ///
    /// Separate because there are two ways to come by one. `f(x)` lowers the
    /// name; `o.f(x)` where `f` is a *field* has already lowered `o` and loaded
    /// the field out of it, and lowering the property access again would
    /// evaluate the receiver twice.
    ///
    /// `this` is the call's: `o` there, and `None`, for `undefined`, in `f(x)`.
    pub(super) fn call_through_closure(
        &mut self,
        id: NodeId,
        callee_node: NodeId,
        receiver: ValueId,
        this: Option<ValueId>,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let callee = self.closure_callee(id, callee_node, receiver)?;
        let mut args = vec![receiver];
        self.argument_sources
            .insert(id, UniformArguments::default());
        args.extend(self.lower_arguments_on(id, arguments, receiver)?);
        // Through a function type, the callee is any function of the type, so
        // the type's parameter kinds are what a call must fit -- which every
        // function of the type writes too (Q1). A direct call is obliged by
        // its callee's own parameters (`obligations`).
        for (position, (ty, _, rest)) in self.effective_parameters(id).into_iter().enumerate() {
            if rest {
                break;
            }
            let (Some(ty), Some(&value)) = (ty, args.get(position + 1)) else {
                continue;
            };
            if let Some(kind) = crate::hir::native::scalar(self.snapshot, ty) {
                self.oblige(
                    value,
                    kind,
                    crate::hir::obligations::Into::ClosureArgument { position },
                    id,
                );
            }
        }
        self.finish_closure_call(id, receiver, this, callee, args)
    }

    /// The tail every call of a function value shares, once its arguments are
    /// in hand.
    ///
    /// Split out because `apply` supplies its arguments as one already-built
    /// array rather than as a list of expressions, and the *rest* of a closure
    /// call -- the return type, the layout it needs, the op -- is the same
    /// either way. Two spellings of this would be two places to get
    /// `returned_by` wrong.
    fn finish_closure_call(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        this: Option<ValueId>,
        callee: ClosureEntry,
        args: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        // The callee's return where it has one. See `returned_by`: for `f?.(x)`
        // the expression's type carries an `undefined` the call cannot produce.
        let ty = self
            .returned_by(receiver)
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unrepresentable(id, "a call result"))?;
        // The result needs its layout as much as any other value does, and the
        // direct-call path already asks for one. Without this, a closure whose
        // return is *itself* a function produced a value of a type no layout
        // answered for, and the backend refused the whole function with
        // `NTS2006 an object type with no layout` -- a message about the type
        // and not about the call that made it.
        //
        // `sub: (c: number) => () => void` is the shape, and it is what
        // `EventListenerSignal.subscribe` is. Calling it was the trigger:
        // declaring the field, and even building one, were both fine, because
        // nothing until the call needed the returned signature to have a
        // class.
        self.materialize(id, &ty)?;
        self.call_a_closure_entry(id, callee, this, args, &ty)
    }

    /// Emit a call to a closure entry at `ty`, honouring the **uniform ABI** where the
    /// callee is one of the two uniform slots.
    ///
    /// Its own function because there were two spellings of a closure call and the
    /// second was wrong: `lower_sort_with` built the comparator's call itself, with the
    /// comparator's *written* arguments, while `closure_callee` had already chosen a
    /// uniform slot for it. The ordinary body survived only because
    /// `fields::devirtualize` rewrites a known class back to the written `#call`; the
    /// raising slot it does not rewrite, so C called through an entry of the wrong ABI
    /// and a sort did not order. One path, so a site cannot choose a slot and then
    /// ignore what the slot takes.
    ///
    /// `ty` is passed rather than read from the node, which is the only reason this is
    /// not simply `finish_closure_call`: a comparator's result is its own `number` and
    /// the node it hangs off is the `sort` call, whose type is the array.
    ///
    /// `args` is the closure and then the written arguments; `this` is the call's
    /// `this`, `None` for `undefined`. A uniform entry and a body that reads its
    /// own `this` take it, after the closure ([`crate::hir::UNIFORM_THIS`]); a
    /// written `#call` has none.
    pub(super) fn call_a_closure_entry(
        &mut self,
        id: NodeId,
        callee: ClosureEntry,
        this: Option<ValueId>,
        args: Vec<ValueId>,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let arguments = self.argument_sources.remove(&id).unwrap_or_default();
        let sources = arguments.sources;
        let ty = ty.clone();
        let origin = self.origin(id);
        if let Some(index) = arguments.typed_references {
            let mut args = args;
            let reads_this = self.closures.get(index).is_some_and(|info| info.reads_this);
            let name = if reads_this {
                let this = self.erased_this(this, id)?;
                args.insert(crate::hir::UNIFORM_THIS, this);
                receiving_call_name(index)
            } else {
                closure_names(index).1
            };
            return Ok(self.push(
                OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                    frame: None,
                },
                ty,
                origin,
            ));
        }
        // Through the erased entry, the site spells the one ABI it can: every
        // written argument erased and the answer unerased to what it reads. The
        // receiver is not one of them -- it is the closure object, and the entry
        // takes it at its own class, which is the one thing this site does know.
        //
        // `coerce` rather than a hand-rolled `Erase`, because an erasure carries
        // which absence it was (`OpKind::Erase`'s `absent`) and getting that from
        // the type alone is the mistake `absence_at_excluding` exists to prevent.
        // **Either uniform entry**, because the ABI is the one thing the two share:
        // `erased_call` builds both from the same `uniform_params` at the same
        // width, and the raising one differs only in what its body does with an
        // uncaught `throw`. Asking for one slot by name left a raising call passing
        // the *written* arguments to an entry declaring the uniform ones and
        // reading a concrete result where it returns `erased` -- which the probe
        // showed as `call.closure[2] %0(%0) : f64` against an entry returning
        // `erased`, and C would have compiled.
        let ClosureEntry(slot) = callee;
        // What a typed call here would pass, kept before anything is erased:
        // `type_signature_calls` makes this site one where every closure that
        // can arrive agrees with it. Only the ordinary entry -- a raising call
        // keeps the uniform raising one.
        let written = (Some(slot) == self.hierarchy.erased_call_slot)
            .then(|| args.clone())
            .filter(|args| this.is_none() && !args.is_empty());
        let width = self.hierarchy.erased_call_arity;
        let mut erased = Vec::with_capacity(width + crate::hir::UNIFORM_ARGUMENTS);
        let mut args = args.into_iter();
        erased.extend(args.next());
        let this = self.erased_this(this, id)?;
        erased.push(this);
        // More arguments than any closure in this program reads are dropped,
        // as JavaScript drops them; see [`Hierarchy::erased_call_arity`].
        for (position, arg) in args.take(width).enumerate() {
            erased.push(self.erase_uniform_argument(arg, id, sources.get(position).copied())?);
        }
        // Up to the entry's fixed arity, because this site does not know the
        // closure and so cannot know how many it declares. `undefined` is what
        // JavaScript hands an argument nobody passed, and it is what the entry
        // unerases for a parameter the caller left out.
        while erased.len() < width + crate::hir::UNIFORM_ARGUMENTS {
            erased.push(self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone()));
        }
        let answered = self.push(
            OpKind::Call {
                callee: Callee::Closure { slot },
                args: erased,
                frame: None,
            },
            HirType::Erased,
            origin.clone(),
        );
        // **The flag test, before anything reads the answer.** A direct call gets
        // this from `push_call`; a dispatch does not go through it, so the entry
        // recorded the `throw` and the caller carried on with a value that has the
        // right width and no meaning. `test_for_a_raise` is a no-op unless
        // `lower_try` recorded this call, and it leaves the builder in the
        // carry-on block -- so the read-back below is on the path where nothing
        // was raised, which is the reason it is here and not after it.
        self.test_for_a_raise(id);
        // The answer, read back at what this site expects.
        //
        // An explicit `Unerase` rather than `coerce`, and the difference is a
        // licence rather than a spelling: `coerce` from `Erased` to a concrete
        // type is the *narrowing* path, which refuses without a test proving what
        // arrived -- "an erased value where a concrete representation is wanted".
        // Here nothing needs proving. This site asked for the erased ABI one line
        // above; unerasing the answer is the inverse of its own request, and the
        // type is what the checker gave the call. It is the same entitlement any
        // typed read has and no more.
        let value = match &ty {
            // Nothing to read back. An erased site wanted the erased answer, and
            // a `void` one discards it -- the entry returned `undefined` there,
            // which is what makes the two one arm rather than two spellings.
            HirType::Erased | HirType::Void => answered,
            // The call cannot return normally. test_for_a_raise has already
            // closed that path, so only a dead placeholder, never the erased
            // result, participates in lowering the rest of the expression.
            HirType::Never => self.push(OpKind::ConstUndefined, HirType::Never, origin),
            _ => self.push(OpKind::unerase(answered), ty.clone(), origin),
        };
        if let Some(args) = written
            && let HirType::Managed(ManagedType::Object(signature)) =
                self.values[args[0].0 as usize].ty
        {
            self.arrivals.pending_sites.push(UniformSite {
                function: String::new(),
                signature,
                answered,
                value,
                args,
                ty,
            });
        }
        Ok(value)
    }

    /// Preserve literal absence as an argument enters the erased uniform ABI.
    /// The written signature can type an omitted argument as a callback or a
    /// string; that representation must not give its `undefined` a new tag.
    /// This is a call-argument rule: generic coercion must keep a typed null
    /// placeholder in its managed slot, including through `unknown` assertions.
    pub(super) fn erase_uniform_argument(
        &mut self,
        value: ValueId,
        id: NodeId,
        source: Option<(NodeId, Option<TypeId>)>,
    ) -> Result<ValueId, Diagnostic> {
        // Its tag is already correct; retain the value rather than relocating
        // a literal's temporary when the uniform ABI needs no conversion.
        if self.values[value.0 as usize].ty == HirType::Erased {
            return Ok(value);
        }
        match self.values[value.0 as usize].kind {
            OpKind::ConstUndefined => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstUndefined, HirType::Erased, origin))
            }
            OpKind::ConstNull => {
                let origin = self.origin(id);
                Ok(self.push(OpKind::ConstNull, HirType::Erased, origin))
            }
            _ => {
                let source_node = source.map_or(id, |(node, _)| node);
                let erased = self.coerce_from(value, &HirType::Erased, id, source_node)?;
                if crate::hir::tags::payload_is_a_reference(&self.values[value.0 as usize].ty)
                    && let Some((_, Some(ty))) = source
                    && let OpKind::Erase { absent, .. } = &mut self.values[erased.0 as usize].kind
                {
                    let ty = self.sources.get(&ty).copied().unwrap_or(ty);
                    *absent = absent_of_result(self.snapshot, ty);
                }
                Ok(erased)
            }
        }
    }

    /// Refused where a call through a member holds no object to pass as its
    /// `this` -- an `o.f?.()` whose read of `o.f` recorded none
    /// ([`Self::read_from`]: a static, a namespace member), and an `ObjC` field
    /// call -- and some `function` in the program reads its own `this`, which
    /// `undefined` would then silently replace. A program with no such
    /// function cannot observe the difference, and before
    /// `docs/records/notebooks/function-receivers.md` step 2 a program with one did not compile
    /// at all, so this narrows nothing that compiled.
    pub(super) fn check_this_is_passed(&self, id: NodeId) -> Result<(), Diagnostic> {
        if self.closures.iter().any(|info| info.reads_this) {
            return Err(self.unsupported(
                id,
                "a call through a member that does not yet pass the object as `this` \
                 (`o.f?.()`, or an ObjC field), in a program where a `function` reads its own \
                 `this`",
            ));
        }
        Ok(())
    }

    /// Whether a callback written at the call may have its body lowered in
    /// place, as `forEach` and `map` lower an arrow's, rather than called.
    ///
    /// **Not a `function` that reads its own `this`.** Lowered in place, its
    /// `this` read the enclosing one -- a method's object, where JavaScript
    /// passes `undefined` to a callback given no `thisArg` -- silently, and it
    /// did so before such a function compiled anywhere else, because this path
    /// never asked. Called, it gets the `this` the call passes.
    pub(super) fn inlines_as_a_callback(&self, callback: NodeId) -> bool {
        match self.kind_of(callback) {
            Some(syntax::ARROW_FUNCTION) => true,
            Some(syntax::FUNCTION_EXPRESSION) => !self.binds_this(callback),
            _ => false,
        }
    }

    /// A call's `this` as an entry that takes one takes it: erased, and
    /// `undefined` where the call has none.
    fn erased_this(&mut self, this: Option<ValueId>, id: NodeId) -> Result<ValueId, Diagnostic> {
        if let Some(this) = this {
            return self.coerce(this, &HirType::Erased, id);
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstUndefined, HirType::Erased, origin))
    }
}
