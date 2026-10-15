//! Small direct calls, inlined into their callers over emitted bodies.
//!
//! V8 inlines a Wasm callee only under a byte budget scaled to its caller,
//! and nothing between this backend and the engine optimises the module, so
//! a six-line method called from a short one stayed a call: AWFY's towers
//! spent 72% of its time in two of them. C and LLVM give clang the whole
//! program and the JVM's runtime inlines its own; this is the Wasm backend's
//! inliner. It
//! runs after lowering, where every HIR fact is already spent into
//! instructions, so a copy is semantics only: the arguments go to fresh
//! locals, the body runs in a block whose result is the callee's, and a
//! `return` is a branch out of that block.
//!
//! A call is inlined when its callee is a program function with a body, not
//! exported, not recursive and at most [`CALLEE_BYTES`]; a caller takes
//! callees until it reaches [`GROWTH`] times its own size or
//! [`CALLER_FLOOR`], whichever is larger. Callees are finished first,
//! bottom-up over the call graph.

use crate::{
    ir::{self, Inst},
    module::{Builder, Func, encoded_size},
    types::Physical,
};
use nts_semantic_schema::Origin;
use std::collections::{BTreeMap, BTreeSet, btree_map::Entry};
use wasm_encoder::{BlockType, Instruction as I, ValType};

/// The largest callee body inlined, in bytes: under V8's own 500, and above
/// towers' `pushDisk` (272).
const CALLEE_BYTES: usize = 300;
/// How large a caller may grow, as a multiple of its own size...
const GROWTH: usize = 3;
/// ...or to this many bytes, for a short caller of a few callees.
const CALLER_FLOOR: usize = 1200;

/// Inline the program's small direct calls.
pub(crate) fn program(m: &mut Builder<'_>) {
    let funcs = m.program_bodies();
    let exported = m.exported_funcs();
    let known: BTreeSet<Func> = funcs.iter().copied().collect();
    let calls: BTreeMap<Func, BTreeSet<Func>> = funcs
        .iter()
        .map(|&func| {
            (
                func,
                m.body(func)
                    .map_or_else(BTreeSet::new, |body| callees(body, &known)),
            )
        })
        .collect();
    let (order, recursive) = bottom_up(&funcs, &calls);
    for caller in order {
        let Some(body) = m.body(caller) else {
            continue;
        };
        let mut taken = BTreeMap::new();
        for &callee in &calls[&caller] {
            if callee == caller || recursive.contains(&callee) || exported.contains(&callee) {
                continue;
            }
            let Some(callee_body) = m.body(callee) else {
                continue;
            };
            let size = encoded_size(callee_body);
            if size > CALLEE_BYTES {
                continue;
            }
            let (params, result) = m.signature(callee);
            taken.insert(callee, Callee::new(callee_body, params, result, size));
        }
        if taken.is_empty() {
            continue;
        }
        let own = encoded_size(body);
        let budget = (own * GROWTH).max(CALLER_FLOOR).saturating_sub(own);
        let params = m.signature(caller).0.len();
        let expanded = expand(body, params, &taken, budget);
        if let Some(expanded) = expanded {
            m.replace_body(caller, expanded);
        }
    }
}

/// The program functions a body calls directly.
fn callees(body: &ir::Function, known: &BTreeSet<Func>) -> BTreeSet<Func> {
    body.code
        .insts
        .iter()
        .filter_map(|inst| match inst {
            Inst::Call(func) if known.contains(func) => Some(*func),
            _ => None,
        })
        .collect()
}

/// A callee as a call site takes it.
struct Callee<'a> {
    body: &'a ir::Function,
    params: Vec<ValType>,
    result: Option<ValType>,
    size: usize,
    /// Its locals some path reads before writing (`unwritten_reads`), which
    /// start from their default: a function's locals are zero on entry, an
    /// inlined copy's are whatever the last copy left.
    fresh: Vec<bool>,
}

