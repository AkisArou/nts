//! Typed local assignment, edge copies and lexical branch binding.

use crate::{
    EmitError, FunctionRoute, InstructionOrigin, cfg,
    helpers::Helper,
    module::Symbols,
    numeric, refuse,
    types::{Physical, Slot},
};
use nts_codegen_common::{Copy, edge_copies};
use nts_core::hir::{BlockId, Callee, Func, OpKind, Terminator, ValueId};
use nts_diagnostics::Diagnostic;
use std::collections::BTreeMap;
use wasm_encoder::{BlockType, Function, Instruction as I};

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::test_common::{block, function, value};

    #[test]
    fn a_corrupt_scope_plan_is_a_named_internal_error() {
        let mut f = function("brokenScope", &[], nts_core::hir::HirType::Void);
        let cond = value(
            &mut f,
            OpKind::ConstBool(true),
            nts_core::hir::HirType::Bool,
        );
        f.blocks = vec![
            block(
                &[],
                &[cond],
                Terminator::Branch {
                    cond,
                    then_target: BlockId(0),
                    then_args: vec![],
                    else_target: BlockId(1),
                    else_args: vec![],
                },
            ),
            block(&[], &[], Terminator::Return(None)),
        ];
        let plan = cfg::plan(&f).unwrap();
        let p = crate::test_common::program(vec![f.clone()]);
        let slots = crate::gc::Plan::build(&p).unwrap();
        let symbols = Symbols {
            functions: rustc_hash::FxHashMap::default(),
            helpers: BTreeMap::new(),
            types: &slots,
            strings: BTreeMap::new(),
            literals: rustc_hash::FxHashMap::default(),
            global_base: 0,
        };
        let mut body = Body::new(&f, 0, &symbols, &plan).unwrap();
        let mut structure = plan.structure.unwrap();
        // Actual fault injection: removing the enclosing loop's label must
        // fail, never become a language decline or an irreducible fallback.
        structure.loop_headers[0] = false;
        let error = body.tree(BlockId(0), &structure).unwrap_err();
        assert!(
            matches!(&error, EmitError::Structuring { function, .. } if function == "brokenScope")
        );
        assert!(error.to_string().contains("out-of-scope"));
        assert!(!error.to_string().contains("NTS5001"));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Label {
    Target(BlockId),
    LoopHead(BlockId),
    Dispatch,
    Other,
}

#[derive(Debug)]
pub(crate) struct Body<'a> {
    pub(crate) func: &'a Func,
    pub(crate) code: Function,
    pub(crate) symbols: &'a Symbols<'a>,
    values: Vec<Option<u32>>,
    scratch: BTreeMap<(u32, Physical), u32>,
    pc: Option<u32>,
    cases: BTreeMap<BlockId, u32>,
    labels: Vec<Label>,
    origins: Vec<InstructionOrigin>,
    index: u32,
    edges: usize,
    visited: Vec<bool>,
}

pub(crate) fn emit(
    func: &Func,
    index: u32,
    symbols: &Symbols<'_>,
) -> Result<(Function, FunctionRoute, Vec<InstructionOrigin>), EmitError> {
    let plan = cfg::plan(func).map_err(|reason| EmitError::Structuring {
        function: func.name.clone(),
        reason,
    })?;
    let mut body =
        Body::new(func, index, symbols, &plan).map_err(|d| EmitError::Declined(vec![d]))?;
    if let Some(structure) = &plan.structure {
        body.tree(BlockId(0), structure)?;
    } else {
        body.dispatcher(&plan.order)?;
    }
    let expected = plan
        .order
        .iter()
        .map(|id| func.blocks[id.0 as usize].terminator.successors().len())
        .sum::<usize>();
    if body.edges != expected
        || body.visited.iter().filter(|seen| **seen).count() != plan.order.len()
    {
        return Err(body.structuring("structurer block/edge-coverage mismatch"));
    }
    body.ins(&I::Unreachable);
    body.ins(&I::End);
    let route = FunctionRoute {
        name: func.name.clone(),
        route: plan.route(),
        blocks: plan.order.len(),
        edges: body.edges,
    };
    Ok((body.code, route, body.origins))
}

