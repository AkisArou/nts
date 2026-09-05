//! One function, as a method body.
//!
//! # Storage
//!
//! One local slot per SSA value, assigned once and never reused. That is what
//! the C backend does -- "declared at the top, where SSA guarantees each is
//! assigned before any use" -- and it is what makes the stack map table in
//! `nts_jvm_emitter::frames` a pure function of the slot table rather than an
//! abstract interpretation. Reusing slots by live range is an optimization
//! whose price is per-block frames, and it is not worth paying before a
//! histogram says a real function is near the limit.
//!
//! # A comparison that feeds a branch never becomes a value
//!
//! `x < y` lowers to a `Binary` producing a `Bool` and a `Branch` reading it.
//! Emitted literally that is a compare, a jump, two constants, a store, a load
//! and a second jump -- because the JVM has no instruction that leaves a
//! boolean on the stack. So when the comparison is the last operation in its
//! block and nothing else reads it, the branch consumes it directly. That is
//! the shape almost every conditional has.

use nts_codegen_common::symbols::jvm_member_name;
use nts_codegen_common::{Copy, block_order, destruct, edge_copies};
use nts_core::hir::{
    BinOp, BlockId, Func, HirType, OpKind, Program, UnOp, ValueId,
};
use nts_diagnostics::Diagnostic;
use nts_jvm_emitter::code::{Code, Label};
use nts_jvm_emitter::{Body, Compare, Kind, Pool, VType};
use rustc_hash::FxHashMap;

use crate::types;

/// Where the runtime's helpers live.
pub const RUNTIME: &str = "nts/rt/NtsRuntime";
/// The class every free function becomes a static method on.
pub const PROGRAM: &str = "nts/gen/Program";

/// A refusal, named the way the other backends name theirs.
///
/// `NTS4001` and up: C took 2000, LLVM took 3000.
#[must_use]
pub fn refuse(func: &Func, what: &str) -> Diagnostic {
    Diagnostic::error(
        "NTS4001",
        format!("{what} (in `{}`)", func.name),
        func.origin.location,
    )
}

/// Refuse a signature this slice has no representation for, before any storage
/// is laid out.
///
/// Separate from the body walk because a signature is refusable on its own
/// terms: a parameter type with no descriptor is a refusal whatever the body
/// does, and saying so here keeps the slot allocation below about slots.
fn check_signature(program: &Program, func: &Func) -> Result<(), Diagnostic> {
    for param in &func.params {
        if types::descriptor(types::Shape::of(program), &param.ty).is_none() {
            return Err(refuse(
                func,
                &format!("a parameter of unrepresentable type: {}", types::describe(&param.ty)),
            ));
        }
    }
    if types::descriptor(types::Shape::of(program), &func.return_type).is_none() {
        return Err(refuse(
            func,
            &format!(
                "a return type with no representation: {}",
                types::describe(&func.return_type)
            ),
        ));
    }
    Ok(())
}

