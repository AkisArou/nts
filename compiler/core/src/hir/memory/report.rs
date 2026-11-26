use std::fmt::Write;

use super::super::contents::ValueFact;
use super::{Home, Multiplicity, Reason, SiteId};

#[derive(Debug, Clone)]
pub struct Site {
    pub id: SiteId,
    pub origin: nts_semantic_schema::Origin,
    pub context: String,
    pub context_id: super::ContextId,
    pub multiplicity: Multiplicity,
    pub retention_frontier: String,
    pub bytes_held_to_frontier: RetainedBytes,
    pub home: Home,
    /// All unsealed obligations, even when another reason selects the home.
    pub obligations: Vec<Reason>,
    /// Caller interval awaiting independent retention/runtime reset proofs.
    pub candidate_owner: Option<String>,
    pub witness: Vec<String>,
    /// Homes of the actual variants reached by this context, not other callers.
    pub legacy: Vec<String>,
    pub legacy_variants: Vec<super::LegacyVariant>,
    pub legacy_unknown: Option<String>,
    /// How the retention frontier was reached, from the lifetime proof.
    pub reached: Reached,
    /// Every slot that can hold this site's objects, with its owner. A weak
    /// class member names its class in the `member` slot; the class's own
    /// holders are in `Report::class_holders`.
    pub holders: Vec<Hold>,
}

/// The owner of a slot that holds a site's objects.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Holder {
    /// One allocation site in one calling context.
    Site {
        id: SiteId,
        context: super::ContextId,
    },
    /// A weak alias class; its members are listed in `Report::alias_classes`.
    Class(String),
    /// Storage the graph does not allocate: a parameter's or module slot's
    /// objects, an opaque result, or the immortal summary.
    External(String),
}

/// A field, element, key, value or backing slot, and the holder it belongs to.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hold {
    pub slot: String,
    pub holder: Holder,
}

/// The last edge that raised a site's lifetime bound.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Edge {
    /// Nothing raised it: the bound is the allocation's own scope.
    Scope,
    /// A root exposure raised it directly.
    Exposure,
    /// A store into a holder's slot raised it to the holder's bound.
    Stored(Hold),
    /// Its weak alias class joined the members' scopes.
    Joined,
}

/// Where the chain of proofs behind the bound starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Root {
    /// An allocation's own scope (this site's, or a holder's at the chain's end).
    Scope(Holder),
    /// Returned from this calling context to its caller.
    Returned { context: String },
    /// Reached by storage outside the analysed program.
    Outside(String),
    /// No proof: an unknown outcome or a failed analysis.
    Unknown(Reason),
    /// A weak class's joined scopes.
    Joined(Holder),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reached {
    pub edge: Edge,
    pub root: Root,
}

/// How this analysis's home relates to today's placement for one context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LegacyAgreement {
    /// No emitted variant was observed for this context.
    Unmapped(String),
    /// The same kind of home.
    Agrees,
    /// Heap here where today's placement uses a frame or region, for this
    /// home's reason. Today's placement has known defects, so this is the
    /// stated cost of a proof that stands on its own, not a verdict on it.
    Conservative(Reason),
    /// A frame or region proved here where today's placement uses the heap.
    Proved,
}

