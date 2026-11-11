//! Select the raising entry or refuse an uncarryable call, and emit the raised-result test.

use super::{
    A_FUNCTION_WRITTEN_AS_A_VALUE, BinOp, Diagnostic, Edge, Exit, FuncBuilder, HirType, MemberKey,
    NodeId, OpKind, Origin, RAISING_SUFFIX, THROUGH_A_FUNCTION_VALUE, Terminator, TypeId, TypeKind,
    ValueId, a_copy_can_be_made_of, a_declaration_that_can_raise, a_value_held_call,
    access_families, calls_in_the_body_of, children_that_run, erased_calls, interface_member_of,
    is_generic_function, literal_methods, members_filling, planned_callee, raising_callees_of,
    syntax,
};

impl FuncBuilder<'_> {
    /// The first call anywhere inside `node`, if there is one.
    ///
    /// Returns the *call* rather than a bool so the refusal can point at it: a
    /// diagnostic on the `try` sends a reader looking at the wrong line, and
    /// the whole point of the refusal is which call it is.
    ///
    /// A `new` counts. It runs a constructor, and a constructor throws as
    /// readily as anything else -- `new ERR_INVALID_ARG_TYPE(...)` is how this
    /// corpus raises most of its errors.
    ///
    /// Only a call into code **this program compiles**, which is the difference
    /// between a refusal and a regression. `try { throw new RangeError(m) }
    /// catch { }` is the commonest shape there is and it *works*: the throw and
    /// the handler are in one function, and a provided error's constructor is
    /// emitted inline by this compiler and cannot throw. A runtime helper
    /// cannot either -- it aborts where it refuses, which is not a `throw` and
    /// reaches no handler by design. Refusing those would have cost the working
    /// half to fix the broken one.
    pub(super) fn call_within(
        &self,
        node: NodeId,
        handled: &mut Vec<NodeId>,
    ) -> Option<(NodeId, String)> {
        let implicit = self.implicit_iterator_callees(node);
        if !implicit.is_empty() {
            if implicit
                .iter()
                .any(|declaration| !self.raising.contains(declaration))
            {
                return Some((
                    node,
                    "an implicit iterator call whose raising entry is unavailable".to_owned(),
                ));
            }
            handled.push(node);
        }
        if !self.printers.at(node).is_empty() {
            return children_that_run(self, node)
                .into_iter()
                .find_map(|child| self.call_within(child, handled));
        }
        if matches!(
            self.kind_of(node),
            Some(
                syntax::CALL_EXPRESSION
                    | syntax::NEW_EXPRESSION
                    | syntax::TAGGED_TEMPLATE_EXPRESSION
            )
        ) && self.calls_compiled_code(node)
        {
            // **Unless a raising copy of the callee exists**, in which case
            // this call names it and is followed by a test -- which is the
            // handler edge the refusal below exists for the absence of. The
            // same walk decides both so that the set of calls this `try`
            // handles and the set it refuses cannot drift apart.
            //
            // **And then the children that run before it**, whichever arm handles
            // it: the receiver and the arguments are evaluated before the call, so
            // a `throw` in `outer(argument(n))`'s `argument` reaches this handler
            // too -- and returning here left `argument` unexamined and unnamed, so
            // its `throw` ended the program where node catches.
            if self.has_a_raising_copy(node) {
                handled.push(node);
                return children_that_run(self, node)
                    .into_iter()
                    .find_map(|child| self.call_within(child, handled));
            }
            // **Or the raising uniform entry**, which is the same handler edge
            // through a slot instead of through a name. A raising copy is made of
            // plain functions and a closure's body is not one, so a call reaching
            // one through a function value had nothing to name -- the largest
            // refused shape either test262 corpus has, 548 cases whose only root
            // is this sentence.
            //
            // Decided here rather than at the call, so that the set of calls this
            // `try` handles and the set it refuses are still one answer: the
            // dispatch below reads `raising_calls`, and a site that decided for
            // itself could name the raising slot in a `try` this walk had refused.
            //
            // The slot is the whole condition. `declare_raising_entries` fills it
            // on every layout that fills the ordinary one, so a program that has
            // it has an entry for every callable class -- and a program without it
            // has no closures at all, where the call refuses anyway.
            if self.calls_a_closure(node) {
                if self.hierarchy.raising_call_slot.is_some() && self.hierarchy.closures_carry {
                    handled.push(node);
                    return children_that_run(self, node)
                        .into_iter()
                        .find_map(|child| self.call_within(child, handled));
                }
                // **A fifth answer, and it names a fifth piece of work.** The entry
                // exists and this program may not dispatch at it, because some body
                // it would lower with `raises` set cannot carry what *it* calls --
                // almost always a method or an accessor, which have no raising
                // copies. Its own sentence rather than the one above, because the
                // two are cleared by different work and a census matching on text
                // has to pick one. See `what_holds_the_gate_off` for why the
                // question is asked of the whole program.
                let holder = self
                    .hierarchy
                    .gate_holder
                    .as_deref()
                    .unwrap_or("some closure in this program calls something whose own `throw` cannot be carried");
                return Some((node, format!("through a closure, and {holder}")));
            }
            return Some((node, self.why_no_raising_copy(node)));
        }
        // **An accessor is a call**, which is the first sentence of
        // `tests/programs/accessors` and was not true of this guard: it matched
        // `CallExpression` and `NewExpression`, and a getter read is a
        // `PropertyAccessExpression`. So `try { return c.checked } catch { }`
        // compiled, and the throw crossed the boundary the refusal exists to
        // name -- **6 of 29 cases declined** where node answers `-1`, on a
        // program the compiler reported as complete. A setter does it too:
        // `try { c.checked = n } catch { }` is the same call under an
        // assignment.
        //
        // It reads as a property everywhere except where it matters, which is
        // exactly what the accessors example warns about one level down --
        // "laying `doubled` out as a field and emitting a load for `b.doubled`
        // would read whatever happens to sit at that offset". The guard made
        // the same mistake about control flow rather than about storage.
        if self.reads_an_accessor(node) {
            // **An accessor that cannot raise is nothing for this `try` to do**, and it
            // is not pushed: nothing to name and nothing to test, which is the same
            // answer `calls_compiled_code` gives a pure call in the arm above. Without
            // it `return box.plain` was refused beside the throwing getter, because a
            // quiet accessor is in no `copyable` set and so has no copy to find.
            if !self.an_accessor_that_can_raise(node) {
                return children_that_run(self, node)
                    .into_iter()
                    .find_map(|child| self.call_within(child, handled));
            }
            // **Handled where the accessor has a copy**, which it can now:
            // `lower_class` builds one for a `get` or a `set` as it does for a method,
            // `accessor_callee` names it, and the flag test follows the call. Decided
            // here for the reason the call arm above gives -- this walk fills
            // `raising_calls` and the site reads it, so a site cannot name a copy
            // inside a `try` this walk refused.
            if self.has_a_raising_copy(node) {
                handled.push(node);
                return children_that_run(self, node)
                    .into_iter()
                    .find_map(|child| self.call_within(child, handled));
            }
            return Some((node, "an accessor, which is a call".to_owned()));
        }
        // **So is a comparator**, where every other array callback is not:
        // `map`'s is lowered into the loop, so its `throw` is this function's
        // and reaches the handler; `sort` *calls* its comparator
        // (`lower_sort_with`), so a `throw` in it crosses a call like any other.
        if self.sorts_with_a_comparator(node) {
            // **A closure call in all but spelling, and it takes the same answer.**
            // `lower_sort_with` dispatches the comparator at the uniform raising entry
            // through `call_a_closure_entry`, which carries a `throw` exactly as a call
            // through a function value does -- so the condition is the slot's, as it is
            // for `calls_a_closure` above, and for the same reason: this walk decides,
            // and the site reads `raising_calls`.
            if self.hierarchy.raising_call_slot.is_some() && self.hierarchy.closures_carry {
                handled.push(node);
                return children_that_run(self, node)
                    .into_iter()
                    .find_map(|child| self.call_within(child, handled));
            }
            return Some((node, "a `sort` comparator, which is called".to_owned()));
        }
        // Not into a nested function: a closure written inside a `try` is not
        // *called* by it, and refusing on one would refuse every `try` holding
        // a callback that runs somewhere else entirely.
        if matches!(
            self.kind_of(node),
            Some(
                syntax::FUNCTION_DECLARATION | syntax::FUNCTION_EXPRESSION | syntax::ARROW_FUNCTION
            )
        ) {
            return None;
        }
        // **`children_that_run`, because a `try` whose dead branch is inline was
        // still refused.** `f7c244445` gave the two *analyses* this treatment and
        // left the walk that refuses the `try` itself reading every child -- so a
        // dead branch in a **callee** cleared and a dead branch in the `try`'s own
        // body did not. The React lane measured the difference: 49 `try`s in
        // `ReactFiberCommitEffects.ts` write `try { … if (isDevelopment) { destroy =
        // runWithFiberInDEV(…) } … }` **inline**, which is the shape my fixture did
        // not have, and every one stayed refused.
        children_that_run(self, node)
            .into_iter()
            .find_map(|child| self.call_within(child, handled))
    }

    /// Whether `node` is `xs.sort(compare)` or `xs.toSorted(compare)` on an
    /// array: the calls [`Self::lower_sort_with`] makes into the comparator.
    fn sorts_with_a_comparator(&self, node: NodeId) -> bool {
        if self.kind_of(node) != Some(syntax::CALL_EXPRESSION) || self.arguments_of(node).is_empty()
        {
            return false;
        }
        let Some(&callee) = self.children(node).first() else {
            return false;
        };
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return false;
        }
        let children = self.children(callee);
        let named = children
            .last()
            .and_then(|member| self.literal_name(*member))
            .is_some_and(|name| name == "sort" || name == "toSorted");
        let on_an_array = children
            .first()
            .and_then(|receiver| self.snapshot.node_types.get(receiver))
            .is_some_and(|ty| {
                matches!(
                    self.snapshot
                        .types
                        .get(ty.0 as usize)
                        .map(|record| &record.kind),
                    Some(TypeKind::Array(_) | TypeKind::Tuple(_))
                )
            });
        named && on_an_array
    }

    /// Why this call has no raising copy, in the words that name the repair.
    ///
    /// **The refusal used to say only that a throw would not reach the handler**,
    /// which is a fact about the `try` and not about what is missing. The React
    /// lane derived the distinction below by reading their own source for 14
    /// blockers -- ten closures, one method, three both -- work the message
    /// should have done, and which a census cannot do at all.
    ///
    /// The four answers are four different pieces of work, and that is the point
    /// of separating them: a closure needs a raising variant reachable through a
    /// dispatch slot, a method needs `raising_copies` to cover more than
    /// `FUNCTION_DECLARATION`, and a plain function that lost the fixpoint needs
    /// whatever *it* calls fixed first. The sentences are deliberately not
    /// prefixes of one another, so a census matching on text has to pick one.
    fn why_no_raising_copy(&self, call: NodeId) -> String {
        match self.reason_without_a_leaf(call) {
            Some(local) => local.to_owned(),
            // A plain function that was eligible and lost the fixpoint: it calls
            // something that can raise and cannot be copied. The repair is that
            // callee's, not this call's, which is why the sentence points down
            // -- and names what it points at.
            //
            // **The leaf is the whole value of this arm.** Without it the React
            // lane had 12 of 14 blockers saying "something further down", which
            // is the sentence they had already derived by reading source. With
            // it, a census classifies itself.
            None => match self
                .snapshot
                .call_targets
                .get(&call)
                .and_then(|target| target.callee)
                .and_then(|declaration| {
                    let mut seen = rustc_hash::FxHashSet::default();
                    self.the_leaf_that_cannot_be_carried(declaration, 0, &mut seen)
                }) {
                Some((name, why)) => format!(
                    "a function that itself calls something whose `throw` cannot be carried: \
                     `{name}`, {why}"
                ),
                None => "a function that itself calls something whose `throw` cannot be carried"
                    .to_owned(),
            },
        }
    }

    /// Why this call has no raising copy, **without looking down the chain**.
    ///
    /// `None` is the transitive case: a plain function that was eligible and lost
    /// the fixpoint. Split out because the leaf walk has to ask this question of
    /// every call it passes, and asking [`Self::why_no_raising_copy`] instead is
    /// mutual recursion with the bound on the wrong edge -- which is exactly what
    /// it was, and it overflowed the stack on the React lane's reconciler at
    /// about 38,760 frames. The depth counter was incremented on the walk's own
    /// recursive call and reset to zero every time the sentence was rebuilt, so
    /// a cyclic call graph -- `commitRoot` and `flushPendingEffects` call each
    /// other -- never reached the limit.
    ///
    /// A bound has to sit on every edge of the cycle it bounds, and the cheapest
    /// way to be sure of that is for the walk to have one entry point.
    /// Whether this call's callee is a **closure object** at run time, however the
    /// checker resolved it: a value it has no body for, or an arrow or function
    /// expression it does.
    ///
    /// **The distinction the two sentences draw does not survive here**, and that is
    /// the point. `(() => { … })()` and `try { held() }` have a body the checker can
    /// name, and `fn()` on a parameter does not -- but every one of them is a closure
    /// when it runs, and a closure has an entry at
    /// [`Hierarchy::raising_call_slot`](super::Hierarchy::raising_call_slot). So a raising body can carry all three, which
    /// is what an **IIFE inside a `try`** needed: the conformance lane counts 48
    /// test262 files whose gate nothing else holds down.
    /// **By value, and `std::ptr::eq` here made the compiler's answer depend on the
    /// build profile.** A `const` `&'static str` is inlined at each use, and whether
    /// the duplicates are merged into one address is the linker's business: the
    /// release profile (`lto = "thin"`, `codegen-units = 1`) merges them and the dev
    /// profile does not. So this read `true` under `cargo build --release` and
    /// `false` under `cargo test`, and `tests/programs/an-iife-inside-a-try` compiled for
    /// the gate and refused three of its arms for its own unit test -- one program,
    /// two answers, decided by a flag in `Cargo.toml`.
    ///
    /// Found by adding an IIFE arm to a second example and watching the test
    /// contradict `nts hir` on the same file; the two sets the gate is built from
    /// were identical in both profiles, which is what localised it here.
    ///
    /// A comparison of two distinct string constants, which is what this is, cannot
    /// have the same problem -- and the constants stay the single source of the
    /// sentence, which is the reason they exist.
    fn calls_a_closure(&self, call: NodeId) -> bool {
        !erased_calls::inline_method(self, call)
            && self.kind_of(call) == Some(syntax::CALL_EXPRESSION)
            && self.reason_without_a_leaf(call).is_some_and(|why| {
                why == THROUGH_A_FUNCTION_VALUE || why == A_FUNCTION_WRITTEN_AS_A_VALUE
            })
    }

    pub(super) fn reason_without_a_leaf(&self, call: NodeId) -> Option<&'static str> {
        // **A callee held in a value has a declaration and it is not a body.** The
        // checker resolves `fn()` where `fn: () => void` to that *type*'s
        // signature, whose declaration is the function-type annotation -- a node
        // no arm below matches, so the sentence fell through to the transitive
        // one and said "something whose `throw` cannot be carried" with no leaf
        // to name. Asked of the callee expression instead, which is where the
        // fact is: a name declaring a value is a value, whatever the checker
        // found for its type. See `calls_compiled_code`, which draws the same
        // line for the same reason.
        //
        // **A parameter was the only kind this asked about, and that was the
        // escape.** `const f = this.cb; f(n)` is the same fact about the same
        // call -- a function arrives at run time and no walk can say which -- and
        // because this said no, `calls_a_closure` said no, so
        // `dispatches_to_a_raising_entry` left the call at the *ordinary* uniform
        // entry inside a raising copy and the `throw` ended the program: 8 of 29
        // cases where node answers `-1`. One predicate for it now
        // ([`a_value_held_callee`]) with four readers, rather than one kind named
        // here and the rest left to a lookup that cannot see them.
        //
        // **And asked through [`a_value_held_call`]**, which looks through a cast and
        // reads an element as a value. This asked the callee's own symbol, so a `try`
        // directly around `queue[i]!()` fell to the checker's target -- the
        // function-type annotation, which no arm matches -- and was refused as
        // "neither a plain function nor a method" while the gate, asking the shared
        // predicate, carried the same call.
        if a_value_held_call(self.snapshot, self, call) {
            return Some(THROUGH_A_FUNCTION_VALUE);
        }
        let Some(declaration) = self
            .snapshot
            .call_targets
            .get(&call)
            .and_then(|target| target.callee)
        else {
            // No declaration to copy: the callee arrived as a value. Every
            // component and every effect in a React render is one of these.
            return Some(THROUGH_A_FUNCTION_VALUE);
        };
        match self.kind_of(declaration) {
            // **No arm for a `MethodDeclaration` any more.** It said "a method, and a
            // raising copy is made of plain functions only", which `eb92ee8f9` made
            // false: a method is copied. What is left when a method has no copy is
            // that it *lost the fixpoint*, which is its callee's reason and not the
            // method's -- so `None`, and the walk below names the leaf, exactly as it
            // does for a plain function. Keeping the arm described 746 occurrences
            // with a sentence about a limitation that no longer exists, and pointed
            // every reader at the wrong piece of work.
            // **And no arm for a `Constructor` any more either**, for the reason the
            // paragraph above gives about a method -- one construct over and a week
            // later. A `new` names `{owner}#constructor` directly, so its raising copy
            // is reached by naming it, and what is left when a constructor has no copy
            // is that it *lost the fixpoint*: its callee's reason, which the walk below
            // names. The old sentence described a limitation that never existed in the
            // form it claimed, and it stood at 21 occurrences in `stream`, 35 in `fs`,
            // 21 in `web-platform` and 14 in `assert`, pointing every reader at a
            // "`new` has no name to suffix" problem that `lower_new` disproves on the
            // line that spells the name.
            Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR) => {
                Some("an accessor, and a raising copy is made of plain functions only")
            }
            Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION) => {
                Some(A_FUNCTION_WRITTEN_AS_A_VALUE)
            }
            // A plain function that was eligible and lost the fixpoint: the
            // repair is its callee's, not this call's. `None`, so the caller
            // walks down and names the leaf.
            _ => None,
        }
    }

    /// The call at the bottom of a transitive refusal, and why **it** cannot be
    /// carried.
    ///
    /// Walks down the declarations rather than up: each step asks the same
    /// question `call_within` asks of a `try`, so the leaf this names is the one
    /// a reader would find by following the chain by hand. The first
    /// non-transitive answer wins, which is the one that names a piece of work.
    ///
    /// **Bounded twice, and the two bounds do different jobs.** The visited set
    /// is what makes it terminate: a real call graph has cycles --
    /// `commitRoot` and `flushPendingEffects` call each other, and a scheduled
    /// closure reaches back to `performWorkOnRoot` -- and with it the recursion
    /// is bounded by the number of distinct functions. The depth is only about
    /// stack frames, so it is **sixty-four** and not eight: React's reconciler
    /// reaches its `try` through nine frames and a leaf below that, and at eight
    /// the walk gave up and named nothing on every one of its blockers. Sixty-four
    /// Rust frames is nothing against the 38,760 the unbounded version reached.
    ///
    /// The first version had the depth counter and overflowed the stack anyway,
    /// at about 38,760 frames on the React lane's reconciler: it asked
    /// `why_no_raising_copy` for each call, and that rebuilt the sentence by
    /// calling *back* into this walk with `depth` reset to zero. A bound has to
    /// sit on every edge of the cycle it bounds. Hence
    /// [`Self::reason_without_a_leaf`], which never recurses, and one entry
    /// point here.
    /// Why no copy can be made of this declaration, when none can.
    ///
    /// The three conditions `can_be_copied` tests, as sentences. It is a predicate
    /// and this is its prose, kept adjacent so a condition added there is a
    /// condition a reader here can see is missing.
    ///
    /// `None` where a copy *could* be made, which is the case where the leaf is
    /// further down and the walk should keep going.
    fn why_not_copyable(&self, declaration: NodeId) -> Option<&'static str> {
        // **The predicate first, and the sentences only as its prose.** The doc above
        // says a condition added to `a_copy_can_be_made_of` is one a reader here can
        // see is missing -- and when `eb92ee8f9` added the method, this still read
        // "which is not a plain function", so every method that merely lost the
        // fixpoint was described as a shape that is never copied. Asking the predicate
        // means a new kind falls through to the general sentence below instead of
        // being lied about.
        if a_copy_can_be_made_of(self.snapshot, self, declaration) {
            return None;
        }
        if is_generic_function(self.snapshot, declaration) {
            return Some("a generic method, whose own type parameters have no instantiations here");
        }
        if self
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::ASYNC)
        {
            return Some(
                "`async`, so its `throw` rejects the promise it returned rather than raising",
            );
        }
        // **An interface's member is not "neither": it is a method whose bodies belong to
        // somebody else.** The general sentence below described it as a shape that is
        // never copied, which is the mistake this function's own doc records `eb92ee8f9`
        // making about a method -- one kind further out. What is true is that the call
        // reaches the *implementors*, each of which is an ordinary method with an ordinary
        // copy, and that nothing offers those copies: `raising_copies` is seeded from the
        // callee the checker resolved, and for this call that is the body-less signature.
        //
        // `blockers/a-try-around-a-call-on-an-interface-typed-receiver` is the record, and
        // its header names the three things carrying it needs. Saying so here is the
        // difference between a refusal that names the work and one that denies it exists.
        if self.kind_of(declaration) == Some(syntax::METHOD_SIGNATURE) {
            return Some(
                "declared on an interface, so the bodies that would carry it belong to the \
                 implementors and nothing offers their copies",
            );
        }
        Some(
            "which is neither a plain function nor a method, and a raising copy is made of those only",
        )
    }

    fn the_leaf_that_cannot_be_carried(
        &self,
        declaration: NodeId,
        depth: u32,
        seen: &mut rustc_hash::FxHashSet<NodeId>,
    ) -> Option<(String, String)> {
        if depth >= 64 || !seen.insert(declaration) {
            return None;
        }
        // **This declaration itself, when nothing about its *calls* is the
        // problem.** A function that throws and cannot be copied is the leaf, and
        // until now the walk looked only at what it called -- so it fell through
        // to the loop, found every call carryable, and returned `None`. The caller
        // then printed "a function that itself calls something whose `throw`
        // cannot be carried" with nothing named, which is the sentence the React
        // lane had on **nine** `try`s in `ReactFiberCommitEffects.ts` and could not
        // bisect.
        //
        // Reproduced in eleven lines before this existed: a generic `boomGeneric<T>`
        // that throws, called through one plain function inside a `try`. Its
        // suffix is spoken for, so no copy is made, and no arm of
        // `reason_without_a_leaf` covers "not copyable" -- that function answers
        // for the *shape of the call*, and this is a fact about the callee.
        // No "does it throw" test, deliberately: every declaration this walk is
        // handed is the callee of a call `calls_compiled_code` already said can
        // raise -- the loop below guards on it, and so does the caller. So "no
        // copy can be made of it" is on its own the reason the chain stops here.
        if let Some(why) = self.why_not_copyable(declaration) {
            return Some((
                self.declared_name(declaration)
                    .unwrap_or_else(|| "the callee".to_owned()),
                why.to_owned(),
            ));
        }
        for call in calls_in_the_body_of(self, declaration) {
            // **The two shapes `a_copy_can_contain` refuses outright**, named here for
            // the same reason they are refused there: one rule, and now three readers.
            // `calls_compiled_code` answers *no* about `sort` -- it is a runtime
            // helper -- so the loop skipped straight past the one call in the body
            // that cannot be carried and the caller printed "something whose `throw`
            // cannot be carried" with nothing named, which is the sentence this walk
            // exists to replace.
            if self.sorts_with_a_comparator(call) {
                return Some((
                    self.spelled_callee(call),
                    "a `sort` comparator, which is called".to_owned(),
                ));
            }
            if self.reads_an_accessor(call) {
                return Some((
                    self.spelled_callee(call),
                    "an accessor, which is a call".to_owned(),
                ));
            }
            if self.has_a_raising_copy(call) || !self.calls_compiled_code(call) {
                continue;
            }
            match self.reason_without_a_leaf(call) {
                Some(why) => return Some((self.spelled_callee(call), why.to_owned())),
                // Transitive again: keep going down rather than naming a frame
                // the reader would have to walk through anyway.
                None => {
                    if let Some(next) = self
                        .snapshot
                        .call_targets
                        .get(&call)
                        .and_then(|target| target.callee)
                        && let Some(found) =
                            self.the_leaf_that_cannot_be_carried(next, depth + 1, seen)
                    {
                        return Some(found);
                    }
                }
            }
        }
        None
    }

    /// How a call's callee is written, for a diagnostic to name it by.
    ///
    /// `effect.create` rather than `create`, because the receiver is what tells
    /// a reader which call this is -- and a member's own text is all the node
    /// carries, so the two halves are read separately and joined.
    fn spelled_callee(&self, call: NodeId) -> String {
        let Some(callee) = self.children(call).first().copied() else {
            return "the call".to_owned();
        };
        if let Some(text) = self
            .node(callee)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
        {
            return text;
        }
        let parts = self.children(callee);
        match parts.as_slice() {
            [object, member] => {
                let object = self
                    .node(*object)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map_or_else(|| "_".to_owned(), str::to_owned);
                let member = self
                    .node(*member)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map_or_else(|| "_".to_owned(), str::to_owned);
                format!("{object}.{member}")
            }
            _ => "the call".to_owned(),
        }
    }

    /// Whether this call names a raising copy, as a suffix to append.
    ///
    /// Two sources, and they are the two halves of the invariant on
    /// [`Self::raises`]. A `try` registers the calls in its own body, which is
    /// what lets an ordinary function reach a copy at all. **And a raising copy
    /// names copies throughout its body**, guarded or not: a call it leaves
    /// plain would end the program from inside a `try` that compiled, which is
    /// the one outcome worse than the refusal this replaced.
    ///
    /// `Throwing::copyable` is what makes the second safe -- a copy exists for
    /// every raiser a copy can reach, by construction -- and
    /// `has_a_raising_copy` is still asked, because a callee that cannot raise
    /// has no copy and wants none.
    ///
    /// One function rather than a set the naming reads and the test reads
    /// again: the two answering differently is a call that names a copy and
    /// does not test, or tests and does not name one.
    pub(super) fn raising_suffix_of(&self, call: NodeId) -> &'static str {
        // **`has_a_raising_copy` on both sides, because a suffix is a *name*.**
        // `raising_calls` used to imply it -- `call_within` only put a call there
        // when a copy of its callee existed -- and no longer does: a call through a
        // function value is in that set and has no name to suffix. Asking the same
        // question in both branches keeps this answering "is there a copy called
        // this" rather than "is this call followed by a test", which is
        // [`Self::tested_for_a_raise`] and is now a wider set.
        let names_one =
            self.has_a_raising_copy(call) && (self.raising_calls.contains(&call) || self.raises);
        if names_one { RAISING_SUFFIX } else { "" }
    }

    /// Whether this call dispatches through [`Hierarchy::raising_call_slot`](super::Hierarchy::raising_call_slot)
    /// rather than through the ordinary uniform entry.
    ///
    /// Two ways in, and they are the two things a handler edge can come from:
    ///
    ///   the `try` around it   `lower_try` recorded the call in `raising_calls`
    ///                         before it lowered the body, so this and the walk
    ///                         that decided the `try` handles it are one answer.
    ///   this body raises      inside a raising copy every call that *can* raise
    ///                         names its raising form, because the copy's contract
    ///                         is to record and return rather than end the program
    ///                         -- see [`Self::raises`]. Without this arm a copy
    ///                         holding such a call would dispatch at the ordinary
    ///                         entry, which calls `nts_uncaught`, and the raise it
    ///                         exists to carry would end the program from inside a
    ///                         `try` that compiled.
    ///
    /// The second arm is what lets `a_copy_can_contain` admit an indirect callee at
    /// all, and those two are one decision: a copy may hold a call it cannot name
    /// exactly because this dispatches it at an entry that can.
    pub(super) fn dispatches_to_a_raising_entry(&self, call: NodeId) -> bool {
        self.hierarchy.raising_call_slot.is_some()
            && (self.raising_calls.contains(&call) || self.raises)
            && self.calls_a_closure(call)
    }

    /// Refuse a call a raising body cannot carry, which is the whole of what makes
    /// that body's contract true.
    ///
    /// A raising body records an uncaught `throw` and returns, and its caller tests
    /// the flag -- so a call inside it that can raise and is **not** followed by that
    /// test is a `throw` that ends the program from inside a `try` that compiled.
    ///
    /// **`raising_copies` guarantees this for a plain function and nothing guaranteed
    /// it for a closure.** `a_copy_can_contain` shrinks the eligible set until every
    /// callee of a copy can be carried; `lower_wanted_closures` builds a raising
    /// variant of every closure it builds, with no eligibility to lose. So a closure
    /// whose body called a **method** got a variant that called that method's plain
    /// entry, and `outcomes/a-throw-one-call-below-a-function-value` is the record --
    /// the conformance lane found it through test262's
    /// `classelementname-abrupt-completion`, one call deeper than any arm I had
    /// written. The differential cannot see it: an abort reads as "the compiled
    /// program declined".
    ///
    /// **Here rather than in `test_for_a_raise`, and that mattered.** The first
    /// version sat there and never fired, because a *method* call does not go through
    /// `push_call` at all -- six entries in the probe, every one from another path.
    /// `lower_call` is the single entry every `CallExpression` passes, so it sees what
    /// the push sites individually do not.
    ///
    /// The refusal becomes the abort entry: `lower_wanted_closures` turns an `Err`
    /// from the raising build into `refuses_to_cross`' shell, so a `try` reaching such
    /// a closure aborts by name instead of losing the `throw`. Measured at **0
    /// reachable entries** across all 29 runtime corpora.
    pub(super) fn a_raising_body_carries_this_call(&self, id: NodeId) -> Result<(), Diagnostic> {
        if !self.raises || self.tested_for_a_raise(id) || erased_calls::inline_method(self, id) {
            return Ok(());
        }
        // **A call through a value is compiled code too, and `calls_compiled_code` is
        // keyed on the callee's declaration, which a value has none of.** So a copy
        // holding `const f = this.cb; f(n)` passed this check, dispatched at the
        // *ordinary* uniform entry and lost the `throw`: 8 of 29 cases ending the
        // program where node answers `-1`, pinned by
        // `blockers/a-callback-held-in-a-field-with-the-raising-gate-off`, whose
        // gate-on sibling in `tests/programs/` agrees with node instead.
        //
        // `a_copy_can_contain` predicts which bodies are safe to copy and this verifies
        // it at the body, which is the division that matters here: the prediction is
        // made before lowering and has to assume the raising uniform entry will take
        // every such call, and `dispatches_to_a_raising_entry` is what actually decides
        // that -- per call, with `calls_a_closure` as its third condition. Where the two
        // part company the answer must be a **refusal**, and only the verifier can give
        // one, because only it has the lowered call.
        if !self.calls_compiled_code(id) && !a_value_held_call(self.snapshot, self, id) {
            return Ok(());
        }
        let why = self.why_no_raising_copy(id);
        Err(self.unsupported(
            id,
            &format!(
                "a call inside a body that carries a `throw` back to its caller, whose own \
                 callee cannot carry one: {why}"
            ),
        ))
    }

    /// Whether this call is followed by the `nts_raising` test.
    ///
    /// The union of the two ways a callee can raise into this body: a *named*
    /// callee whose raising copy this call names ([`Self::raising_suffix_of`]), and
    /// a *value* dispatched at the raising uniform entry
    /// ([`Self::dispatches_to_a_raising_entry`]). One predicate, because the test
    /// and the dispatch disagreeing is a raise nobody looks for or a branch on a
    /// flag nobody sets.
    fn tested_for_a_raise(&self, call: NodeId) -> bool {
        !self.raising_suffix_of(call).is_empty() || self.dispatches_to_a_raising_entry(call)
    }

    /// Whether this call's callee is a plain function with a raising copy.
    ///
    /// The call's *resolved* declaration, not the name at the site: an
    /// `import { validate }` puts a local symbol here and the copy is keyed by
    /// the declaration, which is what `raising_copies` collected and what the
    /// emitted name comes from.
    fn has_a_raising_copy(&self, call: NodeId) -> bool {
        // An inline conversion has implicit printer callees, but the builtin
        // itself has no suffixed entry to name. printer_text tests and throws
        // the callback's pending payload at the conversion boundary instead.
        if !self.printers.at(call).is_empty() || !self.iterators.at(call).is_empty() {
            return false;
        }
        if let Some(structural) = self.calls.structural
            && let Some((suffix, _)) = self.calls.structural(call)
            && planned_callee(self, call)
                .is_some_and(|callee| structural.raising.contains(&(callee, suffix.clone())))
        {
            return true;
        }
        if self.hierarchy.access_families.at(call).next().is_some() {
            return self.hierarchy.access_families.at(call).all(|family| {
                [false, true]
                    .into_iter()
                    .filter(|writes| !writes || family.writes.is_some())
                    .all(|writes| {
                        self.hierarchy
                            .slots
                            .contains_key(&(family.face, family.key(writes), true))
                    })
            });
        }
        // Through [`raising_callees_of`], which is the one place that turns a site into
        // the declarations a copy belongs to: the set was built from the
        // implementation, and a call to an overloaded function resolves to a
        // *signature*, so asking with the resolved node named a copy nobody built.
        //
        // **All of them, which only matters for an accessor**: an access runs a `get`
        // or a `set` and the syntax does not say which, so a site may name a copy only
        // where both halves have one. Where only one does, this says no and
        // `a_copy_can_contain` says no with it -- one rule, so the name a site spells
        // and the carrying a copy is admitted on cannot disagree. For a call the list
        // is at most one and this is the sentence it always was.
        // **An interface member answers through its slot instead**, because
        // `raising_callees_of` cannot answer for it: it has no hierarchy, and neither do
        // two of its three callers -- the copy sets are computed before
        // `collect_hierarchy` runs. So the question "does this site have a raising copy
        // to name" is asked of the one artefact that already encodes the whole answer:
        // the slot. [`raising_member_slots`] numbers it only where **every** class filling
        // it has a copy or cannot raise, which is exactly the condition this needs, and it
        // runs with the hierarchy because that is where the implementors can be named.
        //
        // The symmetric half is [`Self::callee_for`], which dispatches at that slot. Both
        // read the slot rather than re-deriving the family, so a site that names an index
        // and a table that fills one cannot disagree.
        if let Some((root, key)) = interface_member_of(self.snapshot, self, self.hierarchy, call)
            && self.hierarchy.slot_for(root, &key, true).is_some()
        {
            return true;
        }
        let callees = raising_callees_of(self.snapshot, self, call);
        !callees.is_empty() && callees.iter().all(|at| self.raising.contains(at))
    }

    /// The sentence a withheld raising slot refuses with, naming the member that withheld it.
    ///
    /// One phrase with two readers -- [`Self::callee_for`] for a method and
    /// [`Self::accessor_callee`] for a `get`/`set` -- because the two said the same thing in
    /// two spellings and neither said **which** member was the cause. `_read`'s read *"which a
    /// subclass overrides"*, and the subclass it meant was `DuplexSide`.
    ///
    /// Falling back to the unnamed form rather than refusing to refuse: the map is filled by
    /// [`raising_member_slots`](super::raising_member_slots) for a family it skipped, and a site can reach here for a family
    /// that was never a candidate at all -- a member nothing overrides, where the slot is absent
    /// because there was nothing to number. Those are different facts and only one has a
    /// withholder.
    pub(super) fn why_the_raising_slot_is_missing(&self, root: TypeId, key: &MemberKey) -> String {
        match self.withheld.get(&(root, key.to_owned())) {
            Some(withholders) => {
                let first = withholders.first().map_or("", String::as_str);
                let (named, them) = match withholders.len() {
                    1 => (format!("`{first}`"), "it"),
                    2 => (format!("`{first}` and one other"), "them"),
                    many => (format!("`{first}` and {} others", many - 1), "them"),
                };
                format!(
                    "{named} can raise and no copy can be made of {them}, so the whole family's \
                     raising slot is withheld -- it is all of them or none, because any of them \
                     may arrive at this site"
                )
            }
            None => "an override of it can raise and no copy of that override can be made, so \
                     the slot has no raising entry"
                .to_owned(),
        }
    }

    /// The **accessor declarations** a member access runs: a `get`, a `set`, or both
    /// where the member declares both.
    ///
    /// By the member symbol's declarations rather than by the node's shape, because
    /// nothing in the syntax of `c.checked` says whether `checked` is a field or a
    /// `get`. A `set` counts: an assignment to one is a call with the same boundary.
    ///
    /// **The declarations and not a boolean**, because an accessor has a raising copy
    /// now and every set keyed on "the declaration a copy belongs to" has to be able
    /// to name it -- which is [`a_raising_callee_of`](super::raising_copies::a_raising_callee_of)'s sentence, one construct over.
    /// [`Self::reads_an_accessor`] is this asked as a question.
    pub(super) fn accessors_run_by(&self, node: NodeId) -> Vec<NodeId> {
        if self.hierarchy.access_families.at(node).next().is_some() {
            return self
                .hierarchy
                .access_families
                .at(node)
                .flat_map(access_families::Family::accessors)
                .collect();
        }
        if !matches!(
            self.kind_of(node),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
        ) {
            return Vec::new();
        }
        let Some(&member) = self.children(node).last() else {
            return Vec::new();
        };
        let Some(symbol) = self.node(member).symbol else {
            return Vec::new();
        };
        self.snapshot
            .symbols
            .get(symbol.0 as usize)
            .map(|symbol| {
                symbol
                    .declarations
                    .iter()
                    .copied()
                    .filter(|at| {
                        matches!(
                            self.kind_of(*at),
                            Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR)
                        ) && !self.an_objective_c_accessor(*at)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Whether a member access runs an **accessor**, and is therefore a call.
    pub(super) fn reads_an_accessor(&self, node: NodeId) -> bool {
        !self.accessors_run_by(node).is_empty()
    }

    /// Whether the accessor a member access runs can raise.
    ///
    /// **The member's symbol, not the receiver's.** [`a_call_that_can_raise`](super::raising_reachability::a_call_that_can_raise) reads
    /// `children(call).first()`, which for a call is the callee and for an access is the
    /// *object* -- so an access answered about whatever `box` happens to be, which was
    /// harmless only while an accessor was refused before anything asked. A getter that
    /// cannot throw needs no copy and no flag test, and saying otherwise refused
    /// `return box.plain` beside the throwing one.
    fn an_accessor_that_can_raise(&self, access: NodeId) -> bool {
        if self.hierarchy.access_families.at(access).next().is_some() {
            return self
                .hierarchy
                .access_families
                .at(access)
                .flat_map(access_families::Family::symbols)
                .any(|symbol| self.throwing.contains(&symbol));
        }
        self.children(access)
            .last()
            .and_then(|member| self.node(*member).symbol)
            .is_none_or(|symbol| self.throwing.contains(&symbol.0))
    }

    /// Whether an accessor is a binding's for an Objective-C property or a
    /// framework's constant: declared, with no body, in an `objc:` module. Its
    /// read is a message or a load of an extern variable, and neither can
    /// raise into TypeScript -- native code cannot, which `calls_compiled_code`
    /// says of every C call. So `try { label.text } catch {}` needs no handler
    /// edge for it. A class the program writes over an Objective-C one has a
    /// body, and is compiled code like any other.
    fn an_objective_c_accessor(&self, accessor: NodeId) -> bool {
        !self
            .children(accessor)
            .into_iter()
            .any(|part| self.kind_of(part) == Some(syntax::BLOCK))
            && self.in_objc_module(accessor)
    }

    /// Whether a call or `new` reaches a function this program compiles.
    ///
    /// The question behind it is "could this raise a `throw`", and only compiled
    /// code can: a runtime helper aborts rather than throwing, and a provided
    /// error's constructor is emitted inline. A callee with no declarations in
    /// the snapshot is the host's, and a `new` of a provided error is this
    /// compiler's own.
    fn calls_compiled_code(&self, call: NodeId) -> bool {
        if erased_calls::inline_method(self, call) {
            return false;
        }
        // A function value of this program, called through `call` or `apply`.
        if self.through_call_or_apply(call).is_some() {
            return true;
        }
        // A bound foreign member, reached through the binding table. It can
        // raise, and the premise above -- "only compiled code can" -- was
        // written before there was a backend where that is false. A Java method
        // throws; the JVM session found `try { c.parse("abc") } catch {}`
        // compiling clean, emitting no exception table, and aborting where node
        // prints the caught value.
        //
        // **Any** bound member, not only one declaring `throws`. Java's
        // unchecked exceptions are in no `throws` clause -- a
        // `NullPointerException` out of a getter is the ordinary case -- so
        // reading the declaration would be right about the declared half and
        // silently permissive about the rest.
        //
        // Native C is deliberately *not* this. A C function cannot unwind into
        // TypeScript: `tests/interop/native-callback` shows the converse on
        // purpose, containing a `throw` inside a bridge because `longjmp` past a
        // foreign frame skips what it holds. Refusing here would take away every
        // `try` holding a native call. The two are separated by construction
        // rather than by a check: this table is keyed by a *binding*
        // declaration, its `ForeignKind` is `Static`/`Virtual`/`Interface`/
        // `Special`/`Field`/`StaticField` -- JVM member kinds -- and nothing
        // native writes to it, so a C-only program asks an empty map.
        //
        // The same lookup `Callee::External` is resolved with, so this and
        // codegen answer one question rather than two that can disagree.
        if let Some(declaration) = self
            .snapshot
            .call_targets
            .get(&call)
            .and_then(|target| target.callee)
        {
            let at = self.location(declaration);
            if self.foreign.contains_key(&(at.file.0, at.span.end)) {
                return true;
            }
        }
        let Some(callee) = self.children(call).first().copied() else {
            return false;
        };
        // An indirect callee -- `fns[0]()`, `this.handler()` -- has no symbol to
        // ask, and what it reaches is exactly what cannot be known here. Treated
        // as compiled, because the alternative is to assume the one thing this
        // refusal exists because the compiler cannot establish.
        let Some(symbol) = self.node(callee).symbol else {
            return true;
        };
        let Some(record) = self.snapshot.symbols.get(symbol.0 as usize) else {
            return true;
        };
        if record
            .name
            .public_name()
            .is_some_and(crate::hir::builtin::is_error)
        {
            return false;
        }
        // **A symbol is not the same as a function**, and the escape hatch above
        // missed the common case for exactly that reason. `component(props)`
        // where `component` is a *parameter* has a symbol, so it never reached
        // the "no symbol" arm -- and a parameter's symbol is in no `throwing`
        // set, because that set holds functions whose body throws. So the call
        // answered "cannot raise", the `try` around its caller compiled, and the
        // throw escaped **silently**.
        //
        // Reported by the React lane, where it is the whole render path: every
        // function component is called through a value. Their reduction compiles
        // and then declines 6 of 29 cases -- the negative inputs, where node
        // answers -1 and the compiled program has no answer at all.
        //
        // So the question is asked of the *declarations* and not of the symbol's
        // membership: if nothing this symbol declares is a function, the callee
        // arrived as a value and what it reaches "is exactly what cannot be known
        // here" -- which is the sentence the arm above already gives for the
        // no-symbol spelling, now given for both.
        // **A parameter is not a function, and asking a symbol's membership said
        // it could not raise.** `throwing` holds symbols whose *declarations*
        // contain a body that throws; a parameter's symbol has no such
        // declaration, so `fn()` inside `try { fn() } catch` answered "cannot
        // raise", the `try` compiled, and a throw raised by whatever was passed
        // in **escaped the handler with no diagnostic anywhere**:
        //
        //     function call(fn: () => void): number {
        //       try { fn(); } catch (e) { return 1; }
        //       return 0;
        //     }
        //     call(() => { throw new TypeError("x"); })   // node: 1. this: aborts
        //
        // The comment above this line described the fix -- *"if nothing this
        // symbol declares is a function, the callee arrived as a value"* -- and
        // the code asked `!declarations.is_empty()` instead, which is true of a
        // parameter. A sentence describing a repair that is not there is worse
        // than no sentence: it is why this went unfound through the React lane's
        // report of the *same shape* one spelling over.
        //
        // **A parameter only**, deliberately, and the narrowness is what makes it
        // safe. An *imported* function's local symbol declares an import
        // specifier rather than a function and is nevertheless in `throwing`, so
        // a cross-module `try` keeps working -- verified, 29 of 29 against node.
        // A plain non-throwing function keeps compiling, which is
        // `tests/programs/array-buffer`'s shape and the reason the membership test is
        // still asked below. What remains uncovered is a callee held in a
        // *variable* (`const h = cb; try { h() }`), which has the same hole and
        // no witness yet.
        //
        // Found by the conformance lane: it is what `assert.throws` is, so 3,601
        // of test262's 15,078 positive `test/language` cases were going to read
        // as wrong answers with this one bug as the cause.
        //
        // **Unless it is a promise settler**, which is a parameter and is *not a
        // call*: `lower_settler_call` inlines `resolve(v)` into the executor, so
        // there is no callee and nothing to raise. Without this exclusion the
        // refusal took out **246 functions** in `tests/interop/gtk-gir` -- every
        // generated `*_promise` wrapper, whose body is a `try` around the settler
        // it was handed. The gate's interop step is what said so; the corpus
        // census did not, because the GIR bindings are not in it.
        if record
            .declarations
            .iter()
            .any(|at| self.kind_of(*at) == Some(syntax::PARAMETER))
            && !self.settlers.contains_key(&symbol.0)
        {
            return true;
        }
        // **An interface's member signature has no body, so it is in no throwing set --
        // and the implementors are what the call reaches.** See
        // [`Self::an_interface_member_that_can_raise`]: without it, a `try` around a call
        // on an interface-typed receiver compiled with no handler edge and no diagnostic.
        if self.an_interface_member_that_can_raise(call) {
            return true;
        }
        // Not merely "compiled", but **can raise**. `bounded(n)` inside a `try`
        // is a compiled call and a pure one, and refusing it would take a
        // working example away to fix a defect it does not have --
        // `tests/programs/array-buffer` is exactly that shape and caught this.
        !record.declarations.is_empty() && self.throwing.contains(&symbol.0)
    }

    /// Whether this call reaches a member declared on an **interface**, which some class
    /// in this program implements with a body that can raise.
    ///
    /// `sink.take(n)` where `sink: Sink` resolves to `Sink.take`, a `MethodSignature`
    /// with no body -- so it is in no [`Throwing`](super::Throwing) set, [`Self::calls_compiled_code`]
    /// answered "not compiled code", and the `try` around it compiled with **no handler
    /// edge and no diagnostic**: `nts: uncaught RangeError` on 10 of 29 cases where node
    /// answers `-1`. `outcomes/a-try-around-a-call-on-an-interface-typed-receiver` is the
    /// record, with the same call at the *class* type as its measured control.
    ///
    /// **Asked of the implementors rather than of the signature**, which is the only
    /// honest reading: a body-less declaration says nothing about what runs. The
    /// alternative -- treating any callee with no body here as able to raise -- is the
    /// blunt rule, and it was measured at **+32 refusals per module** because that is
    /// also what `arr.push` looks like.
    ///
    /// It needs no test for whether the program *declared* the interface:
    /// [`members_filling`] finds the classes that both descend from it (which
    /// [`Hierarchy::descends_from`](super::Hierarchy::descends_from) answers through `implements_transitively`) and declare
    /// the member, and a frontend-carried face like `Array` has none in this program.
    /// One fewer question asked, and the one asked is the one that matters.
    ///
    /// The two helpers are [`raising_member_slots`](super::raising_member_slots)', unchanged: *which declarations fill
    /// this root's key*, and *can this declaration raise*. A dispatch root is a base class
    /// or an interface and the slot machinery never cared which, so neither does this.
    fn an_interface_member_that_can_raise(&self, call: NodeId) -> bool {
        let Some((ty, key)) = interface_member_of(self.snapshot, self, self.hierarchy, call) else {
            return false;
        };
        if literal_methods::supplies_method_value(self, ty, &key.key) {
            return true;
        }
        members_filling(self.snapshot, self, self.hierarchy, ty, &key)
            .into_iter()
            .any(|at| a_declaration_that_can_raise(self.snapshot, self.throwing, at))
    }

    /// The test a call that named a raising copy is followed by.
    ///
    /// ```text
    ///   %r = call.extern nts_raising()
    ///   br %r != 0, took, carry_on
    /// took:
    ///   %v = call.extern nts_raise_take()
    ///   jump handler(%v, ...)        -- or, with no handler here, a `ret`
    /// carry_on:
    ///   ...
    /// ```
    ///
    /// **Immediately after the call and not at the end of the statement.** The
    /// callee returned a value of the right width and no meaning, so anything
    /// between the call and the test would read it: `f(g())` with `g` raising
    /// would call `f` with a zero. One block boundary per call that can raise,
    /// and none anywhere else in the program.
    ///
    /// `took` exists so that `nts_raise_take` runs only on the raising path.
    /// Clearing the flag is what makes it correct to test again at the next
    /// call, and doing it unconditionally would clear a raise nobody has seen.
    ///
    /// With no handler in this body the branch returns instead, leaving the
    /// flag set for this function's own caller to find. That is reachable only
    /// inside a raising copy, whose callers all test -- see [`Self::raises`].
    pub(super) fn test_for_a_raise(&mut self, id: NodeId) {
        if self.tested_for_a_raise(id) {
            let origin = self.origin(id);
            self.emit_the_raise_test(&origin);
        }
        // **A call that cannot return comes back only by raising**, so the
        // not-raised branch is unreachable and says so. It used to carry on, and
        // whatever the caller did next with the `never` value -- `ret %1` for
        // `() => fail()`, a `convert` for `c ? fail() : n` -- reached every
        // backend, which refuses to materialise one (C NTS2002, the JVM NTS4001),
        // and the closure's raising copy was declined. The rest of the
        // expression is lowered into a block nothing enters, which
        // `prune_unreachable_blocks` removes before a backend sees it.
        if self.type_of(id) == Some(HirType::Never) {
            self.terminate(Terminator::Unreachable);
            let after = self.new_block();
            self.switch_to(after);
        }
    }

    /// Whether a `throw` raised here would reach a handler **in this function**.
    ///
    /// The same walk [`Self::emit_the_raise_test`] makes over `exits`, asked *before* anything
    /// is emitted -- so a site that cannot carry a raise can refuse instead of emitting a step
    /// that drops one.
    ///
    /// **`self.raises` is deliberately not part of it, and the measurement is why.** A raising
    /// copy carries a raise to its caller, so by that reasoning a guarded step inside one should
    /// refuse too -- and a refusal inside a *closure's* raising variant is not a compile-time
    /// refusal at all: `lower_wanted_closures` turns it into `refuses_to_cross`' abort shell, so
    /// a `try` reaching that closure stops the program **at run time**. Measured at two recorded
    /// test262 cases, one of which was a **pass**
    /// (`for-of/generator-next-error.js`, `pass -> no-verdict (crash)`).
    ///
    /// So a refusal inside a raising body is not free the way one at a site is: it trades a
    /// wrong answer for a crash, which is the worse direction. The copy case stays recorded
    /// rather than refused -- `outcomes/a-generator-passed-in-and-stepped-inside-a-try-ends-the-
    /// program` is it -- and what closes it is a raising resumption slot, not a refusal.
    pub(super) fn a_handler_in_this_function_would_catch(&self) -> bool {
        self.exits
            .iter()
            .any(|exit| matches!(exit, Exit::Handler(_)))
    }

    /// The test itself, given an origin: the half a body this compiler *builds*
    /// needs, where there is no call node to ask about.
    ///
    /// See [`Self::test_for_a_raise`] for the shape and for why it goes immediately
    /// after the call. Split out for the forwarding body of a wrapper, whose only
    /// statement is a call it was never given a node for.
    pub(super) fn emit_the_raise_test(&mut self, origin: &Origin) {
        let origin = origin.clone();
        let flag = self.runtime_call(
            "nts_raising",
            Vec::new(),
            HirType::Int {
                bits: 32,
                signed: true,
            },
            origin.clone(),
        );
        let zero = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 32,
                signed: true,
            },
            origin.clone(),
        );
        let raised = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: flag,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let took = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: raised,
            then_target: took,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(took);
        let caught_at = self
            .exits
            .iter()
            .rposition(|exit| matches!(exit, Exit::Handler(_)));
        if let Some(at) = caught_at {
            let thrown = self.runtime_call("nts_raise_take", Vec::new(), HirType::Erased, origin);
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
                thrown,
                bindings: self.bindings.clone(),
            };
            if let Exit::Handler(frame) = &mut self.exits[at] {
                frame.edges.push(edge);
            }
            self.terminate(Terminator::Jump {
                target,
                args: Vec::new(),
            });
        } else {
            let value = self.raised_return(&origin);
            self.terminate(Terminator::Return(value));
        }
        self.switch_to(carry_on);
    }

    /// A call into the C runtime.
    ///
    /// The prototype the backend emits comes from the header, not from this
    /// call site, so an argument that specialization narrowed to an integer
    /// converts at the call the way C converts any argument to a declared
    /// parameter type. Nothing here has to pin its operands to `double`.
    /// What a raising copy returns on the path where it raised.
    ///
    /// **The value is never read.** Its caller tests `nts_raising` first and
    /// goes to its handler, so this exists because a `Return` needs an operand
    /// of the declared type and for no other reason. Zero rather than
    /// `undefined`: a slot of the function's own return type costs one constant
    /// and keeps the function's signature the one every other caller sees,
    /// where an erased `undefined` would change it.
    ///
    /// `None` for a `void` function, which is a `Return` with no operand, and
    /// for a `never` one, which does not return.
    ///
    /// **Every other type has a constant, and needs one.** This used to answer
    /// `None` for a native pointer and a `bigint` too, under a comment calling
    /// both unreachable because `raising_copies` only copies a plain function.
    /// A plain function returns a native pointer as readily as anything: the
    /// GTK corpus harness's recursive `firstButton(widget): GtkButton | null`,
    /// reached from a signal handler, was a raising copy with a bare `ret` on
    /// its raised path -- `ReturnType { found: None }`, invalid HIR in 56 of
    /// the corpus's 59 programs.
    pub(super) fn raised_return(&mut self, origin: &Origin) -> Option<ValueId> {
        let returns = self.returns.clone();
        let kind = match &returns {
            HirType::Bool => OpKind::ConstBool(false),
            // A `bigint` zero is spelled `ConstInt` at its own type, as
            // `lower_absent` spells one.
            HirType::Int { .. } | HirType::BigInt => OpKind::ConstInt(0),
            HirType::Float { .. } => OpKind::ConstFloat(0.0),
            HirType::Erased | HirType::PossiblyUndefined(_) => OpKind::ConstUndefined,
            // A null reference, which is what `nts_uncaught`'s own `detail`
            // argument uses for "no string here": the slot has the right width
            // and nothing reads it. A native pointer's null is the same word.
            HirType::Managed(_) | HirType::NativePointer(_) => OpKind::ConstNull,
            HirType::Void | HirType::Never => return None,
        };
        Some(self.push(kind, returns, origin.clone()))
    }
}
