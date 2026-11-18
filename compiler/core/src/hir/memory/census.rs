//! Versioned observation of the detached report. These wire types deliberately
//! do not serialize the solver's types: a change of meaning bumps VERSION.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::{Home, Multiplicity, Reason, Report, RetainedBytes, SiteId, Storage};

const VERSION: u32 = 1;

// The registry owns wire spellings and its complete contract-test population.
// Conversions from analysis enums remain exhaustive; adding a wire kind also
// makes the fixture builders below non-exhaustive until its case is supplied.
macro_rules! wire_kinds {
    ($name:ident { $($variant:ident => $wire:literal,)* }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name { $($variant,)* }
        impl $name {
            const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $wire,)* }
            }
            #[cfg(test)]
            const ALL: &'static [Self] = &[$(Self::$variant,)*];
        }
        impl Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }
    };
}

wire_kinds! { CensusReasonKind {
    WorkBudget => "work_budget",
    EdgeBudget => "edge_budget",
    ContextBudget => "context_budget",
    Outside => "outside",
    Returned => "returned",
    OutlivesFrame => "outlives_frame",
    RepeatedInstances => "repeated_instances",
    StorageBoundUnproved => "storage_bound_unproved",
    RuntimeRootContract => "runtime_root_contract",
    ManualStorage => "manual_storage",
    ProducerUnproved => "producer_unproved",
    WeakUnionBudget => "weak_union_budget",
    StoreOrderBudget => "store_order_budget",
    UnsealedWriter => "unsealed_writer",
    BindingIdentityUnproved => "binding_identity_unproved",
    RetainedEnvironment => "retained_environment",
    MissingOutcome => "missing_outcome",
    InvalidControlFlow => "invalid_control_flow",
    UnsupportedPhase => "unsupported_phase",
}}

wire_kinds! { CensusStorageKind {
    Object => "object",
    Array => "array",
    String => "string",
    Native => "native",
    CallResult => "call_result",
    CallStorage => "call_storage",
}}

wire_kinds! { CensusHomeKind {
    Frame => "frame",
    Region => "region",
    Heap => "heap",
    Immortal => "immortal",
}}

#[derive(Debug, Serialize)]
pub struct Census {
    pub schema: u32,
    pub failure: Option<CensusReason>,
    pub sites: Vec<CensusSite>,
    pub by_home: Vec<Summary>,
    /// A context can have several reasons; these groups overlap.
    pub by_reason: Vec<Summary>,
}