/// The values whose slots need a declared verification type.
///
/// A slot needs a declared verification type only where a frame can see
/// it undefined; everywhere else it is `Top` and costs no
/// definite-assignment store in the prologue. Frames sit at block heads
/// -- and, the part that cost two attempts, *inside* a block too:
/// `materializes` says out loud that turning a comparison into a 0 or a
/// 1 is "the only thing that puts a label inside a block". A value
/// defined and read within one block still crosses a frame if a
/// comparison materializes between the two.
///
/// So the question is asked per op index rather than per block: a value
/// is `Top` only if every read of it is in its own block with no label
/// in between. Fusion is ignored -- a fused comparison emits no label,
/// so counting it costs a slot its `Top` and never soundness.
fn crossing_values(func: &Func) -> rustc_hash::FxHashSet<ValueId> {
    let puts_label = |value: ValueId| match &func.values[value.0 as usize].kind {
        OpKind::Binary { op, .. } => comparison(*op).is_some(),
        OpKind::Unary { op: UnOp::Truthy, operand } => {
            !matches!(func.values[operand.0 as usize].ty, HirType::Bool)
        }
        _ => false,
    };
    let mut defined_at: Vec<Option<(usize, usize)>> = vec![None; func.values.len()];
    for (block_at, block) in func.blocks.iter().enumerate() {
        for (index, value) in block.ops.iter().enumerate() {
            defined_at[value.0 as usize] = Some((block_at, index));
        }
    }
    let mut crosses: rustc_hash::FxHashSet<ValueId> = rustc_hash::FxHashSet::default();
    for (block_at, block) in func.blocks.iter().enumerate() {
        // A block parameter is written by predecessors, so its slot is
        // always live across this block's own frame.
        crosses.extend(block.params.iter().copied());
        let labels: Vec<usize> = block
            .ops
            .iter()
            .enumerate()
            .filter(|&(_, &value)| puts_label(value))
            .map(|(index, _)| index)
            .collect();
        let reads = block
            .ops
            .iter()
            .enumerate()
            .flat_map(|(index, value)| {
                nts_core::hir::operands_of(&func.values[value.0 as usize].kind)
                    .into_iter()
                    .map(move |operand| (operand, index))
            })
            .chain(
                nts_core::hir::operands_of_terminator(&block.terminator)
                    .into_iter()
                    .map(|operand| (operand, block.ops.len())),
            );
        for (operand, read_at) in reads {
            match defined_at[operand.0 as usize] {
                Some((defined_block, defined_index)) if defined_block == block_at => {
                    if labels
                        .iter()
                        .any(|&label| label > defined_index && label < read_at)
                    {
                        crosses.insert(operand);
                    }
                }
                // Defined in another block, or nowhere this walk can see.
                _ => {
                    crosses.insert(operand);
                }
            }
        }
    }
    crosses
}

/// A constant this backend re-emits at each use rather than storing once.
///
/// The JVM is a stack machine and a constant is one instruction that cannot
/// fail: `iconst_1` is a byte, where `istore` plus a later `iload` is four
/// bytes, a local slot, and a dependency the JIT has to see through. Every
/// constant was going to a slot, and `upTo__resume` opened `iconst_1; istore
/// 40; iload 39; iload 40; iadd` where `iload 39; iconst_1; iadd` is the same
/// program.
///
/// A 128-bit literal is excluded because it is not a push: it is
/// `NtsBigInt.of(J J)`, which allocates, and re-emitting that per use would
/// trade four bytes for an object.
pub(crate) fn rematerialised(func: &Func, value: ValueId) -> bool {
    let op = &func.values[value.0 as usize];
    match op.kind {
        OpKind::ConstBool(_) | OpKind::ConstFloat(_) => true,
        OpKind::ConstInt(_) => !matches!(op.ty, HirType::BigInt),
        _ => false,
    }
}

/// Whether an operation produced its value on the stack or wrote it away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Placed {
    OnStack,
    Stored,
}

#[derive(Debug)]
pub struct Emitter<'a> {
    pub(crate) program: &'a Program,
    /// The program plus the one whole-program fact that changes a type's
    /// spelling; see [`types::Shape`].
    pub(crate) shape: types::Shape<'a>,
    pub(crate) func: &'a Func,
    /// Slot per value. `None` for a value nothing reads.
    pub(crate) slots: Vec<Option<u16>>,
    pub(crate) locals: Vec<VType>,
    pub(crate) max_locals: u16,
    /// One `int` slot for a materialized comparison, allocated only if used.
    pub(crate) scratch: Option<u16>,
    /// Erased values held as a bare reference rather than an `NtsValue`.
    pub(crate) unboxed: rustc_hash::FxHashSet<ValueId>,
    /// `i32` values held in a `double` slot on this target; see `widen`.
    pub(crate) widened: rustc_hash::FxHashSet<ValueId>,
    /// `i64` values held in an `int` slot on this target; see `narrow`.
    pub(crate) narrowed: rustc_hash::FxHashSet<ValueId>,
    /// `(declaring class, field name)` for fields held as a `double`.
    pub(crate) widened_fields: rustc_hash::FxHashSet<(String, String)>,
    /// Scratch for a parallel-copy cycle, one per `(temp, kind)` actually used.
    pub(crate) temps: FxHashMap<(u32, u8), u16>,
    pub(crate) labels: FxHashMap<BlockId, Label>,
    pub(crate) uses: Vec<u32>,
    pub(crate) order: Vec<BlockId>,
}

