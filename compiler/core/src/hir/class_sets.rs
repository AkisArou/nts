//! Calls through a value whose class is one of a few the whole program decides,
//! answered by testing for each.
//!
//! # The cost it removes
//!
//! A call through a function value (`Callee::Closure`) or an overridden method
//! (`Callee::Virtual`) is two dependent loads and an indirect call. The loads
//! are the small half. The large half is everything the indirection hides:
//!
//! - no C compiler, LLVM pass or V8 tier that is not speculating can inline the
//!   body, so the loop around it keeps a call, spills its accumulators across
//!   it and does not vectorise;
//! - [`super::own`] cannot keep a borrow across a call it cannot name, so every
//!   element read out of an array and handed to the callee is retained and
//!   released per iteration (record 0091's shape);
//! - the interprocedural analysis cannot carry an argument's facts into a body
//!   it cannot name, nor the body's result back.
//!
//! `benchmarks/cases/uniform-callback`, hand-edited before this was written:
//! the indirect call replaced by a test per class and a direct call took the
//! row from 3,128 ns to 1,927 ns on CPU 4; with the borrows that a direct call
//! allows, to 552 ns -- 5.7x, where Bun takes 930.
//!
//! # The rule
//!
//! The program is closed. Every object comes from an allocation the HIR names,
//! so the classes a value can hold are a join over where it came from: the
//! allocations reaching it through block parameters, the stores into the local
//! array it was read out of, the arguments every caller passes for the
//! parameter it is. Where that join is a set of at most [`MAX_TESTED`] classes
//! and every source was seen, the call becomes a test per class and a direct
//! call to that class's row, and what is left -- which the join says is only a
//! receiver that is none of them, a null -- is the refusal a null call is.
//!
//! Where any source is not seen the answer is [`Classes::Any`] and the call is
//! left alone. There is no fallback dispatch kept beside the tests: an
//! indirect call anywhere after a borrowed load ends the borrow for the whole
//! loop (`own::slot_survives`), so a guarded call with its dispatch kept costs
//! most of what the dispatch did (1,927 ns against 552 on the row above).
//!
//! # Where it runs
//!
//! After [`super::monomorphize`] and [`super::inline`], whose clones and copied
//! factories are what make an argument's class visible at its call site, and
//! before `fields::devirtualize` runs again over the arms this leaves: each arm
//! calls through a receiver read back at one closure class, which is exactly
//! the shape that pass turns into a direct call in the written ABI.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    Absent, Block, BlockId, Callee, Func, HirType, ManagedType, Op, OpKind, Program, Terminator,
    TypeId, ValueId,
};

/// The most classes one call tests.
///
/// A test is a compare against a descriptor address and a predictable branch;
/// the table is two dependent loads and an indirect call nothing can inline.
/// Two is what `small_dispatch` chose for the same trade, and what `HotSpot`'s
/// bimorphic inline cache holds.
pub(super) const MAX_TESTED: usize = 2;

/// The most classes a join keeps before it gives up on the set.
const JOIN_LIMIT: usize = 8;

/// What a value can be, as a class.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Classes {
    /// Exactly these, sorted and without repeats. Empty is nothing yet: a
    /// source that holds no object (a null) or a join no edge has reached.
    Exactly(Vec<TypeId>),
    /// Something this cannot see contributes.
    Any,
}

impl Classes {
    fn one(class: TypeId) -> Self {
        Self::Exactly(vec![class])
    }

    fn join(self, other: Self) -> Self {
        match (self, other) {
            (Self::Exactly(mut mine), Self::Exactly(theirs)) => {
                mine.extend(theirs);
                mine.sort_unstable();
                mine.dedup();
                if mine.len() > JOIN_LIMIT {
                    Self::Any
                } else {
                    Self::Exactly(mine)
                }
            }
            _ => Self::Any,
        }
    }
}

/// The program's facts this asks, built once.
struct Facts<'p> {
    program: &'p Program,
    by_name: FxHashMap<&'p str, usize>,
    /// Every direct call to a function, as `(caller, call)`.
    callers: FxHashMap<&'p str, Vec<(usize, ValueId)>>,
    /// Functions something other than a direct call can enter: roots, the
    /// runtime's callbacks, every table row, a closure body's receiving entry,
    /// a generator's entries. The roots and callbacks are the interprocedural
    /// analysis's own wall (`interprocedural::analyze_assuming`), so an
    /// export the product does not publish is not one here either.
    open: FxHashSet<&'p str>,
    /// Per function: which block and position defines each block parameter,
    /// and which values are placed in a block at all.
    shapes: Vec<Shape>,
    memo: FxHashMap<(usize, ValueId), Classes>,
    visiting: FxHashSet<(usize, ValueId)>,
    /// How many times a value on the stack has stood in as empty. An answer
    /// computed without one is final and kept; one computed with one may be
    /// missing what that value contributes, and is asked again.
    cycles: usize,
}

