//! What an object's field can hold.
//!
//! # Why a field is worth analyzing
//!
//! A read of a field is a wall in exactly the way a call used to be. Every
//! `this.count`, every captured variable in a closure, every element of a
//! record comes back as TOP — so `this.count + 1` is floating point, `x |
//! 0` after it is a library call, and a loop that touches an object pays a
//! double round trip per iteration for arithmetic that fits in a register.
//!
//! That is not a small class of program. It is every program that uses objects.
//!
//! # Why it is sound
//!
//! A field holds what was stored into it, and nothing else can store into it:
//! there is no FFI that writes through a pointer here, and a program's own
//! stores are all in the HIR. So the join over every `FieldSet` that can reach
//! a field is an over-approximation of what a `FieldGet` can read.
//!
//! Zero is joined in as well, because that is what an allocation leaves. A
//! well-typed TypeScript program cannot read a field before its constructor
//! writes it, but proving that here would mean a definite-assignment analysis
//! for a fact worth one endpoint of an interval.
//!
//! # Aliasing, and why base-first makes it easy
//!
//! A store through a `Shape *` may land in a `Square`, so a read of `Square`'s
//! field must see it. Base-first layout makes the condition exact and cheap:
//! two layouts share a field's storage when they agree on every field up to and
//! including it, because that is precisely when a pointer to one is a pointer
//! to the other with the same offsets.

use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::Analysis;
use super::{HirType, ManagedType, OpKind, Program};

/// The machine type each `(layout, field)` was narrowed to.
///
/// By layout rather than by type, because it is a decision about *storage* and
/// storage is what a layout is.
pub type FieldWidths = FxHashMap<(usize, u32), HirType>;

/// What each `(type, field)` can hold.
///
/// Keyed by type rather than by layout, because a `FieldGet` names a type and
/// looking the layout up again at every read would be a search per query. One
/// layout can answer for several types -- structural typing gives `Point` and
/// the anonymous `{ x: number; y: number }` one layout -- so every one of them
/// gets the same entry.
pub type FieldFacts = FxHashMap<(super::TypeId, u32), Facts>;

/// Join every store into every field it can reach.
#[must_use]
pub fn analyze(program: &Program, analyses: &[Analysis]) -> FieldFacts {
    // By layout while collecting, because a store names one type and the
    // aliasing question is about layouts. Expanded to types at the end.
    let mut stored: FxHashMap<(usize, u32), Facts> = FxHashMap::default();

    for (index, func) in program.funcs.iter().enumerate() {
        for op in &func.values {
            let OpKind::FieldSet {
                object,
                field,
                value,
            } = &op.kind
            else {
                continue;
            };
            let Some(layout) = layout_of(program, &func.values[object.0 as usize].ty) else {
                continue;
            };
            // A managed field holds a pointer, and the numeric domain has
            // nothing to say about one.
            if !is_number(program, layout, *field) {
                continue;
            }
            let entry: &mut Facts = stored.entry((layout, *field)).or_insert(Facts::BOTTOM);
            *entry = entry.join(analyses[index].get(*value));
        }
    }

    // A store through a base-typed pointer can land in any layout that shares
    // the prefix, so a read has to see all of them.
    let mut visible: FieldFacts = FxHashMap::default();
    for (at, layout) in program.layouts.iter().enumerate() {
        for field in 0..u32::try_from(layout.fields.len()).unwrap_or(0) {
            if !is_number(program, at, field) {
                continue;
            }
            // Zero, because that is what the allocator leaves.
            let mut facts = Facts::constant(0.0);
            for (other, candidate) in program.layouts.iter().enumerate() {
                if !shares_storage(layout, candidate, field) {
                    continue;
                }
                if let Some(seen) = stored.get(&(other, field)) {
                    facts = facts.join(*seen);
                }
            }
            for ty in &layout.types {
                visible.insert((*ty, field), facts);
            }
        }
    }
    visible
}

