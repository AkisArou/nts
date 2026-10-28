#![allow(clippy::unwrap_used)]

use super::*;
use crate::features::{
    Coverage, DecisionObservation, Disposition, HostObservation, InputPath, ObservedInputs,
    parse_manifest,
};

fn digest(value: char) -> Digest {
    Digest::parse(format!("sha256:{}", value.to_string().repeat(64))).unwrap()
}
fn feature(value: &str) -> FeatureId {
    FeatureId::parse(value).unwrap()
}
fn selector(package: &str) -> Selector {
    Selector {
        package: package.into(),
        instance: None,
        options: BTreeMap::new(),
    }
}
fn demand(members: &[&str]) -> Demand {
    Demand {
        members: members.iter().map(|name| (*name).into()).collect(),
        ..Demand::default()
    }
}

struct FixtureInputs {
    provider: ProviderKey,
    record: Option<Digest>,
    inputs: RecordInputs,
}

struct Fixture {
    target: Target,
    profile: Profile,
    overrides: BTreeMap<FeatureId, Selector>,
    uses: Requirements,
    candidates: Vec<Candidate>,
    current: Vec<FixtureInputs>,
    packages: BTreeSet<PackageInstance>,
}

impl Fixture {
    fn new() -> Self {
        Self {
            target: Target {
                id: "linux-gnu".into(),
                backend: "c".into(),
                host: "native".into(),
                os: "linux".into(),
                arch: "x86_64".into(),
                minimum_version: None,
            },
            profile: Profile {
                id: "native".into(),
                preferences: vec![selector("@nts/compiler"), selector("@nts/source")],
                pins: BTreeMap::new(),
                denied: BTreeMap::new(),
                ambient_types: AmbientTypes {
                    lib: BTreeSet::from(["ESNext".into()]),
                    types: BTreeSet::new(),
                    overlay: None,
                },
                backends: None,
                hosts: None,
            },
            overrides: BTreeMap::new(),
            uses: BTreeMap::new(),
            candidates: vec![],
            current: vec![],
            packages: BTreeSet::new(),
        }
    }

    fn request<'a>(&'a self, current: &'a [CurrentInputs]) -> Request<'a> {
        Request {
            target: &self.target,
            profile: &self.profile,
            overrides: &self.overrides,
            uses: &self.uses,
            candidates: &self.candidates,
            current,
            packages: &self.packages,
        }
    }

    fn current_inputs(&self) -> Vec<CurrentInputs> {
        let mut current = vec![];
        for candidate in &self.candidates {
            for evidence in &candidate.records {
                let identity = evidence.record.identity().unwrap();
                for row in &self.current {
                    if row.provider == candidate.key
                        && row.record.as_ref().is_none_or(|id| id == &identity)
                    {
                        current.push(CurrentInputs {
                            provider: row.provider.clone(),
                            record: identity.clone(),
                            inputs: row.inputs.clone(),
                        });
                    }
                }
            }
        }
        current
    }

    fn resolve(&self) -> Result<Plan, ResolutionError> {
        let current = self.current_inputs();
        resolve(&self.request(&current))
    }

