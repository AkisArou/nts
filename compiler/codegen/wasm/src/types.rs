//! Physical scalar slots and the public JS boundary contract.

use nts_core::hir::HirType;
use serde::{Deserialize, Serialize};
use wasm_encoder::{RefType, ValType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Slot {
    I32,
    I64,
    F32,
    F64,
}

impl Slot {
    pub(crate) const fn wasm(self) -> ValType {
        match self {
            Self::I32 => ValType::I32,
            Self::I64 => ValType::I64,
            Self::F32 => ValType::F32,
            Self::F64 => ValType::F64,
        }
    }
}

/// A resolved module-local slot. Numeric selection only accepts Scalar's Slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Physical {
    Scalar(Slot),
    Reference(RefType),
}

impl Physical {
    pub(crate) const fn wasm(self) -> ValType {
        match self {
            Self::Scalar(slot) => slot.wasm(),
            Self::Reference(reference) => ValType::Ref(reference),
        }
    }
}

pub(crate) fn slot(ty: &HirType) -> Result<Option<Slot>, String> {
    match ty {
        HirType::Void | HirType::Never => Ok(None),
        HirType::Bool
        | HirType::Int {
            bits: 8 | 16 | 32, ..
        } => Ok(Some(Slot::I32)),
        HirType::Int { bits: 64, .. } => Ok(Some(Slot::I64)),
        HirType::Float { bits: 32 } => Ok(Some(Slot::F32)),
        HirType::Float { bits: 64 } => Ok(Some(Slot::F64)),
        HirType::Int { .. }
        | HirType::Float { .. }
        | HirType::BigInt
        | HirType::NativePointer(_)
        | HirType::Erased
        | HirType::Managed(_) => Err(format!(
            "a value of type {ty:?}, outside the scalar wasm slice"
        )),
    }
}

pub(crate) fn value_slot(ty: &HirType) -> Result<Slot, String> {
    slot(ty)?.ok_or_else(|| format!("a value slot of type {ty:?}"))
}

/// The logical type, including signedness and narrow widths that wasm shares.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BoundaryType {
    Void,
    Bool,
    String,
    Int { bits: u8, signed: bool },
    Float { bits: u8 },
}

impl BoundaryType {
    pub(crate) fn from_hir(ty: &HirType) -> Result<Self, String> {
        if matches!(ty, HirType::Managed(nts_core::hir::ManagedType::String)) {
            return Ok(Self::String);
        }
        slot(ty)?;
        match ty {
            HirType::Void | HirType::Never => Ok(Self::Void),
            HirType::Bool => Ok(Self::Bool),
            HirType::Int { bits, signed } => Ok(Self::Int {
                bits: *bits,
                signed: *signed,
            }),
            HirType::Float { bits } => Ok(Self::Float { bits: *bits }),
            HirType::BigInt | HirType::NativePointer(_) | HirType::Erased | HirType::Managed(_) => {
                Err(format!("a public boundary of type {ty:?}"))
            }
        }
    }
}
