use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{Manifest, Profile, Target, parse_manifest};

/// Today's native loop implementations, all within one host:loop capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoopAdapter {
    Libuv,
    Glib,
    CoreFoundation,
    Win32,
}

/// Parsed by the binding, not guessed from source names or linker flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoopOptions {
    pub adapter: LoopAdapter,
}

impl LoopOptions {
    /// This is implementation eligibility, not a conformance claim. A matching
    /// complete record remains required, including adapter and target inputs.
    #[must_use]
    pub fn admits(self, target: &Target) -> bool {
        if target.host != "native" || !matches!(target.backend.as_str(), "c" | "llvm") {
            return false;
        }
        match self.adapter {
            LoopAdapter::Libuv => matches!(
                target.os.as_str(),
                "linux" | "macos" | "windows" | "ios" | "android"
            ),
            LoopAdapter::Glib => target.os == "linux",
            LoopAdapter::CoreFoundation => matches!(target.os.as_str(), "macos" | "ios"),
            LoopAdapter::Win32 => target.os == "windows",
        }
    }
}

/// The metadata describes the existing binding; it does not certify any target.
pub fn runtime_manifest() -> Result<Manifest, String> {
    parse_manifest(
        "@nts/runtime",
        include_str!("../../providers/runtime/manifest.json"),
    )
}

/// Rust and @nts/config consume the same profile data. Product fields are added
/// only when the compiler consumes a profile, not merely when it can decode it.
pub fn builtin_profiles() -> Result<BTreeMap<String, Profile>, String> {
    let data = super::manifest::strict_value(include_str!(
        "../../../tooling/config/src/profiles/data.json"
    ))?;
    let profiles: BTreeMap<String, Profile> =
        serde_json::from_value(data).map_err(|error| error.to_string())?;
    if profiles.iter().any(|(name, profile)| name != &profile.id) {
        return Err("a profile key must equal its identity".into());
    }
    Ok(profiles)
}