    fn add(&mut self, name: &str, package_name: &str, members: &[&str]) -> usize {
        let kind = if package_name == "@nts/compiler" {
            serde_json::json!({ "compiler": true })
        } else {
            serde_json::json!({ "source": "./index.ts" })
        };
        let claim = parse_manifest(
            package_name,
            &serde_json::json!({ "nts": { "provides": { name: kind } } }).to_string(),
        )
        .unwrap()
        .provides
        .remove(&feature(name))
        .unwrap();
        let key = ProviderKey {
            package: package_name.into(),
            instance: digest('a'),
            manifest: digest('b'),
            feature: feature(name),
        };
        let inputs = RecordInputs {
            target: self.target.clone(),
            profile: self.profile.id.clone(),
            decisions: vec![],
            observations: ObservedInputs::new(vec![]).unwrap(),
            options: BTreeMap::new(),
            compiler_inputs: digest('c'),
            suite: digest('d'),
            expected_cases: 2,
        };
        self.packages.insert(package(&key));
        self.current.push(FixtureInputs {
            record: None,
            provider: key.clone(),
            inputs: inputs.clone(),
        });
        let index = self.candidates.len();
        self.candidates.push(Candidate {
            key: key.clone(),
            claim,
            records: vec![Evidence {
                origin: format!("run/{package_name}/{name}"),
                record: Record {
                    version: 1,
                    provider: key,
                    inputs,
                    coverage: Coverage {
                        uses: BTreeSet::from([Use::Call, Use::Construct, Use::Value]),
                        members: members.iter().map(|member| (*member).into()).collect(),
                        extracted_members: BTreeSet::new(),
                        complete_surface: false,
                    },
                    requirements: BTreeMap::new(),
                    modules: BTreeSet::new(),
                    completed_cases: 2,
                    done: true,
                    failures: 0,
                    disposition: Disposition::Exited { code: 0 },
                },
            }],
        });
        index
    }

    fn record(&mut self, index: usize) -> &mut Record {
        &mut self.candidates[index].records[0].record
    }

    fn rejected(&self, name: &str) -> Vec<RejectionReason> {
        let ResolutionError::NoSolution { features, .. } = self.resolve().unwrap_err() else {
            panic!("expected unavailable provider")
        };
        features[&feature(name)]
            .rejected
            .iter()
            .map(|row| row.reason.clone())
            .collect()
    }
}

#[test]
fn a_whole_member_union_selects_one_complete_owner() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), demand(&["alpha", "beta"]));
    f.add("web:A", "@nts/compiler", &["alpha"]);
    f.add("web:A", "@nts/source", &["alpha", "beta"]);
    let plan = f.resolve().unwrap();
    assert_eq!(
        plan.selected[&feature("web:A")].provider.package,
        "@nts/source"
    );
    assert_eq!(plan.modules.len(), 1);
}

#[test]
fn an_in_process_candidate_cannot_bypass_manifest_ownership_or_path_validation() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    let a = f.add("web:A", "@nts/source", &[]);
    f.candidates[a].claim.kind = ProviderKind::Compiler;
    assert!(matches!(
        f.resolve(),
        Err(ResolutionError::InvalidInput { .. })
    ));
    f.candidates[a].claim.kind = ProviderKind::Source("./../outside.ts".into());
    assert!(matches!(
        f.resolve(),
        Err(ResolutionError::InvalidInput { .. })
    ));
}

#[test]
fn a_later_dependency_broadens_an_already_selected_feature() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), demand(&["alpha"]));
    f.uses.insert(feature("web:Z"), Demand::default());
    f.add("web:A", "@nts/compiler", &["alpha"]);
    f.add("web:A", "@nts/source", &["alpha", "beta"]);
    let z = f.add("web:Z", "@nts/compiler", &[]);
    f.record(z)
        .requirements
        .insert(feature("web:A"), demand(&["beta"]));
    let plan = f.resolve().unwrap();
    assert_eq!(
        plan.selected[&feature("web:A")].provider.package,
        "@nts/source"
    );
    assert_eq!(plan.requirements[&feature("web:A")].members.len(), 2);
}

#[test]
fn a_dependency_does_not_overrule_its_parents_first_eligible_preference() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    let compiler = f.add("web:A", "@nts/compiler", &[]);
    let source = f.add("web:A", "@nts/source", &[]);
    f.add("web:B", "@nts/compiler", &["alpha"]);
    f.add("web:B", "@nts/source", &["alpha", "beta"]);
    f.record(compiler)
        .requirements
        .insert(feature("web:B"), demand(&["beta"]));
    f.record(source)
        .requirements
        .insert(feature("web:B"), demand(&["alpha"]));
    let plan = f.resolve().unwrap();
    assert_eq!(
        plan.selected[&feature("web:A")].provider.package,
        "@nts/compiler"
    );
    assert_eq!(
        plan.selected[&feature("web:B")].provider.package,
        "@nts/source"
    );
    // If the user also reaches B directly, two incomparable root preferences
    // require a pin; their source order cannot select a winner.
    f.uses.insert(feature("web:B"), demand(&["alpha"]));
    assert!(matches!(
        f.resolve(),
        Err(ResolutionError::Ambiguous { .. })
    ));
}

