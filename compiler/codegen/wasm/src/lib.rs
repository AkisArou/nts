//! Direct WebAssembly emission from verified prepared HIR.
//!
//! The first slice supports scalar programs. Unsupported reachable operations
//! refuse by name before an artifact is returned. Managed representation and
//! runtime helper families follow the reviewed plan in `docs/wasm.md`.

mod abi;
mod array_copy;
mod array_init;
mod array_join;
mod array_lookup;
mod array_methods;
mod array_sort;
mod arrays;
mod body;
mod buffer_methods;
mod buffers;
mod callable_plan;
mod callables;
mod cfg;
mod collections;
mod contract;
mod dataviews;
mod demand;
mod erased;
mod erased_ops;
mod error;
mod gc;
mod glue;
mod helpers;
mod host;
mod indexing;
mod ir;
mod module;
mod numeric;
mod object_plan;
mod objects;
mod promises;
mod raising;
mod rows;
mod strings;
mod support;
mod timers;
mod transfer;
mod types;
mod values;

#[cfg(test)]
#[path = "../tests/common/hir.rs"]
mod test_common;

pub use abi::{Import, ImportType, ValueType};
pub use cfg::Route;
pub use glue::{Glue, Host, INSTANCE_FILE, PROGRAM_FILE, glue};
use nts_core::hir::{Program, verify::Invalid};
use nts_diagnostics::Diagnostic;
use nts_semantic_schema::Origin;
use serde::{Deserialize, Serialize};
pub use support::{Support, helper_support};
pub use types::BoundaryType;

/// A complete artifact; failed/declined programs never return partial bytes.
#[derive(Debug)]
pub struct Emitted {
    pub bytes: Vec<u8>,
    pub manifest: Manifest,
    pub origins: Vec<InstructionOrigin>,
}

/// What the module exports and imports, at logical types. The generated glue
/// is written from it; tooling reads it as the `program.wasm.json` sidecar.
/// Nothing reads it at run time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub abi: u32,
    pub host: String,
    pub exports: Vec<FunctionExport>,
    pub globals: Vec<GlobalExport>,
    pub init: Option<String>,
    /// Ordinary imports, in module order. Recognized builtins and imported
    /// string constants are compile-time and appear in neither list.
    pub imports: Vec<Import>,
    pub builtins: Vec<Import>,
    pub features: Vec<String>,
    pub functions: Vec<FunctionRoute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionExport {
    pub name: String,
    pub params: Vec<Parameter>,
    pub result: BoundaryType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Parameter {
    pub ty: BoundaryType,
    pub guard: Option<NumberGuard>,
}

/// Facts specialization assumes at an incoming numeric boundary. Infinite
/// endpoints have explicit spellings so JSON never substitutes null for them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NumberGuard {
    pub minimum: NumberBound,
    pub maximum: NumberBound,
    pub whole: bool,
    pub maybe_nan: bool,
    pub maybe_negative_zero: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NumberBound {
    Finite(f64),
    Infinite(InfiniteBound),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InfiniteBound {
    #[serde(rename = "Infinity")]
    Positive,
    #[serde(rename = "-Infinity")]
    Negative,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalExport {
    pub name: String,
    pub symbol: String,
    pub ty: BoundaryType,
    /// Whether a function other than the module initializer assigns it, so
    /// an importer's binding must follow it.
    pub live: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionRoute {
    pub name: String,
    pub route: Route,
    pub blocks: usize,
    pub edges: usize,
}

/// Offset in the encoded function payload, including its local declarations.
#[derive(Debug, Clone, Serialize)]
pub struct InstructionOrigin {
    pub function: u32,
    pub offset: usize,
    pub origin: Origin,
}

/// Named unsupported shapes and compiler integrity failures are distinct.
#[derive(Debug)]
pub enum EmitError {
    Declined(Vec<Diagnostic>),
    /// Publication metadata has names but no source Origin. Preserve a named
    /// decline without inventing a source location or reporting an integrity bug.
    UnsupportedSurface {
        name: String,
        reason: String,
    },
    InvalidHir(Vec<Invalid>),
    InvalidWasm(String),
    /// A prepared physical type or planned binding went missing during emission.
    Invariant {
        function: String,
        reason: String,
    },
    /// A verified CFG could not be translated. This is a compiler bug, not an
    /// unsupported source shape, and must never select a fallback route.
    Structuring {
        function: String,
        reason: String,
    },
}

impl std::fmt::Display for EmitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Declined(diagnostics) => {
                for (i, d) in diagnostics.iter().enumerate() {
                    if i != 0 {
                        writeln!(f)?;
                    }
                    write!(f, "{}: {}", d.code, d.message)?;
                }
                Ok(())
            }
            Self::InvalidHir(errors) => write!(f, "invalid prepared HIR: {errors:?}"),
            Self::InvalidWasm(error) => write!(f, "invalid generated wasm: {error}"),
            Self::Invariant { function, reason } => {
                write!(f, "internal wasm emitter error in `{function}`: {reason}")
            }
            Self::Structuring { function, reason } => {
                write!(
                    f,
                    "internal wasm structurer error in `{function}`: {reason}"
                )
            }
            Self::UnsupportedSurface { name, reason } => {
                write!(f, "NTS5001: wasm declines public export `{name}`: {reason}")
            }
        }
    }
}
impl std::error::Error for EmitError {}

/// Emit a verified prepared program. Unsupported reachable shapes refuse by name.
pub fn emit(program: &Program) -> Result<Emitted, EmitError> {
    nts_core::hir::verify::verify(program).map_err(EmitError::InvalidHir)?;
    let mismatches = nts_codegen_common::provider::host_gc_diagnostics(program, "wasm");
    if !mismatches.is_empty() {
        return Err(EmitError::Declined(mismatches));
    }
    module::emit(program)
}

/// Validate against the precise scalar and managed M1 feature set.
/// No default proposal set changes when wasmparser updates.
pub fn validate(bytes: &[u8]) -> Result<(), EmitError> {
    validate_named(bytes, &[])
}

/// Validate, naming the defined function that contains a failure. wasmparser
/// prints every concrete type as `$type`, so without the function a type
/// mismatch report does not say where it is.
pub(crate) fn validate_named(bytes: &[u8], bodies: &[String]) -> Result<(), EmitError> {
    use wasmparser::WasmFeatures as F;
    let features = F::FLOATS
        | F::MUTABLE_GLOBAL
        | F::SIGN_EXTENSION
        | F::SATURATING_FLOAT_TO_INT
        | F::REFERENCE_TYPES
        | F::FUNCTION_REFERENCES
        | F::BULK_MEMORY
        | F::GC
        | F::GC_TYPES
        | F::EXCEPTIONS;
    let Err(error) = wasmparser::Validator::new_with_features(features).validate_all(bytes) else {
        return Ok(());
    };
    let body = wasmparser::Parser::new(0)
        .parse_all(bytes)
        .filter_map(|payload| match payload {
            Ok(wasmparser::Payload::CodeSectionEntry(body)) => Some(body.range()),
            _ => None,
        })
        .position(|range| range.contains(&error.offset()));
    Err(EmitError::InvalidWasm(
        match body.and_then(|at| bodies.get(at)) {
            Some(name) => format!("in `{name}`: {error}"),
            None => error.to_string(),
        },
    ))
}

pub(crate) fn refuse(
    func: &nts_core::hir::Func,
    origin: &Origin,
    why: impl std::fmt::Display,
) -> Diagnostic {
    Diagnostic::error(
        "NTS5001",
        format!("wasm declines `{}`: {why}", func.name),
        origin.location,
    )
}