impl<'a> Callee<'a> {
    fn new(
        body: &'a ir::Function,
        params: &[Physical],
        result: Option<Physical>,
        size: usize,
    ) -> Self {
        let first = params.len();
        let mut fresh = vec![false; body.locals.len()];
        for local in unwritten_reads(body, first) {
            if let Some(at) = (local as usize).checked_sub(first) {
                fresh[at] = true;
            }
        }
        Self {
            body,
            params: params.iter().map(|param| param.wasm()).collect(),
            result: result.map(Physical::wasm),
            size,
            fresh,
        }
    }
}

/// `body` with its calls to `taken` inlined while `budget` bytes last, or
/// `None` if none was.
fn expand(
    body: &ir::Function,
    params: usize,
    taken: &BTreeMap<Func, Callee<'_>>,
    mut budget: usize,
) -> Option<ir::Function> {
    let mut locals = body.locals.clone();
    let mut insts = Vec::with_capacity(body.code.insts.len());
    let mut marks: Vec<(usize, Origin)> = Vec::with_capacity(body.code.marks.len());
    let mut own_marks = body.code.marks.iter().peekable();
    let mut inlined = false;
    for (at, inst) in body.code.insts.iter().enumerate() {
        while let Some((_, origin)) = own_marks.next_if(|(mark, _)| *mark == at) {
            marks.push((insts.len(), origin.clone()));
        }
        let target = match inst {
            Inst::Call(func) => taken.get(func).filter(|target| target.size <= budget),
            _ => None,
        };
        let Some(target) = target else {
            insts.push(inst.clone());
            continue;
        };
        budget -= target.size;
        inlined = true;
        let base = u32::try_from(params + locals.len()).unwrap_or(u32::MAX);
        locals.extend(&target.params);
        locals.extend(&target.body.locals);
        // The arguments, last on the stack first.
        for index in (0..target.params.len()).rev() {
            insts.push(Inst::Op(I::LocalSet(base + index32(index))));
        }
        let first = base + index32(target.params.len());
        for (index, ty) in target.body.locals.iter().enumerate() {
            if target.fresh[index]
                && let Some(zero) = zero(*ty)
            {
                insts.push(Inst::Op(zero));
                insts.push(Inst::Op(I::LocalSet(first + index32(index))));
            }
        }
        insts.push(Inst::Op(I::Block(
            target.result.map_or(BlockType::Empty, BlockType::Result),
        )));
        let last = target.body.code.insts.len().saturating_sub(1);
        let mut callee_marks = target.body.code.marks.iter().peekable();
        let mut depth = 0u32;
        for (k, inst) in target.body.code.insts.iter().enumerate() {
            while let Some((_, origin)) = callee_marks.next_if(|(mark, _)| *mark == k) {
                marks.push((insts.len(), origin.clone()));
            }
            // The function's own `end` closes the block.
            if k == last {
                insts.push(Inst::Op(I::End));
                break;
            }
            insts.push(relocate(inst, base, &mut depth));
        }
    }
    for (_, origin) in own_marks {
        marks.push((insts.len(), origin.clone()));
    }
    inlined.then(|| {
        let mut expanded = ir::Function::new(locals);
        expanded.code.insts = insts;
        expanded.code.marks = marks;
        expanded
    })
}

/// A callee's instruction in its caller: its locals moved to `base`, and a
/// `return` a branch out of the block the body runs in, `depth` structures
/// down.
fn relocate(inst: &Inst, base: u32, depth: &mut u32) -> Inst {
    let Inst::Op(i) = inst else {
        return inst.clone();
    };
    Inst::Op(match i {
        I::LocalGet(local) => I::LocalGet(base + local),
        I::LocalSet(local) => I::LocalSet(base + local),
        I::LocalTee(local) => I::LocalTee(base + local),
        I::Return => I::Br(*depth),
        I::Block(_) | I::Loop(_) | I::If(_) | I::TryTable(..) => {
            *depth += 1;
            i.clone()
        }
        I::End => {
            *depth = depth.saturating_sub(1);
            i.clone()
        }
        other => other.clone(),
    })
}

