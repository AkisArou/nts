//! The fields of an object that never leaves its function, as values.
//!
//! # Why
//!
//! `benchmarks/cases/user-iterable` walks a hand-written iterator: `Series`
//! makes a `Steps`, and `Steps#next` answers `{ value, done }` every step. All
//! of it is inlined and frame-placed, so nothing is allocated -- and the row
//! still ran at 21.8x its C++, because `Steps.at` is a `double` *field*. The
//! range analysis cannot see through a field, so `at` was never known to be a
//! whole number in `int32`, `seed * 31 + at` was floating-point, and its `| 0`
//! took `nts_to_int32`'s out-of-range path on most steps. clang does turn the
//! frame struct into registers, but it cannot turn a `double`'s arithmetic into
//! an integer's: that is a fact about values, and only `flow` has it.
//!
//! So an object whose every use is a read or a write of one of its own fields
//! -- or a call to a constructor that does nothing but store into them -- is
//! not an object at all: each field is a variable, and the reads are whatever
//! the last write on the way there left. After this, `at` is a block parameter
//! like any loop counter, and `flow` and `specialize` treat it as one.
//!
//! # What is replaced
//!
//! An `object.new` whose layout's fields are numbers, integers, booleans,
//! references or erased values ([`takeable`]) and whose every use in its
//! function is
//!
//! - `field.get` of it, or `field.set` into it of something that is not it;
//! - a direct call of a constructor whose whole body stores its arguments and
//!   constants into its receiver's fields ([`only_stores`]), with the object as
//!   the receiver and nowhere else among the arguments.
//!
//! Anything else -- a call that takes it, a store of it, a comparison by
//! identity, `instanceof`, an `erase`, a block argument, a `return` -- keeps
//! it an object.
//!
//! Fields start as the zero of their type ([`super::zero_of`]: `null` for a
//! reference, `undefined` for an erased value), which is what every backend
//! writes into a new object, and a read before any write answers that.
//!
//! # A field that holds a reference
//!
//! Was left out at first, on the worry that its value would carry a count the
//! object used to own. It does not: this runs long before `rc::insert`, so no
//! count exists yet, and what the program is left with is a reference flowing
//! through block parameters -- which counting places like any other, the way it
//! does for a string carried round a loop. The object owned nothing at this
//! point; only the counting pass, later, would have made it.
//!
//! `benchmarks/cases/optional-chain` wants it, and wants something more:
//! `const h: Held = {}`, a function stored into `h.fn` on one arm, and
//! `h.fn?.(…)` after the join. The field is erased, which kept the object, and
//! the call hands `h` over as its `this`, which still does -- until a direct
//! call to a callee that never reads `this` lets it go. Each is half of the
//! heap allocation per iteration that made that row 12x C's time on Wasm.
//!
//! `BigInt` is not taken: `zero_of` has no zero for it.
//!
//! # How
//!
//! Standard SSA construction over the blocks the allocation dominates, in
//! reverse postorder: a block with one predecessor starts with what its
//! predecessor ended with, a join gets a parameter per field and every edge into
//! it passes what its source ended with. A parameter that only ever receives
//! one value besides itself is that value, and goes.
use rustc_hash::{FxHashMap, FxHashSet};

use super::fields::LayoutIndex;
use super::{BlockId, Callee, Func, HirType, Op, OpKind, Program, Terminator, ValueId};

/// Replace every object [`scalarize`] can by its fields, and say how many.
pub fn scalarize(program: &mut Program) -> usize {
    let layouts = LayoutIndex::build(program);
    let constructors: FxHashMap<String, Vec<(u32, Stored)>> = program
        .funcs
        .iter()
        .filter_map(|func| only_stores(func).map(|stores| (func.name.clone(), stores)))
        .collect();
    let takeable = scalar_types(program, &layouts);
    let mut replaced = 0;
    for index in 0..program.funcs.len() {
        forward_taken_objects(program, index, &takeable, &layouts, &constructors);
        let found = candidates(&program.funcs[index], program, &layouts, &constructors);
        for (object, layout) in found {
            let fields: Vec<HirType> = program.layouts[layout]
                .fields
                .iter()
                .map(|field| field.ty.clone())
                .collect();
            replace(&mut program.funcs[index], object, &fields, &constructors);
            replaced += 1;
        }
    }
    replaced
}

