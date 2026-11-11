//! Construct `ArrayBuffer` and `DataView` storage, and guard attachment, resizing, allocation, and byte-window operations.

use super::{
    BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Origin, Terminator, UnOp,
    ValueId, syntax,
};

impl FuncBuilder<'_> {
    /// `new ArrayBuffer(n)` and `new ArrayBuffer(n, { maxByteLength: m })`.
    ///
    /// The length is `ToIndex`, which is two rules that look like one: the
    /// value truncates toward zero, and *then* the result must be a
    /// non-negative integer below 2^53. Guarding the raw argument gets the
    /// boundary wrong in a way node makes visible -- `new ArrayBuffer(-0.5)`
    /// is **0** and `new ArrayBuffer(-1.5)` is a `RangeError`, because the
    /// first truncates to `-0` and the second to `-1`.
    ///
    /// So the test is `n <= -1`, not `n < 0`, and it needs no truncation
    /// operation to be exact. `NaN` fails both comparisons and is allowed
    /// through, which is right: `ToIntegerOrInfinity(NaN)` is zero and node
    /// gives an empty buffer.
    pub(super) fn lower_new_buffer(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let arguments = self.arguments_of(id);
        let Some(first) = arguments.first() else {
            // `new ArrayBuffer()` is a `TypeError` in the language rather than
            // a zero-length buffer, and the checker rejects it before here.
            return Err(self.unsupported(id, "a `new ArrayBuffer` with no length"));
        };
        let length = self.lower_expression(*first)?;
        let length = self.coerce(length, &HirType::NUMBER, id)?;
        self.guard_buffer_length(id, length, "Invalid array buffer length")?;
        let origin = self.origin(id);

        let Some(options) = arguments.get(1) else {
            let buffer = self.call_runtime(
                "nts_buffer_new",
                vec![length],
                HirType::Managed(ManagedType::Buffer),
                &origin,
            );
            self.guard_allocated(id, buffer)?;
            return Ok(buffer);
        };
        // Read at the construction site rather than lowered as a value: the
        // options object has no representation and is not one -- it is
        // syntax the constructor reads one property out of. An options bag
        // that is not written here is refused rather than guessed at.
        let Some(max_node) = self.literal_option(*options, "maxByteLength") else {
            return Err(self.unsupported(
                id,
                "a `new ArrayBuffer` whose second argument is not an object literal \
                 writing `maxByteLength`",
            ));
        };
        let max = self.lower_expression(max_node)?;
        let max = self.coerce(max, &HirType::NUMBER, id)?;
        // The maximum has its own sentence. Node checks the length first and
        // says "Invalid array buffer length", then the maximum and says
        // "Invalid array buffer max length" -- and a program can tell which it
        // got, so the order and the wording are both observable.
        self.guard_buffer_length(id, max, "Invalid array buffer max length")?;
        // And a length above its own maximum is the maximum's complaint, not
        // the length's: `new ArrayBuffer(8, { maxByteLength: 4 })` reports the
        // max message even though the length is what is out of range.
        //
        // Compared TRUNCATED, which is the whole of `ToIndex` being two rules
        // rather than one. Against the raw values this rejected three shapes
        // node accepts -- `(0, -0.5)`, `(0.5, 0)` and `(3.7, 3)` -- because
        // `0 > -0.5` and `0.5 > 0` and `3.7 > 3` are all true and every one of
        // them is a comparison the language never makes. What it compares is
        // 0 with 0, 0 with 0, and 3 with 3.
        // `nts_to_index` rather than a `Trunc`, because `ToIndex` calls NaN
        // zero and truncation does not. With `Trunc`, `new ArrayBuffer(1, {
        // maxByteLength: NaN })` compared 1 against NaN, which is false the
        // way every comparison with NaN is false, and the `RangeError` node
        // raises simply did not happen. The same helper decides the allocation
        // size, so the two cannot drift apart about what a length is.
        let length_index =
            self.call_runtime("nts_to_index", vec![length], HirType::NUMBER, &origin);
        let max_index = self.call_runtime("nts_to_index", vec![max], HirType::NUMBER, &origin);
        let over = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: length_index,
                rhs: max_index,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.refuse_when(id, over, "RangeError", "Invalid array buffer max length")?;
        let buffer = self.call_runtime(
            "nts_buffer_new_resizable",
            vec![length, max],
            HirType::Managed(ManagedType::Buffer),
            &origin,
        );
        self.guard_allocated(id, buffer)?;
        Ok(buffer)
    }

    /// A length the language allows and the machine cannot give.
    ///
    /// The runtime answers null rather than aborting, because node answers a
    /// `RangeError` -- and a *different* one from the length check, because
    /// they are different failures: "Invalid array buffer length" is what the
    /// specification refuses, and "Array buffer allocation failed" is what this
    /// machine could not do. Node's own boundary between them moves with how
    /// much memory it has, which is why this compiler implements the rule and
    /// lets the allocation be the allocation.
    pub(super) fn guard_allocated(
        &mut self,
        id: NodeId,
        buffer: ValueId,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let null = self.push(
            OpKind::ConstNull,
            HirType::Managed(ManagedType::Buffer),
            origin.clone(),
        );
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: buffer,
                rhs: null,
            },
            HirType::Bool,
            origin,
        );
        self.refuse_when(id, failed, "RangeError", "Array buffer allocation failed")
    }

    /// One property of an object literal written at a call site.
    ///
    /// For an options bag, which is syntax rather than a value: `{ maxByteLength: 16 }`
    /// has no layout and never becomes an object.
    fn literal_option(&self, options: NodeId, name: &str) -> Option<NodeId> {
        if self.kind_of(options) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            return None;
        }
        self.children(options).into_iter().find_map(|member| {
            if self.kind_of(member) != Some(syntax::PROPERTY_ASSIGNMENT) {
                return None;
            }
            match self.children(member).as_slice() {
                [key, value] if self.literal_name(*key).as_deref() == Some(name) => Some(*value),
                _ => None,
            }
        })
    }

    /// `ToIndex`, as the two comparisons that decide it.
    ///
    /// The upper bound is the specification's 2^53, not an allocation limit.
    /// Node refuses much earlier -- 54,800,031,720 bytes on the machine this
    /// was measured on, with a *different* message -- and that bound is the
    /// amount of memory it can get rather than anything the language says. A
    /// compiler cannot match a number that depends on how much RAM is free, so
    /// it implements the rule and lets allocation failure be allocation
    /// failure.
    pub(super) fn guard_buffer_length(
        &mut self,
        id: NodeId,
        length: ValueId,
        message: &str,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let minus_one = self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
        let negative = self.push(
            OpKind::Binary {
                op: BinOp::Le,
                lhs: length,
                rhs: minus_one,
            },
            HirType::Bool,
            origin.clone(),
        );
        let throwing = self.new_block();
        let second = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: negative,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: second,
            else_args: Vec::new(),
        });

        self.switch_to(second);
        let limit = self.push(
            OpKind::ConstFloat(9_007_199_254_740_992.0),
            HirType::NUMBER,
            origin.clone(),
        );
        let too_large = self.push(
            OpKind::Binary {
                op: BinOp::Ge,
                lhs: length,
                rhs: limit,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: too_large,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        self.throw_provided_error(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// A method on a `Date`.
    ///
    /// Three of them, and two are one operation: `getTime` and `valueOf` both
    /// answer the time value, which is the whole of what a date holds.
    /// `toISOString` is the only one that is a calendar.
    ///
    /// Everything else is refused **by name**, which is the point of listing
    /// them rather than falling through to "a method call on something without
    /// methods". `getFullYear` and its family read a *local* calendar, which
    /// needs a timezone database this compiler does not carry and which would
    /// make the same program answer differently on two machines -- so it is a
    /// refusal with a reason rather than a gap.
    /// `new DataView(buffer)`, `(buffer, byteOffset)` and
    /// `(buffer, byteOffset, byteLength)`.
    ///
    /// The two-argument form **tracks** the buffer: no length was given, so the
    /// view is however many bytes remain, and it changes when the buffer is
    /// resized. The three-argument form is fixed for life. That is one runtime
    /// distinction rather than two types, which is why `DataView` carries
    /// nothing.
    ///
    /// A detached buffer is a `TypeError` here and not at the first access,
    /// because the specification checks it in the constructor -- and a view
    /// built over a detached buffer that only failed later would report a
    /// `byteLength` before it failed.
    pub(super) fn lower_new_data_view(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let arguments = self.arguments_of(id);
        let Some(first) = arguments.first() else {
            return Err(self.unsupported(id, "a `new DataView` with no buffer"));
        };
        let buffer = self.lower_expression(*first)?;
        if !matches!(
            self.values[buffer.0 as usize].ty,
            HirType::Managed(ManagedType::Buffer)
        ) {
            return Err(self.unsupported(
                id,
                "a `new DataView` over something other than an `ArrayBuffer`",
            ));
        }
        self.guard_view_attached(id, buffer)?;
        let origin = self.origin(id);

        // `nts_to_index` **clamps** where `ToIndex` throws -- it is the shared
        // arithmetic and the range check belongs to the callers, which is what
        // its header says. So the raw value is guarded first, here, exactly as
        // `new ArrayBuffer` guards its length. Without this,
        // `new DataView(buffer, -1)` is a view at zero where node raises a
        // `RangeError`, and `-0.5` is a view at zero on both -- which is the
        // whole of the boundary and why the check is `<= -1` rather than `< 0`.
        let offset = match arguments.get(1) {
            Some(node) => {
                let value = self.lower_expression(*node)?;
                let value = self.coerce(value, &HirType::NUMBER, id)?;
                self.guard_buffer_length(
                    id,
                    value,
                    "Start offset is outside the bounds of the buffer",
                )?;
                self.call_runtime("nts_to_index", vec![value], HirType::NUMBER, &origin)
            }
            None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };

        let view = if let Some(node) = arguments.get(2) {
            let length = self.lower_expression(*node)?;
            let length = self.coerce(length, &HirType::NUMBER, id)?;
            self.guard_buffer_length(id, length, "Invalid DataView length")?;
            let length = self.call_runtime("nts_to_index", vec![length], HirType::NUMBER, &origin);
            self.guard_view_window(id, buffer, offset, Some(length))?;
            self.call_runtime(
                "nts_dataview_part",
                vec![buffer, offset, length],
                HirType::Managed(ManagedType::DataView),
                &origin,
            )
        } else {
            self.guard_view_window(id, buffer, offset, None)?;
            self.call_runtime(
                "nts_dataview_over",
                vec![buffer, offset],
                HirType::Managed(ManagedType::DataView),
                &origin,
            )
        };
        self.guard_view_allocated(id, view)?;
        Ok(view)
    }

    /// The three a `DataView` has, all read from the runtime struct.
    pub(super) fn data_view_property(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let (helper, ty) = match member_name {
            // A tracking view over a buffer that has shrunk reports what is
            // left, which is why this is a call rather than a stored field.
            "byteLength" => ("nts_dataview_byte_length", HirType::NUMBER),
            "byteOffset" => ("nts_dataview_byte_offset", HirType::NUMBER),
            "buffer" => ("nts_dataview_buffer", HirType::Managed(ManagedType::Buffer)),
            other => {
                return Err(self.unsupported(
                    id,
                    &format!("`DataView.{other}`, which this compiler does not provide"),
                ));
            }
        };
        Ok(self.call_runtime(helper, vec![value], ty, &origin))
    }

    /// Every accessor, by name.
    ///
    /// The width and the signedness are in the *method*, not in the type, so
    /// this table is the whole of what a `DataView` can do -- and a name that
    /// is not in it is a refusal naming the method rather than a read of
    /// whatever a layout holds, because a view has no layout.
    ///
    /// `littleEndian` defaults to **false**, which is the one place in the
    /// language where the default is the less common byte order. Absent means
    /// big-endian, and getting that backwards is correct on every symmetric
    /// value.
    pub(super) fn lower_data_view_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .literal_name(member)
            .ok_or_else(|| self.unsupported(id, "a `DataView` member the program computes"))?;
        let origin = self.origin(id);

        // (helper suffix, width in bytes, result type, is a setter)
        let reading = name.starts_with("get");
        let stem = if reading {
            name.strip_prefix("get").unwrap_or("")
        } else {
            name.strip_prefix("set").unwrap_or("")
        };
        let (helper, width, ty) = match stem {
            "Int8" => ("int8", 1.0, HirType::NUMBER),
            "Uint8" => ("uint8", 1.0, HirType::NUMBER),
            "Int16" => ("int16", 2.0, HirType::NUMBER),
            "Uint16" => ("uint16", 2.0, HirType::NUMBER),
            "Int32" => ("int32", 4.0, HirType::NUMBER),
            "Uint32" => ("uint32", 4.0, HirType::NUMBER),
            "Float32" => ("float32", 4.0, HirType::NUMBER),
            "Float64" => ("float64", 8.0, HirType::NUMBER),
            // In the table, because the offset guard and the bounds check are
            // the same; separated below, because the *value* is not a number.
            // `getBigInt64` answers a bigint and `setBigInt64` takes one, and
            // the language refuses to mix them with numbers rather than
            // converting.
            "BigInt64" => ("bigint64", 8.0, HirType::BigInt),
            "BigUint64" => ("biguint64", 8.0, HirType::BigInt),
            _ => {
                return Err(self.unsupported(
                    id,
                    &format!("`DataView.{name}`, which this compiler does not provide"),
                ));
            }
        };
        if !name.starts_with("get") && !name.starts_with("set") {
            return Err(self.unsupported(
                id,
                &format!("`DataView.{name}`, which this compiler does not provide"),
            ));
        }

        let Some(first) = arguments.first() else {
            return Err(self.unsupported(id, &format!("a `DataView.{name}` with no byte offset")));
        };
        let at = self.lower_expression(*first)?;
        let at = self.coerce(at, &HirType::NUMBER, id)?;
        // Same boundary as the constructor's: `getUint8(-0.5)` reads element
        // zero and `getUint8(-1)` is a `RangeError`.
        self.guard_buffer_length(id, at, "Offset is outside the bounds of the DataView")?;
        let at = self.call_runtime("nts_to_index", vec![at], HirType::NUMBER, &origin);

        // The bounds check is here rather than in the runtime, for the reason
        // every other precondition in this file is: the runtime cannot throw,
        // and a `RangeError` is what the language says an access past the end
        // is.
        self.guard_view_access(id, receiver, at, width)?;

        // **No endianness argument for a one-byte access.** A single byte has
        // no byte order, `getInt8` takes no such parameter in the language, and
        // carrying one anyway would invite a reader to think it meant
        // something. The helper's arity differs with the width for that reason
        // and not by oversight.
        let wide = width > 1.0;

        if ty == HirType::BigInt {
            let little =
                self.endianness(id, arguments.get(if reading { 1 } else { 2 }), &origin)?;
            if reading {
                return Ok(self.call_runtime(
                    &format!("nts_dataview_get_{helper}"),
                    vec![receiver, at, little],
                    HirType::BigInt,
                    &origin,
                ));
            }
            let Some(second) = arguments.get(1) else {
                return Err(self.unsupported(id, &format!("a `DataView.{name}` with no value")));
            };
            let value = self.lower_expression(*second)?;
            if self.values[value.0 as usize].ty != HirType::BigInt {
                return Err(self.unsupported(
                    id,
                    &format!("a `DataView.{name}` of something other than a bigint"),
                ));
            }
            return Ok(self.call_runtime(
                &format!("nts_dataview_set_{helper}"),
                vec![receiver, at, value, little],
                HirType::Void,
                &origin,
            ));
        }

        if reading {
            let mut args = vec![receiver, at];
            if wide {
                args.push(self.endianness(id, arguments.get(1), &origin)?);
            }
            return Ok(self.call_runtime(&format!("nts_dataview_get_{helper}"), args, ty, &origin));
        }

        let Some(second) = arguments.get(1) else {
            return Err(self.unsupported(id, &format!("a `DataView.{name}` with no value")));
        };
        let value = self.lower_expression(*second)?;
        let value = self.coerce(value, &HirType::NUMBER, id)?;
        let mut args = vec![receiver, at, value];
        if wide {
            args.push(self.endianness(id, arguments.get(2), &origin)?);
        }
        Ok(self.call_runtime(
            &format!("nts_dataview_set_{helper}"),
            args,
            HirType::Void,
            &origin,
        ))
    }

    /// The `littleEndian` argument, defaulting to false.
    fn endianness(
        &mut self,
        id: NodeId,
        node: Option<&NodeId>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        match node {
            Some(node) => {
                let value = self.lower_expression(*node)?;
                self.coerce(value, &HirType::Bool, id)
            }
            None => Ok(self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone())),
        }
    }

    /// The four an `ArrayBuffer` has.
    ///
    /// By name, so that a member this compiler does not provide is a refusal
    /// naming it rather than a read of whatever an object layout holds at that
    /// offset -- a buffer has no layout to read.
    pub(super) fn buffer_property(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        // A detached buffer reports zero for both lengths rather than
        // throwing, which is what makes `detached` the question with the
        // answer rather than a thing to check before asking.
        let (helper, ty) = match member_name {
            "byteLength" => ("nts_buffer_byte_length", HirType::NUMBER),
            "maxByteLength" => ("nts_buffer_max_byte_length", HirType::NUMBER),
            "resizable" => ("nts_buffer_resizable", HirType::Bool),
            "detached" => ("nts_buffer_detached", HirType::Bool),
            other => {
                return Err(self.unsupported(
                    id,
                    &format!("`ArrayBuffer.{other}`, which this compiler does not provide"),
                ));
            }
        };
        Ok(self.call_runtime(helper, vec![value], ty, &origin))
    }

    /// `slice`, `resize`, `transfer` and `transferToFixedLength`.
    ///
    /// Every one of these has a state precondition the specification states as
    /// a throw, and the runtime cannot throw -- so each is a branch here. That
    /// is the same division `"x".repeat(-1)` settled: the helper does the work
    /// and the lowering owns what the language refuses.
    pub(super) fn lower_buffer_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .literal_name(member)
            .ok_or_else(|| self.unsupported(id, "an `ArrayBuffer` member the program computes"))?;
        let origin = self.origin(id);
        match name.as_str() {
            // Copies. Detached is a `TypeError`; the endpoints are relative
            // indices and clamp, which is not an error at all.
            "slice" => {
                self.guard_attached(id, receiver, "slice")?;
                let from = match arguments.first() {
                    Some(node) => {
                        let value = self.lower_expression(*node)?;
                        self.coerce(value, &HirType::NUMBER, id)?
                    }
                    None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
                };
                // Absent means "to the end", and the length is the end. Read
                // from the buffer rather than spelled as a constant, because
                // a resizable one's length is not known here.
                let to = match arguments.get(1) {
                    Some(node) => {
                        let value = self.lower_expression(*node)?;
                        self.coerce(value, &HirType::NUMBER, id)?
                    }
                    None => self.call_runtime(
                        "nts_buffer_byte_length",
                        vec![receiver],
                        HirType::NUMBER,
                        &origin,
                    ),
                };
                let slice = self.call_runtime(
                    "nts_buffer_slice",
                    vec![receiver, from, to],
                    HirType::Managed(ManagedType::Buffer),
                    &origin,
                );
                // A slice allocates, so it can fail the way a construction
                // can. Node raises the same `RangeError` for it.
                self.guard_allocated(id, slice)?;
                Ok(slice)
            }
            // Both detach the source, which is the whole point of them, and
            // both refuse a source that is already detached. They differ only
            // in whether the result keeps the resizable state.
            "transfer" | "transferToFixedLength" => {
                let length = match arguments.first() {
                    Some(node) => {
                        let value = self.lower_expression(*node)?;
                        let value = self.coerce(value, &HirType::NUMBER, id)?;
                        self.guard_buffer_length(id, value, "Invalid array buffer length")?;
                        value
                    }
                    None => self.call_runtime(
                        "nts_buffer_byte_length",
                        vec![receiver],
                        HirType::NUMBER,
                        &origin,
                    ),
                };
                // Node 26's ArrayBufferTransfer converts the argument before
                // checking detached state and the private detach key. The
                // argument may itself mark or detach the receiver.
                self.guard_attached(id, receiver, &name)?;
                let protected = self.call_runtime(
                    "nts_buffer_has_detach_key",
                    vec![receiver],
                    HirType::Bool,
                    &origin,
                );
                self.refuse_when(
                    id,
                    protected,
                    "TypeError",
                    "ArrayBuffer is not detachable and could not be cloned.",
                )?;
                let fixed = self.push(
                    OpKind::ConstBool(name == "transferToFixedLength"),
                    HirType::Bool,
                    origin.clone(),
                );
                let moved = self.call_runtime(
                    "nts_buffer_transfer",
                    vec![receiver, length, fixed],
                    HirType::Managed(ManagedType::Buffer),
                    &origin,
                );
                self.guard_allocated(id, moved)?;
                Ok(moved)
            }
            // A `TypeError` on a fixed or detached buffer, and a `RangeError`
            // for a length outside the reserved maximum. Two classes, because
            // the language distinguishes "this buffer cannot do that" from
            // "that is not a length it could have".
            "resize" => {
                self.guard_resizable(id, receiver)?;
                let Some(node) = arguments.first() else {
                    return Err(self.unsupported(id, "an `ArrayBuffer.resize` with no length"));
                };
                let length = self.lower_expression(*node)?;
                let length = self.coerce(length, &HirType::NUMBER, id)?;
                let length = self.guard_within_maximum(id, receiver, length)?;
                self.guard_native_buffer_shrink(id, receiver, length)?;
                Ok(self.call_runtime(
                    "nts_buffer_resize",
                    vec![receiver, length],
                    HirType::Void,
                    &origin,
                ))
            }
            other => Err(self.unsupported(
                id,
                &format!("`ArrayBuffer.{other}`, which this compiler does not provide"),
            )),
        }
    }

    /// A detached buffer, refused in the `DataView` constructor's own words.
    fn guard_view_attached(&mut self, id: NodeId, buffer: ValueId) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let detached =
            self.call_runtime("nts_buffer_detached", vec![buffer], HirType::Bool, &origin);
        self.refuse_when(
            id,
            detached,
            "TypeError",
            "Cannot construct a DataView with a detached ArrayBuffer",
        )
    }

    /// The window a `DataView` is being asked for, against the buffer it is
    /// over.
    ///
    /// Two different refusals with two different messages, because the
    /// language distinguishes them: an offset past the end is *"Start offset
    /// is outside the bounds of the buffer"*, and a length that does not fit
    /// from a legal offset is *"Invalid `DataView` length"*. Flattening them
    /// would send a reader to the wrong argument.
    fn guard_view_window(
        &mut self,
        id: NodeId,
        buffer: ValueId,
        offset: ValueId,
        length: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let size = self.call_runtime(
            "nts_buffer_byte_length",
            vec![buffer],
            HirType::NUMBER,
            &origin,
        );
        let past = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: offset,
                rhs: size,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.refuse_when(
            id,
            past,
            "RangeError",
            "Start offset is outside the bounds of the buffer",
        )?;
        let Some(length) = length else { return Ok(()) };
        let end = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: offset,
                rhs: length,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let overruns = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: end,
                rhs: size,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.refuse_when(id, overruns, "RangeError", "Invalid DataView length")
    }

    /// One access, checked against the view's length **as it is now**.
    ///
    /// A tracking view over a resizable buffer can shrink under an access that
    /// was in range when the view was made, so the length is read here rather
    /// than remembered. That is the same reason the runtime computes it.
    fn guard_view_access(
        &mut self,
        id: NodeId,
        view: ValueId,
        at: ValueId,
        width: f64,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let size = self.call_runtime(
            "nts_dataview_byte_length",
            vec![view],
            HirType::NUMBER,
            &origin,
        );
        let bytes = self.push(OpKind::ConstFloat(width), HirType::NUMBER, origin.clone());
        let end = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: at,
                rhs: bytes,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let past = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: end,
                rhs: size,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.refuse_when(
            id,
            past,
            "RangeError",
            "Offset is outside the bounds of the DataView",
        )
    }

    /// The allocation, which can fail for the same reason a buffer's can.
    fn guard_view_allocated(&mut self, id: NodeId, view: ValueId) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let null = self.push(
            OpKind::ConstNull,
            HirType::Managed(ManagedType::DataView),
            origin.clone(),
        );
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: view,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.refuse_when(id, failed, "RangeError", "DataView allocation failed")
    }

    fn guard_attached(
        &mut self,
        id: NodeId,
        buffer: ValueId,
        what: &str,
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let detached =
            self.call_runtime("nts_buffer_detached", vec![buffer], HirType::Bool, &origin);
        let message =
            format!("Cannot perform ArrayBuffer.prototype.{what} on a detached ArrayBuffer");
        self.refuse_when(id, detached, "TypeError", &message)
    }

    /// A fixed buffer and a detached one are the same refusal, and node gives
    /// them the same message: `resize` is a method the receiver does not
    /// support rather than a length it cannot reach.
    fn guard_resizable(&mut self, id: NodeId, buffer: ValueId) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let resizable =
            self.call_runtime("nts_buffer_resizable", vec![buffer], HirType::Bool, &origin);
        let fixed = self.push(
            OpKind::Unary {
                op: UnOp::Not,
                operand: resizable,
            },
            HirType::Bool,
            origin,
        );
        self.refuse_when(
            id,
            fixed,
            "TypeError",
            "Method ArrayBuffer.prototype.resize called on incompatible receiver",
        )
    }

    fn guard_within_maximum(
        &mut self,
        id: NodeId,
        buffer: ValueId,
        length: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let maximum = self.call_runtime(
            "nts_buffer_max_byte_length",
            vec![buffer],
            HirType::NUMBER,
            &origin,
        );
        // Above the maximum, or below zero -- and compared as `ToIndex` values
        // for the reason the constructor's comparison is: `resize(3.7)` on a
        // buffer whose maximum is 3 is legal and resizes to 3, while `3.7 > 3`
        // is true and would refuse it. The maximum needs no conversion; it is
        // already a byte count.
        let length_index =
            self.call_runtime("nts_to_index", vec![length], HirType::NUMBER, &origin);
        let over = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: length_index,
                rhs: maximum,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.refuse_when(
            id,
            over,
            "RangeError",
            "ArrayBuffer.prototype.resize: Invalid length parameter",
        )?;
        let minus_one = self.push(OpKind::ConstFloat(-1.0), HirType::NUMBER, origin.clone());
        let under = self.push(
            OpKind::Binary {
                op: BinOp::Le,
                lhs: length,
                rhs: minus_one,
            },
            HirType::Bool,
            origin,
        );
        self.refuse_when(
            id,
            under,
            "RangeError",
            "ArrayBuffer.prototype.resize: Invalid length parameter",
        )?;
        Ok(length_index)
    }
}
