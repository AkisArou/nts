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
/// A starting fact for every number field, so that none of them is *absent*.
///
/// The value is the allocator's zero, and the value is not the point:
/// [`analyze`] joins that zero in every round anyway, so seeding `BOTTOM` here
/// gives an identical program -- verified by mutation, which no test and no
/// example could tell apart. **What matters is that the entry exists.**
/// `field_facts` answers TOP for a key it does not hold, so an empty map makes
/// every field read unknown in round one, and a field whose value depends on
/// its own then converges to TOP and stays there.
///
/// `Ball` in Are We Fast Yet is the case: `this.x += this.xVel` makes both
/// fields depend on themselves, so round one read TOP, round one *published*
/// TOP, and every round after agreed. Four `double`s where the C++ and Java
/// references both declare `int32`, on the row 0049 carries at 1.60x. `Random`
/// in the same program narrowed fine, because `(seed * 1309 + 13849) & 65535`
/// is bounded whatever its input was -- which is what made this look like a
/// property of `Ball` rather than of the seed.
///
/// The same fix `Crossing::returns` already carries, whose comment says it in
/// one line: "BOTTOM rather than absent, for the same reason parameters start
/// there: an absent entry reads as TOP at the use, and a function whose result
/// depends on its own result then converges to TOP."
#[must_use]
pub fn initial(program: &Program) -> FieldFacts {
    let mut facts: FieldFacts = FxHashMap::default();
    for (at, layout) in program.layouts.iter().enumerate() {
        for field in 0..u32::try_from(layout.fields.len()).unwrap_or(0) {
            if !is_number(program, at, field) {
                continue;
            }
            for ty in &layout.types {
                facts.insert((*ty, field), Facts::constant(0.0));
            }
        }
    }
    facts
}

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
            OpKind::ArrayNew { length, .. } => return analysis.get(*length),
            // The absent reference contributes no length, and excluding it
            // costs no safety: reading `length` through a null array faults,
            // and so does the bounds check that would have read it. A
            // constructor writing `this.rows = null` before the real array
            // arrives is otherwise enough to make every index into that field
            // checked forever.
            OpKind::ConstNull | OpKind::ConstUndefined => return Facts::BOTTOM,
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

/// The one closure class a field can hold, where a field holds only one.
///
/// Keyed like [`FieldFacts`] and for the same reason: a read names a type, and
/// looking the layout up again at every query would be a search per call site.
pub type FieldClosures = FxHashMap<(super::TypeId, u32), super::TypeId>;

/// What a value stored into a field says about which closure it is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Held {
    /// Nothing has been stored, or what was stored is absent — `undefined` or
    /// `null`. A field that only ever holds these is never *called*, so it
    /// contributes no candidate rather than making the answer unknown.
    Absent,
    One(super::TypeId),
    Many,
}

impl Held {
    fn join(self, other: Self) -> Self {
        match (self, other) {
            (Self::Absent, keep) | (keep, Self::Absent) => keep,
            (Self::One(one), Self::One(two)) if one == two => Self::One(one),
            _ => Self::Many,
        }
    }
}

/// Which closure class a value is, where that is decidable from the value alone.
///
/// A closure's type names its class, exactly as an object's does — see
/// [`OpKind::ClosureStatic`]. Stores into an erased field arrive wrapped, so the
/// `Erase` is stripped first; that is a change of representation and not of
/// identity.
fn held_by(func: &super::Func, value: super::ValueId) -> Held {
    let mut at = value;
    // One hop is all the lowering emits, but a loop costs nothing and does not
    // depend on that staying true.
    for _ in 0..8 {
        let op = &func.values[at.0 as usize];
        match &op.kind {
            OpKind::Erase { value } => at = *value,
            OpKind::ConstUndefined | OpKind::ConstNull => return Held::Absent,
            _ => break,
        }
    }
    let op = &func.values[at.0 as usize];
    if matches!(op.kind, OpKind::ConstUndefined | OpKind::ConstNull) {
        return Held::Absent;
    }
    match &op.ty {
        HirType::Managed(ManagedType::Object(id)) if super::is_closure_type(*id) => Held::One(*id),
        _ => Held::Many,
    }
}

