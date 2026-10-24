//! Safe access to a native TypeScript checked program.
//!
//! Upstream handles and arena lifetimes stay private. All frontend work runs
//! on a large-stack capture thread with an independent diagnostics pool;
//! the returned semantic snapshot owns its data.
//! Native panics propagate to the caller, with no recovery or partial answer.

#[cfg(feature = "tsrs")]
mod ast;
#[cfg(feature = "tsrs")]
mod cache_replay;
#[cfg(feature = "tsrs")]
mod environment;
#[cfg(feature = "tsrs")]
mod host;
#[cfg(feature = "tsrs")]
mod phase;
#[cfg(feature = "tsrs")]
mod program;
#[cfg(feature = "tsrs")]
mod semantic;
#[cfg(feature = "tsrs")]
mod session;
#[cfg(feature = "tsrs")]
mod strings;
#[cfg(feature = "tsrs")]
pub use ast::*;
#[cfg(feature = "tsrs")]
pub use cache_replay::{InputChanged, InputObservation};
#[cfg(feature = "tsrs")]
pub use host::{Input, InputKind, InputPath};
#[cfg(feature = "tsrs")]
pub use phase::{CapturePhase, SyntaxPhase, ViewPhase};
#[cfg(feature = "tsrs")]
pub use program::{
    Checked, Diagnostic, DiagnosticCategory, File, Finished, LoadError, Project, ProjectSemantics,
    ProjectSpec, Resolved, ResolvedImport, SourceChanges,
};
#[cfg(feature = "tsrs")]
pub use semantic::*;
#[cfg(feature = "tsrs")]
pub use session::*;
#[cfg(feature = "tsrs")]
pub use strings::JsString;

mod text;
pub use text::{BytePos, Utf16Pos, Utf16Span};

/// Exact upstream versions pinned in the vendored provenance inventory.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VersionInfo {
    pub tsrs_version: &'static str,
    pub tsrs_commit: &'static str,
    pub typescript_commit: &'static str,
}

/// Checker and TypeScript identities, generated from `third_party/tsrs/UPSTREAM.json`.
pub const VERSION: VersionInfo = VersionInfo {
    tsrs_version: env!("NTS_TSRS_VERSION"),
    tsrs_commit: env!("NTS_TSRS_COMMIT"),
    typescript_commit: env!("NTS_TYPESCRIPT_COMMIT"),
};
