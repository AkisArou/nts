//! Lower generator and iterator-result operations, including async steps, generator dispatch, and value-presence checks.

use super::{
    BinOp, Callee, Diagnostic, FuncBuilder, GeneratorKind, HirType, Layout, ManagedType, NodeId,
    OpKind, Origin, PropertyKey, SemanticSnapshot, TypeId, TypeKind, ValueId, Walk,
    abstract_generator_kind, provided, syntax, without_the_raising_suffix,
};

/// The element type of an `IteratorResult<T, …>`, where this type is one.
///
/// Recognised **by name**, deliberately, and the reason is the one
/// `decompose.rs` gives for its own name list: "a rule like *carry any library
/// interface whose members are representable* is the version that sounds
/// principled and pulls the graph in through the first type whose members
/// happen to qualify; a name is a decision that can be read."
///
/// Both spellings arrive. A `next()` annotated `IteratorResult<T>` returns the
/// union of the two arms, and one annotated `IteratorYieldResult<T>` returns a
/// single arm — so this answers for the union and for either arm alone, and the
/// element comes from whichever arm yields, because the return arm's `value` is
/// `TReturn` and gets no slot.
pub(super) fn iterator_result_element(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<TypeId> {
    fn value_of(snapshot: &SemanticSnapshot, arm: TypeId) -> Option<TypeId> {
        let TypeKind::Object { properties } = &snapshot.types.get(arm.0 as usize)?.kind else {
            return None;
        };
        properties
            .iter()
            .find(|property| property.name.is_name("value"))
            .map(|property| property.ty)
    }
    let record = snapshot.types.get(ty.0 as usize)?;
    match &record.kind {
        // The union. Every member has to be one of the two arms, so that a
        // wider union that merely contains them is not mistaken for one.
        TypeKind::Union(members) => {
            let mut yielded = None;
            for member in members {
                match provided(snapshot, *member) {
                    Some("IteratorYieldResult") => yielded = value_of(snapshot, *member),
                    Some("IteratorReturnResult") => {}
                    _ => return None,
                }
            }
            yielded
        }
        // The yield arm alone, which is what a `next()` annotated
        // `IteratorYieldResult<T>` returns. The *return* arm alone is not
        // provided for: it yields nothing, so there is no element to name, and
        // its `value` is the `TReturn` that gets no slot — a `next()` that can
        // only finish is a shape nothing in the corpus writes, and refusing it
        // says so rather than inventing an element type.
        TypeKind::Object { .. } if provided(snapshot, ty) == Some("IteratorYieldResult") => {
            value_of(snapshot, ty)
        }
        _ => None,
    }
}

/// Can a value of this type be a *finished* iterator result?
///
/// The union can, and its `value` is therefore only readable where something
/// has ruled the return arm out. The yield arm alone cannot: its `done` is
/// `false` by declaration, so its `value` is the element and reading it needs
/// no proof at all.
///
/// **This is the whole guard**, and the reason there is no new analysis behind
/// it: TypeScript narrows `IteratorResult<T>` by `done` itself, so inside
/// `if (!r.done)` the checker has already replaced the union with the yield
/// arm. Asking the narrowed type is asking the language's own rule rather than
/// a second, weaker derivation of it -- which is what a `flow.rs` relation on
/// the `done` field would have been, and it would have disagreed with the
/// checker the first time the two were spelled differently.
fn may_be_a_finished_iterator_result(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    iterator_result_element(snapshot, ty).is_some()
        && matches!(
            snapshot.types.get(ty.0 as usize).map(|record| &record.kind),
            Some(TypeKind::Union(_)),
        )
}

impl FuncBuilder<'_> {
    /// One turn of the iteration protocol: the call that advances the iterator,
    /// and the `done` it answered with.
    ///
    /// One step of an `async function*`, which is a promise made and awaited.
    ///
    /// A synchronous generator's step is one call that answers `done`. This is
    /// four things, and the shape is forced by there being **no caller standing
    /// in front of the resumption** once it awaits:
    ///
    /// ```text
    ///   p = nts_promise_new()      the promise for this step
    ///   frame.result = p           where the resumption will find it
    ///   retain frame               the resumption may hand it to the runtime
    ///   resume(frame)              runs until it yields, awaits, or finishes
    ///   done = await p != 0        the suspension, in *this* function's frame
    /// ```
    ///
    /// The `await` is an ordinary [`OpKind::Await`] in the enclosing `async`
    /// function, so the loop's own suspension machinery is the one that already
    /// works -- this adds no second mechanism for waiting.
    ///
    /// **The element does not ride the promise.** It is left in `yielded`, and
    /// the body reads it from the frame exactly as a synchronous generator's
    /// body does, so an async walk allocates one promise per step and no
    /// `{ value, done }` object ever.
    ///
    /// The retain mirrors the entry of an ordinary `async` function: a
    /// resumption that suspends leaves the frame with the runtime, which holds
    /// it until the subscription fires, and `give_the_frame_back` returns the
    /// reference at every exit that is not a suspension -- each `yield`
    /// included, because a yield ends the step.
    fn async_generator_step(
        &mut self,
        id: NodeId,
        frame: ValueId,
        resume: Callee,
        origin: &Origin,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        if self.async_result.is_none()
            && !self
                .generator
                .as_ref()
                .is_some_and(|frame| frame.kind == GeneratorKind::Async)
        {
            return Err(self.unsupported(
                id,
                "a `for await` outside an `async` function, whose step has nowhere to suspend",
            ));
        }
        let promise = self.push(
            OpKind::Call {
                callee: Callee::External("nts_promise_new".to_owned()),
                args: Vec::new(),
                frame: None,
            },
            crate::hir::suspend::step_promise(),
            origin.clone(),
        );
        self.push(
            OpKind::FieldSet {
                object: frame,
                field: crate::hir::suspend::FIELD_STEP_RESULT,
                value: promise,
            },
            HirType::Void,
            origin.clone(),
        );
        self.push(OpKind::Retain(frame), HirType::Void, origin.clone());
        self.push(
            OpKind::Call {
                callee: resume,
                args: vec![frame],
                frame: None,
            },
            HirType::Void,
            origin.clone(),
        );
        let settled = self.push(
            OpKind::Await {
                promise,
                rejects_to: None,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.record_rejection(settled);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let done = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: settled,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        Ok((frame, done))
    }

    /// Both come from a single `next()`, and the result is handed back so the
    /// body can read the element out of the same one.
    pub(super) fn protocol_step(
        &mut self,
        id: NodeId,
        walk: &Walk,
        origin: &Origin,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        if let Walk::Generator {
            frame,
            resume,
            asynchronous: true,
            ..
        } = walk
        {
            return self.async_generator_step(id, *frame, resume.clone(), origin);
        }
        if let Walk::Generator {
            frame,
            resume,
            raises,
            ..
        } = walk
        {
            let (frame, resume, raises) = (*frame, resume.clone(), *raises);
            // The frame is the state and the resumption is the step, so this is
            // one call and no loads. It answers `done`; the element it left
            // behind is read in the body, off the same frame.
            let answered = self.push(
                OpKind::Call {
                    callee: resume,
                    args: vec![frame],
                    frame: None,
                },
                HirType::Bool,
                origin.clone(),
            );
            // **A raising resumption records the `throw` and answers `done`**, so a step that
            // does not test the flag reads the raise as the end of the sequence: the loop
            // exits normally, the handler never runs, and the flag stays set for the next
            // `nts_raising()` anywhere in the program to misread.
            //
            // Here rather than at the loop that calls this, because every walk's step comes
            // through this function and the test belongs immediately after the call that may
            // set the flag -- the same placement `test_for_a_raise` has after an ordinary
            // call, and the same reason: between the call and anything that branches on its
            // result.
            if raises {
                self.emit_the_raise_test(origin);
            }
            return Ok((frame, answered));
        }
        let Walk::Protocol {
            iterator,
            next,
            next_raises,
            result,
            done,
            ..
        } = walk
        else {
            return Err(self.unsupported(id, "a `for...of` with no cursor and no iterator"));
        };
        let (iterator, next, result, done, raises) =
            (*iterator, next.clone(), result.clone(), *done, *next_raises);
        let step = self.push(
            OpKind::Call {
                callee: next,
                args: vec![iterator],
                frame: None,
            },
            result,
            origin.clone(),
        );
        if raises {
            self.implicit_raise_test(id, origin)?;
        }
        let answered = self.push(
            OpKind::FieldGet {
                object: step,
                field: done,
            },
            HirType::Bool,
            origin.clone(),
        );
        Ok((step, answered))
    }

    /// Whether a type is a generator frame, and what it yields.
    ///
    /// Named beside [`Self::generator_element`] rather than folded into it
    /// because the question differs: that one is handed a frame's type id and
    /// asks what it yields, and this one is handed *any* representation and asks
    /// whether it is a frame at all.
    pub(super) fn generator_element_of(&self, ty: &HirType) -> Option<HirType> {
        let HirType::Managed(ManagedType::Object(frame)) = ty else {
            return None;
        };
        self.generator_element(*frame)
    }

    /// A generator's frame, and what stepping it looks like.
    ///
    /// The frame is already here -- calling the generator made it, and calling
    /// one runs none of the body -- so unlike [`Self::protocol_walk`] this
    /// builds nothing. What it has to find is the *name* of the resumption,
    /// which does not exist yet: [`crate::hir::suspend`] splits the generator into
    /// an entry and a resumption long after this runs. The name is derived from
    /// the generator's, and the generator is whatever call produced this value.
    ///
    /// A generator walked **anywhere but where it was made** therefore has no
    /// name to take, and is not refused: the frame itself knows which body to
    /// resume, so [`Self::generator_dispatch`] reads the slot the abstract
    /// generator declares. A parameter, a field and a call that returned one all
    /// go that way. This paragraph said that case was "refused, by name" for as
    /// long as the dispatch had existed, which is the failure record 0161 is
    /// about: a true sentence goes false when the code beside it moves, and
    /// nothing checks a comment.
    ///
    /// So the *only* thing the direct path needs is certainty that the call it
    /// is naming is the generator's own. `self.generator_calls` carries that,
    /// and the op does not -- see the field. Guessing from the op emitted a call
    /// to `make__resume` for a plain `make` that merely handed a generator back.
    pub(super) fn generator_walk(
        &mut self,
        sequence: NodeId,
        value: ValueId,
    ) -> Result<Walk, Diagnostic> {
        let HirType::Managed(ManagedType::Object(frame)) = self.values[value.0 as usize].ty else {
            unreachable!("the caller matched an object type");
        };
        // Cloned so the borrow of `values` ends here: building the indirect
        // dispatch needs `&mut self`, because naming the slot may have to lay
        // the abstract generator out.
        let made_here = match &self.values[value.0 as usize].kind {
            OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } if self.generator_calls.contains(&value) => Some(name.clone()),
            _ => None,
        };
        // **Whether the resumption this names is a raising one**, through the one strip
        // [`without_the_raising_suffix`] exists to be.
        //
        // The creating call carries `@raises` exactly where [`Self::raising_suffix_of`] put
        // it: the generator function has a raising copy *and* this site is guarded or sits
        // in a raising body. Creating a frame cannot itself raise -- the body has not run --
        // so the suffix there is harmless, and it is also the only thing at this point that
        // knows both of those facts. So the resumption inherits it, deliberately now rather
        // than by accident, and the **step** is what tests the flag.
        let raises = made_here
            .as_deref()
            .is_some_and(|name| !without_the_raising_suffix(name).1.is_empty());
        let resume = match made_here {
            // Made **here**, so the resumption is known and the call is direct.
            //
            // Not an optimisation applied afterwards. On ART there is no inline
            // cache and no free monomorphic case -- a virtual call is 1.88x to
            // 2.06x a field read whether one class implements it or three -- and
            // this call is on the hot path of every element of every walk. The
            // indirect form is for the case that cannot be answered statically,
            // not a uniform replacement for this one.
            Some(name) => Callee::Direct(crate::hir::suspend::resume_name(&name)),
            // Arrived from somewhere else -- a parameter, a field, a call that
            // returned one. The frame knows which body to resume even though
            // this call site does not, so the slot the abstract generator
            // declares answers it.
            //
            // **And that slot holds the ordinary resumption, so a guarded step through it
            // cannot carry a `throw`.** The frame's body ends the program on an uncaught one
            // where the handler here would have caught it:
            // `outcomes/a-generator-passed-in-and-stepped-inside-a-try-ends-the-program`, the
            // JVM lane's, whose `sumOf(upTo(limit))` crosses a parameter. Refused by name
            // rather than left to end the program, which is the raising row's own rule where a
            // raise cannot be carried.
            //
            // **A raising resume slot is the fix and is deliberately not built**, measured
            // rather than argued: the slot would be a *fifth* uniform index -- a word per
            // descriptor in every program, on `raising_call_slot`'s terms, and ungated for the
            // same reason its doc gives (a syntactic probe cannot be sound here, because which
            // bodies get copies is decided in `naming`, after this). And `runtime/node` makes
            // **zero** indirect generator steps: `stream`, `fs`, `readline` and `util` emit no
            // `call.virtual[..] Generator*#resume` and no `@raises__resume` at all. So the slot
            // would be width paid for a dispatch the corpora never make, and the refusal costs
            // them nothing. The JVM lane cleared the design and it is in the plan; what it
            // waits on is a population that dispatches there.
            None if self.a_handler_in_this_function_would_catch() => {
                return Err(self.unsupported(
                    sequence,
                    "a `for...of` inside a `try` over a generator this site did not make -- it \
                     arrived as a parameter, a field or another call's result, so the step \
                     dispatches at the resumption slot, which holds the ordinary body, and a \
                     `throw` from it would end the program rather than reach this handler",
                ));
            }
            None => self.generator_dispatch(sequence, frame)?,
        };
        let Some(layout) = self.generator_element(frame) else {
            return Err(self.unsupported(sequence, "a generator whose element was not reserved"));
        };
        // **A generator with no `yield` in it has element `never`**, and the
        // walk reads the frame's `yielded` slot inside the loop body -- a body
        // that can never run, since the resumption answers `done` immediately.
        // The read is still *emitted*, and a value of type `never` reaching
        // code generation is **invalid HIR**: `emit-c` prints `refusing to emit
        // code from invalid HIR`, writes nothing and exits 0.
        //
        // Refused by name instead. That is strictly better than what stood
        // here -- a program that produced no output and no diagnostic naming
        // the construct -- and it is the honest shape of the gap: nothing can
        // be read out of an uninhabited slot, and giving it a width here would
        // disagree with the field `suspend.rs` actually built (measured:
        // `expected Int { bits: 32 }, found Float { bits: 64 }`).
        // From the *type*, which is where the answer already is: a concrete
        // frame names the abstract generator it extends, and that is either a
        // `Generator<T, …>` or an `AsyncGenerator<T, …>`. Reading the loop's
        // `await` keyword instead would be a second derivation of a fact the
        // declaration settled, and the two would disagree exactly where it
        // matters -- `for await` over a synchronous generator is legal.
        let asynchronous = abstract_generator_kind(
            self.snapshot,
            self.generator_declared(frame).unwrap_or(frame),
        ) == Some(GeneratorKind::Async);
        Ok(Walk::Generator {
            frame: value,
            resume,
            element: layout,
            asynchronous,
            raises,
        })
    }

    /// What the `n`th generator yields, from the reservation the lowering made.
    ///
    /// The frames are handed out in source order, so the id says which
    /// generator this is; asking the frame's *layout* would not work, because
    /// [`crate::hir::suspend`] has not built one yet.
    /// **Total, and it was not.** The subtraction assumed the argument *is* a
    /// frame, which every caller satisfied by having matched on one first --
    /// until `generator_element_of` asked the question of any object type at
    /// all, which is the whole point of that helper. An ordinary object's id is
    /// below the frame range, so it underflowed.
    ///
    /// In release it wrapped to a number no reservation matches and the `find`
    /// answered `None`, which is the right answer by accident. The gate's
    /// overflow-checked build said so; `cargo test --release` cannot.
    /// What a generator's frame holds in its `yielded` slot.
    ///
    /// **`never` is answered truthfully**, and a reader that cannot store one
    /// deals with it. Mapping it to a number here was tried and is wrong: the
    /// frame's slot type is decided by `suspend.rs` from the generator's
    /// `yield`s, so a different answer here disagrees with the field that
    /// actually exists -- `expected Int { bits: 32 }, found Float { bits: 64 }`
    /// in a `module#init` that had inlined the walk.
    ///
    /// `function* g() {}` walked by a `for...of` reads this slot before testing
    /// whether there is anything in it, and a `never` reaching code generation
    /// is invalid HIR. That is **not new** -- it predates the `next()` work,
    /// and both compilers refuse the same program -- and it is recorded rather
    /// than half-fixed here. `generator_next` handles its own case, where the
    /// result object's slot is the compiler's own and can hold a zero.
    fn generator_element(&self, frame: TypeId) -> Option<HirType> {
        // A concrete frame names its declaration; the abstract generator *is*
        // the declaration, and carries the same type argument directly.
        let declared = self.generator_declared(frame).unwrap_or(frame);
        let argument = *self
            .snapshot
            .type_arguments
            .get(&declared)
            .and_then(|arguments| arguments.first())?;
        Some(crate::hir::suspend::yielded_slot(self.represent(argument)?))
    }

    /// How to resume a generator this call site did not make.
    ///
    /// The receiver is typed as the abstract generator — that is what a
    /// parameter declared `Generator<T, …>` holds — so the slot it declares is
    /// the dispatch, and the name it declares gives the call its signature. Both
    /// come from the layout rather than being rebuilt here, because a slot
    /// numbered twice is a slot two places must agree about.
    /// `g.next()` where `g` is a generator the program is holding.
    ///
    /// **A generator value is a frame, and a frame has no `next`.** It is
    /// *resumed*: the resumption answers whether it produced anything and
    /// leaves the element in the frame's `yielded` slot -- which
    /// `a-generator-method` recorded as "exactly the two halves of an
    /// `IteratorResult`, so what is missing is not the step but the object".
    /// The object arrived on 2026-09-19, so this is the step it was missing.
    ///
    /// `value` is stored unconditionally, from `yielded`. When the generator is
    /// finished that slot holds whatever it last left there -- and nothing can
    /// read it, because `refuse_unguarded_iterator_value` permits `.value` only
    /// where the checker has ruled the finished arm out. The same guarantee the
    /// `{ done: true, value: undefined }` zero rests on, reached from the other
    /// side.
    ///
    /// **An argument is refused.** `g.next(v)` resumes the suspended `yield`
    /// *with* `v`, which the resumption's signature has no parameter for;
    /// dropping it would be a wrong answer rather than a missing one.
    pub(super) fn generator_next(
        &mut self,
        id: NodeId,
        frame: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !arguments.is_empty() {
            return Err(self.unsupported(
                id,
                "a `next(v)` that sends a value into a generator, which its resumption has no \
                 parameter for",
            ));
        }
        // **Through `generator_walk`, not through a second copy of it.** It is
        // what decides whether the resumption is named directly -- a frame made
        // by a call in this function -- or dispatched through a slot, and
        // asking that question again here got it wrong: `generator_dispatch`
        // wants a *layout* for the frame, and a frame made here has a synthetic
        // type the snapshot has never heard of, so `const g = upto(n);
        // g.next()` refused with `an object type that is not in the snapshot`.
        let Walk::Generator {
            resume,
            element,
            asynchronous,
            ..
        } = self.generator_walk(member, frame)?
        else {
            return Err(self.unsupported(id, "a generator whose walk is not a frame"));
        };
        if asynchronous {
            return Err(self.unsupported(
                id,
                "a `next()` on an async generator, whose result is a promise",
            ));
        }
        let Some(HirType::Managed(ManagedType::Object(result))) = self.type_of(id) else {
            return Err(self.unrepresentable(id, "a `next()` result"));
        };
        let layout = self.layout_of(id, result)?;
        if !self.is_a_provided_iterator_result(&layout) {
            return Err(self.unsupported(id, "a `next()` whose result is not an `IteratorResult`"));
        }

        let origin = self.origin(member);
        // **The resumption answers `done`, not "produced a value".** Taken from
        // `walk_condition`, which runs a generator loop while `!at` where `at`
        // is exactly this call's result -- so a `Not` here inverts it. The
        // emitted resumption agrees: it sets the frame's state to `-1` and
        // returns `true` on the path that finishes.
        let done = self.push(
            OpKind::Call {
                callee: resume,
                args: vec![frame],
                frame: None,
            },
            HirType::Bool,
            origin.clone(),
        );
        // **The same fact `begin_generator` refuses, said at the call.** That
        // refusal fires while lowering the *generator*; this is a different
        // function, and `generator_element` answers from the type argument
        // rather than from whether the generator was accepted -- so a `next()`
        // built the read anyway and stored a `never` into the result's slot:
        // `StoreType { expected: Int { bits: 32 }, found: Never }`.
        if matches!(element, HirType::Never) {
            return Err(self.unsupported(
                id,
                "a `next()` on a generator that yields nothing, whose frame has no element slot \
                 to answer with",
            ));
        }
        let yielded = self.push(
            OpKind::FieldGet {
                object: frame,
                field: crate::hir::suspend::FIELD_YIELDED,
            },
            element,
            origin.clone(),
        );
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(result)),
            origin.clone(),
        );
        self.field_set(object, 0, done, &origin);
        let value = self.coerce(yielded, &layout.fields[1].ty.clone(), member)?;
        self.field_set(object, 1, value, &origin);
        Ok(object)
    }

    fn generator_dispatch(&mut self, id: NodeId, ty: TypeId) -> Result<Callee, Diagnostic> {
        let slot = self
            .hierarchy
            .generator_slot
            .ok_or_else(|| self.unsupported(id, "a generator walked in a program with none"))?;
        let layout = self.layout_of(id, ty)?;
        let declared = layout
            .methods
            .get(slot as usize)
            .cloned()
            .flatten()
            .ok_or_else(|| {
                self.unsupported(id, "a `for...of` over a value that is not a generator")
            })?;
        Ok(Callee::Virtual { slot, declared })
    }

    /// The abstract generator a frame extends: the `Generator<T, …>` the
    /// declaration wrote, or that the checker gave an unannotated `function*`
    /// -- or its context's ([`Self::generator_in_context`]).
    ///
    /// The same walk [`Self::generator_element`] needs one step earlier, so it
    /// is one function rather than two that must keep agreeing about which
    /// declaration a frame id belongs to.
    ///
    /// Answers `None` for any id that is not a generator frame, which is what
    /// makes it usable as a question rather than an assertion --
    /// `laid_out_as_a_prefix` asks it of every object type it meets.
    pub(super) fn generator_declared(&self, frame: TypeId) -> Option<TypeId> {
        let which = frame
            .0
            .checked_sub(crate::hir::SYNTHETIC_GENERATOR_FRAMES)? as usize;
        let node = self
            .generators
            .iter()
            .find(|(_, index)| **index == which)
            .map(|(node, _)| *node)?;
        let ty = self.snapshot.node_types.get(&node).copied()?;
        let TypeKind::Function(signature) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let own = self
            .snapshot
            .signatures
            .get(signature.0 as usize)?
            .return_type;
        Some(self.generator_in_context(node, own))
    }

    /// The abstract generator the generator `node` extends, given the one its
    /// own signature returns: its context's, where that is one of the same
    /// kind.
    ///
    /// **The context first.** `type Make = () => Generator<number>` is
    /// `Generator<number, any, any>`, and a closure stored as one is typed from
    /// its body as `Generator<number, void, any>`: two abstract generators, two
    /// layouts. A frame extending its own would be returned through `Make`
    /// typed as the other, whose resumption no frame overrides. So where the
    /// context names an abstract generator of the closure's kind
    /// ([`Self::contextual_return_type`]), the frame extends that one, and the
    /// shell, the frame and every call agree. It is the wider type, which the
    /// checker accepted the closure as: each `yield` is coerced to its element
    /// and the completion and `next`'s argument are the context's. A
    /// `function*` declaration has no context, and keeps its own.
    ///
    /// One answer for the frame being built (`begin_generator`) and every
    /// reader of a built one ([`Self::generator_declared`]): the two disagreeing
    /// is a frame extending one generator while its readers name another.
    pub(super) fn generator_in_context(&self, node: NodeId, own: TypeId) -> TypeId {
        let kind = abstract_generator_kind(self.snapshot, own);
        self.contextual_return_type(node)
            .filter(|context| {
                kind.is_some() && abstract_generator_kind(self.snapshot, *context) == kind
            })
            .unwrap_or(own)
    }

    /// The name and the value, with the value built at `want` where the caller
    /// knows the slot. A table literal passes `None`: its values are erased on
    /// the way in and there is no declared field to build one at.
    /// Is this the `value` of an object literal spelling `{ done: true, ... }`?
    ///
    /// Syntactic on purpose. The question is not what the checker makes of the
    /// literal -- it types it `IteratorReturnResult<any>`, and `any` is refused
    /// here -- but what the author wrote, which is a slot that says nothing
    /// beside a `done` that says so.
    ///
    /// Narrow on purpose too. It asks for the literal `true`, not for a value
    /// that happens to be `true`: a `done` computed at runtime leaves the
    /// arm undecided, and the honest answer there is today's refusal.
    pub(super) fn is_iterator_return_arm(
        &self,
        literal: NodeId,
        layout: &Layout,
        name: &PropertyKey,
    ) -> bool {
        if !name.is_name("value") || !self.is_a_provided_iterator_result(layout) {
            return false;
        }
        self.children(literal).iter().any(|property| {
            let children = self.children(*property);
            let [key, initializer] = children.as_slice() else {
                return false;
            };
            self.node(*key)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                == Some("done")
                && self.kind_of(*initializer) == Some(syntax::TRUE_KEYWORD)
        })
    }

    /// The layout an `IteratorResult<T>` gets, which nothing decomposes.
    ///
    /// **Provided rather than read**, the way `builtin::error_fields` is and for
    /// the reason that header gives: the two arms carry an optional property,
    /// `done?: false`, and an optional property needs a presence bit -- which
    /// changes a layout rather than adding to it. Providing one means neither
    /// arm is ever decomposed, so the modifier is never seen; and `TReturn`
    /// never gets a slot, so the `any` it defaults to never reaches HIR.
    ///
    /// Per instantiation, unlike `Error`'s: the element comes from the yield
    /// arm, so `IteratorResult<number>` and `IteratorResult<string>` are two
    /// layouts and two names.
    ///
    /// `None` when this is not one, which is not the same as `Some(Err(..))` --
    /// a type this recognises but cannot represent the element of is a refusal,
    /// not a fall-through to the ordinary path.
    /// Whether a layout is one [`Self::provided_iterator_layout`] made.
    ///
    /// **Asked of the type, not of the name.** The name was the test until
    /// 2026-09-20, and it could not stay one: a provided layout is per
    /// instantiation, so its name has to distinguish `IteratorResult<Buffer[]>`
    /// from `IteratorResult<unknown>` -- and a name that distinguishes them
    /// cannot also be a constant to compare against. One string was doing two
    /// jobs and the jobs pull in opposite directions.
    ///
    /// `Layout::types` carries the instantiation this layout was built for, and
    /// `iterator_result_element` is the predicate the provider itself asks, so
    /// the two cannot drift.
    pub(super) fn is_a_provided_iterator_result(&self, layout: &Layout) -> bool {
        layout
            .types
            .first()
            .is_some_and(|ty| iterator_result_element(self.snapshot, *ty).is_some())
    }

    pub(super) fn provided_iterator_layout(
        &mut self,
        id: NodeId,
        ty: TypeId,
    ) -> Option<Result<Layout, Diagnostic>> {
        let element = iterator_result_element(self.snapshot, ty)?;
        Some((|| {
            let value = self
                .represent(element)
                .ok_or_else(|| self.unrepresentable(id, "an iterator's element"))?;
            // **An uninhabited yield arm still needs a slot.** A generator with
            // no `yield` in it has element `never`, so `IteratorYieldResult<never>`
            // can never be constructed and `next()` can only answer
            // `{ done: true }` -- but a layout has a fixed shape, so the slot
            // exists and has to have a width.
            //
            // The same decision as the zero this layout already stores for the
            // finished arm, and it rests on the same guarantee:
            // `refuse_unguarded_iterator_value` permits a `.value` read only
            // where the checker has ruled the finished arm out, and for a
            // `never` element that narrowing gives a value of type `never`
            // which no program can then use. Without this the field was
            // `HirType::Never` and the read of it was **invalid HIR** --
            // `a value of type \`never\` reached code generation`.
            let value = crate::hir::suspend::yielded_slot(value);
            self.materialize(id, &value)?;
            let layout = Layout {
                types: vec![ty],
                // **Per instantiation, so the name has to be too.**
                // `iterator_result_element` gives a different element for
                // `IteratorResult<Buffer[]>` and `IteratorResult<unknown>`, so the
                // two layouts differ -- and both were named by the bare constant,
                // which the C emitter turns into a struct name. That is two
                // `struct NtsObj_IteratorResult` definitions in one translation
                // unit:
                //
                //   error: redefinition of 'NtsObj_IteratorResult'
                //   error: static assertion failed ... sizeof(...) == 48
                //
                // `http` and `process` both stopped building on it, and neither is
                // a shape any example carries. `Type{id}` is what every anonymous
                // layout is already distinguished by and it is unique by
                // construction.
                name: format!("{}{}", crate::hir::builtin::ITERATOR_RESULT, ty.0),
                interfaces: Vec::new(),
                fields: crate::hir::builtin::iterator_result_fields(value),
                methods: vec![None; self.hierarchy.table_size()],
                base: None,
            };
            self.layouts.push(layout.clone());
            Ok(layout)
        })())
    }

    /// May `value` be read off an iterator result here?
    ///
    /// `IteratorResult<T>`'s `value` is `T` on the yield arm and `TReturn` --
    /// `undefined` in every ordinary spelling -- on the return arm, and the
    /// layout provided for it has one slot with one representation. A finished
    /// result therefore holds that representation's zero, and a read is only
    /// answerable where the finished arm has been ruled out.
    ///
    /// Refused by name otherwise. That is strictly better than what stood here
    /// before -- the whole type was unrepresentable, so `for...of` over a
    /// hand-written iterator refused too -- and it is the difference between a
    /// construct this compiler declines and one it answers `0` for.
    ///
    /// **Two callers, because two paths reach the slot.** `member_of` lowers
    /// `r.value`, and `read_for_pattern` lowers `const { value } = r`. Written
    /// once, at the first, the second still read the zero: `probe.sh` had node
    /// answering `undefined` and this compiler answering `0` for a destructured
    /// `value` off a finished result, with the refusal already in the tree and
    /// looking like it covered the question.
    ///
    /// `protocol_step` needs no call: it builds its `FieldGet` directly on the
    /// edge where `done` is false, which is the proof by construction.
    pub(super) fn refuse_unguarded_iterator_value(
        &self,
        at: NodeId,
        receiver: ValueId,
        name: &str,
    ) -> Result<(), Diagnostic> {
        let HirType::Managed(ManagedType::Object(ty)) = self.values[receiver.0 as usize].ty else {
            return Ok(());
        };
        if name != "value"
            || self.receiver_cannot_be_finished(at)
            || !may_be_a_finished_iterator_result(self.snapshot, ty)
        {
            return Ok(());
        }
        Err(self.unsupported(
            at,
            "reading `value` off an iterator result that may be finished, which needs `done` ruled out at the read -- the slot holds the yielded representation and has no room for the `undefined` a finished iterator answers",
        ))
    }

    /// Has the checker already ruled out the finished arm at this read?
    ///
    /// The value's `HirType` carries the type the receiver was *built* at, and
    /// narrowing does not rewrite it: `const r = it.next()` makes one SSA value
    /// typed with the union, and reading `r` inside `if (!r.done)` hands back
    /// that same value. The narrowing lives on the *node*, which is where this
    /// looks.
    ///
    /// Asked of the receiver expression rather than of the access, because the
    /// access's own type is `value`'s and the question is about the object.
    ///
    /// **`false` for anything that is not an access**, which is how the
    /// destructuring caller gets its answer without asserting one.
    fn receiver_cannot_be_finished(&self, access: NodeId) -> bool {
        if !matches!(
            self.kind_of(access),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
        ) {
            return false;
        }
        let Some(receiver) = self.children(access).first().copied() else {
            return false;
        };
        let Some(narrowed) = self.snapshot.node_types.get(&receiver).copied() else {
            return false;
        };
        iterator_result_element(self.snapshot, narrowed).is_some()
            && !may_be_a_finished_iterator_result(self.snapshot, narrowed)
    }
}