/// Give every field the narrowest machine type every store into it allows.
///
/// # Why a field is the place this matters most
///
/// A `number` field is a double because `number` is a double. But a program
/// that puts small whole numbers in a field puts them there *every time* — and
/// the join over every store says so. `Ball` in Are We Fast Yet holds four
/// coordinates that never leave `int32`, so the C++ port declares four
/// `int32_t` and this compiler was declaring four `double`: twice the object,
/// twice the memory traffic, and floating-point arithmetic for values that fit
/// in a register.
///
/// Unlike specializing a *local*, this changes the object's layout, so it has
/// to hold for every layout that shares the field's storage — which base-first
/// makes exact: a store through a `Shape *` lands in a `Square`, and the two
/// must agree on the width or the store writes four bytes where the read wants
/// eight.
///
/// # Why it is exact rather than lossy
///
/// The store is a truncation the analysis proved is not one: every value that
/// reaches the field is a whole number inside the range, so the cast is the
/// identity on every value the program can produce. A field that might hold a
/// fraction, a NaN, an infinity, or a negative zero keeps its double — `-0`
/// especially, because an integer slot cannot hold it and `1 / -0` can tell.
#[must_use]
pub fn representations(program: &Program, analyses: &[Analysis]) -> FieldWidths {
    // What every store into each field, by layout, is worth.
    let mut stored: FxHashMap<(usize, u32), Facts> = FxHashMap::default();
    for (index, func) in program.funcs.iter().enumerate() {
        for op in &func.values {
            let OpKind::FieldSet {
                object,
                field,
                value,
            } = &op.kind
            else {
                continue;
            };
            let Some(layout) = layout_of(program, &func.values[object.0 as usize].ty) else {
                continue;
            };
            if !is_number(program, layout, *field) {
                continue;
            }
            let entry: &mut Facts = stored.entry((layout, *field)).or_insert(Facts::BOTTOM);
            *entry = entry.join(analyses[index].get(*value));
        }
    }

    // Decided against the *original* types, then applied: narrowing one field
    // changes what `shares_storage` says about the fields after it, and a
    // decision that depended on a decision would depend on the order.
    let mut narrowed = FxHashMap::default();
    for (at, layout) in program.layouts.iter().enumerate() {
        for field in 0..u32::try_from(layout.fields.len()).unwrap_or(0) {
            if !matches!(layout.fields[field as usize].ty, HirType::Float { .. }) {
                continue;
            }
            // Zero, because that is what the allocator leaves -- and a whole
            // number in range, so it never decides the answer on its own.
            let mut held = Facts::constant(0.0);
            for (other, candidate) in program.layouts.iter().enumerate() {
                if !shares_storage(layout, candidate, field) {
                    continue;
                }
                // A layout in the group that nothing stores into is a field
                // read before it is written, which is the allocator's zero.
                held = held.join(
                    stored
                        .get(&(other, field))
                        .copied()
                        .unwrap_or(Facts::BOTTOM),
                );
            }
            let Some(bits) = width_for(held) else {
                continue;
            };
            narrowed.insert((at, field), HirType::Int { bits, signed: true });
        }
    }
    narrowed
}

/// The width a field's contents fit in, if any.
fn width_for(held: Facts) -> Option<u8> {
    if held.is_bottom() || !held.whole || held.maybe_nan || held.maybe_negative_zero {
        return None;
    }
    if held.lo >= -2_147_483_648.0 && held.hi <= 2_147_483_647.0 {
        Some(32)
    } else if held.lo >= super::facts::SAFE_MIN && held.hi <= super::facts::SAFE_MAX {
        // Past 2^53 an `f64` cannot tell adjacent integers apart, so there is
        // nothing to prove and nothing to represent.
        Some(64)
    } else {
        None
    }
}

/// Apply what [`representations`] decided, to the layouts and to every read.
///
/// A `FieldGet` carries the type it produces, and everything downstream reads
/// that rather than the layout — so the two have to move together or the
/// emitter declares an `int32_t` member and assigns a `double` local from it.
pub fn narrow(program: &mut Program, narrowed: &FieldWidths) -> usize {
    if narrowed.is_empty() {
        return 0;
    }
    for ((layout, field), ty) in narrowed {
        if let Some(slot) = program.layouts[*layout].fields.get_mut(*field as usize) {
            slot.ty = ty.clone();
        }
    }

    // By type id, since that is what a read names.
    let mut by_type: FieldTypes = FxHashMap::default();
    for ((layout, field), ty) in narrowed {
        for id in &program.layouts[*layout].types {
            by_type.insert((*id, *field), ty.clone());
        }
    }

    let mut retyped = 0;
    for func in &mut program.funcs {
        for index in 0..func.values.len() {
            let OpKind::FieldGet { object, field } = func.values[index].kind else {
                continue;
            };
            let HirType::Managed(ManagedType::Object(id)) = func.values[object.0 as usize].ty
            else {
                continue;
            };
            if let Some(ty) = by_type.get(&(id, field)) {
                func.values[index].ty = ty.clone();
                retyped += 1;
            }
        }
    }
    retyped
}