/// The types whose layouts are all scalars: what [`candidates`] can take.
fn scalar_types(program: &Program, layouts: &LayoutIndex) -> FxHashSet<HirType> {
    program
        .funcs
        .iter()
        .flat_map(|func| func.values.iter())
        .filter(|op| matches!(op.kind, OpKind::ObjectNew { .. }))
        .map(|op| op.ty.clone())
        .filter(|ty| {
            layouts.of(ty).is_some_and(|layout| {
                program.layouts[layout]
                    .fields
                    .iter()
                    .all(|field| takeable(&field.ty))
            })
        })
        .collect()
}

/// Forward the block parameters of function `index` that [`candidates`] then
/// takes apart, and no others.
///
/// **A forwarding pays only where its object is replaced.** One that is not
/// leaves the object as it was, but used across the join its parameter used to
/// carry it over, and reference counting places a retain before the join and a
/// release after it -- every iteration, where the join is a loop's. `Link` in
/// a list built by `tail.next = made` escapes through `next`: when forwarding
/// widened with the fields it can take (2026-10-22), `tests/memory/borrowed-call`
/// and `traversal` went from 33 counting operations to 97, and `local-anchor`,
/// `loop-break` and `shared-tail` rose 32 each. So the forwarding is tried on a
/// copy, and kept for exactly the objects the copy's candidates include.
fn forward_taken_objects(
    program: &mut Program,
    index: usize,
    takeable: &FxHashSet<HirType>,
    layouts: &LayoutIndex,
    constructors: &FxHashMap<String, Vec<(u32, Stored)>>,
) {
    let mut trial = program.funcs[index].clone();
    let forwarded = forward_new_objects(&mut trial, takeable, |_| true);
    if forwarded.is_empty() {
        return;
    }
    let taken: FxHashSet<ValueId> = candidates(&trial, program, layouts, constructors)
        .into_iter()
        .map(|(object, _)| object)
        .filter(|object| forwarded.contains(object))
        .collect();
    if taken.len() == forwarded.len() {
        program.funcs[index] = trial;
    } else if !taken.is_empty() {
        forward_new_objects(&mut program.funcs[index], takeable, |object| {
            taken.contains(&object)
        });
    }
}

/// Forward a block parameter that only ever receives one new object, where
/// `wanted` says yes to that object, and say which objects it forwarded.
///
/// An inlined body hands back what it made through the block its `return`s
/// join at -- `jump b5(%20)`, every time and from one place -- so the object
/// reaches the caller's uses as a parameter, which [`candidates`] reads as the
/// object leaving. A parameter whose every incoming argument is the same value
/// is that value under another name. Only for a new object of a type this can
/// take apart: renaming nothing else.
fn forward_new_objects(
    func: &mut Func,
    takeable: &FxHashSet<HirType>,
    wanted: impl Fn(ValueId) -> bool,
) -> FxHashSet<ValueId> {
    let mut forwarded = FxHashSet::default();
    loop {
        let mut found: Option<(BlockId, usize, ValueId, ValueId)> = None;
        'search: for (at, block) in func.blocks.iter().enumerate() {
            let target = BlockId(u32::try_from(at).unwrap_or(0));
            for (index, param) in block.params.iter().enumerate() {
                if !takeable.contains(&func.values[param.0 as usize].ty) {
                    continue;
                }
                let incoming = incoming_args(func, target, index);
                let Some(&first) = incoming.first() else {
                    continue;
                };
                if first != *param
                    && incoming.iter().all(|value| *value == first)
                    && matches!(func.values[first.0 as usize].kind, OpKind::ObjectNew { .. })
                    && func.values[first.0 as usize].ty == func.values[param.0 as usize].ty
                    && wanted(first)
                {
                    found = Some((target, index, *param, first));
                    break 'search;
                }
            }
        }
        let Some((block, index, param, value)) = found else {
            return forwarded;
        };
        forwarded.insert(value);
        remove_param(func, block, index);
        let mut map = FxHashMap::default();
        map.insert(param, value);
        substitute_all(func, &map);
    }
}

