//! Marshal native strings, handles, records, and Foundation collection values in both directions.

use super::{
    Absent, ArrayFill, BinOp, Callee, Diagnostic, Facts, Field, FuncBuilder, HirType, Layout, Lent,
    ManagedType, NodeId, OpKind, Origin, Param, ParamShape, SemanticSnapshot, Terminator, TypeId,
    TypeKind, ValueId, bridge_send,
};

/// Which strings a call bridges to `NSString`s: see [`bridge_strings`].
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum StringsBridged {
    /// A message's: a plain `string`, or a `BridgedString`.
    Plain,
    /// A C function's: a `BridgedString` only.
    Branded,
}

/// Swift's `String` at an Objective-C message: a plain `string` parameter is
/// an `NSString` (`Role::NSString`), and a plain `string` result is one the
/// program reads back as text. A `CString` stays a C string, and so does
/// what a C function takes -- unless its binding says `BridgedString`, where
/// the header's type is `NSString *`.
pub(super) fn bridge_strings(
    native: &mut crate::hir::native::Function,
    signature: &nts_semantic_schema::SignatureRecord,
    snapshot: &SemanticSnapshot,
    which: StringsBridged,
) {
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    let branded = |id: TypeId| {
        match kind(id) {
        Some(TypeKind::Intersection(parts)) => parts.iter().any(|part| {
            matches!(kind(*part), Some(TypeKind::Object { properties }) if properties.iter().any(|p| p.name.is_name("__objc_nsstring")))
        }),
        _ => false,
    }
    };
    let text = |id: TypeId| match which {
        StringsBridged::Plain => matches!(kind(id), Some(TypeKind::String)) || branded(id),
        StringsBridged::Branded => branded(id),
    };
    let plain = |ty: TypeId| match kind(ty) {
        Some(TypeKind::Union(parts)) => {
            parts.iter().any(|part| text(*part))
                && parts
                    .iter()
                    .all(|part| text(*part) || matches!(kind(*part), Some(TypeKind::Null)))
        }
        _ => text(ty),
    };
    let utf8 = crate::hir::native::Role::String(crate::hir::native::Encoding::Utf8);
    let ns_string = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Opaque(
        crate::hir::native::Handle::ns_string(),
    ));
    let slots: Vec<(usize, Option<usize>)> = native.slots().map(|(at, _, fed)| (at, fed)).collect();
    for (at, fed) in slots {
        let Some(parameter) = fed.and_then(|ts| signature.parameters.get(ts)) else {
            continue;
        };
        match &mut native.roles[at] {
            role if *role == utf8 && plain(parameter.ty) => {
                *role = crate::hir::native::Role::NSString;
                native.parameters[at] = ns_string.clone();
            }
            // A label is the property of the parameter's object type that
            // its key names, and crosses as that property's type says.
            crate::hir::native::Role::Label { key, inner, .. } if **inner == utf8 => {
                let key = key.clone();
                let label = crate::hir::native::labels_of(snapshot, parameter.ty)
                    .and_then(|labels| labels.into_iter().find(|(named, _)| *named == key));
                if label.is_some_and(|(_, ty)| plain(ty)) {
                    **inner = crate::hir::native::Role::NSString;
                    native.parameters[at] = ns_string.clone();
                }
            }
            _ => {}
        }
    }
    if native
        .returns_string
        .as_ref()
        .is_some_and(|returned| !returned.array)
        && plain(signature.return_type)
    {
        native.result = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Opaque(
            crate::hir::native::Handle::ns_string(),
        ));
    }
    // A message's `string[]` is Swift's `[String]`, an `NSArray` of
    // `NSString`s, where a C function's is a NULL-terminated `char **`.
    if which == StringsBridged::Plain
        && native
            .returns_string
            .as_ref()
            .is_some_and(|returned| returned.array)
    {
        native.returns_string = None;
        native.returns_array = Some(crate::hir::native::Bridged::String);
        native.result = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Opaque(
            crate::hir::native::Handle::objc("NSArray"),
        ));
    }
}

