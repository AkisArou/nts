//! Discover and lower Promise then/catch/finally continuations and their result delivery.

use super::{
    AsyncResult, BlockId, ClosureEntry, ClosureInfo, ClosureSource, Diagnostic, Exit, Facts, Field,
    Func, FuncBuilder, Handler, HirType, ManagedType, NodeId, OpKind, Origin, Param, ParamShape,
    Terminator, TypeKind, ValueId, closure_names, closure_type, signature_key, syntax,
};

/// Why a reaction inside a generic is refused.
///
/// A reaction is lowered once, from its site's types, and a generic's copies
/// each see the site at different ones -- so a copy's `Promise<T>` would be read
/// by a body built for the declaration's. Making the reaction a variant per copy
/// is what [`ClosureInfo::within`] does for an arrow, and it is not done here yet.
const A_REACTION_IN_A_GENERIC: &str = "a `.then`, `.catch` or `.finally` inside a generic function or class, whose \
                                       copies would each need their own reaction";

/// Every `.then`, `.catch` and `.finally` called on a promise, and the reaction
/// closure each one subscribes: a [`ClosureSource::Reaction`] per site, appended
/// to `closures`.
///
/// **Per site rather than one for the program**, and the JVM is what decides it.
/// A reaction calls its handlers, and a call through a function value dispatches
/// on the *signature's* class -- `invokevirtual` there -- so a field holding a
/// handler is typed at its signature, and the signature is the site's. One
/// program-wide reaction would have to hold every handler as `unknown`, which no
/// backend can call. Typed per site, the source's payload is also read by the
/// reader its type names and the result settled by the helper its payload names,
/// exactly as an `await` of the same promise would.
///
/// A closure for every site the checker types as a promise method, whether or not
/// the site is ever lowered: one that is not costs a `ClosureInfo`, since only a
/// closure some body names is built.
pub(super) fn reactions(probe: &FuncBuilder, closures: &mut Vec<ClosureInfo>) {
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
        if !matches!(method.as_str(), "then" | "catch" | "finally")
            || !matches!(
                probe.type_of(receiver),
                Some(HirType::Managed(ManagedType::Promise(_)))
            )
        {
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
            source: ClosureSource::Reaction,
            refusal: generic.then_some(A_REACTION_IN_A_GENERIC),
            ..ClosureInfo::as_written(site)
        });
    }
}

/// What one reaction holds and does, read off its site.
///
/// **One derivation for both sides.** The site that builds the closure and the
/// body that reads it each ask [`FuncBuilder::reaction_shape`], so the fields one
/// writes are the fields the other reads -- the agreement `collect_layouts` would
/// otherwise have to find broken.
#[derive(Clone, Debug)]
struct ReactionShape {
    /// What the promise it subscribes to holds: `T` of the receiver's `Promise<T>`.
    payload: HirType,
    /// What the promise it hands back holds: `U` of the call's `Promise<U>`.
    answer: HirType,
    callbacks: Callbacks,
}

/// Which handlers a reaction calls, by the settlement each one answers.
#[derive(Clone, Debug)]
enum Callbacks {
    /// `.then(onFulfilled, onRejected)`, and `.catch(onRejected)`, which the
    /// specification defines as `.then(undefined, onRejected)`. An absent one
    /// passes the settlement through to the result.
    Then {
        fulfilled: Option<Callback>,
        rejected: Option<Callback>,
    },
    /// `.finally(onFinally)`: called with nothing on either path, and the result
    /// settles as the source did unless it throws -- **two ticks later** than a
    /// `.then` would settle it, because the specification resolves it with
    /// `Promise.resolve(onFinally()).then(() => value)`, a promise.
    Finally(Option<Callback>),
}

/// One handler a reaction holds.
#[derive(Clone, Debug)]
struct Callback {
    /// The argument it was written as.
    argument: NodeId,
    /// What the field holding it is typed as: the handler's signature.
    ty: HirType,
    /// What calling it answers.
    returns: HirType,
}

