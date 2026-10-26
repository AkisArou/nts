//! Measured work performed by the native snapshot builder.

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FrontendStats {
    /// Wall-clock spent in the frontend, in milliseconds.
    pub elapsed_ms: u64,
    /// Source files in the program.
    pub files: u32,
    /// AST nodes captured into the snapshot.
    pub nodes_captured: u32,
    /// Node/type pairs resolved.
    pub types_resolved: u32,
    /// Distinct type records interned.
    ///
    /// Interning keeps graph traversal proportional to distinct program types
    /// instead of visiting a type again at every syntax node that uses it.
    pub distinct_types: u32,
    /// Checker diagnostics of error severity.
    ///
    /// Non-zero means no backend may emit code for this program.
    pub errors: u32,
    /// Checker diagnostics of warning severity.
    pub warnings: u32,
    /// Distinct symbols interned.
    pub symbols: u32,
    /// Modules recorded.
    pub modules: u32,
    /// Call sites resolved to a target signature.
    pub calls_resolved: u32,
    /// Nodes folded to a compile-time constant.
    pub constants_folded: u32,
    /// True when decomposition stopped on its budget with work outstanding.
    ///
    /// Surfaced rather than swallowed: a partial type graph is a legitimate
    /// result, and presenting it as a complete one is not.
    pub decomposition_exhausted: bool,
}
