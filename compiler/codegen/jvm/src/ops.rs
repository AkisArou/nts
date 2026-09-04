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
use nts_core::hir::{BinOp, BlockId, Callee, HirType, OpKind, Terminator, UnOp, ValueId};
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
        let OpKind::Binary { op, .. } = self.func.values[cond.0 as usize].kind else {
            return None;
        };
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

            OpKind::ConstBool(flag) => {
                code.const_int(&origin, pool, i32::from(*flag));
                Placed::OnStack
            }
            OpKind::ConstInt(number) => {
                match types::kind(&op.ty) {
                    Some(Kind::Long) => {
                        let Ok(narrow) = i64::try_from(*number) else {
                            return Err(refuse(self.func, "an integer literal wider than 64 bits"));
                        };
                        code.const_long(&origin, pool, narrow);
                    }
                    Some(Kind::Int) => {
                        let Ok(narrow) = i32::try_from(*number) else {
                            return Err(refuse(self.func, "an integer literal wider than its slot"));
                        };
                        code.const_int(&origin, pool, narrow);
                    }
                    _ => return Err(refuse(self.func, "an integer literal of unrepresentable type")),
                }
                Placed::OnStack
            }
            OpKind::ConstFloat(number) => {
                if matches!(op.ty, HirType::Float { bits: 32 }) {
                    #[allow(
                        clippy::cast_possible_truncation,
                        reason = "the lowering typed this value `f32`, so it is one"
                    )]
                    code.const_float(&origin, pool, *number as f32);
                } else {
                    code.const_double(&origin, pool, *number);
                }
                Placed::OnStack
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
                let Some(descriptor) = types::descriptor(&entry.ty) else {
                    return Err(refuse(self.func, "a global of unrepresentable type"));
                };
                let name = crate::body::method_name(&entry.name);
                code.get_static(&origin, pool, PROGRAM, &name, descriptor);
                Placed::OnStack
            }
            OpKind::GlobalSet { global, value: stored } => {
                let Some(entry) = self.program.globals.get(*global as usize) else {
                    return Err(refuse(self.func, "a global this program does not declare"));
                };
                let Some(descriptor) = types::descriptor(&entry.ty) else {
                    return Err(refuse(self.func, "a global of unrepresentable type"));
                };
                let name = crate::body::method_name(&entry.name);
                self.load(code, *stored)?;
                code.put_static(&origin, pool, PROGRAM, &name, descriptor);
                return Ok(());
            }

            OpKind::Call { callee, args, .. } => self.call(code, pool, &op.ty, callee, args, &origin)?,

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
        if let Some(compare) = comparison(op) {
            // Materialize: 0 or 1 through the scratch slot, so the stack is
            // empty at both labels and the frame stays the universal one.
            let Some(scratch) = self.scratch else {
                return Err(refuse(self.func, "a comparison with no scratch slot"));
            };
            let taken = code.label();
            let done = code.label();
            self.compare_and_branch(code, compare, lhs, rhs, taken)?;
            code.const_int(&origin, pool, 0);
            code.store(&origin, Kind::Int, scratch);
            code.goto(&origin, done);
            code.bind(taken);
            code.const_int(&origin, pool, 1);
            code.store(&origin, Kind::Int, scratch);
            code.bind(done);
            code.load(&origin, Kind::Int, scratch);
            return Ok(Placed::OnStack);
        }

        let kind = types::kind(result)
            .ok_or_else(|| refuse(self.func, "an arithmetic result of unrepresentable type"))?;
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
    pub(crate) fn compare_and_branch(
        &mut self,
        code: &mut Code,
        compare: Compare,
        lhs: ValueId,
        rhs: ValueId,
        target: Label,
    ) -> Result<(), Diagnostic> {
        let origin = self.func.values[lhs.0 as usize].origin.clone();
        let kind = self.kind_of(lhs)?;
        self.load(code, lhs)?;
        self.load(code, rhs)?;
        match kind {
            Kind::Int => code.branch_int(&origin, compare, target),
            // No `if_lcmp`: a `long` comparison is `lcmp` and then a test
            // against zero, which is what `branch_zero` reads.
            Kind::Long => {
                code.compare(&origin, insn::LCMP, Kind::Long);
                code.branch_zero(&origin, compare, target);
            }
            Kind::Float | Kind::Double => code.branch_float(&origin, compare, kind, target),
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
            // JavaScript's coercions, not the JVM's. `d2i` saturates where
            // `ToInt32` wraps, and it is *defined* rather than undefined, which
            // makes it the more dangerous of the two wrong answers.
            UnOp::ToInt32 | UnOp::ToUint32 if from == Kind::Double => {
                let name = if op == UnOp::ToInt32 { "toInt32" } else { "toUint32" };
                code.invoke_static(&origin, pool, RUNTIME, name, "(D)I");
            }
            UnOp::ToInt32 | UnOp::ToUint32 => {
                // Already an integer: the operation is the identity on the
                // thirty-two bits, whichever way they are read.
                if from == Kind::Long {
                    code.convert(&origin, insn::L2I, Kind::Long, Kind::Int);
                }
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
        let Some(signature) = crate::body::signature(target) else {
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
            let compare = if invert { compare.inverted() } else { compare };
            return self.compare_and_branch(code, compare, lhs, rhs, target);
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
        OpKind::ConstString(_) => "a string literal".to_owned(),
        OpKind::ConstNull | OpKind::ConstUndefined => "an absent value".to_owned(),
        OpKind::Erase { .. } | OpKind::Unerase { .. } | OpKind::TagOf { .. } => {
            "an erased value".to_owned()
        }
        OpKind::ArrayNew { .. } | OpKind::ArrayGet { .. } | OpKind::ArraySet { .. } => {
            "an array".to_owned()
        }
        OpKind::Length(_) => "a length".to_owned(),
        OpKind::StringUnitAt { .. } => "indexing a string".to_owned(),
        OpKind::ObjectNew { .. } | OpKind::FieldGet { .. } | OpKind::FieldSet { .. } => {
            "an object".to_owned()
        }
        OpKind::InstanceOf { .. } => "an `instanceof` test".to_owned(),
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
