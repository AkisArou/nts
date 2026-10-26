//! Safe access to a native TypeScript checked program.
//!
//! Upstream handles and arena lifetimes stay private. All frontend work runs
//! on a large-stack capture thread with an independent diagnostics pool;
//! the returned semantic snapshot owns its data.
//! Native panics propagate to the caller, with no recovery or partial answer.

mod ast;
mod cache_replay;
mod environment;
mod host;
mod phase;
mod program;
mod semantic;
mod session;
mod strings;
pub use ast::*;
pub use cache_replay::{InputChanged, InputObservation};
pub use host::{Input, InputKind, InputPath};
pub use phase::{CapturePhase, SyntaxPhase, ViewPhase};
pub use program::{
    Checked, Diagnostic, DiagnosticCategory, DiagnosticScope, DiagnosticsSelected,
    DiagnosticsUnselected, File, Finished, LoadError, Project, ProjectSemantics, ProjectSpec,
    Resolved, ResolvedImport, SourceChanges,
};
pub use semantic::*;
pub use session::*;
pub use strings::JsString;

mod text;
pub use text::{BytePos, Utf16Pos, Utf16Span};

/// An explicitly carried local change to the named upstream revision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VendorPatch {
    pub id: &'static str,
    pub sha256: &'static str,
}

/// Exact upstream versions and carried patches in the vendored inventory.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VersionInfo {
    pub tsrs_version: &'static str,
    pub tsrs_commit: &'static str,
    pub typescript_commit: &'static str,
    pub patches: &'static [VendorPatch],
}

/// Checker and TypeScript identities, generated from `third_party/tsrs/UPSTREAM.json`.
pub const VERSION: VersionInfo = VersionInfo {
    tsrs_version: env!("NTS_TSRS_VERSION"),
    tsrs_commit: env!("NTS_TSRS_COMMIT"),
    typescript_commit: env!("NTS_TYPESCRIPT_COMMIT"),
    patches: include!(concat!(env!("OUT_DIR"), "/vendor_patches.rs")),
};

#[cfg(test)]
#[test]
fn exported_checker_identity_matches_the_vendored_provenance() {
    let upstream: serde_json::Value =
        serde_json::from_str(include_str!("../../../third_party/tsrs/UPSTREAM.json"))
            .expect("vendor provenance");
    assert_eq!(
        VERSION.tsrs_version,
        upstream["version"].as_str().expect("version")
    );
    assert_eq!(
        VERSION.tsrs_commit,
        upstream["commit"].as_str().expect("commit")
    );
    assert_eq!(
        VERSION.typescript_commit,
        upstream["typescript_commit"]
            .as_str()
            .expect("TypeScript commit")
    );
    let patches = upstream["patches"]
        .as_array()
        .map_or(&[][..], Vec::as_slice);
    assert_eq!(VERSION.patches.len(), patches.len());
    for (actual, expected) in VERSION.patches.iter().zip(patches) {
        assert_eq!(actual.id, expected["id"].as_str().expect("patch id"));
        assert_eq!(
            actual.sha256,
            expected["sha256"].as_str().expect("patch hash")
        );
    }
}

#[cfg(test)]
#[path = "yield_diagnostics_test.rs"]
mod yield_diagnostics_tests;
