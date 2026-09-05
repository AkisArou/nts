//! Integer values and fields this target is better off holding as a `double`.
//!
//! Specialization narrows a counter to an `i32` because that is right for a
//! machine with integer registers. **This one has none.** A JVM local is a slot,
//! `dadd` and `iadd` cost the same, and the only thing an `i32` buys here is an
//! `i2d` at every use that wants a number -- which, in a loop whose bound and
//! whose product are both `double`, is every use.
//!
//! Priced by mutating the reference, one variable, checksums equal:
//!
//! ```text
//! double counter   172.2 us
//! int counter      587.3 us     3.41x
//! ```
//!
//! `generator` measured 588.73. The reference is not faster because it is Java;
//! it is faster because it never narrowed.
//!
//! # Why this spans the whole program
//!
//! A first attempt widened *locals* and moved two conversions in the entire
//! suite. The value being converted lives in a **field**: `upTo$frame.yielded`
//! is declared `I`, because a generator's state survives its suspension. An
//! analysis over locals cannot reach a field however carefully it is written.
//!
//! And a field cannot be widened alone. Widening only the read moves the
//! conversion to the write -- `i2d` before the `putfield` instead of after the
//! `getfield` -- so the field, the counter that feeds it and the arithmetic
//! between them have to move together or not at all. That is one equivalence
//! class spanning several functions, which is why this is a union-find over the
//! whole program rather than a pass over each body.
//!
//! # Why it is a representation choice and not a second compilation
//!
//! The IR is untouched. `prepared_program` still runs once and every lane
//! receives the same program, which is what makes `nts (JVM)` a comparison of
//! backends. What differs is how *this* backend realises an `i32` -- the same
//! latitude it takes deciding an array is a `double[]` rather than a wrapper.
//! The frame classes whose descriptors change are generated here and nothing
//! outside this backend can see them.
//!
//! # Why it is exact
//!
//! An `i32` is representable in an f64 with no rounding, and HIR typing a value
//! `Int { bits: 32 }` **is** the claim that it fits -- specialization put it
//! there by proving the range. So `dadd` computes what `iadd` computes, for
//! every value either can hold.
//!
//! That argument covers `+`, `-`, `*` and the comparisons and covers nothing
//! else. Shifts and bitwise operations need the bit pattern, division truncates
//! differently, and an unsigned type is not an f64's to represent. A class
//! touched by any of those is refused whole.

use nts_core::hir::{BinOp, Func, HirType, ManagedType, OpKind, Program, Terminator, ValueId};
use rustc_hash::{FxHashMap, FxHashSet};

/// What this backend decided to hold as a `double`.
#[derive(Debug)]
pub struct Plan {
    /// Keyed by function name, because `Emitter` is handed one `Func` and the
    /// decision was made across all of them.
    values: FxHashMap<String, FxHashSet<ValueId>>,
    /// `(declaring class, field name)` -- the identity both the declaration in
    /// `object_class` and the access in `field_ref` can compute, since one
    /// works from names and the other from indices into a possibly inherited
    /// layout.
    fields: FxHashSet<(String, String)>,
}

impl Plan {
    #[must_use]
    pub fn empty() -> Self {
        Self { values: FxHashMap::default(), fields: FxHashSet::default() }
    }

    #[must_use]
    pub fn values_in(&self, func: &Func) -> FxHashSet<ValueId> {
        self.values.get(&func.name).cloned().unwrap_or_default()
    }

    #[must_use]
    pub fn fields(&self) -> &FxHashSet<(String, String)> {
        &self.fields
    }

    #[must_use]
    pub fn field(&self, class: &str, name: &str) -> bool {
        self.fields.contains(&(class.to_owned(), name.to_owned()))
    }
}

struct Classes {
    parent: Vec<u32>,
}

impl Classes {
    fn new(count: usize) -> Self {
        Self { parent: (0..u32::try_from(count).unwrap_or(u32::MAX)).collect() }
    }

    fn find(&mut self, at: u32) -> u32 {
        let mut root = at;
        while self.parent[root as usize] != root {
            root = self.parent[root as usize];
        }
        let mut walk = at;
        while self.parent[walk as usize] != root {
            let next = self.parent[walk as usize];
            self.parent[walk as usize] = root;
            walk = next;
        }
        root
    }

    fn union(&mut self, a: u32, b: u32) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[b as usize] = a;
        }
    }
}

/// Operations whose operands and result share one representation, and which an
/// f64 computes identically for every `i32` input.
fn shares_representation(op: BinOp) -> bool {
    matches!(
        op,
        BinOp::Add
            | BinOp::Sub
            | BinOp::Mul
            | BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::Eq
            | BinOp::Ne
    )
}

/// A signed integer of at most 32 bits, which an f64 holds exactly.
fn narrow(ty: &HirType) -> bool {
    matches!(ty, HirType::Int { bits, signed: true } if *bits <= 32)
}

fn is_f64(ty: &HirType) -> bool {
    matches!(ty, HirType::Float { bits: 64 })
}

