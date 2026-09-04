//! Operations and terminators: the mechanical half of the body emitter.
//!
//! Every operation leaves its value on the operand stack and the caller stores
//! it into the value's slot, so the stack is empty between operations and
//! therefore empty at every block boundary -- which is the invariant the stack
//! map design rests on and which `Code::bind` checks.
//!
//! The exception is a comparison, because the JVM has no instruction that
//! leaves a boolean on the stack: it has a *branch*. So a comparison either
//! feeds the block's own terminator, where the branch is what was wanted
//! anyway, or writes 0 or 1 through a scratch slot.

use nts_codegen_common::Copy;
use nts_core::hir::{BinOp, BlockId, Callee, HirType, ManagedType, OpKind, Terminator, UnOp, ValueId};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::code::{Code, Label};
use nts_jvm_emitter::{Compare, Kind, Pool, insn};

use crate::body::{Emitter, PROGRAM, Placed, RUNTIME, comparison, refuse};
use crate::types;

impl Emitter<'_> {
    /// One block: its operations, then its terminator.
    pub(crate) fn block(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        block: BlockId,
        next: Option<BlockId>,
    ) -> Result<(), Diagnostic> {
        let ops = self.func.blocks[block.0 as usize].ops.clone();
        let terminator = self.func.blocks[block.0 as usize].terminator.clone();

        // A comparison whose only reader is this block's own branch never
        // becomes a value: the branch reads the comparison directly.
        let fused = self.fusable(&ops, &terminator);

        for &value in &ops {
            if Some(value) == fused {
                continue;
            }
            self.operation(code, pool, value)?;
        }
        self.terminator(code, pool, block, &terminator, next, fused)
    }

    /// The value a branch can consume in place, if there is one.
    pub(crate) fn fusable(&self, ops: &[ValueId], terminator: &Terminator) -> Option<ValueId> {
        let Terminator::Branch { cond, .. } = terminator else {
            return None;
        };
        if ops.last() != Some(cond) || self.uses.get(cond.0 as usize).copied() != Some(1) {
            return None;
        }
        let OpKind::Binary { op, lhs, .. } = self.func.values[cond.0 as usize].kind else {
            return None;
        };
        // A string comparison is a call that leaves a boolean, not a branch, so
        // there is nothing to fuse into.
        if matches!(self.ty(lhs), HirType::Managed(ManagedType::String)) {
            return None;
        }
        comparison(op).map(|_| *cond)
    }

    fn operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        let op = self.func.values[value.0 as usize].clone();
        let origin = op.origin.clone();
        let placed = match &op.kind {
            // Already in a slot: a parameter by the calling convention, a block
            // parameter because every edge into this block wrote it.
            OpKind::Param(_) | OpKind::BlockParam(_) => return Ok(()),

            OpKind::ConstBool(_) | OpKind::ConstInt(_) | OpKind::ConstFloat(_) => {
                self.constant(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::ConstString(_) | OpKind::Length(_) | OpKind::StringUnitAt { .. } => {
                self.string_operation(code, pool, &op.kind, &origin)?
            }
            OpKind::ArrayNew { .. } | OpKind::ArrayGet { .. } | OpKind::ArraySet { .. } => {
                self.array_operation(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::Erase { .. } | OpKind::TagOf { .. } | OpKind::Unerase { .. } => {
                self.erasure(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::ConstNull | OpKind::ConstUndefined => {
                self.absence(code, pool, &op.kind, &op.ty, &origin)?
            }
            OpKind::Binary { op: bin, lhs, rhs } => self.binary(code, pool, &op.ty, *bin, *lhs, *rhs)?,
            OpKind::Unary { op: un, operand } => self.unary(code, pool, &op.ty, *un, *operand)?,
            OpKind::Convert(operand) => {
                self.load(code, *operand)?;
                let from = self.ty(*operand).clone();
                self.convert(code, pool, &from, &op.ty, &origin)?;
                Placed::OnStack
            }

            OpKind::GlobalGet(global) => {
                let Some(entry) = self.program.globals.get(*global as usize) else {
                    return Err(refuse(self.func, "a global this program does not declare"));
                };
                let Some(descriptor) = types::descriptor(self.program, &entry.ty) else {
                    return Err(refuse(self.func, "a global of unrepresentable type"));
                };
                let name = crate::body::method_name(&entry.name);
                code.get_static(&origin, pool, PROGRAM, &name, &descriptor);
                Placed::OnStack
            }
            OpKind::GlobalSet { global, value: stored } => {
                let Some(entry) = self.program.globals.get(*global as usize) else {
                    return Err(refuse(self.func, "a global this program does not declare"));
                };
                let Some(descriptor) = types::descriptor(self.program, &entry.ty) else {
                    return Err(refuse(self.func, "a global of unrepresentable type"));
                };
                let name = crate::body::method_name(&entry.name);
                self.load(code, *stored)?;
                code.put_static(&origin, pool, PROGRAM, &name, &descriptor);
                return Ok(());
            }

            OpKind::Call { callee, args, .. } => self.call(code, pool, &op.ty, callee, args, &origin)?,

            // `new; dup; invokespecial <init>()V`, and then the lowering calls
            // the TypeScript constructor as an ordinary method on the result --
            // which is what `Func::initializes_receiver` already promises: a
            // freshly allocated receiver with every field zero, which is
            // exactly what the JVM hands back.
            //
            // `frame` is ignored. It is escape analysis asking for stack
            // placement, and there is nothing here to place: HotSpot decides
            // that at run time from the same evidence. On ART, whose escape
            // analysis is much weaker, honouring the hint may be worth
            // something -- and that is a measurement for when a DEX pipeline
            // exists, not a guess now.
            OpKind::ObjectNew { .. } => {
                let class = self.object_class(&op.ty)?;
                code.new_object(&origin, pool, &class);
                code.dup(&origin);
                code.invoke_special(&origin, pool, &class, "<init>", "()V");
                Placed::OnStack
            }
            OpKind::FieldGet { object, field } => {
                let (class, name, descriptor) = self.field_ref(*object, *field)?;
                self.load(code, *object)?;
                code.get_field(&origin, pool, &class, &name, &descriptor);
                Placed::OnStack
            }
            OpKind::FieldSet { object, field, value: stored } => {
                let (class, name, descriptor) = self.field_ref(*object, *field)?;
                self.load(code, *object)?;
                self.load(code, *stored)?;
                code.put_field(&origin, pool, &class, &name, &descriptor);
                return Ok(());
            }
            // A closed set of classes, so `instanceof` answers it directly --
            // one instruction against the C backend's chain of descriptor
            // pointer comparisons. More than one class needs the set ORed
            // together, which needs a branch; until the shape appears in a real
            // program it is refused rather than guessed at.
            OpKind::InstanceOf { value, classes } => {
                let [only] = classes.as_slice() else {
                    return Err(refuse(
                        self.func,
                        "an `instanceof` against more than one class",
                    ));
                };
                let Some(layout) = self.program.layout(*only) else {
                    return Err(refuse(self.func, "an `instanceof` against an unknown class"));
                };
                self.load(code, *value)?;
                code.instance_of(&origin, pool, &types::class_name(layout));
                Placed::OnStack
            }

            // Everything the managed and erased slices bring, refused by name
            // rather than half-emitted -- a backend that writes *something* for
            // every input is one nobody can trust the output of.
            other => return Err(refuse(self.func, &unsupported(other))),
        };

        if placed == Placed::OnStack {
            if let Some(slot) = self.slot(value) {
                let kind = self.kind_of(value)?;
                code.store(&origin, kind, slot);
            } else {
                // Nothing reads it. Discard rather than leave the stack dirty,
                // which `Code::bind` would refuse at the end of the block.
                let words = types::kind(&op.ty).map_or(0, Kind::words);
                if words > 0 {
                    code.pop(&origin, words);
                }
            }
        }
        Ok(())
    }

    /// `null` and `undefined`, which are one value or two depending on where
    /// they land.
    ///
    /// Erased they are interned singletons: they carry no payload, so every one
    /// is the same one, and a compiled program mentions `undefined` constantly.
    /// As a reference they are both the null pointer, which is what makes
    /// `T | null` cost nothing -- one absence fits in a pointer and two do not,
    /// which is why `T | null | undefined` erases instead.
    fn absence(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        if *ty == HirType::Erased {
            let which = if matches!(kind, OpKind::ConstNull) {
                "NULL_VALUE"
            } else {
                "UNDEFINED_VALUE"
            };
            code.get_static(origin, pool, types::VALUE, which, types::VALUE_DESCRIPTOR);
            return Ok(Placed::OnStack);
        }
        if matches!(ty, HirType::Managed(_)) {
            code.const_null(origin);
            return Ok(Placed::OnStack);
        }
        Err(refuse(self.func, "an absent value with no reference to be"))
    }

    /// Putting a tag on a value, reading it off, and taking it back.
    ///
    /// `TagOf` **is** `typeof`: the tag numbering is chosen so that
    /// `typeof x === "object"` is the single comparison `tag >= OBJECT`, which
    /// is why the erased value is this three-field class rather than a bare
    /// `Object` tested with `instanceof`.
    fn erasure(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            OpKind::Erase { value } => self.erase(code, pool, *value, origin),
                // A `Void` erases to `undefined` and has nothing to load.
            OpKind::TagOf { value } => {
                self.load(code, *value)?;
                code.get_field(origin, pool, types::VALUE, "tag", "I");
                // The tag lands in whatever slot the middle end chose, which is
                // not always an `int` one -- the same rule the coercions keep.
                if types::kind(ty) == Some(Kind::Double) {
                    code.convert(origin, insn::I2D, Kind::Int, Kind::Double);
                }
                Ok(Placed::OnStack)
            }
            OpKind::Unerase { value } => {
                self.load(code, *value)?;
                match ty {
                    HirType::Bool => code.invoke_static(
                        origin,
                        pool,
                        types::VALUE,
                        "asBoolean",
                        "(Lnts/rt/NtsValue;)Z",
                    ),
                    HirType::Int { .. } | HirType::Float { .. } => {
                        code.get_field(origin, pool, types::VALUE, "num", "D");
                        let target = types::kind(ty)
                            .ok_or_else(|| refuse(self.func, "unerasing to an unrepresentable type"))?;
                        if target != Kind::Double {
                            let opcode = match target {
                                Kind::Long => insn::D2L,
                                Kind::Float => insn::D2F,
                                _ => insn::D2I,
                            };
                            code.convert(origin, opcode, Kind::Double, target);
                        }
                    }
                    HirType::Managed(_) => {
                        code.get_field(origin, pool, types::VALUE, "ref", "Ljava/lang/Object;");
                        let descriptor = types::descriptor(self.program, ty).ok_or_else(|| {
                            refuse(self.func, "unerasing to an unrepresentable reference")
                        })?;
                        // Unchecked by construction upstream, but the verifier
                        // needs the narrowing spelled: the field is `Object`.
                        code.check_cast(origin, pool, &descriptor);
                    }
                    other => {
                        return Err(refuse(
                            self.func,
                            &format!("unerasing to {}", types::describe(other)),
                        ));
                    }
                }
                Ok(Placed::OnStack)
            }
            _ => Err(refuse(self.func, "an erasure this backend does not spell")),
        }
    }

    /// Putting a tag on a value.
    ///
    /// The payload is a `double` whatever the number was, which is what lets one
    /// erased value hold any of them -- so the widening happens here rather than
    /// being a second representation to keep in step with the first.
    fn erase(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let from = self.ty(value).clone();
        // A `Void` erases to `undefined` and has nothing to load.
        if matches!(from, HirType::Void) {
            code.get_static(origin, pool, types::VALUE, "UNDEFINED_VALUE", types::VALUE_DESCRIPTOR);
            return Ok(Placed::OnStack);
        }
        self.load(code, value)?;
        let (name, signature) = match &from {
            HirType::Bool => ("ofBoolean", "(Z)Lnts/rt/NtsValue;"),
            HirType::Managed(ManagedType::String) => {
                ("ofString", "(Ljava/lang/String;)Lnts/rt/NtsValue;")
            }
            HirType::Managed(_) => ("ofObject", "(Ljava/lang/Object;)Lnts/rt/NtsValue;"),
            HirType::Int { .. } | HirType::Float { .. } => {
                let source = types::kind(&from)
                    .ok_or_else(|| refuse(self.func, "erasing an unrepresentable value"))?;
                if source != Kind::Double {
                    let opcode = match source {
                        Kind::Long => insn::L2D,
                        Kind::Float => insn::F2D,
                        _ => insn::I2D,
                    };
                    code.convert(origin, opcode, source, Kind::Double);
                }
                ("ofNumber", "(D)Lnts/rt/NtsValue;")
            }
            other => {
                return Err(refuse(self.func, &format!("erasing {}", types::describe(other))));
            }
        };
        code.invoke_static(origin, pool, types::VALUE, name, signature);
        Ok(Placed::OnStack)
    }

    /// Allocation, load and store on a bare JVM array.
    ///
    /// # `checked` cannot mean what it means in C
    ///
    /// The JVM bounds-checks every access whether or not the compiler proved
    /// the index in range, so `checked: false` is not a licence to skip
    /// anything -- there is nothing to skip. It means the range analysis found
    /// the same proof C2's range-check elimination will find in a counted loop,
    /// and the instruction is identical either way.
    ///
    /// `checked: true` is the one that needs care, and not for speed. An
    /// escaping `ArrayIndexOutOfBoundsException` would reach the differential as
    /// a Java stack trace with no `nts:` line, and `stopped()` classifies that
    /// as a **defect** -- so every case the C lane legitimately *declines* would
    /// be counted as a failure here. The runtime turns it into the same refusal
    /// the C lane prints.
    fn array_operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            OpKind::ArrayNew { length, .. } => {
                let element = self.element_descriptor(ty)?;
                self.load(code, *length)?;
                // The length arrives as a double, because that is what a
                // JavaScript length is until something narrows it.
                code.convert(origin, insn::D2I, Kind::Double, Kind::Int);
                code.new_array(origin, pool, &element);
                Ok(Placed::OnStack)
            }
            OpKind::ArrayGet { array, index, .. } => {
                let element = self.element_descriptor(&self.ty(*array).clone())?;
                self.load(code, *array)?;
                self.load(code, *index)?;
                code.convert(origin, insn::D2I, Kind::Double, Kind::Int);
                code.array_load(origin, &element);
                Ok(Placed::OnStack)
            }
            OpKind::ArraySet { array, index, value, .. } => {
                let element = self.element_descriptor(&self.ty(*array).clone())?;
                self.load(code, *array)?;
                self.load(code, *index)?;
                code.convert(origin, insn::D2I, Kind::Double, Kind::Int);
                self.load(code, *value)?;
                code.array_store(origin, &element);
                Ok(Placed::Stored)
            }
            _ => Err(refuse(self.func, "an array operation this backend does not spell")),
        }
    }

    /// The descriptor of what an array holds.
    fn element_descriptor(&self, ty: &HirType) -> Result<String, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = ty else {
            return Err(refuse(self.func, "an array operation on something that is not an array"));
        };
        types::descriptor(self.program, element)
            .ok_or_else(|| refuse(self.func, &format!("an array of {}", types::describe(element))))
    }

    /// The operations `java.lang.String` already is.
    ///
    /// Lifted out of `operation` because it went past a hundred lines, which in
    /// this repository has a habit of finding a real duplication rather than
    /// merely a long function. Here it found that all three arms want the
    /// string on the stack first and nothing else in common.
    fn string_operation(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            // A literal is a constant pool entry, deduplicated by the pool and
            // free at the use -- better than the C backend, which emits a
            // static per literal and takes its address.
            OpKind::ConstString(text) => {
                if nts_jvm_emitter::Pool::utf8_length(text) > 65_535 {
                    return Err(refuse(self.func, "a string literal past the 65,535-byte constant limit"));
                }
                code.const_string(origin, pool, text);
                Ok(Placed::OnStack)
            }
            // `String.length()` is an `int`; the middle end types a length as a
            // double, having been told once that it is a `uint32_t` and worth
            // 4.0x to say so. The widening is explicit here for the same reason
            // the coercion's is: the slot the middle end chose is the slot.
            OpKind::Length(of) if matches!(self.ty(*of), HirType::Managed(ManagedType::String)) => {
                self.load(code, *of)?;
                code.invoke_virtual(origin, pool, types::STRING, "length", "()I");
                code.convert(origin, insn::I2D, Kind::Int, Kind::Double);
                Ok(Placed::OnStack)
            }
            OpKind::Length(of) => {
                self.load(code, *of)?;
                code.array_length(origin);
                code.convert(origin, insn::I2D, Kind::Int, Kind::Double);
                Ok(Placed::OnStack)
            }
            // Out of range JavaScript answers `NaN` where `charAt` throws, and a
            // fractional index truncates rather than being an error. Where the
            // compiler proved the index in range neither applies, so `charAt`
            // is called directly and the helper is not in the program.
            OpKind::StringUnitAt { string, index, checked } => {
                self.load(code, *string)?;
                self.load(code, *index)?;
                if *checked {
                    code.invoke_static(origin, pool, RUNTIME, "charCodeAt", "(Ljava/lang/String;D)D");
                } else {
                    code.convert(origin, insn::D2I, Kind::Double, Kind::Int);
                    code.invoke_virtual(origin, pool, types::STRING, "charAt", "(I)C");
                    code.convert(origin, insn::I2D, Kind::Int, Kind::Double);
                }
                Ok(Placed::OnStack)
            }

            _ => Err(refuse(self.func, "a string operation this backend does not spell")),
        }
    }

    /// A literal, in whichever width the middle end gave it.
    fn constant(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        kind: &OpKind,
        ty: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        match kind {
            OpKind::ConstBool(flag) => code.const_int(origin, pool, i32::from(*flag)),
            OpKind::ConstInt(number) => match types::kind(ty) {
                Some(Kind::Long) => {
                    let Ok(narrow) = i64::try_from(*number) else {
                        return Err(refuse(self.func, "an integer literal wider than 64 bits"));
                    };
                    code.const_long(origin, pool, narrow);
                }
                Some(Kind::Int) => {
                    let Ok(narrow) = i32::try_from(*number) else {
                        return Err(refuse(self.func, "an integer literal wider than its slot"));
                    };
                    code.const_int(origin, pool, narrow);
                }
                _ => return Err(refuse(self.func, "an integer literal of unrepresentable type")),
            },
            OpKind::ConstFloat(number) => {
                if matches!(ty, HirType::Float { bits: 32 }) {
                    #[allow(
                        clippy::cast_possible_truncation,
                        reason = "the lowering typed this value `f32`, so it is one"
                    )]
                    code.const_float(origin, pool, *number as f32);
                } else {
                    code.const_double(origin, pool, *number);
                }
            }
            _ => return Err(refuse(self.func, "a literal this backend does not spell")),
        }
        Ok(Placed::OnStack)
    }

    /// The class a value of this type is an instance of.
    fn object_class(&self, ty: &HirType) -> Result<String, Diagnostic> {
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
            return Err(refuse(self.func, "an object operation on something that is not one"));
        };
        let Some(layout) = self.program.layout(*id) else {
            return Err(refuse(self.func, "an object whose layout this program does not carry"));
        };
        Ok(types::class_name(layout))
    }

    /// The owning class, member name and descriptor of one field.
    ///
    /// Read from the *object's* layout by index, because `FieldSet`/`FieldGet`
    /// carry a position rather than a name -- the position `codegen_common`'s
    /// layout decided, so that no two backends can disagree about which field
    /// is which.
    fn field_ref(&self, object: ValueId, field: u32) -> Result<(String, String, String), Diagnostic> {
        let ty = self.ty(object).clone();
        let HirType::Managed(nts_core::hir::ManagedType::Object(id)) = ty else {
            return Err(refuse(self.func, "a field of something that is not an object"));
        };
        let Some(layout) = self.program.layout(id) else {
            return Err(refuse(self.func, "a field of an object with no layout"));
        };
        let Some(entry) = layout.fields.get(field as usize) else {
            return Err(refuse(self.func, "a field this object's layout does not have"));
        };
        let Some(descriptor) = types::descriptor(self.program, &entry.ty) else {
            return Err(refuse(
                self.func,
                &format!("a field of unrepresentable type: {}", types::describe(&entry.ty)),
            ));
        };
        Ok((
            types::class_name(layout),
            crate::body::method_name(&entry.name),
            descriptor,
        ))
    }

    /// The binary operations whose operands are references, which is every one
    /// where the JVM's own instruction would compare or concatenate the wrong
    /// thing. `None` means this is ordinary scalar arithmetic.
    ///
    /// `===` on two strings compares by value, so it is a helper call and never
    /// `if_acmpeq`. Getting that wrong is silent wherever two equal strings
    /// happen to be one constant-pool entry, which is most of a test suite --
    /// record 0044 found exactly that in the LLVM backend.
    fn reference_binary(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<Option<Placed>, Diagnostic> {
        let equality = matches!(op, BinOp::Eq | BinOp::Ne);
        let (owner, name, signature) = match self.ty(lhs) {
            HirType::Managed(ManagedType::String) if equality => (
                RUNTIME,
                "stringEq",
                "(Ljava/lang/String;Ljava/lang/String;)Z",
            ),
            HirType::Erased if equality => (
                types::VALUE,
                "strictEq",
                "(Lnts/rt/NtsValue;Lnts/rt/NtsValue;)Z",
            ),
            _ if op == BinOp::Concat => {
                let origin = self.func.values[lhs.0 as usize].origin.clone();
                self.load(code, lhs)?;
                self.load(code, rhs)?;
                code.invoke_virtual(
                    &origin,
                    pool,
                    types::STRING,
                    "concat",
                    "(Ljava/lang/String;)Ljava/lang/String;",
                );
                return Ok(Some(Placed::OnStack));
            }
            _ => return Ok(None),
        };
        let origin = self.func.values[lhs.0 as usize].origin.clone();
        self.load(code, lhs)?;
        self.load(code, rhs)?;
        code.invoke_static(&origin, pool, owner, name, signature);
        if op == BinOp::Ne {
            code.const_int(&origin, pool, 1);
            code.bitwise(&origin, insn::XOR, Kind::Int);
        }
        Ok(Some(Placed::OnStack))
    }

    /// A comparison whose result is a value rather than a branch: 0 or 1
    /// through the scratch slot, so the operand stack is empty at both labels
    /// and the frame stays the universal one.
    fn materialize_comparison(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        compare: Compare,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.origin.clone();
        let Some(scratch) = self.scratch else {
            return Err(refuse(self.func, "a comparison with no scratch slot"));
        };
        let taken = code.label();
        let done = code.label();
        self.compare_and_branch(code, compare, false, lhs, rhs, taken)?;
        code.const_int(&origin, pool, 0);
        code.store(&origin, Kind::Int, scratch);
        code.goto(&origin, done);
        code.bind(taken);
        code.const_int(&origin, pool, 1);
        code.store(&origin, Kind::Int, scratch);
        code.bind(done);
        code.load(&origin, Kind::Int, scratch);
        Ok(Placed::OnStack)
    }

    fn binary(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.origin.clone();
        if let Some(placed) = self.reference_binary(code, pool, op, lhs, rhs)? {
            return Ok(placed);
        }
        if let Some(compare) = comparison(op) {
            return self.materialize_comparison(code, pool, compare, lhs, rhs);
        }

        let kind = types::kind(result)
            .ok_or_else(|| refuse(self.func, "an arithmetic result of unrepresentable type"))?;
        // The opcode and its stack effect come from the *result*, and the
        // operands are loaded by their own kinds. Those agree in every prepared
        // HIR seen so far -- and where they did not, the symptom was a stack
        // that stopped balancing several instructions later. So the agreement
        // is checked here rather than assumed, which is record 0077's rule: the
        // second place that must agree should assert rather than compute.
        let left = self.kind_of(lhs)?;
        let right = self.kind_of(rhs)?;
        let counts_as_shift = matches!(op, BinOp::Shl | BinOp::Shr | BinOp::UShr);
        if left != kind || (right != kind && !(counts_as_shift && right == Kind::Int)) {
            return Err(refuse(
                self.func,
                &format!(
                    "a `{op:?}` whose operands are {left:?} and {right:?} but whose \
                     result is {kind:?} -- the middle end usually agrees, and where \
                     it does not this backend would emit an unbalanced stack"
                ),
            ));
        }
        self.load(code, lhs)?;
        self.load(code, rhs)?;
        match op {
            BinOp::Add => code.arithmetic(&origin, insn::ADD, kind),
            BinOp::Sub => code.arithmetic(&origin, insn::SUB, kind),
            BinOp::Mul => code.arithmetic(&origin, insn::MUL, kind),
            BinOp::Div | BinOp::Rem if matches!(kind, Kind::Int | Kind::Long) => {
                // `idiv` throws on a zero divisor where C is undefined, and
                // nothing upstream proves the divisor non-zero. One helper
                // rather than a guard at every site.
                let (name, signature) = match (op, kind) {
                    (BinOp::Div, Kind::Long) => ("ldiv", "(JJ)J"),
                    (BinOp::Rem, Kind::Long) => ("lrem", "(JJ)J"),
                    (BinOp::Div, _) => ("idiv", "(II)I"),
                    (_, _) => ("irem", "(II)I"),
                };
                code.invoke_static(&origin, pool, RUNTIME, name, signature);
            }
            BinOp::Div => code.arithmetic(&origin, insn::DIV, kind),
            BinOp::Rem => code.arithmetic(&origin, insn::REM, kind),
            BinOp::BitAnd => code.bitwise(&origin, insn::AND, kind),
            BinOp::BitOr => code.bitwise(&origin, insn::OR, kind),
            BinOp::BitXor => code.bitwise(&origin, insn::XOR, kind),
            BinOp::Shl => code.shift(&origin, insn::SHL, kind),
            BinOp::Shr => code.shift(&origin, insn::SHR, kind),
            BinOp::UShr => code.shift(&origin, insn::USHR, kind),
            // `Math.min` and `Math.max` on doubles are JavaScript's, exactly:
            // NaN propagates and `-0.0` is less than `0.0`. C's `fmin`/`fmax`
            // are wrong on both, which is why the native runtime has its own.
            BinOp::Min | BinOp::Max => {
                let name = if op == BinOp::Min { "min" } else { "max" };
                let descriptor = kind.descriptor();
                let signature = format!("({descriptor}{descriptor}){descriptor}");
                code.invoke_static(&origin, pool, "java/lang/Math", name, &signature);
            }
            BinOp::Concat => return Err(refuse(self.func, "a string concatenation")),
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq | BinOp::Ne => {
                unreachable!("comparisons are handled above")
            }
        }
        Ok(Placed::OnStack)
    }

    /// Load two operands and branch when the comparison holds.
    /// `negate` asks for the branch taken when the comparison is false, which
    /// is what a fallthrough to the true arm needs. It is passed down rather
    /// than applied here: on a float, inverting the *comparison* changes which
    /// `dcmp` form is correct and gets `NaN` wrong -- see
    /// [`Code::branch_float_when`].
    pub(crate) fn compare_and_branch(
        &mut self,
        code: &mut Code,
        compare: Compare,
        negate: bool,
        lhs: ValueId,
        rhs: ValueId,
        target: Label,
    ) -> Result<(), Diagnostic> {
        let origin = self.func.values[lhs.0 as usize].origin.clone();
        let kind = self.kind_of(lhs)?;
        self.load(code, lhs)?;
        self.load(code, rhs)?;
        // Integers are totally ordered, so inverting the comparison and
        // inverting the test are the same thing there. Floats are not, which is
        // why only this arm may do it.
        let test = if negate { compare.inverted() } else { compare };
        match kind {
            Kind::Int => code.branch_int(&origin, test, target),
            // No `if_lcmp`: a `long` comparison is `lcmp` and then a test
            // against zero, which is what `branch_zero` reads.
            Kind::Long => {
                code.compare(&origin, insn::LCMP, Kind::Long);
                code.branch_zero(&origin, test, target);
            }
            Kind::Float | Kind::Double => {
                code.branch_float_when(&origin, compare, negate, kind, target);
            }
            Kind::Ref => return Err(refuse(self.func, "a comparison of references")),
        }
        Ok(())
    }

    fn unary(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        op: UnOp,
        operand: ValueId,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.values[operand.0 as usize].origin.clone();
        let from = self.kind_of(operand)?;
        if op == UnOp::Truthy {
            return self.truthy(code, pool, operand, from);
        }
        self.load(code, operand)?;
        let kind = types::kind(result)
            .ok_or_else(|| refuse(self.func, "a unary result of unrepresentable type"))?;
        match op {
            UnOp::Neg => code.negate(&origin, kind),
            // `!x` on a boolean, which is an `int` that is 0 or 1.
            UnOp::Not => {
                code.const_int(&origin, pool, 1);
                code.bitwise(&origin, insn::XOR, Kind::Int);
            }
            UnOp::ToInt32 | UnOp::ToUint32 => {
                self.coercion(code, pool, op, from, result, &origin)?;
            }
            UnOp::Floor => code.invoke_static(&origin, pool, "java/lang/Math", "floor", "(D)D"),
            UnOp::Ceil => code.invoke_static(&origin, pool, "java/lang/Math", "ceil", "(D)D"),
            UnOp::Sqrt => code.invoke_static(&origin, pool, "java/lang/Math", "sqrt", "(D)D"),
            // `java.lang.Math` has no `trunc`, and `Math.round` returns a
            // `long`: it saturates, answers 0 for NaN, and cannot produce the
            // `-0` that `Math.round(-0.4)` must.
            UnOp::Trunc => code.invoke_static(&origin, pool, RUNTIME, "trunc", "(D)D"),
            UnOp::Round => code.invoke_static(&origin, pool, RUNTIME, "round", "(D)D"),
            UnOp::Abs => {
                let descriptor = kind.descriptor();
                let signature = format!("({descriptor}){descriptor}");
                code.invoke_static(&origin, pool, "java/lang/Math", "abs", &signature);
            }
            UnOp::Truthy => unreachable!("handled above"),
        }
        Ok(Placed::OnStack)
    }

    /// `ToInt32` and `ToUint32`: a reduction to thirty-two bits, and then a
    /// widening into whatever slot the middle end gave the result.
    ///
    /// # The widening is not optional, and the sign lives in it
    ///
    /// The prepared HIR for `h >>> 7` contains `touint32 %2 : i64` -- an `i32`
    /// operand and an `i64` result. The coercion *is* a reduction to thirty-two
    /// bits, and where it lands afterwards is a separate decision the middle
    /// end already made. Emitting the reduction alone leaves an `int` on the
    /// stack where the slot wants a `long`, which is not a wrong number: it is
    /// a stack that no longer balances, and `Code`'s tracking catches it at the
    /// next block boundary rather than at the cause.
    ///
    /// The LLVM backend records the same bug from the other side -- "producing
    /// `i32` and calling it the result's type made a value whose emitted width
    /// disagreed with its recorded one … the module stopped verifying several
    /// instructions away from the cause".
    ///
    /// And the sign belongs to the *widening*, not to the reduction: both
    /// coercions reduce to the same thirty-two bits and differ only in whether
    /// widening them keeps a negative number negative. `ToUint32` therefore
    /// widens through `Integer.toUnsignedLong`, which is the JVM's spelling of
    /// `zext` on a machine with no unsigned types.
    fn coercion(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        op: UnOp,
        from: Kind,
        result: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        // Step one: down to thirty-two bits.
        match from {
            Kind::Double | Kind::Float => {
                if from == Kind::Float {
                    code.convert(origin, insn::F2D, Kind::Float, Kind::Double);
                }
                // The ten-instruction reduction the runtime spells out, called
                // rather than reproduced: inlining it would be a second
                // implementation of `ToInt32` to keep in step with the first.
                let name = if op == UnOp::ToInt32 { "toInt32" } else { "toUint32" };
                code.invoke_static(origin, pool, RUNTIME, name, "(D)I");
            }
            Kind::Long => code.convert(origin, insn::L2I, Kind::Long, Kind::Int),
            Kind::Int => {}
            Kind::Ref => return Err(refuse(self.func, "a coercion of a reference")),
        }

        // Step two: back out to the slot the middle end chose.
        let signed = op == UnOp::ToInt32;
        let target = types::kind(result)
            .ok_or_else(|| refuse(self.func, "a coercion into an unrepresentable type"))?;
        if target == Kind::Int {
            return Ok(());
        }
        if signed {
            let opcode = match target {
                Kind::Long => insn::I2L,
                Kind::Float => insn::I2F,
                _ => insn::I2D,
            };
            code.convert(origin, opcode, Kind::Int, target);
            return Ok(());
        }
        // Unsigned: widen through `long` so the top bit does not sign-extend.
        code.invoke_static(origin, pool, "java/lang/Integer", "toUnsignedLong", "(I)J");
        match target {
            Kind::Long => {}
            Kind::Float => code.convert(origin, insn::L2F, Kind::Long, Kind::Float),
            _ => code.convert(origin, insn::L2D, Kind::Long, Kind::Double),
        }
        Ok(())
    }

    /// JavaScript truthiness for a scalar, which is not `!= 0`.
    ///
    /// `NaN` is falsy and `NaN != 0` is true, so a double needs both tests.
    fn truthy(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        operand: ValueId,
        kind: Kind,
    ) -> Result<Placed, Diagnostic> {
        let origin = self.func.values[operand.0 as usize].origin.clone();
        if matches!(self.ty(operand), HirType::Bool) {
            self.load(code, operand)?;
            return Ok(Placed::OnStack);
        }
        // Emptiness, not nullness -- and a null one is falsy too, so a length
        // check alone throws on the case it is meant to answer.
        if matches!(self.ty(operand), HirType::Managed(ManagedType::String)) {
            self.load(code, operand)?;
            code.invoke_static(&origin, pool, RUNTIME, "stringTruthy", "(Ljava/lang/String;)Z");
            return Ok(Placed::OnStack);
        }
        if *self.ty(operand) == HirType::Erased {
            self.load(code, operand)?;
            code.invoke_static(&origin, pool, types::VALUE, "truthy", "(Lnts/rt/NtsValue;)Z");
            return Ok(Placed::OnStack);
        }
        let Some(scratch) = self.scratch else {
            return Err(refuse(self.func, "a truthiness test with no scratch slot"));
        };
        let falsy = code.label();
        let done = code.label();
        match kind {
            Kind::Int => {
                self.load(code, operand)?;
                code.branch_zero(&origin, Compare::Eq, falsy);
            }
            Kind::Long => {
                self.load(code, operand)?;
                code.const_long(&origin, pool, 0);
                code.compare(&origin, insn::LCMP, Kind::Long);
                code.branch_zero(&origin, Compare::Eq, falsy);
            }
            Kind::Float | Kind::Double => {
                // `x != x` is the NaN test, and it must come first: `NaN != 0`
                // is true, so testing against zero alone calls NaN truthy.
                self.load(code, operand)?;
                self.load(code, operand)?;
                code.branch_float(&origin, Compare::Ne, kind, falsy);
                self.load(code, operand)?;
                if kind == Kind::Double {
                    code.const_double(&origin, pool, 0.0);
                } else {
                    code.const_float(&origin, pool, 0.0);
                }
                code.branch_float(&origin, Compare::Eq, kind, falsy);
            }
            Kind::Ref => return Err(refuse(self.func, "truthiness of a reference")),
        }
        code.const_int(&origin, pool, 1);
        code.store(&origin, Kind::Int, scratch);
        code.goto(&origin, done);
        code.bind(falsy);
        code.const_int(&origin, pool, 0);
        code.store(&origin, Kind::Int, scratch);
        code.bind(done);
        code.load(&origin, Kind::Int, scratch);
        Ok(Placed::OnStack)
    }

    /// A representation change the middle end decided, with the operand
    /// already on the stack.
    ///
    /// `d2i` is right *here* and wrong for `UnOp::ToInt32`: a `Convert` is
    /// emitted only where specialization proved the value integral and in
    /// range, which is the same proof the C backend's plain cast relies on.
    fn convert(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        from: &HirType,
        to: &HirType,
        origin: &nts_semantic_schema::Origin,
    ) -> Result<(), Diagnostic> {
        let source = types::kind(from)
            .ok_or_else(|| refuse(self.func, "a conversion from an unrepresentable type"))?;
        let target = types::kind(to)
            .ok_or_else(|| refuse(self.func, "a conversion to an unrepresentable type"))?;
        // Widen to the computational kind first, then narrow to the declared
        // width. Doing it in one step would need a case per pair.
        let opcode = match (source, target) {
            (a, b) if a == b => None,
            (Kind::Int, Kind::Long) => Some(insn::I2L),
            (Kind::Int, Kind::Float) => Some(insn::I2F),
            (Kind::Int, Kind::Double) => Some(insn::I2D),
            (Kind::Long, Kind::Int) => Some(insn::L2I),
            (Kind::Long, Kind::Float) => Some(insn::L2F),
            (Kind::Long, Kind::Double) => Some(insn::L2D),
            (Kind::Float, Kind::Int) => Some(insn::F2I),
            (Kind::Float, Kind::Long) => Some(insn::F2L),
            (Kind::Float, Kind::Double) => Some(insn::F2D),
            (Kind::Double, Kind::Int) => Some(insn::D2I),
            (Kind::Double, Kind::Long) => Some(insn::D2L),
            (Kind::Double, Kind::Float) => Some(insn::D2F),
            _ => return Err(refuse(self.func, "a conversion this backend has no opcode for")),
        };
        if let Some(opcode) = opcode {
            code.convert(origin, opcode, source, target);
        }
        // An integer narrower than its slot keeps only its own bits, which is
        // observable: `(x | 0) & 0xff` and a `Uint8Array` element are the same
        // question. The JVM has no narrow slot, so the mask is explicit.
        if target == Kind::Int {
            match to {
                HirType::Int { bits: 8, signed: true } => {
                    code.convert(origin, insn::I2B, Kind::Int, Kind::Int);
                }
                HirType::Int { bits: 16, signed: true } => {
                    code.convert(origin, insn::I2S, Kind::Int, Kind::Int);
                }
                HirType::Int { bits: 16, signed: false } => {
                    code.convert(origin, insn::I2C, Kind::Int, Kind::Int);
                }
                HirType::Int { bits: 8, signed: false } => {
                    code.const_int(origin, pool, 0xFF);
                    code.bitwise(origin, insn::AND, Kind::Int);
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn call(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        result: &HirType,
        callee: &Callee,
        args: &[ValueId],
        origin: &nts_semantic_schema::Origin,
    ) -> Result<Placed, Diagnostic> {
        let name = match callee {
            Callee::Direct(name) => name,
            Callee::External(name) => {
                return Err(refuse(
                    self.func,
                    &format!("a call to `{name}`, which needs a runtime this slice has not built"),
                ));
            }
            Callee::Virtual { declared, .. } => {
                return Err(refuse(self.func, &format!("a virtual call to `{declared}`")));
            }
            Callee::Closure { .. } => {
                return Err(refuse(self.func, "a call through a closure"));
            }
        };
        let Some(target) = self.program.funcs.iter().find(|func| &func.name == name) else {
            return Err(refuse(self.func, &format!("a call to `{name}`, which is not in this program")));
        };
        let Some(signature) = crate::body::signature(self.program, target) else {
            return Err(refuse(self.func, &format!("a call to `{name}`, whose signature has no representation")));
        };
        for &arg in args {
            self.load(code, arg)?;
        }
        let method = crate::body::method_name(name);
        code.invoke_static(origin, pool, PROGRAM, &method, &signature);
        Ok(if matches!(result, HirType::Void) {
            Placed::Stored
        } else {
            Placed::OnStack
        })
    }

    fn terminator(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        block: BlockId,
        terminator: &Terminator,
        next: Option<BlockId>,
        fused: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        let origin = self.func.blocks[block.0 as usize]
            .ops
            .last()
            .map_or_else(|| self.func.origin.clone(), |&value| {
                self.func.values[value.0 as usize].origin.clone()
            });
        match terminator {
            Terminator::Return(value) => {
                match value {
                    Some(value) => {
                        self.load(code, *value)?;
                        let kind = self.kind_of(*value)?;
                        code.ret(&origin, Some(kind));
                    }
                    None => code.ret(&origin, None),
                }
                Ok(())
            }
            // The JVM has no `__builtin_unreachable`, and its verifier requires
            // every path to end in a transfer. So a claim the compiler made and
            // got wrong becomes a stack trace rather than an optimizer licence
            // to compute anything -- the one place this backend is a better
            // instrument than the other two.
            Terminator::Unreachable | Terminator::FellThrough => {
                code.invoke_static(&origin, pool, RUNTIME, "unreachable", "()Ljava/lang/Error;");
                code.athrow(&origin);
                Ok(())
            }
            Terminator::Jump { target, args } => {
                self.edge(code, pool, *target, args)?;
                if next != Some(*target) {
                    let label = self.labels[target];
                    code.goto(&origin, label);
                }
                Ok(())
            }
            Terminator::Branch { cond, then_target, then_args, else_target, else_args } => {
                let then_copies = self.copies(*then_target, then_args);
                let else_copies = self.copies(*else_target, else_args);
                let then_label = self.labels[then_target];
                let else_label = self.labels[else_target];

                if then_copies.is_empty() && else_copies.is_empty() {
                    // The common shape: no block arguments, so the branch is
                    // one instruction and one arm falls through.
                    if next == Some(*else_target) {
                        self.branch_on(code, pool, *cond, fused, false, then_label)?;
                    } else if next == Some(*then_target) {
                        self.branch_on(code, pool, *cond, fused, true, else_label)?;
                    } else {
                        self.branch_on(code, pool, *cond, fused, false, then_label)?;
                        code.goto(&origin, else_label);
                    }
                    return Ok(());
                }

                // Arms with copies need somewhere to put them, so the true arm
                // gets a label of its own and the false arm falls through.
                let arm = code.label();
                self.branch_on(code, pool, *cond, fused, false, arm)?;
                self.apply(code, else_copies)?;
                code.goto(&origin, else_label);
                code.bind(arm);
                self.apply(code, then_copies)?;
                code.goto(&origin, then_label);
                Ok(())
            }
        }
    }

    /// Branch on a condition, using the fused comparison where there is one.
    ///
    /// `invert` asks for the branch that is taken when the condition is
    /// *false*, which is what a fallthrough to the true arm needs.
    fn branch_on(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        cond: ValueId,
        fused: Option<ValueId>,
        invert: bool,
        target: Label,
    ) -> Result<(), Diagnostic> {
        let _ = pool;
        let origin = self.func.values[cond.0 as usize].origin.clone();
        if fused == Some(cond) {
            let OpKind::Binary { op, lhs, rhs } = self.func.values[cond.0 as usize].kind else {
                return Err(refuse(self.func, "a fused condition that is not a comparison"));
            };
            let Some(compare) = comparison(op) else {
                return Err(refuse(self.func, "a fused condition that is not a comparison"));
            };
            return self.compare_and_branch(code, compare, invert, lhs, rhs, target);
        }
        self.load(code, cond)?;
        let compare = if invert { Compare::Eq } else { Compare::Ne };
        code.branch_zero(&origin, compare, target);
        Ok(())
    }

    fn copies(&self, target: BlockId, args: &[ValueId]) -> Vec<Copy> {
        let params = &self.func.blocks[target.0 as usize].params;
        nts_codegen_common::edge_copies(params, args)
    }

    fn edge(
        &mut self,
        code: &mut Code,
        pool: &mut Pool,
        target: BlockId,
        args: &[ValueId],
    ) -> Result<(), Diagnostic> {
        let _ = pool;
        let copies = self.copies(target, args);
        self.apply(code, copies)
    }

    /// A sequenced parallel copy, as loads and stores.
    ///
    /// The sequencing is `nts_codegen_common`'s, not this backend's -- two
    /// emitters ordering a swap independently is exactly the drift that crate
    /// exists to prevent.
    fn apply(&mut self, code: &mut Code, copies: Vec<Copy>) -> Result<(), Diagnostic> {
        for copy in copies {
            match copy {
                Copy::Move { to, from } => {
                    let kind = self.kind_of(from)?;
                    let origin = self.func.values[from.0 as usize].origin.clone();
                    self.load(code, from)?;
                    let Some(slot) = self.slot(to) else {
                        return Err(refuse(self.func, "a block parameter with no storage"));
                    };
                    code.store(&origin, kind, slot);
                }
                Copy::Save { temp, from } => {
                    let kind = self.kind_of(from)?;
                    let origin = self.func.values[from.0 as usize].origin.clone();
                    self.load(code, from)?;
                    let Some(&slot) = self.temps.get(&(temp, kind as u8)) else {
                        return Err(refuse(self.func, "a copy cycle with no scratch slot"));
                    };
                    code.store(&origin, kind, slot);
                }
                Copy::Restore { to, temp } => {
                    let kind = self.kind_of(to)?;
                    let origin = self.func.values[to.0 as usize].origin.clone();
                    let Some(&slot) = self.temps.get(&(temp, kind as u8)) else {
                        return Err(refuse(self.func, "a copy cycle with no scratch slot"));
                    };
                    code.load(&origin, kind, slot);
                    let Some(target) = self.slot(to) else {
                        return Err(refuse(self.func, "a block parameter with no storage"));
                    };
                    code.store(&origin, kind, target);
                }
            }
        }
        Ok(())
    }
}

/// What a refusal calls an operation this slice does not implement.
fn unsupported(kind: &OpKind) -> String {
    match kind {
        OpKind::ConstNull | OpKind::ConstUndefined => "an absent value".to_owned(),
        OpKind::ClosureStatic => "a function used as a value".to_owned(),
        OpKind::CellReady { .. } => "a captured binding".to_owned(),
        OpKind::Retain(_) | OpKind::Release(_) => {
            "reference counting, which the JVM lane must not see: build with the \
             default provider so the platform collector owns the heap"
                .to_owned()
        }
        OpKind::Await { .. } | OpKind::Suspend { .. } => "an `await`".to_owned(),
        OpKind::Return(_) => "a return operation".to_owned(),
        other => format!("{other:?}"),
    }
}