/// A local's value on function entry.
fn zero(ty: ValType) -> Option<I<'static>> {
    Some(match ty {
        ValType::I32 => I::I32Const(0),
        ValType::I64 => I::I64Const(0),
        ValType::F32 => I::F32Const(0.0.into()),
        ValType::F64 => I::F64Const(0.0.into()),
        ValType::V128 => I::V128Const(0),
        ValType::Ref(reference) if reference.nullable => I::RefNull(reference.heap_type),
        // A non-defaultable local is set before any read, or does not validate.
        ValType::Ref(_) => return None,
    })
}

/// The locals of `body` past its `params` that some path reads before it
/// writes them: the ones whose zero on entry the body may use.
///
/// A must-be-written dataflow over the structured code. Writes only add, so a
/// loop's header holds what its entry held; a block's or an `if`'s end holds
/// what every arriving path holds; a `try_table`'s catches arrive with what
/// its entry held, the least any throw inside it can carry; and code after an
/// unconditional exit is unreachable, which every meet ignores.
pub(crate) fn unwritten_reads(body: &ir::Function, params: usize) -> BTreeSet<u32> {
    let mut walk = Walk {
        params,
        state: Some(vec![false; body.locals.len()]),
        frames: Vec::new(),
        unwritten: BTreeSet::new(),
    };
    for inst in &body.code.insts {
        if !walk.step(inst) {
            break;
        }
    }
    walk.unwritten
}

/// The locals written on every path to a point, or `None` where no path is.
type Written = Option<Vec<bool>>;

/// `into` narrowed to what `from` also holds; an unreachable side adds no
/// constraint.
fn meet(into: &mut Written, from: &Written) {
    match (into.as_mut(), from) {
        (_, None) => {}
        (None, Some(from)) => *into = Some(from.clone()),
        (Some(into), Some(from)) => {
            for (written, also) in into.iter_mut().zip(from) {
                *written &= *also;
            }
        }
    }
}

/// An open structure: what held at its entry, and what holds where it exits.
struct Frame {
    looping: bool,
    is_if: bool,
    entry: Written,
    exit: Written,
    has_else: bool,
}

/// The dataflow, one instruction at a time.
struct Walk {
    params: usize,
    state: Written,
    frames: Vec<Frame>,
    unwritten: BTreeSet<u32>,
}

impl Walk {
    /// Take one instruction; `false` at the function's own end.
    fn step(&mut self, inst: &Inst) -> bool {
        let Inst::Op(i) = inst else {
            if matches!(inst, Inst::Throw(_)) {
                self.state = None;
            }
            return true;
        };
        match i {
            I::LocalGet(index) => self.read(*index),
            I::LocalSet(index) | I::LocalTee(index) => self.write(*index),
            I::Block(_) => self.open(false, false),
            I::Loop(_) => self.open(true, false),
            I::If(_) => self.open(false, true),
            I::TryTable(_, catches) => {
                for catch in catches.iter() {
                    let (wasm_encoder::Catch::One { label, .. }
                    | wasm_encoder::Catch::OneRef { label, .. }
                    | wasm_encoder::Catch::All { label }
                    | wasm_encoder::Catch::AllRef { label }) = catch;
                    self.arrive(*label);
                }
                self.open(false, false);
            }
            I::Else => {
                if let Some(frame) = self.frames.last_mut() {
                    meet(&mut frame.exit, &self.state);
                    frame.has_else = true;
                    self.state = frame.entry.clone();
                }
            }
            I::End => return self.close(),
            I::Br(depth) => {
                self.arrive(*depth);
                self.state = None;
            }
            I::BrIf(depth) | I::BrOnNull(depth) | I::BrOnNonNull(depth) => self.arrive(*depth),
            I::BrOnCast { relative_depth, .. } | I::BrOnCastFail { relative_depth, .. } => {
                self.arrive(*relative_depth);
            }
            I::BrTable(targets, default) => {
                for depth in targets.iter().chain(std::iter::once(default)) {
                    self.arrive(*depth);
                }
                self.state = None;
            }
            I::Return | I::Unreachable | I::ThrowRef => self.state = None,
            _ => {}
        }
        true
    }