impl<'a> Emitter<'a> {
    /// Lay out storage, or refuse a type this slice has no representation for.
    pub fn new(
        program: &'a Program,
        func: &'a Func,
        plan: &crate::widen::Plan,
    ) -> Result<Self, Diagnostic> {
        check_signature(program, func)?;

        let order = block_order(func);

        let crosses = crossing_values(func);
        let mut slots = vec![None; func.values.len()];
        let mut locals = Vec::new();
        let mut next = 0u32;

        // Parameters occupy the first slots, in order, whether or not the body
        // reads them: the JVM places arguments there and a gap would shift
        // every later one.
        // Erased values a bare `java/lang/Object` can carry; see `unbox`.
        // Computed before slots so the decision and the slot type cannot
        // disagree -- there is one answer and both read it.
        let unboxed = crate::unbox::unboxable(func);
        let widened = plan.values_in(func);
        let narrowed = crate::narrow::narrowable(func);
        let widened_fields = plan.fields().clone();
        let mut param_slot = Vec::with_capacity(func.params.len());
        for param in &func.params {
            let Some(vtype) = types::vtype(types::Shape::of(program), &param.ty) else {
                return Err(refuse(func, "a parameter with no verification type"));
            };
            param_slot.push(u16::try_from(next).unwrap_or(u16::MAX));
            next += u32::from(vtype.slots());
            locals.push(vtype);
        }
        for (at, op) in func.values.iter().enumerate() {
            if let OpKind::Param(index) = op.kind
                && let Some(&slot) = param_slot.get(index as usize)
            {
                slots[at] = Some(slot);
            }
        }

        // Everything a reachable block defines or receives. Values the DCE left
        // behind get no slot: they cost 65,535-slot headroom for code that
        // cannot run.
        let mut wanted: Vec<ValueId> = Vec::new();
        for &block in &order {
            let block = &func.blocks[block.0 as usize];
            wanted.extend(block.params.iter().copied());
            wanted.extend(block.ops.iter().copied());
        }
        for value in wanted {
            let at = value.0 as usize;
            if slots.get(at).copied().flatten().is_some() {
                continue;
            }
            let ty = &func.values[at].ty;
            if matches!(ty, HirType::Void) {
                continue;
            }
            // A constant is pushed where it is read, so it needs no storage --
            // which also buys back slot headroom against the 65,535 limit.
            if rematerialised(func, value) {
                continue;
            }
            let held = crate::unbox::held_as(&unboxed, value)
                .or_else(|| widened.contains(&value).then_some(nts_jvm_emitter::VType::Double))
                .or_else(|| narrowed.contains(&value).then_some(nts_jvm_emitter::VType::Integer));
            let Some(vtype) = held.or_else(|| types::vtype(types::Shape::of(program), ty)) else {
                return Err(refuse(
                    func,
                    &format!("a value of unrepresentable type: {}", types::describe(ty)),
                ));
            };
            let Ok(slot) = u16::try_from(next) else {
                return Err(refuse(func, "more local slots than the 65,535 a method allows"));
            };
            slots[at] = Some(slot);
            next += u32::from(vtype.slots());
            locals.push(if crosses.contains(&value) || vtype.slots() == 2 {
                vtype
            } else {
                VType::Top
            });
        }

        // Whose answer this is matters. `hir::operands_of` says out loud that
        // it is exposed because "two implementations of what does this
        // operation read would eventually disagree about a newly added
        // operation -- in whichever direction was not tested", and this file
        // had the second implementation. It listed `Binary`, `Unary`,
        // `Convert`, `Call`, `GlobalSet` and `Return`, and so counted zero
        // operands for every array, field, string and erasure op -- every
        // category added after it was written, exactly as predicted.
        //
        // Undercounting only ever *lowers* a use count, and the one reader
        // wants a count of exactly one, so the bug is a comparison fused into a
        // branch while something else still needed its value. That is a wrong
        // answer rather than a refusal, which is the kind worth deleting the
        // duplicate for rather than extending it.
        let mut uses = vec![0u32; func.values.len()];
        for &block in &order {
            let block = &func.blocks[block.0 as usize];
            let mut read: Vec<ValueId> = block
                .ops
                .iter()
                .flat_map(|&value| nts_core::hir::operands_of(&func.values[value.0 as usize].kind))
                .collect();
            read.extend(nts_core::hir::operands_of_terminator(&block.terminator));
            for operand in read {
                if let Some(count) = uses.get_mut(operand.0 as usize) {
                    *count += 1;
                }
            }
        }

        Ok(Self {
            program,
            shape: types::Shape::of(program),
            func,
            slots,
            locals,
            max_locals: u16::try_from(next).unwrap_or(u16::MAX),
            scratch: None,
            unboxed,
            widened,
            narrowed,
            widened_fields,
            temps: FxHashMap::default(),
            labels: FxHashMap::default(),
            uses,
            order,
        })
    }