/// What a constructor stores into one field.
#[derive(Debug, Clone)]
enum Stored {
    /// The call's argument at this position.
    Argument(usize),
    /// A constant, as its op and type.
    Constant(OpKind, HirType),
}

/// The stores a function's whole body makes into its receiver's fields, where
/// that is all it does: one block, its parameters and scalar constants, stores
/// of either into the receiver, and a bare `return`.
fn only_stores(func: &Func) -> Option<Vec<(u32, Stored)>> {
    let [block] = func.blocks.as_slice() else {
        return None;
    };
    if !matches!(block.terminator, Terminator::Return(None)) {
        return None;
    }
    let receiver = *block
        .ops
        .iter()
        .find(|op| matches!(func.values[op.0 as usize].kind, OpKind::Param(0)))?;
    let mut stores = Vec::new();
    for op in &block.ops {
        match &func.values[op.0 as usize].kind {
            OpKind::Param(_)
            | OpKind::ConstFloat(_)
            | OpKind::ConstInt(_)
            | OpKind::ConstBool(_) => {}
            OpKind::FieldSet {
                object,
                field,
                value,
            } if *object == receiver => {
                let source = match &func.values[value.0 as usize].kind {
                    OpKind::Param(at) if *at > 0 => Stored::Argument(*at as usize),
                    kind @ (OpKind::ConstFloat(_) | OpKind::ConstInt(_) | OpKind::ConstBool(_)) => {
                        Stored::Constant(kind.clone(), func.values[value.0 as usize].ty.clone())
                    }
                    _ => return None,
                };
                stores.push((*field, source));
            }
            _ => return None,
        }
    }
    Some(stores)
}

/// A field type whose value can stand for the field: a scalar, a reference, or
/// an erased value. Each has a zero ([`super::zero_of`]) equal to what every
/// backend writes into a new object.
fn takeable(ty: &HirType) -> bool {
    matches!(
        ty,
        HirType::Float { .. }
            | HirType::Int { .. }
            | HirType::Bool
            | HirType::Managed(_)
            | HirType::Erased
    )
}

/// The objects in `func` this replaces, with their layouts.
fn candidates(
    func: &Func,
    program: &Program,
    layouts: &LayoutIndex,
    constructors: &FxHashMap<String, Vec<(u32, Stored)>>,
) -> Vec<(ValueId, usize)> {
    let live: Vec<ValueId> = func
        .blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .collect();
    let reachable = super::verify::reachable_blocks(func);
    // Uses in a block nothing reaches are not walked, so an object one of
    // them names is left alone rather than left half replaced.
    let unreached: Vec<ValueId> = func
        .blocks
        .iter()
        .enumerate()
        .filter(|(at, _)| !reachable.contains(&BlockId(u32::try_from(*at).unwrap_or(0))))
        .flat_map(|(_, block)| block.ops.iter().copied())
        .collect();
    let mut found = Vec::new();
    for &object in &live {
        let op = &func.values[object.0 as usize];
        if !matches!(op.kind, OpKind::ObjectNew { .. }) {
            continue;
        }
        let Some(layout) = layouts.of(&op.ty) else {
            continue;
        };
        if !program.layouts[layout]
            .fields
            .iter()
            .all(|field| takeable(&field.ty))
        {
            continue;
        }
        let returned = func
            .blocks
            .iter()
            .any(|block| block.terminator == Terminator::Return(Some(object)));
        if returned || super::carried_by_an_edge(func, object) {
            continue;
        }
        if unreached
            .iter()
            .any(|op| super::operands_of(&func.values[op.0 as usize].kind).contains(&object))
        {
            continue;
        }
        let fields = &program.layouts[layout].fields;
        if live.iter().all(|op| {
            let kind = &func.values[op.0 as usize].kind;
            only_its_fields(object, kind, constructors)
                && arguments_fit(func, object, kind, fields, constructors)
        }) {
            found.push((object, layout));
        }
    }
    found
}

