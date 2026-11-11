//! Preserve evaluation and short-circuiting across optional member, element, and call chains.

use super::{
    BlockId, Branch, Diagnostic, FuncBuilder, HirType, NodeId, OpKind, Terminator, TypeId,
    TypeKind, ValueId, absence_of_member, callable_fields, readable_back, syntax,
};

impl FuncBuilder<'_> {
    /// Whether a node is the tail of an **optional chain**.
    ///
    /// `a?.b.c` short-circuits the *whole* chain: when `a` is absent, `.c` is
    /// not evaluated either. That is a property of the chain rather than of any
    /// one link, so a link built on a node that already carries a `?.` cannot
    /// be lowered as `(a?.b).c` -- that reads a member of the absent value.
    ///
    /// **One derivation, asked wherever a link is built.** `lower_property_access`
    /// had this rule inline, as "is my object a property access whose second
    /// child is `?.`", under a comment stating that "all twenty-six optional
    /// accesses in the node profile are a single link". That precondition
    /// expired when `a?.b()` landed: an optional **call** is a link too, and it
    /// is a `CallExpression`, so the inline test could not see it. Neither could
    /// it see anything asked from `lower_method_call`, which had no test at all.
    ///
    /// Three shapes were reaching code generation as a result, none of them
    /// refused and none of them right -- `a?.m().p` answered `3` where node
    /// answers `-1`, and `a?.m().m2()` and `a?.p.m()` aborted the compiled
    /// program:
    ///
    /// ```text
    ///   a?.m().p      property after an optional call
    ///   a?.m().m2()   call after an optional call
    ///   a?.p.m()      call after an optional property
    /// ```
    ///
    /// An index link is deliberately **not** a caller: `a?.m()[i]` and
    /// `a?.p[i]` agree with node today, so guarding them would refuse working
    /// code to be tidy.
    /// The type of a link of an optional chain in the arm where the chain is
    /// present. The checker types every link after a `?.` with `undefined`
    /// added -- `void | undefined` for `view?.addSubview(b)` -- which is the
    /// chain's absence, answered by the branch around the link. A native
    /// message or function has no `undefined`, and was refused for one.
    ///
    /// With several members left, the union the declaration itself names
    /// (`NSView | null`): the checker interned it, and a type is found by its
    /// members rather than made here.
    pub(super) fn without_chain_absence(&self, link: NodeId, ty: TypeId) -> TypeId {
        if !self.ends_an_optional_chain(link) {
            return ty;
        }
        let kind = |id: TypeId| {
            self.snapshot
                .types
                .get(id.0 as usize)
                .map(|record| &record.kind)
        };
        let Some(TypeKind::Union(members)) = kind(ty) else {
            return ty;
        };
        let rest: Vec<TypeId> = members
            .iter()
            .copied()
            .filter(|m| !matches!(kind(*m), Some(TypeKind::Undefined)))
            .collect();
        let boolean = |id: &TypeId| {
            matches!(
                kind(*id),
                Some(TypeKind::Literal(
                    nts_semantic_schema::LiteralValue::Boolean(_)
                ))
            )
        };
        match rest.as_slice() {
            [] => ty,
            [one] => *one,
            // `true | false` is `boolean`, which the checker keeps as a type
            // of its own rather than as the union it is.
            [a, b] if boolean(a) && boolean(b) => self
                .snapshot
                .types
                .iter()
                .position(|record| matches!(record.kind, TypeKind::Boolean))
                .and_then(|at| u32::try_from(at).ok())
                .map_or(ty, TypeId),
            _ => self
                .snapshot
                .types
                .iter()
                .position(|record| {
                    matches!(&record.kind, TypeKind::Union(other)
                        if other.len() == rest.len() && rest.iter().all(|m| other.contains(m)))
                })
                .and_then(|at| u32::try_from(at).ok())
                .map_or(ty, TypeId),
        }
    }

    /// The `?.` links under `id` along its chain (through each access's object,
    /// each call's callee and each `!`'s operand) whose receiver is not yet
    /// known present, innermost first. Parentheses end a chain, as they end one
    /// in the language: `(a?.b).c` reads `c` of whatever `a?.b` was. A
    /// non-null assertion does not: `a?.b!.c` is one chain, `undefined` when
    /// `a` is absent.
    fn chain_links(&self, id: NodeId) -> Vec<NodeId> {
        let mut links = Vec::new();
        let mut at = id;
        while matches!(
            self.kind_of(at),
            Some(
                syntax::PROPERTY_ACCESS_EXPRESSION
                    | syntax::ELEMENT_ACCESS_EXPRESSION
                    | syntax::CALL_EXPRESSION
                    | syntax::NON_NULL_EXPRESSION
            )
        ) {
            let children = self.children(at);
            if children
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_DOT_TOKEN))
                && !self.chain_present.contains_key(&at)
            {
                links.push(at);
            }
            let Some(&base) = children.first() else { break };
            at = base;
        }
        links.reverse();
        links
    }

    /// Whether `id` is, or ends in, a `?.` link still to be tested.
    pub(super) fn pending_chain(&self, id: NodeId) -> bool {
        !self.chain_links(id).is_empty()
    }

    /// `a?.b.c`, `a?.b?.c()`: an optional chain with a link after a `?.`, as
    /// the one short-circuit the language makes of it. Each `?.` tests its
    /// receiver, innermost first, and an absence makes the whole chain
    /// `undefined` at once; what follows it is lowered in the arm where the
    /// receiver is present, on the receiver the test read. Every merge is at
    /// the chain's own type, so an intermediate link -- `a?.b` of `a?.b?.c`,
    /// which holds both `null` and `undefined` when `b` is nullable -- is never
    /// formed as a value.
    pub(super) fn lower_chain(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let links = self.chain_links(id);
        self.chain_step(id, &links)
    }

    pub(super) fn chain_step(
        &mut self,
        id: NodeId,
        links: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some((&link, rest)) = links.split_first() else {
            return self.lower_expression(id);
        };
        if self.kind_of(link) == Some(syntax::CALL_EXPRESSION) {
            return Err(self.unsupported(link, "an optional call `f?.()` inside a longer chain"));
        }
        let Some(&object) = self.children(link).first() else {
            return Err(self.unsupported(link, "an optional link with no receiver"));
        };
        let receiver = self.lower_expression(object)?;
        let Some(absent) = self.absence_of(object, receiver) else {
            // Never absent: the link is a plain one.
            self.chain_present.insert(link, receiver);
            let value = self.chain_step(id, rest);
            self.chain_present.remove(&link);
            return value;
        };
        let present = self.present_of(object, receiver);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::Chain {
                link,
                receiver,
                present,
                rest: rest.to_vec(),
            },
        )
    }

    /// An optional chain as a statement, whose value is discarded: each
    /// absent link jumps past the rest, and the last is lowered for what it
    /// does. The two absences a chain can end in are one here, since nothing
    /// asks which it was -- the case that makes such a chain's value
    /// unrepresentable, and that a statement never has.
    pub(super) fn chain_for_effect(&mut self, id: NodeId) -> Result<(), Diagnostic> {
        let links = self.chain_links(id);
        let join = self.new_block();
        let entry = self.bindings.clone();
        self.chain_effect_step(id, &links, join)?;
        // A link that assigns a variable would need its value merged at the
        // join, as a conditional's arms are; none is written this way today.
        if self.bindings != entry {
            return Err(self.unsupported(
                id,
                "an assignment inside an optional chain whose value is discarded",
            ));
        }
        self.switch_to(join);
        Ok(())
    }

    fn chain_effect_step(
        &mut self,
        id: NodeId,
        links: &[NodeId],
        join: BlockId,
    ) -> Result<(), Diagnostic> {
        let Some((&link, rest)) = links.split_first() else {
            self.lower_expression(id)?;
            if !self.is_terminated() {
                self.terminate(Terminator::Jump {
                    target: join,
                    args: Vec::new(),
                });
            }
            return Ok(());
        };
        if self.kind_of(link) == Some(syntax::CALL_EXPRESSION) {
            return Err(self.unsupported(link, "an optional call `f?.()` inside a longer chain"));
        }
        let Some(&object) = self.children(link).first() else {
            return Err(self.unsupported(link, "an optional link with no receiver"));
        };
        let receiver = self.lower_expression(object)?;
        let receiver = match self.absence_of(object, receiver) {
            None => receiver,
            Some(absent) => {
                let present = self.present_of(object, receiver);
                let here = self.new_block();
                self.terminate(Terminator::Branch {
                    cond: absent,
                    then_target: join,
                    then_args: Vec::new(),
                    else_target: here,
                    else_args: Vec::new(),
                });
                self.switch_to(here);
                match present {
                    Some(ty) => {
                        let origin = self.origin(link);
                        self.push(OpKind::unerase(receiver), ty, origin)
                    }
                    None => receiver,
                }
            }
        };
        self.chain_present.insert(link, receiver);
        let result = self.chain_effect_step(id, rest, join);
        self.chain_present.remove(&link);
        result
    }

    /// Member `member` of a receiver an optional chain found present: an
    /// Objective-C property's getter, or the program's own member.
    pub(super) fn member_on_present(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
        receiver: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(property) = self.objc_property(object, member)
            && let Some(read) = self.read_objc_property(
                id,
                object,
                &property,
                (!property.is_static).then_some(receiver),
            )?
        {
            return Ok(read);
        }
        // A binding's property read through its getter -- `row?.string`,
        // `label?.label` -- on the receiver the chain found present, at the
        // part of its type that is present: as `label.label` is, and not as a
        // struct field, which a handle has no layout for.
        if self.is_accessor_property(member) {
            let method = self.accessor(member, false).ok_or_else(|| {
                self.unsupported(
                    id,
                    "a read of a native property no @ntsGet names a method for",
                )
            })?;
            let ty = self
                .snapshot
                .node_types
                .get(&object)
                .copied()
                .ok_or_else(|| {
                    self.unsupported(
                        id,
                        &format!(
                            "a native property whose accessor `{method}` has no receiver type"
                        ),
                    )
                })?;
            let ty = self.present_part(ty).unwrap_or(ty);
            if let [slot, name] = method.split_whitespace().collect::<Vec<_>>()[..] {
                let slot: u32 = slot.parse().map_err(|_| {
                    self.unsupported(id, "@ntsGet or @ntsSet naming a slot that is not a number")
                })?;
                return self.lower_slot_accessor(id, member, receiver, ty, (slot, name), None);
            }
            return self.lower_accessor_on(id, receiver, ty, &method, None);
        }
        let name = self
            .literal_name(member)
            .ok_or_else(|| self.unsupported(member, "a computed property name"))?;
        self.member_of(id, receiver, &name)
    }

    pub(super) fn ends_an_optional_chain(&self, id: NodeId) -> bool {
        // A `!` is a link of the chain it sits in, as in `chain_links`.
        if !matches!(
            self.kind_of(id),
            Some(
                syntax::PROPERTY_ACCESS_EXPRESSION
                    | syntax::ELEMENT_ACCESS_EXPRESSION
                    | syntax::CALL_EXPRESSION
                    | syntax::NON_NULL_EXPRESSION
            )
        ) {
            return false;
        }
        let children = self.children(id);
        // `?.` is a token of its own, so `a?.b`, `a?.[i]` and `a?.()` each carry
        // one among their children.
        children
            .iter()
            .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_DOT_TOKEN))
            // And the base of a chain is always child zero -- the object of an
            // access, the callee of a call. **Recursing is what makes this a
            // question about the chain rather than about the last link.** The
            // first version tested only the node itself and missed
            // `a?.p[i].q`, where the optional link is two nodes down: the
            // example written to pin the boundary found it, by disagreeing with
            // node on 5 of 29 cases.
            || children
                .first()
                .is_some_and(|base| self.ends_an_optional_chain(*base))
    }

    /// `a?.b` -- `a.b` unless `a` is absent, and `undefined` when it is.
    ///
    /// The receiver is lowered once, before the test, and read only inside the
    /// arm that established it is present. Which is the same shape `??` has,
    /// and the same absence: a tag on an erased value, a null pointer on a
    /// reference.
    pub(super) fn lower_optional_access(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(&receiver) = self.chain_present.get(&id) {
            return self.member_on_present(id, object, member, receiver);
        }
        if self.pending_chain(object) {
            return self.lower_chain(id);
        }
        let receiver = self.lower_expression(object)?;
        let Some(absent) = self.absence_of(object, receiver) else {
            // A receiver with no room for an absence is never absent, so this
            // is an ordinary access. TypeScript permits the shape and reports
            // it as unnecessary.
            let name = self
                .literal_name(member)
                .ok_or_else(|| self.unsupported(member, "a computed property name"))?;
            return self.member_of(id, receiver, &name);
        };
        let present = self.present_of(object, receiver);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::Member(receiver, member, present),
        )
    }

    /// `xs?.[i]`.
    ///
    /// The same three steps as [`Self::lower_optional_access`], with an element
    /// read where that one has a member read.
    pub(super) fn lower_optional_element(
        &mut self,
        id: NodeId,
        object: NodeId,
        index: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(&receiver) = self.chain_present.get(&id) {
            let index = self.lower_expression(index)?;
            return self.element_of(id, receiver, index);
        }
        if self.pending_chain(object) {
            return self.lower_chain(id);
        }
        let receiver = self.lower_expression(object)?;
        let Some(absent) = self.absence_of(object, receiver) else {
            // A receiver with no room for an absence is never absent, so this
            // is an ordinary read. TypeScript permits the shape and reports it
            // as unnecessary.
            let index = self.lower_expression(index)?;
            return self.element_of(id, receiver, index);
        };
        let present = self.present_of(object, receiver);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::Element(receiver, index, present),
        )
    }

    /// `f?.(x)`.
    ///
    /// The same three steps as [`Self::lower_optional_access`], with the call
    /// where that one has a member read. `f` is a *value* here, so the call in
    /// the present arm is the indirect one through the closure -- the third way
    /// [`Self::call_through_closure`] is come by.
    /// `o.m?.()` where `m` is an **optional method** on `o`'s type.
    ///
    /// Without this the callee is lowered as a *value*: an optional method's
    /// type is `(() => void) | undefined`, a method gets a vtable entry rather
    /// than a field, and the member read finds no slot -- so the refusal is
    /// `` `uncork`, declared by `C` with a type that has no representation (a
    /// union of a function type | undefined) ``, which is a layout question
    /// wearing a representation sentence. **34 distinct sites**, every one of
    /// this shape: `previous.uncork?.()`, `socket.setKeepAlive?.(true, ms)`,
    /// `this.socket?.setNoDelay?.(enable)`.
    ///
    /// The declaration form is the whole difference, and only one of the four
    /// spellings was refused:
    ///
    /// ```text
    /// uncork(): void        required method    compiled
    /// uncork?: () => void   optional property  compiled
    /// uncork?(): void       optional method    refused
    /// ```
    ///
    /// **Presence of an optional method varies per class, not per instance**,
    /// which is what `in` already answers -- and
    /// `if ("uncork" in c) { c.uncork(); }` compiles today. So this is that,
    /// desugared: the same `InstanceOf` over the classes that declare it, and
    /// the ordinary method call in the arm where it is present. No new
    /// representation and no storage: a class either has the slot or does not.
    ///
    /// `None` rather than a refusal for every other shape, so an optional
    /// *property* holding a closure keeps the path it already had.
    fn optional_method_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return Ok(None);
        }
        let parts = self.children(callee);
        let (Some(&object), Some(&member)) = (parts.first(), parts.last()) else {
            return Ok(None);
        };
        if object == member {
            return Ok(None);
        }
        let Some(key) = self.property_key(member) else {
            return Ok(None);
        };
        let Some(&receiver_ty) = self.snapshot.node_types.get(&object) else {
            return Ok(None);
        };
        if let Some(contract) = self.projected_callable(receiver_ty, &key) {
            let receiver = self.lower_expression(object)?;
            return self
                .start_callable(
                    id,
                    receiver,
                    object,
                    member,
                    contract,
                    callable_fields::Action::Call,
                )
                .map(Some);
        }
        if let Some(selector) = self.objc_optional_selector(member) {
            return self
                .objc_optional_call(id, (object, member), &selector)
                .map(Some);
        }
        if !self.declares_an_optional_method(receiver_ty, &key) {
            return Ok(None);
        }
        let Some((receiver, present)) = self.has_the_slot(id, object, &key)? else {
            return Ok(None);
        };
        // `present_of` rather than `None`: where the receiver was itself
        // optional it arrives erased, and the arm that calls has to read the
        // payload back out of the tag before it can dispatch. A singly-optional
        // call's receiver is not erased and this gives `None`, which is what
        // was written there literally before.
        let narrowed = self.present_of(object, receiver);
        self.lower_branching_value(
            id,
            present,
            Branch::MethodOn(receiver, object, member, narrowed),
            Branch::Absent,
        )
        .map(Some)
    }

    pub(super) fn lower_optional_call(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let Some(&callee_node) = self.children(id).first() else {
            return Err(self.unsupported(id, "an optional call with no callee"));
        };
        if let Some(result) = self.optional_method_call(id, callee_node)? {
            return Ok(result);
        }
        let callee = self.lower_expression(callee_node)?;
        // `o.f?.()` passes `o`, as `o.f()` does: the object the read of `o.f`
        // was made on, lowered before anything here branches.
        let this = self.read_from.get(&callee_node).copied();
        if this.is_none() && self.kind_of(callee_node) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            self.check_this_is_passed(id)?;
        }
        let Some(absent) = self.absence_of(callee_node, callee) else {
            // A callee with no room for an absence is always there, so this is
            // an ordinary call. TypeScript permits the shape and reports it as
            // unnecessary.
            let arguments = self.arguments_of(id);
            return self.call_through_closure(id, callee_node, callee, this, &arguments);
        };
        let present = self.present_of(callee_node, callee);
        self.lower_branching_value(
            id,
            absent,
            Branch::Absent,
            Branch::Invoke(callee, callee_node, present),
        )
    }

    /// What an erased receiver is, in the arm a `?.` has established it is
    /// present.
    ///
    /// # Why this is not [`Self::narrowed`]
    ///
    /// That one reads back what the *checker* narrowed, and its licence is
    /// `node_types`: it asks for the type of the very node being read. Here
    /// there is no such node. The checker narrows `v` inside
    /// `if (v !== null && v !== undefined)`, and it does not narrow anything
    /// inside `v?.length` -- the only type it records for that expression is
    /// the type of the whole thing, `number | undefined`, which says nothing
    /// about the receiver.
    ///
    /// So the licence is this lowering's own: [`Self::absence_of`] emitted a
    /// test of the tag against exactly the tags the receiver's type admits as
    /// absences, and this runs in the arm where that test was false. What is
    /// left is the union's non-absent members, and where those share one
    /// representation, that is what the payload holds.
    ///
    /// # What it was worth
    ///
    /// Two refusals with different sentences and one cause. `v?.length` on a
    /// `string | null | undefined` was refused as "`length` of something
    /// without one", and `h?.value` on a `Held | null | undefined` as "a union
    /// whose members lay their fields out differently" -- said of a union with
    /// exactly one object in it. Both were the erased receiver reaching
    /// [`Self::member_of`] still erased, while `Branch::Present` two arms away
    /// had been reading the payload back all along.
    ///
    /// `None` where there is nothing to read back to: a receiver that was never
    /// erased was never tagged, and a payload that is still several things
    /// (`string | number | null`) stays erased in the present arm too. Both are
    /// ordinary answers rather than refusals -- the first needs no unerase and
    /// the second is refused, if at all, by the member read.
    pub(super) fn present_of(&self, object: NodeId, receiver: ValueId) -> Option<HirType> {
        if self.values[receiver.0 as usize].ty != HirType::Erased {
            return None;
        }
        let ty = *self.snapshot.node_types.get(&object)?;
        let TypeKind::Union(members) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let mut shared: Option<HirType> = None;
        for member in members {
            if absence_of_member(self.snapshot, *member).is_some() {
                continue;
            }
            let member = self.represent(*member)?;
            match &shared {
                Some(existing) if *existing != member => return None,
                _ => shared = Some(member),
            }
        }
        shared.filter(readable_back)
    }
}
