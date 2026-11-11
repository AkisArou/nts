//! Classify assignable storage and emit its reads, writes, and deletion, with the binding and property checks those operations require.

use super::{
    Absent, Callee, Declares, Diagnostic, FuncBuilder, HirType, ManagedType, MethodAccessor,
    NodeId, OpKind, Origin, PRESENCE_INDEX, PropertyKey, TypeId, ValueId, access, claimed_reads,
    is_static_member_symbol, property_keys, syntax,
};

/// Why a name is [`Place::Unwritable`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Unwritable {
    /// A binding no assignment may change -- a `const`, a `using`, or the name
    /// a function or class *expression* gives itself. The store throws
    /// `TypeError`, as `PutValue` on an immutable binding does in strict code,
    /// which a module's is.
    Immutable,
    /// A class declaration's name. A class binding is mutable in JavaScript,
    /// and this compiler keeps it as the class -- every read is the class's
    /// own object type -- so a store that would land stops at run time, by
    /// name, where node would have stored it. Not at compile time: a store
    /// from a closure that runs before the class is defined throws
    /// `ReferenceError` and never lands, and refusing it took a program that
    /// agreed with node (`tests/programs/a-lexical-assignment-before-
    /// initialization`'s `capturedClass`).
    ClassName,
}

/// Where an assignment writes.
///
/// Named rather than re-derived, because a compound assignment reads and writes
/// *the same* place: `xs[next()] += 1` calls `next` once in JavaScript, and
/// lowering the target twice would call it twice.
#[derive(Debug, Clone)]
pub(super) enum Place {
    /// A source-proven premature lexical reference. Evaluating the reference
    /// is harmless; GetValue/PutValue throws before any load/coercion/store.
    UninitializedBinding {
        at: NodeId,
        symbol: u32,
        declaration: NodeId,
    },
    /// A name this compiler will not store to, for the reason [`Unwritable`]
    /// gives. Reading it is reading the name. Storing to it first asks what a
    /// store to the binding always asks -- whether it is initialized, which
    /// throws `ReferenceError` before anything else does -- and only then
    /// stops.
    Unwritable {
        at: NodeId,
        symbol: u32,
        why: Unwritable,
    },
    /// A nullable receiver, checked at the read or store, after its operands.
    Checked {
        place: Box<Place>,
        guard: access::Guard,
        key: access::Key,
    },
    NativeElement {
        pointer: ValueId,
        index: ValueId,
    },
    /// A bit-field member: a place with no address.
    ///
    /// Every other native place is a pointer and an index, because every other
    /// member has an address a load or store goes through. A bit-field does
    /// not -- `&p->ihl` is not an expression C has -- so this carries the
    /// record's pointer and the member's index, and its read and write are
    /// their own ops rather than an address followed by one.
    NativeBits {
        pointer: ValueId,
        field: u32,
    },
    Field {
        object: ValueId,
        field: u32,
    },
    /// `xs.length = n` on an **array**, which JavaScript uses to truncate in
    /// place. Not a field store: the element run has to stop being reachable,
    /// so it is the runtime's `nts_array_set_length` family.
    ///
    /// Only for an array receiver. `state.length -= size` in `stream` is an
    /// ordinary object field whose name happens to be `length`, and the type
    /// check is what keeps the two apart.
    ArrayLength(ValueId),
    /// A setter. `o.x = v` where `x` is one runs code, so this is a call with
    /// the receiver and the value as its two arguments.
    ///
    /// The **getter** travels with it, where the same member has one. A plain
    /// `o.x = v` never needs it, but `o.x += 1` and `o.x ??= 1` read before they
    /// write and the read is that call -- and resolving it here rather than at
    /// the assignment is what keeps the two from asking the hierarchy the same
    /// question twice and disagreeing about the answer.
    ///
    /// `None` for a write-only accessor, which TypeScript permits: `set x(v)`
    /// with no `get x`. A compound assignment on one is a read of something
    /// that cannot be read, and is refused as such rather than as the absence
    /// of a field.
    Setter {
        /// **`None` for a `static` accessor**, which has no receiver: `A.base`
        /// is addressed by the class rather than by an instance, and its
        /// function takes the value alone.
        object: Option<ValueId>,
        callee: Callee,
        getter: Option<Callee>,
        /// What the accessor's value is declared as, for the store to coerce
        /// toward.
        ///
        /// `None` while only a plain `o.x = v` reached this place, because the
        /// assignment had already coerced by then. A compound assignment builds
        /// its own value and does not: `??=` on a `number | undefined` accessor
        /// handed the setter an `f64` where it wanted an erased slot, and the
        /// verifier said so as `CallArgumentType { expected: Erased, found:
        /// Float }` rather than the program being wrong at run time.
        wants: Option<HirType>,
        /// The **access node** the two callees were resolved for -- `o.x` in
        /// `o.x = v` -- and therefore the node whose raise is tested after the call.
        ///
        /// Carried rather than taken from the assignment, because they are different
        /// nodes and `raising_calls` holds this one: `lower_try` records what the
        /// `try`'s body *reaches*, which is the access. Testing the assignment's node
        /// instead asked a question nothing had answered, so the call named
        /// `Owner#set x@raises` and **nothing looked at the flag** -- 16 of 32 cases,
        /// with the `try` compiled and the `throw` recorded and dropped. The field is
        /// here so that the callee and the node it was chosen for travel together,
        /// which is `MethodArm`'s argument one enum along.
        at: NodeId,
    },
    /// A native handle's property read before it is written -- GJS's
    /// `page.badge_number -= 1` -- through the methods its `@ntsGet` and
    /// `@ntsSet` name (`lower_accessor_on`), on a receiver evaluated once. A
    /// plain `=` calls the setter itself and never comes here. `getter` is
    /// `None` for a property only written.
    NativeAccessor {
        receiver: ValueId,
        ty: TypeId,
        getter: Option<String>,
        setter: String,
        /// `false` for a setter that is the value itself: `_set_onclick_null`.
        takes_value: bool,
    },
    /// A name a bound type reads and writes through its named-property methods
    /// (`delegated_named`): `el.dataset.userId`, with its name as a constant.
    NamedProperty {
        receiver: ValueId,
        ty: TypeId,
        key: ValueId,
    },
    Element {
        array: ValueId,
        index: ValueId,
    },
    /// `table[key] = value` on a string-keyed table.
    ///
    /// A separate place from `Element` because the write is a *call* rather
    /// than a store: a table has no slot at a computed key until something puts
    /// one there, which is the whole difference between a `Record` and a
    /// struct. Both keys and values cross erased, as every other table
    /// operation's do.
    Entry {
        table: ValueId,
        key: ValueId,
    },
    Global(u32),
    /// A name bound in the function, with the type its declaration gives it.
    ///
    /// A binding is an SSA value rather than a slot, so nothing else records
    /// what it is supposed to hold -- and an assignment has to keep it. The
    /// type is carried here because the *declaration* is where it is written
    /// and the symbol table does not have it: a local's `SymbolRecord.ty` is
    /// `None`.
    Binding {
        at: NodeId,
        symbol: u32,
        ty: Option<HirType>,
    },
}

