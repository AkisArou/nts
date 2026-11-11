//! Lower try, catch, finally, and throw, including the exceptional control edges and local bindings.

use super::{
    BlockId, Callee, Diagnostic, FuncBuilder, HirType, Layout, ManagedType, NodeId, OpKind, Origin,
    SemanticSnapshot, Terminator, ValueId, direct_children, iterator_close, kind_at, syntax,
};

/// The index of a `message: string` field, if a type has one.
///
/// Used by `throw` to hand the runtime something to print. By shape, not by
/// name: the four classes in [`super::builtin`](crate::hir::builtin) have such a field, and so does
/// every user class that extends one, and nothing here needs to tell them
/// apart.
fn message_field(layouts: &[Layout], ty: &HirType) -> Option<u32> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return None;
    };
    let layout = layouts.iter().find(|layout| layout.types.contains(id))?;
    layout
        .fields
        .iter()
        .position(|field| {
            field.name.is_name("message")
                && matches!(field.ty, HirType::Managed(ManagedType::String))
        })
        .and_then(|at| u32::try_from(at).ok())
}

/// One reason a `try` has to be noticed while the statements inside it lower.
///
/// A `catch` *stops* a `throw`; a `finally` is *run through* by every way out.
/// One stack rather than two, because interleaving them is exactly what leaving
/// a `try` has to get right: a `throw` runs the `finally`s above the nearest
/// `catch` and stops there, a `return` runs every one of them, and a `break`
/// runs the ones that are inside its loop.
pub(super) enum Exit {
    Handler(Handler),
    /// A `finally` body, lowered again at each way out of its `try`.
    ///
    /// Duplicated rather than shared. Sharing it needs a variable saying where
    /// to continue afterwards and a switch on that variable at the bottom --
    /// a branch per exit, and a value carried to feed it -- where duplication
    /// is a second copy of a block that is usually three lines. It is also the
    /// only version that composes with `return`, which has to run the body and
    /// then leave rather than come back.
    Finally(NodeId),
    Iterator(iterator_close::Action),
}

/// One `await` inside a `try`, whose rejection is an edge into the handler.
///
/// Recorded rather than emitted, for the same reason an [`Edge`] is: the
/// handler's parameters are not known until the whole body has been lowered.
/// Unlike an `Edge` there is no terminator to patch afterwards — the block a
/// rejection leaves is created by [`super::suspend`](crate::hir::suspend), when it splits the
/// function at this `await` — so what is settled here is written *into the
/// operation* and read there.
pub(super) struct PendingRejection {
    /// The `Await` operation.
    at: ValueId,
    /// What every name held at the `await`, exactly as a `throw` records it.
    bindings: rustc_hash::FxHashMap<u32, ValueId>,
}

/// A `try` whose body is being lowered, and every `throw` that has reached it.
pub(super) struct Handler {
    /// The block the handler's code will go in, once something needs one.
    ///
    /// Created by the first `throw` rather than by the `try`, because a body
    /// that cannot throw should leave nothing behind: a block with no
    /// predecessors is one the verifier rejects, and creating it eagerly meant
    /// every defensive `try` around code that cannot throw produced an invalid
    /// function.
    pub(super) block: Option<BlockId>,
    /// One per `throw` in the body, in the order they were lowered.
    pub(super) edges: Vec<Edge>,
    /// One per `await` in the body, whose rejection reaches this handler.
    pub(super) rejections: Vec<PendingRejection>,
}

/// One `throw`'s jump into a handler, before the handler has parameters.
pub(super) struct Edge {
    /// The block the `throw` ended.
    pub(super) from: BlockId,
    /// The thrown value, already erased.
    pub(super) thrown: ValueId,
    /// What every name held at the `throw`.
    ///
    /// Cloned rather than referenced because it is a snapshot: the body goes on
    /// being lowered after this edge is recorded, and the map keeps changing.
    pub(super) bindings: rustc_hash::FxHashMap<u32, ValueId>,
}