struct Shape {
    owner: FxHashMap<ValueId, (usize, usize)>,
    placed: FxHashSet<ValueId>,
    /// Every edge into each block: the arguments it carries.
    incoming: Vec<Vec<Vec<ValueId>>>,
}

impl Shape {
    fn of(func: &Func) -> Self {
        let mut owner = FxHashMap::default();
        let mut placed = FxHashSet::default();
        let mut incoming = vec![Vec::new(); func.blocks.len()];
        for (at, block) in func.blocks.iter().enumerate() {
            for (position, param) in block.params.iter().enumerate() {
                owner.insert(*param, (at, position));
            }
            placed.extend(block.ops.iter().copied());
            match &block.terminator {
                Terminator::Jump { target, args } => {
                    if let Some(edges) = incoming.get_mut(target.0 as usize) {
                        edges.push(args.clone());
                    }
                }
                Terminator::Branch {
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                    ..
                } => {
                    if let Some(edges) = incoming.get_mut(then_target.0 as usize) {
                        edges.push(then_args.clone());
                    }
                    if let Some(edges) = incoming.get_mut(else_target.0 as usize) {
                        edges.push(else_args.clone());
                    }
                }
                _ => {}
            }
        }
        Self {
            owner,
            placed,
            incoming,
        }
    }
}

