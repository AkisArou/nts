//! Typed local assignment, edge copies and lexical branch binding.

use crate::{
    EmitError, FunctionRoute, cfg,
    error::Failure,
    gc,
    helpers::Helper,
    ir,
    module::Builder,
    numeric,
    types::{Physical, Slot},
};
use nts_codegen_common::{Copy, edge_copies};
use nts_core::hir::{BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId};
use std::collections::BTreeMap;
use wasm_encoder::{BlockType, Instruction as I};

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
        let slots = gc::Plan::build(&p).unwrap();
        let results = BTreeMap::new();
        let mut m = Builder::new(&p, &slots, &results, false);
        let mut body = Body::new(&f, &mut m, &plan).unwrap();
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

/// Lowering state for one function. Instruction methods reach its code
/// through `Deref`.
#[derive(Debug)]
pub(crate) struct Body<'b, 'p> {
    pub(crate) func: &'b Func,
    pub(crate) code: ir::Function,
    pub(crate) m: &'b mut Builder<'p>,
    values: Vec<Option<u32>>,
    /// The collection gets whose value is their entry, by the collection
    /// read (`collections::typed_gets`).
    typed_gets: BTreeMap<ValueId, ValueId>,
    /// The entry reads held as the type their collection stores, by that
    /// type (`collections::typed_reads`).
    typed_reads: BTreeMap<ValueId, HirType>,
    /// The values that cannot be null (`never_null`).
    never_null: std::collections::BTreeSet<ValueId>,
    /// The literals a loop reads, each in its own local from entry
    /// (`literals::hoisted`).
    hoisted: std::collections::BTreeSet<ValueId>,
    scratch: BTreeMap<(u32, Physical), u32>,
    pc: Option<u32>,
    cases: BTreeMap<BlockId, u32>,
    labels: Vec<Label>,
    edges: usize,
    visited: Vec<bool>,
}

impl std::ops::Deref for Body<'_, '_> {
    type Target = ir::Function;
    fn deref(&self) -> &ir::Function {
        &self.code
    }
}

impl std::ops::DerefMut for Body<'_, '_> {
    fn deref_mut(&mut self) -> &mut ir::Function {
        &mut self.code
    }
}

/// Lower one verified function to an IR body and its CFG route.
pub(crate) fn lower(
    func: &Func,
    m: &mut Builder<'_>,
) -> Result<(ir::Function, FunctionRoute), EmitError> {
    crate::array_init::check(func, &m.types.array_init)?;
    let plan = cfg::plan(func).map_err(|reason| EmitError::Structuring {
        function: func.name.clone(),
        reason,
    })?;
    let mut body = Body::new(func, m, &plan)?;
    body.hoist_literals()?;
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
    body.instruction(&I::Unreachable);
    body.instruction(&I::End);
    let locals = func.params.len() + body.code.locals.len();
    crate::checks::drop_repeated(&mut body.code, locals);
    body.code.settle();
    // Every local a structured body reads is written on every path to the
    // read: its locals are SSA values and edge moves. The inliner leaves such
    // a local as the last inlined copy left it, so a debug build -- the one
    // the tests run -- checks the premise here. A dispatched body reaches a
    // block only after the edge that writes its locals, which the `pc`
    // decides and a structural dataflow cannot see, so the inliner resets
    // those instead.
    if cfg!(debug_assertions) && plan.structure.is_some() {
        let unwritten = crate::inline::unwritten_reads(&body.code, func.params.len());
        debug_assert!(
            unwritten.is_empty(),
            "`{}` reads locals {unwritten:?} that a path leaves unwritten",
            func.name
        );
    }
    let route = FunctionRoute {
        name: func.name.clone(),
        route: plan.route(),
        blocks: plan.order.len(),
        edges: body.edges,
    };
    Ok((body.code, route))
}

