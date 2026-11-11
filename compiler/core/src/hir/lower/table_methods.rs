//! Construct and operate on Map and Set storage, including insertion, pair walking, and callbacks.

use super::{
    Absent, BinOp, Binds, CallbackResult, CallbackReturn, Callee, Counts, Diagnostic, FuncBuilder,
    HirType, ManagedType, NativeBy, NodeId, OpKind, Origin, Pair, Representation, SemanticSnapshot,
    Step, Terminator, TypeId, TypeKind, ValueId, Walk, admits_absence, claimed_reads,
    counted_helper, holds_counted, property_keys, representation_within, syntax,
};

/// A `Map`'s key or a `Set`'s element, at the representation its table
/// compares it as.
///
/// **A key that may be absent is held erased.** A table compares its keys, and
/// a `string | undefined` key's own representation -- a string whose null
/// pointer is `undefined` -- says nothing a string hash can read: C and LLVM
/// hashed the null pointer as a string and faulted, and Wasm, which builds its
/// collection from this type, declined every key that was not a string. Held
/// erased, a key carries its tag, `tables::key_kind` answers `ERASED` for it, and
/// every backend's table compares by that tag.
pub(super) fn table_key_within(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    path: &mut Vec<TypeId>,
    subst: &Representation<'_>,
) -> Option<HirType> {
    let held = representation_within(snapshot, ty, path, subst)?;
    Some(
        if crate::hir::tags::payload_is_a_reference(&held) && admits_absence(snapshot, ty) {
            HirType::Erased
        } else {
            held
        },
    )
}

/// Whether a walk reads two values a turn -- a `Map`'s or `Set`'s entries,
/// an array's `[index, element]` -- which a collection stores as one pair.
pub(super) fn walks_pairs(walk: &Walk) -> bool {
    matches!(
        walk,
        Walk::Entries { .. }
            | Walk::Counted {
                binds: Binds::PositionAndElement,
                ..
            }
    )
}

/// The helper that copies a table's keys (`nts_map_key_at`'s walk) or values
/// (`nts_map_value_at`'s) into an array whose element is the type the table
/// stores them as, or none where the element is any other type. A Set's
/// values are its keys, and its walk already reads them as keys.
pub(super) fn table_fill(table: &HirType, read: &str, element: &HirType) -> Option<&'static str> {
    let (stored, fill) = match (table, read) {
        (
            HirType::Managed(
                ManagedType::Set(key) | ManagedType::Map(key, _) | ManagedType::Table(key, _),
            ),
            "nts_map_key_at",
        ) => (key, "nts_map_keys_into"),
        (
            HirType::Managed(ManagedType::Map(_, value) | ManagedType::Table(_, value)),
            "nts_map_value_at",
        ) => (value, "nts_map_values_into"),
        _ => return None,
    };
    (stored.as_ref() == element).then_some(fill)
}

