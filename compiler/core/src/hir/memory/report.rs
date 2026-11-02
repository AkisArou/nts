use std::fmt::Write;

use super::super::contents::ValueFact;
use super::{Home, Multiplicity, Reason, SiteId};

#[derive(Debug, Clone)]
pub struct Site {
    pub id: SiteId,
    pub origin: nts_semantic_schema::Origin,
    pub context: String,
    pub multiplicity: Multiplicity,
    pub retention_frontier: String,
    pub bytes_held_to_frontier: RetainedBytes,
    pub home: Home,
    /// All unsealed obligations, even when another reason selects the home.
    pub obligations: Vec<Reason>,
    /// Caller interval awaiting independent retention/runtime reset proofs.
    pub candidate_owner: Option<String>,
    pub witness: Vec<String>,
    pub legacy: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Value {
    pub function: String,
    pub context: String,
    pub value: u32,
    pub aliases: Vec<String>,
    pub payload: ValueFact,
}

#[derive(Debug, Clone)]
pub struct SlotFact {
    pub owner: String,
    pub context: String,
    pub instance: String,
    pub slot: String,
    pub aliases: Vec<String>,
    pub payload: ValueFact,
}

#[derive(Debug, Clone, Default)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent effect columns in the published summary"
)]
pub struct FunctionSummary {
    pub function: String,
    pub context: String,
    pub returned: Vec<String>,
    pub writes: Vec<String>,
    /// Symbolic stores of a parametric summary; actuals are substituted together.
    pub stores: Vec<String>,
    pub may_change_length: bool,
    pub may_suspend: bool,
    pub may_reenter: bool,
    pub unknown_effects: bool,
}

#[derive(Debug, Clone)]
pub struct Frontier {
    pub owner: String,
    pub ends: Result<Vec<String>, String>,
}

#[derive(Debug, Clone)]
pub struct StoreVersion {
    pub function: String,
    pub context: String,
    pub value: u32,
    pub version: usize,
    pub aliases: Vec<String>,
    pub payload: ValueFact,
    pub slot: String,
}

#[derive(Debug, Clone)]
pub struct CaptureWrite {
    pub function: String,
    pub context: String,
    pub capture: u32,
    pub binding: String,
    pub slot: String,
    pub later_write: super::LaterWrite,
}

/// Bytes include backing storage and transitively held heap graphs. An
/// unavailable target/runtime footprint is Unknown, never an invented quota.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetainedBytes {
    Bound { bytes: u64, witness: String },
    Unknown { witness: String },
}

#[derive(Debug, Clone)]
pub struct Retention {
    pub frontier: String,
    /// One row per source site/context, with shared sites counted once here.
    pub sites: Vec<String>,
    pub bytes: RetainedBytes,
}

/// An operation whose escaping outcome has no complete HIR successor.
/// Its unknown payload and every live-before reference reach the same root.
#[derive(Debug, Clone)]
pub struct Outcome {
    pub function: String,
    pub context: String,
    pub value: u32,
    pub reason: String,
    pub live: Vec<u32>,
    pub payload: String,
}

/// Immutable proof nodes share their premises. Expanding a separate path for
/// every site would reintroduce quadratic work on long or cyclic graphs.
#[derive(Debug, Clone)]
pub struct Proof {
    pub id: usize,
    pub object: String,
    pub bound: String,
    pub causes: Vec<usize>,
    pub edge: String,
}

#[derive(Debug, Default)]
pub struct Report {
    pub sites: Vec<Site>,
    pub values: Vec<Value>,
    pub slots: Vec<SlotFact>,
    pub functions: Vec<FunctionSummary>,
    pub frontiers: Vec<Frontier>,
    pub outcomes: Vec<Outcome>,
    pub store_versions: Vec<StoreVersion>,
    pub captures: Vec<CaptureWrite>,
    pub retentions: Vec<Retention>,
    pub memory_events: usize,
    pub context_membership_visits: usize,
    pub event_changes: Vec<usize>,
    pub proofs: Vec<Proof>,
    pub alias_classes: Vec<(String, Vec<String>)>,
    pub operations: usize,
    pub contexts: usize,
    pub nodes: usize,
    pub work: usize,
    pub work_limit: usize,
    pub edges: usize,
    pub edge_limit: usize,
    pub failure: Option<Reason>,
    pub stages: Vec<(String, usize)>,
    pub state_changes: Vec<usize>,
    pub state_change_limit: usize,
}