impl<'b, 'p> Body<'b, 'p> {
    fn new(func: &'b Func, m: &'b mut Builder<'p>, plan: &cfg::Plan) -> Result<Self, EmitError> {
        let types = m.types;
        let mut locals = Vec::new();
        let mut next = crate::module::index(func.params.len());
        let mut values = vec![None; func.values.len()];
        // Prepared wrappers may omit Param pseudo-ops from their block lists.
        // Parameters already exist at entry; they never need local allocation.
        for (id, op) in func.values.iter().enumerate() {
            if let OpKind::Param(at) = op.kind {
                values[id] = Some(at);
            }
        }
        let typed_gets = crate::collections::typed_gets(func, types);
        let typed_reads = crate::collections::typed_reads(func, types);
        let never_null = crate::never_null::values(func);
        let hoisted = crate::literals::hoisted(func, plan);
        let mut live = std::collections::BTreeSet::new();
        for block in &plan.order {
            let b = &func.blocks[block.0 as usize];
            live.extend(b.params.iter().chain(&b.ops).copied());
        }
        for value in live {
            let op = func.value(value);
            let slot = if typed_gets.contains_key(&value) {
                Some(Physical::Scalar(Slot::I32))
            } else {
                types
                    .slot(typed_reads.get(&value).unwrap_or(&op.ty))
                    .map_err(|failure| failure.at(&func.name, &op.origin))?
            };
            if !matches!(op.kind, OpKind::Param(_))
                && let Some(slot) = slot
            {
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
                        let slot = types
                            .value_slot(&func.value(from).ty)
                            .map_err(|failure| failure.at(&func.name, &func.value(from).origin))?;
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
            code: ir::Function::new(locals),
            m,
            values,
            typed_gets,
            typed_reads,
            never_null,
            hoisted,
            scratch,
            pc,
            cases,
            labels: Vec::new(),
            edges: 0,
            visited: vec![false; func.blocks.len()],
        })
    }

