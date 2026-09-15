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

use crate::hir::{Field, HirType, ManagedType};

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

/// The count word's value for storage that must never be freed.
///
/// `NTS_IMMORTAL` in the runtime, which is `UINT32_MAX` -- **not** all ones.
/// `reserved` is a `uintptr_t`, so a backend writing `-1` into it writes
/// `0xFFFFFFFFFFFFFFFF`, which does not compare equal and would let the
/// collector free a frame object or a string literal.
///
/// Which is not hypothetical: the LLVM backend wrote `-1` for exactly one
/// commit, and every test passed because the default provider emits no release
/// at all. Named here so both backends read one number, and asserted from the C
/// backend so clang checks it against the macro.
pub const IMMORTAL: u64 = u32::MAX as u64;

/// Where `NtsHeader::length` sits, in bytes from the object's address.
///
/// The header is a descriptor pointer, the provider's word, `flags` and
/// `length` -- so the count is the last four bytes of it. The C backend never
/// needs this number, because it writes `a->header.length` and lets clang find
/// it; a backend without a struct type does need it, which is why it is named
/// here rather than spelled twice.
///
/// Checked by the same means as everything else: every emitted object asserts
/// its first field is at `HEADER.size`, which cannot hold if the header's own
/// shape is wrong.
pub const LENGTH_OFFSET: u32 = 2 * POINTER + 4;

/// Where `NtsArray::elements` sits.
///
/// The header, then `capacity` as a `uint32_t`, then the block pointer -- which
/// the alignment pushes to the next word. The block is a separate allocation
/// so that an array can grow without the object moving, which is the whole
/// reason it is a pointer rather than a tail.
pub const ELEMENTS_OFFSET: u32 = HEADER.size + POINTER;

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
        // Native and managed pointers occupy one word. Tracing is a separate
        // question; a native pointer never enters the descriptor's roots.
        // Every managed value is one pointer, which is what lets a field whose
        // type has no layout be emitted opaque and still be placed exactly.
        HirType::NativePointer(_) | HirType::Managed(
            ManagedType::String
            | ManagedType::Symbol
            | ManagedType::Date
            | ManagedType::Buffer
            | ManagedType::View(_)
            | ManagedType::AnyView
            | ManagedType::DataView
            | ManagedType::Object(_)
            | ManagedType::Array(_)
            | ManagedType::Promise(_)
            | ManagedType::Map(_, _)
            // The same pointer to the same `NtsMap`. This is the arm the
            // `Table` variant's documentation calls the expected shape.
            | ManagedType::Table(_, _)
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
    /// Where a bit-field sits inside the byte at its offset, and how wide it
    /// is. `None` for every member that begins on a byte, which is all of them
    /// unless the record declares a `Bits<T, N>`.
    ///
    /// Empty when nothing in the record is a bit-field, so the common case
    /// allocates no vector and every existing reader that ignores this sees
    /// exactly what it saw before.
    pub bits: Vec<Option<BitPlace>>,
    pub size: u32,
    pub align: u32,
}

/// A bit-field's position, as clang's `-fdump-record-layouts` reports one.
///
/// `lo` is counted from the least significant bit of the byte at the field's
/// offset, so it is always under 8; the field itself may run past that byte and
/// clang prints the end that way -- `0:3-9` is a 7-bit field three bits into
/// byte zero. Little-endian only, which this compiler is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BitPlace {
    pub lo: u32,
    pub width: u32,
}

/// Lay out an object's fields after its header.
///
/// `None` if any field has no shape, which is a field of type `void` or
/// `never`: there is nothing to place and the object is not one this can
/// describe.
#[must_use]
pub fn place(fields: &[Field]) -> Option<Placement> {
    place_shapes(fields.iter().map(|field| shape_of(&field.ty)), HEADER)
}

/// A native C payload starts at zero, independently of the managed header.
///
/// Three layouts, not one. A union's members all begin at the same address and
/// the whole is as large as the largest, rounded to the strictest alignment. A
/// packed struct has no padding anywhere and an alignment of one, so its members
/// are a running sum. Only the ordinary struct is `place_shapes`.
#[must_use]
pub fn native_place(layout: &crate::hir::native::Record) -> Option<Placement> {
    use crate::hir::native::{Pointee, RecordKind};
    let shapes = layout
        .fields
        .iter()
        .map(|field| native_shape(&field.ty))
        .collect::<Option<Vec<_>>>()?;
    if layout.kind == RecordKind::Union {
        // A union of nothing has no alignment to round to, and C has no such
        // type: a member list is required. Refused rather than given a size.
        let align = shapes.iter().map(|s| s.align).max()?;
        let largest = shapes.iter().map(|s| s.size).max()?;
        return Some(Placement {
            offsets: vec![0; shapes.len()],
            bits: Vec::new(),
            size: round_up(largest, align)?,
            align,
        });
    }
    // `__attribute__((packed))` changes the bit-field rule as well as the byte
    // one -- a packed bit-field is not bumped to the next storage unit -- and
    // no consumer has asked for the combination. Refused rather than laid out
    // by the unpacked rule, which would agree with the header only by accident.
    if layout.packed && layout.fields.iter().any(|f| matches!(f.ty, Pointee::Bits { .. })) {
        return None;
    }
    if layout.fields.iter().any(|f| matches!(f.ty, Pointee::Bits { .. })) {
        return place_bit_fields(layout, &shapes);
    }
    if layout.packed {
        let mut at = 0u32;
        let mut offsets = Vec::with_capacity(shapes.len());
        for shape in &shapes {
            offsets.push(at);
            at = at.checked_add(shape.size)?;
        }
        // Alignment 1 and *no* final rounding: that pair is what makes
        // `struct epoll_event` 12 bytes rather than 16, and an array of them
        // contiguous rather than padded.
        return Some(Placement { offsets, bits: Vec::new(), size: at, align: 1 });
    }
    place_shapes(shapes.into_iter().map(Some), Shape { size: 0, align: 1 })
}