impl<'a> Body<'a> {
    fn new(
        func: &'a Func,
        index: u32,
        symbols: &'a Symbols<'a>,
        plan: &cfg::Plan,
    ) -> Result<Self, Diagnostic> {
        let mut locals = Vec::new();
        let mut next = crate::module::index(func.params.len());
        let mut values = vec![None; func.values.len()];
        let mut live = std::collections::BTreeSet::new();
        for block in &plan.order {
            let b = &func.blocks[block.0 as usize];
            live.extend(b.params.iter().chain(&b.ops).copied());
        }
        for value in live {
            let op = func.value(value);
            let slot = symbols
                .types
                .slot(&op.ty)
                .map_err(|why| refuse(func, &op.origin, why))?;
            if let OpKind::Param(at) = op.kind {
                values[value.0 as usize] = Some(at);
            } else if let Some(slot) = slot {
                values[value.0 as usize] = Some(next);
                next += 1;
                locals.push(slot.wasm());
            }
        }
        let mut scratch = BTreeMap::new();
        for block in &plan.order {
            for (to, args) in
                nts_codegen_common::destruct::outgoing(&func.blocks[block.0 as usize].terminator)
            {
                for copy in edge_copies(&func.blocks[to.0 as usize].params, &args) {
                    if let Copy::Save { temp, from } = copy {
                        let slot = symbols
                            .types
                            .value_slot(&func.value(from).ty)
                            .map_err(|why| refuse(func, &func.value(from).origin, why))?;
                        scratch.entry((temp, slot)).or_insert_with(|| {
                            let id = next;
                            next += 1;
                            locals.push(slot.wasm());
                            id
                        });
                    }
                }
            }
        }
        let pc = if plan.structure.is_none() {
            let id = next;
            locals.push(Slot::I32.wasm());
            Some(id)
        } else {
            None
        };
        let cases = plan
            .order
            .iter()
            .enumerate()
            .map(|(i, id)| (*id, crate::module::index(i)))
            .collect();
        Ok(Self {
            func,
            code: Function::new_with_locals_types(locals),
            symbols,
            values,
            scratch,
            pc,
            cases,
            labels: Vec::new(),
            origins: Vec::new(),
            index,
            edges: 0,
            visited: vec![false; func.blocks.len()],
        })
    }

