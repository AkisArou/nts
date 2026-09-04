use serde::{Deserialize, Serialize};

/// Checker-facing declarations for the synthetic Test262 host profile.
pub const HOST_DECLARATIONS: &str = include_str!("../../assets/test262/host.d.ts");

/// Stable declaration-identity and capability contract for future adapters.
pub const HOST_CONTRACT: &str = include_str!("../../assets/test262/host-contract.json");

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HostContractManifest {
    pub version: u32,
    pub declarations: String,
    pub intrinsics: Vec<HostIntrinsic>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct HostIntrinsic {
    pub declaration: String,
    pub id: String,
    pub capability: String,
}

pub fn parse_host_contract() -> Result<HostContractManifest, serde_json::Error> {
    serde_json::from_str(HOST_CONTRACT)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeSet, path::Path, process::Command};

    use super::*;

    #[test]
    fn host_contract_is_valid_and_declarations_do_not_use_any() {
        let contract = parse_host_contract().expect("valid host contract");
        assert_eq!(contract.version, 1);
        assert_eq!(contract.declarations, "host.d.ts");
        assert!(!contract.intrinsics.is_empty());

        let mut declarations = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for intrinsic in contract.intrinsics {
            assert!(!intrinsic.declaration.is_empty());
            assert!(!intrinsic.id.is_empty());
            assert!(!intrinsic.capability.is_empty());
            assert!(declarations.insert(intrinsic.declaration));
            assert!(ids.insert(intrinsic.id));
        }

        for line in HOST_DECLARATIONS.lines().filter(|line| {
            let line = line.trim_start();
            !line.starts_with("/*") && !line.starts_with('*') && !line.starts_with("//")
        }) {
            assert!(
                !line
                    .split(|character: char| {
                        !character.is_ascii_alphanumeric() && character != '_'
                    })
                    .any(|token| token == "any"),
                "host declaration code contains an any token: {line}"
            );
        }
    }

    #[test]
    #[ignore = "requires the optional pinned tsgo executable"]
    fn host_declarations_typecheck_with_tsgo() {
        let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let tsgo = repository.join("target/tsgo");
        if !tsgo.is_file() {
            return;
        }
        let declarations = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/test262/host.d.ts");
        let output = Command::new(tsgo)
            .current_dir(repository)
            .args([
                "--ignoreConfig",
                "--noEmit",
                "--strict",
                "--lib",
                "es2023,esnext.sharedmemory",
            ])
            .arg(declarations)
            .output()
            .expect("run tsgo");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
