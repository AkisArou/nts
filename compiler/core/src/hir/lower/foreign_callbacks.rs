//! Bridge closures into callbacks and emit the conversions their signatures request.

use super::{
    ArrayFill, BinOp, Conversion, Converts, Copy, Diagnostic, Facts, Func, FuncBuilder, HirType,
    LayoutCollector, Lent, Lowered, LoweringSnapshot, ManagedType, NO_FOREIGN, NativeBy,
    NativeWalk, NodeId, OpKind, Origin, Param, ParamShape, SemanticSnapshot, Shared, Step,
    Terminator, TypeId, TypeKind, ValueId, VectorMethods, Walk, closure_index, opaque_handle,
};

/// The functions bridges call to convert an argument C passes
/// ([`Conversion`]), one per name. One that does not lower is uncompiled, and
/// `bridges::check` refuses each bridge that would call it.
pub(super) fn lower_conversions(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let mut made = rustc_hash::FxHashSet::default();
    for request in std::mem::take(&mut lowered.arrivals.conversions) {
        if !made.insert(request.name.clone()) {
            continue;
        }
        let mut builder = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            Copy::default(),
        );
        match builder.lower_conversion(&request) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => {
                lowered
                    .program
                    .uncompiled
                    .push(crate::hir::Uncompiled::refused(
                        request.name.clone(),
                        diagnostic.message.clone(),
                    ));
                lowered.diagnostics.push(diagnostic);
            }
        }
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }
}

/// Swift's closures at an Objective-C message: a parameter of a plain function
/// type is a block, as a Swift closure passed to one is, lent for the call and
/// copied by a callee that keeps it. A C function's is a function pointer
/// still, and a `Block<F>` is a block wherever it is written.
pub(super) fn bridge_blocks(
    native: &mut crate::hir::native::Function,
    signature: &nts_semantic_schema::SignatureRecord,
    snapshot: &SemanticSnapshot,
) {
    use crate::hir::native::{Pointee, Role, Type};
    // A function, or one that may be `null` -- Swift's optional closure, a
    // block property's `(() => void) | null`.
    let function = |ty: TypeId| {
        let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
        match kind(ty) {
            Some(TypeKind::Function(_)) => true,
            Some(TypeKind::Union(members)) => {
                members
                    .iter()
                    .any(|m| matches!(kind(*m), Some(TypeKind::Function(_))))
                    && members
                        .iter()
                        .all(|m| matches!(kind(*m), Some(TypeKind::Function(_) | TypeKind::Null)))
            }
            _ => false,
        }
    };
    let slots: Vec<(usize, Option<usize>)> = native.slots().map(|(at, _, fed)| (at, fed)).collect();
    for (at, fed) in slots {
        let Some(parameter) = fed.and_then(|ts| signature.parameters.get(ts)) else {
            continue;
        };
        let Type::FnPointer(declared) = native.parameters[at].clone() else {
            continue;
        };
        match &mut native.roles[at] {
            role @ Role::Plain if function(parameter.ty) => {
                *role = crate::hir::native::block_role(&declared);
            }
            Role::Label { key, inner, .. } if **inner == Role::Plain => {
                let key = key.clone();
                let label = crate::hir::native::labels_of(snapshot, parameter.ty)
                    .and_then(|labels| labels.into_iter().find(|(named, _)| *named == key));
                if !label.is_some_and(|(_, ty)| function(ty)) {
                    continue;
                }
                **inner = crate::hir::native::block_role(&declared);
            }
            _ => continue,
        }
        native.parameters[at] = Type::Pointer(Pointee::Void);
    }
}

