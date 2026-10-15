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
    /// A bigint: 128 bits in one value, lane 0 the low 64 (see `bigints.rs`).
    V128,
}

impl Slot {
    pub(crate) const fn wasm(self) -> ValType {
        match self {
            Self::I32 => ValType::I32,
            Self::I64 => ValType::I64,
            Self::F32 => ValType::F32,
            Self::F64 => ValType::F64,
            Self::V128 => ValType::V128,
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
    /// The physical type of a wasm value type, where this backend has one.
    pub(crate) const fn of(ty: ValType) -> Self {
        match ty {
            ValType::I32 => Self::Scalar(Slot::I32),
            ValType::I64 => Self::Scalar(Slot::I64),
            ValType::F32 => Self::Scalar(Slot::F32),
            ValType::F64 => Self::Scalar(Slot::F64),
            ValType::V128 => Self::Scalar(Slot::V128),
            ValType::Ref(reference) => Self::Reference(reference),
        }
    }
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
        HirType::BigInt => Ok(Some(Slot::V128)),
        HirType::Int { .. }
        | HirType::Float { .. }
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
    Int {
        bits: u8,
        signed: bool,
    },
    Float {
        bits: u8,
    },
    /// A promise an export answers: a JS promise settled as the program's is,
    /// with its settlement converted to JS. Never a parameter or a global.
    Promise,
    /// An open value (`unknown`, `any`): a JS primitive, converted by value
    /// (`boundary`). Never a global.
    Value,
    /// A string or the one absence its type admits -- `string | null`,
    /// `string | undefined` -- which `Func::result_absent` says: the two share
    /// a representation, a null reference, and only the declaration knows which
    /// absence it is. An export's result only.
    #[serde(rename = "optionalString")]
    OptionalString {
        absent: Absence,
    },
}

/// Which absent value a null reference stands for at a boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Absence {
    Null,
    Undefined,
}

impl Absence {
    /// The JS value, as glue writes it.
    pub(crate) const fn js(self) -> &'static str {
        match self {
            Self::Null => "null",
            Self::Undefined => "undefined",
        }
    }
}

impl BoundaryType {
    pub(crate) fn from_hir(ty: &HirType) -> Result<Self, String> {
        if matches!(ty, HirType::Managed(nts_core::hir::ManagedType::String)) {
            return Ok(Self::String);
        }
        if matches!(ty, HirType::Managed(nts_core::hir::ManagedType::Promise(_))) {
            return Ok(Self::Promise);
        }
        if ty == &HirType::Erased {
            return Ok(Self::Value);
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
