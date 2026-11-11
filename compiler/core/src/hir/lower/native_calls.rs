//! Build native direct, table, and message callees from the binding signature and invoke them.

use super::{
    Callee, Diagnostic, FuncBuilder, HirType, LinkTag, NodeId, OpKind, ParameterTags,
    StringsBridged, TypeKind, ValueId, append_error_slot, bridge_blocks, bridge_strings,
    split_hidden_throws, syntax, via_callee,
};

/// A natively represented thing an erased value can be, for the one question
/// `in` asks of it: does something of this shape declare the name.
///
/// Each variant is a test the runtime already performs for `instanceof`, which
/// is why the list is these eight and not a kind enum: a kind the compiler
/// cannot name is a kind it cannot answer for, and a variant here that no
/// `natives_declaring` entry mentions would be dead rather than conservative.
#[derive(Clone, Copy)]
pub(super) enum Native {
    /// An array or a tuple. One `nts_is_array`, which accepts both because the
    /// language calls a tuple an Array.
    Array,
    /// A typed array or a `DataView`.
    View,
    /// A typed array and not a `DataView`, which is `View` minus one test.
    TypedArray,
    ArrayBuffer,
    Map,
    Set,
    Promise,
    /// Not a descriptor at all: a closure's erased form carries its own tag.
    Function,
}

/// A foreign function the compiler calls on its own account -- a C function,
/// or an Objective-C message when `send` is one -- rather than one a binding
/// declares: plain arguments, nothing retained or lent, owning nothing.
pub(super) fn synthesized(
    name: &str,
    parameters: Vec<crate::hir::native::Type>,
    result: crate::hir::native::Type,
    send: Option<crate::hir::native::Send>,
    frameworks: Vec<String>,
) -> crate::hir::native::Function {
    crate::hir::native::Function {
        thunk: None,
        name: name.to_owned(),
        convention: crate::hir::native::Convention::C,
        retention: vec![crate::hir::native::Retention::Unknown; parameters.len()],
        roles: vec![crate::hir::native::Role::Plain; parameters.len()],
        parameters,
        result,
        variadic: None,
        declared_at: None,
        returns_string: None,
        returns_array: None,
        returns_dictionary: None,
        returns_set: None,
        send,
        returns_owned: false,
        consumes: Vec::new(),
        frameworks,
        libraries: Vec::new(),
        defaults: Vec::new(),
        result_as: None,
        vtable: None,
        hresult: false,
        result_as_number: false,
    }
}

/// A message the lowering makes itself -- a bridge's `alloc`, `count`,
/// `addObject:` -- with the ownership ARC's method families give it, as
/// `native_callee_with` gives a declared one: a pointer from `alloc`, `init`,
/// `new` or `copy` is the caller's, and `init` consumes its receiver.
pub(super) fn bridge_send(
    selector: &str,
    class: Option<&str>,
    parameters: Vec<crate::hir::native::Type>,
    result: crate::hir::native::Type,
) -> crate::hir::native::Function {
    let send = crate::hir::native::Send {
        selector: selector.to_owned(),
        class: class.map(str::to_owned),
        super_of: None,
    };
    let pointer = matches!(result, crate::hir::native::Type::Pointer(_));
    let mut message = synthesized(
        selector,
        parameters,
        result,
        Some(send),
        vec!["Foundation".to_owned()],
    );
    message.returns_owned = pointer && crate::hir::native::Send::returns_owned(selector);
    if class.is_none() && crate::hir::native::Send::consumes_receiver(selector) {
        message.consumes = vec![0];
    }
    message
}

/// Whether a declaration names another way to be called: a C symbol
/// (`@ntsSymbol`) or an Objective-C message (`@ntsSelector`).
fn symbol_tagged(lowerer: &FuncBuilder<'_>, decl: NodeId) -> bool {
    lowerer
        .node(decl)
        .native
        .as_ref()
        .is_some_and(|n| n.symbol.is_some() || n.selector.is_some())
}

