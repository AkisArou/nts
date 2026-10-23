//! Safe access to a native TypeScript checked program.
//!
//! Upstream handles and arena lifetimes stay private. All frontend work runs
//! on one large-stack thread; the returned semantic snapshot owns its data.
//! Native panics propagate to the caller, with no recovery or partial answer.

#[cfg(feature = "tsrs")]
mod ast;
#[cfg(feature = "tsrs")]
mod environment;
#[cfg(feature = "tsrs")]
mod host;
#[cfg(feature = "tsrs")]
mod program;
#[cfg(feature = "tsrs")]
mod session;
#[cfg(feature = "tsrs")]
mod strings;
#[cfg(feature = "tsrs")]
pub use ast::*;
#[cfg(feature = "tsrs")]
pub use host::{Input, InputKind};
#[cfg(feature = "tsrs")]
pub use program::{
    Checked, Diagnostic, DiagnosticCategory, File, LoadError, Project, ProjectSemantics,
    ProjectSpec, SourceChanges,
};
#[cfg(feature = "tsrs")]
pub use session::*;
#[cfg(feature = "tsrs")]
pub use strings::JsString;

mod text;
pub use text::{BytePos, Utf16Pos, Utf16Span};