impl Report {
    /// Stable, escaped TSV; never includes wall time, addresses or hash order.
    /// BTree-backed graph construction and canonical row sorts make this useful
    /// for byte-for-byte three-run comparisons, not just normalized totals.
    #[must_use]
    pub fn render(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(
            out,
            "memory-v2\tops={}\tcontexts={}\tnodes={}\twork={}/{}\tedges={}/{}\tfailure={:?}",
            self.operations,
            self.contexts,
            self.nodes,
            self.work,
            self.work_limit,
            self.edges,
            self.edge_limit,
            self.failure
        );
        let _ = writeln!(out, "work-stages\t{:?}", self.stages);
        let _ = writeln!(
            out,
            "points-to-changes\tmax={}\tlimit={}",
            self.state_changes.iter().max().unwrap_or(&0),
            self.state_change_limit
        );
        let _ = writeln!(
            out,
            "memory-events\tnodes={}\tmax-changes={}\tlimit={}",
            self.memory_events,
            self.event_changes.iter().max().unwrap_or(&0),
            self.state_change_limit
        );
        let _ = writeln!(
            out,
            "fence-context-visits\t{}",
            self.context_membership_visits
        );
        for (node, changes) in self.state_changes.iter().enumerate() {
            let _ = writeln!(out, "node-changes\t{node}\t{changes}");
        }
        for (class, members) in &self.alias_classes {
            let _ = writeln!(out, "alias-class\t{class:?}\t{members:?}");
        }
        for site in &self.sites {
            let _ = writeln!(
                out,
                "site\t{:?}\t%{}\t{:?}\t{:?}\t{:?}\t{:?}\tlegacy={:?}\towner={:?}\tobligations={:?}\twitness={:?}\torigin={:?}\tretention={:?}\theld-bytes={:?}",
                site.id.function,
                site.id.value,
                site.id.storage,
                site.context,
                site.multiplicity,
                site.home,
                site.legacy,
                site.candidate_owner,
                site.obligations,
                site.witness,
                site.origin,
                site.retention_frontier,
                site.bytes_held_to_frontier
            );
        }
        for function in &self.functions {
            let _ = writeln!(
                out,
                "function\t{:?}\t{:?}\treturns={:?}\twrites={:?}\tstores={:?}\tlength={}\tsuspend={}\treenter={}\tunknown={}",
                function.function,
                function.context,
                function.returned,
                function.writes,
                function.stores,
                function.may_change_length,
                function.may_suspend,
                function.may_reenter,
                function.unknown_effects
            );
        }
        for store in &self.store_versions {
            let _ = writeln!(
                out,
                "store-version\t{:?}\t{:?}\t%{}\t{}\t{:?}\t{:?}\t{:?}",
                store.function,
                store.context,
                store.value,
                store.version,
                store.slot,
                store.aliases,
                store.payload
            );
        }
        for capture in &self.captures {
            let _ = writeln!(
                out,
                "capture-write\t{:?}\t{:?}\t%{}\t{:?}\t{:?}\t{:?}",
                capture.function,
                capture.context,
                capture.capture,
                capture.binding,
                capture.slot,
                capture.later_write
            );
        }
        for retention in &self.retentions {
            let _ = writeln!(
                out,
                "retention\t{:?}\t{:?}\t{:?}",
                retention.frontier, retention.sites, retention.bytes
            );
        }
        for outcome in &self.outcomes {
            let _ = writeln!(
                out,
                "outcome\t{:?}\t{:?}\t%{}\tunknown={:?}\tlive={:?}\tpayload={:?}",
                outcome.function,
                outcome.context,
                outcome.value,
                outcome.reason,
                outcome.live,
                outcome.payload
            );
        }
        for frontier in &self.frontiers {
            let _ = writeln!(out, "frontier\t{:?}\t{:?}", frontier.owner, frontier.ends);
        }
        for proof in &self.proofs {
            let _ = writeln!(
                out,
                "proof\t{}\t{:?}\t{:?}\t{:?}\t{:?}",
                proof.id, proof.object, proof.bound, proof.causes, proof.edge
            );
        }
        for slot in &self.slots {
            let _ = writeln!(
                out,
                "slot\t{:?}\t{:?}\t{:?}\t{:?}\t{:?}\t{:?}",
                slot.owner, slot.context, slot.instance, slot.slot, slot.aliases, slot.payload
            );
        }
        for value in &self.values {
            let _ = writeln!(
                out,
                "value\t{:?}\t{:?}\t%{}\t{:?}\t{:?}",
                value.function, value.context, value.value, value.aliases, value.payload
            );
        }
        out
    }
}
