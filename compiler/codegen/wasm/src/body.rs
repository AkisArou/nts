//! Typed local assignment, edge copies and lexical branch binding.

use crate::{
    FunctionRoute, InstructionOrigin, cfg,
    helpers::Helper,
    module::Symbols,
    numeric, refuse,
    types::{self, Slot},
};
use nts_codegen_common::{Copy, edge_copies};
use nts_core::hir::{BlockId, Callee, Func, OpKind, Terminator, ValueId};
use nts_diagnostics::Diagnostic;
use std::collections::BTreeMap;
use wasm_encoder::{BlockType, Function, Instruction as I};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Label {
    Target(BlockId),
    Dispatch,
    Other,
}

#[derive(Debug)]
pub(crate) struct Body<'a> {
    pub(crate) func: &'a Func,
    pub(crate) code: Function,
    pub(crate) symbols: &'a Symbols<'a>,
    values: Vec<Option<u32>>,
    scratch: BTreeMap<(u32, Slot), u32>,
    pc: Option<u32>,
    cases: BTreeMap<BlockId, u32>,
    labels: Vec<Label>,
    origins: Vec<InstructionOrigin>,
    index: u32,
    edges: usize,
}

pub(crate) fn emit(
    func: &Func,
    index: u32,
    symbols: &Symbols<'_>,
) -> Result<(Function, FunctionRoute, Vec<InstructionOrigin>), Diagnostic> {
    let plan = cfg::plan(func).map_err(|why| {
        refuse(
            func,
            &func.origin,
            format!("structurer implementation gap: {why}"),
        )
    })?;
    let mut body = Body::new(func, index, symbols, &plan)?;
    if let Some(region) = &plan.region {
        body.region(region)?;
    } else {
        body.dispatcher(&plan.order)?;
    }
    let expected = plan
        .order
        .iter()
        .map(|id| func.blocks[id.0 as usize].terminator.successors().len())
        .sum::<usize>();
    if body.edges != expected {
        return Err(refuse(
            func,
            &func.origin,
            "structurer edge-coverage mismatch",
        ));
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
            let slot = types::slot(&op.ty).map_err(|why| refuse(func, &op.origin, why))?;
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
                        let slot = types::value_slot(&func.value(from).ty)
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
        let pc = if plan.region.is_none() {
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
        })
    }

    pub(crate) fn ins(&mut self, i: &I<'_>) {
        self.code.instruction(i);
    }
    pub(crate) fn local(&self, value: ValueId) -> Result<u32, String> {
        self.values[value.0 as usize].ok_or_else(|| format!("%{} has no scalar local", value.0))
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
            .ok_or_else(|| format!("structurer implementation gap: edge to out-of-scope {label:?}"))
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
    fn region(&mut self, region: &cfg::Region) -> Result<(), Diagnostic> {
        if let Some(header) = region.header {
            self.open(true, Label::Target(header));
        }
        for node in region.nodes.iter().skip(1).rev() {
            self.open(false, Label::Target(node.entry()));
        }
        for (i, node) in region.nodes.iter().enumerate() {
            if i != 0 {
                self.close();
            }
            match node {
                cfg::Node::Block(id) => self.block(*id)?,
                cfg::Node::Loop(region) => self.region(region)?,
            }
        }
        if region.header.is_some() {
            self.close();
        }
        Ok(())
    }
    fn dispatcher(&mut self, order: &[BlockId]) -> Result<(), Diagnostic> {
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
    fn block(&mut self, block: BlockId) -> Result<(), Diagnostic> {
        for id in &self.func.blocks[block.0 as usize].ops {
            let op = self.func.value(*id);
            self.origins.push(InstructionOrigin {
                function: self.index,
                offset: self.code.byte_len(),
                origin: op.origin.clone(),
            });
            self.op(*id)
                .map_err(|why| refuse(self.func, &op.origin, why))?;
        }
        self.terminator(&self.func.blocks[block.0 as usize].terminator)
            .map_err(|why| refuse(self.func, &self.func.origin, why))
    }
    fn edge(&mut self, target: BlockId, args: &[ValueId]) -> Result<(), String> {
        for copy in edge_copies(&self.func.blocks[target.0 as usize].params, args) {
            match copy {
                Copy::Move { to, from } => {
                    self.load(from)?;
                    self.ins(&I::LocalSet(self.local(to)?));
                }
                Copy::Save { temp, from } => {
                    self.load(from)?;
                    self.ins(&I::LocalSet(
                        self.scratch[&(temp, types::value_slot(self.ty(from))?)],
                    ));
                }
                Copy::Restore { to, temp } => {
                    self.ins(&I::LocalGet(
                        self.scratch[&(temp, types::value_slot(self.ty(to))?)],
                    ));
                    self.ins(&I::LocalSet(self.local(to)?));
                }
            }
        }
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
            OpKind::Binary { op, lhs, rhs } => numeric::binary(self, id, *op, *lhs, *rhs)?,
            OpKind::Unary { op, operand } => numeric::unary(self, id, *op, *operand)?,
            OpKind::Convert(value) => {
                self.load(*value)?;
                let from = self.ty(*value).clone();
                numeric::convert(self, &from, &op.ty)?;
            }
            OpKind::GlobalGet(global) => self.ins(&I::GlobalGet(*global)),
            OpKind::GlobalSet { global, value } => {
                self.load(*value)?;
                self.ins(&I::GlobalSet(*global));
                return Ok(());
            }
            OpKind::Call { callee, args, .. } => self.call(callee, args)?,
            OpKind::Return(value) => {
                if let Some(value) = value {
                    self.load(*value)?;
                }
                self.ins(&I::Return);
                return Ok(());
            }
            OpKind::ConstUndefined if types::slot(&op.ty)?.is_none() => return Ok(()),
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
            | OpKind::ConstString(_)
            | OpKind::ConstTemplate { .. }
            | OpKind::Erase { .. }
            | OpKind::TagOf { .. }
            | OpKind::Unerase { .. }
            | OpKind::ArrayNew { .. }
            | OpKind::Length(_)
            | OpKind::ArrayGet { .. }
            | OpKind::StringUnitAt { .. }
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
        if types::slot(&op.ty)?.is_some() {
            self.ins(&I::LocalSet(self.local(id)?));
        }
        Ok(())
    }
    fn call(&mut self, callee: &Callee, args: &[ValueId]) -> Result<(), String> {
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
                return Err(format!("runtime/external helper `{name}` is outside M1a"));
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
