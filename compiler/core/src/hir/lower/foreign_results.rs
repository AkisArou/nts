//! Decode foreign failure channels, output slots, and returned references into the caller's result.

use super::{
    ArrayFill, BinOp, Callee, Diagnostic, FuncBuilder, HirType, Lent, ManagedType, NodeId, OpKind,
    Origin, Terminator, ValueId,
};

/// Swift's `throws`: a message's `@ntsThrows` naming no parameter is the
/// `NSError **` Swift leaves out, a slot the program never writes -- answered
/// as the converter of that hidden slot, and no longer a tag on a parameter.
pub(super) fn split_hidden_throws(
    throws: Option<(String, String)>,
    message: bool,
    signature: &nts_semantic_schema::SignatureRecord,
) -> (Option<(String, String)>, Option<String>) {
    match throws {
        Some((slot, converter))
            if message
                && !signature
                    .parameters
                    .iter()
                    .any(|parameter| parameter.name == slot) =>
        {
            (None, Some(converter))
        }
        throws => (throws, None),
    }
}

/// Swift's `throws`: the `NSError **` a message reports through, which the
/// binding leaves out as Swift does, appended as the slot the compiler
/// supplies and reads after the call.
pub(super) fn append_error_slot(native: &mut crate::hir::native::Function, converter: String) {
    use crate::hir::native::{Handle, Pointee, Retention, Role, Type};
    native
        .parameters
        .push(Type::Pointer(Pointee::Pointer(Box::new(Pointee::Opaque(
            Handle::objc("NSError"),
        )))));
    native.roles.push(Role::ErrorSlot { converter });
    // Written through during the call and never kept: an out-parameter.
    native.retention.push(Retention::NotRetained);
}