#[derive(Debug, Serialize)]
pub struct CensusId {
    pub function: String,
    pub value: u32,
    pub storage: CensusStorageKind,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct CensusLocation {
    pub file: u32,
    pub start: u32,
    pub end: u32,
}

impl From<&nts_diagnostics::Location> for CensusLocation {
    fn from(location: &nts_diagnostics::Location) -> Self {
        Self {
            file: location.file.0,
            start: location.span.start,
            end: location.span.end,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct CensusOrigin {
    pub location: CensusLocation,
    pub scope: Option<u32>,
    pub inline_chain: Vec<CensusLocation>,
    pub async_parent: Option<CensusLocation>,
    pub generated: Option<String>,
}

impl From<&nts_semantic_schema::Origin> for CensusOrigin {
    fn from(origin: &nts_semantic_schema::Origin) -> Self {
        Self {
            location: (&origin.location).into(),
            scope: origin.scope.map(|scope| scope.0),
            inline_chain: origin.inline_chain.iter().map(Into::into).collect(),
            async_parent: origin.async_parent.as_ref().map(Into::into),
            generated: origin.generated.map(|reason| format!("{reason:?}")),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CensusSite {
    pub id: CensusId,
    pub origin: CensusOrigin,
    pub contexts: Vec<CensusContext>,
}

#[derive(Debug, Serialize)]
pub struct CensusContext {
    pub id: usize,
    pub context: String,
    pub home: CensusHomeKind,
    pub owner: Option<String>,
    pub reason: Option<CensusReason>,
    pub obligations: Vec<CensusReason>,
    pub multiplicity: CensusMultiplicity,
    pub retention_frontier: String,
    pub bytes_held_to_frontier: CensusBytes,
}

#[derive(Debug, Serialize)]
pub struct CensusReason {
    pub kind: CensusReasonKind,
    pub detail: Option<String>,
}

impl From<&Reason> for CensusReason {
    fn from(reason: &Reason) -> Self {
        let (kind, detail) = match reason {
            Reason::WorkBudget => (CensusReasonKind::WorkBudget, None),
            Reason::EdgeBudget => (CensusReasonKind::EdgeBudget, None),
            Reason::ContextBudget => (CensusReasonKind::ContextBudget, None),
            Reason::Outside(detail) => (CensusReasonKind::Outside, Some(detail)),
            Reason::Returned(detail) => (CensusReasonKind::Returned, Some(detail)),
            Reason::OutlivesFrame(detail) => (CensusReasonKind::OutlivesFrame, Some(detail)),
            Reason::RepeatedInstances => (CensusReasonKind::RepeatedInstances, None),
            Reason::StorageBoundUnproved => (CensusReasonKind::StorageBoundUnproved, None),
            Reason::RuntimeRootContract => (CensusReasonKind::RuntimeRootContract, None),
            Reason::ManualStorage => (CensusReasonKind::ManualStorage, None),
            Reason::ProducerUnproved => (CensusReasonKind::ProducerUnproved, None),
            Reason::WeakUnionBudget => (CensusReasonKind::WeakUnionBudget, None),
            Reason::StoreOrderBudget => (CensusReasonKind::StoreOrderBudget, None),
            Reason::UnsealedWriter(detail) => (CensusReasonKind::UnsealedWriter, Some(detail)),
            Reason::BindingIdentityUnproved(detail) => {
                (CensusReasonKind::BindingIdentityUnproved, Some(detail))
            }
            Reason::RetainedEnvironment(detail) => {
                (CensusReasonKind::RetainedEnvironment, Some(detail))
            }
            Reason::MissingOutcome(detail) => (CensusReasonKind::MissingOutcome, Some(detail)),
            Reason::InvalidControlFlow(detail) => {
                (CensusReasonKind::InvalidControlFlow, Some(detail))
            }
            Reason::UnsupportedPhase(detail) => (CensusReasonKind::UnsupportedPhase, Some(detail)),
        };
        Self {
            kind,
            detail: detail.cloned(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CensusMultiplicity {
    pub kind: &'static str,
    pub limit: Option<usize>,
    pub witness: String,
}

impl From<&Multiplicity> for CensusMultiplicity {
    fn from(value: &Multiplicity) -> Self {
        let (kind, limit, witness) = match value {
            Multiplicity::One { witness } => ("one", Some(1), witness),
            Multiplicity::Bounded { limit, witness } => ("bounded", Some(*limit), witness),
            Multiplicity::Unbounded { witness } => ("unbounded", None, witness),
        };
        Self {
            kind,
            limit,
            witness: witness.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CensusBytes {
    pub kind: &'static str,
    pub bytes: Option<String>,
    pub witness: String,
}

impl From<&RetainedBytes> for CensusBytes {
    fn from(value: &RetainedBytes) -> Self {
        let (kind, bytes, witness) = match value {
            RetainedBytes::Bound { bytes, witness } => ("bound", Some(bytes.to_string()), witness),
            RetainedBytes::Unknown { witness } => ("unknown", None, witness),
        };
        Self {
            kind,
            bytes,
            witness: witness.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub kind: &'static str,
    pub sites: usize,
    pub contexts: usize,
}

type Groups = BTreeMap<&'static str, (BTreeSet<usize>, usize)>;

fn summaries(groups: Groups) -> Vec<Summary> {
    groups
        .into_iter()
        .map(|(kind, (sites, contexts))| Summary {
            kind,
            sites: sites.len(),
            contexts,
        })
        .collect()
}

impl Report {
    /// Pure projection of stage 2, without rerunning or consulting placement.
    /// `SiteId` identifies a producer within this program/producer revision.
    #[must_use]
    pub fn census(&self) -> Census {
        let mut grouped: BTreeMap<(&SiteId, CensusOrigin), Vec<&super::Site>> = BTreeMap::new();
        let mut homes: Groups = BTreeMap::new();
        let mut reasons: Groups = BTreeMap::new();
        for site in &self.sites {
            grouped
                .entry((&site.id, (&site.origin).into()))
                .or_default()
                .push(site);
        }
        let sites = grouped
            .into_iter()
            .enumerate()
            .map(|(site_number, ((id, origin), mut rows))| {
                rows.sort_by(|a, b| (&a.context, a.context_id).cmp(&(&b.context, b.context_id)));
                let contexts = rows
                    .into_iter()
                    .map(|site| {
                        let (home, owner, reason) = match &site.home {
                            Home::Immortal => (CensusHomeKind::Immortal, None, None),
                            Home::Frame => (CensusHomeKind::Frame, None, None),
                            Home::Cohort { owner } => {
                                (CensusHomeKind::Region, Some(owner.clone()), None)
                            }
                            Home::Heap(reason) => {
                                (CensusHomeKind::Heap, None, Some(CensusReason::from(reason)))
                            }
                        };
                        let group = homes.entry(home.as_str()).or_default();
                        group.0.insert(site_number);
                        group.1 += 1;
                        let obligations: Vec<_> =
                            site.obligations.iter().map(CensusReason::from).collect();
                        let kinds: BTreeSet<_> = obligations
                            .iter()
                            .chain(reason.iter())
                            .map(|reason| reason.kind.as_str())
                            .collect();
                        for kind in kinds {
                            let group = reasons.entry(kind).or_default();
                            group.0.insert(site_number);
                            group.1 += 1;
                        }
                        CensusContext {
                            id: site.context_id.0,
                            context: site.context.clone(),
                            home,
                            owner,
                            reason,
                            obligations,
                            multiplicity: (&site.multiplicity).into(),
                            retention_frontier: site.retention_frontier.clone(),
                            bytes_held_to_frontier: (&site.bytes_held_to_frontier).into(),
                        }
                    })
                    .collect();
                CensusSite {
                    id: CensusId {
                        function: id.function.clone(),
                        value: id.value,
                        storage: match id.storage {
                            Storage::Object => CensusStorageKind::Object,
                            Storage::Array => CensusStorageKind::Array,
                            Storage::String => CensusStorageKind::String,
                            Storage::Native => CensusStorageKind::Native,
                            Storage::CallResult => CensusStorageKind::CallResult,
                            Storage::CallStorage => CensusStorageKind::CallStorage,
                        },
                    },
                    origin,
                    contexts,
                }
            })
            .collect();
        Census {
            schema: VERSION,
            failure: self.failure.as_ref().map(Into::into),
            sites,
            by_home: summaries(homes),
            by_reason: summaries(reasons),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::super::{ContextId, Site};
    use super::*;
    use nts_diagnostics::{Location, SourceId, Span};

    fn site(value: u32, home: Home) -> Site {
        Site {
            id: SiteId {
                function: "fixture".to_owned(),
                value,
                storage: Storage::Object,
            },
            origin: nts_semantic_schema::Origin::source(Location {
                file: SourceId(0),
                span: Span::new(value, value + 1),
            }),
            context: "root".to_owned(),
            context_id: ContextId(0),
            multiplicity: Multiplicity::One {
                witness: "single activation".to_owned(),
            },
            retention_frontier: "frame root".to_owned(),
            bytes_held_to_frontier: RetainedBytes::Unknown {
                witness: "footprint unsealed".to_owned(),
            },
            home,
            obligations: Vec::new(),
            candidate_owner: None,
            witness: Vec::new(),
            legacy: Vec::new(),
            legacy_variants: Vec::new(),
            legacy_unknown: None,
        }
    }

    #[test]
    fn census_keeps_site_identity_contexts_and_overlapping_reasons() {
        let mut heap = site(2, Home::Heap(Reason::RepeatedInstances));
        heap.obligations = vec![Reason::RepeatedInstances, Reason::StorageBoundUnproved];
        heap.multiplicity = Multiplicity::Unbounded {
            witness: "loop".to_owned(),
        };
        let mut second = heap.clone();
        second.context = "second".to_owned();
        second.context_id = ContextId(1);
        second.home = Home::Frame;
        let mut region = site(
            1,
            Home::Cohort {
                owner: "caller".to_owned(),
            },
        );
        region.multiplicity = Multiplicity::Bounded {
            limit: 3,
            witness: "bound".to_owned(),
        };
        region.bytes_held_to_frontier = RetainedBytes::Bound {
            bytes: 128,
            witness: "sealed".to_owned(),
        };
        // Cohort/Immortal exercise the wire projection, not a new solver claim.
        let report = Report {
            sites: vec![
                heap,
                region,
                site(0, Home::Frame),
                second,
                site(3, Home::Immortal),
            ],
            failure: Some(Reason::WorkBudget),
            ..Report::default()
        };
        let census = report.census();
        assert_eq!(census.sites.len(), 4);
        assert_eq!(census.sites[2].id.value, 2);
        assert_eq!(census.sites[2].origin.location.start, 2);
        assert_eq!(census.sites[2].contexts.len(), 2);
        let repeated = census
            .by_reason
            .iter()
            .find(|row| row.kind == "repeated_instances")
            .unwrap();
        assert_eq!((repeated.sites, repeated.contexts), (1, 2));
        assert_eq!(
            census.sites[1].contexts[0]
                .bytes_held_to_frontier
                .bytes
                .as_deref(),
            Some("128")
        );
        assert_eq!(
            census.sites[2].contexts[0].bytes_held_to_frontier.bytes,
            None
        );
        assert_eq!(census.failure.unwrap().kind, CensusReasonKind::WorkBudget);
        let rendered = serde_json::to_value(report.census()).unwrap();
        assert_eq!(rendered["schema"], 1);
        assert_eq!(
            rendered["sites"][2]["id"],
            serde_json::json!({"function":"fixture","value":2,"storage":"object"})
        );
        assert_eq!(
            rendered["by_home"],
            serde_json::json!([
                {"kind":"frame","sites":2,"contexts":2}, {"kind":"heap","sites":1,"contexts":1},
                {"kind":"immortal","sites":1,"contexts":1}, {"kind":"region","sites":1,"contexts":1}
            ])
        );
        assert!(Report::default().census().sites.is_empty());
        assert!(Report::default().census().by_home.is_empty());
    }
    #[test]
    fn every_wire_variant_matches_the_shared_typescript_contract() {
        let mut sites: Vec<_> = CensusHomeKind::ALL
            .iter()
            .enumerate()
            .map(|(index, kind)| {
                let home = match kind {
                    CensusHomeKind::Frame => Home::Frame,
                    CensusHomeKind::Region => Home::Cohort {
                        owner: "caller".to_owned(),
                    },
                    CensusHomeKind::Heap => Home::Heap(Reason::RepeatedInstances),
                    CensusHomeKind::Immortal => Home::Immortal,
                };
                site(u32::try_from(index).unwrap(), home)
            })
            .collect();
        sites[2].obligations = CensusReasonKind::ALL
            .iter()
            .map(|kind| match kind {
                CensusReasonKind::WorkBudget => Reason::WorkBudget,
                CensusReasonKind::EdgeBudget => Reason::EdgeBudget,
                CensusReasonKind::ContextBudget => Reason::ContextBudget,
                CensusReasonKind::Outside => Reason::Outside("detail".to_owned()),
                CensusReasonKind::Returned => Reason::Returned("detail".to_owned()),
                CensusReasonKind::OutlivesFrame => Reason::OutlivesFrame("detail".to_owned()),
                CensusReasonKind::RepeatedInstances => Reason::RepeatedInstances,
                CensusReasonKind::StorageBoundUnproved => Reason::StorageBoundUnproved,
                CensusReasonKind::RuntimeRootContract => Reason::RuntimeRootContract,
                CensusReasonKind::ManualStorage => Reason::ManualStorage,
                CensusReasonKind::ProducerUnproved => Reason::ProducerUnproved,
                CensusReasonKind::WeakUnionBudget => Reason::WeakUnionBudget,
                CensusReasonKind::StoreOrderBudget => Reason::StoreOrderBudget,
                CensusReasonKind::UnsealedWriter => Reason::UnsealedWriter("detail".to_owned()),
                CensusReasonKind::BindingIdentityUnproved => {
                    Reason::BindingIdentityUnproved("detail".to_owned())
                }
                CensusReasonKind::RetainedEnvironment => {
                    Reason::RetainedEnvironment("detail".to_owned())
                }
                CensusReasonKind::MissingOutcome => Reason::MissingOutcome("detail".to_owned()),
                CensusReasonKind::InvalidControlFlow => {
                    Reason::InvalidControlFlow("detail".to_owned())
                }
                CensusReasonKind::UnsupportedPhase => Reason::UnsupportedPhase("detail".to_owned()),
            })
            .collect();
        for kind in CensusStorageKind::ALL {
            let mut row = site(u32::try_from(sites.len()).unwrap(), Home::Frame);
            row.id.storage = match kind {
                CensusStorageKind::Object => Storage::Object,
                CensusStorageKind::Array => Storage::Array,
                CensusStorageKind::String => Storage::String,
                CensusStorageKind::Native => Storage::Native,
                CensusStorageKind::CallResult => Storage::CallResult,
                CensusStorageKind::CallStorage => Storage::CallStorage,
            };
            sites.push(row);
        }
        let report = Report {
            sites,
            failure: Some(Reason::Outside("detail".to_owned())),
            ..Report::default()
        };
        let actual = serde_json::json!({
            "preparation": "preparation: backend=c provider=ReferenceCounting",
            "sources": [{"id": 0, "uri": "nts-workspace:///contract.ts", "digest": vec![0_u8; 16]}],
            "uncompiled_functions": 0,
            "census": report.census(),
        });
        let expected: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/memory_census_contract.json"))
                .unwrap();
        assert_eq!(
            actual, expected,
            "update the shared wire fixture and its TypeScript validator together"
        );
    }
}