impl ReactionShape {
    /// The handlers present, in field order, each with its field index.
    fn present(&self) -> Vec<(u32, &'static str, &Callback)> {
        let named = match &self.callbacks {
            Callbacks::Then {
                fulfilled,
                rejected,
            } => {
                vec![
                    ("onFulfilled", fulfilled.as_ref()),
                    ("onRejected", rejected.as_ref()),
                ]
            }
            Callbacks::Finally(finally) => vec![("onFinally", finally.as_ref())],
        };
        named
            .into_iter()
            .filter_map(|(name, callback)| callback.map(|callback| (name, callback)))
            .zip(2..)
            .map(|((name, callback), field)| (field, name, callback))
            .collect()
    }

    /// The field index a handler is held at.
    fn field_of(&self, callback: &Callback) -> u32 {
        self.present()
            .into_iter()
            .find_map(|(field, _, held)| (held.argument == callback.argument).then_some(field))
            .unwrap_or_else(|| unreachable!("a handler of this shape is one of its fields"))
    }

    /// The source, the result, and the handlers present.
    fn fields(&self) -> Vec<Field> {
        let field = |name: &str, ty: HirType| Field {
            name: (name.to_owned()).into(),
            ty,
            readonly: true,
            declared_by: None,
            written: None,
        };
        let mut fields = vec![
            field(
                "source",
                HirType::Managed(ManagedType::Promise(Box::new(self.payload.clone()))),
            ),
            field(
                "result",
                HirType::Managed(ManagedType::Promise(Box::new(self.answer.clone()))),
            ),
        ];
        fields.extend(
            self.present()
                .into_iter()
                .map(|(_, name, callback)| field(name, callback.ty.clone())),
        );
        fields
    }
}