    fn local(&self, index: u32) -> Option<usize> {
        (index as usize).checked_sub(self.params)
    }

    fn read(&mut self, index: u32) {
        if let (Some(at), Some(written)) = (self.local(index), &self.state)
            && !written[at]
        {
            self.unwritten.insert(index);
        }
    }

    fn write(&mut self, index: u32) {
        if let Some(at) = self.local(index)
            && let Some(written) = &mut self.state
        {
            written[at] = true;
        }
    }

    fn open(&mut self, looping: bool, is_if: bool) {
        self.frames.push(Frame {
            looping,
            is_if,
            entry: self.state.clone(),
            exit: None,
            has_else: false,
        });
    }

    /// The end of a structure, or `false` at the function's own.
    fn close(&mut self) -> bool {
        let Some(mut frame) = self.frames.pop() else {
            return false;
        };
        if !frame.looping {
            meet(&mut frame.exit, &self.state);
            if frame.is_if && !frame.has_else {
                meet(&mut frame.exit, &frame.entry);
            }
            self.state = frame.exit;
        }
        true
    }

    /// A branch to the label `depth` structures out, with what holds here.
    fn arrive(&mut self, depth: u32) {
        let Some(at) = self.frames.len().checked_sub(depth as usize + 1) else {
            return; // the function's own label: a return
        };
        let frame = &mut self.frames[at];
        if !frame.looping {
            meet(&mut frame.exit, &self.state);
        }
    }
}

fn index32(index: usize) -> u32 {
    u32::try_from(index).unwrap_or(u32::MAX)
}

