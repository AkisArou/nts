//! Write the compiler's manifest from its Rust capability table.
use anyhow::{Result, bail, ensure};
use nts_core::hir::features::{ProviderKind, compiler_providers};
use serde_json::{Value, json};

fn manifest() -> Value {
    let provides: serde_json::Map<_, _> = compiler_providers()
        .into_iter()
        .map(|row| {
            let key = match row.kind {
                ProviderKind::Compiler => "compiler",
                ProviderKind::Source => "source",
                ProviderKind::Binding => "binding",
            };
            (
                row.feature,
                json!({
                    (key): true,
                    "uses": row.uses,
                    "members": row.members,
                    "limits": row.limits,
                }),
            )
        })
        .collect();
    json!({"nts": {"provides": provides}})
}

fn bytes() -> Result<String> {
    Ok(serde_json::to_string_pretty(&manifest())? + "\n")
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../compiler/core/providers/manifest.json");
    match args.as_slice() {
        [] => print!("{}", bytes()?),
        [flag] if flag == "--write" => std::fs::write(path, bytes()?)?,
        [flag] if flag == "--check" => ensure!(
            std::fs::read_to_string(path)? == bytes()?,
            "compiler provider manifest is stale; run cargo run -p nts-differential --bin compiler-providers -- --write"
        ),
        _ => bail!("usage: compiler-providers [--write | --check]"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_in_manifest_is_exactly_the_rust_table() {
        assert_eq!(
            include_str!("../../../../compiler/core/providers/manifest.json"),
            bytes().expect("serialize compiler manifest")
        );
    }

    #[test]
    fn claims_are_partial_compiler_surfaces_not_helper_or_future_policy_names() {
        let value = manifest();
        let claims = value["nts"]["provides"]
            .as_object()
            .expect("provides is an object");
        assert_eq!(claims.len(), 47);
        assert_eq!(claims["es:JSON"]["members"], json!(["stringify"]));
        assert_eq!(claims["web:console"]["compiler"], true);
        assert!(claims.values().all(|claim| claim.get("kind").is_none()));
        assert!(!claims.contains_key("host:utf8"));
        assert!(!claims.contains_key("web:structuredClone"));
        assert!(!claims.contains_key("nts_console_write"));
        assert!(!claims.contains_key("es:RegExp"));
        assert_eq!(
            value,
            manifest(),
            "no path, clock, locale or iteration-order input"
        );
    }
}
