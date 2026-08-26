//! The `tsgo --api` transport.
//!
//! # Shape of the conversation
//!
//! `tsgo --api` is a request/response server over stdio. There are no request
//! ids: the method name *is* the correlation key, so exactly one request may be
//! outstanding at a time. [`Client`] enforces that by taking `&mut self`.
//!
//! Two properties of the API keep the round-trip count bounded by *file* count
//! rather than node count:
//!
//! - **ASTs arrive in bulk.** `internal/api/encoder` writes a flat binary node
//!   layout plus a shared string table, and `getSourceFile` returns a whole file
//!   as one `RawBinary` payload. AST transfer is not a per-node round trip.
//! - **Type and symbol queries batch.** `getTypeAtLocations` and
//!   `getSymbolsAtLocations` take lists, so a file's queries collapse into one
//!   exchange each.
//!
//! [`crate::FrontendStats`] measures whether we are actually holding to that.
//! See `docs/records/0001-frontend-transport-cost.md` for the numbers.
//!
//! # Version pinning
//!
//! `internal/api` is internal-scoped and explicitly unstable, so the protocol is
//! pinned to one tsgo release. [`PINNED_TSGO`] names it and the submodule under
//! `third_party/typescript-go` is the source of truth it was read from.

pub mod ast;
pub mod decompose;
pub mod proto;
pub mod symbols;
pub mod types;
pub mod wire;

use std::io::{BufReader, BufWriter, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Instant;

use camino::{Utf8Path, Utf8PathBuf};
use nts_diagnostics::{Digest, SourceFile, SourceId};
use nts_semantic_schema::{
    NodeId, NodeKind, SCHEMA_VERSION, SemanticSnapshot, SnapshotError, SymbolId, TypeId,
};
use rustc_hash::FxHashMap;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::source::{FrontendStats, SemanticSource};
use proto::{
    CheckerNodeParams, CheckerSignatureParams, CheckerSymbolParams, CheckerTypeParams,
    DiagnosticResponse, DocumentIdentifier, GetDiagnosticsParams, GetResolvedSignatureParams,
    GetSignaturePropertyParams, GetSignaturesOfTypeParams, GetSourceFileParams,
    GetSymbolsAtLocationsParams, GetTypeAtLocationsParams, GetTypePropertyParams,
    GetTypesOfSymbolsParams, IndexInfoResponse, InitializeResponse, IsTypeAssignableToParams,
    NodeHandle, ProjectHandle, SignatureKind, SignatureResponse, SnapshotHandle,
    SourceFileMetadata, SymbolResponse, TypePredicateResponse, TypeResponse, UpdateSnapshotParams,
    UpdateSnapshotResponse,
};
use wire::{Frame, MessageType, WireError, read_frame, write_frame};

/// The tsgo release this adapter targets.
///
/// Matches the `typescript/v7.0.2` tag of the `third_party/typescript-go`
/// submodule, which is npm `typescript@7.0.2`. Bump deliberately, together with a
/// run of the frontend conformance fixtures.
pub const PINNED_TSGO: &str = "7.0.2";

/// Why the frontend failed.
#[derive(Debug, thiserror::Error)]
pub enum TsgoError {
    #[error("could not start `{executable}`: {source}")]
    Spawn {
        executable: String,
        #[source]
        source: std::io::Error,
    },

    #[error(transparent)]
    Wire(#[from] WireError),

    #[error("tsgo rejected `{method}`: {message}")]
    Server { method: String, message: String },

    #[error("tsgo answered `{method}` with a `{got}` frame")]
    UnexpectedFrame { method: String, got: &'static str },

    #[error(
        "tsgo asked us to service a `{0}` callback, but no filesystem callbacks were enabled; \
         this build of tsgo does not match the pinned protocol"
    )]
    UnexpectedCallback(String),

    #[error("could not decode tsgo's answer to `{method}`: {source}")]
    Decode {
        method: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("could not decode the AST for `{file}`: {source}")]
    Ast {
        file: String,
        #[source]
        source: ast::AstError,
    },
}

impl From<TsgoError> for SnapshotError {
    fn from(error: TsgoError) -> Self {
        Self::Transport(error.to_string())
    }
}

const fn frame_name(message_type: MessageType) -> &'static str {
    match message_type {
        MessageType::Request => "request",
        MessageType::CallResponse => "call-response",
        MessageType::CallError => "call-error",
        MessageType::Response => "response",
        MessageType::Error => "error",
        MessageType::Call => "call",
    }
}