/// Join every store into every field, over which closure it holds.
///
/// # Why this is worth knowing
///
/// `f?.(x)` on a field emits a call through the receiver's dispatch table --
/// two dependent loads and an indirect call clang cannot see through, so the
/// callee is not inlined and the loop around it is not vectorised. Where the
/// field can only hold one closure, the call is a direct call to a named
/// function, and every one of those costs disappears.
///
/// Measured on `benches/cases/optional-chain`, by patching the emitted C:
/// **87.90 us to 35.16 us**, against a C++ reference at 10.01. The residue is
/// the `double` accumulator against the reference's `int64_t`, which is a
/// different question.
///
/// # Why it is sound
///
/// For the reason the numeric domain above is sound, and it is the same
/// sentence: a field holds what was stored into it, nothing else can store into
/// it, and every store in the program is a `FieldSet` in this HIR. The
/// aliasing rule is [`shares_storage`]'s, unchanged -- a store through a
/// base-typed pointer lands in every layout sharing the prefix, so a read has
/// to see all of them.
#[must_use]
pub fn closures(program: &Program) -> FieldClosures {
    let mut stored: FxHashMap<(usize, u32), Held> = FxHashMap::default();
    for func in &program.funcs {
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
            let entry = stored.entry((layout, *field)).or_insert(Held::Absent);
            let one = held_by(func, *value);
            *entry = entry.join(one);
        }
    }

    let mut visible: FieldClosures = FxHashMap::default();
    for layout in &program.layouts {
        for field in 0..u32::try_from(layout.fields.len()).unwrap_or(0) {
            let mut held = Held::Absent;
            for (other, candidate) in program.layouts.iter().enumerate() {
                if !shares_storage(layout, candidate, field) {
                    continue;
                }
                if let Some(seen) = stored.get(&(other, field)) {
                    held = held.join(*seen);
                }
            }
            if let Held::One(class) = held {
                for ty in &layout.types {
                    visible.insert((*ty, field), class);
                }
            }
        }
    }
    visible
}