    /// Allocate the extra slots the emission itself needs, then write the body.
    pub fn emit(mut self, pool: &mut Pool) -> Result<Body, Diagnostic> {
        let materializes = self.materializes();
        // Two frames' worth of question, answered before emitting rather than
        // after, because the prologue has to come first in the byte stream.
        let framed = self.order.len() > 1 || materializes;
        self.reserve_scratch(materializes)?;
        let locals = self.locals.clone();
        let max_locals = self.max_locals;
        let mut code = Code::new(locals, max_locals);

        // Every non-parameter slot gets a default, which is what lets a frame
        // name a type for all of them (see `nts_jvm_emitter::frames`) -- and is
        // pure waste in a method that has no frames at all. A straight-line
        // function is most of an arithmetic module, and `javap` showed four
        // bytes of prologue in every one of `examples/arith` before this test
        // existed.
        if framed {
            let first_free: u16 = self
                .func
                .params
                .iter()
                .filter_map(|param| types::vtype(self.shape, &param.ty))
                .map(|vtype| vtype.slots())
                .sum();
            let origin = self.func.origin.clone();
            code.initialize_locals(&origin, first_free);
        }

        for &block in &self.order {
            let label = code.label();
            self.labels.insert(block, label);
        }
        for at in 0..self.order.len() {
            let block = self.order[at];
            let label = self.labels[&block];
            code.bind(label);
            self.block(&mut code, pool, block, self.order.get(at + 1).copied())?;
        }
        code.finish(pool)
            .map_err(|error| refuse(self.func, &format!("{error}")))
    }

    /// Whether anything in this function has to turn a comparison into a 0 or
    /// a 1, which is the only thing that needs a scratch slot and the only
    /// thing that puts a label inside a block.
    fn materializes(&self) -> bool {
        self.order.iter().any(|&block| {
            let block = &self.func.blocks[block.0 as usize];
            let fused = self.fusable(&block.ops, &block.terminator);
            block.ops.iter().any(|&value| {
                if Some(value) == fused {
                    return false;
                }
                match &self.func.values[value.0 as usize].kind {
                    OpKind::Binary { op, .. } => comparison(*op).is_some(),
                    OpKind::Unary { op: UnOp::Truthy, operand } => {
                        !matches!(self.ty(*operand), HirType::Bool)
                    }
                    _ => false,
                }
            })
        })
    }

