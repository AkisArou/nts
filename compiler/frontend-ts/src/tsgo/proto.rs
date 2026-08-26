//! Request and response types for tsgo's API.
//!
//! Mirrors `internal/api/proto.go` from the pinned `third_party/typescript-go`
//! submodule. Only what the compiler actually calls is modelled; the API exposes
//! roughly 120 methods and transcribing all of them would be 120 chances to be
//! wrong about something nothing calls.

use camino::Utf8Path;
use serde::{Deserialize, Serialize};

/// Method names, from `internal/api/proto.go`.
///
/// Constants rather than literals at call sites, so a protocol bump surfaces as a
/// compile error in one module.
pub mod method {
    pub const INITIALIZE: &str = "initialize";
    pub const UPDATE_SNAPSHOT: &str = "updateSnapshot";
    pub const PARSE_CONFIG_FILE: &str = "parseConfigFile";
    pub const RELEASE: &str = "release";

    pub const GET_SOURCE_FILE: &str = "getSourceFile";
    pub const GET_SOURCE_FILE_NAMES: &str = "getSourceFileNames";
    pub const GET_SOURCE_FILE_METADATA: &str = "getSourceFileMetadata";

    pub const GET_SYMBOL_AT_LOCATION: &str = "getSymbolAtLocation";
    pub const GET_TYPE_OF_SYMBOL: &str = "getTypeOfSymbol";
    pub const GET_RESOLVED_SIGNATURE: &str = "getResolvedSignature";
    pub const GET_SEMANTIC_DIAGNOSTICS: &str = "getSemanticDiagnostics";

    pub const GET_EXPORTS_OF_MODULE: &str = "getExportsOfModule";
    pub const GET_SYNTACTIC_DIAGNOSTICS: &str = "getSyntacticDiagnostics";
    pub const GET_RETURN_TYPE_OF_SIGNATURE: &str = "getReturnTypeOfSignature";
    pub const GET_SIGNATURES_OF_TYPE: &str = "getSignaturesOfType";
    pub const GET_TYPES_OF_TYPE: &str = "getTypesOfType";
    pub const GET_PROPERTIES_OF_TYPE: &str = "getPropertiesOfType";
    pub const GET_TYPE_ARGUMENTS: &str = "getTypeArguments";
    pub const IS_ARRAY_TYPE: &str = "isArrayType";
    pub const IS_TUPLE_TYPE: &str = "isTupleType";

    /// Batch variants. Prefer these; see [`crate::FrontendStats`] on why.
    pub const GET_TYPE_AT_LOCATIONS: &str = "getTypeAtLocations";
    pub const GET_TYPES_AT_POSITIONS: &str = "getTypesAtPositions";
    pub const GET_SYMBOLS_AT_LOCATIONS: &str = "getSymbolsAtLocations";
    pub const GET_TYPES_OF_SYMBOLS: &str = "getTypesOfSymbols";
}

/// Handle for a program snapshot held by the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotHandle(pub u64);

/// Handle for a loaded project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectHandle(pub String);

/// Identifies a document.
///
/// On the wire this is `string | { uri }`. tsgo's decoder tries a plain string
/// first, so that is what we send — one less shape to get wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DocumentIdentifier(pub String);

impl DocumentIdentifier {
    /// Name a document by absolute path.
    #[must_use]
    pub fn file(path: &Utf8Path) -> Self {
        Self(path.to_string())
    }
}

/// Answer to `initialize`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    /// Whether the server's filesystem distinguishes `Foo.ts` from `foo.ts`.
    ///
    /// Feeds path normalization: RFC §20.4 requires a stable workspace URI, and
    /// on a case-insensitive host two spellings name one file.
    pub use_case_sensitive_file_names: bool,
    pub current_directory: String,
}

/// Parameters for `updateSnapshot`.
///
/// Every field is optional server-side; we only ever open projects, so the rest
/// are omitted rather than sent empty.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshotParams {
    pub open_projects: Vec<DocumentIdentifier>,
}

/// Answer to `updateSnapshot`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshotResponse {
    pub snapshot: SnapshotHandle,
    #[serde(default)]
    pub projects: Vec<ProjectResponse>,
}