#[test]
fn explicit_override_precedes_pin_and_an_invalid_choice_never_falls_back() {
    let mut f = Fixture::new();
    let name = feature("web:A");
    f.uses.insert(name.clone(), Demand::default());
    let compiler = f.add("web:A", "@nts/compiler", &[]);
    f.add("web:A", "@nts/source", &[]);
    f.profile.pins.insert(name.clone(), selector("@nts/source"));
    assert_eq!(
        f.resolve().unwrap().selected[&name].reason,
        ChoiceReason::Pin
    );
    f.overrides.insert(name.clone(), selector("@nts/compiler"));
    assert_eq!(
        f.resolve().unwrap().selected[&name].reason,
        ChoiceReason::Override
    );
    f.record(compiler).done = false;
    assert!(f.rejected("web:A").iter().any(|reason| matches!(
        reason,
        RejectionReason::Record {
            reason: RecordRejection::Incomplete
        }
    )));
    f.overrides.remove(&name);
    f.profile.pins.insert(name, selector("@nts/absent"));
    assert!(matches!(
        f.resolve(),
        Err(ResolutionError::NoSolution { .. })
    ));
}

#[test]
fn equal_manifest_copies_are_ambiguous_until_the_instance_is_pinned() {
    let mut f = Fixture::new();
    let name = feature("web:A");
    f.uses.insert(name.clone(), Demand::default());
    f.add("web:A", "@nts/source", &[]);
    let mut second = f.candidates[0].clone();
    second.key.instance = digest('e');
    second.records[0].record.provider = second.key.clone();
    f.packages.insert(package(&second.key));
    f.current.push(FixtureInputs {
        record: None,
        provider: second.key.clone(),
        inputs: second.records[0].record.inputs.clone(),
    });
    f.candidates.push(second);
    assert!(
        matches!(f.resolve(), Err(ResolutionError::Ambiguous { alternatives }) if alternatives.len() == 2)
    );
    let mut pin = selector("@nts/source");
    pin.instance = Some(digest('e'));
    f.profile.pins.insert(name.clone(), pin);
    assert_eq!(
        f.resolve().unwrap().selected[&name].provider.instance,
        digest('e')
    );
}

#[test]
fn extraction_and_unproved_escape_require_their_own_coverage() {
    let mut f = Fixture::new();
    let name = feature("web:A");
    f.uses.insert(
        name.clone(),
        Demand {
            extracted_members: BTreeSet::from(["alpha".into()]),
            open_surface: true,
            ..Demand::default()
        },
    );
    let a = f.add("web:A", "@nts/compiler", &["alpha"]);
    assert!(f.rejected("web:A").contains(&RejectionReason::Coverage));
    let proof = &mut f.record(a).coverage;
    proof.extracted_members.insert("alpha".into());
    proof.complete_surface = true;
    assert!(f.resolve().is_ok());
    f.candidates[a].claim.members = Some(BTreeSet::from(["beta".into()]));
    assert!(
        f.rejected("web:A")
            .contains(&RejectionReason::ManifestRestriction)
    );
}

#[test]
fn stale_guard_inputs_and_profile_denials_do_not_admit_a_provider() {
    let mut f = Fixture::new();
    let name = feature("node:fs");
    f.uses.insert(name.clone(), Demand::default());
    f.add("node:fs", "@nts/source", &[]);
    f.current[0]
        .inputs
        .decisions
        .push(DecisionObservation::Availability {
            feature: feature("web:fetch"),
            available: false,
        });
    assert!(f.rejected("node:fs").contains(&RejectionReason::Record {
        reason: RecordRejection::DifferentDecisions
    }));
    f.overrides.insert(name.clone(), selector("@nts/source"));
    f.profile
        .denied
        .insert("node:*".into(), "no node host".into());
    let Err(ResolutionError::NoSolution { features, .. }) = f.resolve() else {
        panic!("expected denial")
    };
    assert_eq!(
        features[&name].denied,
        Some(("node:*".into(), "no node host".into()))
    );
}