    /// The scratch slots: one `int` for a materialized comparison, and one per
    /// `(temp, kind)` a parallel copy actually breaks a cycle with.
    fn reserve_scratch(&mut self, materializes: bool) -> Result<(), Diagnostic> {
        let mut needed: Vec<(u32, u8)> = Vec::new();
        for &block in &self.order {
            for (target, args) in destruct::outgoing(&self.func.blocks[block.0 as usize].terminator) {
                let params = &self.func.blocks[target.0 as usize].params;
                for copy in edge_copies(params, &args) {
                    if let Copy::Save { temp, from } = copy {
                        let ty = &self.func.values[from.0 as usize].ty;
                        let Some(kind) = types::kind(ty) else {
                            return Err(refuse(self.func, "a block argument with no kind"));
                        };
                        let key = (temp, kind as u8);
                        if !needed.contains(&key) {
                            needed.push(key);
                        }
                    }
                }
            }
        }
        if materializes {
            self.scratch = Some(self.max_locals);
            self.locals.push(VType::Integer);
            self.max_locals = self.max_locals.saturating_add(1);
        }
        for (temp, kind) in needed {
            let vtype = if kind == Kind::Long as u8 {
                VType::Long
            } else if kind == Kind::Float as u8 {
                VType::Float
            } else if kind == Kind::Double as u8 {
                VType::Double
            } else {
                VType::Integer
            };
            self.temps.insert((temp, kind), self.max_locals);
            self.max_locals = self.max_locals.saturating_add(vtype.slots());
            self.locals.push(vtype);
        }
        Ok(())
    }

    pub(crate) fn slot(&self, value: ValueId) -> Option<u16> {
        self.slots.get(value.0 as usize).copied().flatten()
    }

    pub(crate) fn ty(&self, value: ValueId) -> &HirType {
        &self.func.values[value.0 as usize].ty
    }

    pub(crate) fn kind_of(&self, value: ValueId) -> Result<Kind, Diagnostic> {
        // One place, so a widened value cannot be loaded as a double and stored
        // as an int. Everything that moves or operates on a value asks here.
        if self.widened.contains(&value) {
            return Ok(Kind::Double);
        }
        if self.narrowed.contains(&value) {
            return Ok(Kind::Int);
        }
        types::kind(self.ty(value))
            .ok_or_else(|| refuse(self.func, &format!("a value of type {:?}", self.ty(value))))
    }

    pub(crate) fn load(
        &self,
        code: &mut Code,
        pool: &mut Pool,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        let origin = self.func.values[value.0 as usize].origin.clone();
        if rematerialised(self.func, value) {
            let op = &self.func.values[value.0 as usize];
            // A narrowed `i64` literal is an int literal here, for the same
            // reason the widened case below is a double one: the push and the
            // slot have to agree, and `constant` reads the declared type.
            if self.narrowed.contains(&value)
                && let OpKind::ConstInt(number) = op.kind
                && let Ok(small) = i32::try_from(number)
            {
                code.const_int(&origin, pool, small);
                return Ok(());
            }
            // A widened `i32` literal is a double literal here.
            if self.widened.contains(&value)
                && let OpKind::ConstInt(number) = op.kind
            {
                #[allow(
                    clippy::cast_precision_loss,
                    reason = "a widened value is an i32 by `widen`, and every i32 is exact in an f64"
                )]
                code.const_double(&origin, pool, number as f64);
                return Ok(());
            }
            self.constant(code, pool, &op.kind, &op.ty, &origin)?;
            return Ok(());
        }
        let kind = self.kind_of(value)?;
        let Some(slot) = self.slot(value) else {
            return Err(refuse(self.func, "a value read before it was given storage"));
        };
        code.load(&origin, kind, slot);
        Ok(())
    }
}


/// The comparison a `BinOp` is, where it is one.
pub(crate) const fn comparison(op: BinOp) -> Option<Compare> {
    Some(match op {
        BinOp::Lt => Compare::Lt,
        BinOp::Le => Compare::Le,
        BinOp::Gt => Compare::Gt,
        BinOp::Ge => Compare::Ge,
        BinOp::Eq => Compare::Eq,
        BinOp::Ne => Compare::Ne,
        _ => return None,
    })
}

/// The static method a free function becomes.
#[must_use]
pub fn method_name(raw: &str) -> String {
    jvm_member_name(raw)
}

/// The descriptor of a function, from its own signature.
#[must_use]
pub fn signature(program: &Program, func: &Func) -> Option<String> {
    let mut params = Vec::with_capacity(func.params.len());
    for param in &func.params {
        params.push(types::descriptor(types::Shape::of(program), &param.ty)?);
    }
    let borrowed: Vec<&str> = params.iter().map(String::as_str).collect();
    Some(nts_jvm_emitter::descriptor::method(
        &borrowed,
        &types::descriptor(types::Shape::of(program), &func.return_type)?,
    ))
}