/// One loaded project.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectResponse {
    pub id: ProjectHandle,
    #[serde(default)]
    pub config_file_name: String,
    #[serde(default)]
    pub root_files: Vec<String>,
}

/// Parameters for `getSourceFile` and `getSourceFileMetadata`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSourceFileParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    pub file: DocumentIdentifier,
}

/// Parameters for `getSourceFileNames`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSourceFileNamesParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
}

/// Parameters for `release`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseParams {
    pub snapshot: SnapshotHandle,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn a_document_identifier_serializes_as_a_bare_string() {
        // Not {"fileName": "..."} — tsgo's decoder reads a token and takes the
        // string arm first. Sending an object would exercise the other arm.
        let doc = DocumentIdentifier::file(Utf8Path::new("/w/tsconfig.json"));
        assert_eq!(
            serde_json::to_string(&doc).unwrap(),
            r#""/w/tsconfig.json""#
        );
    }

    #[test]
    fn update_snapshot_params_use_camel_case() {
        let params = UpdateSnapshotParams {
            open_projects: vec![DocumentIdentifier("/w/tsconfig.json".to_owned())],
        };
        assert_eq!(
            serde_json::to_string(&params).unwrap(),
            r#"{"openProjects":["/w/tsconfig.json"]}"#
        );
    }

    #[test]
    fn initialize_response_decodes() {
        let json = r#"{"useCaseSensitiveFileNames":true,"currentDirectory":"/w"}"#;
        let parsed: InitializeResponse = serde_json::from_str(json).unwrap();
        assert!(parsed.use_case_sensitive_file_names);
        assert_eq!(parsed.current_directory, "/w");
    }

    #[test]
    fn a_snapshot_response_without_projects_decodes() {
        // `projects` is `omitempty` on the Go side, so absence is normal rather
        // than an error.
        let parsed: UpdateSnapshotResponse = serde_json::from_str(r#"{"snapshot":7}"#).unwrap();
        assert_eq!(parsed.snapshot, SnapshotHandle(7));
        assert!(parsed.projects.is_empty());
    }

    #[test]
    fn a_project_response_decodes_with_root_files() {
        let json = r#"{"snapshot":1,"projects":[{"id":"p1","configFileName":"/w/tsconfig.json","rootFiles":["/w/a.ts","/w/b.ts"]}]}"#;
        let parsed: UpdateSnapshotResponse = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.projects.len(), 1);
        assert_eq!(parsed.projects[0].id, ProjectHandle("p1".to_owned()));
        assert_eq!(parsed.projects[0].root_files.len(), 2);
    }
}

/// Opaque reference to a node, formatted as `"{index}.{kind}.{path}"`.
///
/// See [`crate::tsgo::types::node_handle`] for how one is built and why the
/// index is offset from a decoded node's position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NodeHandle(pub String);

/// Parameters for `getTypeAtLocations`.
///
/// The batch form. One request carries a whole file's locations, which is what
/// keeps the frontend's round-trip count proportional to files rather than nodes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTypeAtLocationsParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    pub locations: Vec<NodeHandle>,
}

/// One resolved type.
///
/// A projection of tsgo's `TypeResponse`: it carries about twenty fields
/// describing tuples, conditionals, substitutions and template literals, and
/// modelling the ones nothing reads yet would be twenty chances to be wrong.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeResponse {
    /// The checker's own type id. Stable within a session, so it doubles as the
    /// interning key that stops one `string` type becoming N records.
    pub id: u32,
    /// `checker.TypeFlags`. See [`crate::tsgo::types::flags`].
    pub flags: u32,
    /// Present for literal types.
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    /// Declaring symbol, where the type has one. `omitzero` on the wire, so 0
    /// means absent rather than symbol zero.
    #[serde(default)]
    pub symbol: u32,
}

/// Parameters for the type sub-property endpoints (`getTypesOfType` and friends).
///
/// Note the wire name: the field is `objectId`, not `type`. tsgo uses one
/// parameter shape for every "property of a handle" endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct GetTypePropertyParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    #[serde(rename = "objectId")]
    pub ty: u32,
}