impl FuncBuilder<'_> {
    /// A foreign function a tag names, called at `id` with `arguments` and
    /// its defaults for the rest -- `Declared`, `Owned` and its tags applying
    /// as at any call of it. Found by its symbol: every binding's declarations
    /// are in the program, and a C name is one function wherever it is
    /// declared.
    pub(super) fn call_foreign_named(
        &mut self,
        id: NodeId,
        function: &str,
        arguments: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        self.call_foreign_named_absent(id, function, arguments.into_iter().map(Some).collect())
    }

    /// As [`Self::call_foreign_named`], where an argument may be absent: a
    /// nullable parameter a construction's props left out, passed as the
    /// NULL its own type represents.
    pub(super) fn call_foreign_named_absent(
        &mut self,
        id: NodeId,
        function: &str,
        arguments: Vec<Option<ValueId>>,
    ) -> Result<ValueId, Diagnostic> {
        let declaration = self
            .snapshot
            .symbols
            .iter()
            .filter(|symbol| symbol.name.is_name(function.as_ref()))
            .flat_map(|symbol| symbol.declarations.iter().copied())
            .find(|node| {
                self.kind_of(*node) == Some(syntax::FUNCTION_DECLARATION) && !self.has_a_body(*node)
            })
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    &format!("a tag naming `{function}`, which no foreign function declares"),
                )
            })?;
        self.call_foreign_declaration_absent(id, declaration, function, arguments)
    }

    /// As [`Self::call_foreign_named`], of a declaration already in hand -- one
    /// a binding resolved within its module, where a name alone could find a
    /// namesake in another.
    pub(super) fn call_foreign_declaration(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        function: &str,
        arguments: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        self.call_foreign_declaration_absent(
            id,
            declaration,
            function,
            arguments.into_iter().map(Some).collect(),
        )
    }

    fn call_foreign_declaration_absent(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        function: &str,
        arguments: Vec<Option<ValueId>>,
    ) -> Result<ValueId, Diagnostic> {
        // Its own signature, as a call of it would resolve: a symbol's type is
        // its declaration's (`node_types`), which the frontend records there
        // rather than on the symbol.
        let signature = std::iter::once(declaration)
            .chain(self.children(declaration))
            .find_map(|node| self.snapshot.node_types.get(&node).copied())
            .and_then(
                |ty| match self.snapshot.types.get(ty.0 as usize).map(|t| &t.kind) {
                    Some(TypeKind::Function(signature)) => Some(*signature),
                    #[expect(
                        clippy::match_same_arms,
                        reason = "keep audited semantic type variants explicit"
                    )]
                    Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => None,
                    _ => None,
                },
            )
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    &format!("a tag naming `{function}`, whose signature is unknown"),
                )
            })?;
        let record = self.snapshot.signatures[signature.0 as usize].clone();
        let callee = self.native_callee(id, Some(declaration), function.to_owned(), &record)?;
        let Callee::Native(target) = &callee else {
            return Err(self.unsupported(
                id,
                &format!("a tag naming `{function}`, which is not foreign"),
            ));
        };
        let origin = self.origin(id);
        let mut given = Vec::with_capacity(arguments.len());
        for (at, argument) in arguments.into_iter().enumerate() {
            let value = if let Some(value) = argument {
                value
            } else {
                let ty = record
                    .parameters
                    .get(at)
                    // As a `null` written there is: the parameter as passed.
                    .and_then(|parameter| self.represent_passed(parameter.ty))
                    // A handle, or an array lent to C: what a `null` there is.
                    .filter(|ty| ty.is_managed() || matches!(ty, HirType::NativePointer(_)))
                    .ok_or_else(|| self.unsupported(id, &format!("`{function}` left without an argument that is not a nullable reference")))?;
                self.push(OpKind::ConstNull, ty, origin.clone())
            };
            given.push(value);
        }
        // The parameters past `arguments` by their `@ntsDefault`s, as a call
        // leaving them out gets them.
        let written = given.len();
        let mut arguments = given;
        let outer = self.omitting_for.replace((target.clone(), 0, id));
        let defaults = (written..record.parameters.len())
            .map(|at| self.omitted_by_default(at, &origin))
            .collect::<Option<Vec<_>>>();
        self.omitting_for = outer;
        arguments.extend(defaults.ok_or_else(|| {
            self.unsupported(id, &format!("a tag naming `{function}`, whose parameters past the {written} it is given are not all `@ntsDefault`ed"))
        })?);
        let (args, lent) = self.native_arguments(id, &target.clone(), arguments, written, None)?;
        let typed = target.call_result();
        self.finish_call_typed(id, callee, args, lent, Some(declaration), Some(typed))
    }

    /// The method a binding declares on a C handle, when the call at `id`
    /// resolved to one: a method signature naming its C function with
    /// `@ntsSymbol` and its instance with `this: T` -- what `bind-gir` writes
    /// on `GtkButtonMethods` for `button.set_label(text)`.
    /// A C function a binding declares as a static method of a value --
    /// `GtkStringObject.new("x")`, GJS's constructors -- when the call at `id`
    /// resolved to one: an `@ntsSymbol` method signature with no `this`,
    /// called on a plain name. The name is a declaration only, with nothing to
    /// evaluate, and a name is all that is accepted, so nothing is skipped.
    pub(super) fn static_native(&self, id: NodeId, target: NodeId) -> Option<NodeId> {
        let call = self.snapshot.call_targets.get(&id)?;
        let declaration = call.callee?;
        let signature = &self.snapshot.signatures[call.signature.0 as usize];
        (self.kind_of(target) == Some(syntax::IDENTIFIER)
            && self.kind_of(declaration) == Some(syntax::METHOD_SIGNATURE)
            && signature.this_type.is_none()
            && self
                .node(declaration)
                .native
                .as_ref()
                .is_some_and(|n| n.symbol.is_some()))
        .then_some(declaration)
    }

    /// [`Self::static_native`]'s call: the C function, with the arguments the
    /// program wrote and no receiver.
    pub(super) fn lower_static_native(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let signature = self.snapshot.call_targets[&id].signature;
        let record = self.snapshot.signatures[signature.0 as usize].clone();
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .unwrap_or_default();
        let callee = self.native_callee(id, Some(declaration), name, &record)?;
        let (args, lent) = self.lower_call_arguments(id, &callee, arguments, None)?;
        self.finish_call(id, callee, args, lent, Some(declaration))
    }

    pub(super) fn native_method(
        &self,
        id: NodeId,
    ) -> Option<(NodeId, nts_semantic_schema::SignatureId)> {
        let target = self.snapshot.call_targets.get(&id)?;
        let declaration = target.callee?;
        let signature = &self.snapshot.signatures[target.signature.0 as usize];
        // `@ntsSelector` as well as `@ntsSymbol`: an Objective-C instance
        // method is the same shape, a method whose instance is its first
        // argument. Only the call differs.
        let tagged = self.node(declaration).native.as_ref().is_some_and(|n| {
            n.symbol.is_some()
                || n.selector.is_some()
                || n.vtable.is_some()
                || n.query.is_some()
                || n.vfunc.is_some()
                || n.listener.is_some()
        });
        // Or a method of an Objective-C class a binding declares, whose
        // receiver is the object it is called on, or the class when `static`:
        // declared in the class, or in an interface merging into it (a Swift
        // extension from another framework's package).
        let objc_member = (matches!(
            self.kind_of(declaration),
            Some(syntax::METHOD_DECLARATION | syntax::METHOD_SIGNATURE)
        ) && self.objc_class_member(declaration).is_some())
            || self.objc_protocol_member(declaration);
        (tagged && (self.is_native_instance_method(declaration, signature) || objc_member))
            .then_some((declaration, target.signature))
    }

    /// Whether `declaration` is a method of an Objective-C protocol a binding
    /// declares (`@ntsProtocol`), called on a value of the protocol's type:
    /// Swift's `dataSource?.tableView(table, numberOfRowsInSection: 0)`, a
    /// message to whatever object conforms.
    /// A method of a type the program uses and does not own, as the same-named
    /// method of the type implementing it (`SemanticSnapshot::bound_types`):
    /// `document.createElement("div")` is `nts:dom`'s `createElement`.
    ///
    /// The checker resolved the call to lib.dom.d.ts's declaration, which the
    /// frontend never decodes, so the call has no callee to read tags from; the
    /// receiver's binding is where the method is. Its members are found
    /// through the bound type's intersection, so an inherited one (`Node`'s,
    /// `EventTarget`'s) is found as the program's own call resolves it.
    pub(super) fn delegated_method(
        &self,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
        let bound = self.delegated_type(*self.snapshot.node_types.get(&receiver_node)?)?;
        self.method_of_bound(bound, &self.literal_name(member)?, arguments)
    }

    /// `handle.method(args)` as the C call `symbol(handle, args)`: the
    /// declared `this` is the C function's first parameter, and the receiver
    /// is passed there -- converted, so a `GtkToggleButton` reaches a method
    /// `GtkButton` declares. No wrapper object and no dispatch: the method
    /// *is* the C function.
    pub(super) fn lower_native_method_call(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        (declaration, signature): (NodeId, nts_semantic_schema::SignatureId),
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let record = self.snapshot.signatures[signature.0 as usize].clone();
        self.lower_native_method_call_as(
            id,
            (receiver, receiver_node),
            (declaration, record),
            member,
            arguments,
        )
    }

    /// As [`Self::lower_native_method_call`], at a signature in hand: a
    /// delegated overload's, which the snapshot does not intern.
    pub(super) fn lower_native_method_call_as(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        (declaration, record): (NodeId, nts_semantic_schema::SignatureRecord),
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        self.refuse_dropped_arguments(declaration, &record, arguments)?;
        let mut with_this = record;
        let chained = self.without_chain_absence(id, with_this.return_type);
        // A sequence the binding answers where the program reads an array
        // (`event.composedPath()`): the call is the sequence's, and the array
        // is made of it below.
        let sequence = self.sequence_for_array(id, with_this.return_type);
        // In a chain, the message's value is the method's type; the branch
        // around it makes the chain's.
        let typed = if sequence.is_some() {
            self.represent(with_this.return_type)
        } else if chained == with_this.return_type {
            None
        } else {
            self.represent(chained)
        };
        with_this.return_type = chained;
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .unwrap_or_default();
        // `list.as_IVector()`: the object as another of its interfaces.
        if let Some(iid) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.query.clone())
        {
            return self.lower_query(id, receiver, &iid, with_this.return_type, arguments);
        }
        // `button.addEventListener("click", f)`: the runtime's, over the
        // event the listener's type names.
        if let Some(direction) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.listener.clone())
        {
            return self.lower_event_listener(id, receiver, &direction, &with_this, arguments);
        }
        // `this.emit("incremented", 1)`: a signal a class the program wrote
        // declares, emitted by its id (`WithSignals` in `c:types`).
        if self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.symbol.as_deref())
            == Some("nts_gobject_emit")
        {
            return self.lower_gobject_emit(
                id,
                (receiver, receiver_node),
                declaration,
                with_this,
                arguments,
            );
        }
        // A class method is sent to the class, which the send looks up
        // itself: the receiver the program wrote is the class, as a value.
        if self
            .objc_class_member(declaration)
            .is_some_and(|member| member.is_static)
        {
            let callee = self.native_callee(id, Some(declaration), name, &with_this)?;
            let (args, lent) = self.lower_call_arguments(id, &callee, arguments, None)?;
            return self.finish_call_typed(id, callee, args, lent, Some(declaration), typed);
        }
        // An Objective-C class's method has no written `this`: it is the
        // object the method is called on, at the type the program has it.
        let this = with_this
            .this_type
            // `this` in a method of a class the program writes over a
            // handle's is the class's polymorphic `this`: its members, and
            // its representation, are the class's.
            // Present where the message is sent: `a?.b?.m()` sends `m` to
            // `a.b` as a `B`.
            .or_else(|| {
                self.snapshot
                    .node_types
                    .get(&receiver_node)
                    .map(|ty| self.class_behind(self.present_part(*ty).unwrap_or(*ty)))
            })
            .ok_or_else(|| self.unsupported(id, "a C method with no `this` type"))?;
        // Written arguments answer to the selected binding overload, not
        // the lib.dom/global signature which led us here. Keep its parameter
        // list before adding the synthetic C receiver below.
        let argument_signature = with_this.clone();
        with_this.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: this,
                optional: false,
                rest: false,
            },
        );
        let mut callee = self.native_callee(id, Some(declaration), name, &with_this)?;
        // `nts_gobject_connect` takes the instance as the `gpointer` it is in
        // C, whichever class a declaration names -- a binding's `Erased<X>`, or
        // the class a program wrote (`WithSignals`, whose `this` is the class
        // itself so that the handler's `self` is) -- so every call prints the
        // one prototype.
        if let Callee::Native(target) = &mut callee
            && target.name == "nts_gobject_connect"
            && let Some(first) = std::sync::Arc::make_mut(target).parameters.first_mut()
        {
            *first = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Void);
        }
        let (receiver, queried) = self.via_receiver(id, declaration, receiver)?;
        let callee = via_callee(callee, queried.is_some());
        let (args, lent) =
            self.bound_arguments(id, &callee, arguments, receiver, argument_signature)?;
        let answer = self.finish_call_typed(id, callee, args, lent, Some(declaration), typed)?;
        self.release_via(id, queried);
        match sequence {
            Some(sequence) => {
                let array = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "an array made of a sequence"))?;
                self.array_of_sequence(id, answer, sequence, array)
            }
            None => Ok(answer),
        }
    }

    pub(super) fn native_callee(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
        name: String,
        signature: &nts_semantic_schema::SignatureRecord,
    ) -> Result<Callee, Diagnostic> {
        self.native_callee_with(call, declaration, name, signature, None, None)
    }

    /// The message one accessor of an Objective-C property sends: the
    /// property's declaration, with the getter's or the setter's selector
    /// rather than any the declaration tags.
    pub(super) fn native_callee_sending(
        &self,
        call: NodeId,
        declaration: NodeId,
        selector: &str,
        signature: &nts_semantic_schema::SignatureRecord,
    ) -> Result<Callee, Diagnostic> {
        self.native_callee_with(
            call,
            Some(declaration),
            selector.to_owned(),
            signature,
            Some(selector.to_owned()),
            None,
        )
    }

    /// [`Self::native_callee`], with the selector given when `selector` is,
    /// and otherwise the one the declaration's `@ntsSelector` names; and sent
    /// to the class `class_send` names when it names one, rather than to the
    /// receiver the declaration's kind implies.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn native_callee_with(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
        name: String,
        signature: &nts_semantic_schema::SignatureRecord,
        selector: Option<String>,
        class_send: Option<String>,
    ) -> Result<Callee, Diagnostic> {
        // `@ntsSymbol`: the C function a declaration binds, when its own name
        // is another -- one typed view per GObject signal of the one
        // `g_signal_connect_data`.
        let symbol = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.symbol.clone());
        if let Some(symbol) = &symbol
            && !crate::hir::native::is_c_identifier(symbol)
        {
            return Err(self.unsupported(
                call,
                "@ntsSymbol names one C function, as in `@ntsSymbol g_signal_connect_data`",
            ));
        }
        let name = symbol
            .or_else(|| declaration.and_then(|decl| self.declared_name(decl)))
            .unwrap_or(name);
        let abi = declaration.and_then(|decl| {
            self.snapshot.nodes[decl.0 as usize]
                .native
                .as_ref()
                .and_then(|n| n.abi.as_deref())
        });
        // An explicit request for a backend-owned intrinsic. Backends resolve
        // these against their closed tables and refuse unavailable names;
        // this does not authorize inventing an external C prototype.
        if abi == Some("intrinsic") {
            return Ok(Callee::External(name));
        }
        let ParameterTags { throws, defaults } = self.parameter_tags(call, declaration)?;
        let declared = declaration.and_then(|decl| {
            self.node(decl)
                .native
                .as_ref()
                .and_then(|n| n.selector.clone())
        });
        // A declaration's `@ntsThrows` is its own selector's: the `+alloc` a
        // throwing constructor sends first takes no error slot.
        let throws = throws.filter(|_| {
            selector.as_deref().is_none_or(|sent| {
                declared
                    .as_deref()
                    .is_none_or(|own| own.trim_start_matches('+') == sent)
            })
        });
        let selector = selector.or(declared);
        let (throws, hidden) = split_hidden_throws(throws, selector.is_some(), signature);
        let hresult = self.hresult_shape(call, declaration)?;
        let references = self.reference_tags(call, declaration)?;
        let mut native = crate::hir::native::Function::from_signature(
            self.snapshot,
            name,
            signature,
            abi,
            throws
                .as_ref()
                .map(|(slot, converter)| (slot.as_str(), converter.as_str())),
            &defaults,
            (hresult, &references),
        )
        .map_err(|why| self.unsupported(call, &why))?;
        if let Some(converter) = hidden {
            append_error_slot(&mut native, converter);
        }
        // The module whose `@ntsHeader` covers this declaration, recorded where
        // the declaration node is still in hand. `collect_native_headers` reads
        // it, so a program carries the headers it reaches rather than every one
        // in the snapshot.
        native.declared_at = declaration.and_then(|decl| self.declaring_module(decl));
        // Only an explicit semantic operation can request a generated thunk.
        // A header function with the same spelling retains its declaration.
        native.thunk = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|metadata| metadata.intrinsic.as_deref())
            .map(crate::hir::native::GObjectThunk::from_intrinsic)
            .transpose()
            .map_err(|why| self.unsupported(call, &why))?
            .flatten();
        if let Some(thunk) = &native.thunk {
            native.name = thunk.symbol();
            native.declared_at = None;
            if let Some(object) = native.parameters.first_mut() {
                *object = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Void);
            }
        }
        // A virtual function is a class struct's slot, overridden by a
        // subclass and reached through the class; it has no symbol, so a
        // direct call would link one that does not exist.
        if self.chaining_up.is_none()
            && let Some(slot) = declaration
                .and_then(|decl| self.node(decl).native.as_ref())
                .and_then(|n| n.vfunc.as_deref())
        {
            return Err(self.unsupported(
                call,
                &format!("a direct call of a GObject virtual function (`{slot}`), which a subclass overrides and nothing calls by name"),
            ));
        }
        if let Some(decl) = declaration {
            native.frameworks = self.declared_names(call, decl, LinkTag::FRAMEWORK)?;
            native.libraries = self.declared_names(call, decl, LinkTag::LIBRARY)?;
            native.vtable = self.slot_of(
                call,
                decl,
                signature,
                selector.is_some() || symbol_tagged(self, decl),
                &mut native,
            )?;
        }
        self.make_call(
            call,
            declaration,
            &mut native,
            signature,
            (selector, class_send),
        )?;
        self.refuse_unbridged(call, &native)?;
        if let Some(free) = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.free.as_deref())
        {
            let Some(string) = native.returns_string.as_mut() else {
                return Err(self.unsupported(call, "@ntsFree names what releases a returned string, and this function does not return one"));
            };
            if !crate::hir::native::is_c_identifier(free) {
                return Err(self.unsupported(
                    call,
                    "@ntsFree names one C function, as in `@ntsFree g_free`",
                ));
            }
            string.free = Some(free.to_owned());
            // A string the caller frees is `char *` in C, and a borrowed one
            // `const char *`: that is how C libraries spell whose it is, GLib's
            // `gchar *` for transfer-full among them. The witness compares.
            // And an owned array is `char **` for the same reason, GLib's
            // `gchar **`, which the free function is declared taking.
            native.result = if string.array {
                let char = crate::hir::native::Pointee::Scalar(crate::hir::native::Scalar::Char);
                crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Pointer(Box::new(
                    char,
                )))
            } else {
                crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Scalar(
                    crate::hir::native::Scalar::Char,
                ))
            };
        }
        if let Some(names) = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.no_escape.as_ref())
        {
            if names.is_empty() {
                return Err(self.unsupported(
                    call,
                    "@ntsNoEscape needs at least one native-pointer parameter",
                ));
            }
            for name in names {
                let slot = signature
                    .parameters
                    .iter()
                    .position(|p| p.name == *name)
                    .and_then(|ts| native.c_index(ts))
                    .ok_or_else(|| {
                        self.unsupported(call, &format!("@ntsNoEscape names no parameter `{name}`"))
                    })?;
                // A *callback* takes the same contract, and means the same
                // thing by it: nothing of this argument outlives the call. For
                // a pointer that is "no address into it is kept, freed or
                // invalidated"; for a function pointer it is "not called after
                // this returns". Both are what lets the caller pass storage,
                // or a bridge, that it owns for the duration and no longer.
                if !matches!(
                    native.parameters[slot],
                    crate::hir::native::Type::Pointer(_) | crate::hir::native::Type::FnPointer(_)
                ) || native.retention[slot] == crate::hir::native::Retention::NotRetained
                {
                    return Err(self.unsupported(
                        call,
                        "@ntsNoEscape needs distinct native-pointer or callback parameters",
                    ));
                }
                native.retention[slot] = crate::hir::native::Retention::NotRetained;
            }
        }
        // A `CStrings` array is lent for the call and freed after it, so a
        // callee that kept it would read freed memory -- which no test in
        // either profile reaches. The binding says it does not, or the call
        // is refused: that is the direction this check fails safe in.
        if native.slots().any(|(slot, role, _)| {
            matches!(
                role,
                crate::hir::native::Role::Strings
                    | crate::hir::native::Role::HStrings
                    | crate::hir::native::Role::Bytes(_)
                    | crate::hir::native::Role::Handles
            ) && native.retention[slot] != crate::hir::native::Retention::NotRetained
        }) {
            return Err(self.unsupported(call, "a `CStrings`, `CBytes` or `CHandles` parameter without `@ntsNoEscape`, which is what says C does not keep the array it is lent"));
        }
        Ok(Callee::Native(std::sync::Arc::new(native)))
    }

    /// What `@ntsVtable` and `@ntsFactory` say of a declaration: the slot of
    /// the receiver's table the call goes through, the method the binding says
    /// that slot is, and for a static the runtime class whose factory receives
    /// it -- which then becomes the call's first parameter, as a method's
    /// instance is.
    ///
    /// **The method name is checked against the declaration's**, so that a
    /// slot and a method cannot be edited apart: `@ntsVtable 7 Parse` on
    /// `Parse` is refused rather than a quiet call to `TryParse`. What the
    /// slot *is* is the metadata's, and `bind-winmd` writes both from it.
    /// The slot a call goes through: the one the lowering forces -- a
    /// property's getter or setter, `super.m()` in an override -- or the one
    /// the declaration's `@ntsVtable` names. A forced slot of a static
    /// property is its class's factory's, whose receiver the call supplies,
    /// as a static method's is.
    fn slot_of(
        &self,
        call: NodeId,
        decl: NodeId,
        signature: &nts_semantic_schema::SignatureRecord,
        otherwise_bound: bool,
        native: &mut crate::hir::native::Function,
    ) -> Result<Option<crate::hir::native::Vtable>, Diagnostic> {
        let Some((slot, method)) = &self.forced_slot else {
            return self.vtable_of(call, decl, signature, otherwise_bound, native);
        };
        let factory = self.factory_of(call, decl)?;
        if factory.is_some() {
            native.prepend_receiver(crate::hir::native::Type::Pointer(
                crate::hir::native::Pointee::Void,
            ));
        }
        Ok(Some(crate::hir::native::Vtable {
            slot: *slot,
            method: method.clone(),
            factory,
        }))
    }

    fn vtable_of(
        &self,
        call: NodeId,
        decl: NodeId,
        signature: &nts_semantic_schema::SignatureRecord,
        otherwise_bound: bool,
        native: &mut crate::hir::native::Function,
    ) -> Result<Option<crate::hir::native::Vtable>, Diagnostic> {
        let tags = self.node(decl).native.as_deref();
        let Some(text) = tags.and_then(|n| n.vtable.as_deref()) else {
            if tags.is_some_and(|n| n.factory.is_some()) {
                return Err(self.unsupported(
                    call,
                    "`@ntsFactory` without the `@ntsVtable` slot it calls through the factory",
                ));
            }
            return Ok(None);
        };
        let words: Vec<&str> = text.split_whitespace().collect();
        let [slot, method] = words.as_slice() else {
            return Err(self.unsupported(call, "@ntsVtable names the slot and the method the metadata gives it, as in `@ntsVtable 6 Parse`"));
        };
        let slot: u32 = slot
            .parse()
            .map_err(|_| self.unsupported(call, "@ntsVtable naming a slot that is not a number"))?;
        if slot < 3 {
            return Err(self.unsupported(call, "@ntsVtable on slots 0 to 2, which are IUnknown's and called by the compiler itself"));
        }
        if otherwise_bound {
            return Err(self.unsupported(
                call,
                "@ntsVtable beside @ntsSymbol or @ntsSelector, which name another way to call it",
            ));
        }
        // The idiomatic surface names a slot's method in camelCase
        // (`getFolderFromPathAsync` for `GetFolderFromPathAsync`), by the one
        // rule `bind-winmd` writes it by; any other name is a disagreement.
        // A constructor has no name to disagree with: it is the class's
        // factory method, whichever the metadata calls it.
        let declared = self.declared_name(decl);
        if self.kind_of(decl) != Some(syntax::CONSTRUCTOR)
            && declared.as_deref() != Some(*method)
            && declared.as_deref() != Some(crate::hir::native::js_name(method).as_str())
        {
            return Err(self.unsupported(
                call,
                &format!("@ntsVtable {slot} {method} on a declaration of another name: the slot's method and the declaration disagree"),
            ));
        }
        if native.variadic.is_some() || native.convention != crate::hir::native::Convention::C {
            return Err(self.unsupported(call, "@ntsVtable on a variadic or non-C function"));
        }
        let factory = self.factory_of(call, decl)?;
        let method_of_instance = self.is_native_instance_method(decl, signature);
        match (&factory, method_of_instance) {
            (None, false) => {
                return Err(self.unsupported(call, "@ntsVtable on a function with neither an instance (`this`) nor an @ntsFactory to call it on"));
            }
            (Some(_), true) => {
                return Err(self.unsupported(
                    call,
                    "@ntsFactory on a method, whose instance is already its receiver",
                ));
            }
            // The factory is the receiver: a first parameter the call supplies.
            (Some(_), false) => {
                native.prepend_receiver(crate::hir::native::Type::Pointer(
                    crate::hir::native::Pointee::Void,
                ));
            }
            (None, true) => {}
        }
        Ok(Some(crate::hir::native::Vtable {
            slot,
            method: (*method).to_owned(),
            factory,
        }))
    }

    /// `native` as the message `selector` names, where it names one, and
    /// otherwise as the C function it is: a C function's `BridgedString`,
    /// Swift's `String` where the header says `NSString *`, still bridged.
    fn make_call(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
        native: &mut crate::hir::native::Function,
        signature: &nts_semantic_schema::SignatureRecord,
        (selector, class_send): (Option<String>, Option<String>),
    ) -> Result<(), Diagnostic> {
        if let (Some(decl), Some(selector)) = (declaration, selector) {
            return self.make_message(call, decl, native, signature, selector, class_send);
        }
        bridge_strings(native, signature, self.snapshot, StringsBridged::Branded);
        Ok(())
    }

    /// `native` as the Objective-C message `selector` names: its closures,
    /// strings and arrays bridged as Swift's are, and the ownership ARC's
    /// method families give its result and receiver.
    fn make_message(
        &self,
        call: NodeId,
        decl: NodeId,
        native: &mut crate::hir::native::Function,
        signature: &nts_semantic_schema::SignatureRecord,
        selector: String,
        class_send: Option<String>,
    ) -> Result<(), Diagnostic> {
        bridge_blocks(native, signature, self.snapshot);
        let send = self.objc_send(call, decl, native, selector, class_send)?;
        bridge_strings(native, signature, self.snapshot, StringsBridged::Plain);
        // A family is a claim about the returned *object*, so it applies
        // only where the result is a pointer, as in clang: a `newValue`
        // returning a number owns nothing.
        let pointer = match &native.result {
            crate::hir::native::Type::Pointer(pointee) => Some(pointee),
            _ => None,
        };
        native.returns_owned =
            pointer.is_some() && crate::hir::native::Send::returns_owned(&send.selector);
        // An object handed over (+1) that the program does not count is
        // an object nobody will release. The binding has to say what it
        // is, which is `ObjcClass`, not `Class`.
        if native.returns_owned && pointer.is_some_and(|pointee| pointee.counting().is_none()) {
            return Err(self.unsupported(
                call,
                &format!(
                    "`{}` hands back an object the caller owns, as a handle the program does not count; declare its class with `ObjcClass` from \"objc:types\", not `Class`",
                    send.selector
                ),
            ));
        }
        if send.class.is_none() && crate::hir::native::Send::consumes_receiver(&send.selector) {
            native.consumes = vec![0];
        }
        // A record's or a number's address -- Swift's
        // `UnsafeMutablePointer<NSRange>` or `<CGFloat>`, its `&range` -- is
        // the message's to read or write during the send and no longer, which
        // is what Swift's own conversion promises: a `local<NSRange>()` may be
        // passed.
        // Grown only: a record result's destination is one entry past the
        // parameters, and is not retained either.
        if native.retention.len() < native.parameters.len() {
            native.retention.resize(
                native.parameters.len(),
                crate::hir::native::Retention::Unknown,
            );
        }
        for (at, ty) in native.parameters.iter().enumerate() {
            if matches!(
                ty,
                crate::hir::native::Type::Pointer(
                    crate::hir::native::Pointee::Record(_) | crate::hir::native::Pointee::Scalar(_)
                )
            ) {
                native.retention[at] = crate::hir::native::Retention::NotRetained;
            }
        }
        native.send = Some(send);
        Ok(())
    }

    /// An array a C function would take or return as Swift's `[T]`, which only
    /// a message can: the `NSArray` it crosses as is a Foundation object.
    fn refuse_unbridged(
        &self,
        call: NodeId,
        native: &crate::hir::native::Function,
    ) -> Result<(), Diagnostic> {
        let bridged = native.returns_array.is_some()
            || native.returns_dictionary.is_some()
            || native.returns_set.is_some()
            || native.roles.iter().any(|role| match role {
                crate::hir::native::Role::NSArray(_)
                | crate::hir::native::Role::NSDictionary(_)
                | crate::hir::native::Role::NSSet(_) => true,
                crate::hir::native::Role::Label { inner, .. } => matches!(
                    **inner,
                    crate::hir::native::Role::NSArray(_)
                        | crate::hir::native::Role::NSDictionary(_)
                        | crate::hir::native::Role::NSSet(_)
                ),
                _ => false,
            });
        if native.send.is_none() && bridged {
            return Err(self.unsupported(call, "an array of objects or strings, which crosses an Objective-C message as an `NSArray` and a C function as nothing"));
        }
        Ok(())
    }
}
