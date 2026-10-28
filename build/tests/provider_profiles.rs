#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;
use std::process::Command;

use nts_build::features::{
    LoopAdapter, LoopOptions, Profile, Target, builtin_profiles, runtime_manifest,
};
use nts_codegen_c::LoopHost;

#[test]
fn rust_and_config_evaluate_the_same_profile_data() {
    let profiles = builtin_profiles().unwrap();
    assert_eq!(profiles.len(), 10);
    let output = Command::new("node")
        .args(["--input-type=module", "-e", "import { profiles, loopAdapters, loopProvider } from './tooling/config/src/index.ts'; import selector from './tooling/config/fixtures/provider-selector.ts'; process.stdout.write(JSON.stringify({ profiles, selector, loops: loopAdapters.map(loopProvider) }));"])
        .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let typescript: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let selector: nts_build::features::Selector =
        serde_json::from_value(typescript["selector"].clone()).unwrap();
    assert_eq!(selector.package, "@nts/source");
    assert!(selector.instance.is_some());
    assert_eq!(selector.options["mode"], "verified");
    assert_eq!(
        serde_json::to_value(&profiles).unwrap(),
        typescript["profiles"]
    );
    for (index, adapter) in [
        LoopAdapter::Libuv,
        LoopAdapter::Glib,
        LoopAdapter::CoreFoundation,
        LoopAdapter::Win32,
    ]
    .into_iter()
    .enumerate()
    {
        let encoded = serde_json::to_value(LoopOptions { adapter }).unwrap();
        assert_eq!(typescript["loops"][index]["options"], encoded);
    }
    // JSON parsing must not let a later policy key silently replace an earlier one.
    let native = serde_json::to_string(&profiles["native"]).unwrap();
    let duplicate = native.replacen(
        "\"denied\":{}",
        "\"denied\":{},\"denied\":{\"node:*\":\"hidden\"}",
        1,
    );
    assert_ne!(duplicate, native);
    assert!(
        Profile::parse(&duplicate)
            .unwrap_err()
            .contains("duplicate JSON key")
    );
}

#[test]
fn policy_pins_are_explicit_without_promoting_future_providers() {
    let profiles = builtin_profiles().unwrap();
    for (name, adapter) in [
        ("native", LoopAdapter::Libuv),
        ("gtk", LoopAdapter::Glib),
        ("macos", LoopAdapter::CoreFoundation),
        ("windows", LoopAdapter::Win32),
    ] {
        let pin =
            &profiles[name].pins[&nts_build::features::FeatureId::parse("host:loop").unwrap()];
        assert_eq!(pin.package, "@nts/runtime");
        let options: LoopOptions =
            serde_json::from_value(serde_json::to_value(&pin.options).unwrap()).unwrap();
        assert_eq!(options.adapter, adapter);
        assert_eq!(
            profiles[name].ambient_types.types,
            std::collections::BTreeSet::from(["node".into()])
        );
    }
    for name in ["chromium", "jvm", "android", "wasm-js"] {
        assert!(profiles[name].denied.contains_key("node:*"));
    }
    for name in ["wasm-js", "wasm-standalone"] {
        assert!(profiles[name].backends.as_ref().unwrap().is_empty());
    }
    assert_eq!(
        profiles["chromium"].ambient_types.overlay.as_deref(),
        Some("chromium")
    );
    assert!(profiles["wasm-standalone"].denied.contains_key("es:Intl"));
    let manifest = runtime_manifest().unwrap();
    assert_eq!(manifest.provides.len(), 1);
}

#[test]
fn the_native_adapter_inventory_is_exhaustive_over_the_actual_emitter() {
    fn adapter(host: LoopHost) -> LoopAdapter {
        match host {
            LoopHost::Libuv => LoopAdapter::Libuv,
            LoopHost::Glib => LoopAdapter::Glib,
            LoopHost::CoreFoundation => LoopAdapter::CoreFoundation,
            LoopHost::Win32 => LoopAdapter::Win32,
        }
    }
    for host in [
        LoopHost::Libuv,
        LoopHost::Glib,
        LoopHost::CoreFoundation,
        LoopHost::Win32,
    ] {
        let expected_source = match adapter(host) {
            LoopAdapter::Libuv => None,
            LoopAdapter::Glib => Some("nts_glib_host.c"),
            LoopAdapter::CoreFoundation => Some("nts_cf_host.c"),
            LoopAdapter::Win32 => Some("nts_win_host.c"),
        };
        assert_eq!(host.source(), expected_source);
        let options = LoopOptions {
            adapter: adapter(host),
        };
        let encoded = serde_json::to_value(options).unwrap();
        assert_eq!(
            serde_json::from_value::<LoopOptions>(encoded).unwrap(),
            options
        );
    }
}

#[test]
fn adapters_do_not_claim_other_platforms_or_hosts() {
    let mut target = Target {
        id: "linux-gnu".into(),
        backend: "c".into(),
        host: "native".into(),
        os: "linux".into(),
        arch: "x86_64".into(),
        minimum_version: None,
    };
    assert!(
        LoopOptions {
            adapter: LoopAdapter::Glib
        }
        .admits(&target)
    );
    assert!(
        !LoopOptions {
            adapter: LoopAdapter::CoreFoundation
        }
        .admits(&target)
    );
    target.os = "macos".into();
    assert!(
        LoopOptions {
            adapter: LoopAdapter::CoreFoundation
        }
        .admits(&target)
    );
    assert!(
        !LoopOptions {
            adapter: LoopAdapter::Win32
        }
        .admits(&target)
    );
    target.os = "windows".into();
    assert!(
        LoopOptions {
            adapter: LoopAdapter::Win32
        }
        .admits(&target)
    );
    for (backend, host) in [("jvm", "native"), ("c", "node"), ("llvm", "chromium")] {
        target.backend = backend.into();
        target.host = host.into();
        assert!(
            !LoopOptions {
                adapter: LoopAdapter::Libuv
            }
            .admits(&target)
        );
    }
    for options in [
        serde_json::json!({"adapter":"banana"}),
        serde_json::json!({"adapter":"libuv","guessFromFlags":true}),
    ] {
        assert!(serde_json::from_value::<LoopOptions>(options).is_err());
    }
}

#[test]
fn the_public_types_reject_conflicting_kinds_and_mutating_policy() {
    let output = Command::new("pnpm")
        .args([
            "exec",
            "tsc",
            "--ignoreConfig",
            "--noEmit",
            "--strict",
            "--module",
            "nodenext",
            "--target",
            "esnext",
            "--allowImportingTsExtensions",
            "--resolveJsonModule",
            "build/tests/fixtures/provider-types.ts",
            "tooling/config/fixtures/provider-selector.ts",
        ])
        .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let _: BTreeMap<String, Profile> = builtin_profiles().unwrap();
}