impl FuncBuilder<'_> {
    /// `delete o.x`, which TypeScript permits only where `x` is optional.
    ///
    /// `TS2790: The operand of a 'delete' operator must be optional` -- so the
    /// property being deleted holds `T | undefined` and has a slot with a tag in
    /// it. Deleting it is writing the `undefined` tag.
    ///
    /// **That precondition is checked here rather than assumed**, and this
    /// paragraph used to read *"always holds"* on the strength of the checker's
    /// refusal alone. A program that suppresses `TS2790` reaches this lowering
    /// with a **required** property, and then `coerce_to_slot` re-makes the
    /// `undefined` at whatever the slot's representation is. That arm is
    /// licensed by the checker having approved an *assignment*; a `delete`
    /// invents the value and nothing approved it. So a required `c: string` took
    /// a null `NtsString *` -- which is neither `undefined` nor a string -- and
    /// the next read of `c` dereferenced it. That is the SIGSEGV
    /// `outcomes/object-entries-after-a-getter-deletes-a-later-key` recorded for
    /// four weeks under the wrong cause -- its header blamed `Object.entries`,
    /// and `delete` alone crashes with no `Object.entries` anywhere in the
    /// program. It is now
    /// `blockers/a-delete-of-a-property-that-is-not-optional`.
    ///
    /// # Why that is the whole of it
    ///
    /// JavaScript distinguishes a deleted property from one set to `undefined`:
    /// `"x" in o` is false after the first and true after the second, and
    /// `Object.keys` differs the same way. This representation cannot tell them
    /// apart -- an optional slot is zeroed at allocation and zero *is* the
    /// `undefined` tag.
    ///
    /// So the conflation would be a wrong answer, except that every operator
    /// that could see it already refuses on an optional property: `in` names it,
    /// `Object.keys` and `Object.hasOwn` name it, and `for...in` is refused
    /// outright. Three refusals that were each argued on their own terms, and
    /// together they are what makes this one sound. If any of them is ever
    /// implemented for an optional property, this becomes wrong on the same day
    /// -- which is why they all name the *property* rather than the feature.
    ///
    /// The result is `true`. In a strict-mode program every deletable property
    /// is configurable, and TypeScript has refused the rest above.
    pub(super) fn lower_delete(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [target] = children.as_slice() else {
            return Err(self.unsupported(id, "a `delete` of unexpected shape"));
        };
        if matches!(
            self.kind_of(*target),
            Some(syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION)
        ) && self
            .children(*target)
            .first()
            .and_then(|receiver| self.type_of(*receiver))
            .is_some_and(|ty| property_keys::string_record_type(&ty))
        {
            let place = self.place_of(*target)?;
            return property_keys::delete(self, id, &place);
        }
        let origin = self.origin(id);
        // A property access only. `delete o[k]` for a computed `k` is a
        // question about a value, and the slot it names is not known here.
        if self.kind_of(*target) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return Err(self.unsupported(
                *target,
                "a `delete` of something other than a named property",
            ));
        }
        // Through `place_of` and `write_place`, which is what an ordinary
        // assignment uses. A setter or an element is refused by the property
        // check above; what reaches here is a field, and `coerce_to_slot` builds
        // the `undefined` at the slot's own representation rather than at a
        // guess.
        let place = self.place_of(*target)?;
        // A name a binding implements through its named-property methods:
        // `delete el.dataset.id` is `DOMStringMap`'s `_named_delete("id")`,
        // and `true`, as page script's always is.
        if let Place::NamedProperty { receiver, ty, key } = place {
            self.call_bound_method(id, receiver, ty, "_named_delete", vec![key])?;
            return Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin));
        }
        let &Place::Field { object, field } = &place else {
            return Err(self.unsupported(
                *target,
                "a `delete` of something that is not a stored field",
            ));
        };
        self.the_absence_has_a_slot(*target, object, field)?;
        let absent = self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone());
        // `coerce_to_slot` and then `field_delete` rather than `write_place`,
        // which is the write path and would record a *write*. The coercion is
        // the same one every store gets: it builds the `undefined` at the slot's
        // own representation rather than at a guess.
        //
        // JavaScript removes a class field like any other, which is why the
        // class case carries a bit at all instead of being answered from the
        // type: `delete b.maybe` after `new Box()` makes `"maybe" in b` false,
        // and no static answer can follow that.
        let absent = self.coerce_to_slot(id, &place, absent)?;
        self.field_delete(object, field, absent, &origin);
        Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin))
    }

    /// Refuses a `delete` whose property has nowhere to record the absence.
    ///
    /// **One question -- is this property optional -- and
    /// [`crate::hir::presence::Presence`] answers it in the three ways that matter**,
    /// which is why it is asked of that rather than of the slot's type. An
    /// optional property's slot is erased *and* carries a bit; a required one's
    /// is the property's own representation, with no room for an absence in it.
    /// Deriving "can this be absent" from the type would be that same fact a
    /// second time, and this file has four defects this week from exactly that.
    ///
    /// Asked of [`Self::presence_of_key`] rather than of
    /// [`Self::presence_bit_of`], which collapses `Always` and `TooMany` into
    /// one `None` **and also gates on `presence_keys`**. That gate is right for
    /// a writer -- a bit nobody tests is a store nobody reads -- and would be
    /// wrong here twice over: it would refuse an optional property whose
    /// presence no `in` asks about, which is representable and correct today.
    ///
    /// Both sentences name the *property* and its type, because the fix is at
    /// the declaration -- `c?: string` rather than `c: string` -- which is also
    /// what TypeScript asks for. So nothing legitimate is refused: every named
    /// `delete` in either runtime corpus is of an optional property, and the
    /// rest are `delete o[k]`, refused above as not a named property.
    fn the_absence_has_a_slot(
        &mut self,
        at: NodeId,
        object: ValueId,
        field: u32,
    ) -> Result<(), Diagnostic> {
        // Unreachable, with a proof rather than an assertion. `place_of` reaches
        // `Place::Field` only through `HirType::Managed(ManagedType::Object)`
        // and a `layout_of` that succeeded, and it took `field` out of that
        // layout's own fields -- so all three of `property_at`'s `None` causes
        // are ruled out before this line. Degraded to today's behaviour rather
        // than panicked on or refused, because a refusal here could name
        // neither the property nor its type: it would be a sentence about the
        // compiler with nothing in it for the reader to fix.
        let Some((ty, key)) = self.property_at(object, field) else {
            return Ok(());
        };
        let who = self.type_in_a_message(ty);
        match self.presence_of_key(ty, &key) {
            Some(crate::hir::presence::Presence::Bit(_)) => Ok(()),
            Some(crate::hir::presence::Presence::TooMany { optional }) => Err(self.unsupported(
                at,
                &format!(
                    "a `delete` of `{key}` on {who}, which declares {optional} optional \
                     properties -- an object header records {}",
                    crate::hir::presence::BITS
                ),
            )),
            // `Always` is "not optional", and `None` is "the program does not
            // carry the layout" -- ruled out above, and it joins the refusal
            // rather than the permission for the reason the block there gives.
            _ => Err(self.unsupported(
                at,
                &format!("a `delete` of `{key}` on {who}, which does not declare it optional"),
            )),
        }
    }

    /// Work out *where* an assignment writes, evaluating the parts that decide
    /// it exactly once.
    ///
    /// Once is the whole point. `xs[next()] += 1` calls `next` a single time in
    /// JavaScript, so the index cannot be lowered again for the store -- and a
    /// compound assignment that re-lowered its target would call it twice.
    /// A `static` field, which is a global, so writing one is a global write.
    ///
    /// The same resolution the read side does, and it has to happen before the
    /// receiver is lowered for the same reason: the receiver is a class *name*,
    /// lowering it asks for a class value, and `Counter.count = n` reported
    /// "`Counter`, a class used as a value" -- a message about a construct the
    /// assignment never wanted. See `collect_static_fields`.
    ///
    /// `None` when the member is not a static field, so the caller carries on.
    fn static_field_place(
        &mut self,
        target: NodeId,
        member: NodeId,
    ) -> Option<Result<Place, Diagnostic>> {
        if let Err(diagnostic) = self.check_class_binding(target) {
            return Some(Err(diagnostic));
        }
        let symbol = self.node(member).symbol?;
        if !is_static_member_symbol(self.snapshot, symbol) {
            return None;
        }
        if let Some(reason) = self.module.unsupported.get(&symbol.0) {
            let reason = reason.clone();
            return Some(Err(self.unsupported(target, &reason)));
        }
        let global = self.module.variables.get(&symbol.0).copied()?;
        Some(Ok(Place::Global(global)))
    }

    /// `xs.length = n` on an array, which is not a field store.
    ///
    /// Asked before the `Object` requirement in [`Self::place_of`], because an
    /// array is not one and would be refused by it. `None` for everything else,
    /// so the rest of that function is untouched -- and that includes
    /// `state.length -= size` in `stream`, an ordinary object field whose name
    /// happens to be `length`.
    fn array_length_place(&mut self, object: ValueId, member: NodeId) -> Option<Place> {
        if !matches!(
            self.values[object.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_))
        ) {
            return None;
        }
        if self.literal_name(member).as_deref() != Some("length") {
            return None;
        }
        Some(Place::ArrayLength(object))
    }

    /// The place `o.x` names, for an assignment.
    ///
    /// Split out of [`Self::place_of`] for its length; that function is the
    /// dispatch over what kind of target this is, and this is one of them.
    /// The place a property of a type a binding implements is written at:
    /// through its bound property's `@ntsSet`, and read through its `@ntsGet`
    /// where the assignment also reads it (`el.scrollTop += 1`); through the
    /// setter a plain `=` picks by the value's type where it has none
    /// (`el.hidden = true`); or through the named-property methods
    /// (`el.dataset.id = v`). `None` for any other property.
    fn delegated_place(
        &mut self,
        target: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Result<Option<Place>, Diagnostic> {
        // The property's own setter, unless what a plain `=` assigns is not
        // what it takes: `fillStyle`'s takes a string, and a gradient is
        // written through the setter that takes one.
        let assigned = self.assigned_value(target);
        if let Some((bound, setter)) = self.delegated_accessor(object, member, true)
            && assigned.is_none_or(|value| {
                crate::hir::native::schema::property(self.snapshot, bound, &setter)
                    .is_some_and(|method| self.method_takes(method, value))
            })
        {
            let getter = self
                .delegated_accessor(object, member, false)
                .map(|(_, getter)| getter);
            let receiver = self.lower_expression(object)?;
            return Ok(Some(Place::NativeAccessor {
                receiver,
                ty: bound,
                getter,
                setter,
                takes_value: true,
            }));
        }
        if let Some(value) = assigned
            && let Some((bound, setter, takes_value)) =
                self.delegated_typed_setter(object, member, value)
        {
            let receiver = self.lower_expression(object)?;
            return Ok(Some(Place::NativeAccessor {
                receiver,
                ty: bound,
                getter: None,
                setter,
                takes_value,
            }));
        }
        if let Some((bound, name)) = self.delegated_named(object, member) {
            let receiver = self.lower_expression(object)?;
            let key = self.push(
                OpKind::ConstString(name.into()),
                HirType::Managed(ManagedType::String),
                self.origin(member),
            );
            return Ok(Some(Place::NamedProperty {
                receiver,
                ty: bound,
                key,
            }));
        }
        Ok(None)
    }

    fn property_place(&mut self, target: NodeId) -> Result<Place, Diagnostic> {
        let children = self.children(target);
        let [object_node, member] = children.as_slice() else {
            return Err(self.unsupported(target, "a property of unexpected shape"));
        };
        // **A `static` field is a global, so writing one is a global write.**
        //
        // The same resolution the read side does, and it has to be here for
        // the same reason: the receiver is a class *name*, lowering it asks
        // for a class value, and `Counter.count = n` reported "`Counter`, a
        // class used as a value" -- a message about a construct the
        // assignment never wanted.
        //
        // Before the receiver, so it is never lowered. See
        // `collect_static_fields`.
        if let Some(place) = self.static_field_place(target, *member) {
            return place;
        }
        if let Some(place) = self.static_accessor_place(*object_node, *member) {
            return Ok(place);
        }
        if let Some(place) = self.super_setter_place(*object_node, *member) {
            return Ok(place);
        }
        if let Some(place) = self.delegated_place(target, *object_node, *member)? {
            return Ok(place);
        }
        if self.is_accessor_property(*member) {
            return self.native_accessor_place(target, *object_node, *member);
        }
        let (object, guard) = access::receiver(self, *object_node)?;
        let key = self
            .indexed_member_name(target, *member)
            .or_else(|| self.literal_name(*member))
            .ok_or_else(|| self.unsupported(target, "a computed property name"))?;
        let key = if guard.is_some() {
            access::named_key(self, target, *member, key)?
        } else {
            access::Key::Name(key)
        };
        let place = self.property_place_on(target, object, *member)?;
        Ok(access::protect(place, guard, key))
    }

    fn property_place_on(
        &mut self,
        target: NodeId,
        object: ValueId,
        member: NodeId,
    ) -> Result<Place, Diagnostic> {
        if let Some(face) = self.erased_cast_face(target, object) {
            let name = self
                .property_key(member)
                .ok_or_else(|| self.unsupported(member, "a computed property name"))?;
            self.interface_field_place(target, object, face, &name)?;
        }
        if let Some(place) = self.array_length_place(object, member) {
            return Ok(place);
        }
        if let Some(name) = self.literal_name(member)
            && let Some(place) = self.program_objc_instance_place(target, object, &name)?
        {
            return Ok(place);
        }
        if matches!(self.values[object.0 as usize].ty, HirType::NativePointer(_)) {
            return self.native_member_place(target, object);
        }
        // **A dictionary's entry, written by name.** `r.x = "1"` and
        // `r["x"] = "1"` are the same operation on a table, and three of the
        // four spellings already worked: both reads go through
        // `member_access`, and the bracket write reaches `Place::Entry`.
        // Only the dot write fell to the refusal below, which says
        // "assigning to this property" about a property a table has no
        // trouble holding.
        //
        // The same shape as `cde420c16`, where `console["error"]` reached
        // none of three questions asked of the dot form only: one spelling
        // of one operation missing while its siblings work, and the reader
        // gets a sentence about the wrong thing.
        if let HirType::Managed(ManagedType::Table(_, _)) =
            self.values[object.0 as usize].ty.clone()
            && let Some(name) = self.literal_name(member)
        {
            let origin = self.origin(target);
            let key = self.push(
                OpKind::ConstString(name.into()),
                HirType::Managed(ManagedType::String),
                origin.clone(),
            );
            let key = self.erased(key, Absent::Impossible, &origin);
            return Ok(Place::Entry { table: object, key });
        }
        let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[object.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(target, "assigning to this property"));
        };
        let layout = self.layout_of(target, type_id)?;
        let key = self.required_access_key(target, "")?;
        let name = key.to_string();
        if let Some(place) = self.interface_field_place(target, object, type_id, &key)? {
            return Ok(place);
        }
        // `pair[0] = x`, which is the read's positional rule from the
        // other side. A tuple has no names, so the number is the field.
        let positional = key
            .public_name()
            .and_then(|name| name.parse::<usize>().ok())
            .filter(|_| self.is_tuple(type_id))
            .filter(|at| *at < layout.fields.len())
            .and_then(|at| u32::try_from(at).ok());
        let Some(field) = positional.or_else(|| layout.index_of_key(&key)) else {
            // A setter, for the same reason.
            if let Some(callee) =
                self.accessor_callee(target, type_id, &key, MethodAccessor::Set)?
            {
                let getter = self.accessor_callee(target, type_id, &key, MethodAccessor::Get)?;
                let wants = self
                    .declared_type_of(type_id, &key)
                    .and_then(|declared| self.represent(declared));
                return Ok(Place::Setter {
                    object: Some(object),
                    callee,
                    getter,
                    wants,
                    at: target,
                });
            }
            return Err(self.absent_member(target, type_id, &name));
        };
        // A `readonly` field may be written by the constructor of the
        // object it belongs to, which is what TypeScript permits and what
        // makes the modifier usable at all -- a field nothing may ever
        // write is a field with no value. `readonly` is not emitted as a C
        // `const`, so there is nothing to write through: see the note in
        // the C backend for why the qualifier was dropped.
        //
        // On `this` specifically. A constructor assigning another object's
        // readonly field is refused, as TypeScript refuses it.
        // Asked of the **type**, not of the layout.
        //
        // A layout is shared by every type with the same shape, and
        // `same_shape` deliberately ignores `readonly` -- correctly, since
        // storage does not depend on who may write to it, and splitting
        // `Point` from `Readonly<Point>` would be two descriptors for one
        // arrangement of bytes. But writability is a fact about a *type*,
        // and reading it off a shared structure gives whichever type was
        // laid out first: `class Frozen { readonly count: number }` beside
        // `class Counter { count = 0 }` is one layout, and writing to the
        // counter was refused under the frozen one's name.
        //
        // The same mistake as the one in `declared_readonly` a level up,
        // which asked the whole program by name. Twice, a property's
        // writability was asked of something shared instead of of the
        // declaration that decides it.
        if self.property_is_readonly(type_id, &name)
            && !(self.in_constructor && Some(object) == self.this)
        {
            return Err(self.unsupported(
                    target,
                    &format!(
                        "assigning to `{}`.`{name}`, which is readonly outside the constructor of the object it belongs to",
                        layout.name,
                    ),
                ));
        }
        // **The one write that can invalidate the iterator-result proof.**
        //
        // A result built `{ done: true, value: undefined }` holds the element
        // representation's zero in its `value` slot, and nothing may read it:
        // the checker narrows the union by `done`, so `r.value` is only
        // reachable where the return arm is ruled out. Writing `done` moves
        // that ruling without moving the slot, and `r.done = false; r.value`
        // then answers `0` where JavaScript answers `undefined` -- which is
        // not hypothetical, it is `tooling/sweep/probe.sh` disagreeing with
        // node before this refusal existed.
        //
        // TypeScript permits the write: `done` is not `readonly` on either
        // arm. So the refusal is this compiler's, and it says so.
        if name == "done" && self.is_a_provided_iterator_result(&layout) {
            return Err(self.unsupported(
                target,
                "assigning to an iterator result's `done`, which would move the guard that decides whether its `value` may be read without moving what `value` holds",
            ));
        }
        Ok(Place::Field { object, field })
    }

    pub(super) fn place_of(&mut self, target: NodeId) -> Result<Place, Diagnostic> {
        // **Parentheses around a target change nothing about where it writes.**
        // `(x) = 5`, `(x)++`, `(o.k) = 7` and `for ((v) of xs)` are all
        // ordinary JavaScript -- the grammar's *cover* production, which is why
        // test262 names those files `target-cover-id`. The parenthesised node
        // is not an identifier and not a member access, so every test below
        // missed it and the fall-through said `assignment to a computed
        // target`: a true sentence about the node in front of it and a false
        // one about the program.
        //
        // Six files of the slice-1 `test/language` population, across
        // assignment, both increments and both decrements, plus a `for...of`
        // head. Unwrapped here rather than at each caller, because *where a
        // thing writes* is one question and this is the one function that
        // answers it -- a caller that unwrapped for itself would be a second
        // derivation, and the next caller would not.
        if self.kind_of(target) == Some(syntax::PARENTHESIZED_EXPRESSION)
            && let Some(inner) = self.children(target).into_iter().next()
        {
            return self.place_of(inner);
        }
        // **A namespace's members are read-only**: assigning one is a `TypeError`
        // in the module namespace's own `[[Set]]`. Asked before `names_a_property`,
        // which answers "not a property" for `ns.x` and `C.x` so that a *read*
        // goes to the export -- and a write would then go there too, silently,
        // where the language throws. Refused by name rather than thrown, for now.
        if self.kind_of(target) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
            && let Some(object) = self.children(target).first().copied()
            && (self.denotes_a_module(object) || self.holds_a_namespace(object))
        {
            return Err(self.unsupported(
                target,
                "an assignment to a member of a module namespace, which is read-only and throws a `TypeError`",
            ));
        }
        if self.names_a_property(target) {
            return self.property_place(target);
        }
        if self.kind_of(target) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) {
            let (array, index, guard) = self.element_access_parts(target)?;
            if matches!(self.values[array.0 as usize].ty, HirType::NativePointer(_)) {
                return self.native_element_place(target, array, index);
            }
            // `table[key] = value` on a string-keyed table. The key crosses
            // erased, as every other table operation's key does.
            if matches!(
                self.values[array.0 as usize].ty,
                HirType::Managed(ManagedType::Table(_, _))
            ) {
                let source = *self
                    .children(target)
                    .last()
                    .expect("element access has an index");
                let key = property_keys::capture(self, source, index)?;
                return Ok(access::protect(
                    Place::Entry { table: array, key },
                    guard,
                    access::index_key(self, target, index),
                ));
            }
            // `element_access_parts` now admits a receiver the checker proved
            // is an array and the representation left erased, because a *read*
            // of one can ask the descriptor what it holds. A write cannot: the
            // value being stored has a static type that may not be the slot's,
            // and narrowing a double into an `int32_t[]` is a conversion this
            // has no place to decide. Refused by name rather than mis-stored.
            if self.erased_but_proven_an_array(target, array) {
                return Err(self.unsupported(
                    target,
                    "assigning to an element of an array whose element type is \
                     only known at run time",
                ));
            }
            return Ok(access::protect(
                Place::Element { array, index },
                guard,
                access::index_key(self, target, index),
            ));
        }

        let symbol = self
            .node(target)
            .symbol
            .ok_or_else(|| self.unsupported(target, "assignment to a computed target"))?;
        self.place_for_symbol(target, symbol)
    }

    /// Where a *named* place writes, given the symbol it names.
    ///
    /// Split from [`Self::place_of`] because a shorthand in an assignment
    /// pattern has the right node and the wrong symbol on it: `({ x } = p)` is
    /// one node whose symbol is the **property's**, and the variable's comes
    /// from [`Self::shorthand_value_symbol`]. Both paths answer "where does
    /// this name write" and there is one derivation of it.
    /// A binding no assignment may change: a `const` or `using` declaration, or
    /// the name a function or class *expression* gives itself -- a binding only
    /// its own body sees, and immutable there.
    pub(super) fn immutable_binding(&self, symbol: u32) -> bool {
        self.snapshot
            .symbols
            .get(symbol as usize)
            .is_some_and(|record| {
                record.declarations.iter().any(|declaration| {
                    matches!(
                        self.kind_of(*declaration),
                        Some(syntax::FUNCTION_EXPRESSION | syntax::CLASS_EXPRESSION)
                    ) || matches!(
                        self.variable_kind(*declaration),
                        Some(
                            nts_semantic_schema::VariableKind::Const
                                | nts_semantic_schema::VariableKind::Using
                                | nts_semantic_schema::VariableKind::AwaitUsing
                        )
                    )
                })
            })
    }

    pub(super) fn place_for_symbol(
        &mut self,
        target: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Place, Diagnostic> {
        if let Some(declaration) = self.initialization.uninitialized_local(target, symbol.0) {
            return Ok(Place::UninitializedBinding {
                at: target,
                symbol: symbol.0,
                declaration,
            });
        }
        // **An immutable binding throws, after the uninitialized check and
        // before any store.** A `const` was refused here ("assigning to a
        // `const`"), and one held as a module global was not even that: the
        // store below wrote it. A function expression's own name took the
        // ordinary binding path and was rebound to whatever was assigned,
        // unerased into the function's type unchecked. Node throws `TypeError`
        // for each, in strict code, which every module is.
        if self.immutable_binding(symbol.0) {
            return Ok(Place::Unwritable {
                at: target,
                symbol: symbol.0,
                why: Unwritable::Immutable,
            });
        }
        // No alias resolution here, unlike the read: assigning to an imported
        // binding is a type error, so an alias symbol cannot be the target of
        // an assignment in a program that got this far.
        //
        // A module-scope variable is a store, not a rebinding: every function
        // sees the same one, so there is nothing to shadow.
        if !self.bindings.contains_key(&symbol.0)
            && let Some(global) = self.module.variables.get(&symbol.0).copied()
        {
            return Ok(Place::Global(global));
        }
        if self.module.binding_constants.contains_key(&symbol.0) {
            return Err(self.unsupported(target, "assigning to a `const`"));
        }
        if self.module.bound.contains_key(&symbol.0) {
            return Err(self.unsupported(target, "assigning to a global a binding implements"));
        }
        // **A function declaration's own name.** Every read of it is the one
        // function (`ClosureStatic`), so a write had nowhere a read would see:
        // it went to a `Binding` no reader consults, and `export default function
        // fn() { fn = 2 }` read back the function where node reads `2` -- a wrong
        // answer `import()` made reachable from sixteen test262 files.
        // TypeScript rejects the assignment (TS2630); plain JavaScript is where it
        // arrives, and it is refused by name until a function binding can be one.
        if !self.bindings.contains_key(&symbol.0)
            && self
                .snapshot
                .symbols
                .get(symbol.0 as usize)
                .is_some_and(|record| {
                    record.declarations.iter().any(|declaration| {
                        self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION)
                    })
                })
        {
            return Err(self.unsupported(
                target,
                "an assignment to a function declaration's own name, which every read of it answers with the \
                 function",
            ));
        }
        // **A class declaration's name.** A class binding is a mutable one in
        // JavaScript, and this compiler keeps it as the class: a write took a
        // fresh `Binding` held erased, and every later read narrowed it back to
        // the class's own object type with no tag to say so. `C = 44; C === 44`
        // compared a pointer with a double -- C that does not compile -- where
        // node answers `true`. Stopped by name where the store would land, not
        // widened: making the binding hold anything is a whole-program decision
        // for an unchecked edge (TypeScript rejects the assignment, TS2629), the
        // ruling a redeclared `var` had. See [`Unwritable::ClassName`] for why
        // the stop is at run time.
        if self
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .is_some_and(|record| {
                record.declarations.iter().any(|declaration| {
                    self.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION)
                })
            })
        {
            return Ok(Place::Unwritable {
                at: target,
                symbol: symbol.0,
                why: Unwritable::ClassName,
            });
        }
        // From the target, which is where the checker gives the *declared*
        // type: the left of an assignment is not narrowed by what came before
        // it, because the assignment is what does the narrowing.
        let ty = self.type_of(target);
        Ok(Place::Binding {
            at: target,
            symbol: symbol.0,
            ty,
        })
    }

    /// What a place currently holds.
    ///
    /// Asked by the three forms that read a place before writing it: a compound
    /// assignment, a step, and a logical assignment. A plain `=` does not come
    /// here, which is what keeps the accessor refusal below narrow.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn read_place(&mut self, id: NodeId, place: &Place) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        Ok(match *place {
            // The name's own read: `x += 1` on a `const` reads `x`, then throws.
            Place::Unwritable { at, .. } => self.lower_expression(at)?,
            Place::UninitializedBinding {
                at,
                symbol,
                declaration,
            } => {
                self.check_initialized(at, symbol)?;
                self.unwritten(at, declaration)?
            }
            Place::Checked {
                ref place,
                ref guard,
                ref key,
            } => {
                access::require(self, id, guard, key, false)?;
                self.read_place(id, place)?
            }
            Place::NativeBits { pointer, field } => {
                let ty = self.native_bit_unit(id, pointer, field)?;
                let origin = self.origin(id);
                let read = self.push(OpKind::NativeBitLoad { pointer, field }, ty, origin);
                self.coerce(read, &HirType::NUMBER, id)?
            }
            Place::NativeElement { pointer, index } => self.native_load(id, pointer, index)?,
            Place::Field { object, field } => {
                let layout = match self.values[object.0 as usize].ty.clone() {
                    HirType::Managed(ManagedType::Object(ty)) => self.layout_of(id, ty)?,
                    _ => return Err(self.unsupported(id, "reading a field of something else")),
                };
                let ty = layout.fields[field as usize].ty.clone();
                // An erased field read where the checker narrowed is the same
                // question an erased *binding* read is, and gets the same
                // answer: `if (o.limit !== undefined) o.limit * 2` reads a
                // number, and the declaration says `number | undefined`.
                let read = self.push(OpKind::FieldGet { object, field }, ty, origin);
                self.narrowed(id, read)?
            }
            // `xs.length -= 1` reads before it writes. Refused by name rather
            // than answered, and narrow: every one of the 62 `length =` sites
            // in the corpus is a plain assignment, and the eight compound ones
            // are `state.length` -- an ordinary object field whose name happens
            // to be `length`, which never reaches here.
            Place::ArrayLength(_) => {
                return Err(
                    self.unsupported(id, "reading an array's `length` as part of assigning to it")
                );
            }
            // `o.x += 1` and `o.x ??= 1` where `x` is an accessor read
            // through the *getter* and write through the setter, and this place
            // knows only the setter. Refused rather than guessed at, which is a
            // narrower gap than it looks: a plain `o.x = v` does not come here.
            //
            // Named for what it is rather than for one of the forms that asks.
            // The message said "a compound assignment" while `??=` was refused
            // by it too, which is a refusal naming a construct the source does
            // not contain.
            // `o.x += 1` and `o.x ??= 1` where `x` is an accessor: read
            // through the **getter**, which travels with the place for exactly
            // this. A plain `o.x = v` never comes here, which is why the gap was
            // narrower than the message suggested.
            Place::Setter {
                object,
                getter: Some(ref getter),
                ref wants,
                at,
                ..
            } => {
                let getter = getter.clone();
                // The **accessor's** declared type rather than the assignment
                // node's. `a.v ??= n` is typed `number` at the assignment and
                // the getter answers `number | undefined`, so taking the type
                // from the node produced a read claiming to be an `f64` while
                // the call returned an erased value -- which clang reported as
                // `operand of type 'NtsValue' where a real type is required`,
                // three passes after the mistake.
                let ty = self
                    .field_access_family(at)
                    .map(|family| family.returns.clone())
                    .or_else(|| wants.clone())
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "an accessor's value"))?;
                // **The read and the result are the same value here, and for an
                // erased accessor they want different types.** `a.v ??= n` tests
                // the read for absence -- which needs the tag -- and answers
                // with it on the present path, where the assignment's type is
                // `number` because `??=` has excluded the absent arm. One value
                // cannot be both, and a branch typed from the assignment then
                // casts an `NtsValue` to a double: clang says `operand of type
                // 'NtsValue' where arithmetic ... is required`.
                //
                // A *field* in the same shape works, because the flow analysis
                // tracks the slot and narrows the read. A getter call is not a
                // slot and has nothing to narrow, so this is refused by name
                // rather than lowered into that cast.
                if ty == HirType::Erased {
                    return Err(self.unsupported(
                        id,
                        "a compound assignment through an accessor whose value is erased",
                    ));
                }
                let args = object.into_iter().collect();
                let read = self.push_an_accessor_call(at, getter, args, ty, origin);
                self.narrowed(id, read)?
            }
            // A **write-only** accessor: `set x(v)` with no `get x`, which
            // TypeScript permits. A compound assignment on one reads something
            // that cannot be read, and says that rather than naming the
            // assignment.
            Place::Setter { .. } => {
                return Err(
                    self.unsupported(id, "a compound assignment through a set-only accessor")
                );
            }
            Place::NativeAccessor {
                receiver,
                ty,
                ref getter,
                ..
            } => self.read_native_accessor(id, receiver, ty, getter.as_deref())?,
            Place::NamedProperty { receiver, ty, key } => {
                self.call_bound_method(id, receiver, ty, "_named_get", vec![key])?
            }
            Place::Element { array, index } => {
                let HirType::Managed(ManagedType::Array(element) | ManagedType::View(element)) =
                    self.values[array.0 as usize].ty.clone()
                else {
                    return Err(self.not_an_array(id));
                };
                self.push(
                    OpKind::ArrayGet {
                        array,
                        index,
                        checked: true,
                    },
                    *element,
                    origin,
                )
            }
            Place::Entry { table, key } => {
                let read = property_keys::apply(self, id, table, key, property_keys::Action::Get);
                claimed_reads::narrowed(self, id, read)?
            }
            Place::Global(global) => {
                // **Narrowed, like every other read of a name.** A global
                // declared `number | undefined` is stored erased, and the
                // checker narrows it exactly as it narrows a local -- so a read
                // where the narrowing says `number` needs the unerase that
                // `narrowed` inserts. Without it the erased value reached a slot
                // wanting a concrete one and refused, for `number | undefined`,
                // `boolean | undefined` and `number | null` alike, while
                // `string | undefined` compiled because a nullable pointer is
                // not erased and had nothing to unerase.
                self.check_initialized_place(id, global)?;
                let ty = self.module.types[global as usize].clone();
                let read = self.push(OpKind::GlobalGet(global), ty, origin);
                self.narrowed(id, read)?
            }
            Place::Binding { symbol, .. } => {
                let bound = *self
                    .bindings
                    .get(&symbol)
                    .ok_or_else(|| self.unsupported(id, "reading a name before it is bound"))?;
                self.read_cell(symbol, bound, id)?.unwrap_or(bound)
            }
        })
    }

    /// Store into a field, and record that it was written.
    ///
    /// **The only way a `FieldSet` is emitted.** Recording presence at each of
    /// the fourteen sites that used to push one directly would have been
    /// fourteen chances to forget, and a forgotten one is not a crash: the bit
    /// stays clear, `"x" in o` answers false for a property that is there, and
    /// nothing anywhere says so. One derivation instead -- `super::hir::verify`
    /// checks that no `FieldSet` on an optional field arrives without its
    /// record, so a fifteenth site that bypasses this is a build failure rather
    /// than a convention.
    ///
    /// Costs nothing where nothing is optional, which is every frame, capture
    /// cell and closure environment in the program: the lookup is compile-time
    /// and emits no operation at all.
    pub(super) fn field_set(
        &mut self,
        object: ValueId,
        field: u32,
        value: ValueId,
        origin: &Origin,
    ) {
        self.push(
            OpKind::FieldSet {
                object,
                field,
                value,
            },
            HirType::Void,
            origin.clone(),
        );
        let Some(bit) = self.presence_bit_of(object, field) else {
            return;
        };
        let index = self.push(
            OpKind::ConstInt(i128::from(bit)),
            PRESENCE_INDEX,
            origin.clone(),
        );
        self.call_runtime(
            "nts_presence_set",
            vec![object, index],
            HirType::Void,
            origin,
        );
    }

    /// Remove a field: store the absent tag, and record that the property is
    /// gone.
    ///
    /// The second of exactly two operations that emit a `FieldSet`, and it is
    /// separate from [`Self::field_set`] rather than a flag on it because the
    /// two record *opposite* facts. Routing a deletion through the write path
    /// emitted `nts_presence_set` immediately followed by `nts_presence_clear`
    /// -- correct, and two instructions saying the thing and then unsaying it.
    ///
    /// The tag and the bit are both written because they are different facts:
    /// the tag says the value is absent, the bit says the property is, and
    /// `{ x: undefined }` is the program that tells them apart.
    fn field_delete(&mut self, object: ValueId, field: u32, value: ValueId, origin: &Origin) {
        self.push(
            OpKind::FieldSet {
                object,
                field,
                value,
            },
            HirType::Void,
            origin.clone(),
        );
        let Some(bit) = self.presence_bit_of(object, field) else {
            return;
        };
        let index = self.push(
            OpKind::ConstInt(i128::from(bit)),
            PRESENCE_INDEX,
            origin.clone(),
        );
        self.call_runtime(
            "nts_presence_clear",
            vec![object, index],
            HirType::Void,
            origin,
        );
    }

    /// How a property's presence is recorded on this type.
    ///
    /// `None` means only that the layout is not built in this program, which is
    /// the one answer that is about the compilation rather than about the type.
    /// Everything else is a [`crate::hir::presence::Presence`] the caller has to
    /// match, so that "not optional" and "optional and unrecordable" cannot be
    /// merged into one `None` and then handled as the first -- they want
    /// opposite treatment, and merging them is how a refusal turns into a wrong
    /// answer.
    pub(super) fn presence_of_key(
        &self,
        ty: TypeId,
        key: &PropertyKey,
    ) -> Option<crate::hir::presence::Presence> {
        // Looked up rather than built. `layout_of` **creates**, and creating one
        // here would materialise a layout for a type the program does not carry
        // -- the trap `laid_out_as_a_prefix` and `token_base` both record.
        let layout = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))?;
        Some(crate::hir::presence::of(
            layout,
            |candidate| self.declares(ty, candidate) == Declares::Optionally,
            key,
        ))
    }

    /// The type and property name a field place names.
    ///
    /// One derivation, because [`Self::presence_bit_of`] and
    /// [`Self::the_absence_has_a_slot`] both need it and *"which property is
    /// field `n` of this value"* answered twice is how this file has gone wrong
    /// four times in a week.
    ///
    /// Looked up rather than built, for the reason
    /// [`Self::presence_of_key`] states: `layout_of` **creates**, and creating
    /// one here would materialise a layout for a type the program does not
    /// carry. So `None` is about the compilation rather than about the property
    /// -- the value is not an object, or the program carries no layout for it --
    /// and each caller says which way that falls for it.
    fn property_at(&self, object: ValueId, field: u32) -> Option<(TypeId, PropertyKey)> {
        let HirType::Managed(ManagedType::Object(ty)) = self.values[object.0 as usize].ty else {
            return None;
        };
        let layout = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))?;
        Some((ty, layout.fields.get(field as usize)?.name.clone()))
    }

    /// The presence bit for a field of the object this value holds, where
    /// something in the program reads it.
    ///
    /// The one gate for every writer, so `field_set`, `field_delete` and the
    /// construction mask cannot disagree about which bits are maintained. A bit
    /// nobody tests is a store into a header word that is never read, and it
    /// cost `callback-field` one counted operation against a floor of zero.
    fn presence_bit_of(&self, object: ValueId, field: u32) -> Option<u32> {
        let (ty, name) = self.property_at(object, field)?;
        if !name
            .public_name()
            .is_some_and(|name| self.presence_keys.contains(name))
        {
            return None;
        }
        match self.presence_of_key(ty, &name)? {
            crate::hir::presence::Presence::Bit(bit) => Some(bit),
            crate::hir::presence::Presence::Always
            | crate::hir::presence::Presence::TooMany { .. } => None,
        }
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn write_place(
        &mut self,
        id: NodeId,
        place: &Place,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        if let Place::UninitializedBinding { at, symbol, .. } = *place {
            return self.check_initialized(at, symbol);
        }
        // The value was evaluated -- `fixed = sideEffect()` runs the call -- and
        // the binding is asked whether it is initialized, as any store to it
        // asks: a closure writing a `const` or a class before its declaration
        // ran throws `ReferenceError`, which comes first. Only then the stop.
        if let Place::Unwritable { at, symbol, why } = *place {
            self.check_initialized(at, symbol)?;
            if let Some(cell) = self
                .cell_of(symbol)
                .and(self.bindings.get(&symbol).copied())
            {
                self.check_lexical_cell_ready(at, symbol, cell)?;
            }
            if !self.bindings.contains_key(&symbol)
                && let Some(global) = self.module.variables.get(&symbol).copied()
            {
                self.check_initialized_place(at, global)?;
            }
            let origin = self.origin(at);
            let always = self.push(OpKind::ConstBool(true), HirType::Bool, origin);
            return match why {
                // So a `try` around it catches node's TypeError.
                Unwritable::Immutable => {
                    self.refuse_when(at, always, "TypeError", "Assignment to constant variable.")
                }
                Unwritable::ClassName => {
                    self.stop_when(
                        at,
                        always,
                        "an assignment to a class declaration's name, which this compiler keeps \
                         as the class",
                    );
                    Ok(())
                }
            };
        }
        if let Place::Checked { guard, key, .. } = place {
            access::require(self, id, guard, key, true)?;
        }
        if let Place::Global(global) = *place {
            self.check_initialized_place(id, global)?;
        }
        if let Place::Binding { at, symbol, .. } = *place {
            self.check_initialized(at, symbol)?;
            if let Some(cell) = self
                .cell_of(symbol)
                .and(self.bindings.get(&symbol).copied())
            {
                self.check_lexical_cell_ready(at, symbol, cell)?;
            }
        }
        let origin = self.origin(id);
        let value = self.coerce_to_slot(id, place, value)?;
        match *place {
            Place::UninitializedBinding { .. } => {
                return Err(
                    self.unsupported(id, "an uninitialized lexical reference reached storage")
                );
            }
            Place::Unwritable { .. } => {
                return Err(self.unsupported(id, "an unwritable name reached storage"));
            }
            Place::Checked { ref place, .. } => {
                return self.write_place(id, place, value);
            }
            Place::NativeBits { pointer, field } => {
                let ty = self.native_bit_unit(id, pointer, field)?;
                let value = self.coerce(value, &ty, id)?;
                let origin = self.origin(id);
                self.push(
                    OpKind::NativeBitStore {
                        pointer,
                        field,
                        value,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::NativeElement { pointer, index } => {
                // A `const T *` may be read through and not written through.
                // TypeScript refuses this first -- `TS2542`, "only permits
                // reading" -- so arriving here means a declaration produced a
                // pointer whose type said one thing and whose contract said
                // another, which an intrinsic a program declares for itself can
                // do. Checked where the store is made, not only where the type
                // is written.
                if matches!(
                    &self.values[pointer.0 as usize].ty,
                    HirType::NativePointer(crate::hir::native::Pointee::Const(_))
                ) {
                    return Err(self.unsupported(id, "a store through a `const` native view"));
                }
                self.push(
                    OpKind::NativeStore {
                        pointer,
                        index,
                        value,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::Field { object, field } => {
                self.field_set(object, field, value, &origin);
                self.notify_property(id, (object, field), origin)?;
            }
            // `xs.length = n`. The variant follows the element, the same way
            // every other array helper's does -- and it is the whole point
            // here rather than a detail: the reference and tagged forms have to
            // give up what they drop, and a scalar array has nothing to give up.
            Place::ArrayLength(array) => self.set_array_length(id, array, value, origin)?,
            Place::Setter {
                object,
                ref callee,
                at,
                ..
            } => {
                let callee = callee.clone();
                let args = object.into_iter().chain([value]).collect();
                self.push_an_accessor_call(at, callee, args, HirType::Void, origin);
            }
            Place::NativeAccessor {
                receiver,
                ty,
                ref setter,
                takes_value,
                ..
            } => {
                self.lower_accessor_on(id, receiver, ty, setter, takes_value.then_some(value))?;
            }
            Place::NamedProperty { receiver, ty, key } => {
                self.call_bound_method(id, receiver, ty, "_named_set", vec![key, value])?;
            }
            Place::Element { array, index } => {
                self.push(
                    OpKind::ArraySet {
                        array,
                        index,
                        value,
                        checked: true,
                    },
                    HirType::Void,
                    origin,
                );
            }
            Place::Entry { table, key } => {
                let erased = self.erased_from(value, id, &origin);
                property_keys::apply(self, id, table, key, property_keys::Action::Set(erased));
            }
            Place::Global(global) => {
                self.push(OpKind::GlobalSet { global, value }, HirType::Void, origin);
            }
            Place::Binding { symbol, .. } => {
                self.oblige_local(symbol, value, id);
                // An unrepresented module slot is not a local SSA binding.
                // Otherwise assigning a native address silently discards the
                // global store before the lifetime checker can observe it.
                if matches!(self.values[value.0 as usize].ty, HirType::NativePointer(_))
                    && let Some(reason) = self.module.unsupported.get(&symbol)
                {
                    return Err(self.unsupported(id, reason));
                }
                // A cell is storage, so the write is a store rather than a new
                // binding: the closure holding the same cell has to see it.
                match self
                    .cell_of(symbol)
                    .and(self.bindings.get(&symbol).copied())
                {
                    Some(cell) => {
                        self.field_set(cell, 0, value, &origin);
                        // A var's flag means assigned, not that its declaration
                        // statement ran. `x = 2; var x;` leaves that value intact.
                        if self.initialization.var_cell(symbol)
                            && self
                                .cell_of(symbol)
                                .is_some_and(|index| self.is_guarded(index))
                        {
                            let ready =
                                self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
                            self.field_set(cell, 1, ready, &origin);
                        }
                    }
                    None => {
                        self.bindings.insert(symbol, value);
                    }
                }
            }
        }
        Ok(())
    }

    /// A C method's receiver, at the type its first parameter declares: the
    /// first argument when the declaration spells it (`this`), or -- for a
    /// `Role::Receiver`, which no argument feeds -- the slot's own value,
    /// returned for the caller to pass there.
    pub(super) fn place_receiver(
        &mut self,
        id: NodeId,
        target: &crate::hir::native::Function,
        args: &mut Vec<ValueId>,
        receiver: Option<ValueId>,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(receiver) = receiver else {
            return Ok(None);
        };
        let want = target
            .parameters
            .first()
            .map(crate::hir::native::Type::representation)
            .ok_or_else(|| self.unsupported(id, "a C method whose function takes no instance"))?;
        let receiver = self.coerce(receiver, &want, id)?;
        if target.roles.first() == Some(&crate::hir::native::Role::Receiver) {
            return Ok(Some(receiver));
        }
        args.insert(0, receiver);
        Ok(None)
    }
}
