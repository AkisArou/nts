//! Values produced on a call's logical outcome edges.
//!
//! An operation's stable arena identity is distinct from its result. The
//! result exists only after a normal completion; the original thrown payload
//! and independent detail exist only after an exceptional completion. These
//! tokens define the destination's block parameters, rather than making a
//! normal result available to a handler.

use super::{BlockId, ValueId};

/// Which completion supplies an edge's produced values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeKind {
    Normal,
    Raised,
}

impl EdgeKind {
    pub(super) const fn label(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Raised => "raised",
        }
    }
}

/// An argument to a logical outcome edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutcomeValue {
    /// A value already available before the invocation, on either edge.
    Existing(ValueId),
    /// The operation's normal result; only the normal edge may name it.
    Result,
    /// The original erased payload; only the raised edge may name it.
    Thrown,
    /// A nullable managed-string detail, independently owned where supplied.
    Detail,
}

/// One real successor and the values it receives on that completion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutcomeEdge {
    pub target: BlockId,
    pub args: Vec<OutcomeValue>,
}

#[cfg(test)]
mod tests;