impl FuncBuilder<'_> {
    /// A record result's storage: a local of the caller's, so the local's
    /// rules are the result's, passed as the call's last argument.
    pub(super) fn record_destination(
        &mut self,
        target: &crate::hir::native::Function,
        origin: &Origin,
    ) -> Option<ValueId> {
        let destination = target.destination()?.representation();
        Some(self.push(
            OpKind::NativeLocal { count: 1 },
            destination,
            origin.clone(),
        ))
    }

    /// `nts_closure_unlend`, as the destroy function's type the binding
    /// states. `GLib`'s `GClosureNotify` takes the `GClosure` second, and the
    /// release ignores it -- which is `GLib`'s own `(GClosureNotify) g_free`.
    pub(super) fn closure_notify(&mut self, want: HirType, origin: &Origin) -> ValueId {
        let released = crate::hir::native::Type::FnPointer(std::sync::Arc::new(
            crate::hir::native::FnPointer::spell(
                vec![crate::hir::native::Type::Pointer(
                    crate::hir::native::Pointee::Void,
                )],
                crate::hir::native::Type::Void,
            ),
        ))
        .representation();
        let notify = self.runtime_call(
            "nts_closure_notify",
            Vec::new(),
            released.clone(),
            origin.clone(),
        );
        if released == want {
            notify
        } else {
            self.push(OpKind::Convert(notify), want, origin.clone())
        }
    }

    /// The type of a sequence a native method answers -- one with `length` and
    /// `item`, as nts:dom's `EventTargetSequence` -- where the program reads
    /// the call as an array: lib.dom's `composedPath(): EventTarget[]`.
    pub(super) fn sequence_for_array(&self, id: NodeId, returned: TypeId) -> Option<TypeId> {
        matches!(
            self.type_of(id),
            Some(HirType::Managed(ManagedType::Array(_)))
        )
        .then_some(())?;
        matches!(self.represent(returned), Some(HirType::NativePointer(_))).then_some(())?;
        self.walk_method(returned, "_get_length")?;
        self.walk_method(returned, "item")?;
        Some(returned)
    }

    /// A sequence a binding answered, as the new array the program reads it
    /// as: `WebIDL` converts a `sequence<T>` to a new JavaScript array each time,
    /// so page script's `composedPath()` is a fresh array too, and one the
    /// program owns is that. Each item is read as the array's element type, a
    /// kind of what `item` answers on the ground a `for...of` over a bound
    /// collection reads one ([`Self::delegated_walk`]). A sequence is a list
    /// made once, so its length does not move while it is copied.
    pub(super) fn array_of_sequence(
        &mut self,
        id: NodeId,
        sequence: ValueId,
        ty: TypeId,
        array_ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = &array_ty else {
            return Err(self.unsupported(id, "a sequence read as something other than an array"));
        };
        let element = (**element).clone();
        let (Some(size), Some(at)) = (
            self.walk_method(ty, "_get_length"),
            self.walk_method(ty, "item"),
        ) else {
            return Err(self.unsupported(id, "a sequence with no `length` and `item`"));
        };
        let read = self.represent(at.2.return_type).ok_or_else(|| {
            self.unsupported(
                id,
                "a sequence whose `item` answers a type with no representation",
            )
        })?;
        let narrows = Self::host_downcast(&read, &element);
        let walk = Walk::Native(Box::new(NativeWalk {
            by: NativeBy::Vector(Box::new(VectorMethods {
                size: size.clone(),
                at,
            })),
            element: if narrows { element.clone() } else { read },
            site: id,
            narrows,
        }));
        let origin = self.origin(id);
        let length = self.call_native_walk(id, &size, sequence, Vec::new())?;
        let length = self.coerce(length, &HirType::NUMBER, id)?;
        let array = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            array_ty,
            origin.clone(),
        );
        let (sequence, cursor, _) = self.walk_start(&walk, sequence, &origin)?;
        let cursor =
            cursor.ok_or_else(|| self.unsupported(id, "a sequence walk with no cursor"))?;
        let record = self.begin_loop(id, &[cursor], true, &origin)?;
        let at = self.bindings[&cursor];
        let cond = self.walk_condition(&walk, at, sequence, &origin)?;
        self.test_loop(cond, &record);
        self.switch_to(record.body);
        let at = self.bindings[&cursor];
        let [item] = self.read_element(&walk, sequence, at, &origin)?[..] else {
            return Err(self.unsupported(id, "a sequence walk that did not read one item"));
        };
        let item = self.coerce(item, &element, id)?;
        self.push(
            OpKind::ArraySet {
                array,
                index: at,
                value: item,
                checked: true,
            },
            HirType::Void,
            origin.clone(),
        );
        self.end_loop(
            &record,
            Step::Walk {
                cursor,
                walk,
                sequence,
            },
        )?;
        Ok(array)
    }

    /// `addEventListener(type, listener)` or `removeEventListener`, which a
    /// Windows Runtime class declares over its events (`@ntsListener add` or
    /// `remove`): the runtime's `nts_winrt_listen(object, iid, add, delegate)`
    /// or `nts_winrt_unlisten(object, iid, add, remove, listener)`, over the
    /// event the listener's `Event<F, IID, Slots>` names -- the interface
    /// declaring it and its `add_` and `remove_` slots, which every event
    /// calls alike. The runtime asks the object for the interface and keeps
    /// the token `add_` answers by object, event and function, which is what
    /// the removal looks up; so a removal passes the function, and makes no
    /// delegate. Either answers an HRESULT, thrown when it failed.
    pub(super) fn lower_event_listener(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        direction: &str,
        signature: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let adding = match direction.trim() {
            "add" => true,
            "remove" => false,
            _ => return Err(self.unsupported(id, "@ntsListener is `add` or `remove`")),
        };
        let [event, listener] = arguments else {
            return Err(
                self.unsupported(id, "an event listener call that is not `(type, listener)`")
            );
        };
        let listens = signature
            .parameters
            .get(1)
            .map(|parameter| parameter.ty)
            .ok_or_else(|| {
                self.unsupported(id, "an event listener call that is not `(type, listener)`")
            })?;
        let Some((iid, add, remove)) = crate::hir::native::event_slots(self.snapshot, listens)
        else {
            return Err(self.unsupported(
                id,
                "an event listener whose type names no event (`Event<F, IID, Slots>`)",
            ));
        };
        // `type` is evaluated, as it is written; the event is the one the
        // listener's type names.
        let values = self.lower_arguments(id, &[*event, *listener])?;
        let function = values[1];
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(&iid, &origin);
        let slot = HirType::Int {
            bits: 32,
            signed: false,
        };
        let add = self.push(
            OpKind::ConstInt(i128::from(add)),
            slot.clone(),
            origin.clone(),
        );
        let status_type = HirType::Int {
            bits: 32,
            signed: true,
        };
        let mut lent = Vec::new();
        let status = if adding {
            let crate::hir::native::Role::Delegate {
                bridge,
                signature,
                iid,
            } = crate::hir::native::listener_delegate(self.snapshot, listens)
                .map_err(|why| self.unsupported(id, &why))?
            else {
                return Err(self.unsupported(
                    id,
                    "an event listener whose type is not a delegate (`Event<F, IID, Slots>`)",
                ));
            };
            let pointer = HirType::NativePointer(crate::hir::native::Pointee::Void);
            let delegate = self.delegate(
                id,
                function,
                (bridge, signature, &iid),
                pointer,
                &mut lent,
                &origin,
            )?;
            self.runtime_call(
                "nts_winrt_listen",
                vec![receiver, low, high, add, delegate],
                status_type,
                origin.clone(),
            )
        } else {
            let remove = self.push(OpKind::ConstInt(i128::from(remove)), slot, origin.clone());
            self.runtime_call(
                "nts_winrt_unlisten",
                vec![receiver, low, high, add, remove, function],
                status_type,
                origin.clone(),
            )
        };
        self.throw_on_failure(id, status, lent, &origin)?;
        Ok(self.push(OpKind::ConstUndefined, HirType::Void, origin))
    }

    /// The receiver a member tagged `@ntsVia <IID>` is called on: the object
    /// asked for that interface (`nts_com_query`), as the Windows Runtime's
    /// projections call a class's member from one of its other interfaces --
    /// and the queried pointer, which [`Self::release_via`] gives back once
    /// the call has returned. Typed `void *`, so the ownership pass does not
    /// count it: it lives for the call alone, whatever the provider. Any other
    /// member is called on the receiver as it is.
    ///
    /// `@ntsVia <IID> <tag>` names the handle tag of the interface the IID is,
    /// where it is its class's default: a receiver whose handle carries that
    /// tag is that interface already -- a class's instance is its default
    /// interface -- and is not asked again.
    pub(super) fn via_receiver(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        receiver: ValueId,
    ) -> Result<(ValueId, Option<ValueId>), Diagnostic> {
        let Some(tag) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|native| native.via.clone())
        else {
            return Ok((receiver, None));
        };
        let mut words = tag.split_whitespace();
        let iid = words.next().unwrap_or_default().to_owned();
        if let Some(owner) = words.next()
            && let HirType::NativePointer(pointee) = &self.values[receiver.0 as usize].ty
            && opaque_handle(pointee).is_some_and(|handle| handle.tag == owner)
        {
            return Ok((receiver, None));
        }
        if !crate::hir::native::is_interface_id(&iid) {
            return Err(self.unsupported(
                id,
                "@ntsVia with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(&iid, &origin);
        let queried = self.runtime_call(
            "nts_com_query",
            vec![receiver, low, high],
            HirType::NativePointer(crate::hir::native::Pointee::Void),
            origin,
        );
        Ok((queried, Some(queried)))
    }

    /// The interface [`Self::via_receiver`] asked for, given back.
    pub(super) fn release_via(&mut self, id: NodeId, queried: Option<ValueId>) {
        if let Some(queried) = queried {
            let origin = self.origin(id);
            self.runtime_call("nts_com_release", vec![queried], HirType::Void, origin);
        }
    }

    /// A closure as the C function pointer C calls it through: a bridge with
    /// the `bridge` signature, the closure's context last, converted to the
    /// parameter's own type `want` where they differ -- an `ErasedClosure`'s
    /// parameter is `GCallback`, the same code address, which C casts back to
    /// the signature it calls it with.
    pub(super) fn bridge_closure(
        &mut self,
        id: NodeId,
        closure: ValueId,
        (bridge, bridging): (
            &std::sync::Arc<crate::hir::native::FnPointer>,
            crate::hir::Bridging,
        ),
        once: bool,
        want: HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        // Dispatched statically through the closure's own layout where an
        // arrow or function expression gives it one, and through its table
        // where the value is of a bare function type. Anything else is not
        // a closure at all.
        if !matches!(
            self.values[closure.0 as usize].ty,
            HirType::Managed(ManagedType::Object(_))
        ) {
            return Err(self.unsupported(
                id,
                "a closure passed to C whose body is not known here: write the function or arrow at the call, or bind it with `const` in the same function",
            ));
        }
        let bridging = self.with_conversions(closure, bridge, bridging);
        let bridged = self.push(
            OpKind::NativeBridge {
                closure,
                signature: bridge.clone(),
                context: true,
                once,
                bridging,
            },
            HirType::NativePointer(crate::hir::native::Pointee::FnPointer(bridge.clone())),
            origin.clone(),
        );
        Ok(if self.values[bridged.0 as usize].ty == want {
            bridged
        } else {
            self.push(OpKind::Convert(bridged), want, origin.clone())
        })
    }

    /// A closure as an Objective-C block: the trampoline into its body, the
    /// closure lent for the call (a callee that keeps the block copies it and
    /// lends it again), and the block in this frame holding both.
    /// `None` for an argument the call does not pass.
    /// `bridging`, with a function of this program's ([`Conversion`],
    /// requested here and made once each) converting each argument C passes
    /// that the closure takes as something else:
    ///
    /// - a sequence where the closure takes an array: lib.dom's
    ///   `MutationObserver` callback `(records: MutationRecord[]) => void`,
    ///   where nts:dom passes a `MutationRecordSequence` -- a new array each
    ///   call, as `WebIDL` makes one of a `sequence<T>` for page script;
    /// - a 64-bit integer where the closure takes a number (`AsNumber<C>`,
    ///   GIO's `FileProgressCallback`): exactly, or a `RangeError` past 2^53,
    ///   as a call's result is read.
    ///
    /// Read off the closure's arrow, its parameters as the program types them:
    /// the bridge carries only C's types, and what the closure takes is the
    /// program's. A sequence whose type is not found, or whose element is not
    /// a handle, is left as it was, and `bridges::check` refuses it.
    fn with_conversions(
        &mut self,
        closure: ValueId,
        bridge: &crate::hir::native::FnPointer,
        mut bridging: crate::hir::Bridging,
    ) -> crate::hir::Bridging {
        let HirType::Managed(ManagedType::Object(ty)) = self.values[closure.0 as usize].ty else {
            return bridging;
        };
        let Some(arrow) = self.closures.get(closure_index(ty)).map(|info| info.node) else {
            return bridging;
        };
        let Some(TypeKind::Function(signature)) = self
            .snapshot
            .node_types
            .get(&arrow)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .map(|record| &record.kind)
        else {
            return bridging;
        };
        let parameters = self.snapshot.signatures[signature.0 as usize]
            .parameters
            .clone();
        for (at, foreign) in bridge.parameters.iter().enumerate() {
            let crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Opaque(handle)) =
                foreign
            else {
                continue;
            };
            if bridging.boxed(at).is_some() || bridging.array(at).is_some() {
                continue;
            }
            let Some(parameter) = bridging
                .parameter(at)
                .and_then(|parameter| parameters.get(parameter))
            else {
                continue;
            };
            let Some(array) = self.represent(parameter.ty) else {
                continue;
            };
            let HirType::Managed(ManagedType::Array(element)) = &array else {
                continue;
            };
            let HirType::NativePointer(crate::hir::native::Pointee::Opaque(element)) = &**element
            else {
                continue;
            };
            let Some(sequence) = self.sequence_type_of(handle) else {
                continue;
            };
            let function = format!("nts_sequence_{}_as_{}", handle.tag, element.tag);
            self.request_conversion(
                &mut bridging,
                at,
                function,
                Converts::SequenceArray { sequence, array },
                arrow,
            );
        }
        for (at, foreign) in bridge.parameters.iter().enumerate() {
            let crate::hir::native::Type::Scalar(kind) = foreign else {
                continue;
            };
            if !kind.needs_exact_integer() {
                continue;
            }
            let Some(parameter) = bridging
                .parameter(at)
                .and_then(|parameter| parameters.get(parameter))
            else {
                continue;
            };
            if self.represent(parameter.ty) != Some(HirType::NUMBER) {
                continue;
            }
            let integer = foreign.representation();
            let HirType::Int { signed, .. } = integer else {
                continue;
            };
            let function = format!("nts_exact_number_{}", if signed { "i64" } else { "u64" });
            self.request_conversion(
                &mut bridging,
                at,
                function,
                Converts::ExactNumber { integer },
                arrow,
            );
        }
        bridging
    }

    /// C's argument `at` converted by `function`, made once per program.
    fn request_conversion(
        &mut self,
        bridging: &mut crate::hir::Bridging,
        at: usize,
        function: String,
        converts: Converts,
        site: NodeId,
    ) {
        if !self
            .conversions
            .iter()
            .any(|request| request.name == function)
        {
            self.conversions.push(Conversion {
                name: function.clone(),
                converts,
                site,
            });
        }
        bridging.converted.push(crate::hir::ConvertedParameter {
            at: u32::try_from(at).unwrap_or(u32::MAX),
            function,
        });
    }

    /// The type whose handle `handle` is, where it is a sequence: `length`
    /// and `item` (`array_of_sequence`). Searched rather than carried, since
    /// a bridge holds C's types only; asked only for a bridge whose closure
    /// takes an array where C passes a handle.
    fn sequence_type_of(&self, handle: &crate::hir::native::Handle) -> Option<TypeId> {
        (0..self.snapshot.types.len()).filter_map(|at| u32::try_from(at).ok().map(TypeId)).find(|ty| {
            matches!(crate::hir::native::pointer(self.snapshot, *ty), Some(crate::hir::native::Pointee::Opaque(found)) if found.tag == handle.tag)
                && self.walk_method(*ty, "item").is_some()
                && self.walk_method(*ty, "_get_length").is_some()
        })
    }

    /// A function made to convert an argument C passes to a bridge
    /// ([`Self::with_conversions`]): its one parameter what C passes, its
    /// result what the closure takes.
    fn lower_conversion(&mut self, request: &Conversion) -> Result<Func, Diagnostic> {
        match &request.converts {
            Converts::SequenceArray { sequence, array } => {
                self.lower_sequence_array(request, *sequence, array.clone())
            }
            Converts::ExactNumber { integer } => {
                let origin = self.origin(request.site);
                let params = vec![Param {
                    name: "integer".to_owned(),
                    shape: ParamShape::Ordinary,
                    ty: integer.clone(),
                    origin: origin.clone(),
                    known: Facts::TOP,
                    written: None,
                }];
                let passed = self.push(OpKind::Param(0), integer.clone(), origin.clone());
                let number = self.exact_as_number(request.site, passed, "C passed a callback")?;
                self.terminate(Terminator::Return(Some(number)));
                Ok(self.finish(request.name.clone(), params, HirType::NUMBER, origin, false))
            }
        }
    }

    /// The array of a sequence's items, for a bridge: its one parameter the
    /// sequence.
    fn lower_sequence_array(
        &mut self,
        request: &Conversion,
        sequence: TypeId,
        array: HirType,
    ) -> Result<Func, Diagnostic> {
        let origin = self.origin(request.site);
        let taken = self
            .represent(sequence)
            .ok_or_else(|| self.unrepresentable(request.site, "a sequence a bridge passes"))?;
        let params = vec![Param {
            name: "sequence".to_owned(),
            shape: ParamShape::Ordinary,
            ty: taken.clone(),
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let passed = self.push(OpKind::Param(0), taken, origin.clone());
        let made = self.array_of_sequence(request.site, passed, sequence, array.clone())?;
        self.terminate(Terminator::Return(Some(made)));
        Ok(self.finish(request.name.clone(), params, array, origin, false))
    }

    pub(super) fn lend_block(
        &mut self,
        id: NodeId,
        closure: Option<ValueId>,
        (bridge, signature): (
            std::sync::Arc<crate::hir::native::FnPointer>,
            std::sync::Arc<crate::hir::native::FnPointer>,
        ),
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(closure) = closure else {
            return Ok(None);
        };
        let invoke = self.bridge_closure(
            id,
            closure,
            (&bridge, crate::hir::Bridging::default()),
            false,
            HirType::NativePointer(crate::hir::native::Pointee::FnPointer(bridge.clone())),
            origin,
        )?;
        let context = self.runtime_call(
            "nts_closure_lend",
            vec![closure],
            HirType::NativePointer(crate::hir::native::Pointee::Void),
            origin.clone(),
        );
        lent.push(Lent::Closure { context });
        let block = self.push(
            OpKind::NativeBlock {
                invoke,
                context,
                signature,
            },
            want.clone(),
            origin.clone(),
        );
        // Swift's `completion: nil`: a closure that is `null` is a NULL block,
        // not a block around nothing, which the callee would call and which
        // would call through a NULL closure. Lending and releasing a NULL
        // closure do nothing, so only the pointer passed is chosen.
        let void = HirType::NativePointer(crate::hir::native::Pointee::Void);
        let none = self.push(OpKind::ConstNull, void.clone(), origin.clone());
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: context,
                rhs: none,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (nil, given, joined) = (self.new_block(), self.new_block(), self.new_block());
        let passed = self.push_block_param(joined, want.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: nil,
            then_args: Vec::new(),
            else_target: given,
            else_args: Vec::new(),
        });
        self.switch_to(nil);
        let null_block = self.push(OpKind::ConstNull, want, origin.clone());
        self.terminate(Terminator::Jump {
            target: joined,
            args: vec![null_block],
        });
        self.switch_to(given);
        self.terminate(Terminator::Jump {
            target: joined,
            args: vec![block],
        });
        self.switch_to(joined);
        Ok(Some(passed))
    }

    /// Turn each argument for a C function pointer parameter into a bridge.
    ///
    /// A TypeScript function value is a managed closure object, and the
    /// specializer converts every native argument to its parameter's
    /// `representation()` -- one machine word for a code pointer. Left alone
    /// that took the closure's *heap address* and handed it to C as something
    /// to call: a wrong answer that compiles, and one the witness cannot see,
    /// because the emitted prototype and the real header agree about the
    /// parameter. Only the value was wrong.
    ///
    /// So the value becomes a `NativeBridge`, which a backend emits as a real
    /// function with the foreign signature.
    ///
    /// **Non-capturing only, and checked by construction.** The argument's
    /// producing operation must be `ClosureStatic`, which is the closure with
    /// no captured environment. A capturing one has state that a bare C
    /// function pointer has nowhere to put; giving it one means a context
    /// parameter the callee agrees to carry, and no C signature implies that.
    /// Refused here rather than bridged into something that reads freed stack.
    /// One closure, as a real C function with the declared signature.
    ///
    /// The same construction `bridge_callback_arguments` makes for a call, in
    /// the one other place a function crosses into C: a store into a
    /// function-pointer member. Non-capturing only, checked the same way --
    /// see that function for why.
    pub(super) fn bridged(
        &mut self,
        at: NodeId,
        value: ValueId,
        signature: &std::sync::Arc<crate::hir::native::FnPointer>,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(null) = self.null_function_pointer(at, value, signature) {
            return Ok(null);
        }
        if !matches!(self.values[value.0 as usize].kind, OpKind::ClosureStatic) {
            return Err(self.unsupported(
                at,
                "a C function pointer needs a function declared with `function`: an inline function or arrow capturing anything has state a bare C function pointer has nowhere to put",
            ));
        }
        let origin = self.origin(at);
        Ok(self.push(
            OpKind::NativeBridge {
                closure: value,
                signature: signature.clone(),
                context: false,
                once: false,
                bridging: crate::hir::Bridging::default(),
            },
            HirType::NativePointer(crate::hir::native::Pointee::FnPointer(signature.clone())),
            origin,
        ))
    }

    /// `null` where a C function pointer goes, as the NULL function pointer.
    ///
    /// Only the literal: a binding that says `F | null` has told us C accepts
    /// NULL there. A value that is a function on one path and `null` on another
    /// would need a bridge chosen at run time, which nothing builds, so it is
    /// left to the refusal below, which names the function it wanted.
    fn null_function_pointer(
        &mut self,
        at: NodeId,
        value: ValueId,
        signature: &std::sync::Arc<crate::hir::native::FnPointer>,
    ) -> Option<ValueId> {
        let mut source = value;
        while let OpKind::Convert(inner) = self.values[source.0 as usize].kind {
            source = inner;
        }
        if !matches!(self.values[source.0 as usize].kind, OpKind::ConstNull) {
            return None;
        }
        let origin = self.origin(at);
        Some(self.push(
            OpKind::ConstNull,
            HirType::NativePointer(crate::hir::native::Pointee::FnPointer(signature.clone())),
            origin,
        ))
    }

    pub(super) fn bridge_callback_arguments(
        &mut self,
        call: NodeId,
        target: &crate::hir::native::Function,
        args: &mut [ValueId],
    ) -> Result<(), Diagnostic> {
        for (at, parameter) in target.parameters.iter().enumerate() {
            let crate::hir::native::Type::FnPointer(signature) = parameter else {
                continue;
            };
            // Bridged above with a context, or supplied by the runtime.
            if !matches!(target.roles.get(at), Some(crate::hir::native::Role::Plain)) {
                continue;
            }
            let Some(argument) = args.get_mut(at) else {
                continue;
            };
            if let Some(null) = self.null_function_pointer(call, *argument, signature) {
                *argument = null;
                continue;
            }
            if !matches!(self.values[argument.0 as usize].kind, OpKind::ClosureStatic) {
                return Err(self.unsupported(
                    call,
                    "a C function pointer needs a function declared with `function`: an inline function expression is allocated as a closure object, and if it captures anything there is nowhere to put that in a bare code pointer",
                ));
            }
            let origin = self.origin(call);
            // Typed as the function pointer it is, not as `void *`.
            //
            // `void *` was close enough to compile and is not what C says: the
            // emitted program assigned a *function* to a `void *` and passed a
            // `void *` where `NtsFn_int_int` was wanted, neither of which is a
            // conversion ISO C performs. `-pedantic-errors` reported ten of
            // them in `native-callback` alone. It is also the imprecision that
            // let a closure's heap address reach C as something to call, before
            // bridges existed -- a `void *` says nothing a wrong value would
            // contradict.
            let bridging =
                self.with_conversions(*argument, signature, crate::hir::Bridging::default());
            *argument = self.push(
                OpKind::NativeBridge {
                    closure: *argument,
                    signature: signature.clone(),
                    context: false,
                    once: false,
                    bridging,
                },
                HirType::NativePointer(crate::hir::native::Pointee::FnPointer(signature.clone())),
                origin,
            );
        }
        Ok(())
    }
}
