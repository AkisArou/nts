//! A thin symbolic layer over wasm-encoder's instruction set.
//!
//! An instruction is wasm-encoder's own, except where it names a function or
//! a global: there it holds a `module::Func` or `module::Global` symbol, which
//! only the module `Builder` can create. Indices exist only once the module is
//! assembled, so lowering never computes one, and a body can still be
//! rewritten between lowering and encoding.

use crate::module::{Func, Global};
use nts_semantic_schema::Origin;
use wasm_encoder::{Instruction as I, ValType};

#[derive(Debug, Clone)]
pub(crate) enum Inst {
    /// Any instruction without a function or global operand. A raw `call`,
    /// `ref.func`, `global.get` or `global.set` here is an assembly error:
    /// those reach the module only through a symbol.
    Op(I<'static>),
    Call(Func),
    RefFunc(Func),
    GlobalGet(Global),
    GlobalSet(Global),
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
        self.insts.push(Inst::Op(i.clone()));
    }
    pub(crate) fn instructions(&mut self, code: &[I<'static>]) {
        self.insts.extend(code.iter().cloned().map(Inst::Op));
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
    pub(crate) fn mark(&mut self, origin: Origin) {
        self.marks.push((self.insts.len(), origin));
    }
}

/// A function body before assembly: its non-parameter locals and its code.
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
    pub(crate) fn instruction(&mut self, i: &I<'static>) {
        self.code.instruction(i);
    }
    pub(crate) fn instructions(&mut self, code: &[I<'static>]) {
        self.code.instructions(code);
    }
    pub(crate) fn call(&mut self, f: Func) {
        self.code.call(f);
    }
    pub(crate) fn ref_func(&mut self, f: Func) {
        self.code.ref_func(f);
    }
    pub(crate) fn global_get(&mut self, g: Global) {
        self.code.global_get(g);
    }
    pub(crate) fn global_set(&mut self, g: Global) {
        self.code.global_set(g);
    }
    pub(crate) fn mark(&mut self, origin: Origin) {
        self.code.mark(origin);
    }
}

/// Whether a raw instruction names a function, global, table or element
/// segment by index. Such an instruction bypasses the symbols, so the
/// assembler refuses it instead of encoding an index nothing requested.
pub(crate) const fn names_an_index(i: &I<'_>) -> bool {
    matches!(
        i,
        I::Call(_)
            | I::ReturnCall(_)
            | I::RefFunc(_)
            | I::GlobalGet(_)
            | I::GlobalSet(_)
            | I::CallIndirect { .. }
            | I::ReturnCallIndirect { .. }
            | I::TableGet(_)
            | I::TableSet(_)
            | I::ArrayNewElem { .. }
            | I::ArrayInitElem { .. }
    )
}
