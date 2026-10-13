//! Known helper decisions are literal and checked against independent inventories.
#[path = "support_catalog.rs"]
mod catalog;

/// A name's implementation route; each admitted call still checks its HIR types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Support {
    /// Instructions or host builtins with no ordinary JS import.
    Intrinsic,
    /// A planned module-local function with a checked physical signature.
    WasmHelper,
    /// An explicitly declared typed import resolved once by the host.
    HostImport,
    /// A known unsupported semantic, representation or boundary contract.
    Decline(&'static str),
}

/// Unknown names remain unknown; no default decision fills a missing row.
#[must_use]
pub fn helper_support(name: &str) -> Option<Support> {
    catalog::ROWS
        .binary_search_by_key(&name, |&(known, _)| known)
        .ok()
        .map(|at| catalog::ROWS[at].1)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::{Support, catalog, helper_support};
    use crate::{
        array_copy, array_join, array_lookup, array_methods, array_sort, collections, erased_ops,
        host, promises, raising, strings, timers, values,
    };
    use std::collections::BTreeSet;

    fn binding(name: &str) -> Option<Support> {
        if host::external(name).is_some() {
            Some(Support::HostImport)
        } else if array_methods::external(name).is_some() {
            Some(Support::Intrinsic)
        } else if let Some(helper) = strings::external(name) {
            Some(if helper.builtin() {
                Support::Intrinsic
            } else {
                Support::WasmHelper
            })
        } else if timers::external(name).is_some() {
            Some(Support::WasmHelper)
        } else if let Some(op) = promises::external(name) {
            Some(if op.inline() {
                Support::Intrinsic
            } else {
                Support::WasmHelper
            })
        } else if let Some(op) = collections::external(name) {
            Some(if op.inline() {
                Support::Intrinsic
            } else {
                Support::WasmHelper
            })
        } else if let Some(helper) = values::external(name) {
            Some(if helper.inline() {
                Support::Intrinsic
            } else {
                Support::WasmHelper
            })
        } else if raising::external(name).is_some()
            || erased_ops::external(name).is_some()
            || array_copy::external(name).is_some()
            || array_lookup::external(name).is_some()
            || array_join::external(name).is_some()
            || array_sort::external(name)
        {
            Some(Support::WasmHelper)
        } else {
            None
        }
    }
    fn root() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }
    #[test]
    fn every_declared_and_conditional_header_name_has_a_literal_decision() {
        for name in nts_core::hir::runtime::declared_names() {
            assert!(
                helper_support(name).is_some(),
                "unclassified declared helper {name}"
            );
        }
        let inventory: serde_json::Value =
            serde_json::from_str(include_str!("../../../../tooling/wasm/header-helpers.json"))
                .unwrap();
        for family in ["native", "windows_only"] {
            for name in inventory[family].as_array().unwrap() {
                let name = name.as_str().unwrap();
                assert!(
                    helper_support(name).is_some(),
                    "unclassified {family} header helper {name}"
                );
            }
        }
        let status = std::process::Command::new("python3")
            .arg(root().join("tooling/wasm/helper-inventory.py"))
            .arg("--check")
            .status()
            .expect("Python and clang required for the header inventory oracle");
        assert!(status.success(), "header helper inventory drifted");
    }
    #[test]
    fn catalog_routes_equal_real_bindings_and_names_are_sorted_unique() {
        assert!(catalog::ROWS.windows(2).all(|pair| pair[0].0 < pair[1].0));
        for &(name, support) in catalog::ROWS {
            let expected = match support {
                Support::Decline(reason) => {
                    assert!(!reason.is_empty());
                    None
                }
                Support::Intrinsic | Support::WasmHelper | Support::HostImport => Some(support),
            };
            assert_eq!(binding(name), expected, "catalog route for {name}");
        }
        assert_eq!(helper_support("nts_new_unreviewed_helper"), None);
        assert_eq!(helper_support("user_external"), None);
    }
    fn literal_names(text: &str) -> BTreeSet<&str> {
        text.split('"')
            .skip(1)
            .step_by(2)
            .filter(|name| {
                name.starts_with("nts_")
                    && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            })
            .collect()
    }
    #[test]
    fn every_binding_including_synthesized_names_has_a_catalog_route() {
        for source in [
            include_str!("raising.rs"),
            include_str!("strings.rs"),
            include_str!("erased_ops.rs"),
            include_str!("array_methods.rs"),
            include_str!("array_copy.rs"),
            include_str!("array_lookup.rs"),
            include_str!("array_join.rs"),
            include_str!("array_sort.rs"),
        ] {
            let function = source
                .split_once("pub(crate) fn external(name:")
                .unwrap()
                .1
                .split_once("\n}\n")
                .unwrap()
                .0;
            for name in literal_names(function) {
                assert!(
                    helper_support(name).is_some(),
                    "unclassified synthesized binding {name}"
                );
                assert!(binding(name).is_some());
            }
        }
        for name in literal_names(include_str!("host.rs")) {
            if host::external(name).is_some() {
                assert_eq!(helper_support(name), Some(Support::HostImport));
            }
        }
    }
}
