//! `StackMapTable`: the frames the verifier is not willing to infer.
//!
//! # Why this is eighty lines and not three thousand
//!
//! Since class file version 50 the verifier does not infer types; it checks
//! them against frames the class file supplies at every branch target. Writing
//! those frames in general means abstract interpretation over a class
//! hierarchy, with merges at every join -- which is why ASM's `COMPUTE_FRAMES`
//! is a substantial piece of software.
//!
//! None of that is needed here, because three properties of what this backend
//! emits collapse the problem, and each is a property we choose rather than one
//! we hope for:
//!
//! 1. **The operand stack is empty at every block boundary.** Every HIR
//!    operation lowers to *load operands, operate, store result*, so nothing
//!    survives a jump. [`super::code::Code::bind`] refuses to bind a label with
//!    a non-empty stack, which turns the property into a checked invariant
//!    rather than a belief.
//! 2. **Every local has one type for the whole method.** One slot per SSA
//!    value, typed by the value, and an SSA value's type never changes. There
//!    is no merge to compute because there is nothing to merge.
//! 3. **Every slot is definitely assigned before the first branch**, because
//!    the emitter writes a prologue storing a default into each one.
//!
//! So the entire table is: one `full_frame` at the first branch target listing
//! every slot, and `same_frame` at each one after it. It is a pure function of
//! the slot table, and it cannot drift from the code because it does not read
//! the code.
//!
//! A compiler without a typed IR could not do this, which is worth saying
//! because it is the reason a bytecode backend is a reasonable amount of work
//! here and would not be elsewhere.

use crate::pool::Pool;

/// A verification type: what the verifier believes is in a slot.
///
/// `Long` and `Double` are one entry each and implicitly occupy the following
/// slot, so the entry count in a frame is not the slot count -- JVMS 4.7.4
/// spells the rule out and getting it wrong shifts every later local by one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VType {
    /// Unusable. The second half of a `Long` or `Double` never appears as an
    /// entry, so this is only for a slot nothing has assigned.
    Top,
    Integer,
    Float,
    Double,
    Long,
    /// `aconst_null`, which is assignable to any reference -- which is why a
    /// reference slot may be initialized with it and still declared as its
    /// real type.
    Null,
    Object(String),
}

impl VType {
    const fn tag(&self) -> u8 {
        match self {
            Self::Top => 0,
            Self::Integer => 1,
            Self::Float => 2,
            Self::Double => 3,
            Self::Long => 4,
            Self::Null => 5,
            Self::Object(_) => 7,
        }
    }

    /// Slots consumed, which is two for the wide kinds and one otherwise.
    #[must_use]
    pub const fn slots(&self) -> u16 {
        match self {
            Self::Long | Self::Double => 2,
            _ => 1,
        }
    }

    fn write(&self, pool: &mut Pool, out: &mut Vec<u8>) {
        out.push(self.tag());
        if let Self::Object(name) = self {
            let index = pool.class(name);
            out.extend_from_slice(&index.to_be_bytes());
        }
    }
}

/// The `StackMapTable` attribute's body for a method whose frame is constant.
///
/// `locals` is the whole slot table as verification entries, in slot order.
/// `offsets` are the bytecode offsets needing a frame, sorted and without
/// duplicates; offset zero is dropped because the method's entry frame is
/// implicit and describes the parameters rather than the prologue's result.
///
/// Returns `None` when there is nothing to write, which is the common case for
/// a straight-line method and means the attribute must be omitted rather than
/// written empty.
#[must_use]
pub fn stack_map_table(pool: &mut Pool, locals: &[VType], offsets: &[u16]) -> Option<Vec<u8>> {
    let mut wanted = offsets.iter().copied().filter(|&at| at != 0).peekable();
    wanted.peek()?;
    let offsets: Vec<u16> = wanted.collect();

    let mut body = Vec::new();
    let count = u16::try_from(offsets.len()).unwrap_or(u16::MAX);
    body.extend_from_slice(&count.to_be_bytes());

    let mut previous: Option<u16> = None;
    for (nth, &at) in offsets.iter().enumerate() {
        // JVMS 4.7.4: the first frame's delta is its offset; every later one is
        // measured from *one past* the previous frame. The `- 1` is the whole
        // reason a hand-written table is usually wrong the first time.
        let delta = match previous {
            None => at,
            Some(last) => at.saturating_sub(last).saturating_sub(1),
        };
        if nth == 0 {
            body.push(255); // full_frame
            body.extend_from_slice(&delta.to_be_bytes());
            let entries = u16::try_from(locals.len()).unwrap_or(u16::MAX);
            body.extend_from_slice(&entries.to_be_bytes());
            for local in locals {
                local.write(pool, &mut body);
            }
            body.extend_from_slice(&0u16.to_be_bytes()); // the stack, empty
        } else if delta <= 63 {
            // same_frame, whose type byte *is* the delta.
            body.push(u8::try_from(delta).unwrap_or(63));
        } else {
            body.push(251); // same_frame_extended
            body.extend_from_slice(&delta.to_be_bytes());
        }
        previous = Some(at);
    }
    Some(body)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;

    #[test]
    fn nothing_to_write_for_straight_line_code() {
        let mut pool = Pool::new();
        assert!(stack_map_table(&mut pool, &[VType::Integer], &[]).is_none());
        assert!(
            stack_map_table(&mut pool, &[VType::Integer], &[0]).is_none(),
            "the entry frame is implicit"
        );
    }

    #[test]
    fn the_first_delta_is_the_offset_and_the_rest_are_one_less() {
        let mut pool = Pool::new();
        let body = stack_map_table(&mut pool, &[VType::Integer], &[10, 20, 21]).unwrap();
        assert_eq!(&body[0..2], &3u16.to_be_bytes(), "three frames");
        assert_eq!(body[2], 255, "the first is a full frame");
        assert_eq!(&body[3..5], &10u16.to_be_bytes(), "its delta is its offset");
        // full_frame: 1 + 2 + 2 (locals count) + 1 (Integer) + 2 (stack count)
        let after_full = 2 + 1 + 2 + 2 + 1 + 2;
        assert_eq!(body[after_full], 9, "20 is nine past one-after-10");
        assert_eq!(body[after_full + 1], 0, "21 is adjacent, so delta zero");
    }

    #[test]
    fn a_wide_local_is_one_entry_and_two_slots() {
        assert_eq!(VType::Double.slots(), 2);
        assert_eq!(VType::Integer.slots(), 1);
    }
}