/// Call a closure directly where the field it came from can hold only one.
///
/// # What this removes
///
/// A closure call is a dispatch: two dependent loads to reach
/// `descriptor->methods[slot]`, then an indirect call. The loads are the small
/// half. The large half is that no C compiler can see through the indirection,
/// so the callee is not inlined, the accumulator spills across the call, and
/// the loop around it does not vectorise -- and closure bodies are usually
/// tiny, so not inlining them is most of what they cost.
///
/// `benches/cases/optional-chain` is the measurement, taken by patching the one
/// line in the emitted C rather than by argument: **87.90 us to 35.16 us**,
/// against a C++ reference at 10.01 that writes a bare function pointer. The
/// residue after this is the `double` accumulator against the reference's
/// `int64_t`, which is a different question and a different pass.
///
/// # Why a field, and how often that is the shape
///
/// Because that is where the callbacks are. Of the 50 closure call sites in
/// `stream`, `events`, `buffer` and `net`, **35 have a field receiver** -- an
/// optional handler stored on an object and called if present is what a stream
/// is made of. Six are parameters, which this cannot see and inlining can.
///
/// # Why the receiver needs no cast here
///
/// The emitted argument list already casts a managed argument to the
/// parameter's type, because a call taking a base-typed pointer is handed a
/// subclass every day. A closure's `call` takes its own class, and the
/// receiver's static type is the *signature* layout, so this is that same cast.
pub fn devirtualize(program: &mut Program, known: &FieldClosures) -> usize {
    // Resolved against the program before anything is rewritten, because the
    // rewrite needs `&mut` and the lookup needs `&`.
    let mut rewrites: Vec<(usize, usize, String, super::ValueId, super::TypeId)> = Vec::new();
    for (at, func) in program.funcs.iter().enumerate() {
        for (index, op) in func.values.iter().enumerate() {
            let OpKind::Call {
                callee: super::Callee::Closure { slot },
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            let Some(receiver) = args.first() else {
                continue;
            };
            let source = field_source(func, *receiver);
            let class = source
                .and_then(|(object, field)| {
                    let HirType::Managed(ManagedType::Object(ty)) =
                        &func.values[object.0 as usize].ty
                    else {
                        return None;
                    };
                    known.get(&(*ty, field))
                })
                .copied();
            let Some(class) = class else {
                continue;
            };
            let Some(name) = layout_of(program, &HirType::Managed(ManagedType::Object(class)))
                .and_then(|layout| program.layouts[layout].methods.get(*slot as usize))
                .and_then(Option::as_ref)
            else {
                continue;
            };
            // A closure whose body was refused is not in `funcs`, and a call to
            // a name nothing defines is worse than the dispatch it replaced.
            if !program.funcs.iter().any(|func| &func.name == name) {
                continue;
            }
            // The erased value the receiver was read back from, so the fresh
            // `Unerase` below reads the same thing at a narrower class.
            let OpKind::Unerase { value: erased } = func.values[receiver.0 as usize].kind else {
                continue;
            };
            rewrites.push((at, index, name.clone(), erased, class));
        }
    }

    // The receiver's static type is the *signature* layout, and the function
    // about to be called declares its own class. C casts a pointer for free and
    // the JVM will not: `NTS4001 storing a Fn5__5 where a Closure0 is declared`
    // is what it says, and it is right to say it -- a backend should not have to
    // invent a narrowing the IR did not state.
    //
    // So the IR states it, with the operation whose whole content is exactly
    // that: an `Unerase`'s result type is the representation an erased value is
    // read back at, and this one is read back at the class the field can only
    // hold. The licence is the analysis above rather than a tag test on the
    // path, which is a stronger one.
    //
    // A **fresh** `Unerase` rather than retyping the one already there, because
    // that value has other readers. `f?.(x)` tests the receiver against null
    // first, and retyping it left `v10 == v11` comparing a `Closure1 *` against
    // a `Fn2__2 *` -- which `reconcile` then made comparable by converting both
    // to `double`, and clang answered `pointer cannot be cast to type 'double'`.
    // Four errors, in a C file no unit test reads. The example caught it and the
    // three tests over the HIR did not, because the shape they check was right.
    let mut count = 0;
    for (func, index, name, erased, class) in rewrites {
        let origin = program.funcs[func].values[index].origin.clone();
        let Some(block) = program.funcs[func]
            .blocks
            .iter()
            .position(|block| block.ops.contains(&index_of(index)))
        else {
            continue;
        };
        let at = program.funcs[func].blocks[block]
            .ops
            .iter()
            .position(|op| *op == index_of(index))
            .unwrap_or(0);

        let receiver = super::ValueId(
            u32::try_from(program.funcs[func].values.len()).unwrap_or(u32::MAX),
        );
        program.funcs[func].values.push(super::Op {
            kind: OpKind::Unerase { value: erased },
            ty: HirType::Managed(ManagedType::Object(class)),
            origin,
        });
        program.funcs[func].blocks[block].ops.insert(at, receiver);
        if let OpKind::Call { callee, args, .. } = &mut program.funcs[func].values[index].kind {
            *callee = super::Callee::Direct(name);
            if let Some(first) = args.first_mut() {
                *first = receiver;
            }
            count += 1;
        }
    }
    count
}

/// A value arena index as a [`super::ValueId`].
fn index_of(index: usize) -> super::ValueId {
    super::ValueId(u32::try_from(index).unwrap_or(u32::MAX))
}

/// The `(object, field)` a value was read from, seeing through the erasure.
///
/// A field holding `T | undefined` is erased, so the read is wrapped in an
/// `Unerase` by the time anything calls it -- that is a change of
/// representation and not of provenance.
fn field_source(func: &super::Func, value: super::ValueId) -> Option<(super::ValueId, u32)> {
    let mut at = value;
    for _ in 0..8 {
        match &func.values[at.0 as usize].kind {
            OpKind::Unerase { value } => at = *value,
            OpKind::FieldGet { object, field } => return Some((*object, *field)),
            _ => return None,
        }
    }
    None
}
