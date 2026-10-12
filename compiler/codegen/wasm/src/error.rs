//! A source decline and a missing compiler binding have distinct error paths.

use crate::EmitError;
use nts_semantic_schema::Origin;

#[derive(Debug)]
pub(crate) enum Failure {
    Unsupported(String),
    Invariant(String),
}

impl Failure {
    pub(crate) fn at(self, name: &str, origin: &Origin) -> EmitError {
        match self {
            Self::Unsupported(reason) => {
                EmitError::Declined(vec![nts_diagnostics::Diagnostic::error(
                    "NTS5001",
                    format!("wasm declines `{name}`: {reason}"),
                    origin.location,
                )])
            }
            Self::Invariant(reason) => EmitError::Invariant {
                function: name.into(),
                reason,
            },
        }
    }
}

impl From<String> for Failure {
    fn from(reason: String) -> Self {
        Self::Unsupported(reason)
    }
}
impl From<&str> for Failure {
    fn from(reason: &str) -> Self {
        Self::Unsupported(reason.into())
    }
}
impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(reason) | Self::Invariant(reason) => reason.fmt(f),
        }
    }
}
