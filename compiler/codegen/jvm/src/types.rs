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

use nts_codegen_common::symbols::jvm_class_name;
use nts_core::hir::{HirType, Layout, ManagedType, Program};
use nts_jvm_emitter::{Kind, VType};

/// The two properties the tag *numbering* exists to make true.
///
/// Asserted at compile time rather than in a test, because they are facts about
/// two constants and there is no run in which they could differ. A backend that
/// depends on `tag >= OBJECT` meaning "object" should not build against a table
/// where that is false.
///
/// A renumbering that kept every name would pass a table comparison and make
/// `typeof f` answer `"object"` in every program, so these are stated
/// separately from the table rather than implied by it.
const _: () = assert!(
    nts_core::hir::tags::NULL > nts_core::hir::tags::OBJECT,
    "`typeof x === \"object\"` is emitted as `tag >= OBJECT`, so null must be inside that range"
);
const _: () = assert!(
    nts_core::hir::tags::FUNCTION < nts_core::hir::tags::OBJECT,
    "a closure must fall outside `tag >= OBJECT`, or `typeof f` answers \"object\""
);

/// The erased value: a tag beside a payload, mirroring the C struct.
pub const VALUE: &str = "nts/rt/NtsValue";
pub const VALUE_DESCRIPTOR: &str = "Lnts/rt/NtsValue;";

/// `java.lang.String`, the JVM's name for it.
pub const STRING: &str = "java/lang/String";
pub const STRING_DESCRIPTOR: &str = "Ljava/lang/String;";

/// The binary name of the class one layout becomes.
///
/// One class per `Layout`, not per source type: structural typing merges
/// `Point` and the anonymous `{ x: number; y: number }` of a literal into one
/// layout, and giving them separate classes would emit two classes that are the
/// same class and could not be passed to each other.
#[must_use]
pub fn class_name(layout: &Layout) -> String {
    jvm_class_name(&layout.name)
}

/// The descriptor for a parameter, result or field.
///
/// `None` is a type this backend cannot represent yet, which is a refusal by
/// name rather than a guess.
#[must_use]
pub fn descriptor(program: &Program, ty: &HirType) -> Option<String> {
    Some(match ty {
        HirType::Void => "V".to_owned(),
        HirType::Bool => "Z".to_owned(),
        HirType::Int { bits: 64, .. } => "J".to_owned(),
        HirType::Int { .. } => "I".to_owned(),
        HirType::Float { bits: 32 } => "F".to_owned(),
        HirType::Float { .. } => "D".to_owned(),
        HirType::Managed(ManagedType::Object(id)) => {
            nts_jvm_emitter::descriptor::object(&class_name(program.layout(*id)?))
        }
        // UTF-16 code units with a compact one-byte/two-byte representation --
        // which is what `NtsString` implements by hand and what JavaScript's
        // string *is*. `length`, `charAt`, `substring` and `equals` are already
        // the language's semantics, and JIT intrinsics besides.
        HirType::Managed(ManagedType::String) => STRING_DESCRIPTOR.to_owned(),
        // A tag beside a payload, the same three fields and the same tag
        // numbering as the C struct -- so `hir::tags` stays one fact and
        // `typeof x === "object"` stays the single comparison `tag >= OBJECT`,
        // which erasing to a bare `Object` and testing with `instanceof` would
        // throw away.
        HirType::Erased => VALUE_DESCRIPTOR.to_owned(),
        // A bare JVM array, which is what a Java programmer writes and what the
        // hand-written reference will use. `arraylength` is one instruction,
        // the bounds check is mandatory *and* eliminated in a counted loop, and
        // there is no header to lay out.
        //
        // Only correct for a program where no array grows: a Java array cannot,
        // so a growing one needs an object with a `double[]` and a length
        // inside it. `emit` refuses such a program whole, which is the right
        // granularity because `arrays_can_grow` is a whole-program property.
        HirType::Managed(ManagedType::Array(element)) => {
            nts_jvm_emitter::descriptor::array_of(&descriptor(program, element)?)
        }
        // Strings, arrays, `Erased` and `BigInt` arrive in later steps.
        // Answering here would emit something for a type nothing implements.
        HirType::Never | HirType::BigInt | HirType::Managed(_) => return None,
    })
}

/// How a value of this type is computed and stored.
#[must_use]
pub fn kind(ty: &HirType) -> Option<Kind> {
    Some(match ty {
        HirType::Erased
        | HirType::Managed(
            ManagedType::Object(_) | ManagedType::String | ManagedType::Array(_),
        ) => Kind::Ref,
        HirType::Int { bits: 64, .. } => Kind::Long,
        // A `boolean` is an `int` everywhere except in a descriptor: there is
        // no narrower computational type on this machine.
        HirType::Bool | HirType::Int { .. } => Kind::Int,
        HirType::Float { bits: 32 } => Kind::Float,
        HirType::Float { .. } => Kind::Double,
        HirType::Void | HirType::Never | HirType::BigInt | HirType::Managed(_) => return None,
    })
}

/// The frame entry for a slot holding this type.
#[must_use]
pub fn vtype(program: &Program, ty: &HirType) -> Option<VType> {
    Some(match kind(ty)? {
        Kind::Int => VType::Integer,
        Kind::Long => VType::Long,
        Kind::Float => VType::Float,
        Kind::Double => VType::Double,
        Kind::Ref => match ty {
            HirType::Erased => VType::Object(VALUE.to_owned()),
            HirType::Managed(ManagedType::String) => VType::Object(STRING.to_owned()),
            // An array's *class* constant is named by its descriptor rather
            // than by an internal name: `[D`, not `D` and not `L[D;`.
            HirType::Managed(ManagedType::Array(_)) => {
                VType::Object(descriptor(program, ty)?)
            }
            HirType::Managed(ManagedType::Object(id)) => {
                VType::Object(class_name(program.layout(*id)?))
            }
            _ => return None,
        },
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

    fn empty() -> Program {
        Program::default()
    }

    #[test]
    fn a_narrow_integer_is_an_int_in_every_vocabulary_but_none() {
        let byte = HirType::Int { bits: 8, signed: true };
        assert_eq!(descriptor(&empty(), &byte).as_deref(), Some("I"));
        assert_eq!(kind(&byte), Some(Kind::Int));
        assert_eq!(vtype(&empty(), &byte), Some(VType::Integer));
    }

    #[test]
    fn a_bool_is_an_int_to_compute_and_a_z_to_declare() {
        assert_eq!(descriptor(&empty(), &HirType::Bool).as_deref(), Some("Z"));
        assert_eq!(kind(&HirType::Bool), Some(Kind::Int));
    }

    #[test]
    fn sixty_four_bits_is_the_only_wide_integer() {
        let long = HirType::Int { bits: 64, signed: true };
        assert_eq!(descriptor(&empty(), &long).as_deref(), Some("J"));
        assert_eq!(kind(&long), Some(Kind::Long));
        assert_eq!(vtype(&empty(), &long), Some(VType::Long));
    }

    #[test]
    fn what_this_slice_does_not_represent_says_so() {
        for ty in [HirType::BigInt, HirType::Never] {
            assert_eq!(descriptor(&empty(), &ty), None, "{ty:?}");
        }
        assert_eq!(descriptor(&empty(), &HirType::Void).as_deref(), Some("V"));
        assert_eq!(kind(&HirType::Void), None, "void has no computational kind");
    }
}