/// The layout a field access names, and the field's declared type.
fn field_of<'a>(
    program: &'a Program,
    func: &Func,
    object: ValueId,
    index: u32,
) -> Option<((String, String), &'a HirType)> {
    let HirType::Managed(ManagedType::Object(id)) = func.values[object.0 as usize].ty else {
        return None;
    };
    let layout = program.layout(id)?;
    let field = layout.fields.get(index as usize)?;
    // The *declaring* class, which is what an access names: a base's fields are
    // a prefix of the derived's, so the object's own layout is not always the
    // one that holds them.
    let owner = crate::hierarchy::declares_field(program, layout, index as usize);
    Some(((crate::types::class_name(owner), field.name.clone()), &field.ty))
}

/// The functions this backend actually renders.
fn emitted(func: &Func) -> bool {
    !func.abstract_declaration
}

/// Every operation the emitter will actually emit, in the order it walks them.
///
/// **Not `func.values`.** That list outlives lowering and dead-code
/// elimination: `upTo__resume` still carries the `yield` its rewrite replaced,
/// in a block nothing reaches, and the emitter never renders it -- `Yield` is
/// on its refusal list and the program compiles clean regardless. Reading the
/// value list refused `upTo$frame.yielded` on the strength of an instruction
/// that does not exist in the output.
///
/// `block_order` is the emitter's own answer to which blocks are live, so
/// asking it is the only way to be sure the analysis and the emitter are
/// looking at one program.
fn live_ops(func: &Func) -> Vec<ValueId> {
    let mut ops = Vec::new();
    for block in nts_codegen_common::block_order(func) {
        let Some(block) = func.blocks.get(block.0 as usize) else {
            continue;
        };
        ops.extend(block.params.iter().copied());
        ops.extend(block.ops.iter().copied());
    }
    ops
}

/// Decide, once, for the whole program.
#[must_use]
pub fn plan(program: &Program) -> Plan {
    // One index space: every value of every function, then one slot per
    // candidate field. A `getfield` unions its result with the field, so a
    // field and the values that flow through it are refused or kept together.
    let mut offset = FxHashMap::default();
    let mut total = 0usize;
    for func in &program.funcs {
        offset.insert(func.name.clone(), total);
        total += func.values.len();
    }
    let mut field_index: FxHashMap<(String, String), u32> = FxHashMap::default();
    for func in program.funcs.iter().filter(|it| emitted(it)) {
        for value in live_ops(func) {
            let op = &func.values[value.0 as usize];
            let (OpKind::FieldGet { object, field } | OpKind::FieldSet { object, field, .. }) =
                &op.kind
            else {
                continue;
            };
            let (object, index) = (*object, *field);
            if let Some((key, ty)) = field_of(program, func, object, index)
                && narrow(ty)
            {
                let next = u32::try_from(total + field_index.len()).unwrap_or(u32::MAX);
                field_index.entry(key).or_insert(next);
            }
        }
    }
    let mut classes = Classes::new(total + field_index.len());
    let id = |func: &Func, value: ValueId| -> u32 {
        u32::try_from(offset[&func.name] + value.0 as usize).unwrap_or(u32::MAX)
    };

    let mut refused: FxHashSet<u32> = FxHashSet::default();
    let mut wanted: FxHashSet<u32> = FxHashSet::default();

    unify(program, &mut classes, &offset, &field_index);

    strike_down(program, &mut classes, &offset, &mut refused, &mut wanted);

    // Only a class that reaches a **field**.
    //
    // Widening locals alone was measured twice and lost both times. It moved
    // two conversions across the entire suite -- and on `closures` it removed
    // exactly one `i2d` from a 103-instruction method and cost **30%**:
    // 1.15x to 1.49x, with every hot method byte-identical apart from that
    // conversion and one slot's type. A `double` slot where an `int` would do
    // perturbs register allocation for no gain.
    //
    // The win is fields, and it is a different mechanism: `upTo$frame.yielded`
    // is read and converted once per element, so widening it deletes work from
    // a loop rather than shuffling slots in one. `generator` 3.41x -> 1.00x.
    //
    // So the rule is not "widen what is exact" -- that was true of the locals
    // too -- but "widen what removes a conversion from a field access".
    let reaching_a_field: FxHashSet<u32> =
        field_index.values().map(|slot| classes.find(*slot)).collect();
    let mut plan = Plan::empty();
    for func in program.funcs.iter().filter(|it| emitted(it)) {
        let mut kept = FxHashSet::default();
        for value in live_ops(func) {
            let op = &func.values[value.0 as usize];
            let root = classes.find(id(func, value));
            if narrow(&op.ty)
                && !refused.contains(&root)
                && wanted.contains(&root)
                && reaching_a_field.contains(&root)
            {
                kept.insert(value);
            }
        }
        if !kept.is_empty() {
            plan.values.insert(func.name.clone(), kept);
        }
    }
    for (key, slot) in &field_index {
        let root = classes.find(*slot);
        if !refused.contains(&root) && wanted.contains(&root) {
            plan.fields.insert(key.clone());
        }
    }
    plan
}

