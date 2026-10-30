//! Immutable inputs and one indexed resolver authority for guards and selection.
//!
//! The adapter supplies fresh host/package observations. An open discovery
//! inventory is never proof that no provider exists. Evidence whose availability
//! observations are not independently established cannot supply final selection.

use super::resolve::{ResolutionIndex, ResolutionWork, resolve_indexed};
use super::{
    Candidate, CurrentInputs, DecisionObservation, Demand, Digest, FeatureId, PackageInstance,
    Plan, Profile, RejectionReason, Request, Requirements, ResolutionError, Selector, Target,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Effective, freshly observed inputs before the catalog takes ownership.
/// Current compiler-input identities bind the backend/helper build; manifest
/// membership alone never supplies eligibility or a conformance proof.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogInputs {
    pub target: Target,
    pub profile: Profile,
    pub overrides: BTreeMap<FeatureId, Selector>,
    pub profile_options: BTreeMap<String, Value>,
    pub candidates: Vec<Candidate>,
    pub current: Vec<CurrentInputs>,
    pub packages: BTreeSet<PackageInstance>,
}
impl CatalogInputs {
    fn request<'a>(&'a self, uses: &'a Requirements) -> Request<'a> {
        Request {
            target: &self.target,
            profile: &self.profile,
            overrides: &self.overrides,
            uses,
            candidates: &self.candidates,
            current: &self.current,
            packages: &self.packages,
        }
    }
}

#[derive(Debug)]
struct Proof {
    identity: Digest,
    feature: FeatureId,
    unresolved: usize,
    mismatch: bool,
}
impl Proof {
    fn state(&self) -> (bool, bool) {
        (!self.mismatch && self.unresolved == 0, !self.mismatch)
    }
}
#[derive(Debug, Default)]
struct ProofGraph {
    proofs: Vec<Proof>,
    watchers: BTreeMap<FeatureId, Vec<(usize, bool)>>,
    dependents: BTreeMap<FeatureId, BTreeSet<FeatureId>>,
    features: BTreeSet<FeatureId>,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CatalogWork {
    pub resolver: ResolutionWork,
    pub proof_visits: usize,
    pub decision_visits: usize,
    pub wake_visits: usize,
}

/// No editable inputs, supplied answer map, or second provider selector.
#[derive(Debug)]
pub struct EligibilityCatalog {
    inputs: CatalogInputs,
    identity: Digest,
    reach_identity: nts_diagnostics::Digest,
    index: ResolutionIndex,
    availability: BTreeMap<FeatureId, Option<bool>>,
    grounded: BTreeSet<Digest>,
    work: CatalogWork,
}
impl EligibilityCatalog {
    pub fn new(mut inputs: CatalogInputs) -> Result<Self, ResolutionError> {
        for candidate in &mut inputs.candidates {
            for evidence in &mut candidate.records {
                evidence.record.inputs = evidence
                    .record
                    .inputs
                    .clone()
                    .canonical()
                    .map_err(invalid)?;
            }
            candidate.records = ordered(std::mem::take(&mut candidate.records))?;
        }
        inputs.candidates = ordered(inputs.candidates)?;
        for current in &mut inputs.current {
            current.inputs = current.inputs.clone().canonical().map_err(invalid)?;
        }
        inputs.current = ordered(inputs.current)?;
        let bytes = serde_json::to_vec(&("provider-catalog-v1", &inputs))
            .map_err(|error| invalid(error.to_string()))?;
        let hash = hmac_sha256::Hash::hash(&bytes);
        let mut reach_identity = [0; 16];
        reach_identity.copy_from_slice(&hash[..16]);
        let index = ResolutionIndex::new(&inputs.request(&Requirements::new()))?;
        let mut catalog = Self {
            inputs,
            identity: Digest::of_bytes(&bytes),
            reach_identity: nts_diagnostics::Digest(reach_identity),
            index,
            availability: BTreeMap::new(),
            grounded: BTreeSet::new(),
            work: CatalogWork::default(),
        };
        catalog.establish_availability();
        Ok(catalog)
    }
    #[must_use]
    pub const fn identity(&self) -> &Digest {
        &self.identity
    }
    #[must_use]
    pub const fn reach_identity(&self) -> nts_diagnostics::Digest {
        self.reach_identity
    }
    #[must_use]
    pub fn work(&self) -> CatalogWork {
        CatalogWork {
            resolver: self.index.work(),
            ..self.work
        }
    }
    #[must_use]
    pub fn available(&self, feature: &FeatureId) -> Option<bool> {
        if let Some(answer) = self.availability.get(feature) {
            return *answer;
        }
        // Query the same indexed authority for an explicit wildcard denial.
        // No-candidate inventory absence remains unknown until discovery closes.
        proven_absent(feature, &self.query(feature, &self.grounded)).then_some(false)
    }
    pub fn resolve(&self, requirements: &Requirements) -> Result<Plan, ResolutionError> {
        resolve_indexed(
            &self.inputs.request(requirements),
            &self.index,
            Some(&self.grounded),
        )
    }
    fn query(
        &self,
        feature: &FeatureId,
        allowed: &BTreeSet<Digest>,
    ) -> Result<Plan, ResolutionError> {
        let uses = BTreeMap::from([(feature.clone(), Demand::default())]);
        resolve_indexed(&self.inputs.request(&uses), &self.index, Some(allowed))
    }
    /// Every completion lies between grounded and still-possible proof masks.
    /// Resolver contradiction checks inspect the complete current/proof set
    /// BEFORE masking, so adding proofs cannot invalidate a grounded plan.
    /// If both endpoints have the same unique complete choice, that grounded
    /// plan stays feasible and dominates every intermediate alternative too.
    /// Availability cycles without an independent basis never enter grounded.
    fn establish_availability(&mut self) {
        let ProofGraph {
            mut proofs,
            mut watchers,
            dependents,
            features,
        } = self.proof_graph();
        let mut possible = BTreeSet::new();
        for proof in &proofs {
            self.work.proof_visits += 1;
            let (grounded, upper) = proof.state();
            if grounded {
                self.grounded.insert(proof.identity.clone());
            }
            if upper {
                possible.insert(proof.identity.clone());
            }
        }
        let mut ready = features;
        while !ready.is_empty() {
            // All queries in this frontier see the same masks. Apply newly
            // established edges afterwards, coalescing every changed proof
            // and all shared downstream wakeups once for the complete batch.
            let mut observations = vec![];
            for feature in std::mem::take(&mut ready) {
                if self.availability.get(&feature).is_some_and(Option::is_some) {
                    continue;
                }
                let lower = self.query(&feature, &self.grounded);
                let upper = if self.grounded.len() == possible.len() {
                    lower.clone()
                } else {
                    self.query(&feature, &possible)
                };
                let answer = if matches!((&lower, &upper), (Ok(a), Ok(b)) if a == b) {
                    Some(true)
                } else if proven_absent(&feature, &upper) {
                    Some(false)
                } else {
                    None
                };
                self.availability.insert(feature.clone(), answer);
                if let Some(answer) = answer {
                    observations.push((feature, answer));
                }
            }
            let mut changed_proofs = BTreeSet::new();
            for (feature, answer) in observations {
                for (proof_id, expected) in watchers.remove(&feature).into_iter().flatten() {
                    self.work.decision_visits += 1;
                    let proof = &mut proofs[proof_id];
                    proof.unresolved -= 1;
                    proof.mismatch |= answer != expected;
                    changed_proofs.insert(proof_id);
                }
            }
            let mut affected = BTreeSet::new();
            for proof_id in changed_proofs {
                self.work.proof_visits += 1;
                let proof = &proofs[proof_id];
                let (grounded, upper) = proof.state();
                let changed = grounded && self.grounded.insert(proof.identity.clone());
                let changed = (!upper && possible.remove(&proof.identity)) || changed;
                if changed {
                    affected.insert(proof.feature.clone());
                }
            }
            self.work.wake_visits += wake(affected, &dependents, &mut ready);
        }
    }