/// Whether a constructor call's stored arguments can become its fields.
///
/// An argument whose type differs from its field's is converted, and only a
/// number to a number is a `convert`: an `i32` into a `double` field. A
/// reference arriving as another reference type, or a value as an erased one,
/// would need an `erase` or an `unerase`, and the object is left alone rather
/// than given the wrong one.
fn arguments_fit(
    func: &Func,
    object: ValueId,
    kind: &OpKind,
    fields: &[super::Field],
    constructors: &FxHashMap<String, Vec<(u32, Stored)>>,
) -> bool {
    let OpKind::Call {
        callee: Callee::Direct(name),
        args,
        ..
    } = kind
    else {
        return true;
    };
    if args.first() != Some(&object) {
        return true;
    }
    let Some(stores) = constructors.get(name) else {
        return true;
    };
    let numeric = |ty: &HirType| matches!(ty, HirType::Float { .. } | HirType::Int { .. });
    stores.iter().all(|(field, stored)| {
        let Stored::Argument(at) = stored else {
            return true;
        };
        let (Some(arg), Some(field)) = (args.get(*at), fields.get(*field as usize)) else {
            return false;
        };
        let given = &func.values[arg.0 as usize].ty;
        *given == field.ty || (numeric(given) && numeric(&field.ty))
    })
}

/// Whether one operation uses `object` only as the object whose fields it
/// reads or writes.
fn only_its_fields(
    object: ValueId,
    kind: &OpKind,
    constructors: &FxHashMap<String, Vec<(u32, Stored)>>,
) -> bool {
    if !super::operands_of(kind).contains(&object) {
        return true;
    }
    match kind {
        OpKind::FieldGet { object: of, .. } => *of == object,
        OpKind::FieldSet {
            object: into,
            value,
            ..
        } => *into == object && *value != object,
        OpKind::Call {
            callee: Callee::Direct(name),
            args,
            ..
        } => {
            constructors.contains_key(name)
                && args.first() == Some(&object)
                && !args[1..].contains(&object)
        }
        _ => false,
    }
}

fn push_value(func: &mut Func, op: Op) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(op);
    id
}

fn dominated(idom: &[Option<BlockId>], over: BlockId, under: BlockId) -> bool {
    let mut at = Some(under);
    while let Some(block) = at {
        if block == over {
            return true;
        }
        at = idom[block.0 as usize];
    }
    false
}

/// Replace `object` by one value per field. See the module comment.
fn replace(
    func: &mut Func,
    object: ValueId,
    fields: &[HirType],
    constructors: &FxHashMap<String, Vec<(u32, Stored)>>,
) {
    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    let order = super::verify::reverse_postorder(func);
    let Some(home) = func
        .blocks
        .iter()
        .position(|block| block.ops.contains(&object))
        .map(|at| BlockId(u32::try_from(at).unwrap_or(0)))
    else {
        return;
    };
    let mut predecessors: Vec<Vec<BlockId>> = vec![Vec::new(); func.blocks.len()];
    for (at, block) in func.blocks.iter().enumerate() {
        for successor in block.terminator.successors() {
            predecessors[successor.0 as usize].push(BlockId(u32::try_from(at).unwrap_or(0)));
        }
    }
    let taking = Taking {
        object,
        fields,
        constructors,
        origin: func.values[object.0 as usize].origin.clone(),
    };

    // Each block the allocation dominates, other than its own, starts either
    // with its one predecessor's values or with parameters of its own.
    let mut joins: FxHashMap<BlockId, Vec<ValueId>> = FxHashMap::default();
    for &block in &order {
        if block != home
            && dominated(&idom, home, block)
            && predecessors[block.0 as usize].len() >= 2
        {
            joins.insert(block, taking.add_params(func, block));
        }
    }

    let mut ends: FxHashMap<BlockId, Vec<ValueId>> = FxHashMap::default();
    let mut read: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for &block in &order {
        if !dominated(&idom, home, block) {
            continue;
        }
        let start = if block == home {
            None
        } else if let Some(params) = joins.get(&block) {
            Some(params.clone())
        } else {
            predecessors[block.0 as usize]
                .first()
                .and_then(|from| ends.get(from))
                .cloned()
        };
        if let Some(end) = taking.walk(func, block, start, &mut read) {
            ends.insert(block, end);
        }
    }

    taking.pass_to_joins(func, &ends, &joins);
    substitute_all(func, &read);
    drop_trivial(func, &joins);
}

/// What one replacement carries through its steps.
struct Taking<'a> {
    object: ValueId,
    fields: &'a [HirType],
    constructors: &'a FxHashMap<String, Vec<(u32, Stored)>>,
    origin: super::Origin,
}