#[must_use]
pub fn native_shape(pointee: &crate::hir::native::Pointee) -> Option<Shape> {
    use crate::hir::native::Pointee;
    match pointee {
        Pointee::Record(layout) => native_place(layout).map(|p| Shape { size: p.size, align: p.align }),
        Pointee::Opaque(_) => None,
        // `T[N]` is N elements with the element's alignment, and named here
        // rather than left to the catch-all below: `element_type` decays an
        // array to its element, so falling through would have sized a
        // `char[65]` as one byte -- a wrong answer that the emitted
        // `_Static_assert` would have caught only because the C compiler
        // disagreed, and nothing would have caught at all had the assert not
        // existed.
        Pointee::Array { element, length } => {
            let inner = native_shape(element)?;
            Some(Shape {
                size: inner.size.checked_mul(*length)?,
                align: inner.align,
            })
        }
        // The same bytes, with no alignment to promise. Naming it here rather
        // than letting it fall through matters for a packed record inside
        // another: the inner one's alignment must not raise the outer's.
        Pointee::Unaligned(inner) => native_shape(inner).map(|s| Shape { size: s.size, align: 1 }),
        _ => shape_of(&pointee.element_type()?),
    }
}

/// A struct holding at least one bit-field, allocated in bits rather than bytes.
///
/// The rule is not read from the ABI document but from clang, on three probe
/// structs written to separate the cases:
///
/// ```text
/// unsigned int a : 3;  unsigned int b : 7;     0:0-2   0:3-9
/// unsigned int a : 30; unsigned int b : 5;     0:0-29  4:0-4
/// unsigned char p : 6; unsigned int  q : 30;   0:0-5   4:0-29
/// ```
///
/// The first says a bit-field simply continues where the last one ended, across
/// a byte boundary. The second and third say **when it does not**: a field is
/// bumped to the next multiple of its own unit's width whenever staying put
/// would straddle one. The third is the discriminating case, because the unit
/// that decides the bump is the *new* field's, not the previous field's.
///
/// An ordinary member still begins on a byte, at its own alignment, after
/// whatever bits precede it.
fn place_bit_fields(
    layout: &crate::hir::native::Record,
    shapes: &[Shape],
) -> Option<Placement> {
    use crate::hir::native::Pointee;
    let mut at = 0u64; // bits from the start of the record
    let mut align = 1u32;
    let mut offsets = Vec::with_capacity(shapes.len());
    let mut bits = Vec::with_capacity(shapes.len());
    for (field, shape) in layout.fields.iter().zip(shapes) {
        align = align.max(shape.align);
        if let Pointee::Bits { width, .. } = field.ty {
            let unit = u64::from(shape.size).checked_mul(8)?;
            if unit == 0 {
                return None;
            }
            if at % unit + u64::from(width) > unit {
                at = at.checked_add(unit - at % unit)?;
            }
            let byte = at / 8;
            offsets.push(u32::try_from(byte).ok()?);
            bits.push(Some(BitPlace {
                lo: u32::try_from(at - byte * 8).ok()?,
                width,
            }));
            at = at.checked_add(u64::from(width))?;
            continue;
        }
        let byte = round_up(u32::try_from(at.div_ceil(8)).ok()?, shape.align)?;
        offsets.push(byte);
        bits.push(None);
        at = u64::from(byte.checked_add(shape.size)?).checked_mul(8)?;
    }
    Some(Placement {
        offsets,
        bits,
        size: round_up(u32::try_from(at.div_ceil(8)).ok()?, align)?,
        align,
    })
}

fn place_shapes(shapes: impl IntoIterator<Item = Option<Shape>>, prefix: Shape) -> Option<Placement> {
    let mut at = prefix.size;
    let mut align = prefix.align;
    let mut offsets = Vec::new();
    for shape in shapes {
        let shape = shape?;
        at = round_up(at, shape.align)?;
        offsets.push(at);
        at = at.checked_add(shape.size)?;
        align = align.max(shape.align);
    }
    Some(Placement {
        offsets,
        bits: Vec::new(),
        size: round_up(at, align)?,
        align,
    })
}

/// The next multiple of `align` at or after `value`.
///
/// `align` is a power of two for every shape above, so this is the usual mask —
/// written as arithmetic anyway, because the one case that is not a power of
/// two would be silently wrong under the mask and merely wrong here.
fn round_up(value: u32, align: u32) -> Option<u32> {
    if align == 0 { return None; }
    value.checked_add(align - 1).map(|n| n / align * align)
}

#[cfg(test)]
mod tests {
    use super::{place, shape_of, Placement, HEADER, POINTER};
    use crate::hir::{Field, HirType, ManagedType};

    fn field(name: &str, ty: HirType) -> Field {
        Field {
            name: name.to_owned(),
            ty,
            readonly: false,
            // Placement depends on width and order, never on who declared what.
            declared_by: None,
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
