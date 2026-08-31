//! Where a field lives in an object, computed rather than asked for.
//!
//! # Why this exists
//!
//! Descriptors have always been built with `offsetof`, on the principle that
//! the compiler which laid the struct out is the one that says where its fields
//! are. That is exactly right while C owns the layout, and it stops being
//! available the moment anything else does — a second backend emits its own
//! aggregates and has no `offsetof` to ask.
//!
//! So the placement moves here, where both backends read the same answer, and
//! the C backend keeps `offsetof` for one purpose only: to *check* this, on
//! every build, with a `_Static_assert` per field. Until those have gone a long
//! time without firing, clang is the oracle and this is the claim.
//!
//! # What it models
//!
//! The platform C ABI's rule for a struct, which `SysV` and AAPCS64 agree on for
//! everything here: a field starts at the next offset that is a multiple of its
//! alignment, the struct's alignment is the widest field's, and its size is
//! rounded up to that. No packing, no bitfields, no `alignas` — the emitted
//! structs use none of them, and a rule with no case behind it is one nothing
//! keeps honest.
//!
//! The one thing it does *not* model is a field whose type has no layout. It
//! does not have to: such a field is emitted as an opaque pointer, and a
//! pointer is a pointer whatever it points at.

use nts_core::hir::{Field, HirType, ManagedType};

/// How wide a value is, and what it must be aligned to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shape {
    pub size: u32,
    pub align: u32,
}

/// The target's pointer width, in bytes.
///
/// Named rather than assumed, because it is the one number here that a second
/// target would change: `wasm32` makes it 4 and moves every offset after the
/// header. Nothing selects a target yet, so this is a constant with a name
/// rather than a configuration nobody sets.
pub const POINTER: u32 = 8;

/// `NtsHeader`: a descriptor pointer, the provider's word, and two `uint32_t`.
///
/// Every managed object starts with one, so every field offset is measured from
/// after it. Checked by the same `_Static_assert` mechanism as the fields, so a
/// change to the runtime header cannot silently move every object's contents.
pub const HEADER: Shape = Shape {
    size: 3 * POINTER,
    align: POINTER,
};

/// The shape of a value of this type in memory, or `None` where it has none.
///
/// `Void` and `Never` have no storage; `Erased` is `NtsValue`, a tag beside a
/// union of a double, a bool and a pointer, so it is two words wide and word
/// aligned. A `bigint` is `__int128`, which is sixteen bytes aligned to
/// sixteen — the one type here whose alignment exceeds a pointer's.
#[must_use]
pub fn shape_of(ty: &HirType) -> Option<Shape> {
    Some(match ty {
        HirType::Bool => Shape { size: 1, align: 1 },
        // An integer and a float are both naturally aligned: as wide as they
        // are, aligned to their own width. Written as one arm because that is
        // one rule, not two that happen to agree.
        HirType::Int { bits, .. } | HirType::Float { bits } => {
            let bytes = u32::from(*bits) / 8;
            Shape {
                size: bytes,
                align: bytes,
            }
        }
        HirType::BigInt => Shape {
            size: 16,
            align: 16,
        },
        // Every managed value is one pointer, which is what lets a field whose
        // type has no layout be emitted opaque and still be placed exactly.
        HirType::Managed(
            ManagedType::String
            | ManagedType::Object(_)
            | ManagedType::Array(_)
            | ManagedType::Promise(_)
            | ManagedType::Map(_, _)
            | ManagedType::Set(_),
        ) => Shape {
            size: POINTER,
            align: POINTER,
        },
        HirType::Erased => Shape {
            size: 2 * POINTER,
            align: POINTER,
        },
        HirType::Void | HirType::Never => return None,
    })
}

/// Where every field of an object sits, and how big the whole thing is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    /// One offset per field, in declaration order, measured from the object's
    /// address — so the header is already accounted for.
    pub offsets: Vec<u32>,
    pub size: u32,
    pub align: u32,
}

