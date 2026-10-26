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
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn host_contract_is_valid_and_declarations_do_not_use_any() {
        let contract = parse_host_contract().expect("valid host contract");
        assert_eq!(contract.version, 1);
        assert_eq!(contract.declarations, "host.d.ts");
        assert_ne!(contract.intrinsics, [] as [HostIntrinsic; 0]);

        let mut declarations = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for intrinsic in contract.intrinsics {
            assert_ne!(intrinsic.declaration, "");
            assert_ne!(intrinsic.id, "");
            assert_ne!(intrinsic.capability, "");
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

    #[cfg(feature = "measurements")]
    #[test]
    fn host_declarations_typecheck_with_the_native_frontend() {
        let root = camino::Utf8PathBuf::from(std::env::var("TMPDIR").unwrap_or_else(|_| {
            format!("{}/.cache", std::env::var("HOME").expect("home directory"))
        }))
        .join(format!("nts-test262-host-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("private scratch");
        let declarations =
            camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/test262/host.d.ts");
        let config = root.join("tsconfig.json");
        let text = serde_json::json!({
            "compilerOptions": {
                "strict": true, "noEmit": true, "types": [],
                "target": "ESNext", "lib": ["es2023", "esnext.sharedmemory"]
            },
            "files": [declarations]
        });
        std::fs::write(&config, text.to_string()).expect("host project");
        let snapshot = nts_frontend_ts::Frontend::new(&root)
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .expect("native host snapshot");
        std::fs::remove_dir_all(&root).expect("remove scratch");
        assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    }
}
