//! Typed host imports, distinct from builtin requirements and literal values.

use crate::types::{Physical, Slot};
use serde::{Deserialize, Serialize};
use wasm_encoder::{HeapType, RefType};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ValueType {
    I32,
    I64,
    F32,
    F64,
    Externref { nullable: bool },
}

impl ValueType {
    pub(crate) fn from_physical(slot: Physical) -> Result<Self, String> {
        match slot {
            Physical::Scalar(Slot::I32) => Ok(Self::I32),
            Physical::Scalar(Slot::I64) => Ok(Self::I64),
            Physical::Scalar(Slot::F32) => Ok(Self::F32),
            Physical::Scalar(Slot::F64) => Ok(Self::F64),
            // A v128 cannot cross into JS: the glue would split a bigint.
            Physical::Scalar(Slot::V128) => Err("a bigint at the JS boundary".into()),
            Physical::Reference(reference)
                if reference.heap_type == RefType::EXTERNREF.heap_type =>
            {
                Ok(Self::Externref {
                    nullable: reference.nullable,
                })
            }
            Physical::Reference(reference) => Err(format!(
                "host import of GC/function storage {:?} is outside M1b",
                reference.heap_type
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Import {
    pub module: String,
    pub name: String,
    #[serde(flatten)]
    pub ty: ImportType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ImportType {
    Function {
        params: Vec<ValueType>,
        result: Option<ValueType>,
    },
    Global {
        ty: ValueType,
        mutable: bool,
    },
    Tag,
}

impl Import {
    pub(crate) fn function(
        module: &str,
        name: &str,
        params: &[Physical],
        result: Option<Physical>,
    ) -> Result<Self, String> {
        Ok(Self {
            module: module.into(),
            name: name.into(),
            ty: ImportType::Function {
                params: params
                    .iter()
                    .map(|&slot| ValueType::from_physical(slot))
                    .collect::<Result<_, _>>()?,
                result: result.map(ValueType::from_physical).transpose()?,
            },
        })
    }
}

pub(crate) fn requires_gc(slot: Physical) -> bool {
    match slot {
        Physical::Scalar(_)
        | Physical::Reference(RefType {
            heap_type:
                HeapType::Abstract {
                    ty: wasm_encoder::AbstractHeapType::Extern,
                    ..
                },
            ..
        }) => false,
        Physical::Reference(_) => true,
    }
}
