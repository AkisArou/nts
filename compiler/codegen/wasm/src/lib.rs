//! Direct WebAssembly emission from verified prepared HIR.
//!
//! The first slice supports scalar programs. Unsupported reachable operations
//! refuse by name before an artifact is returned. Managed representation and
//! runtime helper families follow the reviewed plan in `docs/records/notebooks/wasm.md`.

mod abi;
mod array_copy;
mod array_init;
mod array_join;
mod array_lookup;
mod array_methods;
mod array_sort;
mod arrays;
mod bigints;
mod body;
mod boundary;
mod box_web;
mod buffer_methods;
mod buffers;
mod callable_plan;
mod callables;
mod cfg;
mod checks;
mod collections;
mod contract;
mod conversions;
mod dataviews;
mod dates;
mod demand;
mod erased;
mod erased_ops;
mod error;
mod flow;
mod function_names;
mod gc;
mod glue;
mod guarded_casts;
mod helpers;
mod host;
mod indexing;
mod inline;
mod ir;
mod literals;
mod locals;
mod module;
mod never_null;
mod numeric;
mod object_plan;
mod objects;
mod outline;
mod owned_views;
mod presence;
mod printed;
mod promises;
mod raising;
mod roundtrip;
mod rows;
mod string_split;
mod strings;
mod support;
mod symbols;
mod tag_tests;
mod tail;
mod timers;
mod to_int32;
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

/// Whether this backend provides the runtime helper `helper`: whether its
/// catalog supports it, as an instruction, a module helper or a host import,
/// rather than declining it or not knowing it. The answer to a `typeof` of an
/// intrinsic here (`nts_core::hir::features`).
#[must_use]
pub fn provides(helper: &str) -> bool {
    helper_support(helper).is_some_and(|support| !matches!(support, Support::Decline(_)))
}
pub use types::{Absence, BoundaryType};

/// A complete artifact; failed/declined programs never return partial bytes.
/// Its surface may lack a published name the boundary cannot carry, and then
/// `declined` says which and why.
#[derive(Debug)]
pub struct Emitted {
    pub bytes: Vec<u8>,
    pub manifest: Manifest,
    pub origins: Vec<InstructionOrigin>,
    pub declined: Vec<DeclinedExport>,
}

/// A published name the artifact does not export, and why.
///
/// One export the boundary cannot carry declined the whole module, which C
/// does not: it emits the program and reports the name
/// (`published_without_a_symbol`), as the Node-API addon declines one export
/// at a time. 62 test262 cases that ran on C were declined on Wasm for an
/// export the program never calls (2026-10-15): a fixture module's `export
/// default` of a constant the lowering folded away, or a module-scope name
/// whose closure the lowering refused. Whether a missing name matters is the
/// caller's: an artifact is still a program, while `nts check` calls its
/// exports by name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeclinedExport {
    pub name: String,
    pub reason: String,
    /// The declaration's location, when the surface has one. A name with no
    /// definition has none, and none is invented: a diagnostic without a
    /// location is a bug.
    pub at: Option<nts_diagnostics::Location>,
}

impl DeclinedExport {
    /// The same report as a warning at the declaration, where there is one.
    #[must_use]
    pub fn diagnostic(&self) -> Option<Diagnostic> {
        self.at.map(|at| Diagnostic {
            severity: nts_diagnostics::Severity::Warning,
            ..Diagnostic::error("NTS5001", self.message(), at)
        })
    }

    fn message(&self) -> String {
        format!(
            "wasm declines public export `{}`: {}",
            self.name, self.reason
        )
    }
}

impl std::fmt::Display for DeclinedExport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "NTS5001: {}", self.message())
    }
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
    /// Required immutable externref imports from `UTF16_LITERAL_MODULE`, keyed
    /// by first-use ordinal (the import field is its decimal spelling). Every
    /// host must supply these exact UTF-16 strings, once at instantiation.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub literal_constants: std::collections::BTreeMap<u32, nts_semantic_schema::JsText>,
    pub builtins: Vec<Import>,
    pub features: Vec<String>,
    pub functions: Vec<FunctionRoute>,
}

pub const UTF16_LITERAL_MODULE: &str = "nts:literal/v1";

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
    /// `x: T = expr`: the core evaluates the initializer at each compiled
    /// call that omits the argument, so a host caller must pass it, and one
    /// that omits it is refused by name rather than given an invented value.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub defaulted: bool,
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
        | F::EXCEPTIONS
        | F::TAIL_CALL
        | F::SIMD;
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
