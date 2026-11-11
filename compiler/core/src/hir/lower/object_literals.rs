//! Lower object literal storage, contextual record choice, and spread writes.

use super::{
    Absent, Diagnostic, FuncBuilder, HirType, Layout, ManagedType, MethodAccessor, NodeId, OpKind,
    Origin, TypeId, TypeKind, ValueId, class_symbol, syntax,
};

impl FuncBuilder<'_> {
    /// The object type a literal is contextually assigned to, through a union.
    ///
    /// A union of object types erases, so `contextual_type` answers `Erased` for
    /// `options: Optional | Listener | undefined` and the literal falls back to
    /// its *own* checker type. That is where the shapes diverge:
    /// `Optional.limit` is optional, so its field is `Erased` -- the absence is
    /// a tag -- while `{ limit: 19 }` has a plain `f64`. Assignable in
    /// TypeScript and two different structs here, so the object went into the
    /// erased slot as one shape and `unerase` read it back as the other. Record
    /// 0244 has the reduction; node answers 19 and this answered -2.
    ///
    /// TypeScript picks the member a literal matches when the contextual type is
    /// a union, and this recovers that choice: the object member whose declared
    /// property names cover every key the literal writes. **Covers, not equals**
    /// -- a literal may omit an optional property, which is the whole point of
    /// `{}` matching `Optional`.
    ///
    /// One member or none. Two members that both cover the keys is a choice this
    /// cannot make on names alone, and guessing would put the wrong layout in an
    /// erased slot -- which is the defect, not the fix.
    fn contextual_union_member(&self, id: NodeId) -> Option<TypeId> {
        let keys: Vec<String> = self
            .children(id)
            .into_iter()
            .filter_map(|property| self.literal_name(*self.children(property).first()?))
            .collect();
        if keys.len() != self.children(id).len() {
            return None;
        }
        let parent = self.syntactic_parent(id)?;
        let target = match self.kind_of(parent) {
            Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION) => {
                let at = self.children(parent).iter().position(|c| *c == id)?;
                let argument = at.checked_sub(1)?;
                let signature = self.snapshot.call_targets.get(&parent)?.signature;
                let signature = self.snapshot.signatures.get(signature.0 as usize)?;
                signature.parameters.get(argument)?.ty
            }
            Some(syntax::BINARY_EXPRESSION) => {
                let parts = self.children(parent);
                let [left, operator, right] = parts.as_slice() else {
                    return None;
                };
                if self.kind_of(*operator) != Some(syntax::EQUALS_TOKEN) || *right != id {
                    return None;
                }
                *self.snapshot.node_types.get(left)?
            }
            _ => return None,
        };
        let TypeKind::Union(members) = &self.snapshot.types.get(target.0 as usize)?.kind else {
            return None;
        };
        let mut fits = members.iter().copied().filter(|member| {
            match self.snapshot.types.get(member.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Object { properties }) => {
                    !properties.is_empty()
                        && keys
                            .iter()
                            .all(|key| properties.iter().any(|p| p.name.is_name(key.as_ref())))
                }
                _ => false,
            }
        });
        let only = fits.next()?;
        if fits.next().is_some() {
            return None;
        }
        Some(only)
    }

    /// The literal's own type, where the literal is `{}` and nothing else says
    /// what it is.
    ///
    /// **A type that erases and a value that does not.** `{}` as a *type* is
    /// every value except `null` and `undefined` -- a number is assignable to
    /// it -- so `representation_within` gives it `Erased`, and it says why:
    /// representing it as a layout made `const x: {} = n` fail with a number
    /// where an object was wanted, the checker being right and the
    /// representation disagreeing. That rule is correct and stays.
    ///
    /// The *literal* is not that. `{}` written down is an object with no
    /// fields, and the slot it goes into may well be erased -- so it is built
    /// as the object it is and erased afterwards, which is exactly the two
    /// steps the union arm beside this one takes, for exactly the same reason.
    ///
    /// Only a literal with **no properties**: one with properties and an erased
    /// type is the union case above, where which member it matches is the whole
    /// question.
    fn empty_object_literal(&self, id: NodeId) -> Option<TypeId> {
        if !self.children(id).is_empty() {
            return None;
        }
        let ty = *self.snapshot.node_types.get(&id)?;
        let record = self.snapshot.types.get(ty.0 as usize)?;
        matches!(&record.kind, TypeKind::Object { properties } if properties.is_empty())
            .then_some(ty)
    }

    /// The object type a literal is **built at**, and whether the result is
    /// erased after.
    ///
    /// **One answer, because two things ask.** The literal's fields are written
    /// at this type and its methods are lowered under this type's name, and if
    /// those disagree the call site finds neither: an `{ v, twice() {} }`
    /// assigned to an `interface O` lowered its method as `Type6#twice` while
    /// the call asked for `O#twice`, because one side took the literal's own
    /// checker type and the other the contextual one.
    ///
    /// A literal contextually typed by a *union* erases. Building it at its own
    /// type and erasing puts one shape into a slot that `unerase` reads as
    /// another -- see `contextual_union_member`, and record 0244 for what that
    /// answers.
    ///
    /// `{}` reaches here too, and correctly: its type erases because in
    /// TypeScript it is every value except `null` and `undefined`, while its
    /// *value* is still an object. `options = {}` is node's sentinel for "no
    /// options were passed", and it is under `net.createServer` at 91 of 148
    /// failing files and `http.createServer` at 241 of 405.
    /// The type a literal typed by a class is allocated as: its own, laid out as
    /// the class's storage.
    ///
    /// **A literal typed as a class is not an instance of it.** A class with
    /// only fields is a structural type, so `const p: Point = { x: 1 }` checks,
    /// and node answers `p instanceof Point` false -- nothing constructed it.
    /// Allocated as the class itself it was one: no backend could tell the two
    /// objects apart (`outcomes/a-literal-typed-as-a-class-is-not-an-instance`).
    /// Its own type in the class's layout keeps the storage -- the literal is
    /// passed wherever a `Point` is wanted at no cost -- and makes it an object
    /// the class's identity does not hold, which `Program::plain_records`
    /// records and every backend's `instanceof` then tells apart
    /// (`Program::distinct_identities`). The same for a provided error class.
    ///
    /// Not where the literal's type already has a layout of its own: two
    /// layouts claiming one type would be a dispute, not an identity.
    fn as_its_own_record(&mut self, id: NodeId, context: TypeId) -> Result<TypeId, Diagnostic> {
        let names_a_class = class_symbol(self.snapshot, context).is_some()
            || self.hierarchy.provided_errors.contains_key(&context);
        let Some(own) = self.snapshot.node_types.get(&id).copied() else {
            return Ok(context);
        };
        let an_object = matches!(
            self.snapshot
                .types
                .get(own.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Object { .. })
        );
        if !names_a_class
            || !an_object
            || own == context
            || self
                .layouts
                .iter()
                .any(|layout| layout.types.contains(&own))
        {
            return Ok(context);
        }
        self.layout_of(id, context)?;
        let class = self.class_behind(context);
        if let Some(at) = self
            .layouts
            .iter()
            .position(|layout| layout.types.contains(&class))
        {
            self.layouts.add_type(at, own);
        }
        Ok(own)
    }

    fn literal_object_type(
        &mut self,
        id: NodeId,
        ty: HirType,
    ) -> Result<(TypeId, bool), Diagnostic> {
        if ty == HirType::Erased {
            let face = self.snapshot.node_types.get(&id).copied();
            if let Some(face) = face.filter(|face| self.hierarchy.cast_faces.contains(face)) {
                return Ok((face, true));
            }
        }
        let (ty, erase_afterwards) = match ty {
            HirType::Erased => match self.contextual_union_member(id) {
                Some(member) => (HirType::Managed(ManagedType::Object(member)), true),
                // `{}` with nothing to say about it. Built as the object it is
                // and erased after, which is the same two steps the union arm
                // above takes for the same reason.
                None => match self.empty_object_literal(id) {
                    Some(own) => (HirType::Managed(ManagedType::Object(own)), true),
                    None => (HirType::Erased, false),
                },
            },
            other => (other, false),
        };
        let HirType::Managed(ManagedType::Object(type_id)) = ty else {
            return Err(self.unsupported(id, "an object literal that is not an object"));
        };
        Ok((type_id, erase_afterwards))
    }

    /// The type an object literal's *members* are lowered under.
    ///
    /// Reads the same two sources in the same order [`Self::lower_object_literal`]
    /// does and hands them to the same decision, so the function a method is
    /// emitted as and the name a call looks for cannot drift apart.
    pub(super) fn literal_member_owner(&mut self, id: NodeId) -> Option<TypeId> {
        let ty = self.literal_context_type(id)?;
        self.literal_object_type(id, ty).ok().map(|(ty, _)| ty)
    }

    /// One allocation-type decision for the member collector and allocation.
    /// Array and tuple contexts are recovered syntactically as well, before
    /// lowering has an `expecting` slot to supply them.
    fn literal_context_type(&self, id: NodeId) -> Option<HirType> {
        self.contextual_type(id, 0)
            .filter(|ty| {
                matches!(
                    ty,
                    HirType::Managed(ManagedType::Object(_) | ManagedType::Table(_, _))
                )
            })
            .or_else(|| {
                self.contextual_union_member(id)
                    .map(|member| HirType::Managed(ManagedType::Object(member)))
            })
            .or_else(|| {
                self.expecting.clone().filter(|ty| {
                    matches!(
                        ty,
                        HirType::Managed(ManagedType::Object(_) | ManagedType::Table(_, _))
                    )
                })
            })
            .or_else(|| self.type_of(id))
    }

    /// A literal a native call marked as never built (`mark_literals`):
    /// labels, a property at a time, or a `Copied<T>`'s fields, written
    /// straight into the struct.
    fn unbuilt_literal(&mut self, id: NodeId) -> Option<Result<ValueId, Diagnostic>> {
        if self.labels_pending.remove(&id) {
            return Some(self.lower_labels(id));
        }
        self.copied_pending
            .remove(&id)
            .map(|ty| self.copied_literal(id, ty))
    }

    pub(super) fn lower_object_literal(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        if let Some(unbuilt) = self.unbuilt_literal(id) {
            return unbuilt;
        }
        // A C record's fields, where C takes the record by value.
        if let Some(ty) = self.native_record_wanted(id) {
            return self.native_record_literal(id, ty);
        }
        if matches!(self.contextual_type(id, 0), Some(HirType::NativePointer(_)))
            || matches!(self.type_of(id), Some(HirType::NativePointer(_)))
        {
            return Err(self.unsupported(id, "an opaque C pointer constructed as an object literal; use the C library's constructor"));
        }
        // The *declared* type where there is one, not the literal's own.
        //
        // `const o: Options = {}` gives the literal type `{}`, which has no
        // fields -- so a later `o.limit` was refused as a property the type
        // does not declare, when `Options` declares it and the literal simply
        // omitted it. A literal may omit a property only when it is optional,
        // and an optional property is `T | undefined`, whose absent value is
        // the zero a fresh allocation already holds.
        //
        // Safe in the other direction too: a literal missing a *required*
        // property is a type error the checker reported before this ran.
        let ty = self
            .literal_context_type(id)
            .ok_or_else(|| self.unrepresentable(id, "an object literal"))?;
        // `const table: Record<string, number> = {}` is an allocation of a
        // *table*, and the contextual type is the only thing that says so: the
        // literal's own type is `{}`, an object with no fields, which is what
        // made `table["k"] = v` refuse as a property the type does not declare.
        //
        // The same reasoning as the comment above, one representation along.
        if let HirType::Managed(ManagedType::Table(key, _)) = &ty {
            let key = (**key).clone();
            return self.lower_table_literal(id, ty.clone(), &key);
        }
        let (type_id, erase_afterwards) = self.literal_object_type(id, ty)?;
        let type_id = self.as_its_own_record(id, type_id)?;
        let ty = HirType::Managed(ManagedType::Object(type_id));
        let layout = self.layout_of(id, type_id)?;
        let origin = self.origin(id);
        let object = self.push(OpKind::ObjectNew { frame: false }, ty, origin.clone());

        // Source order, since an initializer may have effects and they happen
        // where the author wrote them. The *field index* is what puts them in
        // layout order.
        for property in self.children(id) {
            // `{ ...base, k: v }`. A field-by-field copy, emitted where the
            // spread is written so that a property after it overwrites and a
            // property before it is overwritten -- which is the whole of what
            // the spelling means, and it falls out of source order rather than
            // needing a rule.
            //
            // 25 sites in `runtime/node` and `runtime/web-platform`, 158
            // functions across the module builds: `util/inspect.ts`,
            // `stream/from.ts`, `util/format.ts`, `fs/src/options.ts`.
            //
            // Only from something with a layout. A spread of an erased value or
            // of a table has no field list to walk, and guessing one would be a
            // struct built from nothing.
            if self.kind_of(property) == Some(syntax::SPREAD_ASSIGNMENT) {
                self.spread_into(property, object, &layout, &origin)?;
                continue;
            }
            // A method or an accessor is not storage. It was lowered as a
            // function of its own by `lower_object_literal_members`, and the
            // layout has no field for it to be written to.
            //
            // **Unless it does**, which is the half this skipped silently. The
            // sentence above is true of the literal's *own* type and false when
            // the literal is built at a declared one:
            //
            // ```ts
            //   interface WithGetter { readonly a: number }
            //   const o: WithGetter = { get a(): number { return 3; } };
            //   o.a        // answered 0; node says 3
            // ```
            //
            // `WithGetter` declares `a` as **storage**, so the layout has a slot
            // for it, the accessor was skipped, and the slot kept the zero a
            // fresh allocation has. No refusal, no diagnostic, three backends
            // agreeing on the same wrong number because it is what the slot
            // holds.
            //
            // Refused rather than answered, and it has to be: the slot wants a
            // value and JavaScript re-runs the getter on every read, so calling
            // it once at construction would be a different program. What the
            // representation would need is an accessor that a *field* read can
            // dispatch to, which is a feature rather than a repair.
            if matches!(
                self.kind_of(property),
                Some(syntax::METHOD_DECLARATION | syntax::GET_ACCESSOR | syntax::SET_ACCESSOR)
            ) {
                // **Its own name child, because `property_name` refuses this
                // shape on purpose** --- "a `get accessor` in an object
                // literal" is one of the messages it exists to give. Asking it
                // here and taking `.ok()` swallowed that refusal and fell
                // straight back to `continue`, so the first version of this
                // guard did nothing at all and every control still passed.
                let occupies = self
                    .children(property)
                    .first()
                    .and_then(|name| self.property_key(*name))
                    .and_then(|name| layout.index_of_key(&name).map(|field| (name, field)));
                let Some((name, field)) = occupies else {
                    continue;
                };
                // **A method written for a slot is the closure that fills it.**
                // The slot is there for one of two reasons -- the type declares
                // the member as a field, `write?: Callback`, which is how the
                // stream sinks and sources are declared; or the type's literals
                // made a method one (`Hierarchy::stored`) -- and either way the
                // method was collected the way a `function` expression is, so
                // `lower_arrow` builds it, captures and all. One that reads
                // `this` was not collected: it binds its own, a closure cannot
                // be it, and it is refused here by name rather than as "an
                // arrow function the collector did not see".
                //
                // An accessor stays refused: the slot wants a value and
                // JavaScript re-runs the getter on every read.
                if self.kind_of(property) == Some(syntax::METHOD_DECLARATION) {
                    if self.binds_this(property) {
                        return Err(self.unsupported(
                            property,
                            &format!(
                                "`{name}`, a method reading `this` where the type declares a \
                                 field holding a closure"
                            ),
                        ));
                    }
                    let want = layout.fields[field as usize].ty.clone();
                    let value = self.lower_arrow(property)?;
                    let value = self.coerce(value, &want, property)?;
                    self.field_set(object, field, value, &origin);
                    continue;
                }
                return Err(self.unsupported(
                    property,
                    &format!(
                        "`{name}`, supplied as an accessor where the type declares storage for it"
                    ),
                ));
            }
            // The name first, then the slot, then the value. At the field's
            // type, like every other slot a value meets: an optional field is
            // erased -- its absence is a tag -- so a literal that supplies one
            // erases on the way in, and a literal that *is* one is built at the
            // field's type rather than at its own and cast.
            let name = self.property_name(property)?;
            let Some(field) = layout.index_of_key(&name) else {
                return Err(self.unsupported(property, "a property the type does not declare"));
            };
            let want = layout.fields[field as usize].ty.clone();
            // `{ done: true, value: undefined }` -- the return arm of an
            // iterator result, whose `value` slot has the *yield* arm's
            // representation and so has no room for an absence.
            //
            // The slot is filled with that representation's zero, and the
            // reason that is not a wrong answer is the other half of this
            // decision rather than anything here: **no read can reach it.**
            // `read_iterator_value` refuses a `.value` read that is not proven
            // to sit under `!done`, and `protocol_step` builds its own read on
            // the not-done edge. Land one half without the other and
            // `it.next().value` answers `0` where JavaScript says `undefined`.
            //
            // Only the non-reference case needs this: a `Managed` slot takes
            // `undefined` as a null already, which is why an
            // `IteratorResult<string>` compiled before this line existed.
            let value = if self.is_iterator_return_arm(id, &layout, &name) {
                self.push(crate::hir::zero_of(&want), want.clone(), origin.clone())
            } else {
                let (_, value) = self.property_parts(property, Some(&want))?;
                self.coerce(value, &want, property)?
            };
            self.field_set(object, field, value, &origin);
        }
        if erase_afterwards {
            return Ok(self.push(
                OpKind::Erase {
                    value: object,
                    absent: Absent::Impossible,
                    slots: Absent::Impossible,
                },
                HirType::Erased,
                origin,
            ));
        }
        Ok(object)
    }

    /// `...base` inside an object literal, as one store per field.
    ///
    /// The source's layout is what says which fields there are, and a field the
    /// *target* does not declare is skipped rather than refused: the result's
    /// type is what the checker gave the literal, so a field outside it cannot
    /// be read back and copying it would need a slot that does not exist.
    ///
    /// Each field goes through `coerce`, like every other value meeting a slot,
    /// because the two layouts may disagree about representation -- an optional
    /// field is erased on one side and may be concrete on the other.
    fn spread_into(
        &mut self,
        property: NodeId,
        object: ValueId,
        into: &Layout,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let [source] = self.children(property).as_slice().try_into().map_err(|_| {
            self.unsupported(
                property,
                "a spread of unexpected shape in an object literal",
            )
        })?;
        let value = self.lower_expression(source)?;
        let HirType::Managed(ManagedType::Object(from)) = self.values[value.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(
                source,
                "a spread of a value with no fields to copy -- an object literal spread is a \
                 field-by-field copy, and only a value with a layout has fields to walk",
            ));
        };
        let from_type = from;
        if self.known_allocation(value).is_none()
            && self.hierarchy.access_families.changes_transport(from_type)
            && !self.hierarchy.access_families.permits_spread(from_type)
        {
            return Err(self.unsupported(property,
                "an object spread through an interface whose concrete own properties, order or storage are not uniform -- field accessors do not supply own-property reflection"));
        }
        let from = self.layout_of(source, from_type)?;
        let mut copied: Vec<u32> = Vec::new();
        for (at, field) in from.fields.iter().enumerate() {
            let Some(target) = into.index_of_key(&field.name) else {
                continue;
            };
            let Ok(at) = u32::try_from(at) else { continue };
            let read = self.push(
                OpKind::FieldGet {
                    object: value,
                    field: at,
                },
                field.ty.clone(),
                origin.clone(),
            );
            let want = into.fields[target as usize].ty.clone();
            let read = self.coerce(read, &want, property)?;
            self.field_set(object, target, read, origin);
            copied.push(target);
        }

        // **A getter has no field, so the walk above cannot see it.**
        //
        // `Layout` holds storage, and an accessor is a call rather than
        // storage --- `Accessor`'s own doc says emitting a field load for one
        // "reads whatever happens to sit at that offset". A layout therefore
        // has no entry for `get a()`, and this loop did not skip it *wrongly*
        // so much as never meet it: the source's fields are walked, `a` is not
        // one, and the target's `a` kept the zero it was allocated with.
        //
        // That is silent. `{ ...src }` compiled, ran, and answered 0 where node
        // answers the getter's value, and the getter did not run at all --- so
        // a spread also dropped whatever side effect it had.
        //
        // The names come from the *target*, because that is what has slots to
        // fill, and `accessor_callee` is asked against the **source's** type, so
        // a name the literal writes itself is not an accessor there and is left
        // for the code that writes it. Anything the field walk already copied is
        // skipped, so a plain field is never read twice.
        for (target, want) in into.fields.iter().enumerate() {
            let Ok(target) = u32::try_from(target) else {
                continue;
            };
            if copied.contains(&target) {
                continue;
            }
            let Some(callee) =
                self.accessor_callee(source, from_type, &want.name, MethodAccessor::Get)?
            else {
                continue;
            };
            let returns = self
                .declared_type_of(from_type, &want.name)
                .and_then(|declared| self.represent(declared))
                .unwrap_or_else(|| want.ty.clone());
            let read =
                self.push_an_accessor_call(source, callee, vec![value], returns, origin.clone());
            let read = self.coerce(read, &want.ty.clone(), property)?;
            self.field_set(object, target, read, origin);
        }
        Ok(())
    }
}
