use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    Claim, DecisionObservation, Demand, Digest, FeatureId, ImplementationModule, ProviderKey,
    ProviderKind, Record, RecordInputs, RecordRejection, Requirements, Selector, Target, Use,
};

#[cfg(test)]
#[path = "resolve_tests.rs"]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmbientTypes {
    pub lib: BTreeSet<String>,
    pub types: BTreeSet<String>,
    pub overlay: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub preferences: Vec<Selector>,
    pub pins: BTreeMap<FeatureId, Selector>,
    pub denied: BTreeMap<String, String>,
    pub ambient_types: AmbientTypes,
    pub backends: Option<BTreeSet<String>>,
    pub hosts: Option<BTreeSet<String>>,
}

impl Profile {
    /// External profiles reject duplicate keys before decoding policy maps.
    pub fn parse(json: &str) -> Result<Self, String> {
        serde_json::from_value(super::manifest::strict_value(json)?)
            .map_err(|error| error.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Evidence {
    pub origin: String,
    pub record: Record,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub key: ProviderKey,
    pub claim: Claim,
    pub records: Vec<Evidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageInstance {
    pub name: String,
    pub instance: Digest,
    pub manifest: Digest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentInputs {
    pub provider: ProviderKey,
    /// Full proof identity whose recorded observation closure was revalidated.
    pub record: Digest,
    pub inputs: RecordInputs,
}

/// Fresh observations are supplied by the adapter. Selection performs no IO.
#[derive(Debug)]
pub struct Request<'a> {
    pub target: &'a Target,
    pub profile: &'a Profile,
    pub overrides: &'a BTreeMap<FeatureId, Selector>,
    pub uses: &'a Requirements,
    pub candidates: &'a [Candidate],
    pub current: &'a [CurrentInputs],
    pub packages: &'a BTreeSet<PackageInstance>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ChoiceReason {
    Override,
    Pin,
    Preference { rank: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Selected {
    pub provider: ProviderKey,
    #[serde(flatten)]
    pub implementation: ProviderKind,
    pub reason: ChoiceReason,
    pub options: BTreeMap<String, Value>,
    pub record: Digest,
    pub compiler_inputs: Digest,
    pub suite: Digest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Plan {
    pub selected: BTreeMap<FeatureId, Selected>,
    pub requirements: Requirements,
    pub modules: BTreeSet<ImplementationModule>,
    pub bindings: BTreeMap<FeatureId, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RejectionReason {
    Target,
    NotPreferred,
    MissingCurrentInputs,
    ConflictingCurrentInputs,
    Record { reason: RecordRejection },
    MissingRecord,
    ConflictingRecords,
    Coverage,
    ManifestRestriction,
    IncompleteClosure { missing: BTreeSet<FeatureId> },
    UnknownModule { module: ImplementationModule },
    InvalidModule { module: ImplementationModule },
    DifferentSelection { provider: ProviderKey },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Rejection {
    pub provider: ProviderKey,
    pub reason: RejectionReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Unavailable {
    pub demand: Demand,
    pub denied: Option<(String, String)>,
    pub rejected: Vec<Rejection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ResolutionError {
    InvalidInput {
        detail: String,
    },
    UnsupportedTarget {
        profile: String,
        backend: String,
        host: String,
    },
    NoSolution {
        features: BTreeMap<FeatureId, Unavailable>,
        cycles: Vec<Vec<FeatureId>>,
    },
    Ambiguous {
        alternatives: Vec<BTreeMap<FeatureId, Selected>>,
    },
}

#[derive(Clone)]
struct Choice<'a> {
    identity: Digest,
    candidate: &'a Candidate,
    evidence: &'a Evidence,
    reason: ChoiceReason,
    rank: usize,
    options: &'a BTreeMap<String, Value>,
}

type Choices<'a> = BTreeMap<FeatureId, Choice<'a>>;

struct Search<'a, 'r> {
    request: &'r Request<'a>,
    candidates: Vec<&'a Candidate>,
    best: Vec<Choices<'a>>,
    unavailable: BTreeMap<FeatureId, Unavailable>,
    cycles: Vec<Vec<FeatureId>>,
    minimum: BTreeMap<FeatureId, usize>,
    #[cfg(test)]
    visited: usize,
    #[cfg(test)]
    skip_pruning: bool,
}

fn admitted(restriction: Option<&BTreeSet<String>>, value: &str) -> bool {
    restriction.is_none_or(|allowed| allowed.contains(value))
}

fn package(key: &ProviderKey) -> PackageInstance {
    PackageInstance {
        name: key.package.clone(),
        instance: key.instance.clone(),
        manifest: key.manifest.clone(),
    }
}

fn requirements(request: &Request<'_>, chosen: &Choices<'_>) -> Requirements {
    let mut needed = request.uses.clone();
    for choice in chosen.values() {
        for (feature, demand) in &choice.evidence.record.requirements {
            needed.entry(feature.clone()).or_default().join(demand);
        }
    }
    needed
}

fn covers(choice: &Choice<'_>, demand: &Demand) -> bool {
    let claim = &choice.candidate.claim;
    let proof = &choice.evidence.record.coverage;
    proof.covers(demand)
        && claim.uses.as_ref().is_none_or(|uses| {
            demand.uses.is_subset(uses) && (!demand.open_surface || uses.contains(&Use::Value))
        })
        && claim.members.as_ref().is_none_or(|members| {
            demand.members.is_subset(members)
                && demand.extracted_members.is_subset(members)
                && (!demand.open_surface || members == &proof.members)
        })
}

fn unique_choices(choices: Vec<Choice<'_>>) -> Vec<Choice<'_>> {
    let mut unique = vec![];
    for choice in choices {
        if !unique.iter().any(|old| same_choice(old, &choice)) {
            unique.push(choice);
        }
    }
    unique
}

fn same_choice(left: &Choice<'_>, right: &Choice<'_>) -> bool {
    left.candidate.key == right.candidate.key
        && left.options == right.options
        && left.identity == right.identity
}

fn same_parent(left: &Choice<'_>, right: &Choice<'_>) -> bool {
    left.candidate.key == right.candidate.key
        && left.options == right.options
        && left.evidence.record.requirements == right.evidence.record.requirements
}

/// Compare the reached feature choices first. Only identical choices introduce
/// identical dependency frontiers to compare next. Otherwise an optional
/// dependency could overrule its parent's first eligible preference, and
/// comparing only common dependencies is not transitive.
fn dominates(left: &Choices<'_>, right: &Choices<'_>, roots: &Requirements) -> bool {
    let mut frontier: BTreeSet<_> = roots.keys().cloned().collect();
    let mut seen = BTreeSet::new();
    while !frontier.is_empty() {
        let mut strict = false;
        let mut identical = true;
        for feature in &frontier {
            let (Some(a), Some(b)) = (left.get(feature), right.get(feature)) else {
                return false;
            };
            if a.rank > b.rank {
                return false;
            }
            strict |= a.rank < b.rank;
            identical &= same_parent(a, b);
        }
        if strict {
            return true;
        }
        if !identical {
            return false;
        }
        seen.extend(frontier.iter().cloned());
        frontier = frontier
            .iter()
            .filter_map(|feature| left.get(feature))
            .flat_map(|choice| choice.evidence.record.requirements.keys())
            .filter(|feature| !seen.contains(*feature))
            .cloned()
            .collect();
    }
    false
}

impl<'a> Search<'a, '_> {
    fn denied(&self, feature: &FeatureId) -> Option<(String, String)> {
        self.request
            .profile
            .denied
            .iter()
            .find(|(pattern, _)| {
                pattern.strip_suffix('*').map_or_else(
                    || pattern.as_str() == feature.as_str(),
                    |prefix| feature.as_str().starts_with(prefix),
                )
            })
            .map(|(pattern, reason)| (pattern.clone(), reason.clone()))
    }

    fn selectors(&self, feature: &FeatureId) -> Vec<(&'a Selector, ChoiceReason, usize)> {
        if let Some(selector) = self.request.overrides.get(feature) {
            return vec![(selector, ChoiceReason::Override, 0)];
        }
        if let Some(selector) = self.request.profile.pins.get(feature) {
            return vec![(selector, ChoiceReason::Pin, 0)];
        }
        self.request
            .profile
            .preferences
            .iter()
            .enumerate()
            .map(|(rank, selector)| (selector, ChoiceReason::Preference { rank }, rank))
            .collect()
    }

    fn reject(&mut self, feature: &FeatureId, provider: &ProviderKey, reason: RejectionReason) {
        let rejected = &mut self
            .unavailable
            .entry(feature.clone())
            .or_insert_with(|| Unavailable {
                demand: Demand::default(),
                denied: None,
                rejected: vec![],
            })
            .rejected;
        let row = Rejection {
            provider: provider.clone(),
            reason,
        };
        if !rejected.contains(&row) {
            rejected.push(row);
        }
    }

    fn choices(&mut self, feature: &FeatureId, demand: &Demand) -> Vec<Choice<'a>> {
        self.unavailable
            .entry(feature.clone())
            .or_insert_with(|| Unavailable {
                demand: Demand::default(),
                denied: None,
                rejected: vec![],
            })
            .demand
            .join(demand);
        if let Some(denied) = self.denied(feature) {
            if let Some(row) = self.unavailable.get_mut(feature) {
                row.denied = Some(denied);
            }
            return vec![];
        }
        let mut choices = vec![];
        for candidate in self
            .candidates
            .clone()
            .into_iter()
            .filter(|candidate| &candidate.key.feature == feature)
        {
            if !admitted(
                candidate.claim.backends.as_ref(),
                &self.request.target.backend,
            ) || !admitted(candidate.claim.hosts.as_ref(), &self.request.target.host)
                || candidate.claim.targets.as_ref().is_some_and(|targets| {
                    !targets.iter().any(|claim| {
                        crate::config::claim_covers(
                            claim,
                            &self.request.target.id,
                            self.request.target.minimum_version.as_deref(),
                        )
                    })
                })
            {
                self.reject(feature, &candidate.key, RejectionReason::Target);
                continue;
            }
            let selectors: Vec<_> = self
                .selectors(feature)
                .into_iter()
                .filter(|(selector, _, _)| selector.selects(&candidate.key))
                .collect();
            if selectors.is_empty() {
                self.reject(feature, &candidate.key, RejectionReason::NotPreferred);
            }
            for (selector, reason, rank) in selectors {
                let mut records: Vec<_> = candidate.records.iter().collect();
                records.sort_by(|left, right| left.origin.cmp(&right.origin));
                if records.is_empty() {
                    self.reject(feature, &candidate.key, RejectionReason::MissingRecord);
                }
                let mut fresh = vec![];
                for evidence in records {
                    match self.verified(candidate, evidence, selector, &reason, rank) {
                        Ok(choice) => fresh.push(choice),
                        Err(reason) => self.reject(feature, &candidate.key, reason),
                    }
                }
                for choice in &fresh {
                    // Compare canonical input facts before filtering coverage.
                    // A requested subset cannot hide contradictory evidence.
                    if fresh.iter().any(|other| {
                        choice.identity != other.identity
                            && choice
                                .evidence
                                .record
                                .validate(&candidate.key, &other.evidence.record.inputs)
                                .is_ok()
                    }) {
                        self.reject(feature, &candidate.key, RejectionReason::ConflictingRecords);
                        continue;
                    }
                    match self.admissible(choice, demand) {
                        Ok(()) => choices.push(choice.clone()),
                        Err(reason) => self.reject(feature, &candidate.key, reason),
                    }
                }
            }
        }
        choices.sort_by(|left, right| {
            left.rank
                .cmp(&right.rank)
                .then_with(|| left.candidate.key.cmp(&right.candidate.key))
                .then_with(|| left.identity.cmp(&right.identity))
        });
        unique_choices(choices)
    }

    fn verified(
        &self,
        candidate: &'a Candidate,
        evidence: &'a Evidence,
        selector: &'a Selector,
        reason: &ChoiceReason,
        rank: usize,
    ) -> Result<Choice<'a>, RejectionReason> {
        let identity = evidence
            .record
            .identity()
            .map_err(|detail| RejectionReason::Record {
                reason: RecordRejection::MalformedInputs { detail },
            })?;
        let mut matching = self
            .request
            .current
            .iter()
            .filter(|current| current.provider == candidate.key && current.record == identity);
        let current = matching
            .next()
            .ok_or(RejectionReason::MissingCurrentInputs)?;
        if matching.any(|other| other.inputs != current.inputs) {
            return Err(RejectionReason::ConflictingCurrentInputs);
        }
        if &current.inputs.target != self.request.target {
            return Err(RejectionReason::Target);
        }
        if current.inputs.profile != self.request.profile.id {
            return Err(RejectionReason::Record {
                reason: RecordRejection::DifferentProfile,
            });
        }
        if current.inputs.options != selector.options {
            return Err(RejectionReason::Record {
                reason: RecordRejection::DifferentOptions,
            });
        }
        evidence
            .record
            .validate(&candidate.key, &current.inputs)
            .map_err(|reason| RejectionReason::Record { reason })?;
        Ok(Choice {
            identity,
            candidate,
            evidence,
            reason: reason.clone(),
            rank,
            options: &selector.options,
        })
    }

    fn admissible(&self, choice: &Choice<'_>, demand: &Demand) -> Result<(), RejectionReason> {
        let candidate = choice.candidate;
        let record = &choice.evidence.record;
        let missing: BTreeSet<_> = candidate
            .claim
            .requires
            .iter()
            .filter(|feature| !record.requirements.contains_key(*feature))
            .cloned()
            .collect();
        if !missing.is_empty() {
            return Err(RejectionReason::IncompleteClosure { missing });
        }
        if !covers(choice, demand) {
            return Err(if record.coverage.covers(demand) {
                RejectionReason::ManifestRestriction
            } else {
                RejectionReason::Coverage
            });
        }
        if let Some(module) = record.modules.iter().find(|module| !module.valid()) {
            return Err(RejectionReason::InvalidModule {
                module: module.clone(),
            });
        }
        if let Some(module) = record.modules.iter().find(|module| {
            !self.request.packages.contains(&PackageInstance {
                name: module.package.clone(),
                instance: module.instance.clone(),
                manifest: module.manifest.clone(),
            })
        }) {
            return Err(RejectionReason::UnknownModule {
                module: module.clone(),
            });
        }
        Ok(())
    }

    /// A completed plan can prune a partial branch only when even that branch's
    /// optimistic remaining ranks cannot beat it. This avoids enumerating all
    /// dominated combinations, without making feature traversal a policy.
    fn pruned(&self, chosen: &Choices<'_>) -> bool {
        #[cfg(test)]
        if self.skip_pruning {
            return false;
        }
        self.best.iter().any(|best| {
            let mut frontier: BTreeSet<_> = self.request.uses.keys().cloned().collect();
            let mut seen = BTreeSet::new();
            while !frontier.is_empty() {
                let mut strict = false;
                let mut identical = true;
                for feature in &frontier {
                    let Some(old) = best.get(feature) else {
                        return false;
                    };
                    let current = chosen.get(feature);
                    let rank = current
                        .map(|choice| choice.rank)
                        .or_else(|| self.minimum.get(feature).copied());
                    let Some(rank) = rank else {
                        return false;
                    };
                    if old.rank > rank {
                        return false;
                    }
                    strict |= old.rank < rank;
                    identical &= current.is_some_and(|new| same_parent(old, new));
                }
                if strict {
                    return true;
                }
                if !identical {
                    return false;
                }
                seen.extend(frontier.iter().cloned());
                frontier = frontier
                    .iter()
                    .filter_map(|feature| best.get(feature))
                    .flat_map(|choice| choice.evidence.record.requirements.keys())
                    .filter(|feature| !seen.contains(*feature))
                    .cloned()
                    .collect();
            }
            false
        })
    }

    fn visit(&mut self, chosen: Choices<'a>) {
        #[cfg(test)]
        {
            self.visited += 1;
        }
        if self.pruned(&chosen) {
            return;
        }
        let needed = requirements(self.request, &chosen);
        for (feature, choice) in &chosen {
            if let Some(demand) = needed.get(feature)
                && !covers(choice, demand)
            {
                self.unavailable
                    .entry(feature.clone())
                    .or_insert_with(|| Unavailable {
                        demand: Demand::default(),
                        denied: None,
                        rejected: vec![],
                    })
                    .demand
                    .join(demand);
                self.reject(
                    feature,
                    &choice.candidate.key,
                    if choice.evidence.record.coverage.covers(demand) {
                        RejectionReason::ManifestRestriction
                    } else {
                        RejectionReason::Coverage
                    },
                );
                return;
            }
        }
        let next = needed
            .iter()
            .find(|(feature, _)| !chosen.contains_key(*feature));
        if let Some((feature, demand)) = next {
            for choice in self.choices(feature, demand) {
                let mut branch = chosen.clone();
                branch.insert(feature.clone(), choice);
                self.visit(branch);
            }
            return;
        }
        if !self.decisions_hold(&chosen) {
            return;
        }
        if let Some(cycle) = cycle(&chosen) {
            if !self.cycles.contains(&cycle) {
                self.cycles.push(cycle);
            }
            return;
        }
        if self
            .best
            .iter()
            .any(|old| dominates(old, &chosen, self.request.uses))
        {
            return;
        }
        self.best
            .retain(|old| !dominates(&chosen, old, self.request.uses));
        let same = self.best.iter().any(|old| {
            old.len() == chosen.len()
                && old.iter().all(|(feature, old)| {
                    chosen.get(feature).is_some_and(|new| same_choice(old, new))
                })
        });
        if !same {
            let uncached: Vec<_> = chosen
                .keys()
                .filter(|feature| !self.minimum.contains_key(*feature))
                .cloned()
                .collect();
            for feature in uncached {
                if let Some(rank) = self
                    .choices(&feature, &Demand::default())
                    .iter()
                    .map(|choice| choice.rank)
                    .min()
                {
                    self.minimum.insert(feature, rank);
                }
            }
            self.best.push(chosen);
        }
    }

    fn decisions_hold(&mut self, chosen: &Choices<'_>) -> bool {
        for (feature, choice) in chosen {
            for decision in &choice.evidence.record.inputs.decisions {
                if let DecisionObservation::Selection { provider, options } = decision
                    && !chosen.get(&provider.feature).is_some_and(|selected| {
                        &selected.candidate.key == provider && selected.options == options
                    })
                {
                    self.reject(
                        feature,
                        &choice.candidate.key,
                        RejectionReason::DifferentSelection {
                            provider: provider.clone(),
                        },
                    );
                    return false;
                }
            }
        }
        true
    }
}

fn cycle(chosen: &Choices<'_>) -> Option<Vec<FeatureId>> {
    fn walk(
        feature: &FeatureId,
        chosen: &Choices<'_>,
        active: &mut Vec<FeatureId>,
        done: &mut BTreeSet<FeatureId>,
    ) -> Option<Vec<FeatureId>> {
        if let Some(at) = active.iter().position(|item| item == feature) {
            let mut path = active[at..].to_vec();
            path.push(feature.clone());
            return Some(path);
        }
        if done.contains(feature) {
            return None;
        }
        active.push(feature.clone());
        if let Some(choice) = chosen.get(feature) {
            for dependency in choice.evidence.record.requirements.keys() {
                if let Some(path) = walk(dependency, chosen, active, done) {
                    return Some(path);
                }
            }
        }
        active.pop();
        done.insert(feature.clone());
        None
    }
    let mut done = BTreeSet::new();
    for feature in chosen.keys() {
        if let Some(path) = walk(feature, chosen, &mut vec![], &mut done) {
            return Some(path);
        }
    }
    None
}

/// Solve the complete reached-member constraints, including recorded closures.
/// Incomparable feasible preferences require an explicit choice; source order
/// must never decide which public implementation wins.
pub fn resolve(request: &Request<'_>) -> Result<Plan, ResolutionError> {
    let invalid = |detail: &str| ResolutionError::InvalidInput {
        detail: detail.into(),
    };
    if request.profile.id.is_empty() {
        return Err(invalid("a profile must have an identity"));
    }
    if request.profile.denied.keys().any(|pattern| {
        pattern.is_empty()
            || pattern.contains('*')
                && (!pattern.ends_with(":*") || pattern[..pattern.len() - 1].contains('*'))
    }) {
        return Err(invalid(
            "a denial is an exact feature or a family:* pattern",
        ));
    }
    if !admitted(request.profile.backends.as_ref(), &request.target.backend)
        || !admitted(request.profile.hosts.as_ref(), &request.target.host)
    {
        return Err(ResolutionError::UnsupportedTarget {
            profile: request.profile.id.clone(),
            backend: request.target.backend.clone(),
            host: request.target.host.clone(),
        });
    }
    let mut candidates: Vec<_> = request.candidates.iter().collect();
    candidates.sort_by(|left, right| left.key.cmp(&right.key));
    if candidates.windows(2).any(|pair| pair[0].key == pair[1].key) {
        return Err(invalid("duplicate provider identity"));
    }
    for candidate in &candidates {
        // Public typed inputs may also be constructed in process. Use the one
        // manifest reader for ownership and shape checks on that boundary too.
        let manifest = serde_json::json!({ "nts": { "provides": {
            candidate.key.feature.as_str(): &candidate.claim
        } } });
        super::parse_manifest(&candidate.key.package, &manifest.to_string())
            .map_err(|detail| ResolutionError::InvalidInput { detail })?;
    }
    if candidates
        .iter()
        .any(|candidate| !request.packages.contains(&package(&candidate.key)))
    {
        return Err(invalid(
            "provider package instance is not in the resolved package graph",
        ));
    }
    let mut search = Search {
        request,
        candidates,
        best: vec![],
        unavailable: BTreeMap::new(),
        cycles: vec![],
        minimum: BTreeMap::new(),
        #[cfg(test)]
        visited: 0,
        #[cfg(test)]
        skip_pruning: false,
    };
    search.visit(BTreeMap::new());
    let [chosen] = search.best.as_slice() else {
        return if search.best.is_empty() {
            search.cycles.sort();
            Err(ResolutionError::NoSolution {
                features: search.unavailable,
                cycles: search.cycles,
            })
        } else {
            Err(ResolutionError::Ambiguous {
                alternatives: search
                    .best
                    .iter()
                    .map(|chosen| {
                        chosen
                            .iter()
                            .map(|(feature, choice)| (feature.clone(), selected(choice)))
                            .collect()
                    })
                    .collect(),
            })
        };
    };
    Ok(make_plan(request, chosen))
}

fn make_plan(request: &Request<'_>, chosen: &Choices<'_>) -> Plan {
    let mut plan = Plan {
        selected: BTreeMap::new(),
        requirements: requirements(request, chosen),
        modules: BTreeSet::new(),
        bindings: BTreeMap::new(),
    };
    for (feature, choice) in chosen {
        let key = &choice.candidate.key;
        let record = &choice.evidence.record;
        match &choice.candidate.claim.kind {
            ProviderKind::Source(path) => {
                plan.modules.insert(ImplementationModule {
                    package: key.package.clone(),
                    instance: key.instance.clone(),
                    manifest: key.manifest.clone(),
                    path: path.clone(),
                });
            }
            ProviderKind::Binding(binding) => {
                plan.bindings.insert(feature.clone(), binding.clone());
            }
            ProviderKind::Compiler => {}
        }
        plan.modules.extend(record.modules.iter().cloned());
        plan.selected.insert(feature.clone(), selected(choice));
    }
    plan
}

fn selected(choice: &Choice<'_>) -> Selected {
    Selected {
        provider: choice.candidate.key.clone(),
        implementation: choice.candidate.claim.kind.clone(),
        reason: choice.reason.clone(),
        options: choice.options.clone(),
        record: choice.identity.clone(),
        compiler_inputs: choice.evidence.record.inputs.compiler_inputs.clone(),
        suite: choice.evidence.record.inputs.suite.clone(),
    }
}