impl FuncBuilder<'_> {
    /// `map.forEach(cb)` and `set.forEach(cb)`, as the walk they are.
    ///
    /// The same loop `for...of` builds over a table -- `walk_cursor` for the
    /// entry index, `walk_condition` for the test, `read_element` for the reads,
    /// `Step::Walk` for the advance -- with the callback's body inlined where
    /// the head's bindings would go. Nothing is allocated and nothing is called
    /// indirectly, which is what `tests/programs/callbacks` says about the array
    /// methods and is now true of these.
    ///
    /// # The callback's parameters
    ///
    /// `(value, key, map)` for a `Map`, which is **not** the order the table
    /// stores them in: `read_element` answers `[key, value]` because that is
    /// what `for (const [k, v] of map)` binds, and `forEach` hands the value
    /// first. Getting that backwards does not fail -- it computes a different
    /// number -- so the example asks node about a map whose keys and values are
    /// different.
    ///
    /// A `Set` has no values, and node passes the element **twice**:
    /// `s.forEach((v, k) => ...)` sees `v === k`. So the second parameter is the
    /// same read as the first rather than an error, which is what the language
    /// says and what the differential checks.
    fn lower_table_for_each(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        table: &HirType,
        callback: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let parameters = self.callback_parameters(callback, "forEach")?;
        // The value, optionally the key. The third parameter is the table
        // itself, refused for the reason the array's third is: handing the
        // receiver to the body lets it be stored where the loop cannot see.
        if parameters.is_empty() || parameters.len() > 2 {
            return Err(self.unsupported(
                callback,
                &format!(
                    "a `forEach` callback taking {} parameters, where it may take 1 or 2 -- \
                     the value and the key",
                    parameters.len()
                ),
            ));
        }
        let body = *self
            .children(callback)
            .last()
            .ok_or_else(|| self.unsupported(callback, "a `forEach` callback with no body"))?;

        // Entries for a `Map`, and the same read twice for a `Set`.
        let walk = match table {
            HirType::Managed(ManagedType::Map(key, value)) => Walk::Entries {
                key: (**key).clone(),
                value: (**value).clone(),
                value_read: "nts_map_value_at",
            },
            HirType::Managed(ManagedType::Set(element)) => Walk::Entries {
                key: (**element).clone(),
                value: (**element).clone(),
                value_read: "nts_map_key_at",
            },
            _ => {
                return Err(self.unsupported(id, "a `forEach` over something that is not a table"));
            }
        };

        let origin = self.origin(id);
        // A table is walked by its own entries and lends nothing.
        let (receiver, cursor, _) = self.walk_start(&walk, receiver, &origin)?;
        let cursor = cursor.ok_or_else(|| self.unsupported(id, "a table walk with no cursor"))?;
        let synthetic = vec![cursor];
        let carried = self.carried_across(body, &synthetic, &parameters);
        let record = self.begin_loop(id, &carried, true, &origin)?;

        let at = self.bindings[&cursor];
        let cond = self.walk_condition(&walk, at, receiver, &origin)?;
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let at = self.bindings[&cursor];
        let read = self.read_element(&walk, receiver, at, &origin)?;
        let [key, value] = read.as_slice() else {
            return Err(self.unsupported(id, "a table walk that did not read a pair"));
        };
        // Value first. See above.
        self.bindings.insert(parameters[0], *value);
        if let Some(second) = parameters.get(1) {
            self.bindings.insert(*second, *key);
        }

        // `forEach` drops whatever the body produces, and a `return` inside it
        // is a `continue` -- the same delivery the array's `forEach` uses.
        let result = CallbackResult::Discard;
        self.callback_returns.push(CallbackReturn {
            depth: record.depth,
            result,
        });
        let concise = self.kind_of(body) != Some(syntax::BLOCK);
        let lowered = if concise {
            self.lower_expression(body).map(|_| ())
        } else {
            self.lower_statement(body)
        };
        self.callback_returns.pop();
        lowered?;

        self.end_loop(
            &record,
            Step::Walk {
                cursor,
                walk,
                sequence: receiver,
            },
        )?;
        // `forEach` evaluates to `undefined`, which is `void` here.
        Ok(self.push(OpKind::ConstFloat(0.0), HirType::Void, origin))
    }

    /// `list.forEach(f)` of a collection a binding implements
    /// ([`Self::delegated_collection`]), inlined as the table's is: the
    /// callback's body where the walk's bindings would go.
    ///
    /// **As `%Array.prototype.forEach%` walks an array-like**: the length read
    /// once, then `f(item(k), k)` for each `k` below it whose item is still
    /// there. A `NodeList` or an `HTMLCollection` is missing only its tail, so
    /// "still there" is `k` below the length read now, and the first missing
    /// one ends the walk without skipping one that would have been visited.
    /// Where `for...of` reads the length each turn and sees the list grow,
    /// this does not, as page script does not.
    ///
    /// The element is read as the callback's first parameter's type, on the
    /// ground [`Self::delegated_walk`] reads a loop variable's. The third
    /// parameter, the list, is refused as the array's is.
    pub(super) fn lower_delegated_for_each(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        callback: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let parameters = self.callback_parameters(callback, "forEach")?;
        if parameters.is_empty() || parameters.len() > 2 {
            return Err(self.unsupported(
                callback,
                &format!("a `forEach` callback taking {} parameters, where it may take 1 or 2 -- the item and its index", parameters.len()),
            ));
        }
        let body = *self
            .children(callback)
            .last()
            .ok_or_else(|| self.unsupported(callback, "a `forEach` callback with no body"))?;
        let Walk::Native(mut native) = self.delegated_walk(receiver_node)? else {
            return Err(self.unsupported(
                id,
                "a `forEach` over a bound collection that is not walked by `item`",
            ));
        };
        if let Some(declared) = self
            .snapshot
            .symbols
            .get(parameters[0] as usize)
            .and_then(|symbol| symbol.ty)
            .and_then(|ty| self.represent(ty))
            && Self::host_downcast(&native.element, &declared)
        {
            native.element = declared;
        }
        let NativeBy::Vector(methods) = &native.by else {
            return Err(self.unsupported(
                id,
                "a `forEach` over a bound collection that is not walked by `item`",
            ));
        };
        let origin = self.origin(id);
        let length = self.call_native_walk(native.site, &methods.size, receiver, Vec::new())?;
        let length = self.coerce(length, &HirType::NUMBER, native.site)?;
        let walk = Walk::Native(native);
        let (receiver, cursor, _) = self.walk_start(&walk, receiver, &origin)?;
        let cursor =
            cursor.ok_or_else(|| self.unsupported(id, "a collection walk with no cursor"))?;
        let carried = self.carried_across(body, &[cursor], &parameters);
        let record = self.begin_loop(id, &carried, true, &origin)?;

        let at = self.bindings[&cursor];
        let within = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        let there = self.walk_condition(&walk, at, receiver, &origin)?;
        // Both read before the branch (`bool_join`): a length read changes
        // nothing and cannot throw.
        let cond = self.bool_join(within, there, false, &origin);
        self.test_loop(cond, &record);
        self.switch_to(record.body);

        let at = self.bindings[&cursor];
        let read = self.read_element(&walk, receiver, at, &origin)?;
        let [item] = read.as_slice() else {
            return Err(self.unsupported(id, "a collection walk that did not read one item"));
        };
        self.bindings.insert(parameters[0], *item);
        if let Some(second) = parameters.get(1) {
            self.bindings.insert(*second, at);
        }
        // A `return` inside the callback is a `continue`, as the array's is.
        self.callback_returns.push(CallbackReturn {
            depth: record.depth,
            result: CallbackResult::Discard,
        });
        let lowered = if self.kind_of(body) == Some(syntax::BLOCK) {
            self.lower_statement(body)
        } else {
            self.lower_expression(body).map(|_| ())
        };
        self.callback_returns.pop();
        lowered?;
        self.end_loop(
            &record,
            Step::Walk {
                cursor,
                walk,
                sequence: receiver,
            },
        )?;
        Ok(self.push(OpKind::ConstFloat(0.0), HirType::Void, origin))
    }

    /// `{ x: 1, y }`.
    ///
    /// An allocation and a store per field. The fields are written in *layout*
    /// order rather than source order, so two literals of one type produce the
    /// same stores — which is what lets a later pass recognize them as the same
    /// shape.
    /// An object literal whose contextual type is a string-keyed table.
    ///
    /// The allocation is `nts_map_new`, and each property written in the
    /// literal is a `set`. A literal's keys are written down, so they are
    /// string constants and the table is filled in source order for the same
    /// reason an object literal is: an initializer may have effects.
    ///
    /// A computed key -- `{ [name]: 1 }` -- is refused rather than lowered,
    /// because the name is not the identifier it looks like and taking it as
    /// one would build a table keyed by the *spelling* of a variable.
    pub(super) fn lower_table_literal(
        &mut self,
        id: NodeId,
        ty: HirType,
        key: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let properties = self.children(id);
        // A leading spread is where the table comes from, so the copy *is* the
        // allocation. `{ ...obj, k: v }` is one copy and one set, and the copy
        // preserves insertion order -- which is observable: node appends `k`
        // where it is encountered, and building the replacement with the new
        // key first made `parse("a&__proto__")` enumerate as `__proto__, a`.
        // `querystring`'s own comment records a differential over 4,000
        // generated queries finding that, and none of its four pinned files
        // covering it.
        let leading_spread = properties
            .first()
            .filter(|first| self.kind_of(**first) == Some(syntax::SPREAD_ASSIGNMENT))
            .copied();
        let table_ty = ty.clone();
        let table = if let Some(spread) = leading_spread {
            {
                let Some(source) = self.children(spread).first().copied() else {
                    return Err(self.unsupported(spread, "a spread with nothing to spread"));
                };
                let source = self.lower_expression(source)?;
                if !matches!(
                    self.values[source.0 as usize].ty,
                    HirType::Managed(ManagedType::Table(_, _))
                ) {
                    // Spreading a *struct* into a table would have to know the
                    // layout's names, which is a different feature from copying
                    // a table and is not this one.
                    return Err(self.unsupported(
                        spread,
                        "a spread of something that is not a table into a table",
                    ));
                }
                self.push(
                    OpKind::Call {
                        callee: Callee::External("nts_map_copy".to_owned()),
                        args: vec![source],
                        frame: None,
                    },
                    ty,
                    origin.clone(),
                )
            }
        } else {
            let kind = self.push(
                OpKind::ConstFloat(f64::from(crate::hir::tables::key_kind(key))),
                HirType::NUMBER,
                origin.clone(),
            );
            self.push(
                OpKind::Call {
                    callee: Callee::External("nts_table_new".to_owned()),
                    args: vec![kind],
                    frame: None,
                },
                ty,
                origin.clone(),
            )
        };
        for property in properties {
            if Some(property) == leading_spread {
                continue;
            }
            // A *later* spread would have to merge into a table that already
            // has entries, and `nts_map_copy` allocates rather than merges.
            // Refused by position rather than silently reordered.
            if self.kind_of(property) == Some(syntax::SPREAD_ASSIGNMENT) {
                return Err(self.unsupported(
                    property,
                    "a spread after the first property of a table literal",
                ));
            }
            let (key, value) = self.table_property(property, &origin)?;
            self.keyed_call(
                "nts_map_set",
                &table_ty,
                vec![table, key, value],
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(table)
    }

    /// One property of a table literal, as an erased key and an erased value.
    ///
    /// Separate from [`Self::property_parts`] because a table admits what a
    /// struct cannot: `{ ["__proto__"]: value }` is a computed name, which a
    /// layout has no slot for and a table has no difficulty with. The rest is
    /// the same, so the ordinary forms are delegated.
    fn table_property(
        &mut self,
        property: NodeId,
        origin: &Origin,
    ) -> Result<(ValueId, ValueId), Diagnostic> {
        let computed = (self.kind_of(property) == Some(syntax::PROPERTY_ASSIGNMENT))
            .then(|| self.children(property))
            .filter(|children| children.len() == 2)
            .filter(|children| self.kind_of(children[0]) == Some(syntax::COMPUTED_PROPERTY_NAME));
        if let Some(children) = computed {
            let Some(expression) = self.children(children[0]).first().copied() else {
                return Err(self.unsupported(children[0], "a computed name with no expression"));
            };
            let key = self.lower_expression(expression)?;
            let key = self.erased_from(key, expression, origin);
            let value = self.lower_expression(children[1])?;
            let value = self.erased_from(value, children[1], origin);
            return Ok((key, value));
        }
        let (name, value) = self.property_parts(property, None)?;
        let name = name
            .public_name()
            .ok_or_else(|| self.unsupported(property, "a table property with a non-string key"))?
            .to_owned();
        let key = self.push(
            OpKind::ConstString(name.into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        // The value's own node: an assignment's initializer, a shorthand's name.
        let written = match self.kind_of(property) {
            Some(syntax::PROPERTY_ASSIGNMENT) => self.children(property).get(1).copied(),
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => self.children(property).first().copied(),
            _ => None,
        };
        let key = self.erased(key, Absent::Impossible, origin);
        let value = self.erased_from(value, written.unwrap_or(property), origin);
        Ok((key, value))
    }

    /// `t.a` on an index-signature type, which is `t["a"]`.
    ///
    /// They are one operation in JavaScript -- a property access with a literal
    /// key -- and only the *spelling* differed: the bracketed form reached
    /// `element_of`'s table arm and the dotted form fell through to "a property
    /// of a value with no fields", which is a sentence about a
    /// `Record<string, T>` that has no fields *because that is what an index
    /// signature is*.
    ///
    /// ```text
    /// const env: Readonly<Record<string, string | undefined>>
    /// env.NODE_USE_ENV_PROXY === "1"
    /// ```
    ///
    /// is `http`'s `useEnvironmentProxy`, and what it cost is not one function.
    /// `globalAgent`'s initializer is a ternary on that call, so a doomed value
    /// reaches a branch, so `excise_from_initializer` cannot cut the statement
    /// -- and `module#init` was dropped **whole**, leaving every deferred global
    /// in the program unwritten and every function reading one refused with it.
    /// Two modules of fourteen lost their initializer that way and `http` was
    /// one; see record 0272. With this in, `http` goes from 1196 functions to
    /// 1522.
    ///
    /// The result is erased and `narrowed` puts back whatever the checker has
    /// already taken away, exactly as the bracketed form does -- `V | undefined`
    /// is what the language says a lookup answers and what `nts_map_get`
    /// returns.
    pub(super) fn table_member(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let key = self.push(
            OpKind::ConstString(member_name.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        let key = self.erased(key, Absent::Impossible, &origin);
        let read = property_keys::apply(self, id, value, key, property_keys::Action::Get);
        claimed_reads::narrowed(self, id, read)
    }

    /// What a typed-array view answers, and why `length` is a call.
    ///
    /// A view built without an explicit length follows its buffer through
    /// `resize`, so the length is computed rather than read out of a header --
    /// which is the whole difference between `new Uint8Array(buffer)` and
    /// `view.subarray(0)` on a resizable buffer, and it is observable.
    ///
    /// `buffer`, `byteLength` and `byteOffset` are the three an array does not
    /// have and a view does. They are the reason this is a separate
    /// representation rather than a flag.
    /// The same three on a view whose element type the declaration does not
    /// name, and the one it cannot answer.
    ///
    /// `byteLength`, `byteOffset` and `buffer` need no width: `NtsView` carries
    /// all three whatever it holds. `length` does -- it is `byteLength` divided
    /// by the element size -- so it is refused here rather than inside
    /// `view_property`, where it would read as a member this compiler does not
    /// provide instead of one this *declaration* cannot support.
    /// A table's `size`.
    ///
    /// Its live entry count, which the header already holds in the field an
    /// array's `length` uses — so it is the same operation, not a call.
    ///
    /// Extracted alongside [`Self::symbol_property`] and
    /// [`Self::any_view_property`]: `member_of` now dispatches four
    /// natively-represented receivers and was reading four different ways.
    pub(super) fn table_size(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        if member_name != "size" {
            return Err(self.unsupported(
                id,
                &format!("`{member_name}`, where a `Map` or a `Set` has only `size`"),
            ));
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::Length(value), HirType::NUMBER, origin))
    }

    /// `new Map()` and `new Set()`.
    ///
    /// The table is one runtime struct, so what the constructor carries is
    /// which hash and comparison to build it with -- decided here, from the
    /// static key type, and never asked again.
    pub(super) fn lower_new_table(
        &mut self,
        id: NodeId,
        ty: &HirType,
        key: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let is_a_map = matches!(ty, HirType::Managed(ManagedType::Map(_, _)));
        // An argument is an initializer -- `new Map([[k, v]])` or
        // `new Set(xs)` -- which is iteration, and the protocol that would serve
        // it does not exist. Refused rather than dropped: a `new Set(existing)`
        // that silently produced an empty one is the kind of wrong that reads as
        // a logic bug in the caller.
        let contents = self.arguments_of(id).first().copied();
        let origin = self.origin(id);
        let kind = self.push(
            OpKind::ConstFloat(f64::from(crate::hir::tables::key_kind(key))),
            HirType::NUMBER,
            origin.clone(),
        );
        let table = self.push(
            OpKind::Call {
                callee: Callee::External(
                    if is_a_map {
                        "nts_map_new"
                    } else {
                        "nts_set_new"
                    }
                    .to_owned(),
                ),
                args: vec![kind],
                frame: None,
            },
            ty.clone(),
            origin.clone(),
        );
        let Some(contents) = contents else {
            return Ok(table);
        };
        // **At the array the contents are going to be walked as.** `new
        // Set<number>([])` types its literal `never[]` and falls back to the
        // *contextual* type, which is the constructor's `Iterable<T>` -- not an
        // array, so the literal refused for a shape it was about to be given.
        // A Set's element is its key; a Map's is a two-field tuple this does not
        // have a representation for here, so only the one is passed.
        let wanted =
            (!is_a_map).then(|| HirType::Managed(ManagedType::Array(Box::new(key.clone()))));
        self.fill_table_from(id, contents, table, is_a_map, wanted.as_ref(), &origin)?;
        Ok(table)
    }

    /// How a map's `[key, value]` element stores its two halves.
    ///
    /// **Asking only about the first was a real hole.** A tuple whose members
    /// differ is an object layout with two fields; a tuple whose members agree
    /// -- `Map<number, number>` -- is an *array*, because two slots of one
    /// representation are storage that needs no names. Both are `[K, V]` to the
    /// checker, and `mapOfNumbers` in the fixture is the arm that found it: it
    /// refused beside three string-keyed arms that passed.
    ///
    /// Arity is the checker's. `Map<K, V>`'s constructor takes
    /// `readonly (readonly [K, V])[]`, so an array of three would not have
    /// typechecked; the slot reads are still emitted checked, because
    /// `bounds.rs` is where an index proof is spent or kept.
    fn pair_shape(&mut self, contents: NodeId, element: &HirType) -> Result<Pair, Diagnostic> {
        match element {
            HirType::Managed(ManagedType::Object(pair)) => {
                let layout = self.layout_of(contents, *pair)?;
                if layout.fields.len() != 2 {
                    return Err(self.unsupported(
                        contents,
                        "a `new Map` over an array of tuples that are not exactly two long",
                    ));
                }
                Ok(Pair::Fields(layout))
            }
            HirType::Managed(ManagedType::Array(slot)) => Ok(Pair::Slots((**slot).clone())),
            _ => Err(self.unsupported(
                contents,
                "a `new Map` over an array whose elements are not `[key, value]` pairs",
            )),
        }
    }

    /// What one step of the filling loop hands `nts_set_add` or `nts_map_set`.
    ///
    /// The table first, then the element -- or, for a map, the pair's two
    /// halves, read the way its representation stores them. Everything crosses
    /// erased, because that is what a table holds, which is the same thing
    /// `lower_table_method` does for `s.add(v)` and `m.set(k, v)`. Each half is
    /// erased with the absence the type it is written at allows (`written`,
    /// from [`Self::written_halves`]): an element has no node of its own.
    fn table_insertion_arguments(
        &mut self,
        (table, entry): (ValueId, ValueId),
        pair: Option<&Pair>,
        written: [Option<TypeId>; 2],
        origin: &Origin,
    ) -> Vec<ValueId> {
        let mut args = vec![table];
        let erase = |builder: &mut Self, value: ValueId, half: usize| {
            let have = builder.values[value.0 as usize].ty.clone();
            let absent = written[half].map_or(Absent::Impossible, |ty| {
                builder.absence_of_type(ty, &have, false)
            });
            builder.erased(value, absent, origin)
        };
        match pair {
            Some(Pair::Fields(layout)) => {
                for field in 0..2u32 {
                    let slot = self.push(
                        OpKind::FieldGet {
                            object: entry,
                            field,
                        },
                        layout.fields[field as usize].ty.clone(),
                        origin.clone(),
                    );
                    args.push(erase(self, slot, field as usize));
                }
            }
            Some(Pair::Slots(slot_ty)) => {
                for half in 0..2u32 {
                    let at = self.push(
                        OpKind::ConstFloat(f64::from(half)),
                        HirType::NUMBER,
                        origin.clone(),
                    );
                    let slot = self.push(
                        OpKind::ArrayGet {
                            array: entry,
                            index: at,
                            checked: true,
                        },
                        slot_ty.clone(),
                        origin.clone(),
                    );
                    args.push(erase(self, slot, half as usize));
                }
            }
            None => args.push(erase(self, entry, 0)),
        }
        args
    }

    /// The checker types `new Set(xs)`'s elements, or `new Map(entries)`'s two
    /// halves, are written at -- what [`Self::absence_of_type`] asks of a value
    /// an array hands out. `None` where the contents' type says nothing that
    /// specific, which erases as a value with no absence, as before.
    fn written_halves(&self, contents: NodeId, is_a_map: bool) -> [Option<TypeId>; 2] {
        let source = |ty: TypeId| *self.sources.get(&ty).unwrap_or(&ty);
        let kind = |ty: TypeId| {
            self.snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
        };
        let element =
            self.snapshot
                .node_types
                .get(&contents)
                .and_then(|ty| match kind(source(*ty)) {
                    Some(TypeKind::Array(element)) => Some(source(*element)),
                    _ => None,
                });
        if !is_a_map {
            return [element, None];
        }
        match element.and_then(kind) {
            Some(TypeKind::Tuple(tuple)) if tuple.elements.len() == 2 => {
                [Some(tuple.elements[0]), Some(tuple.elements[1])]
            }
            _ => [None, None],
        }
    }

    /// `new Set([1, 2])` and `new Map([[k, v]])` -- the contents, as a loop.
    ///
    /// **An array only, and that is the whole feature.** The constructors take
    /// any iterable, and an arbitrary one needs `Iterable<T>` to be
    /// representable -- a library interface whose method has to be dispatched,
    /// which is a larger piece and the one the iteration family is behind. An
    /// array needs none of it: its length is known and its elements are indexed.
    /// Anything else is still refused, by name.
    ///
    /// **Nothing new in the runtime, and that is deliberate.** The loop calls
    /// `nts_set_add` and `nts_map_set`, which `lower_table_method` already
    /// calls for `s.add(v)` and `m.set(k, v)`, so the three backends need no
    /// change and cannot disagree about this: a helper added for one of them
    /// red-gates the others, and there is no allowance list for that.
    ///
    /// The index write is emitted **checked**, not because it can fail but
    /// because `bounds.rs` is where that is decided: `i < nts_length(xs)` is the
    /// relation its interval domain is built to eliminate, and asserting the
    /// elimination here would be a second derivation of the same proof.
    fn fill_table_from(
        &mut self,
        id: NodeId,
        contents: NodeId,
        table: ValueId,
        is_a_map: bool,
        wanted: Option<&HirType>,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let source = match wanted {
            Some(wanted) => self.lower_expecting(contents, wanted)?,
            None => self.lower_expression(contents)?,
        };
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[source.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(
                contents,
                "a `new Map` or `new Set` over something that is not an array, which needs the \
                 iteration protocol",
            ));
        };
        let element_ty = (*element).clone();
        let pair = is_a_map
            .then(|| self.pair_shape(contents, &element_ty))
            .transpose()?;

        let length = self.push(OpKind::Length(source), HirType::NUMBER, origin.clone());
        let start = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let header = self.new_block();
        let body = self.new_block();
        let exit = self.new_block();
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![start],
        });

        self.switch_to(header);
        let index = self.push_block_param(header, HirType::NUMBER, origin.clone());
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: index,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: exit,
            else_args: Vec::new(),
        });

        self.switch_to(body);
        let entry = self.push(
            OpKind::ArrayGet {
                array: source,
                index,
                checked: true,
            },
            element_ty,
            origin.clone(),
        );
        let written = self.written_halves(contents, is_a_map);
        let args = self.table_insertion_arguments((table, entry), pair.as_ref(), written, origin);
        let helper = if is_a_map {
            "nts_map_set"
        } else {
            "nts_set_add"
        };
        let table_ty = self.values[table.0 as usize].ty.clone();
        self.keyed_call(helper, &table_ty, args, HirType::Void, origin.clone());
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: index,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: header,
            args: vec![next],
        });

        self.switch_to(exit);
        let _ = id;
        Ok(())
    }

    /// A method on a `Map` or a `Set`.
    ///
    /// Keys and values cross as `NtsValue`s, which is what the table stores, so
    /// each one is erased at the call. That is a tag write beside a payload the
    /// caller already had -- and for `get` there is nothing to undo on the way
    /// back, because `V | undefined` *is* an erased value and the slot is
    /// returned whole.
    ///
    /// The iterating half -- `keys`, `values`, `entries`, `forEach` -- is
    /// absent, and refused by name rather than by silence: each needs the
    /// iteration protocol, which does not exist yet.
    pub(super) fn lower_table_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        table: &HirType,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(name) = self.literal_name(member) else {
            return Err(self.unsupported(member, "a table method whose name the program computes"));
        };
        let is_a_map = matches!(table, HirType::Managed(ManagedType::Map(_, _)));
        let what = if is_a_map { "Map" } else { "Set" };

        if name == "forEach"
            && let [callback] = arguments
            && self.inlines_as_a_callback(*callback)
        {
            return self.lower_table_for_each(id, receiver, table, *callback);
        }
        if matches!(name.as_str(), "keys" | "values" | "entries" | "forEach") {
            return Err(self.unsupported(
                member,
                &format!("`{what}#{name}`, which needs the iteration protocol"),
            ));
        }

        // (runtime function, arguments after the receiver, result)
        let (helper, arity, ty) = match (name.as_str(), is_a_map) {
            ("get", true) => ("nts_map_get", 1, HirType::Erased),
            ("set", true) => ("nts_map_set", 2, table.clone()),
            ("add", false) => ("nts_set_add", 1, table.clone()),
            ("has", _) => ("nts_map_has", 1, HirType::Bool),
            ("delete", _) => ("nts_map_delete", 1, HirType::Bool),
            ("clear", _) => ("nts_map_clear", 0, HirType::Void),
            _ => {
                return Err(self.unsupported(
                    member,
                    &format!("`{what}#{name}`, which this table has not"),
                ));
            }
        };
        if arguments.len() != arity {
            return Err(self.unsupported(
                id,
                &format!("`{what}#{name}` with {} argument(s)", arguments.len()),
            ));
        }

        let origin = self.origin(id);
        let mut args = vec![receiver];
        for argument in arguments {
            let value = self.lower_expression(*argument)?;
            args.push(self.erased_from(value, *argument, &origin));
        }
        let call = if crate::hir::tables::kind_at(helper).is_some() {
            self.keyed_call(helper, table, args, ty, origin)
        } else {
            self.runtime_call(helper, args, ty, origin)
        };
        // A `get` whose result the checker has already narrowed -- through an
        // assertion, or a guard -- unerases here rather than staying erased for
        // the rest of the function.
        if helper == "nts_map_get" {
            return self.narrowed(id, call);
        }
        Ok(call)
    }

    /// A method call on an object, once the receiver is lowered.
    ///
    /// Two questions, and they are different. Which class *declares* the method
    /// is not always the receiver's -- `new Square(n).describe()` calls
    /// `Shape#describe` when only `Shape` declares one. And whether the call is
    /// static is decided by whether anything *below* the receiver's type
    /// overrides it, which the compiler can answer because TypeScript closes the
    /// hierarchy.
    ///
    /// So a call on a `Square` is static even where the same method on a `Shape`
    /// dispatches: nothing below `Square` overrides anything.
    /// `xs.fill(v)` where the elements are not numbers.
    ///
    /// A boolean is a byte and a reference is a pointer, so each has its own
    /// entry point rather than one taking a width -- the compiler knows the
    /// element type, and a runtime that had to be told it would be told it
    /// wrongly one day. The reference one counts what it stores.
    pub(super) fn lower_wide_fill(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        element: &HirType,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let helper = match element {
            HirType::Bool => "nts_array_fill_bool",
            counted if holds_counted(counted) => counted_helper(counted, Counts::Fill),
            _ => return Err(self.unsupported(id, "a `fill` on an array of this element type")),
        };
        let [value] = arguments else {
            return Err(self.unsupported(id, "a `fill` with a range on this array"));
        };
        let value = self.lower_expecting(*value, element)?;
        // **The helper above is chosen from `element`, so the argument is at
        // `element`.** Otherwise the two are two derivations of one fact and only
        // one of them reaches the C prototype.
        //
        // `nts_array_fill_ref` takes a `void *`. `benchmarks/cases/awfy-towers`
        // writes `new Array(3).fill(null)` into a `(TowersDisk | null)[]`, and
        // `lower_absent` prefers the *contextual* type over the expectation this
        // function states -- here `fill`'s parameter on `new Array(3)`, which
        // TypeScript types `any[]`. While `any` had no representation that
        // answered nothing and the expectation won: `(NtsObj_TowersDisk *)0`.
        // Once `any` erased (093733f2d) it answered `Erased`, the `null` became
        // `nts_value_of_null()`, and a sixteen-byte value reached a pointer
        // parameter. **Nothing refused it** -- the HIR is valid and clang is a
        // stage away -- so `benches` was red for five weeks.
        //
        // # Why here rather than in what `lower_absent` prefers
        //
        // That was tried: prefer a concrete expectation over an erased contextual
        // type. Measured on the recorded test262 sets, it **loses three passes**,
        // and it is too broad in two directions at once:
        //
        //   * `var x; x = null ?? undefined ?? 42` and `new Set().add(undefined)`
        //     (`Set<any>` in JavaScript) *want* the erased answer -- a concrete
        //     slot cannot hold `undefined`, and both refuse;
        //   * `"gnulluna".slice(null, -3)` wants `ToNumber(null)` at a numeric
        //     parameter, not a C null of the wrong type -- and it emitted
        //     **uncompilable C**, which is the class this commit exists to fix.
        //
        // So the authority is local rather than general. This function knows the
        // element because it picked the helper from it, and nothing outside it has
        // to change.
        let value = if self.values[value.0 as usize].ty == *element {
            value
        } else {
            let element = element.clone();
            self.coerce(value, &element, id)?
        };
        let origin = self.origin(id);
        let ty = HirType::Managed(ManagedType::Array(Box::new(element.clone())));
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args: vec![receiver, value],
                frame: None,
            },
            ty,
            origin,
        ))
    }
}