/// Parameters for the checker endpoints that take a type (`isArrayType`,
/// `getPropertiesOfType`, `getTypeArguments`).
///
/// Distinct from [`GetTypePropertyParams`] only in the field name — `type` here,
/// `objectId` there. Modelling them as one struct would put the wrong key on the
/// wire for half the calls.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckerTypeParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    #[serde(rename = "type")]
    pub ty: u32,
}

/// Parameters for `getTypesOfSymbols`.
///
/// The one batch endpoint that matters for decomposition: a type's properties
/// arrive as symbols, and this turns all of them into types in one exchange.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTypesOfSymbolsParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    pub symbols: Vec<u32>,
}

/// One resolved symbol. Projected to what decomposition reads.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolResponse {
    pub id: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub flags: u32,
    /// Where the symbol is declared. More than one for a merged declaration.
    #[serde(default)]
    pub declarations: Vec<NodeHandle>,
}

/// Parameters for `getSymbolsAtLocations`.
///
/// Batched, exactly like `getTypeAtLocations`, so symbol resolution costs one
/// exchange per file rather than one per node.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSymbolsAtLocationsParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    pub locations: Vec<NodeHandle>,
}

/// Parameters for the checker endpoints that take a symbol.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckerSymbolParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    pub symbol: u32,
}

/// Which signatures of a type to fetch. `checker.SignatureKind`.
///
/// Serializes as its numeric discriminant. The derived impl would emit `"Call"`,
/// and tsgo's parameter is an `int32` — a mismatch the server rejects with a
/// message about unmarshalling, several layers away from the cause.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum SignatureKind {
    /// Ordinary call signatures — what a function type has.
    Call = 0,
    /// `new` signatures.
    Construct = 1,
}

impl Serialize for SignatureKind {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_i32(*self as i32)
    }
}

/// Parameters for `getSignaturesOfType`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSignaturesOfTypeParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    #[serde(rename = "type")]
    pub ty: u32,
    pub kind: SignatureKind,
}

/// One call signature.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureResponse {
    pub id: u64,
    #[serde(default)]
    pub flags: u32,
    /// Symbols of the declared parameters, in order.
    #[serde(default)]
    pub parameters: Vec<u32>,
    #[serde(default)]
    pub type_parameters: Vec<u32>,
}

/// Parameters for the checker endpoints that take a signature.
///
/// Note the wire name is `signature`, unlike the `objectId` used by the
/// signature *property* endpoints. Two shapes for what looks like one idea.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckerSignatureParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    pub signature: u64,
}

/// `checker.SignatureFlags`. Only what the schema reads is named.
pub mod signature_flags {
    /// The last parameter is a rest parameter.
    pub const HAS_REST_PARAMETER: u32 = 1 << 0;
    /// A `new` signature rather than a call signature.
    pub const CONSTRUCT: u32 = 1 << 2;
}

/// Parameters for the diagnostic endpoints.
///
/// `file` is optional, and omitting it is the whole point: tsgo reads that as
/// "every file", so one exchange covers the program. `getProgramDiagnostics`
/// looks like the project-wide call but reports *configuration* diagnostics —
/// it returns nothing for a file with a type error.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDiagnosticsParams {
    pub snapshot: SnapshotHandle,
    pub project: ProjectHandle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<DocumentIdentifier>,
}

/// `diagnostics.Category`, an `int32` on the wire.
///
/// The ordering is a trap worth naming: **`Warning` is 0 and `Error` is 1**, not
/// the other way round. Treating 0 as the error case would let every failing
/// program through and reject every clean one.
pub mod category {
    pub const WARNING: i32 = 0;
    pub const ERROR: i32 = 1;
    pub const SUGGESTION: i32 = 2;
    pub const MESSAGE: i32 = 3;
}

/// One diagnostic from the checker.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticResponse {
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub pos: i64,
    #[serde(default)]
    pub end: i64,
    #[serde(default)]
    pub code: i32,
    #[serde(default)]
    pub category: i32,
    #[serde(default)]
    pub text: String,
    /// Nested explanation, as in "Type 'X' is not assignable to type 'Y'" followed
    /// by the reason. Flattened into labels rather than dropped.
    #[serde(default)]
    pub message_chain: Vec<DiagnosticResponse>,
}
