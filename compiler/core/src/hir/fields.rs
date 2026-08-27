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