impl Site {
    #[must_use]
    pub fn legacy_agreement(&self) -> LegacyAgreement {
        if self.legacy.is_empty() {
            return LegacyAgreement::Unmapped(
                self.legacy_unknown
                    .clone()
                    .unwrap_or_else(|| "no emitted variant".to_owned()),
            );
        }
        let all = |home: &str| self.legacy.iter().all(|legacy| legacy == home);
        match &self.home {
            Home::Heap(reason) => {
                if self
                    .legacy
                    .iter()
                    .all(|legacy| legacy == "heap" || legacy == "host")
                {
                    LegacyAgreement::Agrees
                } else {
                    LegacyAgreement::Conservative(reason.clone())
                }
            }
            Home::Frame if all("frame") => LegacyAgreement::Agrees,
            Home::Cohort { .. } if all("call-region") => LegacyAgreement::Agrees,
            Home::Frame | Home::Cohort { .. } | Home::Immortal => LegacyAgreement::Proved,
        }
    }
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
    pub(super) comparison_inputs: super::comparison::Inputs,
    pub comparison_work: usize,
    pub comparison_failure: Option<String>,
    pub legacy_clones: Vec<(String, String)>,
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
    /// Each weak class's holders, published once for all its members.
    pub class_holders: Vec<(String, Vec<Hold>)>,
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
    /// Read the producer's context identity without parsing a display label.
    #[must_use]
    pub fn context(&self, id: super::ContextId) -> Option<super::ContextView<'_>> {
        self.comparison_inputs
            .contexts
            .get(id.0)
            .map(|context| super::ContextView {
                id,
                function: &context.function,
                key: &context.key,
                root: context.root,
                merged: context.merged,
            })
    }

    pub fn context_views(&self) -> impl Iterator<Item = super::ContextView<'_>> {
        self.comparison_inputs
            .contexts
            .iter()
            .enumerate()
            .map(|(at, context)| super::ContextView {
                id: super::ContextId(at),
                function: &context.function,
                key: &context.key,
                root: context.root,
                merged: context.merged,
            })
    }

    pub fn context_arrivals(&self) -> impl Iterator<Item = super::ContextArrival> + '_ {
        self.comparison_inputs
            .calls
            .iter()
            .map(|call| super::ContextArrival {
                parent: super::ContextId(call.parent),
                child: super::ContextId(call.child),
                operation: call.operation,
            })
    }

    fn render_legacy_contexts(&self, out: &mut String) {
        let _ = writeln!(
            out,
            "legacy-comparison\twork={}\tfailure={:?}\tcomplete-inputs={}",
            self.comparison_work, self.comparison_failure, self.comparison_inputs.complete
        );
        for (at, context) in self.comparison_inputs.contexts.iter().enumerate() {
            let _ = writeln!(
                out,
                "context-lineage\t{at}\t{:?}\t{:?}\troot={}\tmerged={}",
                context.function, context.key, context.root, context.merged
            );
        }
        for call in &self.comparison_inputs.calls {
            let _ = writeln!(
                out,
                "context-call\t{}\t%{}\t{}",
                call.parent, call.operation.0, call.child
            );
        }
        for (variant, original) in &self.legacy_clones {
            let _ = writeln!(out, "legacy-clone\t{variant:?}\t{original:?}");
        }
    }

    fn render_legacy_site(out: &mut String, site: &Site) {
        for variant in &site.legacy_variants {
            let _ = writeln!(
                out,
                "legacy-variant\t{:?}\t%{}\t{}\t{:?}\t{:?}\t{:?}\t{:?}",
                site.id.function,
                site.id.value,
                site.context_id.0,
                site.context,
                site.id.storage,
                variant.function,
                variant.home
            );
        }
        if let Some(reason) = &site.legacy_unknown {
            let _ = writeln!(
                out,
                "legacy-unknown\t{:?}\t%{}\t{}\t{:?}\t{reason:?}",
                site.id.function, site.id.value, site.context_id.0, site.context
            );
        }
    }

    /// Stable, escaped TSV; never includes wall time, addresses or hash order.
    /// BTree-backed graph construction and canonical row sorts make this useful
    /// for byte-for-byte three-run comparisons, not just normalized totals.
    #[must_use]
    pub fn render(&self) -> String {
        let mut out = String::new();
        let _ = writeln!(
            out,
            "memory-v3\tops={}\tcontexts={}\tnodes={}\twork={}/{}\tedges={}/{}\tfailure={:?}",
            self.operations,
            self.contexts,
            self.nodes,
            self.work,
            self.work_limit,
            self.edges,
            self.edge_limit,
            self.failure
        );
        self.render_legacy_contexts(&mut out);
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
        for (class, holders) in &self.class_holders {
            let _ = writeln!(out, "class-holders\t{class:?}\t{holders:?}");
        }
        for site in &self.sites {
            Self::render_site(&mut out, site);
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
        self.render_events(&mut out);
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
    fn render_site(out: &mut String, site: &Site) {
        Self::render_legacy_site(out, site);
        let _ = writeln!(
            out,
            "site\t{:?}\t%{}\t{:?}\t{:?}\t{:?}\t{:?}\tlegacy={:?}\towner={:?}\tobligations={:?}\twitness={:?}\torigin={:?}\tretention={:?}\theld-bytes={:?}\treached={:?}\tholders={:?}\tagreement={:?}",
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
            site.bytes_held_to_frontier,
            site.reached,
            site.holders,
            site.legacy_agreement()
        );
    }

    fn render_events(&self, out: &mut String) {
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
    }
}
