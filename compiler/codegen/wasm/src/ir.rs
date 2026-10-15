//! A thin symbolic layer over wasm-encoder's instruction set.
//!
//! An instruction is wasm-encoder's own, except where it names a function, a
//! global or an exception tag: there it holds a `module::Func`, `Global` or
//! `Tag` symbol, which only the module `Builder` creates. Those indices exist
//! only once the module is assembled, so lowering never computes one, and a
//! body can still be rewritten between lowering and encoding.
//!
//! Type, field and `call_ref` indices stay raw by design: the whole-program
//! type plan fixes them before any body is lowered.

use crate::module::{Func, Global, Tag};
use nts_semantic_schema::Origin;
use wasm_encoder::{Instruction as I, ValType};

#[derive(Debug, Clone)]
pub(crate) enum Inst {
    /// An admitted raw instruction (see [`admitted`]). Any other raw
    /// instruction is an assembly error: functions, globals and tags reach
    /// the module only through a symbol.
    Op(I<'static>),
    Call(Func),
    /// `return_call`: a call in tail position, made by [`crate::tail`] once
    /// every other pass is done with the body.
    ReturnCall(Func),
    RefFunc(Func),
    GlobalGet(Global),
    GlobalSet(Global),
    Throw(Tag),
}

/// An instruction sequence plus the source Origin of each lowered operation.
#[derive(Debug, Default, Clone)]
pub(crate) struct Code {
    pub(crate) insts: Vec<Inst>,
    /// `(instruction position, Origin)`: the position of the first instruction
    /// lowered from an HIR operation.
    pub(crate) marks: Vec<(usize, Origin)>,
}

impl Code {
    pub(crate) fn instruction(&mut self, i: &I<'static>) {
        self.op(i.clone());
    }
    pub(crate) fn instructions(&mut self, code: &[I<'static>]) {
        for i in code {
            self.op(i.clone());
        }
    }
    /// Append `i`, reading a local back from the `local.set` just before it
    /// as one `local.tee`: the same value left on the stack, a `local.get`
    /// shorter. Two adjacent instructions run in sequence, so no branch can
    /// arrive between them.
    fn op(&mut self, i: I<'static>) {
        if let I::LocalGet(read) = i
            && let Some(last) = self.insts.last_mut()
            && matches!(last, Inst::Op(I::LocalSet(set)) if *set == read)
        {
            *last = Inst::Op(I::LocalTee(read));
            return;
        }
        self.insts.push(Inst::Op(i));
    }
    /// Forget the locals nothing reads: a `local.tee` of one leaves its value
    /// where it was, so it goes; a `local.set` of one becomes a `drop`. What
    /// is left is the value flowing on the stack from where it is made to
    /// where it is used, with no local between.
    pub(crate) fn settle(&mut self) {
        let mut read = std::collections::BTreeSet::new();
        for inst in &self.insts {
            if let Inst::Op(I::LocalGet(local)) = inst {
                read.insert(*local);
            }
        }
        self.rewrite(|_, inst| match inst {
            Inst::Op(I::LocalTee(local)) if !read.contains(&local) => None,
            Inst::Op(I::LocalSet(local)) if !read.contains(&local) => Some(Inst::Op(I::Drop)),
            other => Some(other),
        });
    }
    /// Each instruction replaced by what `keep` makes of it, by position, or
    /// dropped where it answers `None`; an origin mark moves with the
    /// instruction it named, or to the next one kept.
    pub(crate) fn rewrite(&mut self, mut keep: impl FnMut(usize, Inst) -> Option<Inst>) {
        let mut kept = Vec::with_capacity(self.insts.len());
        let mut moved = Vec::with_capacity(self.insts.len() + 1);
        for (at, inst) in self.insts.drain(..).enumerate() {
            moved.push(kept.len());
            if let Some(inst) = keep(at, inst) {
                kept.push(inst);
            }
        }
        moved.push(kept.len());
        self.insts = kept;
        for (at, _) in &mut self.marks {
            *at = moved[*at];
        }
    }
    pub(crate) fn call(&mut self, f: Func) {
        self.insts.push(Inst::Call(f));
    }
    pub(crate) fn ref_func(&mut self, f: Func) {
        self.insts.push(Inst::RefFunc(f));
    }
    pub(crate) fn global_get(&mut self, g: Global) {
        self.insts.push(Inst::GlobalGet(g));
    }
    pub(crate) fn global_set(&mut self, g: Global) {
        self.insts.push(Inst::GlobalSet(g));
    }
    pub(crate) fn throw(&mut self, tag: Tag) {
        self.insts.push(Inst::Throw(tag));
    }
    pub(crate) fn mark(&mut self, origin: Origin) {
        self.marks.push((self.insts.len(), origin));
    }
}

/// A function body before assembly: its non-parameter locals and its code,
/// whose instruction methods it shares.
#[derive(Debug, Default, Clone)]
pub(crate) struct Function {
    pub(crate) locals: Vec<ValType>,
    pub(crate) code: Code,
}

impl Function {
    pub(crate) fn new(locals: impl IntoIterator<Item = ValType>) -> Self {
        Self {
            locals: locals.into_iter().collect(),
            code: Code::default(),
        }
    }
    /// wasm-encoder's run-length local declarations, `[(count, type)]`.
    pub(crate) fn with_groups(groups: impl IntoIterator<Item = (u32, ValType)>) -> Self {
        Self::new(
            groups
                .into_iter()
                .flat_map(|(count, ty)| std::iter::repeat_n(ty, count as usize)),
        )
    }
}

impl std::ops::Deref for Function {
    type Target = Code;
    fn deref(&self) -> &Code {
        &self.code
    }
}

impl std::ops::DerefMut for Function {
    fn deref_mut(&mut self) -> &mut Code {
        &mut self.code
    }
}

/// Whether a raw instruction may be encoded as written: an allowlist of the
/// instructions this backend emits that name no function, global, tag, table,
/// memory or segment. Anything else, including a variant a newer wasm-encoder
/// adds, is refused at assembly until it is reviewed and either admitted here
/// or given a symbol.
/// The exception-handling instructions admitted beside [`admitted`]: a
/// `try_table` whose catches all catch everything, which names no tag, and
/// `throw_ref`, which rethrows what one caught.
pub(crate) fn admitted_exceptions(i: &I<'_>) -> bool {
    match i {
        I::TryTable(_, catches) => catches.iter().all(|catch| {
            matches!(
                catch,
                wasm_encoder::Catch::All { .. } | wasm_encoder::Catch::AllRef { .. }
            )
        }),
        I::ThrowRef => true,
        _ => false,
    }
}

#[allow(
    clippy::too_many_lines,
    reason = "one reviewed list of admitted instructions"
)]
pub(crate) const fn admitted(i: &I<'_>) -> bool {
    matches!(
        i,
        // Control and locals.
        I::Unreachable
            | I::Nop
            | I::Block(_)
            | I::Loop(_)
            | I::If(_)
            | I::Else
            | I::End
            | I::Br(_)
            | I::BrIf(_)
            | I::BrOnNonNull(_)
            | I::BrOnNull(_)
            | I::BrTable(..)
            | I::Return
            | I::Drop
            | I::Select
            | I::LocalGet(_)
            | I::LocalSet(_)
            | I::LocalTee(_)
            // Constants and scalar numerics.
            | I::I32Const(_)
            | I::I64Const(_)
            | I::F32Const(_)
            | I::F64Const(_)
            | I::I32Eqz
            | I::I32Eq
            | I::I32Ne
            | I::I32LtS
            | I::I32LtU
            | I::I32GtS
            | I::I32GtU
            | I::I32LeS
            | I::I32LeU
            | I::I32GeS
            | I::I32GeU
            | I::I64Eqz
            | I::I64Eq
            | I::I64Ne
            | I::I64LtS
            | I::I64LtU
            | I::I64GtS
            | I::I64GtU
            | I::I64LeS
            | I::I64LeU
            | I::I64GeS
            | I::I64GeU
            | I::F32Eq
            | I::F32Ne
            | I::F32Lt
            | I::F32Gt
            | I::F32Le
            | I::F32Ge
            | I::F64Eq
            | I::F64Ne
            | I::F64Lt
            | I::F64Gt
            | I::F64Le
            | I::F64Ge
            | I::I32Add
            | I::I32Sub
            | I::I32Mul
            | I::I32DivS
            | I::I32DivU
            | I::I32RemS
            | I::I32RemU
            | I::I32And
            | I::I32Or
            | I::I32Xor
            | I::I32Shl
            | I::I32ShrS
            | I::I32ShrU
            | I::I64Add
            | I::I64Sub
            | I::I64Mul
            | I::I64DivS
            | I::I64DivU
            | I::I64RemS
            | I::I64RemU
            | I::I64And
            | I::I64Or
            | I::I64Xor
            | I::I64Shl
            | I::I64ShrU
            | I::I64ShrS
            | I::I64Clz
            // A bigint is one v128 (bigints.rs): its lanes, and the
            // whole-vector operations its bits need.
            | I::V128Const(_)
            | I::V128And
            | I::V128Or
            | I::V128Xor
            | I::V128AnyTrue
            | I::V128Bitselect
            | I::I64x2Splat
            | I::I64x2ExtractLane(_)
            | I::I64x2ReplaceLane(_)
            | I::I64x2Eq
            | I::I64x2AllTrue
            | I::I64x2ShrS
            | I::F32Abs
            | I::F32Neg
            | I::F32Add
            | I::F32Sub
            | I::F32Mul
            | I::F32Div
            | I::F32Min
            | I::F32Max
            | I::F64Abs
            | I::F64Neg
            | I::F64Ceil
            | I::F64Floor
            | I::F64Trunc
            | I::F64Nearest
            | I::F64Sqrt
            | I::F64Add
            | I::F64Sub
            | I::F64Mul
            | I::F64Div
            | I::F64Min
            | I::F64Max
            | I::F64Copysign
            | I::I32WrapI64
            | I::I64ExtendI32S
            | I::I64ExtendI32U
            | I::F32ConvertI32S
            | I::F32ConvertI32U
            | I::F32ConvertI64S
            | I::F32ConvertI64U
            | I::F32DemoteF64
            | I::F64ConvertI32S
            | I::F64ConvertI32U
            | I::F64ConvertI64S
            | I::F64ConvertI64U
            | I::F64PromoteF32
            | I::I64ReinterpretF64
            | I::F64ReinterpretI64
            | I::I32ReinterpretF32
            | I::F32ReinterpretI32
            | I::I32Extend8S
            | I::I32Extend16S
            | I::I32TruncSatF32S
            | I::I32TruncSatF32U
            | I::I32TruncSatF64S
            | I::I32TruncSatF64U
            | I::I64TruncSatF32S
            | I::I64TruncSatF32U
            | I::I64TruncSatF64S
            | I::I64TruncSatF64U
            // References and GC objects; type and field indices come from
            // the whole-program type plan.
            | I::RefNull(_)
            | I::RefIsNull
            | I::RefEq
            | I::RefAsNonNull
            | I::RefI31
            | I::I31GetS
            | I::RefTestNonNull(_)
            | I::RefTestNullable(_)
            | I::RefCastNonNull(_)
            | I::RefCastNullable(_)
            // A branch on a cast: `flow` and `outline` read its label.
            | I::BrOnCast { .. }
            | I::ExternConvertAny
            | I::AnyConvertExtern
            | I::CallRef(_)
            | I::StructNew(_)
            | I::StructGet { .. }
            | I::StructGetS { .. }
            | I::StructGetU { .. }
            | I::StructSet { .. }
            | I::ArrayNew(_)
            | I::ArrayNewDefault(_)
            | I::ArrayNewFixed { .. }
            | I::ArrayGet(_)
            | I::ArrayGetS(_)
            | I::ArrayGetU(_)
            | I::ArraySet(_)
            | I::ArrayLen
            | I::ArrayFill(_)
            | I::ArrayCopy { .. }
    )
}