/// The functions callees first -- Tarjan's components come out in reverse
/// topological order -- and those that can reach themselves.
fn bottom_up(
    funcs: &[Func],
    calls: &BTreeMap<Func, BTreeSet<Func>>,
) -> (Vec<Func>, BTreeSet<Func>) {
    let mut index: BTreeMap<Func, usize> = BTreeMap::new();
    let mut low: BTreeMap<Func, usize> = BTreeMap::new();
    let mut on_stack = BTreeSet::new();
    let mut stack = Vec::new();
    let mut order = Vec::with_capacity(funcs.len());
    let mut recursive = BTreeSet::new();
    let mut next = 0;
    for &root in funcs {
        if index.contains_key(&root) {
            continue;
        }
        // (function, its callees still to visit)
        let mut work: Vec<(Func, Vec<Func>)> = Vec::new();
        index.insert(root, next);
        low.insert(root, next);
        next += 1;
        stack.push(root);
        on_stack.insert(root);
        work.push((root, calls[&root].iter().copied().collect()));
        while let Some((func, pending)) = work.last_mut() {
            let func = *func;
            if let Some(callee) = pending.pop() {
                match index.entry(callee) {
                    Entry::Vacant(slot) => {
                        slot.insert(next);
                        low.insert(callee, next);
                        next += 1;
                        stack.push(callee);
                        on_stack.insert(callee);
                        work.push((callee, calls[&callee].iter().copied().collect()));
                    }
                    Entry::Occupied(found) if on_stack.contains(&callee) => {
                        let reached = *found.get();
                        let own = low.get_mut(&func).expect("visited");
                        *own = (*own).min(reached);
                    }
                    Entry::Occupied(_) => {}
                }
                continue;
            }
            work.pop();
            if let Some((parent, _)) = work.last() {
                let reached = low[&func];
                let own = low.get_mut(parent).expect("visited");
                *own = (*own).min(reached);
            }
            if low[&func] == index[&func] {
                let mut component = Vec::new();
                while let Some(member) = stack.pop() {
                    on_stack.remove(&member);
                    component.push(member);
                    if member == func {
                        break;
                    }
                }
                if component.len() > 1 || calls[&func].contains(&func) {
                    recursive.extend(component.iter().copied());
                }
                order.extend(component);
            }
        }
    }
    (order, recursive)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Slot;
    use std::io::Write;

    /// A callee that writes its local in one arm of an `if` and reads it
    /// after, inlined into a loop that runs it with `true` and then `false`:
    /// the second run reads the zero a call would have started from, 7 in
    /// all, and not the 7 the first run left there, 14.
    #[test]
    fn a_local_written_on_one_path_is_reset_in_each_inlined_run() {
        let mut branching = ir::Function::new([ValType::I32]);
        branching.code.instructions(&[
            I::LocalGet(0),
            I::If(BlockType::Empty),
            I::I32Const(7),
            I::LocalSet(1),
            I::End,
            I::LocalGet(1),
            I::End,
        ]);
        assert_eq!(unwritten_reads(&branching, 1), BTreeSet::from([1]));
        let target = Func::by_hand(0);
        // locals: 0 = sum, 1 = k
        let mut looping = ir::Function::new([ValType::I32, ValType::I32]);
        looping
            .code
            .instructions(&[I::Loop(BlockType::Empty), I::LocalGet(1), I::I32Eqz]);
        looping.code.call(target);
        looping.code.instructions(&[
            I::LocalGet(0),
            I::I32Add,
            I::LocalSet(0),
            I::LocalGet(1),
            I::I32Const(1),
            I::I32Add,
            I::LocalTee(1),
            I::I32Const(2),
            I::I32LtU,
            I::BrIf(0),
            I::End,
            I::LocalGet(0),
            I::End,
        ]);
        let size = encoded_size(&branching);
        let taken = BTreeMap::from([(
            target,
            Callee::new(
                &branching,
                &[Physical::Scalar(Slot::I32)],
                Some(Physical::Scalar(Slot::I32)),
                size,
            ),
        )]);
        let expanded = expand(&looping, 0, &taken, usize::MAX).expect("the call is inlined");
        assert_eq!(run(&expanded), "7");
    }

    /// `body`, which calls nothing, as a module's one exported function of no
    /// parameters answering an i32, run by node.
    fn run(body: &ir::Function) -> String {
        let mut module = wasm_encoder::Module::new();
        let mut types = wasm_encoder::TypeSection::new();
        types.ty().function([], [ValType::I32]);
        module.section(&types);
        let mut functions = wasm_encoder::FunctionSection::new();
        functions.function(0);
        module.section(&functions);
        let mut exports = wasm_encoder::ExportSection::new();
        exports.export("f", wasm_encoder::ExportKind::Func, 0);
        module.section(&exports);
        let mut code = wasm_encoder::CodeSection::new();
        let mut encoded = wasm_encoder::Function::new_with_locals_types(body.locals.clone());
        for inst in &body.code.insts {
            let Inst::Op(i) = inst else {
                panic!("a symbol in a hand-built body: {inst:?}");
            };
            encoded.instruction(i);
        }
        code.function(&encoded);
        module.section(&code);
        let script = "const b=require('node:fs').readFileSync(0); \
                      process.stdout.write(String(new WebAssembly.Instance(new WebAssembly.Module(b)).exports.f()))";
        let mut child = std::process::Command::new("node")
            .args(["-e", script])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("node");
        child
            .stdin
            .take()
            .expect("stdin")
            .write_all(&module.finish())
            .expect("module written");
        let output = child.wait_with_output().expect("node ran");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).expect("utf-8")
    }
}
