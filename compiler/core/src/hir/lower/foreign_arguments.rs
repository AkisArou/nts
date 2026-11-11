//! Lower ABI arguments, including labels, parameter slots, loans, and bounded byte buffers.

use super::{
    Argument, BinOp, Callee, Diagnostic, Facts, FuncBuilder, HirType, ManagedType, NodeId, OpKind,
    Origin, Param, ParamShape, Terminator, TypeId, TypeKind, ValueId, elision_patterns, in_a_slot,
    named_representation, syntax,
};

pub(super) struct ParameterTags {
    /// `@ntsThrows error convert`: the slot parameter and the converter.
    pub(super) throws: Option<(String, String)>,
    /// `@ntsDefault flags=0 cancellable=null`: what an omitted argument is.
    pub(super) defaults: Vec<(String, crate::hir::native::ParameterDefault)>,
}

/// Something lent to a native call for its duration, given back once the call
/// returns.
#[derive(Debug, Clone)]
pub(super) enum Lent {
    /// A C string, beside the string it was made from and how it was encoded.
    String {
        string: ValueId,
        pointer: ValueId,
        encoding: crate::hir::native::Encoding,
    },
    /// The slot an `@ntsHresult` call writes its result to, read after it:
    /// the call's value, or the field of it an `@ntsHresult out` names.
    Result {
        slot: ValueId,
        written: crate::hir::native::Written,
        field: Option<std::sync::Arc<str>>,
    },
    /// Where an `@ntsHresult` call writes a received array's element count,
    /// read with the `Result` after it (`Role::ReceivedCount`).
    Count { slot: ValueId },
    /// A `char **` made from a `string[]`.
    Strings { pointer: ValueId },
    /// A block of `HSTRING`s lent from a `string[]`, one per element.
    HStrings { array: ValueId, block: ValueId },
    /// A block of structs copied from an array of objects for the call
    /// (`Role::Records`), from COM's task allocator: freed after it.
    Block { block: ValueId },
    /// A block of the call's that it fills for `array` (`Role::FilledStrings`,
    /// `Role::FilledRecords`): copied into the array after it, and freed.
    Filled { array: ValueId, block: ValueId },
    /// A `Uint8Array` whose bytes C reads in place: nothing to free, and the
    /// view must outlive the call.
    View { view: ValueId },
    /// A string a C struct's `StringView` field points at: nothing to free,
    /// and the string must outlive the call, which reads only the struct.
    Borrowed { string: ValueId },
    /// A `CHandles` array whose element block C was lent: given back after
    /// the call (`nts_array_unlend`), which is its last use, so the array
    /// outlives C's read of the block. Defensive under today's placement,
    /// which releases a temporary at the end of its statement; necessary once
    /// a release moves to the last read (see the header).
    Array { array: ValueId },
    /// An array of objects asked, element by element, for the interface a
    /// Windows Runtime call takes (`nts_com_query_array`): the block of the
    /// references that made, given back after the call with the array.
    Queried { array: ValueId, block: ValueId },
    /// The compiler's own error slot, for an `@ntsThrows` parameter the caller
    /// left out: read after the call, and a failure reported there thrown.
    Error { slot: ValueId, converter: String },
    /// A closure's context, for a `ScopedClosure`.
    Closure { context: ValueId },
    /// A boxed record whose pointer C reads during the call: the box must
    /// outlive it (`nts_boxed_unlend`), as a view lent in place does.
    Boxed { boxed: ValueId },
    /// A delegate object the call was passed: the *caller's* reference, given
    /// back after the call. That ends the delegate only if the callee kept no
    /// reference of its own. An event's `add_` keeps one, so the delegate
    /// outlives the call and lives until the source lets go (`remove_`, or
    /// the source's own end), and the closure with it. The one reference this
    /// gives back is the one `nts_com_delegate` made, whatever the callee
    /// does.
    Delegate { object: ValueId },
    /// The slot a composable factory wrote its inner object to, released
    /// after the call when it was written: nothing of the program holds it.
    Inner { slot: ValueId },
    /// That inner object, taken from its slot in the call's own block
    /// (`finish_hresult_call`) and released on both paths after it.
    Taken { object: ValueId },
    /// A string, number or boolean boxed for an `IInspectable` parameter
    /// (`Role::Box`): the runtime's reference, given back after the call,
    /// which leaves the box to whatever the callee kept of it.
    Box { object: ValueId },
}

