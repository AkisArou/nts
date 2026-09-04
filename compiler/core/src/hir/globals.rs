//! What a module-scope variable can hold.
//!
//! # The third kind of storage, and the one nothing looked at
//!
//! A number lives in one of three places here: a local, a field, or a global.
//! [`super::fields`] narrows a field whose every store is a small whole number
//! to an `int32`, and [`super::elements`] does the same for what an array holds.
//! A global had no equivalent, and the cost of that is not theoretical:
//!
//! ```ts
//! let step = 0;
//! const mix = (x: number): number => (((x * 2654435761) ^ (x >>> 3)) + step) | 0;
//! ```
//!
//! `benches/cases/module-closures` runs that 4096 times and was **4.83x
//! hand-written C++ and 2.15x node**. Writing `step` as a `const` that folds
//! instead — same arithmetic, same closures, same globals — was 0.99x C++. The
//! whole gap was one `static double step` where C has `std::int32_t`: the body
//! adds in floating point and calls `nts_to_int32` on the way out, and every
//! call site converts around it.
//!
//! The contrast that names the cause is inside one program. In
//! `benches/cases/closures` the same variable is captured by a closure that
//! stays in the frame, so it is a *field*, so `hir::fields` narrows it and the
//! loop collapses. Move it to module scope and nothing looks at it. Same value,
//! same writes, same reads; only the kind of storage differs.
//!
//! # Why it is sound
//!
//! A global holds what was stored into it and nothing else can store into it:
//! there is no FFI writing through a pointer here, and every store the program
//! makes is a [`OpKind::GlobalSet`] in the HIR. So the join over every store
//! that can reach a global over-approximates what any read can see.
//!
//! [`super::Global::initial`] is joined in as the starting value, because a
//! read can happen before `module#init` runs — a cycle crossed by a function
//! reads a global whose initializer has not executed, which is the whole
//! subject of `examples/module-cycle`. It is the value the declaration starts
//! at, so it is a store like any other.
//!
//! # Where it stops
//!
//! **An exported global.** `exported` means visible outside the compiled set,
//! so a reader this analysis cannot see holds the declared type. Narrowing one
//! would change what that reader is looking at, and unlike a field there is no
//! layout to carry the new width across the boundary.
//!
//! **A global that is not a `number`.** An erased one holds a tag, a reference
//! one holds a pointer; neither is a width question.
//!
//! **A `-0`, a NaN, an infinity, or a fraction.** The same rule fields use, for
//! the same reason: an integer slot cannot hold `-0`, and `1 / -0` can tell.

use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::Analysis;
use super::{HirType, OpKind, Program};

/// The machine type each global is narrowed to, by index.
pub type GlobalWidths = FxHashMap<u32, HirType>;

/// What each global can hold, by index. Absent means TOP.
pub type GlobalFacts = FxHashMap<u32, Facts>;

/// What every store in the program puts into each global.
///
/// The facts are the product and the width below is a *consequence* of them,
/// which is the order that matters. Narrowing the storage alone bought almost
/// nothing when it was tried the other way round -- `benches/cases/module-closures`
/// went 17.84us to 16.05us against C++'s 2.30us -- because the width is not what
/// the arithmetic is waiting on. A `GlobalGet` with no facts is TOP, and a TOP in
/// a loop makes every operation after it floating point whatever the slot holds.
///
/// The same relationship [`super::fields::analyze`] has to
/// [`super::fields::representations`], and for the same reason.
#[must_use]
pub fn analyze(program: &Program, analyses: &[Analysis]) -> GlobalFacts {
    // Seeded with the declaration's starting value, so a global nothing ever
    // stores into is decided by that alone rather than by an empty join --
    // which is BOTTOM, and BOTTOM would claim anything.
    let mut stored: GlobalFacts = FxHashMap::default();
    for (index, global) in program.globals.iter().enumerate() {
        if global.exported || !matches!(global.ty, HirType::Float { .. } | HirType::Int { .. }) {
            continue;
        }
        let at = u32::try_from(index).unwrap_or(u32::MAX);
        stored.insert(at, Facts::constant(global.initial));
    }

    for (index, func) in program.funcs.iter().enumerate() {
        for op in &func.values {
            let OpKind::GlobalSet { global, value } = &op.kind else {
                continue;
            };
            // Absent from the map is a global this pass declined to consider --
            // exported, or not a number -- and a store into one decides nothing.
            let Some(entry) = stored.get_mut(global) else {
                continue;
            };
            *entry = entry.join(analyses[index].get(*value));
        }
    }
    stored
}

/// Which globals can be held narrower than the `f64` their declaration implies.
#[must_use]
pub fn representations(program: &Program, facts: &GlobalFacts) -> GlobalWidths {
    facts
        .iter()
        .filter(|(global, _)| {
            program
                .globals
                .get(**global as usize)
                .is_some_and(|slot| matches!(slot.ty, HirType::Float { .. }))
        })
        .filter_map(|(global, held)| Some((*global, width_for(*held)?)))
        .collect()
}

/// The width a global's contents fit in, if any.
///
/// The same rule [`super::fields::representations`] applies to a field. Kept as
/// its own function rather than shared, because the two differ in what they
/// return and sharing them would mean a type parameter for four lines.
fn width_for(held: Facts) -> Option<HirType> {
    if held.is_bottom() || !held.whole || held.maybe_nan || held.maybe_negative_zero {
        return None;
    }
    if held.lo >= -2_147_483_648.0 && held.hi <= 2_147_483_647.0 {
        Some(HirType::Int {
            bits: 32,
            signed: true,
        })
    } else if held.lo >= super::facts::SAFE_MIN && held.hi <= super::facts::SAFE_MAX {
        // Past 2^53 an `f64` cannot tell adjacent integers apart, so there is
        // nothing to prove and nothing to represent.
        Some(HirType::Int {
            bits: 64,
            signed: true,
        })
    } else {
        None
    }
}

/// Apply what [`representations`] decided, to the globals and to every read.
///
/// Both, together. A `GlobalGet` carries the type it produces and everything
/// downstream reads *that* rather than the declaration — so moving one without
/// the other emits a `static int32_t` and assigns a `double` local from it,
/// which is the mistake [`super::fields::narrow`] documents having made.
///
/// The stores need no rewriting here: [`super::specialize`] already converts
/// every `GlobalSet` to the slot's declared type, and the slot's type is what
/// this changed.
pub fn narrow(program: &mut Program, narrowed: &GlobalWidths) -> usize {
    if narrowed.is_empty() {
        return 0;
    }
    for (global, ty) in narrowed {
        if let Some(slot) = program.globals.get_mut(*global as usize) {
            slot.ty = ty.clone();
        }
    }

    let mut retyped = 0;
    for func in &mut program.funcs {
        for index in 0..func.values.len() {
            let OpKind::GlobalGet(global) = func.values[index].kind else {
                continue;
            };
            if let Some(ty) = narrowed.get(&global) {
                func.values[index].ty = ty.clone();
                retyped += 1;
            }
        }
    }
    retyped
}