/// A live `tsgo --api` child process.
///
/// Dropping the client closes tsgo's stdin, which is how the server is asked to
/// exit; [`Drop`] then reaps it so a failed build does not leave a 40 MB checker
/// resident.
#[derive(Debug)]
pub struct Client {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    round_trips: u64,
}

impl Client {
    /// Spawn `executable --api` with `cwd` as its working directory.
    ///
    /// Filesystem callbacks are deliberately not enabled: tsgo reads the disk
    /// itself, so the conversation stays strictly request/response and we never
    /// have to service a server-initiated [`MessageType::Call`] mid-request.
    pub fn spawn(executable: &Utf8Path, cwd: &Utf8Path) -> Result<Self, TsgoError> {
        let mut child = Command::new(executable.as_str())
            .arg("--api")
            .arg("--cwd")
            .arg(cwd.as_str())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|source| TsgoError::Spawn {
                executable: executable.to_string(),
                source,
            })?;

        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");

        Ok(Self {
            child,
            stdin: BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
            round_trips: 0,
        })
    }

    /// Request/response pairs exchanged so far.
    #[must_use]
    pub const fn round_trips(&self) -> u64 {
        self.round_trips
    }

    /// Send a request and return the raw response payload.
    ///
    /// Used directly for methods whose answer is binary — `getSourceFile` returns
    /// an encoded AST that must not be routed through JSON.
    pub fn request_raw(
        &mut self,
        method: &str,
        params: &impl Serialize,
    ) -> Result<Vec<u8>, TsgoError> {
        let payload = serde_json::to_vec(params).map_err(|source| TsgoError::Decode {
            method: method.to_owned(),
            source,
        })?;

        write_frame(&mut self.stdin, MessageType::Request, method, &payload)?;
        self.round_trips += 1;

        let Frame {
            message_type,
            payload,
            ..
        } = read_frame(&mut self.stdout)?;

        match message_type {
            MessageType::Response => Ok(payload),
            MessageType::Error => Err(TsgoError::Server {
                method: method.to_owned(),
                message: String::from_utf8_lossy(&payload).into_owned(),
            }),
            MessageType::Call => Err(TsgoError::UnexpectedCallback(method.to_owned())),
            other => Err(TsgoError::UnexpectedFrame {
                method: method.to_owned(),
                got: frame_name(other),
            }),
        }
    }

    /// Send a request and decode a JSON response.
    pub fn request<R: DeserializeOwned>(
        &mut self,
        method: &str,
        params: &impl Serialize,
    ) -> Result<R, TsgoError> {
        let payload = self.request_raw(method, params)?;
        serde_json::from_slice(&payload).map_err(|source| TsgoError::Decode {
            method: method.to_owned(),
            source,
        })
    }

    /// Perform the `initialize` handshake.
    pub fn initialize(&mut self) -> Result<InitializeResponse, TsgoError> {
        self.request(proto::method::INITIALIZE, &serde_json::Value::Null)
    }

    /// Open a `tsconfig.json` and take a snapshot of the resulting program.
    pub fn open_project(
        &mut self,
        tsconfig: &Utf8Path,
    ) -> Result<UpdateSnapshotResponse, TsgoError> {
        self.request(
            proto::method::UPDATE_SNAPSHOT,
            &UpdateSnapshotParams {
                open_projects: vec![DocumentIdentifier::file(tsconfig)],
            },
        )
    }

    /// Fetch one file's encoded AST.
    ///
    /// Answers with `RawBinary`, so this must not go through the JSON path — the
    /// bytes are the encoded format, not a JSON document.
    pub fn source_file(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        file: &Utf8Path,
    ) -> Result<Vec<u8>, TsgoError> {
        self.request_raw(
            proto::method::GET_SOURCE_FILE,
            &GetSourceFileParams {
                snapshot,
                project: project.clone(),
                file: DocumentIdentifier::file(file),
            },
        )
    }

    /// Resolve the types at many locations in one exchange.
    ///
    /// Every handle must resolve: `handleGetTypeAtLocations` returns on the first
    /// failure, so a single unresolvable location loses the whole batch. Callers
    /// filter `NodeList`s out before calling.
    pub fn types_at(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        locations: Vec<NodeHandle>,
    ) -> Result<Vec<TypeResponse>, TsgoError> {
        if locations.is_empty() {
            return Ok(Vec::new());
        }
        self.request(
            proto::method::GET_TYPE_AT_LOCATIONS,
            &GetTypeAtLocationsParams {
                snapshot,
                project: project.clone(),
                locations,
            },
        )
    }

    /// Resolve the symbols at many locations in one exchange.
    ///
    /// Entries are `None` where a node names no symbol — a keyword, an operator,
    /// a block. tsgo leaves those slots nil rather than omitting them, so the
    /// result stays positionally aligned with the request.
    pub fn symbols_at(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        locations: Vec<NodeHandle>,
    ) -> Result<Vec<Option<SymbolResponse>>, TsgoError> {
        if locations.is_empty() {
            return Ok(Vec::new());
        }
        self.request(
            proto::method::GET_SYMBOLS_AT_LOCATIONS,
            &GetSymbolsAtLocationsParams {
                snapshot,
                project: project.clone(),
                locations,
            },
        )
    }

    /// Symbols a module exports.
    ///
    /// Takes the module's own symbol, which is the one carried by its
    /// `SourceFile` node — present for a module, absent for a plain script.
    pub fn exports_of_module(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        symbol: u32,
    ) -> Result<Vec<SymbolResponse>, TsgoError> {
        self.request(
            proto::method::GET_EXPORTS_OF_MODULE,
            &CheckerSymbolParams {
                snapshot,
                project: project.clone(),
                symbol,
            },
        )
    }

    /// Call signatures of a type.
    pub fn signatures_of_type(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Vec<SignatureResponse>, TsgoError> {
        self.request(
            proto::method::GET_SIGNATURES_OF_TYPE,
            &GetSignaturesOfTypeParams {
                snapshot,
                project: project.clone(),
                ty,
                kind: SignatureKind::Call,
            },
        )
    }

    /// Every diagnostic the checker produced for a whole project.
    ///
    /// Two exchanges for the program regardless of size, so the correctness gate
    /// costs a constant. Syntactic diagnostics matter as much as semantic ones: a
    /// parse error means the decoded AST is not the program anybody wrote.
    pub fn diagnostics(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
    ) -> Result<Vec<DiagnosticResponse>, TsgoError> {
        let params = GetDiagnosticsParams {
            snapshot,
            project: project.clone(),
            // Omitted on purpose — tsgo reads absence as "every file".
            file: None,
        };
        let mut all: Vec<DiagnosticResponse> =
            self.request(proto::method::GET_SYNTACTIC_DIAGNOSTICS, &params)?;
        all.extend(self.request::<Vec<DiagnosticResponse>>(
            proto::method::GET_SEMANTIC_DIAGNOSTICS,
            &params,
        )?);
        Ok(all)
    }

    /// The compile-time value of a node, if the checker folded one.
    ///
    /// Answers `null` for a node with no constant value, which is the common case
    /// — so the caller decides which nodes are worth asking about.
    pub fn constant_value(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        location: NodeHandle,
    ) -> Result<Option<serde_json::Value>, TsgoError> {
        self.request(
            proto::method::GET_CONSTANT_VALUE,
            &CheckerNodeParams {
                snapshot,
                project: project.clone(),
                location,
            },
        )
    }

    /// Which signature a call site resolves to, after overload resolution.
    ///
    /// Per call site; there is no batch form.
    pub fn resolved_signature(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        location: NodeHandle,
    ) -> Result<SignatureResponse, TsgoError> {
        self.request(
            proto::method::GET_RESOLVED_SIGNATURE,
            &GetResolvedSignatureParams {
                snapshot,
                project: project.clone(),
                location,
            },
        )
    }

    /// Parameter symbols of a signature.
    ///
    /// Not the same as `SignatureResponse::parameters`. Those ids come from
    /// `symbolHandles`, which returns raw `ast.GetSymbolId` values **without
    /// entering them in the snapshot's symbol registry** — so no symbol endpoint
    /// can resolve them, and passing them to `getTypesOfSymbols` fails with
    /// "symbol handle N not found". This endpoint answers through
    /// `newSymbolResponse`, which registers, so its ids are usable. It also
    /// carries the parameter names.
    pub fn parameters_of_signature(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        signature: u64,
    ) -> Result<Vec<SymbolResponse>, TsgoError> {
        self.request(
            proto::method::GET_PARAMETERS_OF_SIGNATURE,
            &GetSignaturePropertyParams {
                snapshot,
                project: project.clone(),
                signature,
            },
        )
    }

    /// Return type of one signature.
    pub fn return_type_of_signature(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        signature: u64,
    ) -> Result<TypeResponse, TsgoError> {
        self.request(
            proto::method::GET_RETURN_TYPE_OF_SIGNATURE,
            &CheckerSignatureParams {
                snapshot,
                project: project.clone(),
                signature,
            },
        )
    }

    /// Constituent types of a union or intersection.
    pub fn types_of_type(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Vec<TypeResponse>, TsgoError> {
        self.request(
            proto::method::GET_TYPES_OF_TYPE,
            &GetTypePropertyParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// Every source file in a project, not only its roots.
    ///
    /// Includes imported files, ambient declarations, and the default library.
    pub fn source_file_names(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
    ) -> Result<Vec<String>, TsgoError> {
        self.request(
            proto::method::GET_SOURCE_FILE_NAMES,
            &proto::GetSourceFileNamesParams {
                snapshot,
                project: project.clone(),
            },
        )
    }

    /// Program-stored facts about one source file.
    pub fn source_file_metadata(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        file: &Utf8Path,
    ) -> Result<SourceFileMetadata, TsgoError> {
        self.request(
            proto::method::GET_SOURCE_FILE_METADATA,
            &GetSourceFileParams {
                snapshot,
                project: project.clone(),
                file: DocumentIdentifier::file(file),
            },
        )
    }

    /// What a type-guard signature narrows, if anything.
    pub fn type_predicate_of_signature(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        signature: u64,
    ) -> Result<Option<TypePredicateResponse>, TsgoError> {
        self.request(
            proto::method::GET_TYPE_PREDICATE_OF_SIGNATURE,
            &CheckerSignatureParams {
                snapshot,
                project: project.clone(),
                signature,
            },
        )
    }

    /// Type parameters declared by a signature.
    pub fn type_parameters_of_signature(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        signature: u64,
    ) -> Result<Vec<TypeResponse>, TsgoError> {
        self.request(
            proto::method::GET_TYPE_PARAMETERS_OF_SIGNATURE,
            &GetSignaturePropertyParams {
                snapshot,
                project: project.clone(),
                signature,
            },
        )
    }

    /// One type-valued property of a type, by method name.
    ///
    /// The conditional and indexed-access getters share a shape, so they share a
    /// call rather than repeating it six times. They take `objectId` on the wire.
    pub fn type_property(
        &mut self,
        method: &'static str,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Option<TypeResponse>, TsgoError> {
        self.request(
            method,
            &GetTypePropertyParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// The constraint of a type parameter — the `U` in `<T extends U>`.
    ///
    /// A different parameter shape from [`Client::type_property`]: this family
    /// takes `type` rather than `objectId`.
    pub fn constraint_of_type_parameter(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Option<TypeResponse>, TsgoError> {
        self.request(
            proto::method::GET_CONSTRAINT_OF_TYPE_PARAMETER,
            &CheckerTypeParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// Index signatures of a type.
    pub fn index_infos_of_type(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Vec<IndexInfoResponse>, TsgoError> {
        self.request(
            proto::method::GET_INDEX_INFOS_OF_TYPE,
            &CheckerTypeParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// `new` signatures of a type.
    pub fn construct_signatures_of_type(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Vec<SignatureResponse>, TsgoError> {
        self.request(
            proto::method::GET_SIGNATURES_OF_TYPE,
            &GetSignaturesOfTypeParams {
                snapshot,
                project: project.clone(),
                ty,
                kind: SignatureKind::Construct,
            },
        )
    }

    /// Whether a value of `source` may be used where `target` is expected.
    ///
    /// A question, not an extraction: the answer depends on a pair, so there is
    /// nothing to store up front. Lowering asks it where a coercion might be
    /// needed — an assignment, an argument, a return — and the answer decides
    /// between emitting a conversion and emitting nothing.
    ///
    /// Takes checker type ids rather than arena indices, so a caller holding a
    /// `TypeId` needs the mapping that produced it.
    pub fn is_type_assignable_to(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        source: u32,
        target: u32,
    ) -> Result<bool, TsgoError> {
        self.request(
            proto::method::IS_TYPE_ASSIGNABLE_TO,
            &IsTypeAssignableToParams {
                snapshot,
                project: project.clone(),
                source,
                target,
            },
        )
    }

    /// Base types of a class or interface type.
    ///
    /// Answers an empty list for a type with no heritage, which is the common
    /// case rather than an error.
    pub fn base_types(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Vec<TypeResponse>, TsgoError> {
        self.request(
            proto::method::GET_BASE_TYPES,
            &CheckerTypeParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// Whether a type is a tuple.
    ///
    /// Checked before the array path: a tuple is an array-like reference too, and
    /// treating one as an array loses its arity — the property that lets it be
    /// laid out flat rather than as a pointer and a length.
    pub fn is_tuple_type(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<bool, TsgoError> {
        self.request(
            proto::method::IS_TUPLE_TYPE,
            &CheckerTypeParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// Whether a type is an array. One call, and it is worth it: decomposing an
    /// array as an ordinary object yields `length`, `push`, `map` and the rest of
    /// the prototype instead of an element type.
    pub fn is_array_type(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<bool, TsgoError> {
        self.request(
            proto::method::IS_ARRAY_TYPE,
            &CheckerTypeParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// Type arguments of a reference — the element type, for an array.
    pub fn type_arguments(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Vec<TypeResponse>, TsgoError> {
        self.request(
            proto::method::GET_TYPE_ARGUMENTS,
            &CheckerTypeParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// Property symbols of an object type.
    pub fn properties_of_type(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        ty: u32,
    ) -> Result<Vec<SymbolResponse>, TsgoError> {
        self.request(
            proto::method::GET_PROPERTIES_OF_TYPE,
            &CheckerTypeParams {
                snapshot,
                project: project.clone(),
                ty,
            },
        )
    }

    /// Types of many symbols in one exchange.
    pub fn types_of_symbols(
        &mut self,
        snapshot: SnapshotHandle,
        project: &ProjectHandle,
        symbols: Vec<u32>,
    ) -> Result<Vec<TypeResponse>, TsgoError> {
        if symbols.is_empty() {
            return Ok(Vec::new());
        }
        self.request(
            proto::method::GET_TYPES_OF_SYMBOLS,
            &GetTypesOfSymbolsParams {
                snapshot,
                project: project.clone(),
                symbols,
            },
        )
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // Close stdin first: tsgo exits on EOF, so this is a request to stop
        // rather than a signal. Only kill if it declines to notice.
        let _ = self.stdin.flush();
        if let Ok(Some(_)) = self.child.try_wait() {
            return;
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A [`SemanticSource`] backed by a `tsgo --api` child process.
#[derive(Debug)]
pub struct TsgoApi {
    executable: Utf8PathBuf,
    decompose: Option<decompose::Budget>,
    resolve_calls: Option<decompose::Budget>,
    fold_constants: Option<decompose::Budget>,
    stats: FrontendStats,
}

impl TsgoApi {
    /// Prepare an adapter around the `tsgo` binary at `executable`.
    ///
    /// The process is not spawned until [`SemanticSource::snapshot`] runs.
    #[must_use]
    pub fn new(executable: impl Into<Utf8PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            decompose: None,
            resolve_calls: None,
            fold_constants: None,
            stats: FrontendStats::default(),
        }
    }

    /// Also decompose structured types into members and properties.
    ///
    /// Off by default, and deliberately so. Producing the snapshot costs round
    /// trips proportional to *files*; decomposition costs them proportional to
    /// *distinct types*, because tsgo exposes no batch endpoint for a type's
    /// members. Turning it on for a whole program before reachability exists
    /// means paying for types the build will never reach. See
    /// `docs/records/0002-type-decomposition-is-per-type.md`.
    #[must_use]
    pub const fn with_decomposition(mut self, budget: decompose::Budget) -> Self {
        self.decompose = Some(budget);
        self
    }

    /// Also resolve every call site to the signature it reaches.
    ///
    /// Off by default for the same reason decomposition is: one exchange per call
    /// site, with no batch form. What it buys is the difference between a static
    /// call and a dispatch, so any backend that emits calls will want it — but
    /// only for the calls a build actually reaches.
    #[must_use]
    pub const fn with_call_resolution(mut self, budget: decompose::Budget) -> Self {
        self.resolve_calls = Some(budget);
        self
    }

    /// Also fold enum members and enum reads into constants.
    ///
    /// Off by default like the other per-item passes, though this one is cheap in
    /// practice: only enum members and property accesses are asked about, and
    /// most programs have few.
    #[must_use]
    pub const fn with_constant_folding(mut self, budget: decompose::Budget) -> Self {
        self.fold_constants = Some(budget);
        self
    }

    /// The `tsgo` binary this adapter will invoke.
    #[must_use]
    pub fn executable(&self) -> &Utf8Path {
        &self.executable
    }
}

impl SemanticSource for TsgoApi {
    fn snapshot(&mut self, tsconfig: &Utf8Path) -> Result<SemanticSnapshot, SnapshotError> {
        let started = Instant::now();

        let cwd = tsconfig.parent().unwrap_or(Utf8Path::new("."));
        let mut client = Client::spawn(&self.executable, cwd)?;

        client.initialize()?;
        let opened = client.open_project(tsconfig)?;

        let mut snapshot = SemanticSnapshot {
            schema_version: SCHEMA_VERSION,
            ..SemanticSnapshot::default()
        };
        // tsgo's ids are stable within a session, so one `string` type interns to
        // one record no matter how many nodes name it.
        let mut interned: FxHashMap<u32, TypeId> = FxHashMap::default();
        let mut symbol_ids: FxHashMap<u32, SymbolId> = FxHashMap::default();
        // Where each file's nodes begin, so a declaration handle can be mapped
        // back onto the shared arena.
        let mut file_bases: Vec<(String, u32)> = Vec::new();

        for project in &opened.projects {
            let compiled = compiled_files(&mut client, opened.snapshot, &project.id)?;
            for path in &compiled {
                let path = path.as_path();
                let bytes = client.source_file(opened.snapshot, &project.id, path)?;

                // A file the program lists but cannot produce comes back empty
                // rather than as an error. Skipping it here keeps the source table
                // and the node arena consistent with each other.
                if bytes.is_empty() {
                    continue;
                }

                let file = SourceId(u32::try_from(snapshot.sources.len()).unwrap_or(u32::MAX));
                let decoded = ast::decode(&bytes, file).map_err(|source| TsgoError::Ast {
                    file: path.to_string(),
                    source,
                })?;

                // Nodes from later files must not collide with earlier ones, so
                // every index is rebased onto the shared arena as it is appended.
                let base = u32::try_from(snapshot.nodes.len()).unwrap_or(u32::MAX);
                snapshot
                    .nodes
                    .extend(decoded.nodes.into_iter().map(|mut node| {
                        node.parent = node.parent.map(|NodeId(id)| NodeId(id + base));
                        for child in &mut node.children {
                            child.0 += base;
                        }
                        node
                    }));

                file_bases.push((path.to_string(), base));

                let ctx = symbols::FileContext {
                    handle: opened.snapshot,
                    project: &project.id,
                    root: cwd,
                    path,
                    base,
                    file,
                };

                // Symbols first: a type's declaring symbol must be interned before the
                // type records it, or the type would carry no arena index for it.
                symbols::resolve(&mut client, &mut snapshot, &mut symbol_ids, ctx)?;
                resolve_types(&mut client, &mut snapshot, &mut interned, &symbol_ids, ctx)?;

                snapshot.sources.push(SourceFile {
                    uri: workspace_uri(cwd, path),
                    // tsgo already hashed the content; rehashing would be a second
                    // answer to a question that has one.
                    digest: Digest(decoded.content_hash),
                    display_path: path.to_owned(),
                });
            }
        }

        collect_diagnostics(&mut client, &mut snapshot, &opened)?;

        // Seeded with every interned type, because reachability does not exist yet
        // to say which of them the build will actually reach. The seam is the seed
        // set: when it does, only this argument changes.
        let mut decomposed = None;
        let mut resolved = None;
        let mut folded = None;
        if self.decompose.is_some() || self.resolve_calls.is_some() || self.fold_constants.is_some()
        {
            let seeds: Vec<u32> = interned.keys().copied().collect();
            let project = opened
                .projects
                .first()
                .map_or_else(|| ProjectHandle(String::new()), |p| p.id.clone());
            let mut deep = decompose::Decomposer::new(
                &mut client,
                opened.snapshot,
                project,
                interned,
                symbol_ids,
                file_bases.clone(),
            );
            if let Some(budget) = self.decompose {
                decomposed = Some(deep.run(&mut snapshot, seeds, budget)?);
            }
            if let Some(budget) = self.resolve_calls {
                resolved = Some(deep.resolve_calls(&mut snapshot, budget)?);
            }
            if let Some(budget) = self.fold_constants {
                folded = Some(deep.fold_constants(&mut snapshot, budget)?);
            }
        }

        self.stats = FrontendStats {
            elapsed_ms: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
            round_trips: client.round_trips(),
            files: u32::try_from(snapshot.sources.len()).unwrap_or(u32::MAX),
            nodes_decoded: u32::try_from(snapshot.nodes.len()).unwrap_or(u32::MAX),
            types_resolved: u32::try_from(snapshot.node_types.len()).unwrap_or(u32::MAX),
            distinct_types: u32::try_from(snapshot.types.len()).unwrap_or(u32::MAX),
            errors: count_severity(&snapshot, nts_diagnostics::Severity::Error),
            warnings: count_severity(&snapshot, nts_diagnostics::Severity::Warning),
            symbols: u32::try_from(snapshot.symbols.len()).unwrap_or(u32::MAX),
            modules: symbols::module_count(&snapshot),
            calls_resolved: resolved.map_or(0, |r| r.decomposed),
            constants_folded: folded.map_or(0, |f| f.decomposed),
            decomposed: decomposed.map_or(0, |d| d.decomposed),
            decomposition_exhausted: decomposed.is_some_and(|d| d.exhausted),
        };

        snapshot.validate()?;
        Ok(snapshot)
    }

    fn stats(&self) -> FrontendStats {
        self.stats
    }
}

/// Resolve a type for every addressable node of one file, in a single exchange.
fn resolve_types(
    client: &mut Client,
    snapshot: &mut SemanticSnapshot,
    interned: &mut FxHashMap<u32, TypeId>,
    symbols: &FxHashMap<u32, SymbolId>,
    ctx: symbols::FileContext<'_>,
) -> Result<(), TsgoError> {
    // Lists are skipped, not because their type is uninteresting but because a
    // list has no `*ast.Node` behind it: its handle fails to resolve, and one
    // failure loses the whole batch.
    let addressable: Vec<(NodeId, NodeHandle)> = snapshot
        .nodes
        .iter()
        .enumerate()
        .skip(ctx.base as usize)
        .filter_map(|(index, node)| {
            let NodeKind::Syntax(kind) = node.kind else {
                return None;
            };
            let arena = u32::try_from(index).unwrap_or(u32::MAX);
            Some((
                NodeId(arena),
                NodeHandle(types::node_handle(
                    arena - ctx.base + 1,
                    kind,
                    ctx.path.as_str(),
                )),
            ))
        })
        .collect();

    let handles = addressable.iter().map(|(_, h)| h.clone()).collect();
    let responses = client.types_at(ctx.handle, ctx.project, handles)?;

    for ((node, _), response) in addressable.iter().zip(&responses) {
        let type_id = *interned.entry(response.id).or_insert_with(|| {
            let id = TypeId(u32::try_from(snapshot.types.len()).unwrap_or(u32::MAX));
            snapshot.types.push(types::classify(response, symbols));
            id
        });
        snapshot.node_types.insert(*node, type_id);
    }

    Ok(())
}

/// Rewrite an absolute path into a machine-independent workspace URI.
///
/// RFC §20.4: absolute machine paths are remapped so builds are reproducible and
/// a release artifact never carries a developer's home directory.
fn workspace_uri(root: &Utf8Path, path: &Utf8Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    format!("nts-workspace:///{relative}")
}

/// Record every diagnostic the checker produced.
///
/// Runs after all files are decoded so that each file already has a `SourceId`
/// and a diagnostic can name the source it belongs to.
fn collect_diagnostics(
    client: &mut Client,
    snapshot: &mut SemanticSnapshot,
    opened: &UpdateSnapshotResponse,
) -> Result<(), TsgoError> {
    let by_path: FxHashMap<&str, SourceId> = snapshot
        .sources
        .iter()
        .enumerate()
        .map(|(index, source)| {
            (
                source.display_path.as_str(),
                SourceId(u32::try_from(index).unwrap_or(u32::MAX)),
            )
        })
        .collect();

    let mut converted = Vec::new();
    for project in &opened.projects {
        let reported = client.diagnostics(opened.snapshot, &project.id)?;
        converted.extend(
            reported
                .iter()
                .filter_map(|d| convert_diagnostic(d, &by_path)),
        );
    }
    snapshot.diagnostics.extend(converted);
    Ok(())
}

/// Convert a checker diagnostic into the compiler's own vocabulary.
///
/// Diagnostics naming a file outside the decoded set are dropped rather than
/// anchored to an arbitrary source: a location pointing at the wrong file is
/// worse than no diagnostic, because it sends a reader somewhere real.
fn convert_diagnostic(
    reported: &DiagnosticResponse,
    by_path: &FxHashMap<&str, SourceId>,
) -> Option<nts_diagnostics::Diagnostic> {
    let file = *by_path.get(reported.file_name.as_str())?;
    let span = nts_diagnostics::Span::new(
        u32::try_from(reported.pos.max(0)).unwrap_or(u32::MAX),
        u32::try_from(reported.end.max(0)).unwrap_or(u32::MAX),
    );
    let location = nts_diagnostics::Location { file, span };

    let severity = match reported.category {
        proto::category::ERROR => nts_diagnostics::Severity::Error,
        proto::category::WARNING => nts_diagnostics::Severity::Warning,
        // Suggestions and messages are not build-affecting; recording them as
        // notes keeps `has_errors` honest.
        _ => nts_diagnostics::Severity::Note,
    };

    let mut diagnostic = nts_diagnostics::Diagnostic {
        severity,
        // TypeScript's own code, so `TS2322` stays greppable against its docs.
        code: format!("TS{}", reported.code),
        message: reported.text.clone(),
        primary: location,
        labels: Vec::new(),
    };
    // A message chain is the *reason* for the headline message. Dropping it loses
    // the half of the diagnostic that says what to fix.
    for link in &reported.message_chain {
        diagnostic = diagnostic.with_label(location, link.text.clone());
    }
    Some(diagnostic)
}

fn count_severity(snapshot: &SemanticSnapshot, severity: nts_diagnostics::Severity) -> u32 {
    u32::try_from(
        snapshot
            .diagnostics
            .iter()
            .filter(|d| d.severity == severity)
            .count(),
    )
    .unwrap_or(u32::MAX)
}

/// Prefix tsgo gives the libraries it bundles.
///
/// Unambiguous and compiler-generated, so it can be filtered without asking.
const BUNDLED_LIB_PREFIX: &str = "bundled:///";

/// Which of a project's source files this compiler should compile.
///
/// Not `root_files`: those are only what the tsconfig `include` names, so a file
/// reached by an import from outside that set is missing — and every symbol it
/// declares then has no node, no declaration, and no arena identity. Measured on
/// a two-file project importing one file from a sibling directory, `root_files`
/// gave 2 of the 3 files that make up the program.
///
/// Not every source file either: a project's program also contains the default
/// library and anything resolved from a package. Those are not this compiler's to
/// lower — the same boundary type decomposition stops at — and the default
/// library alone is 63 files.
fn compiled_files(
    client: &mut Client,
    snapshot: SnapshotHandle,
    project: &ProjectHandle,
) -> Result<Vec<Utf8PathBuf>, TsgoError> {
    let names = client.source_file_names(snapshot, project)?;
    let mut compiled = Vec::new();

    for name in names {
        // The bundled prefix is a cheap, exact prefilter. Asking about 63 library
        // files would cost more round trips than compiling the project.
        if name.starts_with(BUNDLED_LIB_PREFIX) {
            continue;
        }
        let path = Utf8PathBuf::from(name);
        // Path shape is a prefilter; the program's own metadata is the authority.
        let metadata = client.source_file_metadata(snapshot, project, &path)?;
        if metadata.is_default_library || metadata.is_from_external_library {
            continue;
        }
        compiled.push(path);
    }

    Ok(compiled)
}