impl FuncBuilder<'_> {
    /// The conversions into a native pointer that are not refusals: a boxed
    /// record's storage, `null`, any native pointer to `void *`, and a
    /// record's fields held in an object. `None` for anything else, which
    /// [`Self::coerce_arm`] goes on to convert or refuse.
    pub(super) fn coerce_to_native_pointer(
        &mut self,
        value: ValueId,
        have: &HirType,
        want: &HirType,
        id: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        // A boxed record where C takes the struct's pointer: the box's.
        if *have == HirType::Managed(ManagedType::Object(TypeId(crate::hir::BOXED_RECORD)))
            && matches!(want, HirType::NativePointer(_))
        {
            let origin = self.origin(id);
            return Some(Ok(self.unbox_record(value, want, &origin)));
        }
        if matches!(want, HirType::NativePointer(_))
            && matches!(self.values[value.0 as usize].kind, OpKind::ConstNull)
        {
            let origin = self.origin(id);
            return Some(Ok(self.push(OpKind::ConstNull, want.clone(), origin)));
        }
        // Any native pointer converts to `void *`, which is what C does at the
        // call and the only pointer conversion it does without being asked. One
        // direction: `void *` back to a typed pointer is where the mistakes
        // live, and it stays refused here. TypeScript refuses it too, since
        // `Ptr<void>` is not assignable to `Ptr<Uint8>` -- this is the
        // second of the two, not the only one.
        //
        // A `Convert` rather than a relabel: the address is unchanged, but the
        // verifier checks call argument types, so the value reaching the call
        // has to *be* of the parameter's type rather than merely share its
        // representation.
        if let (HirType::NativePointer(from), HirType::NativePointer(to)) = (have, want)
            && from.converts_to(to)
        {
            let origin = self.origin(id);
            // A Windows Runtime object as another of its interfaces is a
            // different pointer, which the object answers `QueryInterface`
            // for -- not the address relabelled, which reads the wrong table.
            if let (crate::hir::native::Pointee::Opaque(from), crate::hir::native::Pointee::Opaque(to)) = (from, to)
                && from.family == crate::hir::native::Family::Com
                && to.family == crate::hir::native::Family::Com
                && from.tag != to.tag
                // Every Windows Runtime interface begins with `IInspectable`'s
                // table, so any of them is one as it is: the root every
                // interface's chain ends in is a relabel, not a query.
                && to.tag != "IInspectable"
            {
                let Some(iid) = self.hierarchy.com_iids.get(&to.tag).cloned() else {
                    return Some(Err(self.unsupported(id, &format!("a Windows Runtime object as `{}`, an interface no binding asks for by IID", to.tag))));
                };
                let [low, high] = self.iid_arguments(&iid, &origin);
                return Some(Ok(self.runtime_call(
                    "nts_com_query",
                    vec![value, low, high],
                    want.clone(),
                    origin,
                )));
            }
            return Some(Ok(self.push(OpKind::Convert(value), want.clone(), origin)));
        }
        // A record's fields held in an object, where C takes the record by
        // value: `Fields<T>` in a variable.
        if matches!(want, HirType::NativePointer(view) if matches!(view.viewed(), crate::hir::native::Pointee::Record(_)))
            && matches!(have, HirType::Managed(ManagedType::Object(_)))
        {
            return Some(self.native_record_from_object(id, value, want.clone()));
        }
        // **`{}` where C takes a record**: a literal that writes no member,
        // which is built as an empty object and erased
        // (blockers/an-empty-object-literal), so it arrives here as no object
        // a field can be read from -- `new CustomEvent("x", {})`, `new
        // Request(url, {})`, an options bag with nothing in it, refused as a
        // managed value (the Chromium lane's
        // lib-dom-an-empty-literal-for-a-dictionary). Copied, every field is
        // the zero it was left out as, so it is the record's zeroed storage.
        // Only the literal: an erased value from anywhere else may hold
        // members, which zeroes would drop.
        if matches!(want, HirType::NativePointer(view) if matches!(view.viewed(), crate::hir::native::Pointee::Record(_)))
            && *have == HirType::Erased
            && self.kind_of(id) == Some(syntax::OBJECT_LITERAL_EXPRESSION)
            && self.syntax_children_of(id).is_empty()
        {
            let origin = self.origin(id);
            let storage = self.push(OpKind::NativeLocal { count: 1 }, want.clone(), origin);
            return Some(Ok(storage));
        }
        None
    }

    /// The same again, told whether the merge's **other** arm is the
    /// short-circuit's `undefined`. See [`Self::absence_at_excluding`].
    /// Why these two managed types cannot share a pointer: one keeps its members
    /// as fields at fixed offsets and the other as keys looked up at run time.
    ///
    /// `coerce_arm`'s managed-to-managed branch checks the pairs it was written
    /// for -- two arrays whose elements differ in width, and two structs that
    /// disagree about where a shared field is -- and then hands the pointer back
    /// as an upcast. That is true of those pairs and false of an object wanted
    /// where a `Record<string, V>` is: the pointer arrives as an `NtsMap` and
    /// every keyed read finds nothing.
    ///
    /// The React lane found it, and the symptom depends on where the value lives.
    /// `const mixed = { children: ["a", 1] }` handed to
    /// `describe(props: Record<string, unknown>)` reads **undefined** at module
    /// scope and **segfaults inside a function**, with no diagnostic either way.
    /// An *annotated* literal is built as a table from the start by
    /// `lower_table_literal`, which is why an inline argument -- contextually
    /// typed, so built as what it is wanted as -- never showed it. Their sweep is
    /// the other half of the evidence: all five operations React needs from a
    /// props record (`for...in` with `Object.hasOwn`, `in`, `Object.keys`, a
    /// spread, a keyed read) agree with node on an annotated `Record`, so the
    /// table machinery is sound and this conversion is the whole defect.
    ///
    /// Refused rather than converted, for the reason both arms above give and the
    /// spread path already gives in as many words -- "a spread of something that
    /// is not a table into a table". A conversion is a copy, `===` then answers
    /// differently, and building the table would mean walking the layout's names
    /// into `nts_map_new`/`nts_map_set`, which is `lower_table_literal`'s job and
    /// a feature of its own.
    ///
    /// **And an array beside an object laid out as fields**, for the same reason
    /// one container over: an array keeps its elements in a block behind a
    /// length, so an `NtsArray *` is not a pointer to a struct and the reverse.
    /// It went unrefused and arrived unchanged, and the verifier stopped the
    /// whole program at the store -- `g = [1, 2, 3]` into a module variable
    /// declared `{ length: number }`, whose one slot cannot be specialized as
    /// a parameter's call can, or a tuple whose positions have mixed storage.
    pub(super) fn crossing_storage(&self, have: &HirType, want: &HirType) -> Option<String> {
        let keyed = |ty: &HirType| {
            matches!(
                ty,
                HirType::Managed(ManagedType::Table(_, _) | ManagedType::Map(_, _))
            )
        };
        let laid_out = |ty: &HirType| matches!(ty, HirType::Managed(ManagedType::Object(_)));
        let array = |ty: &HirType| matches!(ty, HirType::Managed(ManagedType::Array(_)));
        // The article belongs to the phrase, not to the format: a name comes back
        // as ``a `Thing` `` and the nameless cases carry their own, so the
        // sentence reads the same either way.
        let named = |ty: &HirType| match ty {
            HirType::Managed(ManagedType::Object(at))
                if matches!(
                    self.snapshot.types.get(at.0 as usize).map(|t| &t.kind),
                    Some(TypeKind::Tuple(_))
                ) =>
            {
                "a tuple laid out as fields".to_owned()
            }
            HirType::Managed(ManagedType::Object(at)) => self.name_of_type(*at).map_or_else(
                || "an anonymous object type".to_owned(),
                |name| format!("a `{name}`"),
            ),
            HirType::Managed(ManagedType::Array(_)) => "an array".to_owned(),
            _ => "a table".to_owned(),
        };
        if (laid_out(have) && array(want)) || (array(have) && laid_out(want)) {
            let (from, to) = (named(have), named(want));
            return Some(format!(
                "{from} where {to} is wanted -- one keeps its elements in a block behind a \
                 length and the other its members as fields at fixed offsets, so a pointer to \
                 either is not a pointer to the other"
            ));
        }
        if !((laid_out(have) && keyed(want)) || (keyed(have) && laid_out(want))) {
            return None;
        }
        let (from, to) = (named(have), named(want));
        Some(format!(
            "{from} where {to} is wanted -- one keeps its members as fields at fixed offsets \
             and the other as keys looked up at run time, so a pointer to either is not a \
             pointer to the other and every read through it finds nothing"
        ))
    }

    pub(super) fn coerce_to_parameter(
        &mut self,
        call: NodeId,
        at: usize,
        value: ValueId,
        argument: NodeId,
        argument_ty: Option<TypeId>,
    ) -> Result<ValueId, Diagnostic> {
        let Some(want) = self.parameter_representation(call, at) else {
            return Ok(value);
        };
        // An array of handles lent to C (`CHandles`) crosses as its element
        // block, which C reads as pointers to objects whatever class the
        // program's array is of: a `GtkLabel[]` where `readonly GObject[]` is
        // declared is the same block, and converting it would be a copy.
        // `readonly` is what makes that sound -- nothing writes a `GObject`
        // into the label array through it -- and `Role::Handles` refuses an
        // array whose elements are not handles.
        if let HirType::Managed(ManagedType::Array(element)) = &self.values[value.0 as usize].ty
            && matches!(
                **element,
                HirType::NativePointer(crate::hir::native::Pointee::Opaque(_))
            )
            && self.lends_handles(call, at)
        {
            return Ok(value);
        }
        if self.fills_records(call, at) {
            return Ok(value);
        }
        // A tuple position has its own type. Erase it here, before the
        // concrete value disappears, rather than attributing its absence to
        // the tuple object used to read it. Already-erased values keep their tag.
        if want == HirType::Erased && argument_ty.is_some() {
            return self.erase_uniform_argument(value, argument, Some((argument, argument_ty)));
        }
        self.coerce(value, &want, argument)
    }

    /// What the native call being lowered (`omitting_for`, when it is `call`)
    /// wants its written argument `at` as, where the slot decides it: a string
    /// for a string slot (`Role::String`), and the record for one C takes by
    /// value -- which an object literal is built as, and a held object copied
    /// into (`native_record_from_object`).
    fn native_slot(&self, call: NodeId, at: usize) -> Option<HirType> {
        let (target, spelled, lowering) = self.omitting_for.as_ref()?;
        if *lowering != call {
            return None;
        }
        let (slot, role, _) = target
            .slots()
            .find(|(_, _, fed)| *fed == Some(at + spelled))?;
        match role {
            crate::hir::native::Role::String(_) => Some(HirType::Managed(ManagedType::String)),
            crate::hir::native::Role::Plain
                if matches!(target.parameters[slot], crate::hir::native::Type::Record(_)) =>
            {
                Some(target.parameters[slot].representation())
            }
            _ => None,
        }
    }

    /// Whether the call's `at`th parameter is `CHandles`.
    pub(super) fn lends_handles(&self, call: NodeId, at: usize) -> bool {
        self.parameter_type_id(call, at)
            .is_some_and(|ty| crate::hir::native::lends_handles(self.snapshot, ty))
    }

    /// Whether the call's `at`th parameter is an array the callee fills with
    /// records (`FilledArray<T>`). Each struct C writes is copied into a new
    /// object of the array's *own* element type (`copy_filled`), and C writes
    /// while only the program reads: so the array crosses as the program holds
    /// it, with the kinds its own type wrote or none. Converted to the
    /// declared `Copied<T>[]` instead, an inferred `[{ x: 0, y: 0 }]` was
    /// refused for holding records whose fields were not written as C's.
    pub(super) fn fills_records(&self, call: NodeId, at: usize) -> bool {
        self.parameter_type_id(call, at)
            .is_some_and(|ty| crate::hir::native::fills_records(self.snapshot, ty))
    }

    /// How a call's `at`th parameter is represented, from the resolved
    /// signature rather than from the argument.
    ///
    /// **Unless this call was specialised**, in which case the copy's parameter
    /// is what the argument has to match. The declaration still says `Named`
    /// and the copy takes a `Thing`; coercing to the declaration would meet the
    /// prefix check that the copy exists to avoid.
    pub(super) fn parameter_representation(&self, call: NodeId, at: usize) -> Option<HirType> {
        // **A native slot decides what its argument is, whatever declared the call.**
        // A lib.dom global or member a binding implements is resolved by the
        // checker to lib.dom's declaration, which can be wider than the
        // binding's: `alert(message?: any)`, `fetch(input: RequestInfo | URL)`.
        // Lowered expecting that, a string argument was erased on its way to
        // `nts_dom_Window_fetch_1`'s `StringView` and refused there as "a value
        // that is not a string". The slot the argument feeds is the truth, and
        // the one answer both lowering and coercion read; a value that really
        // is not a string still meets `coerce`'s refusal. A record C takes by
        // value is the same question: `fetch(url, { keepalive: true })` passed
        // lib.dom's `RequestInit` object where `nts_dom_Window_fetch_2` takes
        // the struct -- invalid HIR -- while `window.fetch(...)` compiled (the
        // Chromium lane's lib-dom-bare-global-with-a-dictionary).
        if let Some(slot) = self.native_slot(call, at) {
            return Some(slot);
        }
        if self.parameter_entry_for_call(call).is_some()
            && self.declared_default(call, at).is_some()
        {
            return Some(HirType::Erased);
        }
        // The callee erased an elision pattern nothing annotates, whatever its
        // checker type says; the argument is erased to meet it.
        if self
            .declared_parameter(call, at)
            .is_some_and(|(parameter, _)| elision_patterns::takes_any_iterable(self, parameter))
        {
            return Some(HirType::Erased);
        }
        if let Some(bound) = self
            .calls
            .structural(call)
            .and_then(|(_, retyped)| retyped.get(&u32::try_from(at).unwrap_or(u32::MAX)))
        {
            return Some(bound.clone());
        }
        let ty = self.parameter_type_id(call, at)?;
        // `object` at a call to a native declaration is C's `void *`: any
        // handle converts to it, and a managed value is refused by `coerce`,
        // which is what keeps a TypeScript object's heap address from C.
        //
        // Two conditions, each the one the rest of the compiler already uses,
        // because each was once got wrong here by asking a nearby question:
        //
        // - **Native** is what `lower_call` means by it: a `function` this
        //   program declares and does not define. "No body" alone is not that
        //   -- an interface's method signature has none either, and reading
        //   it as C refused `hook.init(…, resource)` in `async_hooks.emitInit`.
        // - **The C convention** is what `native::Function::from_signature`
        //   maps `object` to `void *` under: no `@ntsAbi`. Under
        //   `@ntsAbi managed` the object itself is passed, which is what
        //   `nts_on_collected(resource, …)` takes.
        let in_c = self
            .snapshot
            .call_targets
            .get(&call)
            .and_then(|target| target.callee)
            .is_some_and(|declaration| {
                let function = self.kind_of(declaration) == Some(syntax::FUNCTION_DECLARATION)
                    && !self.defines(declaration);
                // And a C method a binding declares on a handle, which
                // `native_method` lowers to its C function.
                let method = self.native_method(call).is_some();
                (function || method)
                    && self
                        .node(declaration)
                        .native
                        .as_ref()
                        .and_then(|n| n.abi.as_deref())
                        .is_none()
            });
        if in_c && crate::hir::native::is_object_pointer(self.snapshot, ty) {
            return Some(HirType::NativePointer(crate::hir::native::Pointee::Void));
        }
        // `CStrings` / `CBytes` / `CHandles`: the argument is the `string[]`,
        // the `Uint8Array` or the `readonly H[]` the markers are intersected
        // with, which the call converts or borrows; the markers have no
        // representation of their own.
        if in_c && let Some(argument) = crate::hir::native::native_array_argument(self.snapshot, ty)
        {
            return Some(argument);
        }
        // An optional C pointer -- `error?: Ptr<GError | null> | null`, an
        // `@ntsThrows` slot -- is the pointer: absent is NULL, as `null` is.
        if in_c
            && let Some(TypeKind::Union(members)) = self
                .snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
            && members.iter().any(|member| {
                matches!(
                    self.snapshot.types.get(member.0 as usize).map(|r| &r.kind),
                    Some(TypeKind::Undefined)
                )
            })
            && let Some(pointer) = members
                .iter()
                .find_map(|member| match self.represent(*member) {
                    Some(pointer @ HirType::NativePointer(_)) => Some(pointer),
                    _ => None,
                })
        {
            return Some(pointer);
        }
        // **`in_a_slot`, for the same reason the declaration applies it**: a
        // parameter has to have a width because the caller passes it
        // positionally, and the two sides of a call are one calling convention.
        // Without it here, `run(1, value)` inside `request<void>` coerced an
        // erased value to the `Void` the signature's type id still said, and
        // refused as `an erased value where a concrete representation is
        // wanted` -- one derivation of a convention disagreeing with the other.
        self.represent(ty).map(in_a_slot)
    }

    /// What a foreign declaration's tags say about its parameters.
    pub(super) fn parameter_tags(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
    ) -> Result<ParameterTags, Diagnostic> {
        let tags = declaration.and_then(|decl| self.node(decl).native.as_ref());
        let throws = match tags.and_then(|n| n.throws.as_deref()).map(|text| text.split_whitespace().collect::<Vec<_>>()) {
            None => None,
            Some(words) => match words.as_slice() {
                [slot, converter] => Some(((*slot).to_owned(), (*converter).to_owned())),
                _ => return Err(self.unsupported(call, "@ntsThrows names the error parameter and its converter, as in `@ntsThrows error nts_gerror_take_message`")),
            },
        };
        let defaults = tags
            .and_then(|n| n.defaults.as_deref())
            .map(crate::hir::native::parse_defaults)
            .transpose()
            .map_err(|why| self.unsupported(call, &why))?
            .unwrap_or_default();
        Ok(ParameterTags { throws, defaults })
    }

    /// A method parameter: labels, for a method the runtime calls, or else
    /// an ordinary one.
    pub(super) fn lower_param_or_labels(
        &mut self,
        id: NodeId,
        index: u32,
    ) -> Result<Vec<Param>, Diagnostic> {
        if let Some(name) = self.name_node(id)
            && let Some(params) = self.lower_label_params(name, index)?
        {
            return Ok(params);
        }
        self.lower_param(id, index)
    }

    /// The parameters an Objective-C entry point adds, and what the function
    /// then returns. A record by value is written through the address the
    /// entry point passes last, so the function returns nothing; any other
    /// result is returned as it is. Then the labels objects are made, with
    /// every parameter in place.
    pub(super) fn finish_params(
        &mut self,
        params: &mut Vec<Param>,
        return_type: HirType,
        origin: &Origin,
    ) -> Result<HirType, Diagnostic> {
        let return_type = if self.objc_entry.is_some_and(|entry| entry.returns_record)
            || self.com_entry.is_some_and(|entry| entry.returns_record)
        {
            let index = u32::try_from(params.len()).unwrap_or(0);
            let out = self.push(OpKind::Param(index), return_type.clone(), origin.clone());
            params.push(Param {
                name: "returned".to_owned(),
                shape: ParamShape::Ordinary,
                ty: return_type,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            self.record_out = Some(out);
            HirType::Void
        } else {
            return_type
        };
        self.make_pending_labels()?;
        for (symbol, handle, name_node, ty) in std::mem::take(&mut self.pending_hstrings) {
            let text =
                self.runtime_call("nts_string_copy_hstring", vec![handle], ty, origin.clone());
            let text = self.open_cell(symbol, text, name_node);
            self.bindings.insert(symbol, text);
        }
        Ok(return_type)
    }

    /// The labels parameter of a method the runtime calls, which it passes
    /// as it is sent -- one argument each, in declared order -- made into the
    /// object the method's body reads: `override mouseDown(labels: { with:
    /// NSEvent })`, Swift's `mouseDown(with:)`, is `mouseDown:` taking the
    /// event.
    fn lower_label_params(
        &mut self,
        name_node: NodeId,
        index: u32,
    ) -> Result<Option<Vec<Param>>, Diagnostic> {
        let Some(labels) = self
            .objc_entry
            .and(self.snapshot.node_types.get(&name_node).copied())
            .filter(|declared| crate::hir::native::abi_type(self.snapshot, *declared).is_none())
            .and_then(|declared| crate::hir::native::labels_of(self.snapshot, declared))
        else {
            return Ok(None);
        };
        let origin = self.origin(name_node);
        let mut params = Vec::new();
        let mut values = Vec::new();
        for (at, (key, ty)) in labels.into_iter().enumerate() {
            let ty = self
                .represent(ty)
                .ok_or_else(|| self.unrepresentable(name_node, "a label"))?;
            let value = self.push(
                OpKind::Param(index + u32::try_from(at).unwrap_or(0)),
                ty.clone(),
                origin.clone(),
            );
            params.push(Param {
                name: key.clone(),
                shape: ParamShape::Ordinary,
                ty,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            values.push((key, value));
        }
        self.pending_labels.push((name_node, values));
        Ok(Some(params))
    }

    /// The labels objects of [`Self::lower_label_params`], made from their
    /// parameters now that every parameter is, and bound to their names.
    fn make_pending_labels(&mut self) -> Result<(), Diagnostic> {
        for (name_node, values) in std::mem::take(&mut self.pending_labels) {
            let object_ty = self
                .type_of(name_node)
                .ok_or_else(|| self.unrepresentable(name_node, "labels"))?;
            let HirType::Managed(ManagedType::Object(type_id)) = object_ty.clone() else {
                return Err(self.unsupported(name_node, "labels that are not an object"));
            };
            self.materialize(name_node, &object_ty)?;
            let layout = self.layout_of(name_node, type_id)?;
            let origin = self.origin(name_node);
            let object = self.push(
                OpKind::ObjectNew { frame: false },
                object_ty,
                origin.clone(),
            );
            for (key, value) in values {
                let field = layout
                    .index_of(&key)
                    .ok_or_else(|| self.absent_member(name_node, type_id, &key))?;
                let want = layout.fields[field as usize].ty.clone();
                let value = self.coerce(value, &want, name_node)?;
                self.field_set(object, field, value, &origin);
            }
            if let Some(symbol) = self.node(name_node).symbol {
                let object = self.open_cell(symbol.0, object, name_node);
                self.bindings.insert(symbol.0, object);
            }
        }
        Ok(())
    }

    /// The string a native function returned: C's `const char *`, copied,
    /// then released with the declaration's `@ntsFree` if it names one.
    ///
    /// Immediately after the call and in the same block, and nothing can
    /// branch between them: a native call names no raising copy, so it gets no
    /// raise test, and the copy and the free are runtime calls that cannot
    /// raise either. The free comes after the copy, which is the one order in
    /// which C's string is never read after it is released.
    /// A labelled argument: the property of the labels literal its key names,
    /// at the slot's type. `placeholder` is what the literal lowered to.
    /// A label's value as the C argument its role makes of it.
    fn label_argument(
        &mut self,
        id: NodeId,
        value: ValueId,
        inner: &crate::hir::native::Role,
        slot: &crate::hir::native::Type,
        lent: &mut Vec<Lent>,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::Role;
        let origin = self.origin(id);
        Ok(match inner {
            Role::NSString => self.ns_string_of(value, &origin),
            Role::NSArray(_) | Role::NSDictionary(_) | Role::NSSet(_) => {
                self.foundation_collection(id, value, inner, &origin)?
            }
            Role::Block { bridge, signature } => self
                .lend_block(
                    id,
                    Some(value),
                    (bridge.clone(), signature.clone()),
                    slot.representation(),
                    lent,
                    &origin,
                )?
                .ok_or_else(|| self.unsupported(id, "a block label with no function"))?,
            Role::String(encoding) => {
                self.lend_string(value, *encoding, slot.representation(), lent, origin)
            }
            _ => self.coerce(value, &slot.representation(), id)?,
        })
    }

    /// The value a call gave the label `key`: the literal's property, or a
    /// field of labels passed as an object -- `self.beginSheet(labels, ...)`,
    /// which is how a wrapper passes on the labels it was given.
    pub(super) fn label_value(
        &mut self,
        id: NodeId,
        placeholder: Option<ValueId>,
        key: &str,
    ) -> Result<ValueId, Diagnostic> {
        let missing =
            |this: &Self| this.unsupported(id, &format!("a call missing its `{key}` label"));
        let Some(argument) = placeholder else {
            return Err(missing(self));
        };
        if let Some(values) = self.labels_lowered.get(&argument) {
            return values
                .iter()
                .find(|(named, _)| named == key)
                .map(|(_, value)| *value)
                .ok_or_else(|| missing(self));
        }
        let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[argument.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(
                id,
                "labels that are neither an object literal nor an object",
            ));
        };
        let layout = self.layout_of(id, type_id)?;
        let field = layout.index_of(key).ok_or_else(|| missing(self))?;
        let ty = layout.fields[field as usize].ty.clone();
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::FieldGet {
                object: argument,
                field,
            },
            ty,
            origin,
        ))
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn give_back(&mut self, id: NodeId, lent: Vec<Lent>) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        for lent in lent {
            match lent {
                Lent::String {
                    string,
                    pointer,
                    encoding,
                } => {
                    // Only a conversion is lent this way; a view made nothing.
                    if let Some(release) = encoding.release() {
                        self.runtime_call(
                            release,
                            vec![string, pointer],
                            HirType::Void,
                            origin.clone(),
                        );
                    }
                }
                Lent::Closure { context } => {
                    self.runtime_call(
                        "nts_closure_unlend",
                        vec![context],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Strings { pointer } => {
                    self.runtime_call(
                        "nts_cstrings_release",
                        vec![pointer],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::HStrings { array, block } => {
                    self.runtime_call(
                        "nts_hstrings_release",
                        vec![array, block],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Filled { array, block } => self.copy_filled(id, array, block)?,
                Lent::Block { block } => {
                    let freed = self.push(
                        OpKind::Convert(block),
                        HirType::NativePointer(crate::hir::native::Pointee::Void),
                        origin.clone(),
                    );
                    self.runtime_call("nts_winrt_free", vec![freed], HirType::Void, origin.clone());
                }
                Lent::View { view } => {
                    self.runtime_call("nts_view_unlend", vec![view], HirType::Void, origin.clone());
                }
                Lent::Borrowed { string } => {
                    self.runtime_call(
                        "nts_string_unlend",
                        vec![string],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Array { array } => {
                    self.runtime_call(
                        "nts_array_unlend",
                        vec![array],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Queried { array, block } => {
                    self.runtime_call(
                        "nts_com_release_array",
                        vec![array, block],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Boxed { boxed } => {
                    self.runtime_call(
                        "nts_boxed_unlend",
                        vec![boxed],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                // A reference the call was handed, or the inner object a
                // composable factory answered: the program's, given back.
                Lent::Delegate { object } | Lent::Taken { object } | Lent::Box { object } => {
                    self.runtime_call(
                        "nts_com_release",
                        vec![object],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Inner { slot } => {
                    let inner = self.runtime_call(
                        "nts_com_take",
                        vec![slot],
                        HirType::NativePointer(crate::hir::native::Pointee::Void),
                        origin.clone(),
                    );
                    self.runtime_call(
                        "nts_com_release",
                        vec![inner],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                // Checked, or read, by `finish_call` after everything else is
                // given back; each is a local of the caller's own.
                Lent::Error { .. } | Lent::Result { .. } | Lent::Count { .. } => {}
            }
        }
        Ok(())
    }

    /// An argument where the Windows Runtime takes any object (`Role::Box`):
    /// an object as itself, and a string, number or boolean boxed by the
    /// runtime (`nts_winrt_box`, from the value erased) into an
    /// `IPropertyValue` the call is lent and gives back.
    fn box_argument(
        &mut self,
        id: NodeId,
        value: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        // Lowered against the union the parameter is, an object arrives
        // erased: the object it was is passed instead.
        let object = match self.values[value.0 as usize].kind {
            OpKind::Erase { value: inner, .. }
                if matches!(self.values[inner.0 as usize].ty, HirType::NativePointer(_)) =>
            {
                Some(inner)
            }
            _ => matches!(self.values[value.0 as usize].ty, HirType::NativePointer(_))
                .then_some(value),
        };
        if let Some(object) = object {
            return self.coerce(object, &want, id);
        }
        let erased = self.coerce(value, &HirType::Erased, id)?;
        let object = self.runtime_call("nts_winrt_box", vec![erased], want, origin.clone());
        lent.push(Lent::Box { object });
        Ok(object)
    }

    /// A closure as a Windows Runtime delegate: a COM object made for the call
    /// (`nts_com_delegate`) whose `Invoke` is the adapter for `signature`, and
    /// which holds the bridge into the closure's body and the closure, lent
    /// until the object's count reaches zero. The caller's reference is given
    /// back after the call.
    pub(super) fn delegate(
        &mut self,
        id: NodeId,
        closure: ValueId,
        (bridge, signature, iid): (
            std::sync::Arc<crate::hir::native::FnPointer>,
            std::sync::Arc<crate::hir::native::FnPointer>,
            &str,
        ),
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        if !crate::hir::native::is_interface_id(iid) {
            return Err(self.unsupported(
                id,
                "a `Delegate` whose interface ID is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let pointer = HirType::NativePointer(crate::hir::native::Pointee::Void);
        let invoke = self.bridge_closure(
            id,
            closure,
            (&bridge, crate::hir::Bridging::default()),
            false,
            pointer.clone(),
            origin,
        )?;
        let adapter = self.push(
            OpKind::DelegateInvoke { signature },
            pointer.clone(),
            origin.clone(),
        );
        let context = self.runtime_call(
            "nts_closure_lend",
            vec![closure],
            pointer.clone(),
            origin.clone(),
        );
        let [low, high] = self.iid_arguments(iid, origin);
        let object = self.runtime_call(
            "nts_com_delegate",
            vec![adapter, invoke, context, low, high],
            want,
            origin.clone(),
        );
        lent.push(Lent::Delegate { object });
        Ok(object)
    }

    /// A typed array's storage lent to a call that reads it as `element`s
    /// (`Role::Bytes`), in place (`nts_view_lend_bytes`), given back after the call
    /// (`Lent::View`). No copy: C reads the elements the program holds.
    ///
    /// **Nothing else has that storage.** The call is checked against the
    /// declaration the program wrote, and a lib.dom member a binding
    /// implements is checked against lib.dom's, which takes any sequence of
    /// numbers: so `ctx.setLineDash([5, 3])` gave a `number[]` where nts:dom
    /// lends a `Float64Array`, and `nts_view_bytes` read the array's header as
    /// a view's (the Chromium lane's
    /// lib-dom-a-number-array-for-a-typed-array-parameter). Anything else is
    /// refused by name, as `lend_handles` refuses an array of non-handles.
    fn lend_bytes(
        &mut self,
        id: NodeId,
        view: ValueId,
        element: &HirType,
        want: HirType,
        lent: &mut Vec<Lent>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        match &self.values[view.0 as usize].ty {
            HirType::Managed(ManagedType::View(held)) if **held == *element => {}
            HirType::Managed(ManagedType::View(_)) => {
                return Err(self.unsupported(
                    id,
                    "a `CBytes` or `CElements` argument whose typed array holds other elements than C reads",
                ));
            }
            held => {
                let why = format!(
                    "a `CBytes` or `CElements` argument that is {}, not a typed array: C would read it as one",
                    named_representation(held)
                );
                return Err(self.unsupported(id, &why));
            }
        }
        lent.push(Lent::View { view });
        Ok(self.borrow_bytes(view, want, &origin))
    }

    /// A typed array's storage where C takes a pointer to its elements, NULL
    /// for `null`: `nts_view_lend_bytes`, in place -- read as the bytes it is and
    /// cast to the element pointer C takes, which is a `const int32_t *` for
    /// an `Int32Array` and only coincides with the bytes for a `Uint8Array`.
    fn borrow_bytes(&mut self, view: ValueId, want: HirType, origin: &Origin) -> ValueId {
        let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        self.unless_null(view, absent, origin, |this| {
            let bytes = HirType::NativePointer(crate::hir::native::Pointee::Scalar(
                crate::hir::native::Scalar::UInt8,
            ));
            let storage = this.runtime_call(
                "nts_view_lend_bytes",
                vec![view],
                bytes.clone(),
                origin.clone(),
            );
            if want == bytes {
                storage
            } else {
                this.push(OpKind::Convert(storage), want, origin.clone())
            }
        })
    }

    /// The element count of each array a call passes beside a count, by the
    /// count's slot, read before anything is lent for the call. One C takes
    /// narrower than an array can be long -- a `uint32_t`, as the Windows
    /// Runtime takes every one -- is bounded there too: an array too long for
    /// it throws a `RangeError`. The binding declared the array crosses with
    /// that count, so the check is one it wrote (`docs/records/notebooks/scalar-numbers.md`,
    /// Q4), and the count is then proven to fit.
    fn bounded_counts(
        &mut self,
        id: NodeId,
        target: &crate::hir::native::Function,
        args: &[ValueId],
    ) -> Result<rustc_hash::FxHashMap<usize, ValueId>, Diagnostic> {
        let mut counts = rustc_hash::FxHashMap::default();
        for (at, role, _) in target.slots() {
            let crate::hir::native::Role::Length { array, nullable } = role else {
                continue;
            };
            let fed = target
                .slots()
                .find(|(slot, _, _)| *slot == array)
                .and_then(|(_, _, fed)| fed);
            let Some(array) = fed.and_then(|ts| args.get(ts).copied()) else {
                continue;
            };
            let origin = self.origin(id);
            let count = self.array_count(array, nullable, &origin);
            counts.insert(at, count);
            // Nothing holds 2^53 elements, so a count that wide takes any.
            let narrower = match &target.parameters[at] {
                crate::hir::native::Type::Scalar(kind) => kind
                    .integer_range()
                    .filter(|(_, greatest)| *greatest < 1 << 53)
                    .map(|(_, greatest)| (*kind, greatest)),
                _ => None,
            };
            let Some((kind, greatest)) = narrower else {
                continue;
            };
            #[allow(clippy::cast_precision_loss)]
            let most = self.push(
                OpKind::ConstFloat(greatest as f64),
                HirType::NUMBER,
                origin.clone(),
            );
            let fits = self.push(
                OpKind::Binary {
                    op: BinOp::Le,
                    lhs: count,
                    rhs: most,
                },
                HirType::Bool,
                origin.clone(),
            );
            let (throws, carries_on) = (self.new_block(), self.new_block());
            self.terminate(Terminator::Branch {
                cond: fits,
                then_target: carries_on,
                then_args: Vec::new(),
                else_target: throws,
                else_args: Vec::new(),
            });
            self.switch_to(throws);
            let message = format!(
                "an array too long for the `{}` count `{}` takes",
                crate::hir::native::Type::Scalar(kind).c_type(),
                target.name
            );
            self.throw_provided_error(id, "RangeError", &message)?;
            if !self.is_terminated() {
                self.terminate(Terminator::Unreachable);
            }
            self.switch_to(carries_on);
        }
        Ok(counts)
    }

    /// What C means by a length beside an array: its elements -- a
    /// `string[]`'s, a view's -- and 0 for a `null` one.
    ///
    /// **Elements, not bytes.** A `Uint8Array`'s two are one number, which is
    /// how this read the byte length for as long as a byte array was the only
    /// view C took. An `Int32Array` of three is twelve bytes, and a count of
    /// twelve beside it is a callee reading nine elements past the end.
    fn array_count(&mut self, array: ValueId, nullable: bool, origin: &Origin) -> ValueId {
        let view = matches!(
            self.values[array.0 as usize].ty,
            HirType::Managed(ManagedType::View(_))
        );
        let length = |this: &mut Self| {
            if view {
                this.runtime_call(
                    "nts_view_length",
                    vec![array],
                    HirType::NUMBER,
                    origin.clone(),
                )
            } else {
                this.push(OpKind::Length(array), HirType::NUMBER, origin.clone())
            }
        };
        if nullable {
            let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            self.unless_null(array, zero, origin, length)
        } else {
            length(self)
        }
    }

    /// `value === null ? absent : present(value)`, for what C takes beside
    /// or in place of a managed argument that may be `null` -- a count of 0,
    /// a NULL pointer -- where reading the absent value would fault.
    /// `absent` is built by the caller, before the branch.
    pub(super) fn unless_null(
        &mut self,
        value: ValueId,
        absent: ValueId,
        origin: &Origin,
        present: impl FnOnce(&mut Self) -> ValueId,
    ) -> ValueId {
        let ty = self.values[value.0 as usize].ty.clone();
        let out = self.values[absent.0 as usize].ty.clone();
        let null = self.push(OpKind::ConstNull, ty, origin.clone());
        let missing = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: value,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        );
        let taken = self.new_block();
        let merge = self.new_block();
        self.terminate(Terminator::Branch {
            cond: missing,
            then_target: merge,
            then_args: vec![absent],
            else_target: taken,
            else_args: Vec::new(),
        });
        let answer = self.push_block_param(merge, out, origin.clone());
        self.switch_to(taken);
        let there = present(self);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![there],
        });
        self.switch_to(merge);
        answer
    }

    /// A call's arguments, lowered the way its callee wants them, and what was
    /// lent for the call, which the caller gives back once it returns.
    ///
    /// Four things separate a native callee from every other. Its variadic
    /// tail is arguments rather than a gathered rest array; a function-typed
    /// argument becomes a bridge rather than a closure address; a `string`
    /// parameter receives a C string converted for the call; and a closure
    /// parameter becomes *three* C arguments -- the bridge, the closure's
    /// context, and for a retained one the function that releases it -- of
    /// which the program wrote one.
    /// The arguments the program wrote, and in the places it left one out,
    /// what goes there -- for a foreign function, its `@ntsDefault`, which
    /// `absent_argument` reads from `omitting_for` while these are lowered.
    fn lower_written_arguments(
        &mut self,
        id: NodeId,
        callee: &Callee,
        arguments: &[NodeId],
        method: bool,
        tail: Option<&HirType>,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        let outer = match callee {
            Callee::Native(target) => {
                self.omitting_for
                    .replace((target.clone(), usize::from(method), id))
            }
            _ => self.omitting_for.take(),
        };
        let args = match tail {
            Some(element) => self.lower_native_arguments(id, arguments, element),
            None => self.lower_arguments(id, arguments),
        };
        self.omitting_for = outer;
        args
    }

    pub(super) fn lower_call_arguments(
        &mut self,
        id: NodeId,
        callee: &Callee,
        arguments: &[NodeId],
        receiver: Option<ValueId>,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        if let (Some((call, literal, slots)), Callee::Native(target)) =
            (self.dictionary_slots.clone(), callee)
            && call == id
        {
            return self.lower_dictionary_slots(id, target, (literal, &slots), receiver);
        }
        let tail = match callee {
            Callee::Native(target) => target
                .variadic
                .as_ref()
                .map(crate::hir::native::Type::representation),
            _ => None,
        };
        // Whether the receiver is an argument the declaration spells (`this`),
        // which moves every written argument up one, or a `Role::Receiver`
        // slot fed directly, which moves nothing.
        let spelled = receiver.is_some()
            && !matches!(callee, Callee::Native(target) if target.roles.first() == Some(&crate::hir::native::Role::Receiver));
        if let Callee::Native(target) = callee {
            self.mark_literals(target, arguments, spelled);
        }
        let args = self.lower_written_arguments(id, callee, arguments, spelled, tail.as_ref())?;
        let Callee::Native(target) = callee else {
            return Ok((args, Vec::new()));
        };
        self.native_arguments(id, &target.clone(), args, arguments.len(), receiver)
    }

    /// [`Self::lower_call_arguments`] for a call whose dictionary the binding
    /// takes as its members ([`Self::dictionary_spread`]): each member where
    /// its parameter is, and the parameter's `@ntsDefault` where the literal
    /// leaves it out.
    fn lower_dictionary_slots(
        &mut self,
        id: NodeId,
        target: &std::sync::Arc<crate::hir::native::Function>,
        (literal, slots): (NodeId, &[Option<NodeId>]),
        receiver: Option<ValueId>,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        let spelled =
            receiver.is_some() && target.roles.first() != Some(&crate::hir::native::Role::Receiver);
        let positional: Vec<NodeId> = slots.iter().map(|slot| slot.unwrap_or(literal)).collect();
        self.mark_literals(target, &positional, spelled);
        let outer = self
            .omitting_for
            .replace((target.clone(), usize::from(spelled), id));
        let mut arguments = Vec::with_capacity(slots.len());
        for (at, slot) in slots.iter().enumerate() {
            arguments.push(match slot {
                Some(node) => Argument::expression(*node),
                None => match self.absent_argument(id, at) {
                    Ok(value) => Argument {
                        node: literal,
                        value: Some(value),
                    },
                    Err(why) => {
                        self.omitting_for = outer;
                        return Err(why);
                    }
                },
            });
        }
        let args = self.lower_argument_values(id, &arguments, None, None);
        self.omitting_for = outer;
        self.native_arguments(id, &target.clone(), args?, arguments.len(), receiver)
    }

    /// Mark each object literal a native call passes that is never built:
    /// labels -- the call's own spelling of them, as Swift's are -- whose
    /// properties are passed as they are, and a `Copied<T>`'s fields, written
    /// straight into the struct. Either passed any other way is an object
    /// like any other, and each field is read from it.
    fn mark_literals(
        &mut self,
        target: &crate::hir::native::Function,
        arguments: &[NodeId],
        method: bool,
    ) {
        for (at, role, fed) in target.slots() {
            let Some(&argument) = fed
                .and_then(|ts| ts.checked_sub(usize::from(method)))
                .and_then(|ts| arguments.get(ts))
            else {
                continue;
            };
            if self.kind_of(argument) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
                continue;
            }
            match role {
                crate::hir::native::Role::Label { last: true, .. } => {
                    self.labels_pending.insert(argument);
                }
                crate::hir::native::Role::Copied => {
                    self.copied_pending
                        .insert(argument, target.parameters[at].representation());
                }
                _ => {}
            }
        }
    }

    /// A labels literal, a property at a time in the order it is written --
    /// which is when JavaScript evaluates them -- and never an object. What it
    /// answers is a placeholder at the literal's type, which nothing reads:
    /// `native_arguments` passes each property's value in the slot its key
    /// names, and the placeholder is dead.
    pub(super) fn lower_labels(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let mut values = Vec::new();
        for property in self.syntax_children_of(id) {
            let (key, value) = match self.kind_of(property) {
                Some(syntax::PROPERTY_ASSIGNMENT) => {
                    let parts = self.syntax_children_of(property);
                    let [name, initializer] = parts[..] else {
                        return Err(
                            self.unsupported(property, "a label that is not a name and a value")
                        );
                    };
                    let key = self
                        .node(name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                        .ok_or_else(|| self.unsupported(name, "a label whose name is computed"))?;
                    (key, self.lower_expression(initializer)?)
                }
                // `{ data }`: the value the name holds, found as an object
                // literal's shorthand finds it -- the name's own symbol is the
                // *property*'s, not the value's.
                Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                    let parts = self.syntax_children_of(property);
                    let [name] = parts[..] else {
                        return Err(
                            self.unsupported(property, "a shorthand label of unexpected shape")
                        );
                    };
                    let key = self
                        .node(name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                        .ok_or_else(|| self.unsupported(name, "a label whose name is computed"))?;
                    let symbol = self.shorthand_value_symbol(name, &key)?;
                    (key, self.lower_named_value(name, symbol)?)
                }
                _ => {
                    return Err(self
                        .unsupported(property, "a spread, a method or an accessor among labels"));
                }
            };
            values.push((key, value));
        }
        // At the parameter's type rather than the literal's own: `{ at: 0 }`
        // is `{ at: number }`, the parameter `{ at: UInt }`, and the argument
        // is converted to the parameter's type before any role sees it.
        let ty = self
            .contextual_type(id, 0)
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unrepresentable(id, "labels"))?;
        let origin = self.origin(id);
        let placeholder = self.push(OpKind::ConstNull, ty, origin);
        self.labels_lowered.insert(placeholder, values);
        Ok(placeholder)
    }

    /// A node's children, seeing through the list nodes between them.
    pub(super) fn syntax_children_of(&self, id: NodeId) -> Vec<NodeId> {
        let mut out = Vec::new();
        for child in self.children(id) {
            if self.kind_of(child).is_some() {
                out.push(child);
            } else {
                out.extend(self.syntax_children_of(child));
            }
        }
        out
    }

    /// A foreign call's C arguments from the TypeScript ones already lowered:
    /// the receiver first for a method, then each slot as its role says --
    /// strings and arrays lent, closures bridged, lengths filled in, the error
    /// slot supplied where the program wrote `written` arguments and left it
    /// out. Separate from lowering them so an argument that is a value rather
    /// than a node -- a property's assigned value -- goes through the same
    /// roles.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn native_arguments(
        &mut self,
        id: NodeId,
        target: &std::sync::Arc<crate::hir::native::Function>,
        mut args: Vec<ValueId>,
        written: usize,
        receiver: Option<ValueId>,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        let target = target.clone();
        let origin = self.origin(id);
        let fed_receiver = target.roles.first() == Some(&crate::hir::native::Role::Receiver);
        let receiver_value = self.place_receiver(id, &target, &mut args, receiver)?;
        let counts = self.bounded_counts(id, &target, &args)?;
        let mut lent = Vec::new();
        let mut c_args = Vec::with_capacity(target.parameters.len());
        // The closure the context slots that follow a closure slot belong to.
        let mut lending: Option<(ValueId, crate::hir::native::Lifetime)> = None;
        for (at, role, fed) in target.slots() {
            use crate::hir::native::Role;
            let argument = fed.and_then(|ts| args.get(ts).copied());
            match role {
                Role::Plain => {
                    let Some(value) = argument else { continue };
                    // A record literal's lent strings, for the call it is passed to.
                    lent.extend(self.copied_lent.remove(&value).unwrap_or_default());
                    c_args.push(self.unboxed_argument(value, &target.parameters[at], &origin));
                }
                Role::Receiver => c_args.extend(receiver_value),
                // An object as itself; a string, number or boolean boxed by
                // the runtime (`nts_winrt_box`, from the value erased) into
                // an `IPropertyValue` the call is lent and gives back.
                Role::Box => {
                    let Some(value) = argument else { continue };
                    let want = target.parameters[at].representation();
                    c_args.push(self.box_argument(id, value, want, &mut lent, &origin)?);
                }
                // A label crosses as its own role says, with the value the
                // literal gave that property.
                Role::Label { key, inner, .. } => {
                    let value = self.label_value(id, argument, &key)?;
                    c_args.push(self.label_argument(
                        id,
                        value,
                        &inner,
                        &target.parameters[at],
                        &mut lent,
                    )?);
                }
                // A slot the caller passed is theirs to read; one they left out
                // is a zeroed local of ours, checked after the call.
                Role::ErrorSlot { converter } => {
                    // `fed` counts a method's receiver, which `written` --
                    // the arguments the program wrote after the dot -- does not.
                    let written = fed.is_some_and(|ts| {
                        ts < written + usize::from(receiver.is_some() && !fed_receiver)
                    });
                    let ty = target.parameters[at].representation();
                    c_args.push(self.error_slot(
                        argument.filter(|_| written),
                        ty,
                        converter,
                        &mut lent,
                        &origin,
                    ));
                }
                // A value or `null`, as an `IReference<T>` made for the call.
                Role::Reference {
                    iid,
                    value,
                    property_type,
                } => {
                    let want = target.parameters[at].representation();
                    c_args.extend(
                        argument
                            .map(|given| {
                                self.reference_argument(
                                    id,
                                    given,
                                    (&iid, value, property_type),
                                    want,
                                    &mut lent,
                                )
                            })
                            .transpose()?,
                    );
                }
                Role::Strings
                | Role::HStrings
                | Role::Records(_)
                | Role::Booleans
                | Role::FilledHandles
                | Role::FilledStrings
                | Role::FilledRecords(_) => c_args.extend(
                    argument
                        .map(|array| {
                            self.lend_array(
                                id,
                                &role,
                                array,
                                target.parameters[at].representation(),
                                &mut lent,
                            )
                        })
                        .transpose()?,
                ),
                // A `Uint8Array` in place: its bytes, for the call, and the
                // view given back after it. The give-back does nothing at run
                // time; it is the view's last use, without which reference
                // counting released a temporary view -- and with it the only
                // reference to the buffer -- before C read the bytes.
                Role::Bytes(element) => c_args.extend(
                    argument
                        .map(|view| {
                            self.lend_bytes(
                                id,
                                view,
                                &element,
                                target.parameters[at].representation(),
                                &mut lent,
                            )
                        })
                        .transpose()?,
                ),
                // An array of handles in place: its element block, for the
                // call, and the array given back after it.
                Role::Handles => c_args.extend(
                    argument
                        .map(|array| {
                            self.lend_handles(
                                id,
                                array,
                                target.parameters[at].representation(),
                                &mut lent,
                                &origin,
                            )
                        })
                        .transpose()?,
                ),
                // The array's element count, into the slot C reads it from --
                // before the array's own slot as often as after, so it is read
                // from the arguments rather than from what was pushed.
                Role::Length { .. } => {
                    let Some(&count) = counts.get(&at) else {
                        continue;
                    };
                    c_args.push(self.coerce(count, &target.parameters[at].representation(), id)?);
                }
                Role::NSString => {
                    c_args.extend(argument.map(|string| self.ns_string_of(string, &origin)));
                }
                Role::NSArray(_) | Role::NSDictionary(_) | Role::NSSet(_) => {
                    let Some(collection) = argument else { continue };
                    c_args.push(self.foundation_collection(id, collection, &role, &origin)?);
                }
                Role::Result { .. } | Role::ReceivedCount | Role::Outer | Role::Inner => {
                    c_args.push(self.hresult_slot(
                        &role,
                        target.parameters[at].representation(),
                        &mut lent,
                        &origin,
                    ));
                }
                // The struct, copied into the frame, its strings lent.
                Role::Copied => c_args.extend(
                    argument
                        .map(|value| {
                            self.copied_argument(
                                id,
                                value,
                                target.parameters[at].representation(),
                                &mut lent,
                            )
                        })
                        .transpose()?,
                ),
                Role::String(encoding) => {
                    let Some(string) = argument else { continue };
                    let want = target.parameters[at].representation();
                    c_args.push(self.lend_string_argument(
                        id,
                        string,
                        encoding,
                        want,
                        &mut lent,
                        origin.clone(),
                    )?);
                }
                Role::Closure {
                    lifetime,
                    bridge,
                    bridging,
                } => {
                    let Some(closure) = argument else { continue };
                    let want = target.parameters[at].representation();
                    let once = lifetime == crate::hir::native::Lifetime::Once;
                    c_args.push(self.bridge_closure(
                        id,
                        closure,
                        (&bridge, bridging),
                        once,
                        want,
                        &origin,
                    )?);
                    lending = Some((closure, lifetime));
                }
                Role::Block { bridge, signature } => c_args.extend(self.lend_block(
                    id,
                    argument,
                    (bridge, signature),
                    target.parameters[at].representation(),
                    &mut lent,
                    &origin,
                )?),
                Role::Delegate {
                    bridge,
                    signature,
                    iid,
                } => c_args.extend(
                    argument
                        .map(|closure| {
                            self.delegate(
                                id,
                                closure,
                                (bridge, signature, &iid),
                                target.parameters[at].representation(),
                                &mut lent,
                                &origin,
                            )
                        })
                        .transpose()?,
                ),
                Role::ClosureData => {
                    let Some((closure, lifetime)) = lending else {
                        continue;
                    };
                    let want = target.parameters[at].representation();
                    c_args.push(self.lend_context(closure, lifetime, want, &mut lent, &origin));
                }
                Role::ClosureNotify => {
                    let want = target.parameters[at].representation();
                    c_args.push(self.closure_notify(want, &origin));
                }
            }
        }
        // The variadic tail, past every declared parameter.
        let declared = target.slots().filter(|(_, _, fed)| fed.is_some()).count();
        c_args.extend(args.iter().skip(declared).copied());
        c_args.extend(self.record_destination(&target, &origin));
        self.bridge_callback_arguments(id, &target, &mut c_args)?;
        lent.extend(
            c_args
                .iter()
                .filter_map(|arg| self.unboxed.get(arg))
                .map(|&boxed| Lent::Boxed { boxed }),
        );
        Ok((c_args, lent))
    }

    /// The context C hands back to a closure's bridge: the closure, lent for
    /// as long as `lifetime` says. Once: counted as a callback C still owes
    /// until the bridge gives it back, which keeps a `GLib` loop turning.
    fn lend_context(
        &mut self,
        closure: ValueId,
        lifetime: crate::hir::native::Lifetime,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        let helper = if lifetime == crate::hir::native::Lifetime::Once {
            "nts_closure_lend_once"
        } else {
            "nts_closure_lend"
        };
        let context = self.runtime_call(helper, vec![closure], want, origin.clone());
        if lifetime == crate::hir::native::Lifetime::Call {
            lent.push(Lent::Closure { context });
        }
        context
    }
}