/// The machine type of each `(type, field)`, for the reads that name one.
type FieldTypes = FxHashMap<(super::TypeId, u32), HirType>;

/// How long the array each parameter points at can be, per function and slot.
///
/// The mirror of [`lengths`] for the other way a reference arrives. A method
/// reading `this.flags` has no allocation in front of it, and neither does one
/// that takes `flags` as an argument — and the second is the shape of every
/// function handed a buffer to work on. `Sieve#sieve(flags, size)` is the case:
/// the array is five thousand long and the only caller says so, but inside the
/// function nothing does, so both of its inner loops kept a bounds check.
///
/// # Where it stops
///
/// - **A root.** Its callers are outside the compiled set, so what they pass is
///   not knowable. [`super::guards`] is how a root gets facts about a *number*
///   parameter anyway; there is no equivalent for a length, because testing one
///   at the boundary would mean specializing the body on it.
/// - **A program whose arrays can grow.** An array handed on can come back
///   longer, and the object does not move, so every reference sees the new
///   length. See [`super::arrays_can_grow`].
///
/// Only what is *allocated* counts. A null contributes no length, for the same
/// reason it contributes none to a field: reading through it faults, and so
/// would the bounds check that read its length.
pub(super) fn parameter_lengths(
    program: &Program,
    analyses: &[Analysis],
    outward: &rustc_hash::FxHashSet<&str>,
) -> Vec<Vec<Facts>> {
    let mut known: Vec<Vec<Facts>> = program
        .funcs
        .iter()
        .map(|func| {
            let unseen = outward.contains(func.name.as_str());
            func.params
                .iter()
                .map(|param| {
                    if unseen || !matches!(param.ty, HirType::Managed(ManagedType::Array(_))) {
                        Facts::TOP
                    } else {
                        // A least fixpoint over what the callers pass, so a
                        // parameter no call reaches stays at BOTTOM rather than
                        // claiming a length nobody gave it.
                        Facts::BOTTOM
                    }
                })
                .collect()
        })
        .collect();
    if super::arrays_can_grow(program) {
        return program
            .funcs
            .iter()
            .map(|func| vec![Facts::TOP; func.params.len()])
            .collect();
    }

    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(index, func)| (func.name.as_str(), index))
        .collect();
    let in_slot = program.slot_targets();

    for (caller, func) in program.funcs.iter().enumerate() {
        for op in &func.values {
            let OpKind::Call { callee, args, .. } = &op.kind else {
                continue;
            };
            for target in super::interprocedural::targets_of(callee, &by_name, &in_slot) {
                for (slot, arg) in args.iter().enumerate() {
                    let Some(entry) = known[target].get_mut(slot) else {
                        continue;
                    };
                    if *entry == Facts::TOP {
                        continue;
                    }
                    *entry = entry.join(allocated_length(func, &analyses[caller], *arg));
                }
            }
        }
    }
    known
}

