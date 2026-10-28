#![allow(clippy::unwrap_used)]

use std::collections::{BTreeMap, BTreeSet};

use nts_build::features::{
    Coverage, DecisionObservation, Demand, Digest, Disposition, EntryKind, FeatureId,
    HostObservation, InputPath, ObservedInputs, ProviderKey, Record, RecordInputs, RecordRejection,
    Target, Use,
};

fn digest(character: char) -> Digest {
    Digest::parse(format!("sha256:{}", character.to_string().repeat(64))).unwrap()
}
fn feature(name: &str) -> FeatureId {
    FeatureId::parse(name).unwrap()
}
fn key() -> ProviderKey {
    ProviderKey {
        package: "@nts/test-provider".into(),
        instance: digest('f'),
        manifest: digest('a'),
        feature: feature("web:Subject"),
    }
}
fn path(name: &str) -> InputPath {
    InputPath {
        root: "package:@nts/test-provider".into(),
        path: name.into(),
    }
}
fn inputs(observations: Vec<HostObservation>) -> RecordInputs {
    RecordInputs {
        target: Target {
            id: "linux-gnu".into(),
            backend: "c".into(),
            host: "native".into(),
            os: "linux".into(),
            arch: "x86_64".into(),
            minimum_version: None,
        },
        profile: "native".into(),
        decisions: vec![DecisionObservation::Availability {
            feature: feature("web:fetch"),
            available: false,
        }],
        observations: ObservedInputs::new(observations).unwrap(),
        options: BTreeMap::new(),
        compiler_inputs: digest('b'),
        suite: digest('c'),
        expected_cases: 2,
    }
}
fn record(inputs: RecordInputs) -> Record {
    Record {
        version: 1,
        provider: key(),
        inputs,
        coverage: Coverage::default(),
        requirements: BTreeMap::new(),
        modules: BTreeSet::new(),
        completed_cases: 2,
        done: true,
        failures: 0,
        disposition: Disposition::Exited { code: 0 },
    }
}

#[test]
fn guard_termination_is_not_completion_even_after_done() {
    let fresh = inputs(vec![]);
    let good = record(fresh.clone());
    assert_eq!(good.validate(&key(), &fresh), Ok(()));
    for disposition in [
        Disposition::CpuLimit,
        Disposition::WallGuard,
        Disposition::Signalled { signal: 9 },
        Disposition::Exited { code: 124 },
        Disposition::Incomplete,
    ] {
        let mut bad = good.clone();
        bad.disposition = disposition;
        assert_eq!(
            bad.validate(&key(), &fresh),
            Err(RecordRejection::Incomplete)
        );
    }
    for change in 0..5 {
        let mut bad = good.clone();
        match change {
            0 => bad.done = false,
            1 => bad.completed_cases = 1,
            2 => bad.inputs.expected_cases = 0,
            3 => bad.failures = 1,
            _ => bad.version = 2,
        }
        assert_eq!(
            bad.validate(&key(), &fresh),
            Err(RecordRejection::Incomplete)
        );
    }
}

#[test]
fn a_record_cannot_lower_the_population_that_today_requires() {
    let fresh = inputs(vec![]);
    let mut shortened = record(fresh.clone());
    shortened.inputs.expected_cases = 1;
    shortened.completed_cases = 1;
    assert!(shortened.complete());
    assert_eq!(
        shortened.validate(&key(), &fresh),
        Err(RecordRejection::DifferentSuite)
    );
}

#[test]
fn equal_manifests_do_not_collapse_different_package_instances() {
    let fresh = inputs(vec![]);
    let old = record(fresh.clone());
    let mut other = key();
    other.instance = digest('d');
    assert_eq!(other.manifest, old.provider.manifest);
    assert_eq!(
        old.validate(&other, &fresh),
        Err(RecordRejection::DifferentProvider)
    );
}

#[test]
fn an_omitted_observation_result_is_not_an_explicit_failed_lookup() {
    let old = record(inputs(vec![HostObservation::File {
        path: path("helper.ts"),
        content: None,
    }]));
    let mut json = serde_json::to_value(&old).unwrap();
    json["inputs"]["observations"][0]
        .as_object_mut()
        .unwrap()
        .remove("content");
    assert!(Record::parse(&json.to_string()).is_err());
}

#[test]
fn a_missing_helper_or_changed_directory_invalidates_the_record() {
    let absent = HostObservation::File {
        path: path("src/helper.ts"),
        content: None,
    };
    let directory = HostObservation::Directory {
        path: path("src"),
        entries: Some(BTreeMap::new()),
    };
    let old = record(inputs(vec![absent.clone(), directory.clone()]));
    let appeared = HostObservation::File {
        path: path("src/helper.ts"),
        content: Some(digest('d')),
    };
    assert_eq!(
        old.validate(&key(), &inputs(vec![appeared, directory.clone()])),
        Err(RecordRejection::DifferentObservations)
    );
    let changed = HostObservation::Directory {
        path: path("src"),
        entries: Some(BTreeMap::from([("helper.ts".into(), EntryKind::File)])),
    };
    assert_eq!(
        old.validate(&key(), &inputs(vec![absent, changed])),
        Err(RecordRejection::DifferentObservations)
    );
    assert_eq!(
        old.validate(&key(), &inputs(vec![directory])),
        Err(RecordRejection::DifferentObservations)
    );
}