impl<'p> Facts<'p> {
    fn build(program: &'p Program, roots: super::reachable::Roots<'_>) -> Self {
        let by_name = program
            .funcs
            .iter()
            .enumerate()
            .map(|(at, func)| (func.name.as_str(), at))
            .collect();
        let shapes: Vec<Shape> = program.funcs.iter().map(Shape::of).collect();
        let mut callers: FxHashMap<&str, Vec<(usize, ValueId)>> = FxHashMap::default();
        for (at, func) in program.funcs.iter().enumerate() {
            for &id in &shapes[at].placed {
                if let OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } = &func.value(id).kind
                {
                    callers.entry(name.as_str()).or_default().push((at, id));
                }
            }
        }
        let mut open: FxHashSet<&str> = super::reachable::root_names(program, roots)
            .into_iter()
            .chain(super::reachable::callback_names(program))
            .collect();
        for layout in &program.layouts {
            open.extend(layout.methods.iter().flatten().map(String::as_str));
        }
        for (written, body) in &program.receiving {
            open.insert(written.as_str());
            open.insert(body.as_str());
        }
        for generator in &program.generators {
            open.insert(generator.constructor.as_str());
            open.insert(generator.resume.as_str());
        }
        // A printer the runtime reads off a descriptor (`String(o)`), entered
        // with whatever object it was asked to print.
        let printed = program.printed.values().chain(
            program
                .printed_classes
                .values()
                .flat_map(std::collections::BTreeMap::values),
        );
        for how in printed {
            if let super::Printed::By(name) = how {
                open.insert(name.as_str());
            }
        }
        Self {
            program,
            by_name,
            callers,
            open,
            shapes,
            memo: FxHashMap::default(),
            visiting: FxHashSet::default(),
            cycles: 0,
        }
    }

    /// The classes `value` in function `at` can hold.
    fn classes(&mut self, at: usize, value: ValueId) -> Classes {
        if let Some(known) = self.memo.get(&(at, value)) {
            return known.clone();
        }
        // A cycle -- a loop's block parameter fed by itself, a recursion
        // handing its parameter on -- contributes nothing new on the way
        // round: the join over the other sources is the answer, which is the
        // least fixpoint a single pass reaches for these monotone joins.
        if !self.visiting.insert((at, value)) {
            self.cycles += 1;
            return Classes::Exactly(Vec::new());
        }
        let before = self.cycles;
        let answer = self.compute(at, value);
        self.visiting.remove(&(at, value));
        if self.cycles == before || self.visiting.is_empty() {
            self.memo.insert((at, value), answer.clone());
        }
        answer
    }

    fn compute(&mut self, at: usize, value: ValueId) -> Classes {
        let program = self.program;
        let func = &program.funcs[at];
        let op = func.value(value);
        match &op.kind {
            OpKind::ObjectNew { .. } | OpKind::ClosureStatic => match op.ty {
                HirType::Managed(ManagedType::Object(class)) => Classes::one(class),
                _ => Classes::Any,
            },
            OpKind::ConstNull | OpKind::ConstUndefined => Classes::Exactly(Vec::new()),
            OpKind::Unerase { value: inner } => match func.value(*inner).kind {
                OpKind::Erase { value: source, .. } => self.classes(at, source),
                _ => Classes::Any,
            },
            OpKind::Erase { value: source, .. } => self.classes(at, *source),
            OpKind::BlockParam(_) => {
                let Some(&(block, position)) = self.shapes[at].owner.get(&value) else {
                    return Classes::Any;
                };
                let edges: Vec<ValueId> = self.shapes[at].incoming[block]
                    .iter()
                    .filter_map(|args| args.get(position).copied())
                    .collect();
                if edges.len() != self.shapes[at].incoming[block].len() {
                    return Classes::Any;
                }
                let mut joined = Classes::Exactly(Vec::new());
                for edge in edges {
                    joined = joined.join(self.classes(at, edge));
                    if joined == Classes::Any {
                        break;
                    }
                }
                joined
            }
            OpKind::Param(slot) => self.parameter(at, *slot),
            OpKind::ArrayGet { array, .. } => self.elements(at, *array),
            _ => Classes::Any,
        }
    }

    /// What every caller passes for a parameter, where every caller is a
    /// direct call this program makes.
    fn parameter(&mut self, at: usize, slot: u32) -> Classes {
        let name = self.program.funcs[at].name.as_str();
        if self.open.contains(name) {
            return Classes::Any;
        }
        let Some(sites) = self.callers.get(name).cloned() else {
            // Nothing calls it: nothing reaches the parameter.
            return Classes::Exactly(Vec::new());
        };
        let mut joined = Classes::Exactly(Vec::new());
        for (caller, call) in sites {
            let OpKind::Call { args, .. } = &self.program.funcs[caller].value(call).kind else {
                return Classes::Any;
            };
            let Some(&arg) = args.get(slot as usize) else {
                return Classes::Any;
            };
            joined = joined.join(self.classes(caller, arg));
            if joined == Classes::Any {
                break;
            }
        }
        joined
    }

    /// What an array read can produce, where the array is one this function
    /// allocated and nothing but its own reads and writes ever touch.
    ///
    /// A local literal is the shape: `const listeners = [a, b]`, read in a
    /// loop. Any other use -- an argument, a store, an edge, a return, an
    /// erasure -- is somewhere a write could come from, and the answer is
    /// `Any`.
    fn elements(&mut self, at: usize, array: ValueId) -> Classes {
        let func = &self.program.funcs[at];
        if !matches!(func.value(array).kind, OpKind::ArrayNew { .. }) {
            return Classes::Any;
        }
        let mut stored = Vec::new();
        for &id in &self.shapes[at].placed {
            let op = func.value(id);
            let reads = super::verify::operands(&op.kind);
            if !reads.contains(&array) {
                continue;
            }
            match &op.kind {
                OpKind::ArrayGet { array: of, .. } | OpKind::Length(of) if *of == array => {}
                OpKind::ArraySet {
                    array: of,
                    value,
                    index,
                    ..
                } if *of == array && *value != array && *index != array => stored.push(*value),
                OpKind::Retain(_) | OpKind::Release(_) => {}
                _ => return Classes::Any,
            }
        }
        for block in &func.blocks {
            if super::verify::terminator_operands(&block.terminator).contains(&array) {
                return Classes::Any;
            }
        }
        let mut joined = Classes::Exactly(Vec::new());
        for value in stored {
            joined = joined.join(self.classes(at, value));
            if joined == Classes::Any {
                break;
            }
        }
        joined
    }

    /// How many bases stand above a class: a subclass is deeper than its base.
    fn depth(&self, class: TypeId) -> usize {
        let layouts = &self.program.layouts;
        let of = |ty: TypeId| layouts.iter().find(|layout| layout.types.contains(&ty));
        let mut depth = 0;
        let mut at = of(class);
        // Bounded: a chain of bases is as long as a class hierarchy.
        while let Some(base) = at.and_then(|layout| layout.base).filter(|_| depth < 64) {
            depth += 1;
            at = of(base);
        }
        depth
    }

    /// The function a class's row in `slot` names, where the program has it.
    fn row(&self, class: TypeId, slot: u32) -> Option<&'p str> {
        let program = self.program;
        let layout = program
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&class))?;
        let name = layout.methods.get(slot as usize)?.as_deref()?;
        self.by_name.contains_key(name).then_some(name)
    }
}