impl Taking<'_> {
    fn value(&self, func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
        push_value(
            func,
            Op {
                kind,
                ty,
                origin: self.origin.clone(),
            },
        )
    }

    /// A parameter per field at a join.
    fn add_params(&self, func: &mut Func, block: BlockId) -> Vec<ValueId> {
        self.fields
            .iter()
            .map(|ty| {
                let index = func.blocks[block.0 as usize].params.len();
                let kind = OpKind::BlockParam(u32::try_from(index).unwrap_or(0));
                let id = self.value(func, kind, ty.clone());
                func.blocks[block.0 as usize].params.push(id);
                id
            })
            .collect()
    }

    /// The fields' zeros, made at the end of `block`'s operations so far.
    fn zeros(&self, func: &mut Func, kept: &mut Vec<ValueId>) -> Vec<ValueId> {
        self.fields
            .iter()
            .map(|ty| {
                let id = self.value(func, super::zero_of(ty), ty.clone());
                kept.push(id);
                id
            })
            .collect()
    }

    /// Walk one block from the field values it starts with, taking the
    /// object's operations out, and answer what it ends with. Each read is
    /// recorded in `read` as the value it stands for.
    fn walk(
        &self,
        func: &mut Func,
        block: BlockId,
        mut current: Option<Vec<ValueId>>,
        read: &mut FxHashMap<ValueId, ValueId>,
    ) -> Option<Vec<ValueId>> {
        let ops = std::mem::take(&mut func.blocks[block.0 as usize].ops);
        let mut kept = Vec::with_capacity(ops.len());
        for op in ops {
            match func.values[op.0 as usize].kind.clone() {
                OpKind::ObjectNew { .. } if op == self.object => {
                    current = Some(self.zeros(func, &mut kept));
                }
                OpKind::FieldSet {
                    object,
                    field,
                    value,
                } if object == self.object => {
                    if let Some(values) = current.as_mut() {
                        values[field as usize] = value;
                    }
                }
                OpKind::FieldGet { object, field } if object == self.object => {
                    if let Some(values) = current.as_ref() {
                        read.insert(op, values[field as usize]);
                    }
                }
                OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                    ..
                } if args.first() == Some(&self.object) => {
                    let stores = self.constructors.get(&name).cloned().unwrap_or_default();
                    for (field, source) in stores {
                        let value = self.stored(func, &mut kept, &args, field, source);
                        if let Some(values) = current.as_mut() {
                            values[field as usize] = value;
                        }
                    }
                }
                _ => kept.push(op),
            }
        }
        func.blocks[block.0 as usize].ops = kept;
        current
    }

    /// The value a constructor's store puts in `field`, as the field holds
    /// it: a call may pass an `i32` where the parameter, and the field it is
    /// stored in, is a `double`.
    fn stored(
        &self,
        func: &mut Func,
        kept: &mut Vec<ValueId>,
        args: &[ValueId],
        field: u32,
        source: Stored,
    ) -> ValueId {
        let ty = self.fields[field as usize].clone();
        let id = match source {
            Stored::Argument(at) if func.values[args[at].0 as usize].ty == ty => return args[at],
            Stored::Argument(at) => self.value(func, OpKind::Convert(args[at]), ty),
            Stored::Constant(kind, written) => self.value(func, kind, written),
        };
        kept.push(id);
        id
    }

    /// Every edge into a join passes what its source ended with. A source
    /// nothing reaches has no values, and passes zeros: the verifier still
    /// counts its arguments.
    fn pass_to_joins(
        &self,
        func: &mut Func,
        ends: &FxHashMap<BlockId, Vec<ValueId>>,
        joins: &FxHashMap<BlockId, Vec<ValueId>>,
    ) {
        for at in 0..func.blocks.len() {
            let from = BlockId(u32::try_from(at).unwrap_or(0));
            let into_a_join = func.blocks[at]
                .terminator
                .successors()
                .iter()
                .any(|successor| joins.contains_key(successor));
            if !into_a_join {
                continue;
            }
            let values = if let Some(values) = ends.get(&from) {
                values.clone()
            } else {
                let mut kept = std::mem::take(&mut func.blocks[at].ops);
                let zeros = self.zeros(func, &mut kept);
                func.blocks[at].ops = kept;
                zeros
            };
            match &mut func.blocks[at].terminator {
                Terminator::Jump { target, args } if joins.contains_key(target) => {
                    args.extend(values.iter().copied());
                }
                Terminator::Branch {
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                    ..
                } => {
                    if joins.contains_key(then_target) {
                        then_args.extend(values.iter().copied());
                    }
                    if joins.contains_key(else_target) {
                        else_args.extend(values.iter().copied());
                    }
                }
                _ => {}
            }
        }
    }
}