#[test]
fn guard_profile_and_supplier_decisions_belong_to_the_input_identity() {
    let fresh = inputs(vec![]);
    let old = record(fresh.clone());
    let mut changed = fresh.clone();
    changed.decisions[0] = DecisionObservation::Availability {
        feature: feature("web:fetch"),
        available: true,
    };
    assert_eq!(
        old.validate(&key(), &changed),
        Err(RecordRejection::DifferentDecisions)
    );
    changed = fresh.clone();
    changed.profile = "chromium".into();
    assert_eq!(
        old.validate(&key(), &changed),
        Err(RecordRejection::DifferentProfile)
    );
    changed = fresh.clone();
    changed.decisions.push(DecisionObservation::Selection {
        provider: key(),
        options: BTreeMap::new(),
    });
    assert_eq!(
        old.validate(&key(), &changed),
        Err(RecordRejection::DifferentDecisions)
    );
    changed = fresh.clone();
    changed.compiler_inputs = digest('e');
    assert_eq!(
        old.validate(&key(), &changed),
        Err(RecordRejection::DifferentCompiler)
    );
}

#[test]
fn duplicate_observations_cannot_hide_two_values_for_one_input() {
    let absent = HostObservation::File {
        path: path("src/helper.ts"),
        content: None,
    };
    let present = HostObservation::File {
        path: path("src/helper.ts"),
        content: Some(digest('d')),
    };
    assert!(ObservedInputs::new(vec![absent, present]).is_err());
    let mut duplicated = inputs(vec![]);
    duplicated.decisions.push(duplicated.decisions[0].clone());
    assert!(matches!(
        record(duplicated.clone()).validate(&key(), &duplicated),
        Err(RecordRejection::MalformedInputs { .. })
    ));
}

#[test]
fn an_external_record_cannot_overwrite_one_part_of_its_required_closure() {
    let text = serde_json::to_string(&record(inputs(vec![]))).unwrap();
    let bad = text.replace(
        "\"requirements\":{}",
        r#""requirements":{"web:Dependency":{"members":["alpha"]},"web:Dependency":{"members":["beta"]}}"#,
    );
    assert_ne!(bad, text);
    assert!(
        Record::parse(&bad)
            .unwrap_err()
            .contains("duplicate JSON key")
    );
    let parsed = Record::parse(&text).unwrap();
    assert_eq!(parsed.validate(&key(), &inputs(vec![])), Ok(()));
}

#[test]
fn independent_observation_order_has_one_canonical_encoding() {
    let a = HostObservation::File {
        path: path("src/a.ts"),
        content: Some(digest('d')),
    };
    let b = HostObservation::File {
        path: path("src/b.ts"),
        content: None,
    };
    assert_eq!(
        serde_json::to_vec(&ObservedInputs::new(vec![a.clone(), b.clone()]).unwrap()).unwrap(),
        serde_json::to_vec(&ObservedInputs::new(vec![b, a]).unwrap()).unwrap()
    );
}

#[test]
fn proof_identity_is_canonical_and_covers_the_recorded_decisions() {
    assert_eq!(
        Digest::of_bytes(b"abc").as_str(),
        "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let mut first = record(inputs(vec![]));
    first
        .inputs
        .decisions
        .push(DecisionObservation::Availability {
            feature: feature("es:Date"),
            available: true,
        });
    let mut second = first.clone();
    second.inputs.decisions.reverse();
    assert_eq!(first.identity().unwrap(), second.identity().unwrap());
    second.inputs.decisions[0] = DecisionObservation::Availability {
        feature: feature("es:Date"),
        available: false,
    };
    assert_ne!(first.identity().unwrap(), second.identity().unwrap());
}

#[test]
fn aliases_join_members_and_escapes_monotonically_in_any_order() {
    let a = Demand {
        uses: BTreeSet::from([Use::Construct]),
        members: BTreeSet::from(["alpha".into()]),
        sites: BTreeSet::from(["a.ts:1".into()]),
        ..Demand::default()
    };
    let b = Demand {
        members: BTreeSet::from(["beta".into()]),
        extracted_members: BTreeSet::from(["alpha".into()]),
        sites: BTreeSet::from(["b.ts:2".into()]),
        ..Demand::default()
    };
    let c = Demand {
        open_surface: true,
        ..Demand::default()
    };
    let rows = [&a, &b, &c];
    let mut expected = Demand::default();
    for row in rows {
        expected.join(row);
    }
    for order in [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ] {
        let mut actual = Demand::default();
        for i in order {
            actual.join(rows[i]);
        }
        assert_eq!(actual, expected);
    }
    let partial = Coverage {
        uses: expected.uses.clone(),
        members: expected.members.clone(),
        ..Coverage::default()
    };
    assert!(!partial.covers(&expected));
    let mut extracted = partial.clone();
    extracted.extracted_members = expected.extracted_members.clone();
    assert!(!extracted.covers(&expected));
    extracted.complete_surface = true;
    extracted.uses.insert(Use::Value);
    assert!(extracted.covers(&expected));
}