/// Lay out an object's fields after its header.
///
/// `None` if any field has no shape, which is a field of type `void` or
/// `never`: there is nothing to place and the object is not one this can
/// describe.
#[must_use]
pub fn place(fields: &[Field]) -> Option<Placement> {
    let mut at = HEADER.size;
    let mut align = HEADER.align;
    let mut offsets = Vec::with_capacity(fields.len());
    for field in fields {
        let shape = shape_of(&field.ty)?;
        at = round_up(at, shape.align);
        offsets.push(at);
        at += shape.size;
        align = align.max(shape.align);
    }
    Some(Placement {
        offsets,
        size: round_up(at, align),
        align,
    })
}

/// The next multiple of `align` at or after `value`.
///
/// `align` is a power of two for every shape above, so this is the usual mask —
/// written as arithmetic anyway, because the one case that is not a power of
/// two would be silently wrong under the mask and merely wrong here.
const fn round_up(value: u32, align: u32) -> u32 {
    if align == 0 {
        return value;
    }
    value.div_ceil(align) * align
}

#[cfg(test)]
mod tests {
    use super::{place, shape_of, Placement, HEADER, POINTER};
    use nts_core::hir::{Field, HirType, ManagedType};

    fn field(name: &str, ty: HirType) -> Field {
        Field {
            name: name.to_owned(),
            ty,
            readonly: false,
        }
    }

    /// The header is three words, and the first field starts after it.
    #[test]
    fn an_object_starts_after_its_header() {
        assert_eq!(HEADER.size, 24);
        let placed = place(&[field("a", HirType::NUMBER)]).expect("a shape");
        assert_eq!(placed.offsets, vec![24]);
        assert_eq!(placed.size, 32);
        assert_eq!(placed.align, POINTER);
    }

    /// Padding is inserted for alignment and counted in the size, which is the
    /// whole reason this cannot be `sum(sizes)`.
    #[test]
    fn a_narrow_field_before_a_wide_one_is_padded() {
        let placed = place(&[
            field("flag", HirType::Bool),
            field("value", HirType::NUMBER),
        ])
        .expect("a shape");
        // `flag` at 24, one byte; `value` cannot start at 25.
        assert_eq!(placed.offsets, vec![24, 32]);
        assert_eq!(placed.size, 40);
    }

    /// And trailing padding, so an array of them keeps every element aligned.
    #[test]
    fn the_size_is_rounded_up_to_the_alignment() {
        let placed = place(&[field("flag", HirType::Bool)]).expect("a shape");
        assert_eq!(placed.offsets, vec![24]);
        assert_eq!(placed.size, 32, "not 25: the next one has to start aligned");
    }

    /// A `bigint` is the one type wider than a word, and it drags the whole
    /// object's alignment with it.
    #[test]
    fn a_bigint_aligns_the_object_to_sixteen() {
        let placed = place(&[
            field("small", HirType::Bool),
            field("big", HirType::BigInt),
        ])
        .expect("a shape");
        assert_eq!(placed.offsets, vec![24, 32]);
        assert_eq!(placed.align, 16);
        assert_eq!(placed.size, 48);
    }

    /// Every managed type is one pointer, whatever it points at -- which is
    /// what lets a field with no layout be placed without one.
    #[test]
    fn every_reference_is_a_pointer() {
        let one = shape_of(&HirType::Managed(ManagedType::String)).expect("a shape");
        for ty in [
            HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER))),
            HirType::Managed(ManagedType::Promise(Box::new(HirType::NUMBER))),
        ] {
            assert_eq!(shape_of(&ty), Some(one), "{ty:?}");
        }
    }

    /// An erased value is a tag beside a union of a double, a bool and a
    /// pointer: two words, word aligned.
    #[test]
    fn an_erased_value_is_two_words() {
        let placed = place(&[field("v", HirType::Erased)]).expect("a shape");
        assert_eq!(placed.offsets, vec![24]);
        assert_eq!(placed.size, 40);
    }

    /// `void` has no storage, so an object with such a field is not one this
    /// can describe -- said rather than guessed at.
    #[test]
    fn a_field_with_no_storage_has_no_placement() {
        assert_eq!(place(&[field("nothing", HirType::Void)]), None);
        assert_eq!(
            place(&[field("a", HirType::NUMBER)]).map(|p: Placement| p.size),
            Some(32)
        );
    }
}
