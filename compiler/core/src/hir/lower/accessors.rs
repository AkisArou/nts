//! Select and invoke get/set methods, including delegated, static, and super accessors.

use super::{
    Callee, Diagnostic, FuncBuilder, HirType, ManagedType, MemberKey, MethodAccessor, NodeId,
    OpKind, Origin, Place, PropertyKey, RAISING_SUFFIX, TypeId, TypeKind, ValueId,
    access_family_functions, calls_in_a_default, is_static_member_symbol, short, syntax,
    via_callee,
};

impl FuncBuilder<'_> {
    /// The emitted name of the class this identifier names, where it is
    /// qualified.
    ///
    /// Reads the same map [`Self::class_name_for`] reads, keyed by the same
    /// node, so a call site and a definition cannot disagree about a name.
    /// `A.base` where `base` is a `static get`.
    ///
    /// **The function already exists.** `func A.get base()` is lowered like any
    /// other static member, and `dce` drops it because nothing calls it: a
    /// static accessor is *read* as a property access, so it took the
    /// static-field path and was refused as ``base`, a static field this
    /// compiler gave no storage`` -- a sentence about storage, for a member
    /// that is code. Only the call was missing.
    ///
    /// Named through [`Self::qualified_class_name`] first, exactly as a
    /// constructor call is, so a class name declared in more than one file
    /// resolves to the same `Frame@a` the definition was emitted under.
    pub(super) fn static_accessor_read(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let symbol = self.node(member).symbol?;
        let declaration = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|at| self.kind_of(*at) == Some(syntax::GET_ACCESSOR))?;
        let owner = self
            .qualified_class_name(object)
            .or_else(|| self.declaring_class_name(declaration))?;
        let name = MemberKey::get(self.property_key(member)?).emitted_name();
        let Some(ty) = self.type_of(id) else {
            return Some(Err(self.unrepresentable(id, "a static accessor")));
        };
        let origin = self.origin(id);
        Some(Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{owner}.{name}")),
                args: Vec::new(),
                frame: None,
            },
            ty,
            origin,
        )))
    }

    /// The property signatures a binding declares for the member at `member`
    /// with an `@ntsGet` or `@ntsSet`: a property of a handle, reached through
    /// methods rather than stored.
    fn accessor_declarations(&self, member: NodeId) -> Vec<&nts_semantic_schema::NativeAttributes> {
        self.accessor_nodes(member)
            .into_iter()
            .filter_map(|decl| self.node(decl).native.as_deref())
            .filter(|native| native.get.is_some() || native.set.is_some())
            .collect()
    }

    /// The node a declaration's tags are on: a variable's statement, whose
    /// comment its `JSDoc` is (`let ticks: T;` under `@ntsGet …`), and any
    /// other declaration itself.
    pub(super) fn tagged_statement(&self, decl: NodeId) -> NodeId {
        if self.kind_of(decl) != Some(syntax::VARIABLE_DECLARATION) {
            return decl;
        }
        let mut at = self.node(decl).parent;
        while let Some(node) = at {
            if self.kind_of(node) == Some(syntax::VARIABLE_STATEMENT) {
                return node;
            }
            at = self.node(node).parent;
        }
        decl
    }

    /// The property declarations a member names, through its symbol: a
    /// property signature or accessor, or a namespace's variable (a class's
    /// static property), as the node its tags are on.
    ///
    /// A member of an instantiation (`list.size` on an `IVector<IInspectable>`)
    /// once arrived with no declarations -- its symbol first interned from
    /// the program's file, before the binding's was decoded -- and was read
    /// through the receiver type's property records instead. The frontend
    /// now remembers that declaration (f8628b64), so the symbol is the one
    /// route.
    pub(super) fn accessor_nodes(&self, member: NodeId) -> Vec<NodeId> {
        let accessor = |decl: &NodeId| {
            matches!(
                self.kind_of(*decl),
                Some(
                    syntax::PROPERTY_SIGNATURE
                        | syntax::GET_ACCESSOR
                        | syntax::SET_ACCESSOR
                        | syntax::VARIABLE_DECLARATION
                )
            )
        };
        self.node(member)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map(|record| {
                record
                    .declarations
                    .iter()
                    .copied()
                    .filter(accessor)
                    .map(|decl| self.tagged_statement(decl))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// A read of a binding's property: `None` for any other member.
    pub(super) fn accessor_read(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if let Some((bound, method)) = self.delegated_accessor(object, member, false) {
            return Some(
                self.lower_expression(object).and_then(|receiver| {
                    self.lower_accessor_on(id, receiver, bound, &method, None)
                }),
            );
        }
        if let Some((bound, name)) = self.delegated_named(object, member) {
            return Some(self.lower_expression(object).and_then(|receiver| {
                let key = self.push(
                    OpKind::ConstString(name.into()),
                    HirType::Managed(ManagedType::String),
                    self.origin(member),
                );
                self.call_bound_method(id, receiver, bound, "_named_get", vec![key])
            }));
        }
        if !self.is_accessor_property(member) {
            return None;
        }
        Some(match self.accessor(member, false) {
            Some(method) => self.lower_accessor(id, object, member, &method, None),
            None => Err(self.unsupported(
                id,
                "a read of a native property no @ntsGet names a method for",
            )),
        })
    }

    /// A property of a type a binding implements, read or written through the
    /// accessor its bound property's `@ntsGet` or `@ntsSet` names: lib.dom's
    /// `div.childElementCount` is `nts:dom`'s `_get_childElementCount`. The
    /// bound type and the accessor's name; [`Self::delegated_method`] for a
    /// method.
    pub(super) fn delegated_accessor(
        &self,
        object: NodeId,
        member: NodeId,
        write: bool,
    ) -> Option<(TypeId, String)> {
        let bound = self.delegated_type(*self.snapshot.node_types.get(&object)?)?;
        let name = self.literal_name(member)?;
        let property = crate::hir::native::schema::property(self.snapshot, bound, &name)?;
        let native = self.node(property.declaration?).native.as_deref()?;
        let method = if write {
            native.set.clone()
        } else {
            native.get.clone()
        }?;
        Some((bound, method))
    }

    /// A name a type a binding implements reads through its named-property
    /// methods: `el.dataset.userId` is `DOMStringMap`'s `_named_get("userId")`
    /// and its write `_named_set`, where lib.dom declares an index signature
    /// and the bound type declares no property of that name. The bound type
    /// and the name.
    pub(super) fn delegated_named(
        &self,
        object: NodeId,
        member: NodeId,
    ) -> Option<(TypeId, String)> {
        let bound = self.delegated_type(*self.snapshot.node_types.get(&object)?)?;
        let name = self.literal_name(member)?;
        if crate::hir::native::schema::property(self.snapshot, bound, &name).is_some() {
            return None;
        }
        crate::hir::native::schema::property(self.snapshot, bound, "_named_get")?;
        Some((bound, name))
    }

    /// The setter of a bound property a binding spells per type of the value
    /// written -- `_set_hidden_boolean` for `el.hidden = true`, and for
    /// `el.onclick = f` `_set_onclick_void` or `_boolean` by `f`'s result,
    /// `_set_onclick_null` for `null` -- where the bound type's `@ntsSet`
    /// does not take it, or it has none. A value of a bound interface takes
    /// the setter whose parameter it fits: `ctx.fillStyle = gradient` is
    /// `_set_fillStyle_gradient`. The bound type, the method, and whether it
    /// takes the value.
    pub(super) fn delegated_typed_setter(
        &self,
        object: NodeId,
        member: NodeId,
        value: NodeId,
    ) -> Option<(TypeId, String, bool)> {
        let bound = self.delegated_type(*self.snapshot.node_types.get(&object)?)?;
        let name = self.literal_name(member)?;
        let assigned = *self.snapshot.node_types.get(&value)?;
        if crate::hir::native::pointer(self.snapshot, assigned).is_some() {
            let prefix = format!("_set_{name}_");
            let method = crate::hir::native::schema::properties(self.snapshot, bound)
                .into_iter()
                .filter(|property| {
                    property
                        .name
                        .public_name()
                        .is_some_and(|name| name.starts_with(&prefix))
                })
                .find(|property| self.method_takes(property, value))?;
            return Some((bound, method.name.public_name()?.to_owned(), true));
        }
        let kind = match &self.snapshot.types.get(assigned.0 as usize)?.kind {
            TypeKind::Null => "null",
            TypeKind::Boolean
            | TypeKind::Literal(nts_semantic_schema::LiteralValue::Boolean(_)) => "boolean",
            TypeKind::Number | TypeKind::Literal(nts_semantic_schema::LiteralValue::Number(_)) => {
                "number"
            }
            TypeKind::String
            | TypeKind::Literal(nts_semantic_schema::LiteralValue::String(_))
            | TypeKind::TemplateLiteral { .. } => "string",
            TypeKind::Function(signature) => {
                let result = self
                    .snapshot
                    .signatures
                    .get(signature.0 as usize)?
                    .return_type;
                match self.snapshot.types.get(result.0 as usize)?.kind {
                    TypeKind::Void | TypeKind::Undefined => "void",
                    TypeKind::Boolean => "boolean",
                    #[expect(
                        clippy::match_same_arms,
                        reason = "keep audited semantic type variants explicit"
                    )]
                    TypeKind::NonPrimitive | TypeKind::UniqueSymbol => return None,
                    _ => return None,
                }
            }
            _ => return None,
        };
        let method = format!("_set_{name}_{kind}");
        crate::hir::native::schema::property(self.snapshot, bound, &method)?;
        Some((bound, method, kind != "null"))
    }

    /// Whether a bound method -- a setter -- takes `value` as its one
    /// argument, by [`Self::arguments_fit`].
    pub(super) fn method_takes(
        &self,
        method: &nts_semantic_schema::PropertyRecord,
        value: NodeId,
    ) -> bool {
        let Some(TypeKind::Function(signature)) = self
            .snapshot
            .types
            .get(method.ty.0 as usize)
            .map(|record| &record.kind)
        else {
            return false;
        };
        self.snapshot
            .signatures
            .get(signature.0 as usize)
            .is_some_and(|record| self.arguments_fit(record, None, &[value]))
    }

    pub(super) fn is_accessor_property(&self, member: NodeId) -> bool {
        !self.accessor_declarations(member).is_empty()
    }

    /// The method a property is read (`write` false) or written through.
    pub(super) fn accessor(&self, member: NodeId, write: bool) -> Option<String> {
        self.accessor_declarations(member)
            .into_iter()
            .find_map(|native| {
                if write {
                    native.set.clone()
                } else {
                    native.get.clone()
                }
            })
    }

    /// `handle.name`, or `handle.name = value`: a call to `method`, a method
    /// the handle's type declares, with the handle as its instance -- the
    /// same call `handle.method(value)` is, through the same roles.
    ///
    /// A tag of two words names a slot instead, `@ntsGet 6 get_Content`: a
    /// Windows Runtime property, called through the slot without a method
    /// declared for it (`lower_slot_accessor`).
    pub(super) fn lower_accessor(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
        method: &str,
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .snapshot
            .node_types
            .get(&object)
            .copied()
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    &format!("a native property whose accessor `{method}` has no receiver type"),
                )
            })?;
        if let [slot, name] = method.split_whitespace().collect::<Vec<_>>()[..] {
            let slot: u32 = slot.parse().map_err(|_| {
                self.unsupported(id, "@ntsGet or @ntsSet naming a slot that is not a number")
            })?;
            // A static property: its class's factory is the receiver, and the
            // namespace written before it is no value.
            if self
                .accessor_nodes(member)
                .iter()
                .any(|decl| self.kind_of(*decl) == Some(syntax::VARIABLE_STATEMENT))
            {
                return self.lower_static_accessor(id, member, (slot, name), value);
            }
            let receiver = self.lower_expression(object)?;
            return self.lower_slot_accessor(id, member, receiver, ty, (slot, name), value);
        }
        let receiver = self.lower_expression(object)?;
        self.lower_accessor_on(id, receiver, ty, method, value)
    }

    /// `ApplicationLanguages.languages`, and an assignment to a writable one:
    /// a Windows Runtime class's static property, a variable of its namespace
    /// (`@ntsGet 8 get_Languages`, `@ntsFactory …`), called through the slot
    /// of its class's statics factory as a static method is.
    fn lower_static_accessor(
        &mut self,
        id: NodeId,
        member: NodeId,
        (slot, name): (u32, &str),
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let write = value.is_some();
        let declaration = self
            .accessor_nodes(member)
            .into_iter()
            .find(|decl| {
                self.node(*decl).native.as_deref().is_some_and(|n| {
                    if write {
                        n.set.is_some()
                    } else {
                        n.get.is_some()
                    }
                })
            })
            .ok_or_else(|| {
                self.unsupported(id, "a Windows Runtime static property with no declaration")
            })?;
        // The property's type, which its name is typed as where it is read
        // and where it is written.
        let ty = self
            .snapshot
            .node_types
            .get(&member)
            .copied()
            .ok_or_else(|| {
                self.unsupported(id, "a Windows Runtime static property with no type")
            })?;
        let (parameters, return_type) = match value {
            Some(_) => (
                vec![nts_semantic_schema::ParameterRecord {
                    name: "value".to_owned(),
                    ty,
                    optional: false,
                    rest: false,
                }],
                self.void_type()?,
            ),
            None => (Vec::new(), ty),
        };
        let signature = nts_semantic_schema::SignatureRecord {
            parameters,
            return_type,
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        self.forced_slot = Some((slot, name.to_owned()));
        let callee = self.native_callee(id, Some(declaration), name.to_owned(), &signature);
        self.forced_slot = None;
        let callee = callee?;
        let Callee::Native(target) = &callee else {
            return Err(self.unsupported(
                id,
                "a Windows Runtime static property whose slot is not a native call",
            ));
        };
        let target = target.clone();
        let args = match value {
            // After the factory, which is the receiver.
            Some(value) => match target.parameters.get(1) {
                Some(parameter) => vec![self.coerce(value, &parameter.representation(), id)?],
                None => vec![value],
            },
            None => Vec::new(),
        };
        // Called on the class's factory, as a static method is.
        let receiver = target
            .vtable
            .as_ref()
            .and_then(|vtable| vtable.factory.clone())
            .map(|factory| self.factory_receiver(&factory, id));
        let count = args.len();
        let (args, lent) = self.native_arguments(id, &target, args, count, receiver)?;
        self.finish_call_typed(id, callee, args, lent, Some(declaration), None)
    }

    /// `button.content` and `button.content = value` for a Windows Runtime
    /// property: its getter or setter slot called on the receiver -- asked for
    /// the property's interface first where it is `@ntsVia` another -- with
    /// the signature the property's type gives it, `(): T` or `(value: T):
    /// void`, and its HRESULT checked, as a method call through a slot is.
    pub(super) fn lower_slot_accessor(
        &mut self,
        id: NodeId,
        member: NodeId,
        receiver: ValueId,
        this: TypeId,
        (slot, name): (u32, &str),
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        // The declaration carrying this direction's tag: one property
        // signature for both, or a `get`/`set` pair, each its own.
        let write = value.is_some();
        let declaration = self
            .accessor_nodes(member)
            .into_iter()
            .find(|decl| {
                self.node(*decl).native.as_deref().is_some_and(|n| {
                    if write {
                        n.set.is_some()
                    } else {
                        n.get.is_some()
                    }
                })
            })
            .ok_or_else(|| {
                self.unsupported(id, "a Windows Runtime property with no declaration")
            })?;
        // Its value's type: the property's, the getter's result, or the
        // setter's parameter.
        let ty = match self.kind_of(declaration) {
            Some(syntax::PROPERTY_SIGNATURE) => self.snapshot.node_types.get(&declaration).copied(),
            // A setter's value is its parameter's declared type.
            Some(syntax::SET_ACCESSOR) => self
                .children(declaration)
                .into_iter()
                .find(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
                .and_then(|parameter| self.name_node(parameter))
                .and_then(|name| self.snapshot.node_types.get(&name).copied()),
            // A getter's is what the read is typed, which is its result.
            _ => self.snapshot.node_types.get(&id).copied(),
        }
        .ok_or_else(|| self.unsupported(id, "a Windows Runtime property with no type"))?;
        let (parameters, return_type) = match value {
            Some(_) => (
                vec![nts_semantic_schema::ParameterRecord {
                    name: "value".to_owned(),
                    ty,
                    optional: false,
                    rest: false,
                }],
                self.void_type()?,
            ),
            None => (Vec::new(), ty),
        };
        let this = self.class_behind(this);
        let mut with_this = nts_semantic_schema::SignatureRecord {
            parameters,
            return_type,
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: Some(this),
        };
        with_this.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: this,
                optional: false,
                rest: false,
            },
        );
        self.forced_slot = Some((slot, name.to_owned()));
        let callee = self.native_callee(id, Some(declaration), name.to_owned(), &with_this);
        self.forced_slot = None;
        let callee = callee?;
        let Callee::Native(target) = &callee else {
            return Err(self.unsupported(
                id,
                "a Windows Runtime property whose slot is not a native call",
            ));
        };
        let args: Vec<ValueId> = match value {
            Some(value) => {
                let value = match target.roles.get(1) {
                    Some(crate::hir::native::Role::Plain) => {
                        self.coerce(value, &target.parameters[1].representation(), id)?
                    }
                    _ => value,
                };
                vec![value]
            }
            None => Vec::new(),
        };
        let written = args.len();
        let (receiver, queried) = self.via_receiver(id, declaration, receiver)?;
        let callee = via_callee(callee, queried.is_some());
        let Callee::Native(target) = &callee else {
            unreachable!("a native callee stays native")
        };
        let (args, lent) =
            self.native_arguments(id, &target.clone(), args, written, Some(receiver))?;
        let answer = self.finish_call(id, callee, args, lent, Some(declaration))?;
        self.release_via(id, queried);
        Ok(answer)
    }

    /// [`Self::lower_accessor`] on a receiver already lowered: the handle
    /// `new` just made, whose properties the literal writes. Evaluated once
    /// by construction -- there is no expression here to lower again.
    pub(super) fn lower_accessor_on(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        ty: TypeId,
        method: &str,
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        self.call_bound_method(id, receiver, ty, method, value.into_iter().collect())
    }

    /// A method of a handle's type called on `receiver` with values already in
    /// hand: an accessor's (`@ntsGet`/`@ntsSet`), or a binding's syntax method
    /// -- `_named_get(name)` for `el.dataset.name` -- whose arguments the program
    /// never wrote as arguments.
    pub(super) fn call_bound_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        ty: TypeId,
        method: &str,
        values: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let unknown = || {
            format!(
                "a native property whose accessor `{method}` the handle's type does not declare as a method"
            )
        };
        // `this.label` in a method of a class the program writes over a
        // handle's: `this` is the class's polymorphic `this`, and its members
        // are the class's.
        let ty = self.class_behind(ty);
        let record = crate::hir::native::schema::property(self.snapshot, ty, method)
            .ok_or_else(|| self.unsupported(id, &unknown()))?;
        let declaration = record
            .declaration
            .ok_or_else(|| self.unsupported(id, &unknown()))?;
        let Some(TypeKind::Function(signature)) = self
            .snapshot
            .types
            .get(record.ty.0 as usize)
            .map(|t| &t.kind)
        else {
            return Err(self.unsupported(id, &unknown()));
        };
        let mut with_this = self.snapshot.signatures[signature.0 as usize].clone();
        let this = with_this.this_type.ok_or_else(|| {
            self.unsupported(id, "a native property accessor with no `this` type")
        })?;
        with_this.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: this,
                optional: false,
                rest: false,
            },
        );
        let callee = self.native_callee(id, Some(declaration), method.to_owned(), &with_this)?;
        let Callee::Native(target) = &callee else {
            return Err(self.unsupported(id, &unknown()));
        };
        // A plain C slot takes its value at its own representation; a
        // string, an array or a closure is converted by its role.
        let mut args = Vec::with_capacity(values.len());
        for (at, value) in values.into_iter().enumerate() {
            args.push(match target.roles.get(at + 1) {
                Some(crate::hir::native::Role::Plain) => {
                    self.coerce(value, &target.parameters[at + 1].representation(), id)?
                }
                _ => value,
            });
        }
        let written = args.len();
        let (args, lent) =
            self.native_arguments(id, &target.clone(), args, written, Some(receiver))?;
        // **A read of a sequence the program types as an array** --
        // `entry.contentBoxSize`, a `FrozenArray` lib.dom spells
        // `ReadonlyArray<ResizeObserverSize>` and nts:dom answers as
        // `ResizeObserverSizeSequence` -- is the sequence copied into a new
        // array, as a method's result is (`array_of_sequence`). Typed as the
        // property alone, the call's handle reached the program as the
        // array, and C cast it: its length was read from the Blink object
        // and it was indexed (the Chromium lane's
        // lib-dom-a-sequence-attribute-read-as-its-array). A fresh copy per
        // read is exact but for `===` between two reads, which a frozen
        // array answers true.
        if written == 0
            && let Some(sequence) = self.sequence_for_array(id, with_this.return_type)
        {
            let array = self
                .type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "an array made of a sequence"))?;
            let handle = target.result.representation();
            let call =
                self.finish_call_typed(id, callee, args, lent, Some(declaration), Some(handle))?;
            return self.array_of_sequence(id, call, sequence, array);
        }
        // **A read is typed as the getter declares its result, then as the
        // property.** The node read is the property (`el.onclick`), and the
        // getter (`_get_onclick`) spells the same type separately: two ids for
        // one signature, which `canonicalize_objects` makes one only where a
        // value mentions both. Typed as the property alone, the getter's id
        // appeared nowhere but in its callee, and the call's result disagreed
        // with it -- invalid HIR, nothing emitted (the Chromium lane's
        // a-closure-typed-property-read) -- where `el._get_onclick()`, whose
        // node *is* the call, compiled.
        let declared = target.result.representation();
        if written == 0 && matches!(declared, HirType::Managed(ManagedType::Object(_))) {
            match self.type_of(id) {
                Some(read) if declared != read => {
                    let call = self.finish_call_typed(
                        id,
                        callee,
                        args,
                        lent,
                        Some(declaration),
                        Some(declared),
                    )?;
                    return self.coerce(call, &read, id);
                }
                // **And a read the checker narrowed to `null`**, which has no
                // representation: after `el.onclick = null`, `el.onclick` is
                // typed `null`, and the call's result was refused as "of
                // unrepresentable type (null)". The narrowing says what the
                // getter's object holds, not what it is, so the read is the
                // getter's (the Chromium lane's lib-dom-a-read-narrowed-to-null).
                None => {
                    return self.finish_call_typed(
                        id,
                        callee,
                        args,
                        lent,
                        Some(declaration),
                        Some(declared),
                    );
                }
                Some(_) => {}
            }
        }
        self.finish_call(id, callee, args, lent, Some(declaration))
    }

    /// Why a `void` result cannot be a setter's argument: the parameter's
    /// type, and -- where nothing wrote it -- that its getter supplied it.
    pub(super) fn void_where_a_setter_wants(&self, access: NodeId, has_getter: bool) -> String {
        let parameter = self.setter_parameter(access);
        // A primitive by its keyword, an object type by its name or shape.
        let named = parameter
            .and_then(|parameter| self.children(parameter).into_iter().next())
            .and_then(|name| self.snapshot.node_types.get(&name).copied())
            .map(
                |ty| match self.snapshot.types.get(ty.0 as usize).map(|t| &t.kind) {
                    Some(TypeKind::Object { .. } | TypeKind::Structured) => {
                        self.type_in_a_message(ty)
                    }
                    _ => format!("`{}`", short(self.snapshot, ty)),
                },
            );
        match (parameter, named) {
            (Some(parameter), Some(named)) if has_getter && !self.annotated(parameter) => format!(
                "nothing (`void`) where the setter's parameter, inferred {named} from its \
                 getter, is wanted"
            ),
            (_, Some(named)) => {
                format!("nothing (`void`) where the setter's parameter, {named}, is wanted")
            }
            _ => "nothing (`void`) where the setter's parameter is wanted".to_owned(),
        }
    }

    /// The parameter of the `set` accessor an access reaches, found through
    /// the member's symbol.
    fn setter_parameter(&self, access: NodeId) -> Option<NodeId> {
        let member = self.children(access).into_iter().last()?;
        let symbol = self.node(member).symbol?;
        let declaration = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|at| self.kind_of(*at) == Some(syntax::SET_ACCESSOR))?;
        self.children(declaration)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
    }

    /// The call an accessor of `member` on `ty` is emitted as.
    ///
    /// `Owner#get x`, where the owner is the class that *declares* it — which
    /// may be a base, exactly as for a method. `None` where the type has no
    /// such accessor, which is the ordinary case and means the caller should go
    /// on to say the property does not exist.
    ///
    /// # Dispatched, by the same rule a method is
    ///
    /// This returned a name, and the two call sites wrapped it in
    /// `Callee::Direct`. So an **overridden** accessor was not dispatched:
    ///
    /// ```ts
    /// class Base   { get plain(): number { return 1; } }
    /// class Narrow extends Base { override get plain(): number { return 2; } }
    /// const b: Base = new Narrow();
    /// b.plain      // nts: 1     node: 2
    /// ```
    ///
    /// A silent wrong answer, on both spellings — `get plain` and
    /// `get ["plain"]` — and on setters the same way. The hierarchy had the
    /// slot all along: `declared_methods` records an accessor under `get x`
    /// exactly so that it can be overridden, and the slot was allocated and
    /// never read. Nothing in the corpus overrode one, so nothing said so.
    ///
    /// The decision is `resolve_method`'s, letter for letter, and it is written
    /// once here rather than at each of the two sites for the reason the
    /// hierarchy's own comment gives about the base: two places that must agree
    /// is how this goes wrong.
    /// Push a call to an accessor, and **test for a raise after it**.
    ///
    /// One helper rather than a `test_for_a_raise` at each of the six places that emit
    /// an accessor call, because the count is the argument: the method work needed
    /// telling at three push sites and found the third only when 29 of 29 cases answered
    /// a copy's dummy zero. A getter read and a setter write are reached from a read, a
    /// write, a compound assignment, a spread, a destructuring and an object-literal
    /// column, and none of them goes through `push_call`.
    ///
    /// `test_for_a_raise` is a no-op unless this site names a raising copy, so every
    /// caller may use it unconditionally -- which is the point of there being one.
    pub(super) fn push_an_accessor_call(
        &mut self,
        site: NodeId,
        callee: Callee,
        args: Vec<ValueId>,
        ty: HirType,
        origin: Origin,
    ) -> ValueId {
        let answer = self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        );
        self.test_for_a_raise(site);
        answer
    }

    /// **`Result<Option<_>>` because this is the one place that knows direct from
    /// virtual**, and a virtual accessor inside a `try` has to refuse rather than be
    /// answered with the plain entry. `None` still means "this member is not an
    /// accessor", which every caller reads as "try the next shape"; an `Err` is a
    /// refusal about a site that *is* one. Collapsing the two would make a refusal look
    /// like an absent member, which is the sentence `absent_member` gives and is about
    /// a field.
    pub(super) fn accessor_callee(
        &mut self,
        id: NodeId,
        ty: TypeId,
        member: &PropertyKey,
        accessor: MethodAccessor,
    ) -> Result<Option<Callee>, Diagnostic> {
        let writes = accessor == MethodAccessor::Set;
        let kind = if writes { "set" } else { "get" };
        if let Some(family) = self.hierarchy.access_families.get(ty, member) {
            if writes && family.writes.is_none() {
                return Ok(None);
            }
            let raising = !self.raising_suffix_of(id).is_empty();
            if raising
                && !self
                    .hierarchy
                    .slots
                    .contains_key(&(ty, family.key(writes), true))
            {
                return Err(self.unsupported(
                    id,
                    "an interface field accessor without a complete raising family",
                ));
            }
            let entry = access_family_functions::entry(self.hierarchy, family, writes, raising);
            return Ok(Some(Callee::Virtual {
                slot: entry.slot,
                declared: entry.declared,
            }));
        }
        let key = MemberKey {
            key: member.clone(),
            accessor,
        };
        let Some(declaring) = self.hierarchy.declaring(ty, &key) else {
            return Ok(None);
        };
        // **The layout's name where the hierarchy has none**, which is what
        // `callee_for` has always done for a method. Only a *declared* type gets
        // a `hierarchy.name`, so an object literal's accessor resolved its
        // declaring type and then returned `None` here -- and the refusal named
        // the member as having no representation, which is a sentence about a
        // field for something that is not one.
        let owner = match self.hierarchy.name.get(&declaring) {
            Some(name) => name.clone(),
            None => match self.layout_of(id, declaring) {
                Ok(layout) => layout.name,
                Err(_) => return Ok(None),
            },
        };
        let name = format!("{owner}#{}", key.emitted_name());
        // **An accessor's raising copy is reached by naming it**, exactly as a method's
        // is: a member no subclass overrides is already a `Callee::Direct` here, and the
        // copy is that name with the suffix. The 705 occurrences of "an accessor, which
        // is a call" are what this is for.
        //
        // The suffix rather than a second decision about which kind this site runs:
        // `has_a_raising_copy` requires *every* accessor the member declares to have a
        // copy, so a read and a write cannot disagree about whether the name carries it.
        //
        // **And where the dispatch is virtual the copy has a slot of its own**, which
        // this refused for want of: naming the plain entry instead would run a body that
        // ends the program on an uncaught `throw` while the flag test the site emitted
        // watched a flag nothing sets. The same answer `callee_for` gives one construct
        // over, in the one place that knows direct from virtual.
        let suffix = self.raising_suffix_of(id);
        if self.hierarchy.overridden(ty, &key)
            && let Some(slot) = self.hierarchy.slot_for(ty, &key, false)
        {
            // The same answer `callee_for` gives a method one construct over: the
            // raising copy of an overridden accessor has a slot of its own.
            if !suffix.is_empty() {
                let Some(slot) = self.hierarchy.slot_for(ty, &key, true) else {
                    let why = self.why_the_raising_slot_is_missing(ty, &key);
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "a `{kind}` of `{member}` inside a `try`, which a subclass \
                             overrides: {why}",
                            kind = kind.trim()
                        ),
                    ));
                };
                return Ok(Some(Callee::Virtual {
                    slot,
                    declared: format!("{name}{RAISING_SUFFIX}"),
                }));
            }
            return Ok(Some(Callee::Virtual {
                slot,
                declared: name,
            }));
        }
        Ok(Some(Callee::Direct(format!("{name}{suffix}"))))
    }

    /// **A constructor's parameter default cannot read `this`, because the instance
    /// is not built yet.**
    ///
    /// The receiver bound at the call is the right object -- `new A()` allocates it
    /// first -- and its *fields* are written by the constructor, which has not run:
    ///
    /// ```text
    /// class A { #x = "hello"; constructor(o = this.#x) { … } }
    ///
    /// %1 = object.new heap
    /// %2 = field.get %1.0        <- #x, before it is written
    /// %3 = call A#constructor(%1, %2)
    /// ```
    ///
    /// So the default read an uninitialised slot and the string it answered was a
    /// garbage pointer: **SIGSEGV**, with no diagnostic. The language runs
    /// `InitializeInstanceElements` before the body, so node answers `"hello"` -- and
    /// a **public** field crashes identically, which is what says this is about
    /// *order* rather than about privacy.
    ///
    /// Refused rather than reordered, because there is nowhere at the call site to
    /// put it: the field initialisers are inside the constructor and the parameter
    /// has to be passed *to* it. The fix is the callee evaluating its own default --
    /// an absence test after `initialize_fields` -- which is the same mechanism
    /// `outcomes/an-explicit-undefined-at-a-defaulted-parameter` is waiting for, and
    /// it moves where every default in the corpus is evaluated.
    ///
    /// A **method**'s default reading `this` is untouched and must stay so:
    /// `slice(start = 0, end = this.length)` is `Buffer.prototype.toString`'s shape,
    /// the receiver is fully built by then, and refusing it cost real reach once
    /// before -- the paragraph beside this call site records that.
    /// The calls a parameter default makes, handed the **raising context of the call
    /// that evaluates it** -- the nodes added, for the caller to take back.
    ///
    /// A default is evaluated *here*, in the caller, which is where JavaScript
    /// evaluates one: so a `throw` in it reaches the caller's handler, and the calls
    /// in it have to name raising copies and be tested after.
    ///
    /// They were not, and it was a **wrong answer rather than a refusal**:
    /// `call_within` walks the `try`'s own body, and a default lives in the *callee's*
    /// declaration, where no such walk reaches it. So `try { f() } catch` over
    /// `function f(x = thrower()) {}` emitted a plain `thrower()` whose uncaught
    /// `throw` ended the program where node catches -- 17 of 17 cases, on a program
    /// nothing refused. It is `ac1533ca4`'s; `eb92ee8f9` made it reachable for a
    /// method and a static, which is how the conformance lane found it
    /// (`outcomes/a-throwing-default-of-a-method-called-in-a-function-value`).
    ///
    /// **Inserted into `raising_calls` rather than answered by a second flag**,
    /// because that set is what `raising_suffix_of`, `dispatches_to_a_raising_entry`
    /// and `tested_for_a_raise` all read -- one fact, three readers, and a flag beside
    /// it would be a second spelling of "this call is handled". Taken back after, for
    /// the reason the bindings are: the same default node is lowered again at the next
    /// call that omits the argument, and there the `try` may be a different one or
    /// none.
    ///
    /// `self.raises` needs no arm: inside a raising body `raising_suffix_of` already
    /// answers for every call the body holds.
    pub(super) fn a_default_inherits_the_handler(
        &mut self,
        call: NodeId,
        default: NodeId,
    ) -> Vec<NodeId> {
        if !self.raising_calls.contains(&call) {
            return Vec::new();
        }
        let inner = calls_in_a_default(self, default);
        let mut added = Vec::new();
        for call in inner {
            if self.raising_calls.insert(call) {
                added.push(call);
            }
        }
        added
    }

    pub(super) fn a_default_the_instance_cannot_answer(
        &mut self,
        node: NodeId,
        callee: NodeId,
    ) -> Result<(), Diagnostic> {
        if self.kind_of(callee) == Some(syntax::CONSTRUCTOR) && self.reads_this(node) {
            return Err(self.unsupported(
                node,
                "a constructor's parameter default that reads `this`, whose fields the \
                 constructor has not yet written",
            ));
        }
        Ok(())
    }

    /// `super.x` read, where `x` is a getter on the base.
    ///
    /// `None` for anything else, which leaves `super.m()` on the call path it
    /// already had.
    pub(super) fn super_getter_read(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(object) != Some(syntax::SUPER_KEYWORD) {
            return None;
        }
        let (receiver, callee) =
            self.super_accessor(&MemberKey::get(self.property_key(member)?))?;
        Some((|| {
            let ty = self
                .type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "a `super` getter"))?;
            let origin = self.origin(id);
            Ok(self.push(
                OpKind::Call {
                    callee,
                    args: vec![receiver],
                    frame: None,
                },
                ty,
                origin,
            ))
        })())
    }

    /// `super.x = v`, where `x` is a setter on the base.
    ///
    /// The getter comes from the same walk, because a compound assignment --
    /// `super.x += 1` -- reads before it writes and both halves have to name
    /// the same class.
    /// `A.base = v` where `base` is a `static set`.
    ///
    /// The write half of [`Self::static_accessor_read`], and it reached the same
    /// wrong sentence from the other side: with no storage to write, the place
    /// fell through to lowering the *receiver*, and `A` is a class, so the
    /// program was refused as ``A`, a class used as a value``. Neither message
    /// was about what the program wrote.
    ///
    /// The getter is looked up beside it because a compound assignment needs
    /// both -- `A.base += n` reads and then writes -- and `None` where the class
    /// declares only a setter, which is legal and means `+=` is not.
    pub(super) fn static_accessor_place(
        &mut self,
        object: NodeId,
        member: NodeId,
    ) -> Option<Place> {
        let symbol = self.node(member).symbol?;
        // **`static`, and asked about the symbol before anything else.** Without
        // this the walk below finds any `set`, so an *instance* setter took the
        // static path and was emitted as a direct call to `Class.set value` --
        // which is not what an overridden accessor means, and
        // `an_overridden_accessor_is_dispatched` is the test that says so.
        if !is_static_member_symbol(self.snapshot, symbol) {
            return None;
        }
        let declaration = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|at| self.kind_of(*at) == Some(syntax::SET_ACCESSOR))?;
        let owner = self
            .qualified_class_name(object)
            .or_else(|| self.declaring_class_name(declaration))?;
        let key = self.property_key(member)?;
        let setter = MemberKey::set(key.clone()).emitted_name();
        let getter = MemberKey::get(key).emitted_name();
        let declares_a_getter = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .any(|at| self.kind_of(*at) == Some(syntax::GET_ACCESSOR));
        // **The suffix here too**, because this is a third place that names an accessor
        // and `accessor_callee` is not on its path: a `static` one is addressed by the
        // class. The static *method* call was exactly this hole one construct over --
        // `lower_static_call` named the ordinary entry and 10 of 10 cases ended the
        // program -- so it is closed here before it can ship rather than after.
        let access = self.node(member).parent.unwrap_or(member);
        let suffix = self.raising_suffix_of(access);
        Some(Place::Setter {
            object: None,
            callee: Callee::Direct(format!("{owner}.{setter}{suffix}")),
            getter: declares_a_getter.then(|| Callee::Direct(format!("{owner}.{getter}{suffix}"))),
            // **The setter's own parameter, and only then the member's type.**
            //
            // A setter is a call, so what the write must convert to is the
            // *parameter* -- and for an accessor pair the two can differ, because
            // the checker infers an untyped setter parameter from the getter's
            // return. `static get #tag(): string` with `static set #tag(param)`
            // gives the parameter `string` while the member reads as `any`, and
            // taking the member's type meant coercing an erased value *to erased*:
            // a no-op, after which `verify` found `CallArgumentType { callee: "C.set
            // #tag", expected: Managed(String), found: Erased }` and `emit-c` wrote
            // nothing for the whole program. 20 recorded test262 files, every one a
            // class-private accessor.
            //
            // It was invisible until `any` had a representation: `type_of(member)`
            // answered `None` before, so `wants` was absent and the parameter was
            // refused for its own reason. The declaration is already in hand here --
            // this function found it to build the callee -- so the right type was
            // one read away the whole time.
            wants: self
                .accessor_parameter_type(declaration)
                .or_else(|| self.type_of(member)),
            at: access,
        })
    }

    /// The representation a `set` accessor's parameter is declared with.
    ///
    /// Read from the accessor's **own** declaration rather than from the member,
    /// because for an accessor pair those differ: the checker infers an untyped
    /// setter parameter from the getter's return type. See
    /// [`Self::static_accessor_place`], which is where that mattered.
    fn accessor_parameter_type(&mut self, declaration: NodeId) -> Option<HirType> {
        let parameter = self
            .children(declaration)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::PARAMETER))?;
        self.type_of(parameter)
    }

    pub(super) fn super_setter_place(&mut self, object: NodeId, member: NodeId) -> Option<Place> {
        if self.kind_of(object) != Some(syntax::SUPER_KEYWORD) {
            return None;
        }
        let (receiver, callee) =
            self.super_accessor(&MemberKey::set(self.property_key(member)?))?;
        let getter = self
            .super_accessor(&MemberKey::get(self.property_key(member)?))
            .map(|(_, callee)| callee);
        let wants = match self.values[receiver.0 as usize].ty {
            HirType::Managed(ManagedType::Object(ty)) => self
                .declared_type_of(ty, &self.property_key(member)?)
                .and_then(|declared| self.represent(declared)),
            _ => None,
        };
        Some(Place::Setter {
            object: Some(receiver),
            callee,
            getter,
            wants,
            // `super.x = v` reaches the base's implementation by name, and
            // `super_accessor` built that name -- so the access node is only what the
            // raise is tested at. A raising copy is not named here: a `super` accessor
            // is the one shape where the implementation is chosen by the *base*, and
            // `call_within` refuses a `try` over it for want of a copy to name.
            at: self.node(member).parent.unwrap_or(member),
        })
    }

    /// `super.x` as an accessor: the receiver, and the base's implementation.
    ///
    /// **One walk for both directions.** A read and a write of the same
    /// `super.x` have to agree about which class it resolves to, and a
    /// predicate beside an emitter is two chances to disagree -- so this
    /// answers "is there one" and "which one" together, and both sites take
    /// the pair or neither.
    ///
    /// `Callee::Direct` and never virtual: that *is* what `super` means. A
    /// virtual dispatch would find the override, which for
    /// `override get x() { return super.x + 1 }` is the function asking.
    ///
    /// `None` where the base declares no such accessor, which leaves
    /// `super.field` -- storage the receiver already has -- on the path that
    /// already answered it.
    fn super_accessor(&self, key: &MemberKey) -> Option<(ValueId, Callee)> {
        let receiver = self.this?;
        let HirType::Managed(ManagedType::Object(ty)) = self.values[receiver.0 as usize].ty else {
            return None;
        };
        let base = *self.hierarchy.base.get(&ty)?;
        let declaring = self.hierarchy.declaring(base, key)?;
        let owner = self.hierarchy.name.get(&declaring)?;
        Some((
            receiver,
            Callee::Direct(format!("{owner}#{}", key.emitted_name())),
        ))
    }
}