/// Replace every use of each key by what it maps to, following chains.
fn substitute_all(func: &mut Func, map: &FxHashMap<ValueId, ValueId>) {
    if map.is_empty() {
        return;
    }
    let resolve = |value: ValueId| {
        let mut at = value;
        let mut steps = 0;
        while let Some(next) = map.get(&at) {
            at = *next;
            steps += 1;
            if steps > map.len() {
                break;
            }
        }
        at
    };
    let live: FxHashSet<ValueId> = func
        .blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .collect();
    for value in live {
        super::simplify::substitute(&mut func.values[value.0 as usize].kind, resolve);
    }
    for block in &mut func.blocks {
        super::simplify::substitute_terminator(&mut block.terminator, resolve);
    }
}

/// Remove the parameters this added that receive one value besides
/// themselves, until none is left.
fn drop_trivial(func: &mut Func, joins: &FxHashMap<BlockId, Vec<ValueId>>) {
    let mut ours: FxHashSet<ValueId> = joins.values().flatten().copied().collect();
    loop {
        let mut found: Option<(BlockId, usize, ValueId, ValueId)> = None;
        'search: for (at, block) in func.blocks.iter().enumerate() {
            let target = BlockId(u32::try_from(at).unwrap_or(0));
            for (index, param) in block.params.iter().enumerate() {
                if !ours.contains(param) {
                    continue;
                }
                let mut only: Option<ValueId> = None;
                let mut trivial = true;
                for incoming in incoming_args(func, target, index) {
                    if incoming == *param || Some(incoming) == only {
                        continue;
                    }
                    if only.is_some() {
                        trivial = false;
                        break;
                    }
                    only = Some(incoming);
                }
                if trivial && let Some(value) = only {
                    found = Some((target, index, *param, value));
                    break 'search;
                }
            }
        }
        let Some((block, index, param, value)) = found else {
            return;
        };
        ours.remove(&param);
        remove_param(func, block, index);
        let mut map = FxHashMap::default();
        map.insert(param, value);
        substitute_all(func, &map);
    }
}

/// What every edge into `block` passes to its parameter at `index`.
fn incoming_args(func: &Func, block: BlockId, index: usize) -> Vec<ValueId> {
    let mut found = Vec::new();
    for source in &func.blocks {
        match &source.terminator {
            Terminator::Jump { target, args } if *target == block => {
                found.extend(args.get(index).copied());
            }
            Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => {
                if *then_target == block {
                    found.extend(then_args.get(index).copied());
                }
                if *else_target == block {
                    found.extend(else_args.get(index).copied());
                }
            }
            _ => {}
        }
    }
    found
}

/// Take a block's parameter at `index` out of the block and out of every
/// edge into it, renumbering the parameters after it: a `BlockParam` carries
/// its own position, and the loop analysis reads it.
fn remove_param(func: &mut Func, block: BlockId, index: usize) {
    func.blocks[block.0 as usize].params.remove(index);
    let after: Vec<ValueId> = func.blocks[block.0 as usize].params[index..].to_vec();
    for param in after {
        if let OpKind::BlockParam(position) = &mut func.values[param.0 as usize].kind {
            *position -= 1;
        }
    }
    for source in &mut func.blocks {
        match &mut source.terminator {
            Terminator::Jump { target, args } if *target == block => {
                if index < args.len() {
                    args.remove(index);
                }
            }
            Terminator::Branch {
                then_target,
                then_args,
                else_target,
                else_args,
                ..
            } => {
                if *then_target == block && index < then_args.len() {
                    then_args.remove(index);
                }
                if *else_target == block && index < else_args.len() {
                    else_args.remove(index);
                }
            }
            _ => {}
        }
    }
}
