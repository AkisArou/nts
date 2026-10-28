//! The shared value contract for `T | undefined`.
//!
//! Definedness belongs to the value. Container occupancy is a separate fact:
//! a present entry holding undefined and a missing entry have the same read
//! result but different `has` answers. Neither a declared type nor an arbitrary
//! numeric payload proves this component redundant.

use super::{HirType, ValueId};

mod erasure;
mod verification;
pub(super) use erasure::lower_erasures;
pub(super) use verification::verify;

/// Both components of one SSA value, carried together through copies and phis.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Components {
    pub defined: ValueId,
    pub payload: ValueId,
}

/// A payload whose representation can be extended with undefined.
///
/// An erased value already carries undefined in its dynamic tag. Treating it
/// as a fresh optional would introduce a second, contradictory discriminator.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Payload(HirType);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvalidPayload {
    NoValue,
    AlreadyDynamic,
    AlreadyOptional,
    CountedForeignHandle,
    UnsupportedWidth,
}

/// Physical transport selected from the payload representation, not source
/// annotations. Native aggregate classification remains the target ABI's job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    /// The target has no payload representation; the wrapper cannot add one.
    Unsupported,
    /// Null and an immortal undefined reference are distinct pointer values.
    ReferenceNiche,
    /// Every payload bit and the defined component travel as a typed aggregate.
    NativeAggregate,
    /// JVM arguments and locals carry separate primitive components.
    SplitPrimitives,
    /// A JVM primitive word has room for every payload bit plus definedness.
    PackedWord { bits: u8 },
    /// A JVM call returns boolean and writes to caller-owned payload scratch.
    CallerScratch,
}

impl Payload {
    pub fn new(ty: HirType) -> Result<Self, InvalidPayload> {
        match ty {
            HirType::Void | HirType::Never => Err(InvalidPayload::NoValue),
            HirType::Erased => Err(InvalidPayload::AlreadyDynamic),
            HirType::PossiblyUndefined(_) => Err(InvalidPayload::AlreadyOptional),
            ref foreign if foreign.counting().is_some() => {
                Err(InvalidPayload::CountedForeignHandle)
            }
            HirType::Int { bits, .. } if !matches!(bits, 8 | 16 | 32 | 64) => {
                Err(InvalidPayload::UnsupportedWidth)
            }
            HirType::Float { bits } if !matches!(bits, 32 | 64) => {
                Err(InvalidPayload::UnsupportedWidth)
            }
            _ => Ok(Self(ty)),
        }
    }

    #[must_use]
    pub fn ty(&self) -> &HirType {
        &self.0
    }

    #[must_use]
    pub fn into_type(self) -> HirType {
        HirType::PossiblyUndefined(Box::new(self.0))
    }

    /// Physical C spelling shared by native locals, fields and return values.
    /// Typed reference casts belong at a proved payload projection, not here.
    #[must_use]
    pub fn native_name(&self) -> &'static str {
        match self.0 {
            HirType::Managed(_) => "NtsHeader *",
            HirType::Bool => "NtsOptionalBool",
            HirType::Int {
                bits: 8,
                signed: true,
            } => "NtsOptionalI8",
            HirType::Int {
                bits: 8,
                signed: false,
            } => "NtsOptionalU8",
            HirType::Int {
                bits: 16,
                signed: true,
            } => "NtsOptionalI16",
            HirType::Int {
                bits: 16,
                signed: false,
            } => "NtsOptionalU16",
            HirType::Int {
                bits: 32,
                signed: true,
            } => "NtsOptionalI32",
            HirType::Int {
                bits: 32,
                signed: false,
            } => "NtsOptionalU32",
            HirType::Int { signed: true, .. } => "NtsOptionalI64",
            HirType::Int { signed: false, .. } => "NtsOptionalU64",
            HirType::Float { bits: 32 } => "NtsOptionalF32",
            HirType::Float { .. } => "NtsOptionalF64",
            HirType::BigInt => "NtsOptionalBigInt",
            HirType::NativePointer(_) => "NtsOptionalPointer",
            _ => unreachable!("Payload construction rejects non-payload types"),
        }
    }

    #[must_use]
    pub fn native_transport(&self) -> Transport {
        if matches!(self.0, HirType::Managed(_)) {
            Transport::ReferenceNiche
        } else {
            Transport::NativeAggregate
        }
    }

    /// This is a storage/return decision. Primitive arguments and local SSA
    /// remain split; no scratch is needed merely to pass an optional value.
    #[must_use]
    pub fn jvm_return_transport(&self) -> Transport {
        match self.0 {
            HirType::NativePointer(_) | HirType::Managed(super::ManagedType::Region) => {
                Transport::Unsupported
            }
            HirType::Managed(_) | HirType::BigInt => Transport::ReferenceNiche,
            HirType::Bool => Transport::PackedWord { bits: 32 },
            HirType::Float { bits: 32 } => Transport::PackedWord { bits: 64 },
            HirType::Int { bits, .. } if bits < 32 => Transport::PackedWord { bits: 32 },
            HirType::Int { bits, .. } if bits < 64 => Transport::PackedWord { bits: 64 },
            _ => Transport::CallerScratch,
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used)]
    use super::{InvalidPayload, Payload, Transport};
    use crate::hir::{HirType, ManagedType, native::Pointee};

    #[test]
    fn floats_preserve_every_payload_bit_and_do_not_reserve_a_nan() {
        let payload = Payload::new(HirType::NUMBER).expect("f64 is a payload");
        assert_eq!(payload.native_transport(), Transport::NativeAggregate);
        assert_eq!(payload.jvm_return_transport(), Transport::CallerScratch);
    }

    #[test]
    fn dynamic_values_have_one_discriminator_and_no_value_is_not_a_payload() {
        assert_eq!(
            Payload::new(HirType::Erased),
            Err(InvalidPayload::AlreadyDynamic)
        );
        for ty in [HirType::Void, HirType::Never] {
            assert_eq!(Payload::new(ty), Err(InvalidPayload::NoValue));
        }
    }

    #[test]
    fn managed_reference_niches_do_not_apply_to_native_addresses() {
        let managed = Payload::new(HirType::Managed(ManagedType::String))
            .expect("a managed reference is a payload");
        assert_eq!(managed.native_transport(), Transport::ReferenceNiche);
        let native = Payload::new(HirType::NativePointer(Pointee::Void))
            .expect("an opaque native address is a payload");
        assert_eq!(native.native_transport(), Transport::NativeAggregate);
        let region =
            Payload::new(HirType::Managed(ManagedType::Region)).expect("a native region handle");
        assert_eq!(region.jvm_return_transport(), Transport::Unsupported);
    }
}
