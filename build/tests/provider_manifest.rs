#![allow(clippy::unwrap_used)]

use nts_build::features::{FeatureId, ProviderKind, Use, parse_manifest};

#[test]
fn the_real_compiler_catalogue_keeps_its_partial_claims() {
    let manifest = parse_manifest(
        "@nts/compiler",
        include_str!("../../compiler/core/providers/manifest.json"),
    )
    .unwrap();
    assert_eq!(manifest.provides.len(), 47);
    let date = &manifest.provides[&FeatureId::parse("es:Date").unwrap()];
    assert_eq!(date.kind, ProviderKind::Compiler);
    assert!(date.uses.as_ref().unwrap().contains(&Use::Construct));
    assert!(!date.members.as_ref().unwrap().contains("now"));
    let json = &manifest.provides[&FeatureId::parse("es:JSON").unwrap()];
    assert!(json.members.as_ref().unwrap().contains("stringify"));
    assert!(!json.members.as_ref().unwrap().contains("parse"));
    assert!(json.uses.as_ref().unwrap().is_empty());
}

#[test]
fn one_kind_is_encoded_once_and_round_trips_without_a_kind_field() {
    for (package, feature, entry) in [
        ("@nts/compiler", "es:X", r#"{"compiler":true}"#),
        ("@nts/web-platform", "web:X", r#"{"source":"./src/x.ts"}"#),
        ("host-package", "host:x", r#"{"binding":"c:nts_x"}"#),
    ] {
        let text = format!(r#"{{"nts":{{"provides":{{"{feature}":{entry}}}}}}}"#);
        let parsed = parse_manifest(package, &text).unwrap();
        let serialized = serde_json::to_value(parsed.provides.values().next().unwrap()).unwrap();
        assert_eq!(
            serialized,
            serde_json::from_str::<serde_json::Value>(entry).unwrap()
        );
        assert!(serialized.get("kind").is_none());
    }
}

#[test]
fn absent_and_empty_restrictions_are_different() {
    let manifest = parse_manifest(
        "@nts/compiler",
        r#"{"nts":{"provides":{
          "es:A":{"compiler":true},
          "es:B":{"compiler":true,"members":[],"uses":[],"backends":[]}
        }}}"#,
    )
    .unwrap();
    let a = &manifest.provides[&FeatureId::parse("es:A").unwrap()];
    let b = &manifest.provides[&FeatureId::parse("es:B").unwrap()];
    assert!(a.members.is_none() && a.uses.is_none() && a.backends.is_none());
    assert!(b.members.as_ref().unwrap().is_empty());
    assert!(b.uses.as_ref().unwrap().is_empty());
    assert!(b.backends.as_ref().unwrap().is_empty());
}

#[test]
fn duplicate_keys_are_rejected_before_value_overwrites_them() {
    for text in [
        r#"{"nts":{},"nts":{"provides":{}}}"#,
        r#"{"nts":{"provides":{"es:X":{"compiler":true},"es:X":{"compiler":true}}}}"#,
        r#"{"nts":{"provides":{"es:X":{"compiler":true,"compiler":true}}}}"#,
        r#"{"nts":{"provides":{"es:X":{"compiler":true},"es:\u0058":{"compiler":true}}}}"#,
    ] {
        let error = parse_manifest("@nts/compiler", text).unwrap_err();
        assert!(error.contains("duplicate JSON key"), "{error}");
    }
}

#[test]
fn ambiguous_false_or_unknown_kind_encodings_are_rejected() {
    for entry in [
        "{}",
        r#"{"compiler":false}"#,
        r#"{"compiler":true,"source":"./src/x.ts"}"#,
        r#"{"source":"./src/x.ts","binding":"c:x"}"#,
        r#"{"compiler":true,"kind":"compiler"}"#,
        r#"{"compiler":true,"futurePolicy":true}"#,
        r#"{"compiler":null,"source":"./x.ts"}"#,
        r#"{"compiler":true,"members":null}"#,
        r#"{"compiler":true,"backends":null}"#,
    ] {
        let text = format!(r#"{{"nts":{{"provides":{{"es:X":{entry}}}}}}}"#);
        assert!(parse_manifest("@nts/compiler", &text).is_err(), "{entry}");
    }
}

#[test]
fn source_modules_cannot_escape_their_package() {
    for source in [
        "../x.ts",
        "/x.ts",
        "./../x.ts",
        "./src/../x.ts",
        "./",
        "./src//x.ts",
        "./C:/x.ts",
        ".\\src\\x.ts",
    ] {
        let entry = serde_json::json!({"nts":{"provides":{"web:X":{"source":source}}}});
        assert!(
            parse_manifest("@nts/web-platform", &entry.to_string()).is_err(),
            "{source}"
        );
    }
}

#[test]
fn package_ownership_is_checked_without_claiming_standard_names() {
    assert!(
        parse_manifest(
            "third-party",
            r#"{"nts":{"provides":{"web:fetch":{"source":"./fetch.ts"}}}}"#
        )
        .is_err()
    );
    assert!(
        parse_manifest(
            "@nts/web-platform",
            r#"{"nts":{"provides":{"web:X":{"compiler":true}}}}"#
        )
        .is_err()
    );
    let own = parse_manifest("third-party", r#"{"name":"third-party","nts":{"provides":{"third-party/x":{"source":"./x.ts"},"host:x":{"binding":"c:x"}}}}"#).unwrap();
    assert_eq!(own.provides.len(), 2);
    assert!(parse_manifest("third-party", r#"{"name":"another-package"}"#).is_err());
}

#[test]
fn unrelated_package_metadata_is_left_to_its_reader() {
    let parsed = parse_manifest(
        "plain-package",
        r#"{"name":"plain-package","exports":"./main.ts","nts":{"native":["./host.c"]}}"#,
    )
    .unwrap();
    assert!(parsed.provides.is_empty());
    assert!(
        parse_manifest(
            "@nts/web-platform",
            r#"{"nts":{"provides":{"web:X":{"source":"./x.ts","requires":["web:X"]}}}}"#
        )
        .is_err()
    );
}