/// A `try` has a `finally` when its last part is a block: `try/catch` ends in a
/// catch clause, and `try/finally` and `try/catch/finally` end in the block the
/// `finally` introduces.
pub(super) fn has_finally(snapshot: &SemanticSnapshot, id: NodeId) -> bool {
    let parts = direct_children(snapshot, id);
    parts.len() >= 2 && kind_at(snapshot, parts[parts.len() - 1]) == Some(syntax::BLOCK)
}

impl FuncBuilder<'_> {
    /// Note that this `await`'s rejection belongs to the enclosing `catch`.
    ///
    /// A rejected promise resumed inside a `try` has to reach that `try`'s
    /// handler. Until this, the resumption's rejection branch went to one
    /// shared exit that rejects the function's own promise — which is a *wrong
    /// answer* rather than a missing one:
    ///
    /// ```ts
    /// try { await failing() } catch { return -99 }   // node: -99
    /// ```
    ///
    /// compiled, ran, and rejected. It was refused by name for exactly that
    /// reason, and **89 occurrences across 17 sites** in `runtime/node` wait on
    /// it — `try { await reader.close() } catch {}` is the shape.
    ///
    /// The nearest `catch` and no `finally` between: a `finally` that spans an
    /// `await` is still refused, because it has to run on the path where the
    /// function suspended and was resumed with an exception, and that is the
    /// exception state machine rather than this edge. So a rejection is
    /// recorded only where the innermost exit is a handler.
    pub(super) fn record_rejection(&mut self, awaited: ValueId) {
        if !matches!(self.exits.last(), Some(Exit::Handler(_))) {
            return;
        }
        // The handler block, created here if no `throw` has made one.
        //
        // It is created lazily so that a `try` around code that cannot throw
        // leaves nothing behind -- a block with no predecessors is one the
        // verifier rejects. A rejection is a predecessor like any other, and
        // forgetting that left `try { await p } catch { .. }` with a dead
        // handler and the rejection still going to the shared exit: node
        // answered -99 and nts rejected, on 20 of 29 cases.
        let block = match self.exits.last() {
            Some(Exit::Handler(handler)) => handler.block,
            _ => None,
        };
        if block.is_none() {
            let made = self.new_block();
            if let Some(Exit::Handler(handler)) = self.exits.last_mut() {
                handler.block = Some(made);
            }
        }
        let bindings = self.bindings.clone();
        let Some(Exit::Handler(handler)) = self.exits.last_mut() else {
            return;
        };
        handler.rejections.push(PendingRejection {
            at: awaited,
            bindings,
        });
    }

    pub(super) fn lower_throw(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let thrown = *self
            .children(id)
            .first()
            .ok_or_else(|| self.unsupported(id, "a `throw` with nothing to throw"))?;

        // The whole value, not a message taken out of it.
        //
        // What stood here reduced `new Error(m)` to `m`, on the reasoning that
        // `Error` was `lib.d.ts`'s and could not be constructed. It is
        // [`super::builtin`](crate::hir::builtin)'s and has been for some time, and the reduction
        // was only invisible because nothing could observe the difference: an
        // uncaught throw prints and aborts either way. A `catch` binding is
        // exactly what observes it.
        //
        // Erased, because `catch (e)` is `unknown`. That is the language's own
        // answer to what a handler receives, and taking it means `throw "text"`
        // and `throw new Error(m)` are one operation at one representation
        // rather than two shapes to keep in agreement.
        //
        // Through `coerce`, which reads the operand's absences: `throw error`
        // with `error: Error | null` holding null throws `null`, not an object
        // tag over a null pointer that is neither `null` nor an `Error`.
        let value = self.lower_expression(thrown)?;
        let thrown_ty = self.values[value.0 as usize].ty.clone();

        let erased = self.coerce(value, &HirType::Erased, thrown)?;
        self.throw_erased(id, value, erased, &thrown_ty)
    }

    /// Throw a value that has already been computed and erased.
    ///
    /// Split out of [`Self::lower_throw`] because a **rethrow** has no
    /// expression to lower: `try { await p } finally { … }` runs the `finally`
    /// on the rejection path and then goes on rejecting with the reason the
    /// promise carried, and that value arrives from `nts_promise_reason`
    /// already erased.
    ///
    /// `value` is the unerased form where there is one, because rejecting a
    /// promise wants the reference and printing an uncaught throw wants the
    /// `message` field. A rethrow has only the erased form, and passes it for
    /// both -- the runtime reads the reference out of the tag.
    pub(super) fn throw_erased(
        &mut self,
        id: NodeId,
        value: ValueId,
        erased: ValueId,
        thrown_ty: &HirType,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);

        // A `throw` with a handler in this function is a jump to it and nothing
        // more. The value rides the edge as a block argument, so it never
        // reaches the runtime's slot -- which is the common case worth making
        // free, and it is free because releasing what a frame owns along an
        // edge is what [`super::rc`](crate::hir::rc) already does for every other edge here.
        //
        // The arguments are filled in later: the handler's parameters are not
        // known until the whole body has been lowered. See [`Self::lower_try`].
        // The nearest `catch` stops this throw; every `finally` between here
        // and it runs on the way. The value was computed before any of them,
        // which is when the language says it is computed.
        let caught_at = self
            .exits
            .iter()
            .rposition(|exit| matches!(exit, Exit::Handler(_)));
        self.unwind_to(caught_at.map_or(0, |at| at + 1), Some(erased))?;
        if self.is_terminated() {
            // A `finally` left by itself, so this `throw` never arrives.
            return Ok(());
        }

        if let Some(at) = caught_at {
            let mut target = match &self.exits[at] {
                Exit::Handler(frame) => frame.block,
                Exit::Finally(_) | Exit::Iterator(_) => unreachable!("rposition found a handler"),
            };
            if target.is_none() {
                let block = self.new_block();
                if let Exit::Handler(frame) = &mut self.exits[at] {
                    frame.block = Some(block);
                }
                target = Some(block);
            }
            let Some(target) = target else {
                unreachable!("just created above")
            };
            let edge = Edge {
                from: self.current,
                thrown: erased,
                bindings: self.bindings.clone(),
            };
            if let Exit::Handler(frame) = &mut self.exits[at] {
                frame.edges.push(edge);
            }
            self.terminate(Terminator::Jump {
                target,
                args: Vec::new(),
            });
            return Ok(());
        }

        // An `async` function's `throw` rejects the promise it already owns and
        // hands it back, which is exactly what its `return` does with `settle`.
        // Without this it ended the program: node rejects, and every caller
        // awaiting it sees a rejection rather than a dead process.
        //
        // The erased value, whatever was thrown: a reason is a tagged slot
        // (`nts_promise_reject_value`), so `throw 1` rejects with 1 and a
        // thrown `null` stays `null`. The reference-only `nts_promise_reject`
        // this once called refused a number outright and read a null
        // reference as `undefined`.
        //
        // **Before the raising arm, in every copy.** An `async` callable never
        // raises synchronously -- its promise exists before its parameters are
        // bound -- so a raising copy of one (a closure called through a raising
        // entry has one) rejects as the ordinary copy does. Checked second, a
        // parameter pattern's TypeError in `async ({}) => {}`'s raising copy
        // raised and returned no promise: `ReturnType { expected:
        // Managed(Promise(..)), found: None }`, invalid HIR.
        if let Some(result) = self.async_result.clone() {
            self.runtime_call(
                "nts_promise_reject_value",
                vec![result.promise, erased],
                HirType::Void,
                origin,
            );
            self.terminate(Terminator::Return(Some(result.promise)));
            return Ok(());
        }

        // **A raising copy records it and returns**, which is the whole of what
        // the copy is for. See [`Self::raises`].
        //
        // The same shape as the `async` arm above -- record the reason on
        // something the caller will look at, then leave by an ordinary
        // `Return` -- and for the same reason: an ordinary return is an edge
        // [`super::rc`](crate::hir::rc) already emits releases for, where a jump out of the
        // frame is not.
        //
        // Checked after the handler search above, so a `throw` this copy
        // catches itself never reaches the runtime slot.
        if self.raises {
            self.runtime_call("nts_raise", vec![erased], HirType::Void, origin.clone());
            let value = self.raised_return(&origin);
            self.terminate(Terminator::Return(value));
            return Ok(());
        }

        // Only on the path that ends the program, and after the check above so
        // that a caught `throw` does not load a field nothing reads.
        //
        // A descriptor records where an object's references *are*, not what
        // they are called, so the runtime cannot find `message` by name and
        // this can. Matched by shape rather than against the four builtin error
        // classes: any object with a string `message` renders, which covers
        // every `class MyError extends Error` without needing to know that any
        // of them is one.
        let detail = match message_field(&self.layouts, thrown_ty) {
            Some(field) => self.push(
                OpKind::FieldGet {
                    object: value,
                    field,
                },
                HirType::Managed(ManagedType::String),
                origin.clone(),
            ),
            None => self.push(
                OpKind::ConstNull,
                HirType::Managed(ManagedType::String),
                origin.clone(),
            ),
        };
        self.push(
            OpKind::Call {
                callee: Callee::External("nts_uncaught".to_owned()),
                args: vec![erased, detail],
                frame: None,
            },
            HirType::Void,
            origin,
        );
        // Control does not continue. Saying so is what lets the C compiler
        // treat the code after a throw as unreachable, which it is.
        self.terminate(Terminator::Unreachable);
        Ok(())
    }

    /// `try { … } catch (e) { … }`.
    ///
    /// # A handler is a block, and a `throw` is a jump to it
    ///
    /// Nothing here unwinds, and nothing needs to. An unwinder's tables exist
    /// to *recover*, from a machine frame at run time, which values that frame
    /// owns; this compiler computes that at compile time already, in
    /// [`super::own`](crate::hir::own), and [`super::rc`](crate::hir::rc) emits the releases an edge implies for
    /// every other edge in the program. A handler edge is not a special kind of
    /// edge, so it needs no special machinery -- it needs to be an edge.
    ///
    /// # Why the parameters cannot be decided first
    ///
    /// Every `throw` in the body is one edge into the handler, and they need
    /// not agree about anything: a name the body assigns before the first
    /// `throw` holds one value there and another at the second. So the handler
    /// block is created empty, each `throw` records the bindings it had, and
    /// the parameter list is computed once the body is finished -- one
    /// parameter for the thrown value, and one for each name the edges
    /// disagree about. A name they all agree about is bound to that value
    /// outright, which is most of them.
    pub(super) fn lower_try(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let parts = self.children(id);
        let Some(&body) = parts.first() else {
            return Err(self.unsupported(id, "a `try` with nothing in it"));
        };
        // **A `throw` that crosses a call reaches no handler here.** A `throw`
        // lowers to a jump to the enclosing handler *block*, which is a branch
        // inside one function; a callee has no edge back to its caller's
        // handler, so a throw raised inside a call abandons the program where
        // node's `catch` would run.
        //
        // Measured on all three backends before this was written: `try { return
        // deep(n) } catch { return -1 }` with `deep` throwing gives
        // `10 case(s) the compiled program declined` against node's -1, and the
        // JVM emits no exception table at all. The uncaught case is *right* --
        // an abort is what node does when nobody catches -- so the divergence
        // is exactly a handler existing, which is what this refuses.
        //
        // **The precise rule, and this paragraph used to say otherwise.** It
        // read "any call, rather than only one that can reach a `throw`. The
        // precise rule wants a transitive `can throw` over the call graph and
        // would refuse fewer" -- and that refinement was since built and the
        // sentence was not updated. `calls_compiled_code` ends with
        // `self.throwing.contains(&symbol.0)`, over the fixpoint
        // `throwing_symbols` computes, so the transitive rule is live:
        //
        //     try { r = pure(4) } catch { }        lowers
        //     try { r = outer(3) } catch { }       lowers, and `outer` calls
        //                                          `inner`, neither throwing
        //     try { r = bad(1) } catch { }         refused
        //     try { r = mid(1) } catch { }         refused, `mid` calls `bad`
        //
        // `a_call_that_cannot_throw_still_compiles` pins the second of those.
        // A comment describing this compiler as cruder than it is sends the
        // next reader to build what is already here, which is the more
        // expensive direction for a stale sentence to be wrong in.
        //
        // What remains is therefore *calls that genuinely can raise* -- 74
        // sites in `runtime/node`, every one of them this message -- and
        // closing those is real cross-call exception propagation rather than a
        // sharper predicate.
        //
        // The argument that decided the original shape is still worth keeping:
        // **the defect is masked by the boundary today.** A module has to
        // publish a function before a caught throw inside it can be reached, and
        // `assert` -- the most throw-heavy module in the profile -- fails 13 of
        // 13 on names that do not exist. So this is cheapest to refuse now and
        // grows more expensive as publishing improves, which is the opposite of
        // the usual shape.
        let mut handled = Vec::new();
        if let Some((call, why)) = self.call_within(body, &mut handled) {
            return Err(self.unsupported(
                call,
                &format!("a call inside a `try` whose `throw` would not reach this handler: {why}"),
            ));
        }
        // Every call this `try` *can* handle names the callee's raising copy
        // and is followed by a test. Recorded before the body is lowered,
        // because `push_call` reads both while it walks it.
        for call in handled {
            self.raising_calls.insert(call);
        }
        // The children are the block, an optional catch clause, and an optional
        // `finally` block. Which is which is read off the shape rather than off
        // a `CatchClause` kind number: every constant in `syntax` was read from
        // a real encoded program and pinned by a test, and this one would have
        // been inferred from the order of a Go `iota` list instead. `has_finally`
        // reads the same node the same way.
        let ends_in_block =
            parts.len() >= 2 && self.kind_of(parts[parts.len() - 1]) == Some(syntax::BLOCK);
        let (clause, finally_body) = match (parts.len(), ends_in_block) {
            (2, false) => (parts.get(1).copied(), None),
            (2, true) => (None, parts.get(1).copied()),
            (3, true) => (parts.get(1).copied(), parts.get(2).copied()),
            _ => return Err(self.unsupported(id, "a `try` of unexpected shape")),
        };

        // Pushed before the handler, because the `finally` encloses the `catch`:
        // a `throw` in the body is stopped by the `catch` and runs no `finally`,
        // and a `throw` in the `catch` runs it on the way out.
        if let Some(body) = finally_body {
            self.exits.push(Exit::Finally(body));
        }
        let guarded = self.lower_guarded(id, body, clause);
        if finally_body.is_some() {
            self.exits.pop();
        }
        guarded?;

        // Normal completion runs it too, and this is the copy that most
        // programs execute.
        if let Some(body) = finally_body.filter(|_| !self.is_terminated()) {
            self.lower_statement(body)?;
        }
        Ok(())
    }

    /// `try { … } finally { … }`, with no `catch`.
    ///
    /// A `throw` in the body finds the `finally` on the exit stack and whatever
    /// encloses that, so it needs nothing from here — the body is lowered as it
    /// stands and `unwind_to` does the rest.
    ///
    /// A **rejected `await`** is the exception. It leaves the `try` on a path
    /// no `throw` wrote, and the `finally` has to run on it: node runs it, and
    /// this compiler did not, which was a wrong answer rather than a gap. So a
    /// handler is synthesised where the source wrote none —
    ///
    /// ```text
    /// try { … } finally { F }   ->   try { … } catch (e) { F; throw e } finally { F }
    /// ```
    ///
    /// — which is what explicit cleanup means and what `unwind_to`
    /// already does for every other abrupt exit. It is built only when a
    /// rejection recorded itself, so a `try`/`finally` around code that cannot
    /// reject leaves nothing behind.
    ///
    /// The `finally` is taken **off** the exit stack while its own copy is
    /// lowered here, for the reason `unwind_to` takes it off: the rethrow
    /// at the end must run whatever encloses this `try`, and not this one
    /// again.
    fn lower_unguarded(&mut self, id: NodeId, body: NodeId) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let entry = self.bindings.clone();
        self.exits.push(Exit::Handler(Handler {
            block: None,
            edges: Vec::new(),
            rejections: Vec::new(),
        }));
        let lowered = self.lower_statement(body);
        let Some(Exit::Handler(frame)) = self.exits.pop() else {
            unreachable!("pushed immediately above")
        };
        lowered?;

        let body_tail = self.current;
        let body_open = !self.is_terminated();
        let body_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        let Some(handler) = frame.block else {
            // Nothing rejected and nothing threw here, so there is no path this
            // `try` needs a copy of the `finally` for.
            self.bindings = body_bindings;
            return Ok(());
        };

        let thrown = self.open_handler(handler, &frame, &entry, &origin);
        self.switch_to(handler);
        // Its own copy of the `finally`, and then the rethrow. Both with this
        // `try`'s `finally` off the stack: the copy is being written here, and
        // the rethrow belongs to whatever encloses.
        let floor = self
            .exits
            .iter()
            .rposition(|exit| matches!(exit, Exit::Finally(_)));
        let above = floor.map(|at| self.exits.split_off(at));
        let cleanup = self.finally_of(id).map(|body| self.lower_statement(body));
        let rethrow = if self.is_terminated() {
            // The `finally` left by itself -- a `return` or a `throw` in it
            // replaces the completion on its way out, which is what the
            // language says.
            Ok(())
        } else {
            self.throw_erased(id, thrown, thrown, &HirType::Erased)
        };
        if let Some(above) = above {
            self.exits.extend(above);
        }
        cleanup.transpose()?;
        rethrow?;

        self.bindings = body_bindings;
        self.current = body_tail;
        if !body_open {
            self.terminate(Terminator::Unreachable);
        }
        Ok(())
    }

    /// The `finally` body of a `try`, where it has one.
    fn finally_of(&mut self, id: NodeId) -> Option<NodeId> {
        let parts = self.children(id);
        let last = *parts.last()?;
        (parts.len() >= 2 && self.kind_of(last) == Some(syntax::BLOCK)).then_some(last)
    }

    /// The `try` and its `catch`, with whatever `finally` encloses them already
    /// on the exit stack.
    fn lower_guarded(
        &mut self,
        id: NodeId,
        body: NodeId,
        clause: Option<NodeId>,
    ) -> Result<(), Diagnostic> {
        let Some(clause) = clause else {
            return self.lower_unguarded(id, body);
        };
        let clause_parts = self.children(clause);
        let Some(&handler_body) = clause_parts.last() else {
            return Err(self.unsupported(clause, "a `catch` with no body"));
        };
        // `catch { }` is legal and binds nothing.
        let caught = if clause_parts.len() >= 2 {
            Some(clause_parts[0])
        } else {
            None
        };

        let origin = self.origin(id);
        let entry = self.bindings.clone();

        self.exits.push(Exit::Handler(Handler {
            block: None,
            edges: Vec::new(),
            rejections: Vec::new(),
        }));
        let lowered = self.lower_statement(body);
        // Popped before the refusal is raised, so a refused body does not leave
        // the stack claiming a handler that is no longer being built. Popped
        // before the *handler body* is lowered too, which is what makes a
        // `throw` inside a `catch` belong to the enclosing `try`.
        let Some(Exit::Handler(frame)) = self.exits.pop() else {
            unreachable!("pushed immediately above")
        };
        lowered?;

        let body_tail = self.current;
        let body_open = !self.is_terminated();
        let body_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        let Some(handler) = frame.block else {
            // Nothing in the body throws, so the `catch` is dead. Not an error
            // and not a warning: a `try` around code that cannot throw is how a
            // person writes defensively, and the right answer is to emit the
            // body and nothing else. No block was ever created for it.
            self.bindings = body_bindings;
            return Ok(());
        };

        let thrown = self.open_handler(handler, &frame, &entry, &origin);
        self.switch_to(handler);
        if let Some(declaration) = caught {
            self.bind_caught(declaration, thrown)?;
        }
        self.lower_statement(handler_body)?;
        let handler_tail = self.current;
        let handler_open = !self.is_terminated();
        let handler_bindings = std::mem::replace(&mut self.bindings, entry.clone());

        self.join_try(
            id,
            &origin,
            (body_tail, body_open, body_bindings),
            (handler_tail, handler_open, handler_bindings),
            entry,
        );
        Ok(())
    }

    /// Lower the `finally` bodies above `floor`, innermost first.
    ///
    /// For a path that is leaving all of them -- a `throw` on its way to a
    /// handler further out, a `return`, a `break` out of the loop they are in.
    ///
    /// Each body is lowered *here*, inline, which is what makes a `finally`
    /// duplicated rather than shared. See [`Exit::Finally`].
    pub(super) fn unwind_to(
        &mut self,
        floor: usize,
        pending_throw: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        let mut at = self.exits.len();
        while at > floor {
            at -= 1;
            if matches!(self.exits[at], Exit::Handler(_)) {
                continue;
            }
            // Remove this action and everything inside it while it runs. An
            // error from cleanup belongs to the enclosing scope, never itself.
            let above = self.exits.split_off(at);
            let lowered = match &above[0] {
                Exit::Finally(body) => self.lower_statement(*body),
                Exit::Iterator(action) => self.close_iterator(*action, pending_throw),
                Exit::Handler(_) => unreachable!("skipped above"),
            };
            self.exits.extend(above);
            lowered?;
            if self.is_terminated() {
                return Ok(());
            }
        }
        Ok(())
    }

    /// Give a handler its parameters and fill in the arguments every edge owes.
    ///
    /// Returns the parameter holding the thrown value, and sets `self.bindings`
    /// to what the handler's first statement sees.
    pub(super) fn open_handler(
        &mut self,
        handler: BlockId,
        frame: &Handler,
        entry: &rustc_hash::FxHashMap<u32, ValueId>,
        origin: &Origin,
    ) -> ValueId {
        // The thrown value first, so its position does not depend on how many
        // names the edges disagreed about.
        let thrown = self.push_block_param(handler, HirType::Erased, origin.clone());

        // Sorted, for the same reason the merge in `lower_if` sorts: the source
        // is a hash map, and a parameter list that varies between runs would
        // stop the snapshot digest being a cache key.
        let mut names: Vec<u32> = entry.keys().copied().collect();
        names.sort_unstable();

        // A rejection is an edge for the purpose of this list. Its arguments go
        // into the operation rather than onto a terminator, but the *names it
        // disagrees about* have to be parameters exactly as a `throw`'s do --
        // otherwise a handler reached by both reads a name at whatever the last
        // `throw` left, and the rejection path sees a value from the wrong
        // control flow.
        let snapshots: Vec<&rustc_hash::FxHashMap<u32, ValueId>> = frame
            .edges
            .iter()
            .map(|edge| &edge.bindings)
            .chain(frame.rejections.iter().map(|it| &it.bindings))
            .collect();

        let at = |bindings: &rustc_hash::FxHashMap<u32, ValueId>, symbol: u32| {
            bindings
                .get(&symbol)
                .copied()
                .or_else(|| entry.get(&symbol).copied())
        };

        let mut disagreed = Vec::new();
        let mut bindings = entry.clone();
        for symbol in names {
            let mut values = snapshots.iter().filter_map(|it| at(it, symbol));
            let Some(first) = values.next() else {
                continue;
            };
            if values.all(|value| value == first) {
                // Every edge arrives with the same value, so the handler can
                // read it directly. This is most names, and each one is a
                // parameter and an argument per edge that never exist.
                bindings.insert(symbol, first);
            } else {
                disagreed.push(symbol);
            }
        }

        for &symbol in &disagreed {
            let ty = snapshots
                .iter()
                .find_map(|it| at(it, symbol))
                .map_or(HirType::Erased, |value| {
                    self.values[value.0 as usize].ty.clone()
                });
            let param = self.push_block_param(handler, ty, origin.clone());
            bindings.insert(symbol, param);
        }

        // What each `await` in the body owes this handler, written into the
        // operation because the block a rejection leaves does not exist yet.
        // The reason takes slot zero, matching `thrown` above; `suspend` fills
        // it with the value the settled promise carried.
        let rejections: Vec<(ValueId, Vec<ValueId>)> = frame
            .rejections
            .iter()
            .map(|it| {
                let mut args = Vec::with_capacity(1 + disagreed.len());
                args.push(thrown);
                args.extend(
                    disagreed
                        .iter()
                        .map(|symbol| at(&it.bindings, *symbol).unwrap_or(thrown)),
                );
                (it.at, args)
            })
            .collect();
        for (awaited, args) in rejections {
            if let OpKind::Await { rejects_to, .. } = &mut self.values[awaited.0 as usize].kind {
                *rejects_to = Some(crate::hir::Rejection {
                    handler,
                    args,
                    reason_at: 0,
                });
            }
        }

        for edge in &frame.edges {
            let mut args = Vec::with_capacity(1 + disagreed.len());
            args.push(edge.thrown);
            args.extend(
                disagreed
                    .iter()
                    .filter_map(|&symbol| at(&edge.bindings, symbol)),
            );
            if let Some(Terminator::Jump { args: slot, .. }) =
                &mut self.blocks[edge.from.0 as usize].terminator
            {
                *slot = args;
            }
        }

        self.bindings = bindings;
        thrown
    }

    /// Bind `catch (e)`'s name to the thrown value.
    fn bind_caught(&mut self, declaration: NodeId, thrown: ValueId) -> Result<(), Diagnostic> {
        // The declaration's own symbol if it carries one, and otherwise its
        // name's -- the same two places every other binding is read from.
        let symbol = self.node(declaration).symbol.or_else(|| {
            self.children(declaration)
                .first()
                .and_then(|&name| self.node(name).symbol)
        });
        let Some(symbol) = symbol else {
            // `catch ({ code })`. The value is there and nothing names it.
            return Err(self.unsupported(declaration, "a `catch` that destructures"));
        };
        let value = self.open_cell(symbol.0, thrown, declaration);
        self.bindings.insert(symbol.0, value);
        Ok(())
    }

    /// Merge the two ways out of a `try`.
    fn join_try(
        &mut self,
        id: NodeId,
        origin: &Origin,
        body: (BlockId, bool, rustc_hash::FxHashMap<u32, ValueId>),
        handler: (BlockId, bool, rustc_hash::FxHashMap<u32, ValueId>),
        entry: rustc_hash::FxHashMap<u32, ValueId>,
    ) {
        let (body_tail, body_open, body_bindings) = body;
        let (handler_tail, handler_open, handler_bindings) = handler;
        if !body_open && !handler_open {
            // Both ways out ended in a `return` or a `throw`. Anything after
            // the `try` is unreachable and the block is already closed.
            return;
        }

        let merge = self.new_block();
        let mut merged: Vec<(u32, ValueId, ValueId)> = Vec::new();
        let mut live = entry;
        if body_open && handler_open {
            for (symbol, entering) in &mut live {
                let from_body = body_bindings.get(symbol).copied().unwrap_or(*entering);
                let from_handler = handler_bindings.get(symbol).copied().unwrap_or(*entering);
                if from_body == from_handler {
                    // Both exits may agree on a value written after entry.
                    // It needs no phi, but must still replace the entry value.
                    *entering = from_body;
                } else {
                    merged.push((*symbol, from_body, from_handler));
                }
            }
            merged.sort_unstable();
        }

        let mut params = Vec::new();
        for (symbol, from_body, from_handler) in &merged {
            let ty = self.merged_type(id, *symbol, *from_body, *from_handler);
            params.push((*symbol, self.push_block_param(merge, ty, origin.clone())));
        }

        if body_open {
            self.switch_to(body_tail);
            let args = merged.iter().map(|(_, from_body, _)| *from_body).collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }
        if handler_open {
            self.switch_to(handler_tail);
            let args = merged
                .iter()
                .map(|(_, _, from_handler)| *from_handler)
                .collect();
            self.terminate(Terminator::Jump {
                target: merge,
                args,
            });
        }

        self.switch_to(merge);
        self.bindings = match (body_open, handler_open) {
            (true, false) => body_bindings,
            (false, true) => handler_bindings,
            _ => {
                for (symbol, param) in params {
                    live.insert(symbol, param);
                }
                live
            }
        };
    }
}