/// One call this rewrites: where it is and what each arm calls.
struct Site {
    func: usize,
    call: ValueId,
    /// The class each arm tests for, and for a `Virtual` call the row it names
    /// directly. A closure call keeps its callee: its arm's receiver is read
    /// back at the class, and `fields::devirtualize` takes it from there.
    arms: Vec<(TypeId, Option<String>)>,
}

/// Rewrite every call whose receiver's classes are few and all known. Returns
/// how many.
pub(super) fn guard_calls(program: &mut Program, roots: super::reachable::Roots<'_>) -> usize {
    let sites = {
        let mut facts = Facts::build(program, roots);
        let mut sites = Vec::new();
        for at in 0..program.funcs.len() {
            let placed: Vec<ValueId> = {
                let mut placed: Vec<ValueId> = facts.shapes[at].placed.iter().copied().collect();
                placed.sort_unstable();
                placed
            };
            for call in placed {
                let op = program.funcs[at].value(call);
                let (slot, is_virtual) = match &op.kind {
                    OpKind::Call {
                        callee: Callee::Closure { slot },
                        ..
                    } => (*slot, false),
                    OpKind::Call {
                        callee: Callee::Virtual { slot, .. },
                        ..
                    } => (*slot, true),
                    _ => continue,
                };
                let OpKind::Call { args, .. } = &op.kind else {
                    continue;
                };
                let Some(&receiver) = args.first() else {
                    continue;
                };
                let Classes::Exactly(mut classes) = facts.classes(at, receiver) else {
                    continue;
                };
                if classes.is_empty() || classes.len() > MAX_TESTED {
                    continue;
                }
                // A subclass before its base. `InstanceOf` admits a class's
                // descendants (its own doc), so a `Rect` tested as a `Square`
                // first would take `Square`'s row.
                classes.sort_by_key(|class| std::cmp::Reverse(facts.depth(*class)));
                let mut arms = Vec::new();
                for class in classes {
                    if is_virtual {
                        let Some(row) = facts.row(class, slot) else {
                            arms.clear();
                            break;
                        };
                        if !agrees(program, &program.funcs[at], op, row) {
                            arms.clear();
                            break;
                        }
                        arms.push((class, Some(row.to_owned())));
                    } else {
                        // A closure class's row must exist for the dispatch to
                        // land anywhere; `fields::devirtualize` picks the entry.
                        if !super::has_a_closure_body(class) || facts.row(class, slot).is_none() {
                            arms.clear();
                            break;
                        }
                        arms.push((class, None));
                    }
                }
                if arms.is_empty() {
                    continue;
                }
                sites.push(Site {
                    func: at,
                    call,
                    arms,
                });
            }
        }
        sites
    };
    for site in &sites {
        rewrite(&mut program.funcs[site.func], site);
    }
    sites.len()
}

/// Whether a row takes the call's arguments and answers its type, so a direct
/// call to it is the call the table would have made.
fn agrees(program: &Program, func: &Func, op: &Op, row: &str) -> bool {
    let OpKind::Call { args, .. } = &op.kind else {
        return false;
    };
    program
        .funcs
        .iter()
        .find(|callee| callee.name == row)
        .is_some_and(|callee| {
            callee.return_type == op.ty
                && callee.params.len() == args.len()
                && callee
                    .params
                    .iter()
                    .zip(args)
                    .skip(1)
                    .all(|(param, arg)| param.ty == func.value(*arg).ty)
        })
}

fn append(func: &mut Func, op: Op) -> ValueId {
    let new = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(op);
    new
}

fn block_id(at: usize) -> BlockId {
    BlockId(u32::try_from(at).unwrap_or(u32::MAX))
}

