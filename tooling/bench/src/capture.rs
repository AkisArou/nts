//! The identities of the files actually checked, owned before the snapshot is dropped.
use anyhow::{Context, Result};
use camino::Utf8Path;
use nts_semantic_schema::SemanticSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct File {
    path: String,
    digest: String,
    rewritten_by: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub(super) struct Capture {
    algorithm: String,
    workload: Vec<File>,
    declarations: Vec<File>,
    drivers: Vec<(String, String)>,
}

impl Capture {
    pub(super) fn of(
        snapshot: &SemanticSnapshot,
        root: &Utf8Path,
        case: &Utf8Path,
    ) -> Result<Self> {
        let mut workload = Vec::new();
        let mut declarations = Vec::new();
        for source in &snapshot.sources {
            let file = File {
                path: source.uri.clone(),
                digest: hex(&source.digest.0),
                rewritten_by: source.rewritten_by.clone(),
            };
            if source.uri.ends_with(".d.ts") {
                declarations.push(file.clone());
            }
            // Unknown or workload-owned declarations may affect emission (for example const enums).
            // Keep every checked source in the equivalence inventory; no suffix is proof of a toolchain-only file.
            workload.push(file);
        }
        workload.sort_by(|a, b| a.path.cmp(&b.path));
        declarations.sort_by(|a, b| a.path.cmp(&b.path));
        let mut drivers = Vec::new();
        for name in ["driver.cpp", "driver.java", "driver.mjs", "driver.ts"] {
            let path = case.join(name);
            if path.exists() {
                let bytes = std::fs::read(&path).with_context(|| format!("reading {path}"))?;
                let hash = hmac_sha256::Hash::hash(&bytes);
                drivers.push((path.strip_prefix(root)?.to_string(), hex(&hash)));
            }
        }
        Ok(Self {
            algorithm: "xxh3-128-le-checked-utf8-v1".to_owned(),
            workload,
            declarations,
            drivers,
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|byte| {
            [
                char::from(DIGITS[usize::from(byte >> 4)]),
                char::from(DIGITS[usize::from(byte & 15)]),
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_local_declaration_content_change_changes_the_captured_workload() -> Result<()> {
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let case = root.join("target").join(format!(
            "benchmark-declaration-identity-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&case)?;
        let config = case.join("tsconfig.json");
        std::fs::write(&config,serde_json::json!({"extends":root.join("tsconfig.fixtures.json"),"files":["main.ts","config.d.ts"]}).to_string())?;
        std::fs::write(
            case.join("main.ts"),
            "import { Config } from './config.js'; export function work(n:number):number { return n+Config.value; }",
        )?;
        let declaration = case.join("config.d.ts");
        std::fs::write(&declaration, "export declare const enum Config { value=1 }")?;
        let before = Capture::of(&crate::capture_snapshot(&config)?, &root, &case)?;
        std::fs::write(&declaration, "export declare const enum Config { value=2 }")?;
        let after = Capture::of(&crate::capture_snapshot(&config)?, &root, &case)?;
        let select = |capture: &Capture| {
            capture
                .workload
                .iter()
                .find(|f| f.path.ends_with("/config.d.ts"))
                .map(|f| f.digest.clone())
        };
        assert!(
            select(&before).is_some(),
            "local declaration must participate in own-best identity"
        );
        assert_ne!(
            select(&before),
            select(&after),
            "the one changed declaration must change the workload inventory"
        );
        std::fs::remove_dir_all(case)?;
        Ok(())
    }
}