/// Remove every class an f64 cannot carry.
///
/// Split from `plan` because the union pass and the refusal pass are two
/// separate readings of the program and reading them as one function was the
/// thing that hid a `yield` in a block nothing reaches.
fn strike_down(
    program: &Program,
    classes: &mut Classes,
    offset: &FxHashMap<String, usize>,
    refused: &mut FxHashSet<u32>,
    wanted: &mut FxHashSet<u32>,
) {
    let id = |func: &Func, value: ValueId| -> u32 {
        u32::try_from(offset[&func.name] + value.0 as usize).unwrap_or(u32::MAX)
    };
    // Struck down. A class survives only if every member is a narrow signed
    // integer, every definition is one this can re-emit, and every use is one
    // an f64 answers identically.
    for func in program.funcs.iter().filter(|it| emitted(it)) {
        for value in live_ops(func) {
            let op = &func.values[value.0 as usize];
            let here = id(func, value);
            if !narrow(&op.ty) {
                let root = classes.find(here);
                refused.insert(root);
                continue;
            }
            match &op.kind {
                OpKind::ConstInt(_) | OpKind::BlockParam(_) | OpKind::FieldGet { .. } => {}
                OpKind::Binary { op, .. } if shares_representation(*op) => {}
                _ => {
                    refused.insert(classes.find(here));
                }
            }
        }
        for value in live_ops(func) {
            let op = &func.values[value.0 as usize];
            match &op.kind {
                // The whole point: a widened value is already a double here.
                OpKind::Convert(source)
                    if is_f64(&op.ty) && narrow(&func.values[source.0 as usize].ty) =>
                {
                    wanted.insert(classes.find(id(func, *source)));
                }
                // Allowed and already unioned.
                OpKind::Binary { op: binop, .. } if shares_representation(*binop) => {}
                OpKind::FieldSet { value: stored, .. }
                    if narrow(&func.values[stored.0 as usize].ty) => {}
                other => {
                    for operand in nts_core::hir::operands_of(other) {
                        if narrow(&func.values[operand.0 as usize].ty) {
                            let root = classes.find(id(func, operand));
                            refused.insert(root);
                        }
                    }
                }
            }
        }
        // A `Return` is the function's declared type; the descriptor is not
        // ours to change.
        for block in &func.blocks {
            if let Terminator::Return(Some(value)) = &block.terminator
                && narrow(&func.values[value.0 as usize].ty)
            {
                let root = classes.find(id(func, *value));
                refused.insert(root);
            }
        }
    }

}

/// Tie together everything that must share one representation.
///
/// A block parameter and every argument reaching it; an arithmetic result and
/// its operands; a field and every value read from or written to it. Widening
/// one without the others would put back exactly the conversion this is trying
/// to remove.
fn unify(
    program: &Program,
    classes: &mut Classes,
    offset: &FxHashMap<String, usize>,
    field_index: &FxHashMap<(String, String), u32>,
) {
    let id = |func: &Func, value: ValueId| -> u32 {
        u32::try_from(offset[&func.name] + value.0 as usize).unwrap_or(u32::MAX)
    };
    for func in program.funcs.iter().filter(|it| emitted(it)) {
        // Edges into block parameters, and arithmetic with its operands.
        for block in &func.blocks {
            let outgoing: Vec<(nts_core::hir::BlockId, &Vec<ValueId>)> = match &block.terminator {
                Terminator::Jump { target, args } => vec![(*target, args)],
                Terminator::Branch { then_target, then_args, else_target, else_args, .. } => {
                    vec![(*then_target, then_args), (*else_target, else_args)]
                }
                _ => Vec::new(),
            };
            for (target, args) in outgoing {
                let Some(params) = func.blocks.get(target.0 as usize).map(|it| &it.params) else {
                    continue;
                };
                for (param, arg) in params.iter().zip(args) {
                    classes.union(id(func, *param), id(func, *arg));
                }
            }
            for &value in &block.ops {
                match &func.values[value.0 as usize].kind {
                    OpKind::Binary { op, lhs, rhs } if shares_representation(*op) => {
                        classes.union(id(func, *lhs), id(func, *rhs));
                        if narrow(&func.values[value.0 as usize].ty) {
                            classes.union(id(func, value), id(func, *lhs));
                        }
                    }
                    OpKind::FieldGet { object, field } => {
                        if let Some(slot) = field_of(program, func, *object, *field)
                            .and_then(|(key, _)| field_index.get(&key))
                        {
                            classes.union(id(func, value), *slot);
                        }
                    }
                    OpKind::FieldSet { object, field, value: stored } => {
                        if let Some(slot) = field_of(program, func, *object, *field)
                            .and_then(|(key, _)| field_index.get(&key))
                        {
                            classes.union(id(func, *stored), *slot);
                        }
                    }
                    _ => {}
                }
            }
        }
    }

}
