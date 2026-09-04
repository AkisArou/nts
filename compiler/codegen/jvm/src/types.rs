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

/// A promise: a settled-or-not value and the frames waiting on it.
pub const PROMISE: &str = "nts/rt/NtsPromise";
pub const PROMISE_DESCRIPTOR: &str = "Lnts/rt/NtsPromise;";

/// The interface a suspended function's frame implements, so the loop can run
/// it. Created by this backend rather than recovered from the IR: `Suspend`
/// names a frame and a function, and both are emitted here.
pub const RESUMABLE: &str = "nts/rt/NtsResumable";

/// The program a backend is rendering, and the one whole-program fact that
/// changes how a type is spelled.
///
/// A struct rather than two parameters because `grows` is not a property of the
/// *type* -- `number[]` is a `[D` in one program and an `NtsArrayD` in another,
/// and which it is depends on whether anything, anywhere, calls `push`. Passing
/// the program without it made that decision unavailable at the only place it
/// could be made.
#[derive(Clone, Copy, Debug)]
pub struct Shape<'a> {
    pub program: &'a Program,
    pub grows: bool,
}

impl<'a> Shape<'a> {
    #[must_use]
    pub fn of(program: &'a Program) -> Self {
        Self { program, grows: nts_core::hir::arrays_can_grow(program) }
    }
}

/// The wrapper class for an array of this element type.
fn growable(shape: Shape<'_>, element: &HirType) -> Option<String> {
    Some(match kind(element)? {
        Kind::Double => "Lnts/rt/NtsArrayD;".to_owned(),
        Kind::Ref => "Lnts/rt/NtsArrayL;".to_owned(),
        // `boolean[]` and the narrow integers have no wrapper yet. Refused by
        // name rather than widened to `NtsArrayD`, which would answer `1` where
        // the language answers `true`.
        _ => {
            let _ = shape;
            return None;
        }
    })
}

/// `Map` and `Set`, which are one table with the values left out of one of them.
pub const MAP: &str = "nts/rt/NtsMap";
pub const MAP_DESCRIPTOR: &str = "Lnts/rt/NtsMap;";

/// The 128-bit integer, which the JVM has no primitive for.
pub const BIGINT: &str = "nts/rt/NtsBigInt";
pub const BIGINT_DESCRIPTOR: &str = "Lnts/rt/NtsBigInt;";

/// The descriptor for a parameter, result or field.
///
/// `None` is a type this backend cannot represent yet, which is a refusal by
/// name rather than a guess.
#[must_use]
pub fn descriptor(shape: Shape<'_>, ty: &HirType) -> Option<String> {
    let program = shape.program;
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
        // Two `long`s in a `final class`, not `BigInteger`. This compiler's
        // `bigint` is exactly 128 bits and refuses a literal that does not fit,
        // so `BigInteger` would be *more* correct than the C lane -- and the
        // two would then disagree on precisely the inputs that matter, with
        // `agrees_with_c` as the oracle because node's arbitrary precision is
        // not one.
        HirType::BigInt => BIGINT_DESCRIPTOR.to_owned(),
        // One runtime class for both, and its keys and values are erased --
        // which is why the payload types in `ManagedType::Map` are for the
        // compiler rather than the runtime, exactly as that type's own comment
        // says. This is not a monomorphization.
        HirType::Managed(ManagedType::Map(..) | ManagedType::Set(_)) => {
            MAP_DESCRIPTOR.to_owned()
        }
        // One runtime class whatever it settles with, which is what
        // `ManagedType::Promise`'s payload type says it is for: the payload is
        // in the type for the *compiler*, to choose which `fulfill` to emit and
        // how to read the value back. Not a monomorphization.
        HirType::Managed(ManagedType::Promise(_)) => PROMISE_DESCRIPTOR.to_owned(),
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
            if shape.grows {
                // Whole-program: one `push` anywhere puts every array behind a
                // wrapper, because an array that grows cannot keep its elements
                // inline after its own header without moving.
                //
                // Record 0088 measured that at **1.4%** here against **4.02x**
                // on the native lane, so the refusal this replaces was worth
                // having until the number existed and is not worth having now.
                // The bare array stays for a program that never grows one,
                // because 1.4% on the AWFY rows is 1.4% off the only comparison
                // this lane exists to make.
                growable(shape, element)?
            } else {
                nts_jvm_emitter::descriptor::array_of(&descriptor(shape, element)?)
            }
        }
        // Every `ManagedType` is spelled above, so there is no catch-all here
        // and adding a variant upstream is a compile error rather than a
        // silent refusal. `never` reaching a value position means control got
        // somewhere the type system said it could not.
        HirType::Never => return None,
    })
}

/// How a value of this type is computed and stored.
#[must_use]
pub fn kind(ty: &HirType) -> Option<Kind> {
    Some(match ty {
        HirType::Erased
        | HirType::BigInt
        | HirType::Managed(
            ManagedType::Object(_)
            | ManagedType::String
            | ManagedType::Array(_)
            | ManagedType::Map(..)
            | ManagedType::Set(_)
            | ManagedType::Promise(_),
        ) => Kind::Ref,
        HirType::Int { bits: 64, .. } => Kind::Long,
        // A `boolean` is an `int` everywhere except in a descriptor: there is
        // no narrower computational type on this machine.
        HirType::Bool | HirType::Int { .. } => Kind::Int,
        HirType::Float { bits: 32 } => Kind::Float,
        HirType::Float { .. } => Kind::Double,
        HirType::Void | HirType::Never => return None,
    })
}