#[test]
fn a_record_measured_with_another_dependency_selection_cannot_supply_the_plan() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    let a = f.add("web:A", "@nts/compiler", &[]);
    f.add("web:B", "@nts/compiler", &[]);
    let source = f.add("web:B", "@nts/source", &[]);
    f.record(a)
        .requirements
        .insert(feature("web:B"), Demand::default());
    let observation = DecisionObservation::Selection {
        provider: f.candidates[source].key.clone(),
        options: BTreeMap::new(),
    };
    f.record(a).inputs.decisions.push(observation.clone());
    f.current[a].inputs.decisions.push(observation);
    let plan = f.resolve().unwrap();
    assert_eq!(
        plan.selected[&feature("web:B")].provider.package,
        "@nts/source"
    );
    // The same package with different options is a different observed decision.
    if let DecisionObservation::Selection { options, .. } = &mut f.record(a).inputs.decisions[0] {
        options.insert("mode".into(), Value::String("different".into()));
    }
    f.current[a].inputs.decisions = f.record(a).inputs.decisions.clone();
    assert!(
        f.rejected("web:A")
            .iter()
            .any(|reason| matches!(reason, RejectionReason::DifferentSelection { .. }))
    );
}

#[test]
fn cycles_name_the_entire_dependency_path() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    let a = f.add("web:A", "@nts/compiler", &[]);
    let b = f.add("web:B", "@nts/compiler", &[]);
    f.record(a)
        .requirements
        .insert(feature("web:B"), Demand::default());
    f.record(b)
        .requirements
        .insert(feature("web:A"), Demand::default());
    assert!(
        matches!(f.resolve(), Err(ResolutionError::NoSolution { cycles, .. }) if cycles == vec![vec![feature("web:A"), feature("web:B"), feature("web:A")]])
    );
}

#[test]
fn every_declared_requirement_needs_a_recorded_closure_and_an_available_owner() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    let a = f.add("web:A", "@nts/compiler", &[]);
    f.candidates[a]
        .claim
        .requires
        .insert(feature("host:dependency"));
    assert!(
        f.rejected("web:A")
            .contains(&RejectionReason::IncompleteClosure {
                missing: BTreeSet::from([feature("host:dependency")]),
            })
    );
    f.record(a)
        .requirements
        .insert(feature("host:dependency"), Demand::default());
    let Err(ResolutionError::NoSolution { features, .. }) = f.resolve() else {
        panic!("missing dependency must not disappear")
    };
    assert!(features.contains_key(&feature("host:dependency")));
    f.add("host:dependency", "@nts/source", &[]);
    let plan = f.resolve().unwrap();
    assert_eq!(plan.selected.len(), 2);
    assert_eq!(plan.modules.len(), 1);
}

#[test]
fn target_denials_do_not_fall_through_to_unrecorded_work() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    let a = f.add("web:A", "@nts/compiler", &[]);
    f.candidates[a].claim.backends = Some(BTreeSet::new());
    assert!(f.rejected("web:A").contains(&RejectionReason::Target));
    f.profile.backends = Some(BTreeSet::new());
    assert!(matches!(
        f.resolve(),
        Err(ResolutionError::UnsupportedTarget { .. })
    ));
    f.profile.backends = None;
    f.uses.clear();
    let plan = f.resolve().unwrap();
    assert!(plan.selected.is_empty() && plan.modules.is_empty() && plan.bindings.is_empty());
}