    pub(crate) fn ins(&mut self, i: &I<'_>) {
        self.code.instruction(i);
    }
    pub(crate) fn local(&self, value: ValueId) -> Result<u32, String> {
        self.values[value.0 as usize].ok_or_else(|| format!("%{} has no value local", value.0))
    }
    pub(crate) fn load(&mut self, value: ValueId) -> Result<(), String> {
        let local = self.local(value)?;
        self.ins(&I::LocalGet(local));
        Ok(())
    }
    pub(crate) fn ty(&self, value: ValueId) -> &nts_core::hir::HirType {
        &self.func.value(value).ty
    }
    pub(crate) fn helper(&mut self, helper: Helper) -> Result<(), String> {
        let index = self
            .symbols
            .helpers
            .get(&helper)
            .ok_or_else(|| format!("unplanned scalar helper {helper:?}"))?;
        self.ins(&I::Call(*index));
        Ok(())
    }
    fn depth(&self, label: Label) -> Result<u32, String> {
        self.labels
            .iter()
            .rposition(|it| *it == label)
            .map(|at| crate::module::index(self.labels.len() - at - 1))
            .ok_or_else(|| format!("edge to out-of-scope {label:?}"))
    }
    fn open(&mut self, loop_: bool, label: Label) {
        self.ins(&if loop_ {
            I::Loop(BlockType::Empty)
        } else {
            I::Block(BlockType::Empty)
        });
        self.labels.push(label);
    }
    fn close(&mut self) {
        self.ins(&I::End);
        self.labels.pop();
    }
    fn structuring(&self, reason: impl Into<String>) -> EmitError {
        EmitError::Structuring {
            function: self.func.name.clone(),
            reason: reason.into(),
        }
    }
    // Ramsey's doTree/nodeWithin: merge children are wrapped in reverse RPO
    // order, then translated in forward order. Nonmerge children are inlined
    // by branch(), which is called from the original terminator's position.
    fn tree(&mut self, id: BlockId, structure: &cfg::Structure) -> Result<(), EmitError> {
        if structure.loop_headers[id.0 as usize] {
            self.open(true, Label::LoopHead(id));
        }
        let merges: Vec<_> = structure.children[id.0 as usize]
            .iter()
            .copied()
            .filter(|child| structure.merges[child.0 as usize])
            .collect();
        for child in merges.iter().rev() {
            self.open(false, Label::Target(*child));
        }
        self.actions(id)?;
        self.structured_terminator(id, structure)?;
        for child in merges {
            self.close();
            self.tree(child, structure)?;
        }
        if structure.loop_headers[id.0 as usize] {
            self.close();
        }
        Ok(())
    }
    fn branch(
        &mut self,
        from: BlockId,
        to: BlockId,
        args: &[ValueId],
        structure: &cfg::Structure,
    ) -> Result<(), EmitError> {
        self.copies(to, args).map_err(|why| self.structuring(why))?;
        self.edges += 1;
        let label = if structure.rank[to.0 as usize] <= structure.rank[from.0 as usize] {
            Label::LoopHead(to)
        } else if structure.merges[to.0 as usize] {
            Label::Target(to)
        } else {
            if structure.parent[to.0 as usize] != Some(from) {
                return Err(self.structuring(format!(
                    "inline b{} is not a dominator child of b{}",
                    to.0, from.0
                )));
            }
            return self.tree(to, structure);
        };
        let depth = self.depth(label).map_err(|why| self.structuring(why))?;
        self.ins(&I::Br(depth));
        Ok(())
    }
    fn structured_terminator(
        &mut self,
        id: BlockId,
        structure: &cfg::Structure,
    ) -> Result<(), EmitError> {
        match self.func.blocks[id.0 as usize].terminator.clone() {
            Terminator::Jump { target, args } => self.branch(id, target, &args, structure),
            Terminator::Branch {
                cond,
                then_target,
                then_args,
                else_target,
                else_args,
            } => {
                self.load(cond).map_err(|why| self.structuring(why))?;
                self.ins(&I::If(BlockType::Empty));
                self.labels.push(Label::Other);
                self.branch(id, then_target, &then_args, structure)?;
                self.ins(&I::Else);
                self.branch(id, else_target, &else_args, structure)?;
                self.close();
                Ok(())
            }
            Terminator::Return(value) => {
                if let Some(v) = value {
                    self.load(v).map_err(|why| self.structuring(why))?;
                }
                self.ins(&I::Return);
                Ok(())
            }
            Terminator::Unreachable => {
                self.ins(&I::Unreachable);
                Ok(())
            }
            Terminator::FellThrough => Err(self.structuring("a reachable FellThrough terminator")),
        }
    }
    fn dispatcher(&mut self, order: &[BlockId]) -> Result<(), EmitError> {
        self.open(false, Label::Other);
        self.open(true, Label::Dispatch);
        for id in order.iter().rev() {
            self.open(false, Label::Target(*id));
        }
        self.ins(&I::LocalGet(self.pc.expect("dispatcher has its PC")));
        let targets = (0..crate::module::index(order.len())).collect::<Vec<_>>();
        self.ins(&I::BrTable(
            targets.into(),
            crate::module::index(order.len()) + 1,
        ));
        for id in order {
            self.close();
            self.block(*id)?;
        }
        self.close();
        self.close();
        self.ins(&I::Unreachable);
        Ok(())
    }
    fn actions(&mut self, block: BlockId) -> Result<(), EmitError> {
        if std::mem::replace(&mut self.visited[block.0 as usize], true) {
            return Err(self.structuring(format!("b{} was emitted twice", block.0)));
        }
        for id in &self.func.blocks[block.0 as usize].ops {
            let op = self.func.value(*id);
            self.origins.push(InstructionOrigin {
                function: self.index,
                offset: self.code.byte_len(),
                origin: op.origin.clone(),
            });
            self.op(*id)
                .map_err(|why| EmitError::Declined(vec![refuse(self.func, &op.origin, why)]))?;
        }
        Ok(())
    }
    fn block(&mut self, block: BlockId) -> Result<(), EmitError> {
        self.actions(block)?;
        self.terminator(&self.func.blocks[block.0 as usize].terminator)
            .map_err(|why| self.structuring(why))
    }
    fn copies(&mut self, target: BlockId, args: &[ValueId]) -> Result<(), String> {
        let mut saved = BTreeMap::new();
        for copy in edge_copies(&self.func.blocks[target.0 as usize].params, args) {
            match copy {
                Copy::Move { to, from } => {
                    self.load(from)?;
                    self.ins(&I::LocalSet(self.local(to)?));
                }
                Copy::Save { temp, from } => {
                    self.load(from)?;
                    let slot = self.symbols.types.value_slot(self.ty(from))?;
                    let local = self
                        .scratch
                        .get(&(temp, slot))
                        .copied()
                        .ok_or_else(|| format!("unplanned edge temporary {temp}: {slot:?}"))?;
                    saved.insert(temp, slot);
                    self.ins(&I::LocalSet(local));
                }
                Copy::Restore { to, temp } => {
                    let slot = saved
                        .get(&temp)
                        .copied()
                        .ok_or_else(|| format!("edge temporary {temp} restored before saving"))?;
                    let local = self
                        .scratch
                        .get(&(temp, slot))
                        .copied()
                        .ok_or_else(|| format!("unplanned edge temporary {temp}: {slot:?}"))?;
                    self.ins(&I::LocalGet(local));
                    self.ins(&I::LocalSet(self.local(to)?));
                }
            }
        }
        Ok(())
    }
    fn edge(&mut self, target: BlockId, args: &[ValueId]) -> Result<(), String> {
        self.copies(target, args)?;
        if let Some(pc) = self.pc {
            self.ins(&I::I32Const(
                i32::try_from(self.cases[&target])
                    .map_err(|_| "more than 2^31 dispatcher cases")?,
            ));
            self.ins(&I::LocalSet(pc));
            self.ins(&I::Br(self.depth(Label::Dispatch)?));
        } else {
            self.ins(&I::Br(self.depth(Label::Target(target))?));
        }
        self.edges += 1;
        Ok(())
    }
    fn terminator(&mut self, terminator: &Terminator) -> Result<(), String> {
        match terminator {
            Terminator::Return(value) => {
                if let Some(v) = value {
                    self.load(*v)?;
                }
                self.ins(&I::Return);
            }
            Terminator::Jump { target, args } => self.edge(*target, args)?,
            Terminator::Branch {
                cond,
                then_target,
                then_args,
                else_target,
                else_args,
            } => {
                self.load(*cond)?;
                self.ins(&I::If(BlockType::Empty));
                self.labels.push(Label::Other);
                self.edge(*then_target, then_args)?;
                self.ins(&I::Else);
                self.edge(*else_target, else_args)?;
                self.close();
            }
            Terminator::Unreachable => self.ins(&I::Unreachable),
            Terminator::FellThrough => return Err("a reachable FellThrough terminator".to_owned()),
        }
        Ok(())
    }
    fn op(&mut self, id: ValueId) -> Result<(), String> {
        let op = self.func.value(id);
        match &op.kind {
            OpKind::Param(_) | OpKind::BlockParam(_) => return Ok(()),
            OpKind::ConstBool(value) => self.ins(&I::I32Const(i32::from(*value))),
            OpKind::ConstInt(value) => numeric::constant_int(self, *value, &op.ty)?,
            OpKind::ConstFloat(value) => numeric::constant_float(self, *value, &op.ty)?,
            OpKind::ConstString(value) => crate::strings::constant(self, value)?,
            OpKind::Length(value) if crate::strings::is_string(self.ty(*value)) => {
                crate::strings::length(self, id, *value)?;
            }
            OpKind::StringUnitAt {
                string,
                index,
                checked,
            } => {
                crate::strings::unit(self, id, *string, *index, *checked)?;
            }
            OpKind::Binary { op, lhs, rhs } => self.binary(id, *op, *lhs, *rhs)?,
            OpKind::Unary { op, operand } => self.unary(id, *op, *operand)?,
            OpKind::Convert(value) => self.convert(id, *value)?,
            OpKind::GlobalGet(global) => {
                self.ins(&I::GlobalGet(self.symbols.global_base + *global));
            }
            OpKind::GlobalSet { global, value } => {
                self.load(*value)?;
                self.ins(&I::GlobalSet(self.symbols.global_base + *global));
                return Ok(());
            }
            OpKind::Call { callee, args, .. } => self.call(id, callee, args)?,
            OpKind::Return(value) => {
                if let Some(value) = value {
                    self.load(*value)?;
                }
                self.ins(&I::Return);
                return Ok(());
            }
            OpKind::ConstUndefined if self.symbols.types.slot(&op.ty)?.is_none() => return Ok(()),
            OpKind::Retain(_) | OpKind::Release(_) => {
                return Err(format!("host-managed provider mismatch: {:?}", op.kind));
            }
            OpKind::NativeLoad { .. }
            | OpKind::NativeStore { .. }
            | OpKind::NativeLocal { .. }
            | OpKind::ObjcClass { .. }
            | OpKind::ObjcSelector { .. }
            | OpKind::NativeSizeOf(_)
            | OpKind::NativeMalloc { .. }
            | OpKind::NativeFree { .. }
            | OpKind::NativeIndexAddress { .. }
            | OpKind::NativeFieldAddress { .. }
            | OpKind::NativeBitLoad { .. }
            | OpKind::NativeBitStore { .. }
            | OpKind::NativeCopy { .. }
            | OpKind::NativeBridge { .. }
            | OpKind::NativeBlock { .. }
            | OpKind::DelegateInvoke { .. } => {
                return Err(format!("native ABI operation {:?}", op.kind));
            }
            OpKind::DispatchSlot(_)
            | OpKind::ConstTemplate { .. }
            | OpKind::Erase { .. }
            | OpKind::TagOf { .. }
            | OpKind::Unerase { .. }
            | OpKind::ArrayNew { .. }
            | OpKind::Length(_)
            | OpKind::ArrayGet { .. }
            | OpKind::ConstNull
            | OpKind::ConstUndefined
            | OpKind::ObjectNew { .. }
            | OpKind::CellReady { .. }
            | OpKind::ClosureStatic
            | OpKind::InstanceOf { .. }
            | OpKind::FieldGet { .. }
            | OpKind::SharedFieldGet { .. }
            | OpKind::OpenFieldGet { .. }
            | OpKind::OpenFieldSet { .. }
            | OpKind::FieldSet { .. }
            | OpKind::Await { .. }
            | OpKind::Yield { .. }
            | OpKind::Suspend { .. }
            | OpKind::PromiseSubscribe { .. }
            | OpKind::ArraySet { .. } => {
                return Err(format!("operation outside M1a: {:?}", op.kind));
            }
        }
        if self.symbols.types.slot(&op.ty)?.is_some() {
            self.ins(&I::LocalSet(self.local(id)?));
        }
        Ok(())
    }
    fn binary(
        &mut self,
        id: ValueId,
        op: nts_core::hir::BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<(), String> {
        if crate::strings::is_string(self.ty(lhs)) || crate::strings::is_string(self.ty(rhs)) {
            crate::strings::binary(self, op, lhs, rhs)
        } else {
            numeric::binary(self, id, op, lhs, rhs)
        }
    }
    fn unary(
        &mut self,
        id: ValueId,
        op: nts_core::hir::UnOp,
        value: ValueId,
    ) -> Result<(), String> {
        if crate::strings::is_string(self.ty(value)) {
            crate::strings::truthy(self, op, value)
        } else {
            numeric::unary(self, id, op, value)
        }
    }
    fn convert(&mut self, id: ValueId, value: ValueId) -> Result<(), String> {
        let from = self.ty(value).clone();
        let to = self.ty(id).clone();
        if crate::strings::is_string(&from) && to == nts_core::hir::HirType::Bool {
            return crate::strings::truthy(self, nts_core::hir::UnOp::Truthy, value);
        }
        self.load(value)?;
        if crate::strings::is_string(&from) && crate::strings::is_string(&to) {
            return Ok(());
        }
        numeric::convert(self, &from, &to)
    }
    fn call(&mut self, result: ValueId, callee: &Callee, args: &[ValueId]) -> Result<(), String> {
        match callee {
            Callee::Direct(name) => {
                let at = self
                    .symbols
                    .functions
                    .get(name.as_str())
                    .ok_or_else(|| format!("unresolved direct callee `{name}`"))?;
                for arg in args {
                    self.load(*arg)?;
                }
                self.ins(&I::Call(*at));
            }
            Callee::External(name) => {
                if let Some(helper) = crate::strings::external(name) {
                    crate::strings::runtime(self, result, helper, args)?;
                } else {
                    return Err(format!(
                        "runtime/external helper `{name}` is outside the implemented Wasm helper surface"
                    ));
                }
            }
            Callee::Native(function) => return Err(format!("native call {function:?}")),
            Callee::Virtual { declared, .. } => {
                return Err(format!(
                    "virtual/interface dispatch `{declared}` is outside M1a"
                ));
            }
            Callee::Closure { slot } => {
                return Err(format!("closure dispatch slot {slot} is outside M1a"));
            }
        }
        Ok(())
    }
}