    fn proof_graph(&mut self) -> ProofGraph {
        let mut graph = ProofGraph::default();
        for (candidate_id, candidate) in self.inputs.candidates.iter().enumerate() {
            graph.features.insert(candidate.key.feature.clone());
            for (evidence_id, evidence) in candidate.records.iter().enumerate() {
                let Ok(identity) = &self.index.records[&(candidate_id, evidence_id)] else {
                    continue;
                };
                let proof_id = graph.proofs.len();
                let mut proof = Proof {
                    identity: identity.clone(),
                    feature: candidate.key.feature.clone(),
                    unresolved: 0,
                    mismatch: false,
                };
                for decision in &evidence.record.inputs.decisions {
                    self.work.decision_visits += 1;
                    match decision {
                        DecisionObservation::Availability { feature, available } => {
                            proof.unresolved += 1;
                            graph.features.insert(feature.clone());
                            graph
                                .watchers
                                .entry(feature.clone())
                                .or_default()
                                .push((proof_id, *available));
                        }
                        DecisionObservation::ProfileOption { name, value } => {
                            proof.mismatch |= self.inputs.profile_options.get(name) != Some(value);
                        }
                        // The resolver checks selection against the complete
                        // chosen dependency plan, not a second selector here.
                        DecisionObservation::Selection { .. } => {}
                    }
                }
                for dependency in evidence
                    .record
                    .requirements
                    .keys()
                    .chain(&candidate.claim.requires)
                {
                    graph.features.insert(dependency.clone());
                    graph
                        .dependents
                        .entry(dependency.clone())
                        .or_default()
                        .insert(candidate.key.feature.clone());
                }
                graph.proofs.push(proof);
            }
        }
        graph.features.extend(
            self.inputs
                .overrides
                .keys()
                .chain(self.inputs.profile.pins.keys())
                .cloned(),
        );
        graph
    }
}
fn wake(
    features: BTreeSet<FeatureId>,
    dependents: &BTreeMap<FeatureId, BTreeSet<FeatureId>>,
    ready: &mut BTreeSet<FeatureId>,
) -> usize {
    let mut pending: Vec<_> = features.into_iter().collect();
    let mut seen = BTreeSet::new();
    while let Some(feature) = pending.pop() {
        if seen.insert(feature.clone()) {
            if let Some(next) = dependents.get(&feature) {
                pending.extend(next.iter().cloned());
            }
            ready.insert(feature);
        }
    }
    seen.len()
}
fn proven_absent(feature: &FeatureId, result: &Result<Plan, ResolutionError>) -> bool {
    let Err(ResolutionError::NoSolution { features, cycles }) = result else {
        return false;
    };
    let Some(absent) = features.get(feature) else {
        return false;
    };
    cycles.is_empty()
        && (absent.denied.is_some()
            || !absent.rejected.is_empty()
                && absent
                    .rejected
                    .iter()
                    .all(|row| matches!(row.reason, RejectionReason::Target)))
}
fn invalid(detail: String) -> ResolutionError {
    ResolutionError::InvalidInput { detail }
}
fn ordered<T: Serialize>(values: Vec<T>) -> Result<Vec<T>, ResolutionError> {
    let mut keyed = values
        .into_iter()
        .map(|value| {
            serde_json::to_vec(&value)
                .map(|key| (key, value))
                .map_err(|error| invalid(error.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    keyed.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(keyed.into_iter().map(|(_, value)| value).collect())
}