/// The frame entry for a slot holding this type.
#[must_use]
pub fn vtype(shape: Shape<'_>, ty: &HirType) -> Option<VType> {
    let program = shape.program;
    Some(match kind(ty)? {
        Kind::Int => VType::Integer,
        Kind::Long => VType::Long,
        Kind::Float => VType::Float,
        Kind::Double => VType::Double,
        Kind::Ref => match ty {
            HirType::Erased => VType::Object(VALUE.to_owned()),
            HirType::BigInt => VType::Object(BIGINT.to_owned()),
            HirType::Managed(ManagedType::Map(..) | ManagedType::Set(_)) => {
                VType::Object(MAP.to_owned())
            }
            HirType::Managed(ManagedType::Promise(_)) => VType::Object(PROMISE.to_owned()),
            HirType::Managed(ManagedType::String) => VType::Object(STRING.to_owned()),
            // An array's *class* constant is named by its descriptor rather
            // than by an internal name: `[D`, not `D` and not `L[D;`. That is
            // true of a **bare** array only -- a growable one is an ordinary
            // class and wants its internal name, and passing the descriptor
            // there is `ClassFormatError: Illegal class name
            // "Lnts/rt/NtsArrayD;"` at load.
            HirType::Managed(ManagedType::Array(element)) if shape.grows => {
                VType::Object(match kind(element) {
                    Some(Kind::Double) => "nts/rt/NtsArrayD".to_owned(),
                    Some(Kind::Ref) => "nts/rt/NtsArrayL".to_owned(),
                    _ => return None,
                })
            }
            HirType::Managed(ManagedType::Array(_)) => {
                VType::Object(descriptor(shape, ty)?)
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
        HirType::BigInt => "a bigint".to_owned(),
        HirType::Erased => "an erased value".to_owned(),
        HirType::Managed(ManagedType::String) => "a string".to_owned(),
        // The element, because the one message that most needs this is two
        // arrays that differ only in it -- `an array` twice says nothing about
        // why the two would not agree.
        HirType::Managed(ManagedType::Array(element)) => {
            format!("an array of {}", short(element))
        }
        HirType::Managed(ManagedType::Object(_)) => "an object".to_owned(),
        HirType::Managed(ManagedType::Promise(_)) => "a promise".to_owned(),
        HirType::Managed(ManagedType::Map(..)) => "a map".to_owned(),
        HirType::Managed(ManagedType::Set(_)) => "a set".to_owned(),
        HirType::Bool => "a boolean".to_owned(),
        HirType::Void => "nothing".to_owned(),
        HirType::Int { bits, signed } => {
            format!("{}{bits}", if *signed { "an i" } else { "a u" })
        }
        HirType::Float { bits } => format!("an f{bits}"),
    }
}

/// A type's name without the article, for reading inside another name.
fn short(ty: &HirType) -> String {
    match ty {
        HirType::Bool => "bool".to_owned(),
        HirType::Erased => "erased values".to_owned(),
        HirType::Int { bits, signed } => format!("{}{bits}", if *signed { "i" } else { "u" }),
        HirType::Float { bits } => format!("f{bits}"),
        HirType::Managed(ManagedType::String) => "strings".to_owned(),
        other => describe(other),
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
        assert_eq!(descriptor(Shape::of(&empty()), &byte).as_deref(), Some("I"));
        assert_eq!(kind(&byte), Some(Kind::Int));
        assert_eq!(vtype(Shape::of(&empty()), &byte), Some(VType::Integer));
    }

    #[test]
    fn a_bool_is_an_int_to_compute_and_a_z_to_declare() {
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::Bool).as_deref(), Some("Z"));
        assert_eq!(kind(&HirType::Bool), Some(Kind::Int));
    }

    #[test]
    fn sixty_four_bits_is_the_only_wide_integer() {
        let long = HirType::Int { bits: 64, signed: true };
        assert_eq!(descriptor(Shape::of(&empty()), &long).as_deref(), Some("J"));
        assert_eq!(kind(&long), Some(Kind::Long));
        assert_eq!(vtype(Shape::of(&empty()), &long), Some(VType::Long));
    }

    #[test]
    fn what_this_slice_does_not_represent_says_so() {
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::Never), None);
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::Void).as_deref(), Some("V"));
        assert_eq!(kind(&HirType::Void), None, "void has no computational kind");
    }

    /// A bigint is a reference on this backend, which is the whole of what
    /// makes it work: there is no 128-bit primitive, so it is a two-field
    /// object and every operation on one is a call.
    ///
    /// Pinned because the alternative that suggests itself -- `BigInteger` --
    /// would be *more* correct than the C lane rather than equal to it. This
    /// compiler's bigint is exactly 128 bits and refuses a literal that does
    /// not fit, so arbitrary precision would disagree with the other backends
    /// on precisely the inputs that matter, and `agrees_with_c` is the oracle
    /// here because node's `BigInt` is not one.
    #[test]
    fn a_bigint_is_a_reference_to_two_longs() {
        assert_eq!(descriptor(Shape::of(&empty()), &HirType::BigInt).as_deref(), Some(BIGINT_DESCRIPTOR));
        assert_eq!(kind(&HirType::BigInt), Some(Kind::Ref));
        assert_eq!(
            vtype(Shape::of(&empty()), &HirType::BigInt),
            Some(VType::Object(BIGINT.to_owned()))
        );
    }
}