    /// An instruction. Inherent rather than reached through `Deref`, so an
    /// argument computed from the body, such as `self.local(v)?`, borrows it
    /// before the call does (two-phase borrows).
    pub(crate) fn instruction(&mut self, i: &I<'static>) {
        self.code.instruction(i);
    }
    /// Move the value on top of the stack into a slot of type `wanted`.
    pub(crate) fn transfer(&mut self, found: &HirType, wanted: &HirType) -> Result<(), Failure> {
        let types = self.types();
        crate::transfer::transfer(&mut self.code, types, found, wanted)
    }
    /// The whole-program type plan, which outlives this body.
    pub(crate) fn types(&self) -> &'p gc::Plan {
        self.m.types
    }
    /// The collection a get reads, where its value is the entry it found.
    pub(crate) fn typed_get(&self, value: ValueId) -> Option<ValueId> {
        self.typed_gets.get(&value).copied()
    }
    /// Whether `value` cannot be null.
    pub(crate) fn never_null(&self, value: ValueId) -> bool {
        self.never_null.contains(&value)
    }
    /// The type an entry read is held as, where it is not erased.
    pub(crate) fn typed_read(&self, value: ValueId) -> Option<&HirType> {
        self.typed_reads.get(&value)
    }
    pub(crate) fn local(&self, value: ValueId) -> Result<u32, Failure> {
        self.values[value.0 as usize]
            .ok_or_else(|| Failure::Invariant(format!("%{} has no value local", value.0)))
    }
    pub(crate) fn load(&mut self, value: ValueId) -> Result<(), Failure> {
        if self.constant(value)? {
            return Ok(());
        }
        let local = self.local(value)?;
        self.instruction(&I::LocalGet(local));
        Ok(())
    }
    /// Set each literal a loop reads into its own local, once, at entry; its
    /// reads then load the local (`constant`).
    fn hoist_literals(&mut self) -> Result<(), EmitError> {
        for value in self.hoisted.clone() {
            let OpKind::ConstString(text) = &self.func.value(value).kind else {
                continue;
            };
            crate::strings::constant(self, &text.clone());
            let local = self
                .local(value)
                .map_err(|failure| failure.at(&self.func.name, &self.func.value(value).origin))?;
            self.instruction(&I::LocalSet(local));
        }
        Ok(())
    }
    /// Emit `value` itself where it is a constant, and say whether it was.
    ///
    /// A constant is written where it is used rather than set into a local
    /// where it is defined and read back: the same value, from an instruction
    /// as short as the `local.get` it replaces, without the `local.set`. The
    /// round trips were a third of the bytes of a short method, and V8 inlines
    /// by size. A bigint constant allocates, so it keeps its local.
    fn constant(&mut self, value: ValueId) -> Result<bool, Failure> {
        let op = self.func.value(value);
        match &op.kind {
            OpKind::ConstBool(it) => self.instruction(&I::I32Const(i32::from(*it))),
            OpKind::ConstInt(_) if crate::bigints::is_bigint(&op.ty) => return Ok(false),
            OpKind::ConstInt(it) => numeric::constant_int(self, *it, &op.ty)?,
            OpKind::ConstFloat(it) => numeric::constant_float(self, *it, &op.ty)?,
            OpKind::ConstString(_) if self.hoisted.contains(&value) => return Ok(false),
            OpKind::ConstString(it) => crate::strings::constant(self, it),
            OpKind::ConstNull => crate::erased::constant(self, value, crate::erased::NULL)?,
            _ => return Ok(false),
        }
        Ok(true)
    }
    pub(crate) fn ty(&self, value: ValueId) -> &nts_core::hir::HirType {
        &self.func.value(value).ty
    }
    pub(crate) fn helper(&mut self, helper: Helper) -> Result<(), Failure> {
        let f = crate::helpers::callee(self.m, helper)?;
        self.call(f);
        Ok(())
    }
    fn depth(&self, label: Label) -> Result<u32, Failure> {
        self.labels
            .iter()
            .rposition(|it| *it == label)
            .map(|at| crate::module::index(self.labels.len() - at - 1))
            .ok_or_else(|| Failure::Invariant(format!("edge to out-of-scope {label:?}")))
    }
    fn open(&mut self, loop_: bool, label: Label) {
        self.instruction(&if loop_ {
            I::Loop(BlockType::Empty)
        } else {
            I::Block(BlockType::Empty)
        });
        self.labels.push(label);
    }
    fn close(&mut self) {
        self.instruction(&I::End);
        self.labels.pop();
    }
    fn structuring(&self, reason: impl std::fmt::Display) -> EmitError {
        EmitError::Structuring {
            function: self.func.name.clone(),
            reason: reason.to_string(),
        }
    }
    /// A failure while lowering a block's terminator. A shape Wasm declines
    /// is a named refusal, located at the block's last operation (terminators
    /// carry no origin); anything else is a structurer error.
    fn terminator_failure(&self, failure: Failure, block: BlockId) -> EmitError {
        match failure {
            Failure::Unsupported(_) => {
                let func = self.func;
                let origin = func.blocks[block.0 as usize]
                    .ops
                    .last()
                    .map_or(&func.origin, |op| &func.value(*op).origin);
                failure.at(&func.name, origin)
            }
            Failure::Invariant(reason) => self.structuring(reason),
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
        self.copies(to, args)
            .map_err(|failure| self.terminator_failure(failure, from))?;
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
        self.instruction(&I::Br(depth));
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
                self.instruction(&I::If(BlockType::Empty));
                self.labels.push(Label::Other);
                self.branch(id, then_target, &then_args, structure)?;
                self.instruction(&I::Else);
                self.branch(id, else_target, &else_args, structure)?;
                self.close();
                Ok(())
            }
            Terminator::Return(value) => self
                .return_value(value)
                .map_err(|failure| self.terminator_failure(failure, id)),
            Terminator::Unreachable => {
                self.instruction(&I::Unreachable);
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
        self.instruction(&I::LocalGet(self.pc.expect("dispatcher has its PC")));
        let targets = (0..crate::module::index(order.len())).collect::<Vec<_>>();
        self.instruction(&I::BrTable(
            targets.into(),
            crate::module::index(order.len()) + 1,
        ));
        for id in order {
            self.close();
            self.block(*id)?;
        }
        self.close();
        self.close();
        self.instruction(&I::Unreachable);
        Ok(())
    }
    fn actions(&mut self, block: BlockId) -> Result<(), EmitError> {
        if std::mem::replace(&mut self.visited[block.0 as usize], true) {
            return Err(self.structuring(format!("b{} was emitted twice", block.0)));
        }
        let func = self.func;
        for id in &func.blocks[block.0 as usize].ops {
            let op = func.value(*id);
            self.code.mark(op.origin.clone());
            self.op(*id)
                .map_err(|failure| failure.at(&func.name, &op.origin))?;
        }
        Ok(())
    }
    fn block(&mut self, block: BlockId) -> Result<(), EmitError> {
        self.actions(block)?;
        let func = self.func;
        self.terminator(&func.blocks[block.0 as usize].terminator)
            .map_err(|failure| self.terminator_failure(failure, block))
    }
    /// The moves an edge makes into its target's parameters. Each argument
    /// transfers to its parameter's type, after any save that breaks a cycle.
    fn copies(&mut self, target: BlockId, args: &[ValueId]) -> Result<(), Failure> {
        let func = self.func;
        let mut saved = BTreeMap::new();
        for copy in edge_copies(&func.blocks[target.0 as usize].params, args) {
            match copy {
                Copy::Move { to, from } => {
                    self.load(from)?;
                    self.transfer(&func.value(from).ty, &func.value(to).ty)?;
                    self.instruction(&I::LocalSet(self.local(to)?));
                }
                Copy::Save { temp, from } => {
                    self.load(from)?;
                    let slot = self.types().value_slot(self.ty(from))?;
                    let local = self.scratch.get(&(temp, slot)).copied().ok_or_else(|| {
                        Failure::Invariant(format!("unplanned edge temporary {temp}: {slot:?}"))
                    })?;
                    saved.insert(temp, (slot, from));
                    self.instruction(&I::LocalSet(local));
                }
                Copy::Restore { to, temp } => {
                    let (slot, from) = saved.get(&temp).copied().ok_or_else(|| {
                        Failure::Invariant(format!("edge temporary {temp} restored before saving"))
                    })?;
                    let local = self.scratch.get(&(temp, slot)).copied().ok_or_else(|| {
                        Failure::Invariant(format!("unplanned edge temporary {temp}: {slot:?}"))
                    })?;
                    self.instruction(&I::LocalGet(local));
                    self.transfer(&func.value(from).ty, &func.value(to).ty)?;
                    self.instruction(&I::LocalSet(self.local(to)?));
                }
            }
        }
        Ok(())
    }
    fn edge(&mut self, target: BlockId, args: &[ValueId]) -> Result<(), Failure> {
        self.copies(target, args)?;
        if let Some(pc) = self.pc {
            self.instruction(&I::I32Const(
                i32::try_from(self.cases[&target])
                    .map_err(|_| "more than 2^31 dispatcher cases")?,
            ));
            self.instruction(&I::LocalSet(pc));
            self.instruction(&I::Br(self.depth(Label::Dispatch)?));
        } else {
            self.instruction(&I::Br(self.depth(Label::Target(target))?));
        }
        self.edges += 1;
        Ok(())
    }
    fn terminator(&mut self, terminator: &Terminator) -> Result<(), Failure> {
        match terminator {
            Terminator::Return(value) => self.return_value(*value)?,
            Terminator::Jump { target, args } => self.edge(*target, args)?,
            Terminator::Branch {
                cond,
                then_target,
                then_args,
                else_target,
                else_args,
            } => {
                self.load(*cond)?;
                self.instruction(&I::If(BlockType::Empty));
                self.labels.push(Label::Other);
                self.edge(*then_target, then_args)?;
                self.instruction(&I::Else);
                self.edge(*else_target, else_args)?;
                self.close();
            }
            Terminator::Unreachable => self.instruction(&I::Unreachable),
            Terminator::FellThrough => {
                return Err(("a reachable FellThrough terminator".to_owned()).into());
            }
        }
        Ok(())
    }
    fn op(&mut self, id: ValueId) -> Result<(), Failure> {
        let op = self.func.value(id);
        match &op.kind {
            OpKind::ConstInt(value) if crate::bigints::is_bigint(&op.ty) => {
                crate::bigints::constant(self, *value);
            }
            // A parameter is its own local; any other constant is written
            // where each use loads it (`constant`).
            OpKind::Param(_)
            | OpKind::BlockParam(_)
            | OpKind::ConstBool(_)
            | OpKind::ConstInt(_)
            | OpKind::ConstFloat(_)
            | OpKind::ConstString(_)
            | OpKind::ConstNull => return Ok(()),
            OpKind::Erase {
                value,
                absent,
                slots,
            } => self.erase(id, *value, *absent, *slots)?,
            OpKind::Unerase { value } => crate::erased::unerase(self, id, *value)?,
            OpKind::TagOf { value } => crate::erased::tag(self, id, *value)?,
            OpKind::ObjectNew { frame } => crate::objects::new(self, id, *frame)?,
            OpKind::ClosureStatic => crate::callables::static_value(self, id)?,
            OpKind::FieldGet { object, field } => crate::objects::get(self, id, *object, *field)?,
            OpKind::FieldSet {
                object,
                field,
                value,
            } => return crate::objects::set(self, id, *object, *field, *value),
            kind @ (OpKind::SharedFieldGet { .. }
            | OpKind::OpenFieldGet { .. }
            | OpKind::OpenFieldSet { .. }) => crate::objects::open_member(self, id, kind)?,
            OpKind::InstanceOf { value, classes, .. } => {
                crate::objects::instance(self, *value, classes)?;
            }
            kind @ (OpKind::ArrayNew { .. }
            | OpKind::ArrayGet { .. }
            | OpKind::ArraySet { .. }
            | OpKind::ConstTemplate { .. }) => {
                crate::arrays::operation(self, id, kind)?;
            }
            OpKind::Length(value) => self.length(id, *value)?,
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
            OpKind::FieldView { value, .. } => self.field_view(id, *value)?,
            OpKind::GlobalGet(global) => self.global(*global, None, &op.ty)?,
            OpKind::GlobalSet { global, value } => {
                return self.global(*global, Some(*value), &op.ty);
            }
            OpKind::Call { callee, args, .. } => self.call_op(id, callee, args)?,
            OpKind::Return(value) => return self.return_value(*value),
            OpKind::ConstUndefined => {
                if self.types().slot(&op.ty)?.is_none() {
                    return Ok(());
                }
                crate::erased::constant(self, id, crate::erased::UNDEFINED)?;
            }
            OpKind::Retain(_) | OpKind::Release(_) => {
                return Err(format!("host-managed provider mismatch: {:?}", op.kind).into());
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
                return Err(format!("native ABI operation {:?}", op.kind).into());
            }
            OpKind::DispatchSlot(_) | OpKind::Suspend { .. } | OpKind::PromiseSubscribe { .. } => {
                crate::promises::operation(self, &op.kind)?;
            }
            OpKind::CellReady { .. } | OpKind::Await { .. } | OpKind::Yield { .. } => {
                return Err(format!("operation outside M1a: {:?}", op.kind).into());
            }
        }
        if self.types().slot(&op.ty)?.is_some() {
            self.instruction(&I::LocalSet(self.local(id)?));
        }
        Ok(())
    }
    /// A string's, an array's, a view's or a collection's length.
    fn length(&mut self, result: ValueId, value: ValueId) -> Result<(), Failure> {
        let ty = self.ty(value);
        if matches!(ty, HirType::Managed(ManagedType::View(_))) {
            crate::buffers::element_count(self, result, value)
        } else if crate::strings::is_string(ty) {
            crate::strings::length(self, result, value)
        } else if crate::arrays::is_array(ty) {
            crate::arrays::length(self, result, value)
        } else if crate::collections::is_collection(ty) {
            crate::collections::size(self, result, value)
        } else if ty == &HirType::Erased {
            crate::array_methods::open_length(self, result, value)
        } else {
            Err(format!("the length of a {ty:?}").into())
        }
    }
    /// A program global's read, or its write of `stored`, transferring
    /// between the global's declared type and the value's.
    fn global(
        &mut self,
        global: u32,
        stored: Option<ValueId>,
        read: &HirType,
    ) -> Result<(), Failure> {
        let program = self.m.program;
        let declared = &program
            .globals
            .get(global as usize)
            .ok_or_else(|| Failure::Invariant(format!("unplanned program global {global}")))?
            .ty;
        let g = crate::module::program_global(self.m, global)?;
        if let Some(value) = stored {
            self.load(value)?;
            let func = self.func;
            self.transfer(&func.value(value).ty, declared)?;
            self.global_set(g);
        } else {
            self.global_get(g);
            self.transfer(declared, read)?;
        }
        Ok(())
    }
    /// A return transfers its value to the declared result type. A function
    /// declared `never` has no result, so a value it carries is not loaded. A
    /// host entry in a module that raises first throws any raise still
    /// pending, so none leaves wasm.
    fn return_value(&mut self, value: Option<ValueId>) -> Result<(), Failure> {
        let func = self.func;
        if let Some(value) = value
            && self.types().slot(&func.return_type)?.is_some()
        {
            self.load(value)?;
            self.transfer(&func.value(value).ty, &func.return_type)?;
        }
        if self.m.raises && self.m.is_host_entry(self.m.program_func(&self.func.name)?) {
            crate::raising::leave(self)?;
        }
        self.instruction(&I::Return);
        Ok(())
    }
    fn erase(
        &mut self,
        id: ValueId,
        value: ValueId,
        absent: nts_core::hir::Absent,
        slots: nts_core::hir::Absent,
    ) -> Result<(), Failure> {
        if slots == nts_core::hir::Absent::Null {
            crate::arrays::mark_null_slots(self, value)?;
        }
        if self
            .m
            .raising_results
            .get(&self.func.name)
            .is_some_and(|results| results.contains(&id))
        {
            crate::raising::erase_result(self, value, absent)
        } else {
            crate::erased::erase(self, value, absent)
        }
    }
    fn binary(
        &mut self,
        id: ValueId,
        op: nts_core::hir::BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<(), Failure> {
        if crate::bigints::is_bigint(self.ty(lhs)) || crate::bigints::is_bigint(self.ty(rhs)) {
            crate::bigints::binary(self, op, lhs, rhs)
        } else if self.ty(lhs) == &nts_core::hir::HirType::Erased
            || self.ty(rhs) == &nts_core::hir::HirType::Erased
        {
            crate::erased_ops::binary(self, id, op, lhs, rhs)
        } else if crate::strings::is_string(self.ty(lhs)) || crate::strings::is_string(self.ty(rhs))
        {
            crate::strings::binary(self, op, lhs, rhs)
        } else if crate::objects::is_reference(self.ty(lhs))
            || crate::objects::is_reference(self.ty(rhs))
        {
            crate::objects::binary(self, op, lhs, rhs)
        } else {
            numeric::binary(self, id, op, lhs, rhs)
        }
    }
    fn unary(
        &mut self,
        id: ValueId,
        op: nts_core::hir::UnOp,
        value: ValueId,
    ) -> Result<(), Failure> {
        if crate::bigints::is_bigint(self.ty(value)) {
            crate::bigints::unary(self, op, value)
        } else if self.ty(value) == &nts_core::hir::HirType::Erased {
            crate::erased_ops::truthy(self, op, value)
        } else if crate::strings::is_string(self.ty(value)) {
            crate::strings::truthy(self, op, value)
        } else if crate::objects::is_reference(self.ty(value)) {
            crate::objects::truthy(self, op, value)
        } else {
            numeric::unary(self, id, op, value)
        }
    }
    /// A view is the object itself: once interface access is materialized
    /// every read through the interface dispatches, and the view's owner has a
    /// row. A program that skipped preparation would still read by position,
    /// so a view is refused there.
    fn field_view(&mut self, id: ValueId, value: ValueId) -> Result<(), Failure> {
        if !self.m.program.interface_access.materialized {
            return Err("a field view, whose reads need interface dispatch (Materialize)".into());
        }
        self.load(value)?;
        let (found, wanted) = (self.ty(value).clone(), self.ty(id).clone());
        self.transfer(&found, &wanted)
    }

    fn convert(&mut self, id: ValueId, value: ValueId) -> Result<(), Failure> {
        let from = self.ty(value).clone();
        let to = self.ty(id).clone();
        if crate::bigints::is_bigint(&from) || crate::bigints::is_bigint(&to) {
            return crate::bigints::convert(self, value, &to);
        }
        // A template's strings are immutable: made writable array storage, a
        // template refuses at run time, as C's `nts_array_writable` does.
        if from == nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Template)
            && matches!(
                to,
                nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Array(_))
            )
        {
            self.load(value)?;
            self.instruction(&I::RefIsNull);
            crate::contract::require(
                self,
                "converting an immutable template object to writable array storage",
            )?;
            return crate::objects::default(self, &to);
        }
        if crate::objects::is_reference(&from) {
            if to == nts_core::hir::HirType::Bool {
                return crate::objects::truthy(self, nts_core::hir::UnOp::Truthy, value);
            }
            self.load(value)?;
            return crate::objects::adapt(self, &from, &to);
        }
        if from == nts_core::hir::HirType::Erased && to == nts_core::hir::HirType::Bool {
            return crate::erased_ops::truthy(self, nts_core::hir::UnOp::Truthy, value);
        }
        if from == nts_core::hir::HirType::Erased && to == from {
            return self.load(value);
        }
        if crate::strings::is_string(&from) && to == nts_core::hir::HirType::Bool {
            return crate::strings::truthy(self, nts_core::hir::UnOp::Truthy, value);
        }
        self.load(value)?;
        if crate::strings::is_string(&from) && crate::strings::is_string(&to) {
            return Ok(());
        }
        numeric::convert(self, &from, &to)
    }
    /// A call of a runtime helper, answered by the module that implements it,
    /// or refused by name with the support catalog's reason.
    fn external_call(
        &mut self,
        result: ValueId,
        name: &str,
        args: &[ValueId],
    ) -> Result<(), Failure> {
        for (at, &argument) in args.iter().enumerate() {
            let initializes = at == 0
                && (nts_core::hir::fills_every_slot(name)
                    || (nts_core::hir::sets_length(name)
                        && args
                            .get(1)
                            .is_some_and(|id| match self.func.value(*id).kind {
                                OpKind::ConstInt(0) => true,
                                OpKind::ConstFloat(n) => n == 0.0,
                                _ => false,
                            })));
            if !initializes {
                crate::arrays::dense(self, argument)?;
            }
        }
        if let Some(helper) = crate::raising::external(name) {
            crate::raising::call(self, result, name, helper, args)?;
        } else if let Some(helper) = crate::strings::external(name) {
            crate::strings::runtime(self, result, helper, args)?;
        } else if let Some(service) = crate::host::external(name) {
            service.call(self, result, args)?;
        } else if let Some(helper) = crate::erased_ops::external(name) {
            crate::erased_ops::runtime(self, result, helper, args)?;
        } else if let Some(method) = crate::array_methods::external(name) {
            crate::array_methods::call(self, result, name, method, args)?;
        } else if let Some(method) = crate::array_copy::external(name) {
            crate::array_copy::call(self, result, name, method, args)?;
        } else if let Some(method) = crate::array_lookup::external(name) {
            crate::array_lookup::call(self, result, name, method, args)?;
        } else if let Some(join) = crate::array_join::external(name) {
            crate::array_join::call(self, result, name, join, args)?;
        } else if crate::array_sort::external(name) {
            crate::array_sort::call(self, result, name, args)?;
        } else if let Some(helper) = crate::values::external(name) {
            crate::values::call(self, result, helper, args)?;
        } else if let Some(op) = crate::collections::external(name) {
            crate::collections::call(self, result, op, args)?;
        } else if let Some(op) = crate::promises::external(name) {
            crate::promises::call(self, result, op, args)?;
        } else if let Some(op) = crate::timers::external(name) {
            crate::timers::call(self, result, op, args)?;
        } else if let Some(op) = crate::buffers::external(name) {
            crate::buffers::call(self, result, op, args)?;
        } else if let Some(op) = crate::buffer_methods::external(name) {
            crate::buffer_methods::call(self, result, op, args)?;
        } else if let Some(op) = crate::dataviews::external(name) {
            crate::dataviews::call(self, result, op, args)?;
        } else if let Some(op) = crate::symbols::external(name) {
            crate::symbols::call(self, result, op, args)?;
        } else if let Some(op) = crate::dates::external(name) {
            crate::dates::call(self, result, op, args)?;
        } else if let Some(op) = crate::bigints::external(name) {
            crate::bigints::call(self, result, op, args)?;
        } else if let Some(op) = crate::conversions::external(name) {
            crate::conversions::call(self, result, op, args)?;
        } else if crate::string_split::is_split(name) {
            crate::string_split::call(self, result, args)?;
        } else if crate::function_names::is_name(name) {
            crate::function_names::call(self, result, args)?;
        } else if let Some(op) = crate::presence::external(name) {
            crate::presence::call(self, result, op, args)?;
        } else if let Some(conversion) = crate::numeric::external(name) {
            crate::numeric::call(self, result, conversion, args)?;
        } else {
            return Err(match crate::helper_support(name) {
                Some(crate::Support::Decline(reason)) => format!("runtime/external helper `{name}`: {reason}").into(),
                Some(crate::Support::Intrinsic | crate::Support::WasmHelper | crate::Support::HostImport) => Failure::Invariant(format!("cataloged helper `{name}` has no implementation binding")),
                None => format!("unclassified runtime/external helper `{name}` is outside the implemented Wasm helper surface").into(),
            });
        }
        for &argument in args {
            crate::arrays::mark_dense(self, argument)?;
        }
        Ok(())
    }
    fn call_op(
        &mut self,
        result: ValueId,
        callee: &Callee,
        args: &[ValueId],
    ) -> Result<(), Failure> {
        match callee {
            Callee::Direct(name) => {
                let func = self.func;
                let (target, callee) = self.m.direct(name)?;
                if callee.params.len() != args.len() {
                    return Err(Failure::Invariant(format!(
                        "direct call to `{name}` with {} arguments for {} parameters",
                        args.len(),
                        callee.params.len()
                    )));
                }
                for (&arg, param) in args.iter().zip(&callee.params) {
                    self.load(arg)?;
                    self.transfer(&func.value(arg).ty, &param.ty)?;
                }
                self.call(target);
                if self.types().slot(&callee.return_type)?.is_some() {
                    self.transfer(&callee.return_type, &func.value(result).ty)?;
                }
            }
            Callee::External(name) => self.external_call(result, name, args)?,
            Callee::Native(function) => return Err(format!("native call {function:?}").into()),
            Callee::Virtual { slot, declared } => {
                let through_face = args.first().is_some_and(|receiver| {
                    matches!(self.func.value(*receiver).ty,
                        HirType::Managed(nts_core::hir::ManagedType::Object(ty))
                            if crate::demand::is_face(self.m.program, ty))
                });
                if through_face {
                    crate::rows::call(self, result, *slot, declared, args)?;
                } else {
                    crate::callables::call(
                        self,
                        result,
                        *slot,
                        args,
                        crate::callables::Face::Virtual,
                    )?;
                }
            }
            Callee::Closure { slot } => {
                crate::callables::call(self, result, *slot, args, crate::callables::Face::Closure)?;
            }
        }
        Ok(())
    }
}