/// How long the array in each `(type, field)` is, where that is knowable.
///
/// The length of an array a *field* points at is not written down where the
/// read is -- unlike a local, which has its allocation in front of it. So this
/// is the only way an index into `this.flags` can be proven in bounds, and
/// every remaining bounds check in the Are We Fast Yet micro benchmarks is one
/// of those.
///
/// The soundness condition is [`super::allocated_length_is_exact`]'s, applied
/// program-wide: an array whose reference is handed to a call may come back
/// longer, and the object does not move, so every reference sees the new
/// length.
#[must_use]
pub fn lengths(program: &Program, analyses: &[Analysis]) -> FieldFacts {
    let mut stored: FxHashMap<(usize, u32), Facts> = FxHashMap::default();
    let mut grown: rustc_hash::FxHashSet<(usize, u32)> = rustc_hash::FxHashSet::default();

    for (index, func) in program.funcs.iter().enumerate() {
        for op in &func.values {
            match &op.kind {
                OpKind::FieldSet {
                    object,
                    field,
                    value,
                } => {
                    let Some(layout) = layout_of(program, &func.values[object.0 as usize].ty)
                    else {
                        continue;
                    };
                    let entry: &mut Facts = stored.entry((layout, *field)).or_insert(Facts::BOTTOM);
                    *entry = entry.join(allocated_length(func, &analyses[index], *value));
                }
                // A reference that leaves the function can be grown by whatever
                // receives it.
                OpKind::Call { args, .. } => {
                    for arg in args {
                        let OpKind::FieldGet { object, field } = &func.values[arg.0 as usize].kind
                        else {
                            continue;
                        };
                        if let Some(layout) = layout_of(program, &func.values[object.0 as usize].ty)
                        {
                            grown.insert((layout, *field));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let mut visible: FieldFacts = FxHashMap::default();
    for layout in &program.layouts {
        for field in 0..u32::try_from(layout.fields.len()).unwrap_or(0) {
            if !matches!(
                layout.fields[field as usize].ty,
                HirType::Managed(ManagedType::Array(_))
            ) {
                continue;
            }
            // Every layout a store through a base-typed pointer could land in.
            let mut length = Facts::BOTTOM;
            for (other, candidate) in program.layouts.iter().enumerate() {
                if !shares_storage(layout, candidate, field) {
                    continue;
                }
                if grown.contains(&(other, field)) {
                    length = Facts::TOP;
                    break;
                }
                length = length.join(stored.get(&(other, field)).copied().unwrap_or(Facts::TOP));
            }
            if length.is_bottom() || length == Facts::TOP {
                continue;
            }
            for ty in &layout.types {
                visible.insert((*ty, field), length);
            }
        }
    }
    visible
}

/// How long the array a value refers to is, where that is written down.
///
/// `new Array(8)` says it. So does `new Array(8).fill(true)`: `fill` returns the
/// array it was handed, which is why `xs.fill(0).length` means something, and it
/// is how three of the Are We Fast Yet benchmarks make their working set.
fn allocated_length(func: &super::Func, analysis: &Analysis, value: super::ValueId) -> Facts {
    let mut at = value;
    for _ in 0..8 {
        match &func.values[at.0 as usize].kind {
            OpKind::ArrayNew { length } => return analysis.get(*length),
            // The absent reference contributes no length, and excluding it
            // costs no safety: reading `length` through a null array faults,
            // and so does the bounds check that would have read it. A
            // constructor writing `this.rows = null` before the real array
            // arrives is otherwise enough to make every index into that field
            // checked forever.
            OpKind::ConstNull => return Facts::BOTTOM,
            OpKind::Call {
                callee: super::Callee::External(name),
                args,
                ..
            } if RETURNS_ITS_ARRAY.contains(&name.as_str()) => match args.first() {
                Some(receiver) => at = *receiver,
                None => return Facts::TOP,
            },
            _ => return Facts::TOP,
        }
    }
    Facts::TOP
}

/// Runtime helpers that hand back the array they were given.
const RETURNS_ITS_ARRAY: &[&str] = &[
    "nts_array_fill",
    "nts_array_fill_bool",
    "nts_array_fill_ref",
    "nts_array_reverse",
];

/// Whether two layouts put `field` at the same place, holding the same thing.
///
/// Agreement on the whole prefix, which under base-first layout is exactly when
/// a pointer to one is a pointer to the other with matching offsets. Agreeing
/// on the field alone would not do: two classes can both have a third field
/// named `n` with different second fields, and then no pointer converts between
/// them and no store aliases.
fn shares_storage(one: &super::Layout, other: &super::Layout, field: u32) -> bool {
    let upto = field as usize;
    if one.fields.len() <= upto || other.fields.len() <= upto {
        return false;
    }
    one.fields[..=upto]
        .iter()
        .zip(&other.fields[..=upto])
        .all(|(mine, theirs)| mine.name == theirs.name && mine.ty == theirs.ty)
}

/// Whether a field holds a number, which is the only thing this domain models.
fn is_number(program: &Program, layout: usize, field: u32) -> bool {
    program.layouts[layout]
        .fields
        .get(field as usize)
        .is_some_and(|field| matches!(field.ty, HirType::Float { .. } | HirType::Int { .. }))
}

/// The layout an object-typed value refers to.
fn layout_of(program: &Program, ty: &HirType) -> Option<usize> {
    let HirType::Managed(ManagedType::Object(id)) = ty else {
        return None;
    };
    program
        .layouts
        .iter()
        .position(|layout| layout.types.contains(id))
}