impl FuncBuilder<'_> {
    /// What the reaction at `site` holds and calls, or why there can be none.
    ///
    /// Asked by the site and by the body: see [`ReactionShape`]. Everything here is
    /// read from the checker's types rather than from values, which is what lets
    /// two builders that share no values agree -- and why a generic's site, whose
    /// types the copy substitutes, is refused before this is asked.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn reaction_shape(&self, site: NodeId) -> Result<ReactionShape, Diagnostic> {
        let Some((receiver, method)) = self
            .children(site)
            .first()
            .and_then(|callee| self.member_access(*callee))
        else {
            return Err(self.unsupported(site, "a promise reaction whose method is not named"));
        };
        let Some(HirType::Managed(ManagedType::Promise(payload))) = self.type_of(receiver) else {
            return Err(self.unrepresentable(receiver, "the promise a reaction subscribes to"));
        };
        let Some(HirType::Managed(ManagedType::Promise(answer))) = self.type_of(site) else {
            return Err(self.unrepresentable(site, "the promise a reaction hands back"));
        };
        // A counted handle is boxed in its promise, and an `await` unboxes it
        // (`suspend::read_settled`); a reaction reading one would need the same
        // step a second time, and passing it through needs it a third.
        if matches!(*payload, HirType::NativePointer(_))
            || matches!(*answer, HirType::NativePointer(_))
        {
            return Err(self.unsupported(
                site,
                "a promise reaction over a native handle, which its promise holds boxed",
            ));
        }
        let arguments = self.arguments_of(site);
        let callback = |at: usize| -> Result<Option<Callback>, Diagnostic> {
            let Some(&argument) = arguments.get(at) else {
                return Ok(None);
            };
            let checker = self.snapshot.node_types.get(&argument).copied();
            // **Absent by the checker's type, not by the spelling.** `undefined` is a
            // name a scope can rebind, and the site and the body see different
            // scopes -- so a test of the text could give the two different field
            // lists. The type is one answer for both.
            if checker.is_some_and(|ty| {
                matches!(
                    self.snapshot
                        .types
                        .get(ty.0 as usize)
                        .map(|record| &record.kind),
                    Some(TypeKind::Undefined | TypeKind::Null)
                )
            }) {
                return Ok(None);
            }
            let Some((_, returned)) = checker.and_then(|ty| signature_key(self.snapshot, ty))
            else {
                return Err(self.unsupported(
                    argument,
                    "a promise reaction's handler that is not one function type: one that may be absent is \
                     tested where the reaction runs, which this compiler does not do yet",
                ));
            };
            let ty = self
                .type_of(argument)
                .ok_or_else(|| self.unrepresentable(argument, "a promise reaction's handler"))?;
            let returns = self.represent(returned).ok_or_else(|| {
                self.unrepresentable(argument, "what a promise reaction's handler returns")
            })?;
            Ok(Some(Callback {
                argument,
                ty,
                returns,
            }))
        };
        let (callbacks, takes) = match method.as_str() {
            "then" => (
                Callbacks::Then {
                    fulfilled: callback(0)?,
                    rejected: callback(1)?,
                },
                2,
            ),
            "catch" => (
                Callbacks::Then {
                    fulfilled: None,
                    rejected: callback(0)?,
                },
                1,
            ),
            _ => {
                let finally = callback(0)?;
                // `onFinally`'s answer is waited for when it is a promise or a
                // thenable, and the result then settles after it does. A reaction
                // that discards it would settle a tick early, and one that rejects
                // would be lost -- so an answer that can be either is refused.
                if let Some(callback) = &finally
                    && (matches!(
                        callback.returns,
                        HirType::Managed(ManagedType::Promise(_)) | HirType::Erased
                    ) || !self.thenable_candidates(&callback.returns).is_empty())
                {
                    return Err(self.unsupported(
                        callback.argument,
                        "a `finally` callback that can return a promise, whose settlement the result would have \
                         to wait for",
                    ));
                }
                (Callbacks::Finally(finally), 1)
            }
        };
        if arguments.len() > takes {
            return Err(self.unsupported(
                site,
                "a promise reaction given more arguments than it takes",
            ));
        }
        Ok(ReactionShape {
            payload: *payload,
            answer: *answer,
            callbacks,
        })
    }

    /// `.then`, `.catch` and `.finally` on a promise, where the census found the
    /// site; `None` for any other call.
    pub(super) fn promise_reaction(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        held: &HirType,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(held, HirType::Managed(ManagedType::Promise(_))) {
            return None;
        }
        let index = self
            .closures
            .iter()
            .position(|closure| closure.source == ClosureSource::Reaction && closure.node == id)?;
        Some(self.subscribe_a_reaction(id, index, receiver))
    }

    /// `p.then(f, g)`, `p.catch(g)` and `p.finally(f)`: a result promise, and the
    /// reaction that settles it subscribed to `p`.
    ///
    /// The handlers are evaluated here, in order, as any call's arguments are; the
    /// reaction holds them and calls them later. Subscribing is what marks `p`
    /// handled, which the specification's `PerformPromiseThen` does too -- so a
    /// rejection is reported unhandled only if the *result* goes unhandled, and the
    /// result carries it onward because an absent handler passes it through.
    fn subscribe_a_reaction(
        &mut self,
        site: NodeId,
        index: usize,
        receiver: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(reason) = self.closures[index].refusal {
            return Err(self.unsupported(site, reason));
        }
        let shape = self.reaction_shape(site)?;
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(
                self.unsupported(site, "a promise reaction in a program with no closure slot")
            );
        };
        let origin = self.origin(site);
        let fields = shape.fields();
        for field in &fields {
            self.materialize(site, &field.ty)?;
        }
        let mut handlers = Vec::new();
        for (_, _, callback) in shape.present() {
            let value = self.lower_expression(callback.argument)?;
            handlers.push(self.coerce(value, &callback.ty, callback.argument)?);
        }
        let source = self.coerce(receiver, &fields[0].ty, site)?;
        let result = self.runtime_call(
            "nts_promise_new",
            Vec::new(),
            fields[1].ty.clone(),
            origin.clone(),
        );
        let reaction = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(index))),
            origin.clone(),
        );
        for (field, value) in [source, result].into_iter().chain(handlers).enumerate() {
            self.field_set(
                reaction,
                u32::try_from(field).unwrap_or(u32::MAX),
                value,
                &origin,
            );
        }
        self.layouts.push(self.closure_layout(index, fields));
        self.used_closures.push(index);
        self.push(
            OpKind::PromiseSubscribe {
                promise: source,
                reaction,
                slot,
            },
            HirType::Void,
            origin,
        );
        Ok(result)
    }

    /// A reaction's body: the specification's `NewPromiseReactionJob`, for whichever
    /// way the source settled.
    ///
    /// ```text
    /// rejected = nts_promise_is_rejected(source)
    /// fulfilled:  onFulfilled ? settle(result, onFulfilled(value))  : settle(result, value)
    /// rejected:   onRejected  ? settle(result, onRejected(reason))  : reject result as source was
    /// finally:    onFinally(); nts_promise_adopt(result, source)
    /// ```
    ///
    /// **`finally` adopts rather than passing through**, and the difference is two
    /// ticks. Its specification is `p.then(v => Promise.resolve(onFinally()).then(()
    /// => v))`: the result is resolved with a promise, which costs the
    /// `NewPromiseResolveThenableJob` and the reaction behind it. Node, measured: a
    /// `.then`'s result settles after two ticks of a counting chain and a
    /// `.finally`'s after four. `nts_promise_adopt` of a promise that has already
    /// settled is exactly those two hops, on both paths, so the source is adopted
    /// whole and nothing branches on how it settled. The first version passed the
    /// settlement through as `.then` does and was two ticks early -- which the
    /// blocker this replaced (`a-promise-method-call`) had measured and said, and
    /// which `finallyTicks` in `tests/programs/promise-reactions` now pins.
    ///
    /// A handler's `throw` rejects the result, through the raising entry; see
    /// [`Self::call_a_reaction_handler`]. Settling is [`Self::settle`], the one
    /// resolve procedure, so a handler returning a promise is adopted and one
    /// returning a thenable runs its job -- the two ticks node takes for it.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn lower_reaction(
        &mut self,
        index: usize,
        info: &ClosureInfo,
    ) -> Result<Func, Diagnostic> {
        let site = info.node;
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(site, reason));
        }
        let shape = self.reaction_shape(site)?;
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(site);
        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let fields = shape.fields();
        for field in &fields {
            self.materialize(site, &field.ty)?;
        }
        let source = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            fields[0].ty.clone(),
            origin.clone(),
        );
        let promise = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 1,
            },
            fields[1].ty.clone(),
            origin.clone(),
        );
        let result = AsyncResult {
            promise,
            payload: shape.answer.clone(),
            written: None,
        };
        self.layouts.push(self.closure_layout(index, fields));

        let (fulfilled, rejected) = match &shape.callbacks {
            Callbacks::Then {
                fulfilled,
                rejected,
            } => (fulfilled.as_ref(), rejected.as_ref()),
            Callbacks::Finally(finally) => {
                let join = self.new_block();
                if let Some(finally) = finally {
                    self.call_a_reaction_handler(
                        site, receiver, &shape, finally, None, promise, join,
                    )?;
                }
                self.runtime_call(
                    "nts_promise_adopt",
                    vec![promise, source],
                    HirType::Void,
                    origin.clone(),
                );
                self.terminate(Terminator::Jump {
                    target: join,
                    args: Vec::new(),
                });
                self.switch_to(join);
                self.terminate(Terminator::Return(None));
                return Ok(self.finish(name, params, HirType::Void, origin, false));
            }
        };
        let is_rejected = self.runtime_call(
            "nts_promise_is_rejected",
            vec![source],
            HirType::Bool,
            origin.clone(),
        );
        let on_fulfilment = self.new_block();
        let on_rejection = self.new_block();
        let join = self.new_block();
        self.terminate(Terminator::Branch {
            cond: is_rejected,
            then_target: on_rejection,
            then_args: Vec::new(),
            else_target: on_fulfilment,
            else_args: Vec::new(),
        });

        for (block, rejects, callback) in [
            (on_fulfilment, false, fulfilled),
            (on_rejection, true, rejected),
        ] {
            self.switch_to(block);
            // What the handler is called with, or what passes through without one.
            let settled = if rejects {
                callback.map(|_| {
                    self.runtime_call(
                        "nts_promise_reason",
                        vec![source],
                        HirType::Erased,
                        origin.clone(),
                    )
                })
            } else {
                self.read_fulfilment(source, &shape.payload, &origin)
            };
            match callback {
                Some(callback) => {
                    let answer = self.call_a_reaction_handler(
                        site, receiver, &shape, callback, settled, promise, join,
                    )?;
                    self.settle(site, &result, answer)?;
                }
                None if rejects => {
                    self.runtime_call(
                        "nts_promise_reject_with",
                        vec![promise, source],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                None => {
                    self.settle(site, &result, settled)?;
                }
            }
            self.terminate(Terminator::Jump {
                target: join,
                args: Vec::new(),
            });
        }
        self.switch_to(join);
        self.terminate(Terminator::Return(None));
        Ok(self.finish(name, params, HirType::Void, origin, false))
    }

    /// What a fulfilled promise holds, read at its payload's type: the reader an
    /// `await` of it calls, from [`crate::hir::suspend::settled_reader`]. `None` for a
    /// promise that holds nothing.
    ///
    /// **And for a `Promise<never>`**, which is what `Promise.reject(e)` is typed:
    /// it is never fulfilled, so there is nothing to read, and reading a `never`
    /// to hand a handler refused the reaction -- `twice` in
    /// `tests/programs/promise-reactions`. Its handler is called with `undefined`, which
    /// is what it would see if the type were wrong and it ran.
    fn read_fulfilment(
        &mut self,
        source: ValueId,
        payload: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        if *payload == HirType::Never {
            return None;
        }
        let reader = crate::hir::suspend::settled_reader(payload)?;
        let storage = crate::hir::suspend::settled_storage(payload);
        let value = self.runtime_call(reader, vec![source], storage.clone(), origin.clone());
        Some(if storage == *payload {
            value
        } else {
            self.push(OpKind::unerase(value), payload.clone(), origin.clone())
        })
    }

    /// Call one of a reaction's handlers with `argument`, and answer what it
    /// returned -- `None` where that is nothing a promise settles with.
    ///
    /// **Through the raising entry where the program has one**, because a handler's
    /// `throw` rejects the result: that is the whole of how `.catch` at the end of a
    /// chain sees a throw from its middle. The call is guarded the way `lower_try`
    /// guards one, with a handler frame whose block rejects `result` and goes to
    /// `join`, so the flag test sits immediately after the call and before anything
    /// reads the answer.
    ///
    /// Where the program has no raising entry (`Hierarchy::closures_carry` is
    /// false) the call takes the ordinary one, and a `throw` ends the program by
    /// name through the uncaught path -- the trade [`Thenable::Raises`](super::thenable_jobs::Thenable::Raises) makes for a
    /// job's `then`, for the same reason: the alternative is refusing every
    /// reaction in a program because one closure somewhere cannot carry a raise.
    #[allow(clippy::too_many_arguments)]
    fn call_a_reaction_handler(
        &mut self,
        site: NodeId,
        reaction: ValueId,
        shape: &ReactionShape,
        callback: &Callback,
        argument: Option<ValueId>,
        result: ValueId,
        join: BlockId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let origin = self.origin(site);
        let handler = self.push(
            OpKind::FieldGet {
                object: reaction,
                field: shape.field_of(callback),
            },
            callback.ty.clone(),
            origin.clone(),
        );
        let catches = self.hierarchy.closures_carry && self.hierarchy.raising_call_slot.is_some();
        let slot = if catches {
            self.hierarchy.raising_call_slot
        } else {
            self.hierarchy.erased_call_slot
        };
        let Some(slot) = slot else {
            return Err(
                self.unsupported(site, "a promise reaction in a program with no closure slot")
            );
        };
        let args = std::iter::once(handler).chain(argument).collect();
        let callee = ClosureEntry(slot);
        let answered = if catches {
            let entry = self.bindings.clone();
            self.exits.push(Exit::Handler(Handler {
                block: None,
                edges: Vec::new(),
                rejections: Vec::new(),
            }));
            let answered = self.call_a_closure_entry(site, callee, None, args, &HirType::Erased);
            if answered.is_ok() {
                self.emit_the_raise_test(&origin);
            }
            let Some(Exit::Handler(frame)) = self.exits.pop() else {
                unreachable!("pushed immediately above")
            };
            let answered = answered?;
            if let Some(caught) = frame.block {
                let carry_on = self.current;
                let thrown = self.open_handler(caught, &frame, &entry, &origin);
                self.switch_to(caught);
                self.reject_with(site, result, Some(thrown))?;
                self.terminate(Terminator::Jump {
                    target: join,
                    args: Vec::new(),
                });
                self.switch_to(carry_on);
            }
            answered
        } else {
            self.call_a_closure_entry(site, callee, None, args, &HirType::Erased)?
        };
        // Read back at what the handler's signature returns, after the test: the
        // inverse of the erased ABI this call asked for, as `call_a_closure_entry`
        // argues for its own read-back.
        Ok(match &callback.returns {
            HirType::Void | HirType::Never => None,
            HirType::Erased => Some(answered),
            returns => Some(self.push(OpKind::unerase(answered), returns.clone(), origin)),
        })
    }
}