impl FuncBuilder<'_> {
    /// A counted handle in the box a promise holds it in
    /// ([`crate::hir::native::handle_box`]): stored as the family's root, whose
    /// release the box's descriptor calls when the box dies.
    pub(super) fn box_handle(
        &mut self,
        id: NodeId,
        value: ValueId,
        pointee: &crate::hir::native::Pointee,
    ) -> Result<(ValueId, TypeId), Diagnostic> {
        let origin = self.origin(id);
        let boxed = self.boxed(value, pointee, &origin).ok_or_else(|| {
            self.unsupported(
                id,
                "a promise settling with a counted handle of a family with no box",
            )
        })?;
        let HirType::Managed(ManagedType::Object(ty)) = self.values[boxed.0 as usize].ty else {
            return Err(self.unsupported(id, "a handle box that is not an object"));
        };
        Ok((boxed, ty))
    }

    /// The box of a handle's family: its type, with its layout recorded, and
    /// the family's root the box's one field is typed as.
    pub(super) fn handle_box_layout(
        &mut self,
        pointee: &crate::hir::native::Pointee,
    ) -> Option<(TypeId, crate::hir::native::Pointee)> {
        let (ty, root, name) = pointee.family().and_then(crate::hir::native::handle_box)?;
        if !self.layouts.iter().any(|layout| layout.types.contains(&ty)) {
            self.layouts.push(Layout {
                types: vec![ty],
                name: name.to_owned(),
                interfaces: Vec::new(),
                fields: vec![Field {
                    name: ("handle".to_owned()).into(),
                    ty: HirType::NativePointer(root.clone()),
                    readonly: true,
                    declared_by: None,
                    written: None,
                }],
                methods: vec![None; self.hierarchy.table_size()],
                base: None,
            });
        }
        Some((ty, root))
    }

    /// The return type a function or method declaration declares, as the
    /// checker's type.
    pub(super) fn declared_result_type(&self, declaration: NodeId) -> Option<TypeId> {
        if let Some((body, contract)) = self.selected_result
            && body == declaration
        {
            return self
                .snapshot
                .signatures
                .get(contract.resolved.0 as usize)
                .map(|s| s.return_type);
        }
        let ty = std::iter::once(declaration)
            .chain(self.children(declaration))
            .find_map(|node| self.snapshot.node_types.get(&node).copied())?;
        match self.snapshot.types.get(ty.0 as usize).map(|t| &t.kind) {
            Some(TypeKind::Function(signature)) => {
                Some(self.snapshot.signatures[signature.0 as usize].return_type)
            }
            _ => None,
        }
    }

    /// The layout of the box a `GLib` boxed record lives in (`BOXED_RECORD`):
    /// the runtime's `NtsBoxed`, `{ boxed, free, data }` after the header,
    /// which the runtime makes and frees (`nts_boxed_new`, `NTS_KIND_BOXED`),
    /// and whose first field the program reads. The C backend asserts it
    /// against `NtsBoxed`.
    pub(super) fn boxed_record_layout(&mut self) -> TypeId {
        let ty = TypeId(crate::hir::BOXED_RECORD);
        if !self.layouts.iter().any(|layout| layout.types.contains(&ty)) {
            let field = |name: &str, ty: HirType| Field {
                name: (name.to_owned()).into(),
                ty,
                readonly: true,
                declared_by: None,
                written: None,
            };
            let pointer = HirType::NativePointer(crate::hir::native::Pointee::Void);
            self.layouts.push(Layout {
                types: vec![ty],
                name: "BoxedRecord".to_owned(),
                interfaces: Vec::new(),
                fields: vec![
                    field("boxed", pointer.clone()),
                    field("free", pointer),
                    field(
                        "data",
                        HirType::Int {
                            bits: 64,
                            signed: false,
                        },
                    ),
                ],
                methods: vec![None; self.hierarchy.table_size()],
                base: None,
            });
        }
        ty
    }

    /// A plain argument as C takes it: a boxed record's box where C takes the
    /// struct's pointer -- lent for the call, since a box whose pointer is
    /// passed must live until C is done with it -- and anything else as it is.
    ///
    /// A `number` where C takes an integer is converted with the call's other
    /// arguments (`specialize`), and C's own conversion is exact there: the
    /// strict check proved the value fits (`docs/records/notebooks/scalar-numbers.md`, D1), so
    /// no wrapping conversion stands in for a proof.
    pub(super) fn unboxed_argument(
        &mut self,
        value: ValueId,
        parameter: &crate::hir::native::Type,
        origin: &Origin,
    ) -> ValueId {
        if self.values[value.0 as usize].ty
            != HirType::Managed(ManagedType::Object(TypeId(crate::hir::BOXED_RECORD)))
        {
            return value;
        }
        self.unbox_record(value, &parameter.representation(), origin)
    }

    /// The struct a boxed record's box holds, as the C pointer `want` a
    /// function takes: its first field, or NULL for a null box. Recorded
    /// against the box, so the call passing it lends the box.
    pub(super) fn unbox_record(
        &mut self,
        boxed: ValueId,
        want: &HirType,
        origin: &Origin,
    ) -> ValueId {
        self.boxed_record_layout();
        let box_ty = self.values[boxed.0 as usize].ty.clone();
        let null = self.push(OpKind::ConstNull, box_ty, origin.clone());
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: boxed,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, want.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let raw = self.push(
            OpKind::FieldGet {
                object: boxed,
                field: 0,
            },
            HirType::NativePointer(crate::hir::native::Pointee::Void),
            origin.clone(),
        );
        let pointer = self.push(OpKind::Convert(raw), want.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![pointer],
        });
        self.switch_to(merge);
        self.unboxed.insert(result, boxed);
        result
    }

    /// A boxed record a C function returned, in a box of the program's: as
    /// it is where the function handed it over (`Owned`), or a copy of it
    /// where the function lent it -- the box frees what it holds -- by the
    /// record's `GType`. A NULL result is `null`.
    pub(super) fn box_record(
        &mut self,
        id: NodeId,
        pointer: ValueId,
        record: &crate::hir::native::schema::BoxedRecord,
        owned: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = HirType::Managed(ManagedType::Object(self.boxed_record_layout()));
        let gtype = self.call_foreign_named(id, &record.get_type, Vec::new())?;
        let origin = self.origin(id);
        let helper = if owned {
            "nts_gobject_boxed"
        } else {
            "nts_gobject_boxed_copy"
        };
        Ok(self.runtime_call(helper, vec![pointer, gtype], ty, origin))
    }

    /// `new GtkTextIter()`: a zeroed boxed record of the size the headers
    /// give it, for C to fill, in a box of the program's.
    pub(super) fn new_boxed_record(
        &mut self,
        id: NodeId,
        record: &crate::hir::native::schema::BoxedRecord,
    ) -> Result<ValueId, Diagnostic> {
        if record.size == 0 {
            return Err(self.unsupported(
                id,
                "`new` of a boxed record whose struct the headers keep opaque",
            ));
        }
        let ty = HirType::Managed(ManagedType::Object(self.boxed_record_layout()));
        let gtype = self.call_foreign_named(id, &record.get_type, Vec::new())?;
        let origin = self.origin(id);
        let size = self.push(
            OpKind::ConstInt(i128::from(record.size)),
            HirType::Int {
                bits: 64,
                signed: false,
            },
            origin.clone(),
        );
        Ok(self.runtime_call("nts_gobject_boxed_new", vec![gtype, size], ty, origin))
    }

    /// An override's string argument, lent by the Windows Runtime as its
    /// `HSTRING`: the parameter is the handle, and the name the string its
    /// text is copied into, which this function then owns. `None` for any
    /// other parameter.
    pub(super) fn lent_hstring_param(
        &mut self,
        name_node: NodeId,
        index: u32,
        name: &str,
        ty: &HirType,
    ) -> Option<Param> {
        if !self
            .com_entry
            .is_some_and(|entry| index < 64 && entry.hstrings & (1u64 << index) != 0)
        {
            return None;
        }
        let symbol = self.node(name_node).symbol?;
        let origin = self.origin(name_node);
        let handle_ty = HirType::NativePointer(crate::hir::native::Pointee::Void);
        let handle = self.push(OpKind::Param(index), handle_ty.clone(), origin.clone());
        // Copied once every parameter is in place (`finish_params`): the
        // parameters are the function's first values, in order.
        self.pending_hstrings
            .push((symbol.0, handle, name_node, ty.clone()));
        Some(Param {
            name: name.to_owned(),
            shape: ParamShape::Ordinary,
            ty: handle_ty,
            origin,
            known: Facts::TOP,
            written: None,
        })
    }

    /// A TypeScript array as the `NSArray` an Objective-C message takes, as
    /// Swift's `[T]` crosses: made for the call by the CF host in one
    /// `CFArrayCreate` over the array's own elements, or over an `NSString`
    /// made of each string, and the caller's (+1), so the program's count
    /// releases it after the send.
    fn ns_array_of(
        &mut self,
        id: NodeId,
        array: ValueId,
        element: &crate::hir::native::Bridged,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::{Bridged, Handle, Pointee, Type};
        if !matches!(
            self.values[array.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_))
        ) {
            return Err(self.unsupported(id, "an `NSArray` argument that is not an array"));
        }
        let helper = match element {
            Bridged::Object(_) => "nts_nsarray_of_objects",
            Bridged::String => "nts_nsarray_of_strings",
        };
        let made = Type::Pointer(Pointee::Opaque(Handle::objc("NSArray")));
        Ok(self.runtime_call(helper, vec![array], made.representation(), origin.clone()))
    }

    /// A `Map<string, V>` as the `NSDictionary` an Objective-C message takes,
    /// as Swift's `[String: V]` crosses: made for the call by the CF host from
    /// the map's entries -- each key an `NSString`, each value the object its
    /// box holds or an `NSString` made of a string -- and the caller's (+1),
    /// so the program's count releases it after the send.
    fn ns_dictionary_of(
        &mut self,
        id: NodeId,
        map: ValueId,
        value: &crate::hir::native::Bridged,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::{Bridged, Handle, Pointee, Type};
        if !matches!(
            self.values[map.0 as usize].ty,
            HirType::Managed(ManagedType::Map(_, _))
        ) {
            return Err(self.unsupported(id, "an `NSDictionary` argument that is not a map"));
        }
        let helper = match value {
            Bridged::Object(_) => "nts_nsdictionary_of_objects",
            Bridged::String => "nts_nsdictionary_of_strings",
        };
        let made = Type::Pointer(Pointee::Opaque(Handle::objc("NSDictionary")));
        Ok(self.runtime_call(helper, vec![map], made.representation(), origin.clone()))
    }

    /// The `NSArray` a message returned, as the TypeScript array the program
    /// reads (Swift's `[T]`): an array of `count` elements, filled by the CF
    /// host in one pass -- the objects, each counted by the array, or a string
    /// copied out of each `NSString`.
    pub(super) fn read_ns_array(
        &mut self,
        id: NodeId,
        returned: ValueId,
        element: &crate::hir::native::Bridged,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::{Bridged, Handle, Pointee, Scalar, Type};
        let origin = self.origin(id);
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(
                id,
                "an `NSArray` result the program does not read as an array",
            ));
        }
        // Swift's `[T]?`: a nil `NSArray` is `null`, and only one that is
        // there is counted and filled.
        let nil = self.push(
            OpKind::ConstNull,
            self.values[returned.0 as usize].ty.clone(),
            origin.clone(),
        );
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: returned,
                rhs: nil,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let array = Type::Pointer(Pointee::Opaque(Handle::objc("NSArray")));
        let count = self.send_bridge(
            bridge_send("count", None, vec![array], Type::Scalar(Scalar::ULong)),
            vec![returned],
            &origin,
        );
        let length = self.coerce(count, &HirType::NUMBER, id)?;
        let out = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            ty,
            origin.clone(),
        );
        let fill = match element {
            Bridged::Object(_) => "nts_array_fill_from_nsarray",
            Bridged::String => "nts_array_fill_strings_from_nsarray",
        };
        self.runtime_call(fill, vec![out, returned], HirType::Void, origin);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![out],
        });
        self.switch_to(merge);
        Ok(result)
    }

    /// The `NSDictionary` a message returned, as the `Map<string, V>` the
    /// program reads (Swift's `[String: V]`), or `null` for nil: its keys
    /// and values filled into two arrays by the CF host in one pass -- each
    /// key a string, each value an object the array counts or a string --
    /// then set into a new map a pair at a time, each object boxed as any
    /// map holds one.
    /// A TypeScript collection as the Foundation one a message takes, as
    /// Swift's `[T]`, `[String: V]` and `Set<T>` cross.
    pub(super) fn foundation_collection(
        &mut self,
        id: NodeId,
        value: ValueId,
        role: &crate::hir::native::Role,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::Role;
        match role {
            Role::NSArray(element) => self.ns_array_of(id, value, element, origin),
            Role::NSDictionary(kind) => self.ns_dictionary_of(id, value, kind, origin),
            Role::NSSet(element) => self.ns_set_of(id, value, element, origin),
            _ => Err(self.unsupported(
                id,
                "a collection a message takes that is not an array, a dictionary or a set",
            )),
        }
    }

    /// A `Set<T>` as the `NSSet` a message takes, as Swift's `Set<T>` crosses:
    /// made of the elements (`nts_nsset_of_*`), +1, released after the call.
    fn ns_set_of(
        &mut self,
        id: NodeId,
        set: ValueId,
        element: &crate::hir::native::Bridged,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::{Bridged, Handle, Pointee, Type};
        if !matches!(
            self.values[set.0 as usize].ty,
            HirType::Managed(ManagedType::Set(_))
        ) {
            return Err(self.unsupported(id, "an `NSSet` argument that is not a set"));
        }
        let helper = match element {
            Bridged::Object(_) => "nts_nsset_of_objects",
            Bridged::String => "nts_nsset_of_strings",
        };
        let made = Type::Pointer(Pointee::Opaque(Handle::objc("NSSet")));
        Ok(self.runtime_call(helper, vec![set], made.representation(), origin.clone()))
    }

    /// An `NSSet` a message returns, read as a `Set<T>`: its `allObjects`,
    /// read as an array is, then each added -- an object in its family's
    /// box, which the set hashes and compares by `-hash` and `-isEqual:`. A
    /// nil set is `null`.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn read_ns_set(
        &mut self,
        id: NodeId,
        returned: ValueId,
        element: &crate::hir::native::Bridged,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::{Handle, Pointee, Type};
        let origin = self.origin(id);
        let HirType::Managed(ManagedType::Set(element_ty)) = ty.clone() else {
            return Err(
                self.unsupported(id, "an `NSSet` result the program does not read as a set")
            );
        };
        let nil = self.push(
            OpKind::ConstNull,
            self.values[returned.0 as usize].ty.clone(),
            origin.clone(),
        );
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: returned,
                rhs: nil,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let set_type = Type::Pointer(Pointee::Opaque(Handle::objc("NSSet")));
        let array_type = Type::Pointer(Pointee::Opaque(Handle::objc("NSArray")));
        let all = self.send_bridge(
            bridge_send("allObjects", None, vec![set_type], array_type),
            vec![returned],
            &origin,
        );
        let items = self.read_ns_array(
            id,
            all,
            element,
            HirType::Managed(ManagedType::Array(element_ty.clone())),
        )?;
        let kind = self.push(
            OpKind::ConstFloat(f64::from(crate::hir::tables::key_kind(&element_ty))),
            HirType::NUMBER,
            origin.clone(),
        );
        let set = self.runtime_call("nts_set_new", vec![kind], ty.clone(), origin.clone());
        // `for (const item of items) set.add(item)`.
        let length = self.push(OpKind::Length(items), HirType::NUMBER, origin.clone());
        let (head, body, done) = (self.new_block(), self.new_block(), self.new_block());
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![zero],
        });
        self.switch_to(head);
        let at = self.push_block_param(head, HirType::NUMBER, origin.clone());
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: done,
            else_args: Vec::new(),
        });
        self.switch_to(body);
        let item = self.push(
            OpKind::ArrayGet {
                array: items,
                index: at,
                checked: false,
            },
            (*element_ty).clone(),
            origin.clone(),
        );
        // An `NSSet` holds no `nil`.
        let key = self.erased(item, Absent::Impossible, &origin);
        self.keyed_call(
            "nts_set_add",
            &ty.clone(),
            vec![set, key],
            ty,
            origin.clone(),
        );
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: at,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![next],
        });
        self.switch_to(done);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![set],
        });
        self.switch_to(merge);
        Ok(result)
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn read_ns_dictionary(
        &mut self,
        id: NodeId,
        returned: ValueId,
        value: &crate::hir::native::Bridged,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::{Bridged, Handle, Pointee, Scalar, Type};
        let origin = self.origin(id);
        let HirType::Managed(ManagedType::Map(key_ty, value_ty)) = ty.clone() else {
            return Err(self.unsupported(
                id,
                "an `NSDictionary` result the program does not read as a map",
            ));
        };
        let nil = self.push(
            OpKind::ConstNull,
            self.values[returned.0 as usize].ty.clone(),
            origin.clone(),
        );
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: returned,
                rhs: nil,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let dictionary = Type::Pointer(Pointee::Opaque(Handle::objc("NSDictionary")));
        let count = self.send_bridge(
            bridge_send("count", None, vec![dictionary], Type::Scalar(Scalar::ULong)),
            vec![returned],
            &origin,
        );
        let length = self.coerce(count, &HirType::NUMBER, id)?;
        let keys = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            HirType::Managed(ManagedType::Array(key_ty.clone())),
            origin.clone(),
        );
        let values = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            HirType::Managed(ManagedType::Array(value_ty.clone())),
            origin.clone(),
        );
        let fill = match value {
            Bridged::Object(_) => "nts_dictionary_fill_from_nsdictionary",
            Bridged::String => "nts_dictionary_fill_strings_from_nsdictionary",
        };
        self.runtime_call(
            fill,
            vec![keys, values, returned],
            HirType::Void,
            origin.clone(),
        );
        let kind = self.push(
            OpKind::ConstFloat(f64::from(crate::hir::tables::key_kind(&key_ty))),
            HirType::NUMBER,
            origin.clone(),
        );
        // A table where the binding types the dictionary as an object, a `Map`
        // where it says `Map`: the two print differently (`nts_desc_table`).
        let allocate = if matches!(ty, HirType::Managed(ManagedType::Table(_, _))) {
            "nts_table_new"
        } else {
            "nts_map_new"
        };
        let map = self.runtime_call(allocate, vec![kind], ty.clone(), origin.clone());
        // `for (let at = 0; at < length; at++) map.set(keys[at], values[at])`.
        let (head, body, done) = (self.new_block(), self.new_block(), self.new_block());
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![zero],
        });
        self.switch_to(head);
        let at = self.push_block_param(head, HirType::NUMBER, origin.clone());
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: done,
            else_args: Vec::new(),
        });
        self.switch_to(body);
        let key = self.push(
            OpKind::ArrayGet {
                array: keys,
                index: at,
                checked: false,
            },
            (*key_ty).clone(),
            origin.clone(),
        );
        let entry = self.push(
            OpKind::ArrayGet {
                array: values,
                index: at,
                checked: false,
            },
            (*value_ty).clone(),
            origin.clone(),
        );
        // An `NSDictionary` holds no `nil`, as a key or as a value.
        let key = self.erased(key, Absent::Impossible, &origin);
        let entry = self.erased(entry, Absent::Impossible, &origin);
        self.keyed_call(
            "nts_map_set",
            &ty.clone(),
            vec![map, key, entry],
            ty,
            origin.clone(),
        );
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: at,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![next],
        });
        self.switch_to(done);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![map],
        });
        self.switch_to(merge);
        Ok(result)
    }

    /// A `string` as the `NSString` an Objective-C message takes, as Swift's
    /// `String` crosses: made by the CF host from the string's own storage,
    /// one-byte or two-byte as it is (`nts_nsstring_of`), and the caller's
    /// (+1), so the program's count releases it once the message is sent.
    pub(super) fn ns_string_of(&mut self, string: ValueId, origin: &Origin) -> ValueId {
        let object = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Opaque(
            crate::hir::native::Handle::ns_string(),
        ));
        self.runtime_call(
            "nts_nsstring_of",
            vec![string],
            object.representation(),
            origin.clone(),
        )
    }

    pub(super) fn read_native_string(
        &mut self,
        id: NodeId,
        pointer: ValueId,
        target: &crate::hir::native::Function,
        string: &crate::hir::native::ReturnedString,
        typed: Option<HirType>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        // A message that returns an `NSString` the program reads as a
        // `string`, as Swift's `String`: copied by the CF host from its own
        // storage, the eight-bit bytes as they are where it has them. A nil
        // object is `null`. A C function's `BridgedString` result is one too
        // (`bridge_strings`), and not the `char *` its `string` would be.
        let ns_string = matches!(&target.result, crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Opaque(handle)) if *handle == crate::hir::native::Handle::ns_string());
        if (target.send.is_some()
            && matches!(
                target.result,
                crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Opaque(_))
            ))
            || ns_string
        {
            let ty = typed
                .or_else(|| self.type_of(id))
                .ok_or_else(|| self.unrepresentable(id, "a returned string"))?;
            return Ok(self.runtime_call("nts_string_of_nsstring", vec![pointer], ty, origin));
        }
        let value = if string.view {
            // C's view holds only until C is called again, so it is copied
            // now, exactly, at the narrowest width that holds it.
            let ty = typed
                .or_else(|| self.type_of(id))
                .ok_or_else(|| self.unrepresentable(id, "a returned string"))?;
            let copy = if string.nullable {
                "nts_string_from_view"
            } else {
                "nts_string_from_required_view"
            };
            self.runtime_call(copy, vec![pointer], ty, origin.clone())
        } else if string.array {
            // Every element copied, so the array is the program's whatever C
            // does with its own afterwards. `required` is the declaration's
            // promise that C returns one, which a NULL breaks.
            let required = self.push(
                OpKind::ConstBool(!string.nullable),
                HirType::Bool,
                origin.clone(),
            );
            let ty = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
                ManagedType::String,
            ))));
            self.runtime_call(
                "nts_strings_from_cstrings",
                vec![pointer, required],
                ty,
                origin.clone(),
            )
        } else {
            let ty = typed
                .or_else(|| self.type_of(id))
                .ok_or_else(|| self.unrepresentable(id, "a returned string"))?;
            let copy = if string.nullable {
                "nts_string_from_cstring"
            } else {
                "nts_string_from_required_cstring"
            };
            self.runtime_call(copy, vec![pointer], ty, origin.clone())
        };
        if let Some(free) = &string.free {
            let release = crate::hir::native::Function {
                thunk: None,
                name: free.clone(),
                convention: crate::hir::native::Convention::C,
                parameters: vec![if string.array {
                    target.result.clone()
                } else {
                    crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Void)
                }],
                result: crate::hir::native::Type::Void,
                retention: vec![crate::hir::native::Retention::Unknown],
                variadic: None,
                // The same header as the function that returned the string:
                // a library's free function is declared where its allocator's
                // results are.
                declared_at: target.declared_at,
                roles: vec![crate::hir::native::Role::Plain],
                returns_string: None,
                returns_array: None,
                returns_dictionary: None,
                returns_set: None,
                send: None,
                returns_owned: false,
                consumes: Vec::new(),
                frameworks: Vec::new(),
                libraries: Vec::new(),
                defaults: Vec::new(),
                result_as: None,
                vtable: None,
                hresult: false,
                result_as_number: false,
            };
            self.push(
                OpKind::Call {
                    callee: Callee::Native(std::sync::Arc::new(release)),
                    args: vec![pointer],
                    frame: None,
                },
                HirType::Void,
                origin,
            );
        }
        Ok(value)
    }

    /// Give back everything a native call was lent -- C strings and scoped
    /// closures' contexts -- now that it returned.
    ///
    /// Immediately after the call and in the same block, so nothing on the
    /// straight-line path can skip it. **One path does, and it is shared by
    /// both kinds:** a raise from a call sequenced *after* the lend and before
    /// this, inside one `try`, branches to the handler and skips the give-back.
    /// Today nothing sits between them -- the conversions are built as the
    /// arguments, and a native call names no raising copy so gets no test --
    /// but an argument expression that raises after an earlier one was lent
    /// would leak it. A leak, not a crash; whoever fixes it for one kind fixes
    /// it for the other.
    /// A `string` as the C argument its encoding makes of it, lent for the call.
    ///
    /// A conversion -- UTF-8, UTF-16, an `HSTRING` -- is a runtime call whose
    /// result is given back after the call (`give_back`). A view is the string
    /// itself, reinterpreted as the opaque `const NtsBorrowedString *` C reads
    /// with `nts_string_view`: no call and nothing to give back. The pointer
    /// holds no count of its own, so it leans on the string, and the string's
    /// release is placed after the call that reads it.
    /// A string argument lent as [`Self::lend_string`] lends it.
    ///
    /// **A string is lent, and only a string.** A call's own types vouch for
    /// that everywhere but a member lib.dom declares wider than the binding
    /// implementing it: `ctx.fillStyle = gradient` reached
    /// `_set_fillStyle_string(StringView)`, and the gradient's handle was lent
    /// as the string -- a pointer cast, which compiled. Refused here, where
    /// every native call's string passes, rather than at each way of reaching
    /// one.
    pub(super) fn lend_string_argument(
        &mut self,
        id: NodeId,
        string: ValueId,
        encoding: crate::hir::native::Encoding,
        representation: HirType,
        lent: &mut Vec<Lent>,
        origin: Origin,
    ) -> Result<ValueId, Diagnostic> {
        let have = &self.values[string.0 as usize].ty;
        if !matches!(have, HirType::Managed(ManagedType::String)) && *have != representation {
            return Err(self.unsupported(
                id,
                "a value that is not a string, where the native function takes a string",
            ));
        }
        Ok(self.lend_string(string, encoding, representation, lent, origin))
    }

    pub(super) fn lend_string(
        &mut self,
        string: ValueId,
        encoding: crate::hir::native::Encoding,
        representation: HirType,
        lent: &mut Vec<Lent>,
        origin: Origin,
    ) -> ValueId {
        let Some(to_c) = encoding.to_c() else {
            // A view is the string itself, lent (`NativeStringView`). One
            // already at the view's representation is passed on as it is.
            if self.values[string.0 as usize].ty == representation {
                return string;
            }
            return self.push(OpKind::NativeStringView { string }, representation, origin);
        };
        let pointer = self.runtime_call(to_c, vec![string], representation, origin);
        lent.push(Lent::String {
            string,
            pointer,
            encoding,
        });
        pointer
    }

    /// A `string[]` as a block of `HSTRING`s, each lent for the call, NULL for
    /// a `null` array, and all given back after it (`Lent::HStrings`).
    fn lend_hstrings(
        &mut self,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        let block = self.unless_null(array, absent, origin, |this| {
            this.runtime_call("nts_strings_to_hstrings", vec![array], want, origin.clone())
        });
        lent.push(Lent::HStrings { array, block });
        block
    }

    /// An array lent to a call as a block its role makes: a `string[]` as
    /// a `char **` or as `HSTRING`s, NULL for a `null` array, an array of
    /// plain objects as a block of structs -- each converted for the call and
    /// given back after it -- or an array the callee fills: objects in the
    /// array's own block, strings and structs in one of the call's, copied
    /// into the array after it.
    pub(super) fn lend_array(
        &mut self,
        id: NodeId,
        role: &crate::hir::native::Role,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
    ) -> Result<ValueId, Diagnostic> {
        use crate::hir::native::{Pointee, Role};
        let origin = self.origin(id);
        // **Only a `string[]` has strings to convert.** The call is checked
        // against the declaration the program wrote, and a lib.dom member a
        // binding implements is checked against lib.dom's: so `new
        // Blob([blob, blob])` gave a `Blob[]` where nts:dom lends a
        // `string[]`, and `nts_strings_to_cstrings` read each handle as a
        // string (the Chromium lane's
        // lib-dom-a-cstrings-argument-whose-elements-are-not-strings). Refused
        // by name, as `lend_handles` refuses an array of non-handles.
        if matches!(role, Role::Strings | Role::HStrings)
            && !matches!(
                &self.values[array.0 as usize].ty,
                HirType::Managed(ManagedType::Array(element))
                    if **element == HirType::Managed(ManagedType::String)
            )
        {
            return Err(
                self.unsupported(id, "a `CStrings` argument whose elements are not strings")
            );
        }
        Ok(match role {
            Role::Strings => self.lend_strings(array, want, lent, &origin),
            Role::HStrings => self.lend_hstrings(array, want, lent, &origin),
            Role::Records(record) => self.records_argument(id, array, record, &want, lent)?,
            Role::FilledHandles => self.filled_handles(id, array, want, lent)?,
            Role::Booleans => self.lend_booleans(id, array, want, lent),
            Role::FilledStrings => self.filled_block(
                id,
                array,
                Pointee::Pointer(Box::new(Pointee::Void)),
                want,
                lent,
            ),
            Role::FilledRecords(record) => {
                self.filled_block(id, array, Pointee::Record(record.clone()), want, lent)
            }
            _ => return Err(self.unsupported(id, "an array crossing as something no array is")),
        })
    }

    /// A `string[]` as C's NULL-terminated `char **`, converted for the call
    /// and freed after it (`Lent::Strings`).
    fn lend_strings(
        &mut self,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        let pointer =
            self.runtime_call("nts_strings_to_cstrings", vec![array], want, origin.clone());
        lent.push(Lent::Strings { pointer });
        pointer
    }

    /// An array of handles' element block, C's array of pointers to them,
    /// or NULL for a `null` array; the array given back after the call
    /// (`Lent::Array`). Only an array whose elements are native pointers has
    /// such a block, so any other is refused, whatever its type said: C would
    /// read its elements as objects.
    pub(super) fn lend_handles(
        &mut self,
        id: NodeId,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = &self.values[array.0 as usize].ty
        else {
            return Err(self.unsupported(id, "a `CHandles` argument that is not an array"));
        };
        let HirType::NativePointer(crate::hir::native::Pointee::Opaque(held)) = &**element else {
            return Err(
                self.unsupported(id, "a `CHandles` argument whose elements are not handles")
            );
        };
        // A COM object's interfaces are different pointers, so an array of
        // one interface's is not an array of another's: each element is asked
        // for the one C takes, into a block of the call's. Every interface
        // is an `IInspectable` as it is, as a single argument's is.
        if let HirType::NativePointer(crate::hir::native::Pointee::Pointer(wanted)) = &want
            && let crate::hir::native::Pointee::Opaque(wanted) = &**wanted
            && wanted.family == crate::hir::native::Family::Com
            && held.tag != wanted.tag
            && wanted.tag != "IInspectable"
        {
            let Some(iid) = self.hierarchy.com_iids.get(&wanted.tag).cloned() else {
                return Err(self.unsupported(
                    id,
                    &format!(
                        "an array of objects as `{}`, an interface no binding asks for by IID",
                        wanted.tag
                    ),
                ));
            };
            let [low, high] = self.iid_arguments(&iid, origin);
            let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
            let block = self.unless_null(array, absent, origin, |this| {
                this.runtime_call(
                    "nts_com_query_array",
                    vec![array, low, high],
                    want,
                    origin.clone(),
                )
            });
            lent.push(Lent::Queried { array, block });
            return Ok(block);
        }
        let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        let block = self.unless_null(array, absent, origin, |this| {
            this.runtime_call("nts_array_handles", vec![array], want, origin.clone())
        });
        lent.push(Lent::Array { array });
        Ok(block)
    }
}