impl FuncBuilder<'_> {
    /// A negative HRESULT `status` thrown, as an `Error` carrying the
    /// system's text for it, with what the call was lent given back on both
    /// paths.
    pub(super) fn throw_on_failure(
        &mut self,
        id: NodeId,
        status: ValueId,
        lent: Vec<Lent>,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let zero = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 32,
                signed: true,
            },
            origin.clone(),
        );
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: status,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let raise = self.new_block();
        let after = self.new_block();
        self.terminate(Terminator::Branch {
            cond: failed,
            then_target: raise,
            then_args: Vec::new(),
            else_target: after,
            else_args: Vec::new(),
        });
        self.switch_to(raise);
        self.give_back(id, lent.clone())?;
        let char_pointer = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Scalar(
            crate::hir::native::Scalar::Char,
        ));
        let message = self.runtime_call(
            "nts_hresult_message",
            vec![status],
            char_pointer.representation(),
            origin.clone(),
        );
        self.throw_c_message(id, message, origin)?;
        self.switch_to(after);
        self.give_back(id, lent)?;
        Ok(())
    }

    /// An `@ntsHresult` call: the HRESULT checked -- a negative one gives back
    /// what was lent and throws an `Error` carrying the system's text for it --
    /// and then the result read out of the slot C wrote it to.
    ///
    /// **What the slot holds decides how it is read**, and each reading is one
    /// the rest of the compiler already knows: a `boolean` byte compared with
    /// zero; a counted handle through
    /// `nts_com_take`, a runtime call, whose result the ownership pass reads
    /// as produced -- the `+1` a Windows Runtime `[out]` object is -- and
    /// releases; an
    /// `HSTRING` copied into a `string` and deleted; a scalar loaded.
    pub(super) fn finish_hresult_call(
        &mut self,
        id: NodeId,
        callee: Callee,
        args: Vec<ValueId>,
        lent: Vec<Lent>,
        declaration: Option<NodeId>,
        typed: Option<HirType>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let status = self.push_call(
            id,
            callee,
            args,
            declaration,
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        )?;
        // Failed calls need not leave outputs empty and grant no ownership of
        // what they wrote. Clear every output, including counts and composable
        // inner objects, before any read can take, copy or delete its value.
        // Keep the slots in the call's block: moving their reads past the
        // status branch violates the local-storage contract in loops/async.
        self.clear_failed_results(id, status, &lent, &origin)?;
        // A count slot is the one its received array's slot follows.
        let mut count = None;
        let written: Vec<_> = lent
            .iter()
            .filter_map(|lent| match lent {
                Lent::Count { slot } => {
                    count = Some(*slot);
                    None
                }
                Lent::Result {
                    slot,
                    written,
                    field,
                } => Some((*slot, *written, field.clone(), count.take())),
                _ => None,
            })
            .collect();
        let mut value = None;
        let mut fields = Vec::new();
        for (slot, written, field, count) in written {
            // What the slot is read as: the call's value, or its field.
            let want = match &field {
                Some(field) => self.out_field_type(id, typed.as_ref(), field)?,
                None => typed.clone(),
            };
            let read = self.read_written(id, (slot, count), written, want.as_ref(), &origin)?;
            match field {
                Some(field) => fields.push((field, read)),
                None => value = Some(read),
            }
        }
        let lent: Vec<Lent> = lent
            .into_iter()
            .map(|lent| match lent {
                Lent::Inner { slot } => Lent::Taken {
                    object: self.runtime_call(
                        "nts_com_take",
                        vec![slot],
                        HirType::NativePointer(crate::hir::native::Pointee::Void),
                        origin.clone(),
                    ),
                },
                other => other,
            })
            .collect();
        self.throw_on_failure(id, status, lent, &origin)?;
        if fields.is_empty() {
            return Ok(match value {
                Some(value) => value,
                None => self.push(
                    OpKind::ConstUndefined,
                    typed.unwrap_or(HirType::Void),
                    origin,
                ),
            });
        }
        // `@ntsHresult out`: an object of the call's type, one field per
        // slot, made only once the call succeeded -- a failed one throws
        // with nothing allocated. Its values were read before the branch;
        // only the slots have to be.
        // No type given is the node's own, as `push_call` reads it.
        let Some(HirType::Managed(ManagedType::Object(type_id))) =
            typed.or_else(|| self.type_of(id))
        else {
            return Err(
                self.unsupported(id, "an `@ntsHresult out` call whose value is not an object")
            );
        };
        let layout = self.layout_of(id, type_id)?;
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(type_id)),
            origin.clone(),
        );
        for (field, read) in fields {
            let Some(index) = layout.index_of(&field) else {
                return Err(self.unsupported(
                    id,
                    "an `@ntsHresult out` field the result's type does not declare",
                ));
            };
            let want = layout.fields[index as usize].ty.clone();
            let read = self.coerce(read, &want, id)?;
            self.field_set(object, index, read, &origin);
        }
        Ok(object)
    }

    fn clear_failed_results(
        &mut self,
        id: NodeId,
        status: ValueId,
        lent: &[Lent],
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        for lent in lent {
            let (Lent::Result { slot, .. } | Lent::Count { slot } | Lent::Inner { slot }) = lent
            else {
                continue;
            };
            let HirType::NativePointer(storage) = self.values[slot.0 as usize].ty.clone() else {
                return Err(self.unsupported(id, "an HRESULT output without native storage"));
            };
            let bytes = self.push(
                OpKind::NativeSizeOf(storage),
                HirType::NUMBER,
                origin.clone(),
            );
            // NativeSizeOf is a number by the op's contract; the external
            // helper takes size_t. State that conversion before the call,
            // rather than relying on runtime-signature specialization.
            let bytes = self.coerce(
                bytes,
                &crate::hir::native::Scalar::Size.representation(),
                id,
            )?;
            self.runtime_call(
                "nts_hresult_clear",
                vec![status, *slot, bytes],
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(())
    }

    /// The type of `field` of an `@ntsHresult out` call's value, which a
    /// slot written for that field is read as.
    fn out_field_type(
        &mut self,
        id: NodeId,
        typed: Option<&HirType>,
        field: &str,
    ) -> Result<Option<HirType>, Diagnostic> {
        let Some(HirType::Managed(ManagedType::Object(type_id))) =
            typed.cloned().or_else(|| self.type_of(id))
        else {
            return Ok(None);
        };
        let layout = self.layout_of(id, type_id)?;
        Ok(layout
            .index_of(field)
            .map(|index| layout.fields[index as usize].ty.clone()))
    }

    /// What an `@ntsHresult` call wrote to its result slot, as the program
    /// holds it. See `finish_hresult_call` for where this is read.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    pub(super) fn read_written(
        &mut self,
        id: NodeId,
        (slot, count): (ValueId, Option<ValueId>),
        written: crate::hir::native::Written,
        typed: Option<&HirType>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let first =
            |this: &mut Self| this.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Ok(match written {
            // The elements and their count, copied into a typed array of
            // their kind, and the callee's block freed: the ABI makes it the
            // caller's. A failed call left both zeroed, which reads as empty.
            crate::hir::native::Written::Received { kind } => {
                let Some(count) = count else {
                    return Err(
                        self.unsupported(id, "a received array with no count slot before it")
                    );
                };
                let element = match self.values[slot.0 as usize].ty.clone() {
                    HirType::NativePointer(crate::hir::native::Pointee::Pointer(element)) => {
                        *element
                    }
                    _ => {
                        return Err(self.unsupported(
                            id,
                            "a received array whose slot is not a pointer to its elements",
                        ));
                    }
                };
                let index = first(self);
                let elements = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    HirType::NativePointer(element.clone()),
                    origin.clone(),
                );
                let index = first(self);
                let length_type = HirType::Int {
                    bits: 32,
                    signed: false,
                };
                let length = self.push(
                    OpKind::NativeLoad {
                        pointer: count,
                        index,
                    },
                    length_type,
                    origin.clone(),
                );
                let kind = self.push(
                    OpKind::ConstFloat(f64::from(kind)),
                    HirType::NUMBER,
                    origin.clone(),
                );
                let crate::hir::native::Pointee::Scalar(scalar) = element else {
                    return Err(
                        self.unsupported(id, "a received array of something other than numbers")
                    );
                };
                let view = HirType::Managed(ManagedType::View(Box::new(
                    crate::hir::native::Type::Scalar(scalar).representation(),
                )));
                self.runtime_call(
                    "nts_winrt_received",
                    vec![elements, length, kind],
                    view,
                    origin.clone(),
                )
            }
            // The objects moved into an array of the program's made for
            // them, and the callee's block freed. Zeroed on a failed call,
            // which reads as empty.
            crate::hir::native::Written::ReceivedElements => {
                let Some(count) = count else {
                    return Err(
                        self.unsupported(id, "a received array with no count slot before it")
                    );
                };
                let ty = typed
                    .cloned()
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "a received array of structs"))?;
                self.elements_received(id, (slot, count), ty)?
            }
            crate::hir::native::Written::ReceivedStrings
            | crate::hir::native::Written::ReceivedHandles => {
                self.read_received_references(id, written, (slot, count), typed, origin)?
            }
            crate::hir::native::Written::HString => {
                let index = first(self);
                let hstring = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    HirType::NativePointer(crate::hir::native::Pointee::Void),
                    origin.clone(),
                );
                self.runtime_call(
                    "nts_string_from_hstring",
                    vec![hstring],
                    HirType::Managed(ManagedType::String),
                    origin.clone(),
                )
            }
            // The object written, unboxed: the runtime takes over the
            // reference and answers the value that owns what is left of it.
            crate::hir::native::Written::Boxed => {
                let index = first(self);
                let object = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    HirType::NativePointer(crate::hir::native::Pointee::Void),
                    origin.clone(),
                );
                self.runtime_call(
                    "nts_winrt_unbox",
                    vec![object],
                    HirType::Erased,
                    origin.clone(),
                )
            }
            // The slot is the record's storage, and so the value -- which is
            // why a record result is still refused in a loop, as a C
            // function's is.
            crate::hir::native::Written::Record => slot,
            // Copied out into an object of the program's, the slot dead after.
            crate::hir::native::Written::Copied => {
                let ty = typed
                    .cloned()
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "a copied struct"))?;
                self.object_from_copied(id, slot, &ty)?
            }
            // A read the checker narrowed to `null` -- right after `x = null`
            // -- has no representation of its own; the erased value is it.
            crate::hir::native::Written::Reference(referenced) => {
                let ty = typed
                    .cloned()
                    .or_else(|| self.type_of(id))
                    .unwrap_or(HirType::Erased);
                self.read_reference(id, slot, referenced, &ty)?
            }
            crate::hir::native::Written::Bool => {
                let index = first(self);
                let byte_type = HirType::Int {
                    bits: 8,
                    signed: false,
                };
                let byte = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    byte_type.clone(),
                    origin.clone(),
                );
                let zero = self.push(OpKind::ConstInt(0), byte_type, origin.clone());
                self.push(
                    OpKind::Binary {
                        op: BinOp::Ne,
                        lhs: byte,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin.clone(),
                )
            }
            crate::hir::native::Written::Value => {
                match self.values[slot.0 as usize].ty.clone() {
                    HirType::NativePointer(crate::hir::native::Pointee::Pointer(held)) => {
                        let handle = crate::hir::native::Type::Pointer((*held).clone());
                        if held.counting().is_some() {
                            // A runtime call, which the ownership pass reads as
                            // producing its result: the `+1` the object came with.
                            self.runtime_call(
                                "nts_com_take",
                                vec![slot],
                                handle.representation(),
                                origin.clone(),
                            )
                        } else {
                            let index = first(self);
                            self.push(
                                OpKind::NativeLoad {
                                    pointer: slot,
                                    index,
                                },
                                handle.representation(),
                                origin.clone(),
                            )
                        }
                    }
                    HirType::NativePointer(crate::hir::native::Pointee::Scalar(scalar)) => {
                        let index = first(self);
                        self.push(
                            OpKind::NativeLoad {
                                pointer: slot,
                                index,
                            },
                            crate::hir::native::Type::Scalar(scalar).representation(),
                            origin.clone(),
                        )
                    }
                    _ => return Err(self.unsupported(
                        id,
                        "an @ntsHresult result slot that holds neither a pointer nor a C scalar",
                    )),
                }
            }
        })
    }

    /// An array of strings or of objects a Windows Runtime call handed back:
    /// its block and count read from their slots, then each `HSTRING` copied
    /// into a `string` of a new array (`nts_winrt_received_strings`), or each
    /// object moved into an array of the program's made for them, whose
    /// descriptor is the objects' family's (`nts_winrt_received_handles`).
    fn read_received_references(
        &mut self,
        id: NodeId,
        written: crate::hir::native::Written,
        (slot, count): (ValueId, Option<ValueId>),
        typed: Option<&HirType>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let Some(count) = count else {
            return Err(self.unsupported(id, "a received array with no count slot before it"));
        };
        let index = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let block = HirType::NativePointer(crate::hir::native::Pointee::Pointer(Box::new(
            crate::hir::native::Pointee::Void,
        )));
        let block = self.push(
            OpKind::NativeLoad {
                pointer: slot,
                index,
            },
            block,
            origin.clone(),
        );
        let index = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let length = self.push(
            OpKind::NativeLoad {
                pointer: count,
                index,
            },
            HirType::Int {
                bits: 32,
                signed: false,
            },
            origin.clone(),
        );
        if written == crate::hir::native::Written::ReceivedStrings {
            let ty = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
                ManagedType::String,
            ))));
            return Ok(self.runtime_call(
                "nts_winrt_received_strings",
                vec![block, length],
                ty,
                origin.clone(),
            ));
        }
        let Some(ty @ HirType::Managed(ManagedType::Array(_))) =
            typed.cloned().or_else(|| self.type_of(id))
        else {
            return Err(self.unsupported(
                id,
                "a received array of objects read as something other than an array",
            ));
        };
        let size = self.coerce(length, &HirType::NUMBER, id)?;
        let array = self.push(
            OpKind::ArrayNew {
                length: size,
                fill: ArrayFill::Holes,
            },
            ty,
            origin.clone(),
        );
        self.runtime_call(
            "nts_winrt_received_handles",
            vec![array, block, length],
            HirType::Void,
            origin.clone(),
        );
        Ok(array)
    }

    /// Throw an `Error` whose message is a `malloc`'d C string, which is
    /// copied and then freed: what `@ntsThrows`' converter and a failed
    /// HRESULT both hand back.
    fn throw_c_message(
        &mut self,
        id: NodeId,
        message: ValueId,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        // Copied into the `Error`'s message, then C's freed. Not through
        // `read_native_string`, which types its copy as the *call's* result.
        let text = self.runtime_call(
            "nts_string_from_required_cstring",
            vec![message],
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        // Freed by the compiler's own memory operation, which is what this is.
        // A `free` synthesized as a native call was a second spelling of it,
        // and the rule that keeps a binding's `free` from colliding with
        // `c:stdlib`'s (`native::layouts`) could not tell the two apart: a
        // program calling a throwing binding and using `malloc` was refused.
        self.push(
            OpKind::NativeFree { pointer: message },
            HirType::Void,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "Error", text)
    }

    /// The value an `@ntsThrows` parameter receives: the caller's own slot
    /// where one was written, and otherwise a zeroed local of ours, recorded
    /// so that `finish_call` checks it.
    pub(super) fn error_slot(
        &mut self,
        written: Option<ValueId>,
        ty: HirType,
        converter: String,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        if let Some(written) = written {
            return written;
        }
        let slot = self.push(OpKind::NativeLocal { count: 1 }, ty, origin.clone());
        lent.push(Lent::Error { slot, converter });
        slot
    }

    /// After a call that reports failure through `slot` (`@ntsThrows`): if C
    /// wrote an error there, throw an `Error` whose message is what
    /// `converter` makes of it. The converter takes the error -- it frees it --
    /// and answers a `malloc`'d message, which is copied and freed here:
    /// `nts_gerror_take_message` for `GLib`'s `GError`.
    pub(super) fn throw_if_reported(
        &mut self,
        id: NodeId,
        slot: ValueId,
        converter: &str,
        lent: &[Lent],
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let HirType::NativePointer(crate::hir::native::Pointee::Pointer(error)) =
            self.values[slot.0 as usize].ty.clone()
        else {
            return Err(
                self.unsupported(id, "an @ntsThrows slot that is not a pointer to a pointer")
            );
        };
        let error_ty = HirType::NativePointer((*error).clone());
        let first = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let reported = self.push(
            OpKind::NativeLoad {
                pointer: slot,
                index: first,
            },
            error_ty.clone(),
            origin.clone(),
        );
        let none = self.push(OpKind::ConstNull, error_ty, origin.clone());
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: reported,
                rhs: none,
            },
            HirType::Bool,
            origin.clone(),
        );
        let raise = self.new_block();
        let after = self.new_block();
        self.terminate(Terminator::Branch {
            cond: failed,
            then_target: raise,
            then_args: Vec::new(),
            else_target: after,
            else_args: Vec::new(),
        });
        self.switch_to(raise);
        // Everything lent to the call, given back before the throw leaves.
        self.give_back(id, lent.to_vec())?;
        let convert = std::sync::Arc::new(crate::hir::native::Function {
            thunk: None,
            name: converter.to_owned(),
            convention: crate::hir::native::Convention::C,
            parameters: vec![crate::hir::native::Type::Pointer((*error).clone())],
            result: crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Scalar(
                crate::hir::native::Scalar::Char,
            )),
            retention: vec![crate::hir::native::Retention::Unknown],
            variadic: None,
            // Not the library's own header: the converter is the program's
            // (GLib's lives in the GLib host), so there is nothing to check
            // its prototype against.
            declared_at: None,
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
        });
        let char_pointer = crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Scalar(
            crate::hir::native::Scalar::Char,
        ));
        let message = self.push(
            OpKind::Call {
                callee: Callee::Native(convert),
                args: vec![reported],
                frame: None,
            },
            char_pointer.representation(),
            origin.clone(),
        );
        self.throw_c_message(id, message, &origin)?;
        self.switch_to(after);
        Ok(())
    }

    /// What a declaration's `@ntsHresult` says, if it has one: plain,
    /// `composable`, or `out`.
    /// `@ntsReference`: the parameters crossing as an `IReference<T>`.
    pub(super) fn reference_tags(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
    ) -> Result<Vec<crate::hir::native::Reference>, Diagnostic> {
        Ok(declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|native| native.reference.as_deref())
            .map(crate::hir::native::parse_references)
            .transpose()
            .map_err(|why| self.unsupported(call, &why))?
            .unwrap_or_default())
    }

    pub(super) fn hresult_shape(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
    ) -> Result<Option<crate::hir::native::Hresult>, Diagnostic> {
        // An overridable method answers an HRESULT as every slot does, and
        // its binding says so only by being `@ntsOverride`.
        if self.forced_slot.is_some() {
            return Ok(Some(crate::hir::native::Hresult::Plain));
        }
        let Some(shape) = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.hresult.as_deref())
        else {
            return Ok(None);
        };
        match shape.trim() {
            "" => Ok(Some(crate::hir::native::Hresult::Plain)),
            "composable" => Ok(Some(crate::hir::native::Hresult::Composable)),
            "out" => Ok(Some(crate::hir::native::Hresult::Out)),
            _ => Err(self.unsupported(
                call,
                "@ntsHresult with a shape other than `composable` or `out`",
            )),
        }
    }

    /// The slots an `@ntsHresult` call adds after the declared arguments: the
    /// result, and a composable factory's outer and inner objects.
    pub(super) fn hresult_slot(
        &mut self,
        role: &crate::hir::native::Role,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        match role {
            // Where C writes the result: a zeroed local, read by
            // `finish_hresult_call` once the HRESULT says it was written.
            crate::hir::native::Role::Result { written, field } => {
                let slot = self.push(OpKind::NativeLocal { count: 1 }, want, origin.clone());
                lent.push(Lent::Result {
                    slot,
                    written: *written,
                    field: field.clone(),
                });
                slot
            }
            // Where C writes a received array's count: read with the array.
            crate::hir::native::Role::ReceivedCount => {
                let slot = self.push(OpKind::NativeLocal { count: 1 }, want, origin.clone());
                lent.push(Lent::Count { slot });
                slot
            }
            // No outer object: the class is made as itself.
            crate::hir::native::Role::Outer => self.push(OpKind::ConstNull, want, origin.clone()),
            // The inner object, given back after the call.
            _ => {
                let slot = self.push(OpKind::NativeLocal { count: 1 }, want, origin.clone());
                lent.push(Lent::Inner { slot });
                slot
            }
        }
    }

    /// An IID's two words, as the runtime's COM helpers take it (`iid_words`):
    /// two constants. Text that is no IID -- refused where the tag is read,
    /// so not reached -- gives zero words, which no interface answers to.
    pub(super) fn iid_arguments(&mut self, iid: &str, origin: &Origin) -> [ValueId; 2] {
        let (low, high) = crate::hir::native::iid_words(iid).unwrap_or_default();
        let word = HirType::Int {
            bits: 64,
            signed: false,
        };
        [
            self.push(
                OpKind::ConstInt(i128::from(low)),
                word.clone(),
                origin.clone(),
            ),
            self.push(OpKind::ConstInt(i128::from(high)), word, origin.clone()),
        ]
    }
}