#[test]
fn conflicting_fresh_records_cannot_be_disambiguated_by_the_requested_subset() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), demand(&["alpha"]));
    let a = f.add("web:A", "@nts/compiler", &["alpha"]);
    let mut second = f.candidates[a].records[0].clone();
    second.origin = "other-run".into();
    second.record.coverage.members = BTreeSet::from(["beta".into()]);
    f.candidates[a].records.push(second);
    assert!(
        f.rejected("web:A")
            .contains(&RejectionReason::ConflictingRecords)
    );
    f.uses.insert(feature("web:A"), Demand::default());
    assert!(
        f.rejected("web:A")
            .contains(&RejectionReason::ConflictingRecords)
    );
}

#[test]
fn ordinary_implementation_modules_must_be_in_the_resolved_package_graph() {
    let mut f = Fixture::new();
    f.uses.insert(feature("es:JSON"), Demand::default());
    let a = f.add("es:JSON", "@nts/compiler", &[]);
    let mut module = ImplementationModule {
        package: "@nts/ecmascript".into(),
        instance: digest('e'),
        manifest: digest('f'),
        path: "./src/json/plain.ts".into(),
    };
    f.record(a).modules.insert(module.clone());
    assert!(
        f.rejected("es:JSON")
            .contains(&RejectionReason::UnknownModule {
                module: module.clone()
            })
    );
    f.packages.insert(PackageInstance {
        name: module.package.clone(),
        instance: module.instance.clone(),
        manifest: module.manifest.clone(),
    });
    assert_eq!(
        f.resolve().unwrap().modules,
        BTreeSet::from([module.clone()])
    );
    f.record(a).modules.clear();
    module.path = "./../node/index.ts".into();
    f.record(a).modules.insert(module.clone());
    assert!(
        f.rejected("es:JSON")
            .contains(&RejectionReason::InvalidModule { module })
    );
}

#[test]
fn catalogue_order_and_equivalent_evidence_order_do_not_change_the_plan() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), demand(&["alpha"]));
    let a = f.add("web:A", "@nts/compiler", &["alpha"]);
    f.add("web:A", "@nts/source", &["alpha"]);
    // Missing proof on an unreached feature cannot make a reached one unavailable.
    f.add("web:Unused", "@nts/compiler", &[]);
    f.current.pop();
    let mut duplicate = f.candidates[a].records[0].clone();
    duplicate.origin = "another-run".into();
    f.candidates[a].records.push(duplicate);
    let expected = serde_json::to_vec(&f.resolve().unwrap()).unwrap();
    f.candidates.reverse();
    f.current.reverse();
    for candidate in &mut f.candidates {
        candidate.records.reverse();
    }
    assert_eq!(serde_json::to_vec(&f.resolve().unwrap()).unwrap(), expected);
    for candidate in &mut f.candidates {
        for evidence in &mut candidate.records {
            evidence.origin = format!("another-author/{}", evidence.origin);
        }
    }
    assert_eq!(serde_json::to_vec(&f.resolve().unwrap()).unwrap(), expected);
}

#[test]
fn pruning_preserves_the_exhaustive_answer_without_enumerating_dominated_plans() {
    let mut f = Fixture::new();
    for i in 0..10 {
        let name = format!("web:Feature{i}");
        f.uses.insert(feature(&name), Demand::default());
        let compiler = f.add(&name, "@nts/compiler", &[]);
        let mut repeated = f.candidates[compiler].records[0].clone();
        repeated.origin = format!("repeated/{name}");
        f.candidates[compiler].records.push(repeated);
        f.add(&name, "@nts/source", &[]);
    }
    let current = f.current_inputs();
    let request = f.request(&current);
    let run = |skip_pruning| {
        let mut search = Search {
            request: &request,
            candidates: f.candidates.iter().collect(),
            best: vec![],
            unavailable: BTreeMap::new(),
            cycles: vec![],
            minimum: BTreeMap::new(),
            visited: 0,
            skip_pruning,
        };
        search.visit(BTreeMap::new());
        let keys: Vec<BTreeMap<_, _>> = search
            .best
            .iter()
            .map(|plan| {
                plan.iter()
                    .map(|(name, choice)| (name.clone(), choice.candidate.key.clone()))
                    .collect()
            })
            .collect();
        (keys, search.visited)
    };
    let (pruned, visits) = run(false);
    let (exhaustive, exhaustive_visits) = run(true);
    assert_eq!(pruned, exhaustive);
    assert_eq!(pruned.len(), 1);
    assert!(visits <= 41, "{visits} visits");
    assert!(exhaustive_visits > 1_000);
}

