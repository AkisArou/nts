//! The frontend boundary.
//!
//! One trait, so that the decision to obtain semantics from `tsgo --api` is
//! recorded in exactly one place and can be revisited without touching a single
//! downstream crate.

use camino::Utf8Path;

use nts_semantic_schema::{SemanticSnapshot, SnapshotError};

/// Anything that can produce a [`SemanticSnapshot`] for a program.
///
/// The only implementation today is [`crate::TsgoApi`]. The trait exists
/// because the transport carries a measured risk (see [`FrontendStats`]) and the
/// insurance against that risk is being able to replace it here.
pub trait SemanticSource {
    /// Type-check the program rooted at `tsconfig` and produce a snapshot.
    fn snapshot(&mut self, tsconfig: &Utf8Path) -> Result<SemanticSnapshot, SnapshotError>;

    /// Cost of the most recent [`SemanticSource::snapshot`] call.
    ///
    /// Reported in the build report rather than logged, because the number only
    /// matters if it is visible on every build.
    fn stats(&self) -> FrontendStats;
}

/// What the frontend cost.
///
/// # Gate G1
///
/// The `tsgo --api` transport was chosen knowing that type information arrives
/// over RPC. ASTs arrive in bulk — tsgo's encoder ships a whole file as one flat
/// buffer — but types are queried per location and batched per file. That should
/// make [`FrontendStats::round_trips`] scale with *file* count, not node count.
///
/// This struct exists so that assumption is measured from the first build rather
/// than assumed until it hurts. If `round_trips` starts tracking `nodes_decoded`,
/// the batching is not working and the transport needs revisiting.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FrontendStats {
    /// Wall-clock spent in the frontend, in milliseconds.
    pub elapsed_ms: u64,
    /// Request/response pairs exchanged with the checker.
    pub round_trips: u64,
    /// Source files in the program.
    pub files: u32,
    /// AST nodes decoded into the snapshot.
    pub nodes_decoded: u32,
    /// Node/type pairs resolved.
    pub types_resolved: u32,
    /// Distinct type records interned.
    ///
    /// The number that matters for decomposition cost: tsgo exposes no batch
    /// endpoint for a type's members, so any pass that decomposes them spends one
    /// round trip per *distinct* type. Interning is what keeps that proportional
    /// to a program's types rather than its nodes.
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
    /// Structured types resolved into members or properties.
    pub decomposed: u32,
    /// True when decomposition stopped on its budget with work outstanding.
    ///
    /// Surfaced rather than swallowed: a partial type graph is a legitimate
    /// result, and presenting it as a complete one is not.
    pub decomposition_exhausted: bool,
}

impl FrontendStats {
    /// Round trips per file.
    ///
    /// The health metric for the chosen transport. Batched type queries should
    /// hold this at a small constant; a value that climbs with program size
    /// means queries are escaping the per-file batch.
    #[must_use]
    pub fn round_trips_per_file(&self) -> f64 {
        if self.files == 0 {
            return 0.0;
        }
        // Both counts are far below 2^53; the cast cannot lose a digit here.
        #[allow(clippy::cast_precision_loss)]
        let trips = self.round_trips as f64;
        trips / f64::from(self.files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_per_file_is_zero_for_empty_programs() {
        assert!(FrontendStats::default().round_trips_per_file().abs() < f64::EPSILON);
    }

    #[test]
    fn round_trips_per_file_reports_the_batching_ratio() {
        let stats = FrontendStats {
            files: 10,
            round_trips: 30,
            ..FrontendStats::default()
        };
        assert!((stats.round_trips_per_file() - 3.0).abs() < f64::EPSILON);
    }
}
