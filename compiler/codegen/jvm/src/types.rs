//! What a `HirType` is on the JVM: a descriptor, a computational kind, and a
//! verification type.
//!
//! # Three answers because the machine asks three questions
//!
//! The JVM has no integer type narrower than `int` *on the stack*, so a
//! `boolean`, a `byte` and a `short` are all computed as `int`s -- but a field
//! or a method parameter still spells itself `Z`, `B` or `S`, and the verifier
//! wants a fourth vocabulary again. Collapsing the three would be wrong in a
//! different place each time, so each has its own function and they are read
//! from the same match.
//!
//! # This backend's own ABI, deliberately
//!
//! Every integer narrower than 64 bits is `I` in a signature here, where the C
//! backend writes `int8_t` and `uint16_t`. Nothing links the two artifacts --
//! a class file and an object file never meet -- so the JVM lane is free to
//! take the spelling that cannot be got wrong, and the narrowing that *is*
//! observable arrives as an explicit `Convert` from the middle end rather than
//! being implied by a parameter's width.

use nts_core::hir::{HirType, ManagedType};
use nts_jvm_emitter::{Kind, VType};

/// The descriptor for a parameter, result or field.
///
/// `None` is a type this backend cannot represent yet, which is a refusal by
/// name rather than a guess.
#[must_use]
pub fn descriptor(ty: &HirType) -> Option<&'static str> {
    Some(match ty {
        HirType::Void => "V",
        HirType::Bool => "Z",
        HirType::Int { bits: 64, .. } => "J",
        HirType::Int { .. } => "I",
        HirType::Float { bits: 32 } => "F",
        HirType::Float { .. } => "D",
        // The managed slice, `Erased` and `BigInt` all arrive in later steps.
        // Answering here would emit something for a type nothing implements.
        HirType::Never | HirType::BigInt | HirType::Erased | HirType::Managed(_) => return None,
    })
}

/// How a value of this type is computed and stored.
#[must_use]
pub fn kind(ty: &HirType) -> Option<Kind> {
    Some(match ty {
        HirType::Int { bits: 64, .. } => Kind::Long,
        // A `boolean` is an `int` everywhere except in a descriptor: there is
        // no narrower computational type on this machine.
        HirType::Bool | HirType::Int { .. } => Kind::Int,
        HirType::Float { bits: 32 } => Kind::Float,
        HirType::Float { .. } => Kind::Double,
        HirType::Void | HirType::Never | HirType::BigInt | HirType::Erased | HirType::Managed(_) => {
            return None;
        }
    })
}

/// The frame entry for a slot holding this type.
#[must_use]
pub fn vtype(ty: &HirType) -> Option<VType> {
    Some(match kind(ty)? {
        Kind::Int => VType::Integer,
        Kind::Long => VType::Long,
        Kind::Float => VType::Float,
        Kind::Double => VType::Double,
        Kind::Ref => return None,
    })
}

/// What to call a type in a refusal, so the message names the construct rather
/// than an internal spelling.
#[must_use]
pub fn describe(ty: &HirType) -> String {
    match ty {
        HirType::Never => "a value of type `never`".to_owned(),
        HirType::BigInt => "a bigint, which needs a 128-bit pair the JVM has no primitive for"
            .to_owned(),
        HirType::Erased => "an erased value".to_owned(),
        HirType::Managed(ManagedType::String) => "a string".to_owned(),
        HirType::Managed(ManagedType::Array(_)) => "an array".to_owned(),
        HirType::Managed(ManagedType::Object(_)) => "an object".to_owned(),
        HirType::Managed(ManagedType::Promise(_)) => "a promise".to_owned(),
        HirType::Managed(ManagedType::Map(..)) => "a map".to_owned(),
        HirType::Managed(ManagedType::Set(_)) => "a set".to_owned(),
        other => format!("a value of type {other:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_narrow_integer_is_an_int_in_every_vocabulary_but_none() {
        let byte = HirType::Int { bits: 8, signed: true };
        assert_eq!(descriptor(&byte), Some("I"));
        assert_eq!(kind(&byte), Some(Kind::Int));
        assert_eq!(vtype(&byte), Some(VType::Integer));
    }

    #[test]
    fn a_bool_is_an_int_to_compute_and_a_z_to_declare() {
        assert_eq!(descriptor(&HirType::Bool), Some("Z"));
        assert_eq!(kind(&HirType::Bool), Some(Kind::Int));
    }

    #[test]
    fn sixty_four_bits_is_the_only_wide_integer() {
        let long = HirType::Int { bits: 64, signed: true };
        assert_eq!(descriptor(&long), Some("J"));
        assert_eq!(kind(&long), Some(Kind::Long));
        assert_eq!(vtype(&long), Some(VType::Long));
    }

    #[test]
    fn what_this_slice_does_not_represent_says_so() {
        for ty in [HirType::BigInt, HirType::Erased, HirType::Never] {
            assert_eq!(descriptor(&ty), None, "{ty:?}");
        }
        assert_eq!(descriptor(&HirType::Void), Some("V"));
        assert_eq!(kind(&HirType::Void), None, "void has no computational kind");
    }
}