#[test]
fn fresh_validation_is_scoped_to_each_records_supplier_closure() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    f.uses.insert(feature("web:B"), demand(&["beta"]));
    let a = f.add("web:A", "@nts/compiler", &[]);
    let b_compiler = f.add("web:B", "@nts/compiler", &["alpha"]);
    let b_source = f.add("web:B", "@nts/source", &["alpha", "beta"]);
    let compiler_key = f.candidates[b_compiler].key.clone();
    let source_key = f.candidates[b_source].key.clone();
    f.record(a)
        .requirements
        .insert(feature("web:B"), demand(&["alpha"]));
    let mut compiler_context = f.candidates[a].records[0].clone();
    compiler_context.origin = "compiler-supplier-run".into();
    compiler_context
        .record
        .inputs
        .decisions
        .push(DecisionObservation::Selection {
            provider: compiler_key,
            options: BTreeMap::new(),
        });
    let helper = ImplementationModule {
        package: source_key.package.clone(),
        instance: source_key.instance.clone(),
        manifest: source_key.manifest.clone(),
        path: "./helper.ts".into(),
    };
    let observation = HostObservation::File {
        path: InputPath {
            root: "package:@nts/source".into(),
            path: "helper.ts".into(),
        },
        content: Some(digest('f')),
    };
    f.record(b_source).modules.insert(helper.clone());
    f.record(b_source).inputs.observations =
        ObservedInputs::new(vec![observation.clone()]).unwrap();
    f.current[b_source].inputs = f.record(b_source).inputs.clone();
    f.record(a).modules.insert(helper);
    f.record(a).inputs.observations = ObservedInputs::new(vec![observation]).unwrap();
    f.record(a)
        .inputs
        .decisions
        .push(DecisionObservation::Selection {
            provider: source_key.clone(),
            options: BTreeMap::new(),
        });
    let source_id = f.record(a).identity().unwrap();
    let compiler_id = compiler_context.record.identity().unwrap();
    assert_ne!(source_id, compiler_id);
    f.current[a].record = Some(source_id.clone());
    f.current[a].inputs = f.record(a).inputs.clone();
    f.current.push(FixtureInputs {
        provider: f.candidates[a].key.clone(),
        record: Some(compiler_id.clone()),
        inputs: compiler_context.record.inputs.clone(),
    });
    f.candidates[a].records.push(compiler_context);
    // Both complete records are freshly validated. The global B member union
    // forces the source supplier; only that proof's supplier decision fits.
    assert!(
        f.candidates[a]
            .records
            .iter()
            .all(|evidence| evidence.record.complete())
    );
    let plan = f.resolve().unwrap();
    assert_eq!(plan.selected[&feature("web:A")].record, source_id);
    assert_eq!(plan.selected[&feature("web:B")].provider, source_key);
    // With only alpha reached, the identical A owner/requirements allow the
    // first eligible B preference to choose the other complete proof.
    f.uses.remove(&feature("web:B"));
    let plan = f.resolve().unwrap();
    assert_eq!(plan.selected[&feature("web:A")].record, compiler_id);
    assert_eq!(
        plan.selected[&feature("web:B")].provider.package,
        "@nts/compiler"
    );
}

#[test]
fn another_proofs_freshness_cannot_admit_a_missing_record_scope() {
    let mut f = Fixture::new();
    f.uses.insert(feature("web:A"), Demand::default());
    f.add("web:A", "@nts/compiler", &[]);
    f.current[0].record = Some(digest('f'));
    assert!(
        f.rejected("web:A")
            .contains(&RejectionReason::MissingCurrentInputs)
    );
}