/// Replace the call with a test per class, each arm calling at that class, and
/// a refusal for a receiver that is none of them.
fn rewrite(func: &mut Func, site: &Site) {
    let Some((at, position)) = func.blocks.iter().enumerate().find_map(|(at, block)| {
        block
            .ops
            .iter()
            .position(|op| *op == site.call)
            .map(|position| (at, position))
    }) else {
        return;
    };
    let call = func.values[site.call.0 as usize].clone();
    let OpKind::Call {
        callee,
        args,
        frame,
        ..
    } = &call.kind
    else {
        return;
    };
    let answers = !matches!(call.ty, HirType::Void | HirType::Never);
    let origin = call.origin.clone();

    // The join holds what followed the call; where the call answered, its
    // value becomes the join's parameter, so every read of it stays as it was.
    let join = block_id(func.blocks.len());
    let after = func.blocks[at].ops.split_off(position + 1);
    func.blocks[at].ops.pop();
    let terminator = std::mem::replace(&mut func.blocks[at].terminator, Terminator::Unreachable);
    func.blocks.push(Block {
        params: if answers { vec![site.call] } else { Vec::new() },
        ops: after,
        terminator,
    });
    if answers {
        func.values[site.call.0 as usize].kind = OpKind::BlockParam(0);
    }
    // Erased once, as the lowering spells a class test and the narrowing it
    // licenses (`x instanceof C`): every backend reads that pair as one test
    // and one cast, and the Wasm backend folds the cast into the test
    // (`guarded_casts`).
    let erased = append(
        func,
        Op {
            kind: OpKind::Erase {
                value: args[0],
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            ty: HirType::Erased,
            origin: origin.clone(),
        },
    );
    func.blocks[at].ops.push(erased);

    let guard = Guard {
        erased,
        args,
        callee,
        frame: *frame,
        ty: &call.ty,
        origin: &origin,
        join,
        answers,
    };
    let mut testing = at;
    for (class, row) in &site.arms {
        testing = push_arm(func, &guard, testing, *class, row.as_deref());
    }
    push_refusal(func, testing, origin.clone());
}

/// What every arm of one rewritten call shares.
struct Guard<'a> {
    /// The receiver, erased once for every class test.
    erased: ValueId,
    args: &'a [ValueId],
    callee: &'a Callee,
    frame: Option<u32>,
    ty: &'a HirType,
    origin: &'a super::Origin,
    join: BlockId,
    /// Whether the call answers a value the join receives.
    answers: bool,
}

/// One class's test in block `testing`, and its arm: the receiver read back
/// at the class, then the call at that class -- direct where `row` names the
/// class's body. Returns the block the next test goes in.
fn push_arm(
    func: &mut Func,
    guard: &Guard<'_>,
    testing: usize,
    class: TypeId,
    row: Option<&str>,
) -> usize {
    let origin = guard.origin;
    let test = append(
        func,
        Op {
            kind: OpKind::InstanceOf {
                value: guard.erased,
                classes: vec![class],
                by_layout: false,
            },
            ty: HirType::Bool,
            origin: origin.clone(),
        },
    );
    func.blocks[testing].ops.push(test);
    let arm = block_id(func.blocks.len());
    let next = block_id(func.blocks.len() + 1);
    func.blocks[testing].terminator = Terminator::Branch {
        cond: test,
        then_target: arm,
        then_args: Vec::new(),
        else_target: next,
        else_args: Vec::new(),
    };
    // The receiver read back at the class the test just licensed.
    let narrowed = append(
        func,
        Op {
            kind: OpKind::Unerase {
                value: guard.erased,
            },
            ty: HirType::Managed(ManagedType::Object(class)),
            origin: origin.clone(),
        },
    );
    let mut passed = guard.args.to_vec();
    passed[0] = narrowed;
    let callee = row.map_or_else(
        || guard.callee.clone(),
        |row| Callee::Direct(row.to_owned()),
    );
    let result = append(
        func,
        Op {
            kind: OpKind::Call {
                callee,
                args: passed,
                frame: guard.frame,
            },
            ty: guard.ty.clone(),
            origin: origin.clone(),
        },
    );
    func.blocks.push(Block {
        params: Vec::new(),
        ops: vec![narrowed, result],
        terminator: Terminator::Jump {
            target: guard.join,
            args: if guard.answers {
                vec![result]
            } else {
                Vec::new()
            },
        },
    });
    func.blocks.push(Block {
        params: Vec::new(),
        ops: Vec::new(),
        terminator: Terminator::Unreachable,
    });
    next.0 as usize
}

/// What block `testing` does for a receiver that is none of the classes: by
/// the join, only one that holds no object.
fn push_refusal(func: &mut Func, testing: usize, origin: super::Origin) {
    let message = append(
        func,
        Op {
            kind: OpKind::ConstString(
                "calling a value that is none of the classes the program gives it".to_owned(),
            ),
            ty: HirType::Managed(ManagedType::String),
            origin: origin.clone(),
        },
    );
    let refused = append(
        func,
        Op {
            kind: OpKind::Call {
                callee: Callee::External("nts_refused".to_owned()),
                args: vec![message],
                frame: None,
            },
            ty: HirType::Void,
            origin,
        },
    );
    func.blocks[testing].ops.extend([message, refused]);
    func.blocks[testing].terminator = Terminator::Unreachable;
}
