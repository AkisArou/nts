//! Choose binding overloads and delegated calls, including dictionary argument matching and spread.

use super::{
    Callee, Diagnostic, FuncBuilder, HirType, Lent, LoweringSnapshot, ManagedType, NodeId, TypeId,
    TypeKind, ValueId, syntax,
};

impl FuncBuilder<'_> {
    /// A call of a lib.dom global a binding implements: a function it names
    /// (`requestAnimationFrame(f)`, [`Self::delegated_function`]), or a method
    /// of the global object (`getComputedStyle(el)`, [`Self::window_global`]).
    pub(super) fn lower_bound_global_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if let Some(function) = self.delegated_function(callee) {
            return Some(self.lower_delegated_call(id, function, arguments));
        }
        let (function, name, window) = self.window_global(callee)?;
        let method = self.method_of_bound(
            window,
            self.node(callee)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())?,
            arguments,
        )?;
        Some(
            self.call_foreign_declaration(id, function, &name, Vec::new())
                .and_then(|receiver| {
                    self.lower_native_method_call_as(
                        id,
                        (receiver, callee),
                        method,
                        callee,
                        arguments,
                    )
                }),
        )
    }

    /// The global object, where a binding implements it and `name` names one
    /// of lib.dom's globals no binding names by itself: page script's
    /// `location` is `window.location`, and `getComputedStyle(el)` is
    /// `window.getComputedStyle(el)`, so each is read from what `window`'s
    /// binding answers (`/** @ntsBoundBy "nts:dom" window */ declare var
    /// window`) where the type implementing it declares the member. Only a name
    /// declared where nothing was decoded -- lib.dom -- so a program's own
    /// global is never taken for one. The bound function, its name, and the
    /// type implementing the global object.
    pub(super) fn window_global(&self, name: NodeId) -> Option<(NodeId, String, TypeId)> {
        let symbol = self.denoted_symbol(self.node(name).symbol?);
        if !self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .is_empty()
        {
            return None;
        }
        let (function, bound) = self.module.global_object.clone()?;
        let TypeKind::Function(signature) = self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&function)?.0 as usize)?
            .kind
        else {
            return None;
        };
        let returned = self
            .snapshot
            .signatures
            .get(signature.0 as usize)?
            .return_type;
        Some((function, bound, returned))
    }

    /// [`Self::delegated_method`] on the type implementing the receiver's:
    /// the method `name` of `bound`, its overload chosen by `arguments`.
    pub(super) fn method_of_bound(
        &self,
        bound: TypeId,
        name: &str,
        arguments: &[NodeId],
    ) -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
        let property = crate::hir::native::schema::property(self.snapshot, bound, name)?;
        let first = property.declaration?;
        // **Every overload, chosen by the call's arguments.** A binding spells
        // one lib.dom member as several C functions where its parameters have
        // more than one native form: `append(...nodes: (Node | string)[])` is
        // eight `append` overloads, `nts_dom_Element_append_nns` among them,
        // one per arity and arm. The first whose parameters fit what the call
        // passes is the one; with none, the first, so its own coercion says
        // which argument does not.
        let overloads: Vec<NodeId> = self
            .name_node(first)
            .and_then(|name| self.node(name).symbol)
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| vec![first], |record| record.declarations.clone());
        let TypeKind::Function(merged) = self.snapshot.types.get(property.ty.0 as usize)?.kind
        else {
            return None;
        };
        let merged = &self.snapshot.signatures[merged.0 as usize];
        let method =
            |declaration: NodeId| -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
                let tagged = self
                    .node(declaration)
                    .native
                    .as_ref()
                    .is_some_and(|n| n.symbol.is_some() || n.listener.is_some());
                let record = self.overload_signature(declaration, merged);
                (tagged && self.is_native_instance_method(declaration, &record))
                    .then_some((declaration, record))
            };
        let candidates: Vec<_> = overloads.into_iter().filter_map(method).collect();
        if candidates.len() > 1
            && let Some(at) = self.shortest_fit(&candidates, merged, arguments)
        {
            return candidates.into_iter().nth(at);
        }
        candidates.into_iter().next().or_else(|| method(first))
    }

    /// One overload's own signature, from its declaration's parameters: the
    /// snapshot's function type for an overloaded member carries the first
    /// overload's only. Each parameter node carries its annotated type, and
    /// the `this` parameter is the receiver's; the result is the member's,
    /// which a binding's overloads of one member share.
    pub(super) fn overload_signature(
        &self,
        declaration: NodeId,
        merged: &nts_semantic_schema::SignatureRecord,
    ) -> nts_semantic_schema::SignatureRecord {
        let mut record = merged.clone();
        let mut parameters = Vec::new();
        for parameter in self
            .children(declaration)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
        {
            let Some(&ty) = self.snapshot.node_types.get(&parameter) else {
                return merged.clone();
            };
            let name = self
                .name_node(parameter)
                .and_then(|name| {
                    self.node(name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })
                .unwrap_or_default();
            if name == "this" {
                record.this_type = Some(ty);
                continue;
            }
            let children = self.children(parameter);
            let rest = children
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN));
            let optional = children
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_TOKEN));
            parameters.push(nts_semantic_schema::ParameterRecord {
                name,
                ty,
                optional,
                rest,
            });
        }
        record.parameters = parameters;
        record
    }

    /// Whether a call's written arguments fit a native signature: as many as
    /// it takes, less its optional tail, and each of the kind its parameter
    /// is -- a string where it takes a string or a `StringView`, a handle
    /// where it takes that handle or one it extends, a number where a number.
    /// A parameter of any other type takes anything, which its coercion then
    /// decides.
    pub(super) fn arguments_fit(
        &self,
        record: &nts_semantic_schema::SignatureRecord,
        checked: Option<&nts_semantic_schema::SignatureRecord>,
        arguments: &[NodeId],
    ) -> bool {
        let required = record
            .parameters
            .iter()
            .filter(|parameter| !parameter.optional && !parameter.rest)
            .count();
        if arguments.len() < required || arguments.len() > record.parameters.len() {
            return false;
        }
        record.parameters.iter().enumerate().zip(arguments).all(|((at, parameter), argument)| {
            let Some(&given) = self.snapshot.node_types.get(argument) else { return true };
            let taken = parameter.ty;
            // The parameter of the signature the call was checked against,
            // at the same position: the dictionary whose members a record
            // conversion may read (`record_holds`).
            let checked = checked
                .and_then(|checked| checked.parameters.get(at))
                .map(|parameter| parameter.ty);
            if let Some(lent) = crate::hir::native::native_array_argument(self.snapshot, taken) {
                return self.lends_as(&lent, given);
            }
            if crate::hir::native::string_encoding(self.snapshot, taken).is_some() || crate::hir::native::is_string(self.snapshot, taken) {
                return matches!(self.represent(given), Some(HirType::Managed(ManagedType::String)));
            }
            if let Some(crate::hir::native::Pointee::Opaque(want)) = crate::hir::native::pointer(self.snapshot, taken) {
                return matches!(crate::hir::native::pointer(self.snapshot, given),
                    Some(crate::hir::native::Pointee::Opaque(have)) if have == want || have.upcasts_to(&want));
            }
            if matches!(self.represent(taken), Some(HirType::Float { .. } | HirType::Int { .. })) {
                return matches!(self.represent(given), Some(HirType::Float { .. } | HirType::Int { .. }));
            }
            if let Some(HirType::NativePointer(view)) = self.represent(taken)
                && let crate::hir::native::Pointee::Record(record) = view.viewed()
            {
                return self.record_holds(record, *argument, given, checked);
            }
            true
        })
    }

    /// Whether an argument of type `given` is an array a parameter lending
    /// `lent` -- the array its `CStrings`, `CHandles`, `CBytes` or `CElements`
    /// markers are intersected with -- can lend: strings to `CStrings`,
    /// handles of the class or one extending it to `CHandles`, a typed array
    /// of the elements C reads to `CBytes` and `CElements`. So
    /// `new Blob(["a"])` takes nts:dom's strings overload and
    /// `new Blob([blob])` its blobs' (the Chromium lane's
    /// lib-dom-an-array-overload-chosen-by-its-elements). `null` and
    /// `undefined` fit, being the NULL C is lent, as does an array of any
    /// other element, which the lend itself decides.
    fn lends_as(&self, lent: &HirType, given: TypeId) -> bool {
        use crate::hir::native::Pointee;
        let absent = matches!(
            self.snapshot
                .types
                .get(given.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Null | TypeKind::Undefined)
        );
        let Some(have) = self.represent(given) else {
            return true;
        };
        match (lent, &have) {
            (
                HirType::Managed(ManagedType::Array(want)),
                HirType::Managed(ManagedType::Array(have)),
            ) => match (&**want, &**have) {
                (
                    HirType::NativePointer(Pointee::Opaque(want)),
                    HirType::NativePointer(Pointee::Opaque(have)),
                ) => have == want || have.upcasts_to(want),
                (HirType::Managed(ManagedType::String), have) => {
                    *have == HirType::Managed(ManagedType::String)
                }
                (HirType::NativePointer(Pointee::Opaque(_)), _) => false,
                _ => true,
            },
            (
                HirType::Managed(ManagedType::View(want)),
                HirType::Managed(ManagedType::View(have)),
            ) => want == have,
            (HirType::Managed(ManagedType::Array(_) | ManagedType::View(_)), _) => absent,
            _ => true,
        }
    }

    /// The member names of the dictionary a checked parameter type names,
    /// its own and inherited -- an object type's properties carry both --
    /// through the unions a parameter may spell the dictionary in
    /// (`number | DOMPointInit | ...`). `None` where no part of the type is
    /// an object: no dictionary to key on.
    fn dictionary_member_names(&self, ty: TypeId) -> Option<Vec<&str>> {
        fn collect<'a>(
            snapshot: &'a LoweringSnapshot<'a>,
            ty: TypeId,
            path: &mut Vec<TypeId>,
            names: &mut Vec<&'a str>,
        ) -> bool {
            if path.contains(&ty) {
                return false;
            }
            path.push(ty);
            let found = match snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Object { properties }) => {
                    names.extend(properties.iter().filter_map(|p| p.name.public_name()));
                    true
                }
                // A generic dictionary (`UnderlyingSource<R>`) arrives as an
                // opaque nominal whose members are not traversed; the
                // object types carrying its symbol carry the names, read
                // from the snapshot's index of them -- never by revisiting
                // the nominal's same-symbol siblings, which re-enters this
                // arm for each and enumerates their permutations.
                Some(TypeKind::Structured) => snapshot
                    .types
                    .get(ty.0 as usize)
                    .and_then(|record| record.symbol)
                    .and_then(|symbol| snapshot.dictionary_members(symbol))
                    // A hit is a known dictionary even with no members to
                    // read: only a miss -- no object row for the symbol --
                    // leaves the fit without a dictionary to key on, as
                    // the object walk this replaced answered.
                    .is_some_and(|members| {
                        names.extend(members.iter().map(String::as_str));
                        true
                    }),
                Some(TypeKind::Union(parts) | TypeKind::Intersection(parts)) => parts
                    .iter()
                    .map(|part| collect(snapshot, *part, path, names))
                    .collect::<Vec<_>>()
                    .contains(&true),
                _ => false,
            };
            path.pop();
            found
        }
        let mut names = Vec::new();
        collect(self.snapshot, ty, &mut Vec::new(), &mut names).then_some(names)
    }

    /// Whether every member `argument` can carry is a field of `record`, the C
    /// record a binding takes a dictionary by.
    ///
    /// **A member the record has no field for is dropped without a word**:
    /// the record is written field by field from the object
    /// (`copy_into_native_record`), so `new CustomEvent("ready", { bubbles:
    /// true, detail: 5 })` made an event whose detail was null, nts:dom's
    /// `CustomEventInit` having no field for an `any`, and `fetch(url, { method:
    /// "POST", body })` sent no body (the Chromium lane's
    /// lib-dom-a-dictionary-member-its-binding-has-no-field-for). The call is
    /// typechecked against lib.dom's dictionary and lowered to the binding's
    /// record, so nothing else compares the two. An overload this does not
    /// fit is not taken -- a binding offering the members as parameters is
    /// chosen instead -- and with none left the call is refused by name.
    ///
    /// A literal says which members it writes, a nested literal for a
    /// nested record included. Any other object may hold every property its
    /// type declares, an optional one too -- but a dictionary conversion
    /// reads only the dictionary's own members, so where the checked
    /// signature's dictionary is known (`checked`), only a property that
    /// *is* one of its members (inherited ones included) must have a field:
    /// the rest of the object's face, `DOMPointReadOnly`'s `matrixTransform`
    /// and `toJSON` beside its `x`, is never read and cannot be dropped.
    /// Keyed on membership, not on property kind: a member the dictionary
    /// declares as a callback is written as a method by the class
    /// implementing it, and would be dropped all the same. Without the
    /// checked dictionary, every property must have a field, as before.
    fn record_holds(
        &self,
        record: &crate::hir::native::Record,
        argument: NodeId,
        given: TypeId,
        checked: Option<TypeId>,
    ) -> bool {
        let field = |name: &str| record.fields.iter().find(|field| field.name == name);
        if self.kind_of(argument) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            // A handle is never copied into a record: the copy writes a
            // managed object's fields, and an opaque value is read through
            // the overload beside this one that takes it as itself (the
            // object arm a dictionary argument is offered by). Letting the
            // record hold one by its members took it over that arm for
            // `matrix.multiply(rotate)` -- every member has a field -- and
            // the conversion then refused the pointer. (A struct value is
            // a record already, not a handle, and is not this.)
            if let Some(HirType::NativePointer(view)) = self.represent(given)
                && matches!(view.viewed(), crate::hir::native::Pointee::Opaque(_))
            {
                return false;
            }
            let members = checked.and_then(|ty| self.dictionary_member_names(ty));
            let parts = match self.snapshot.types.get(given.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Union(parts) | TypeKind::Intersection(parts)) => parts.clone(),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![given],
                _ => vec![given],
            };
            return parts.iter().all(|part| {
                match self.snapshot.types.get(part.0 as usize).map(|r| &r.kind) {
                    Some(TypeKind::Object { properties }) => {
                        properties
                            .iter()
                            .all(|p| match (&members, p.name.public_name()) {
                                (Some(members), Some(name)) => {
                                    !members.contains(&name) || field(name).is_some()
                                }
                                (Some(_), None) => true,
                                (None, name) => name.is_some_and(|name| field(name).is_some()),
                            })
                    }
                    Some(TypeKind::Null | TypeKind::Undefined) => true,
                    #[expect(
                        clippy::match_same_arms,
                        reason = "keep audited semantic type variants explicit"
                    )]
                    Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => false,
                    _ => false,
                }
            });
        }
        self.children(argument)
            .into_iter()
            .all(|member| match self.kind_of(member) {
                Some(syntax::PROPERTY_ASSIGNMENT) => {
                    let [name, value] = self.children(member)[..] else {
                        return false;
                    };
                    let Some(native) = self.literal_name(name).and_then(|name| field(&name)) else {
                        return false;
                    };
                    match (&native.ty, self.snapshot.node_types.get(&value)) {
                        // A `Given<T>` pair is written from the member's value
                        // -- its `T`, or `undefined` -- not from a literal of
                        // the pair's own fields (`write_given`).
                        (crate::hir::native::Pointee::Record(inner), _) if inner.given => true,
                        (crate::hir::native::Pointee::Record(inner), Some(&ty)) => {
                            self.record_holds(inner, value, ty, None)
                        }
                        _ => true,
                    }
                }
                Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                    let [name, ..] = self.children(member)[..] else {
                        return false;
                    };
                    self.literal_name(name)
                        .is_some_and(|name| field(&name).is_some())
                }
                // A spread, a method or an accessor: which members it writes is
                // not written here.
                _ => false,
            })
    }

    /// The function implementing a call's callee, where a binding implements
    /// it: lib.dom.d.ts's `requestAnimationFrame`, `@ntsBoundBy "nts:dom"
    /// requestAnimationFrame` on the overlay's declaration of the same name,
    /// is `nts:dom`'s. Asked of the name's symbol rather than the checker's
    /// callee, which may be lib.dom's own declaration and is then never decoded.
    fn delegated_function(&self, callee_node: NodeId) -> Option<(NodeId, TypeId)> {
        if self.kind_of(callee_node) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.denoted_symbol(self.node(callee_node).symbol?);
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        let binding = record.declarations.iter().find_map(|declaration| {
            (self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION))
                .then(|| {
                    self.node(*declaration)
                        .native
                        .as_deref()?
                        .bound_by
                        .as_deref()
                })
                .flatten()
        })?;
        let (module, name) = nts_semantic_schema::binding::parse(binding)?;
        let function = nts_semantic_schema::binding::declared_in(
            self.snapshot,
            module,
            name,
            syntax::FUNCTION_DECLARATION,
        )?;
        Some((function, *self.snapshot.node_types.get(&function)?))
    }

    /// The function implementing a **static** operation of a class a binding
    /// implements: lib.dom's `URL.canParse(x)` -- a member of `declare var URL:
    /// { …; canParse(…) }` -- is the bound module's `URL_canParse`, declared beside
    /// the type it binds and named `<Interface>_<member>`, as its constructor is
    /// `new<Interface>` ([`Self::delegated_constructor`]). The binding is read from
    /// the interface the receiver's name also declares (`/** @ntsBoundBy "nts:dom"
    /// URL */ interface URL {}`). Overloads by arity, as everywhere.
    pub(super) fn delegated_static(
        &self,
        receiver: NodeId,
        member: NodeId,
    ) -> Option<(NodeId, TypeId)> {
        if self.kind_of(receiver) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.denoted_symbol(self.node(receiver).symbol?);
        let (module, name) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .find_map(|declaration| {
                (self.kind_of(*declaration) == Some(syntax::INTERFACE_DECLARATION))
                    .then(|| {
                        nts_semantic_schema::binding::parse(
                            self.node(*declaration)
                                .native
                                .as_deref()?
                                .bound_by
                                .as_deref()?,
                        )
                    })
                    .flatten()
            })?;
        let member = self.literal_name(member)?;
        let function = nts_semantic_schema::binding::declared_in(
            self.snapshot,
            module,
            &format!("{name}_{member}"),
            syntax::FUNCTION_DECLARATION,
        )?;
        Some((function, *self.snapshot.node_types.get(&function)?))
    }

    /// A call of a function a binding implements, as a call of that function,
    /// at its parameters: `@ntsDefault`s and ABI types are the bound
    /// declaration's (`callee_signature`), as for [`Self::delegated_method`].
    pub(super) fn lower_delegated_call(
        &mut self,
        id: NodeId,
        (function, ty): (NodeId, TypeId),
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(TypeKind::Function(signature)) = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        else {
            return Err(
                self.unsupported(id, "a function a binding names, whose signature is unknown")
            );
        };
        // Its overload chosen by the arguments, as a bound method's is:
        // `requestIdleCallback(f)` and `requestIdleCallback(f, { timeout })`
        // are two of nts:dom's declarations.
        let merged = self.snapshot.signatures[signature.0 as usize].clone();
        let (function, record) = self.overload_by_arguments(function, &merged, arguments);
        let name = nts_semantic_schema::binding::declared_name(self.snapshot, function)
            .unwrap_or_default()
            .to_owned();
        let callee = self.native_callee(id, Some(function), name, &record)?;
        let spread = self.spread_for(id, &record, arguments);
        let outer = self.delegated_signature.replace((id, record));
        let lowered = self.lower_call_arguments(id, &callee, arguments, None);
        self.delegated_signature = outer;
        self.dictionary_slots = spread;
        let (args, lent) = lowered?;
        self.finish_call(id, callee, args, lent, Some(function))
    }

    /// The overload of the function declared at `first` its arguments fit
    /// ([`Self::call_fits`]), each overload's signature read from its own
    /// parameters; with none, the first.
    fn overload_by_arguments(
        &self,
        first: NodeId,
        merged: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> (NodeId, nts_semantic_schema::SignatureRecord) {
        let overloads: Vec<NodeId> = self
            .name_node(first)
            .and_then(|name| self.node(name).symbol)
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| vec![first], |record| record.declarations.clone());
        let candidates: Vec<_> = overloads
            .into_iter()
            .map(|declaration| (declaration, self.overload_signature(declaration, merged)))
            .collect();
        let at = self
            .shortest_fit(&candidates, merged, arguments)
            .unwrap_or(0);
        candidates
            .into_iter()
            .nth(at)
            .unwrap_or_else(|| (first, merged.clone()))
    }

    /// Refuse a call that passes an argument the bound function it lowers to has no
    /// parameter for.
    ///
    /// **A binding's overloads are a subset of lib.dom's**, and when none fits,
    /// the first is taken so that argument coercion can say which argument does
    /// not fit (`method_of_bound`). That covers an argument of the wrong type and
    /// not one *too many*: an argument past the last parameter is dropped, as
    /// JavaScript drops one -- and silently. `new Blob(["héllo"])`, with nts:dom
    /// binding only `newBlob()` because the parts constructor takes a
    /// `sequence<BlobPart>`, built an empty Blob where V8 had the text
    /// (`blockers/lib-dom-new-that-fits-no-constructor`, the Chromium lane's).
    pub(super) fn refuse_dropped_arguments(
        &self,
        declaration: NodeId,
        record: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Result<(), Diagnostic> {
        // Every parameter, the `@ntsThrows` one included: `as_written` leaves it
        // out for choosing an overload, but a program may pass its own out slot
        // (`parser.parse("q", mine)`), and that argument is not dropped.
        if record.parameters.iter().any(|parameter| parameter.rest) {
            return Ok(());
        }
        let Some(&dropped) = arguments.get(record.parameters.len()) else {
            return Ok(());
        };
        let name = nts_semantic_schema::binding::declared_name(self.snapshot, declaration)
            .unwrap_or("the bound function");
        Err(self.unsupported(
            dropped,
            &format!(
                "an argument `{name}` has no parameter for: no overload the binding declares \
                 takes {} argument(s), and the call would drop it",
                arguments.len()
            ),
        ))
    }

    /// An overload's signature as a call writes it: without the parameter its
    /// `@ntsThrows` names, which the binding passes itself and no argument
    /// supplies. Left in, `observe(target, error?)` -- the binding's own out
    /// pointer for a `DOMException` -- fitted `observe(target, { childList:
    /// true })`, the literal landing in `error`, and being shorter was chosen
    /// over `observe(target, options)`.
    fn as_written(
        &self,
        declaration: NodeId,
        record: &nts_semantic_schema::SignatureRecord,
    ) -> nts_semantic_schema::SignatureRecord {
        let thrown = self
            .node(declaration)
            .native
            .as_deref()
            .and_then(|native| native.throws.as_deref())
            .and_then(|text| text.split_whitespace().next());
        let Some(thrown) = thrown else {
            return record.clone();
        };
        let mut written = record.clone();
        written
            .parameters
            .retain(|parameter| parameter.name != thrown);
        written
    }

    /// Which overload a call takes: of those its arguments fit
    /// ([`Self::call_fits`]), the one with the fewest parameters, the first
    /// declared among equals. The shortest, because an overload's extra
    /// parameters are what the call does not say: `addEventListener(t, f,
    /// { once: true })` fits both nts:dom's `(.., capture?, once?, signal?)` and
    /// the one that adds `passive?`, and leaving `passive` unset is the first's
    /// whole point -- Blink's default for touch and wheel listeners needs it
    /// unset, not false.
    pub(super) fn shortest_fit(
        &self,
        candidates: &[(NodeId, nts_semantic_schema::SignatureRecord)],
        checked: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Option<usize> {
        let written: Vec<nts_semantic_schema::SignatureRecord> = candidates
            .iter()
            .map(|(declaration, record)| self.as_written(*declaration, record))
            .collect();
        // WebIDL's overload resolution first narrows to an effective set by
        // count alone: of the entries for a call of n arguments, only those
        // whose argument count is min(maxarg, n) remain -- maxarg the most
        // parameters any entry takes, optional and variadic parameters
        // counted. An entry here is unexpanded, so it participates at every
        // count from its required parameters to its total, a variadic one
        // without an upper bound, and survives where that span covers the
        // kept count. Only then do the arguments distinguish entries,
        // [`Self::call_fits`] and, with none fitting, the fallback below
        // alike: without the count a zero-parameter entry passed every
        // per-parameter test vacuously and answered for an argument it has
        // no parameter for. A dictionary spread is not WebIDL's shape -- a
        // literal's members are the arguments, not one of them -- so an
        // entry the call spreads into is kept by that, not by count.
        let maxarg = written
            .iter()
            .map(|record| {
                if record.parameters.iter().any(|parameter| parameter.rest) {
                    usize::MAX
                } else {
                    record.parameters.len()
                }
            })
            .max()
            .unwrap_or(0);
        let kept = maxarg.min(arguments.len());
        let counted = |record: &nts_semantic_schema::SignatureRecord| {
            if self.dictionary_spread(record, arguments).is_some() {
                return true;
            }
            let required = record
                .parameters
                .iter()
                .filter(|parameter| !parameter.optional && !parameter.rest)
                .count();
            let variadic = record.parameters.iter().any(|parameter| parameter.rest);
            required <= kept && (variadic || kept <= record.parameters.len())
        };
        if let Some(at) = candidates
            .iter()
            .enumerate()
            .filter(|(at, _)| counted(&written[*at]))
            .filter(|(at, _)| self.call_fits(&written[*at], checked, arguments))
            .min_by_key(|(at, (_, record))| (record.parameters.len(), *at))
            .map(|(at, _)| at)
        {
            return Some(at);
        }
        // None fits, and the caller takes what this answers so coercion can
        // name what it cannot carry. A lent array is never that answer for
        // an argument that does not lend as one: it is the one parameter
        // kind whose refusal says nothing about the argument's own kind,
        // and taking it by declaration order made `roundRect`'s radii list
        // answer for a DOMPointReadOnly (its dictionary arm, declared
        // after, is the conversion that cannot carry it -- and the one
        // that names it). The first candidate the count kept that no lent
        // parameter refuses outright; where every one does, none, and the
        // caller falls back as before.
        candidates.iter().enumerate().position(|(at, _)| {
            let written = &written[at];
            counted(written)
                && written
                    .parameters
                    .iter()
                    .zip(arguments)
                    .all(|(parameter, argument)| {
                        if crate::hir::native::native_array_argument(self.snapshot, parameter.ty)
                            .is_none()
                        {
                            return true;
                        }
                        // An array of the wrong elements is not refused here:
                        // the lend names its elements, which is the refusal the
                        // call owes (a Blob[] for the strings Blob's parts are
                        // bound by). Only an argument that is no array at all
                        // leaves the lent refusal with nothing to say about it.
                        let Some(&given) = self.snapshot.node_types.get(argument) else {
                            return true;
                        };
                        if matches!(
                            self.snapshot
                                .types
                                .get(given.0 as usize)
                                .map(|record| &record.kind),
                            Some(TypeKind::Null | TypeKind::Undefined)
                        ) {
                            return true;
                        }
                        match self.represent(given) {
                            Some(HirType::Managed(
                                ManagedType::Array(_) | ManagedType::View(_),
                            )) => true,
                            Some(_) => false,
                            None => matches!(
                                self.snapshot
                                    .types
                                    .get(given.0 as usize)
                                    .map(|record| &record.kind),
                                Some(TypeKind::Array(_) | TypeKind::Tuple(_))
                            ),
                        }
                    })
        })
    }

    /// Whether a call's arguments fit `record`, a dictionary literal last
    /// taken as its members where the binding takes them so
    /// ([`Self::dictionary_spread`]).
    ///
    /// **A dictionary fits only where it is taken whole or as members.** A
    /// literal no member of which names a parameter is one object, which no
    /// boolean, number or string parameter takes -- `arguments_fit` lets a
    /// parameter of a type it does not check take anything, and so
    /// `{ passive: true }` fitted `addEventListener`'s `capture?: boolean` of
    /// the overload without `passive`. And spread, a member left out is a gap
    /// only where its parameter is optional, as is every parameter after the
    /// last member: the overload with a required `passive` does not fit a
    /// literal without one.
    fn call_fits(
        &self,
        record: &nts_semantic_schema::SignatureRecord,
        checked: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> bool {
        let Some((_, slots)) = self.dictionary_spread(record, arguments) else {
            let whole = arguments.split_last().is_some_and(|(literal, before)| {
                self.kind_of(*literal) == Some(syntax::OBJECT_LITERAL_EXPRESSION)
                    && record
                        .parameters
                        .get(before.len())
                        .is_some_and(|parameter| self.is_scalar_type(parameter.ty))
            });
            return !whole && self.arguments_fit(record, Some(checked), arguments);
        };
        record
            .parameters
            .iter()
            .skip(slots.len())
            .all(|parameter| parameter.optional || parameter.rest)
            && slots
                .iter()
                .zip(&record.parameters)
                .all(|(slot, parameter)| match slot {
                    None => parameter.optional,
                    Some(argument) => {
                        let one = nts_semantic_schema::SignatureRecord {
                            parameters: vec![parameter.clone()],
                            ..record.clone()
                        };
                        self.arguments_fit(&one, None, &[*argument])
                    }
                })
    }

    /// Whether `ty` is a boolean, a number or a string, or one of them or
    /// `null` or `undefined`: a type no object is.
    fn is_scalar_type(&self, ty: TypeId) -> bool {
        let scalar = |kind: &TypeKind| {
            matches!(
                kind,
                TypeKind::Boolean | TypeKind::Number | TypeKind::String | TypeKind::Literal(_)
            )
        };
        match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(parts)) => {
                let kinds: Vec<&TypeKind> = parts
                    .iter()
                    .filter_map(|part| {
                        self.snapshot
                            .types
                            .get(part.0 as usize)
                            .map(|record| &record.kind)
                    })
                    .collect();
                kinds.iter().any(|kind| scalar(kind))
                    && kinds.iter().all(|kind| {
                        scalar(kind) || matches!(kind, TypeKind::Null | TypeKind::Undefined)
                    })
            }
            Some(kind) => scalar(kind),
            None => false,
        }
    }

    /// A dictionary argument a binding takes as its members: lib.dom's
    /// `addEventListener(type, f, { once: true })` is nts:dom's
    /// `addEventListener(type, f, capture?, once?, signal?)`, and
    /// `requestIdleCallback(f, { timeout: 500 })` its `(f, timeout)`. The
    /// literal, and the call's arguments as the binding takes them: those
    /// before the literal as written, then for each parameter up to the last
    /// one the literal names, its member's expression, or `None` -- the
    /// parameter's `@ntsDefault`, which a member left out means.
    ///
    /// **Only where every member names a parameter**, so a binding that takes
    /// the dictionary whole (`Fields<EventInit>`) is never taken apart. And
    /// only where order cannot be seen: the members are evaluated in the
    /// binding's order, which is the literal's unless at most one of them can
    /// have an effect.
    fn dictionary_spread(
        &self,
        record: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Option<(NodeId, Vec<Option<NodeId>>)> {
        let (&literal, before) = arguments.split_last()?;
        if self.kind_of(literal) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            return None;
        }
        let tail = record.parameters.get(before.len()..)?;
        let mut members: Vec<(String, NodeId)> = Vec::new();
        for property in self.children(literal) {
            if self.kind_of(property) != Some(syntax::PROPERTY_ASSIGNMENT) {
                return None;
            }
            let [name, value] = self.children(property)[..] else {
                return None;
            };
            members.push((self.literal_name(name)?, value));
        }
        let at = |name: &str| tail.iter().position(|parameter| parameter.name == name);
        let positions = members
            .iter()
            .map(|(name, _)| at(name))
            .collect::<Option<Vec<_>>>()?;
        let last = *positions.iter().max()?;
        let reordered = positions.windows(2).any(|pair| pair[0] > pair[1]);
        if reordered
            && members
                .iter()
                .filter(|(_, value)| !self.cannot_have_effects(*value))
                .count()
                > 1
        {
            return None;
        }
        let slots = before
            .iter()
            .map(|argument| Some(*argument))
            .chain(tail[..=last].iter().map(|parameter| {
                members
                    .iter()
                    .find(|(name, _)| *name == parameter.name)
                    .map(|(_, value)| *value)
            }))
            .collect();
        Some((literal, slots))
    }

    /// The dictionary plan for a call at `record` ([`Self::dictionary_spread`]),
    /// installed for [`Self::lower_call_arguments`]; what was installed
    /// before, for the caller to put back.
    pub(super) fn spread_for(
        &mut self,
        id: NodeId,
        record: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Option<(NodeId, NodeId, Vec<Option<NodeId>>)> {
        let plan = self
            .dictionary_spread(record, arguments)
            .map(|(literal, slots)| (id, literal, slots));
        std::mem::replace(&mut self.dictionary_slots, plan)
    }

    /// Scope the selected native binding's written parameter contract to this
    /// call, restoring an enclosing call's context before propagating failure.
    pub(super) fn bound_arguments(
        &mut self,
        id: NodeId,
        callee: &Callee,
        arguments: &[NodeId],
        receiver: ValueId,
        signature: nts_semantic_schema::SignatureRecord,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        let outer = self.delegated_signature.replace((id, signature));
        let lowered = self.lower_call_arguments(id, callee, arguments, Some(receiver));
        self.delegated_signature = outer;
        lowered
    }
}
