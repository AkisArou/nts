//! Reading `nts.config.ts`.
//!
//! # Why this evaluates rather than parses
//!
//! The file is TypeScript, and its contents are function calls:
//! `library.native({ targets: [target.linux()], entry })`. Parsing it would mean
//! reimplementing those constructors in Rust -- a second answer to what
//! `target.linux()` produces, in a different language from the one the user
//! typechecks against. Every round of `docs/nts-config.md`'s audit has been
//! about deleting exactly that shape, so this runs the real constructors and
//! reads the value they return.
//!
//! The cost is stated rather than discovered: **node becomes a config-time
//! dependency of a compiler that is otherwise Rust.** It is bounded by the
//! config being optional -- a project with no `nts.config.ts` never invokes
//! node, which is every example in this tree but one.
//!
//! §5 of `docs/nts-config.md` settled the other half. An earlier draft wanted a
//! statically evaluable config because a cache key cannot be the output of
//! arbitrary code; that was over-stated. Keying on the **resolved** value -- what
//! this returns -- is sound however it was computed. What survives is a property
//! rather than a rule: a config that reads the clock or the environment resolves
//! differently per run and misses the cache.
//!
//! # Why `@nts/config` must resolve normally
//!
//! The config imports it, and node resolves it the way it resolves any
//! dependency. Two alternatives were considered and rejected. Injecting a
//! resolver hook pointing at this repository's copy would work here and not in
//! an installed compiler. Shipping a *runtime* implementation of the
//! constructors inside `nts` would work everywhere and is worse than either: it
//! is a second implementation of `library.native`, so the package the user
//! typechecks against and the one that decides what gets built could disagree,
//! which is the failure this whole file is arranged to avoid.

use std::collections::BTreeMap;
use std::process::Command;

use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use serde::Deserialize;

/// The file name, which is not configurable. One name, found in one place.
pub const FILE_NAME: &str = "nts.config.ts";

/// A compilation target, as the config's constructors produced it.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Target {
    /// The platform type surface: the prelude package, and the cache key.
    pub id: String,
    pub os: String,
    #[serde(default)]
    pub arch: Option<String>,
    pub backend: String,
    /// The deployment floor, which is not the same number as the id's.
    #[serde(default, rename = "minimumVersion")]
    pub minimum_version: Option<String>,
}

/// One artifact a build emits.
///
/// **`entry` is the whole of the surface question.** An `exports: Vec<String>`
/// sat here for one commit, holding the names that cross the public ABI, and it
/// was a second statement of what the entry module exports. A product's surface
/// is what its entry publishes -- `hir::reachable::Roots::EntrySurface` -- so a
/// helper the entry does not export is not in the artifact, and nothing in the
/// config has to say so.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Product {
    pub kind: String,
    pub entry: String,
    #[serde(default)]
    pub targets: Vec<Target>,
    /// Versioned soname, where a library must match a name it did not choose.
    ///
    /// Read because the linker takes it. Deserialized fields are added when
    /// something consumes them, not when the TypeScript type grows one: a
    /// member that is parsed and never read is the same shape as a config field
    /// nothing reaches.
    #[serde(default)]
    pub soname: Option<String>,
}

/// A resolved `nts.config.ts`: the value `defineConfig` returned.
///
/// Deliberately not every field the TypeScript type carries. A field is added
/// here when something reads it -- `manifests`, `dependencies` and `integrate`
/// are real and nothing consumes them yet, and a struct member that is parsed
/// and never read is the same shape as a config field nothing reaches.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct Resolved {
    #[serde(default)]
    pub products: BTreeMap<String, Product>,
}

/// The config governing a project, given the tsconfig a command was pointed at.
///
/// Beside it, because that is the relationship the config itself states from the
/// other direction: `tsconfig` defaults to `./tsconfig.json` beside the config.
/// Searching upwards was considered and is wrong here -- a monorepo root holds a
/// config with no products, so an app without one would silently inherit its
/// parent's and build nothing.
#[must_use]
pub fn beside(tsconfig: &Utf8Path) -> Option<Utf8PathBuf> {
    let directory = if tsconfig.is_dir() { tsconfig } else { tsconfig.parent()? };
    let candidate = directory.join(FILE_NAME);
    candidate.exists().then_some(candidate)
}

/// The script that does the evaluating.
///
/// Top-level `await` needs module input, and `-e` avoids writing a file into a
/// project we were asked to read. `default` rather than the namespace: the
/// config's value is what `defineConfig` returned, and a config that exports
/// something else has not declared a build.
const EVALUATE: &str = "\
const loaded = await import(process.argv[1]);
if (loaded.default === undefined) throw new Error('no default export');
process.stdout.write(JSON.stringify(loaded.default));
";

/// Evaluate a config and return the value it declares.
///
/// Failure is loud, never a silent fall-through to "no config". A project that
/// has written one and cannot run it is misconfigured, and the message says
/// which of the three ways it is: node absent, the file threw, or the output was
/// not the shape this expects.
pub fn resolve(config: &Utf8Path) -> Result<Resolved> {
    let absolute = config
        .canonicalize_utf8()
        .with_context(|| format!("resolving {config}"))?;
    let node = std::env::var("NTS_NODE").unwrap_or_else(|_| "node".to_owned());
    let output = Command::new(&node)
        .args(["--input-type=module", "-e", EVALUATE, "--"])
        .arg(absolute.as_str())
        .output()
        .with_context(|| {
            format!(
                "running `{node}` to evaluate {config}. The config is TypeScript and \
                 is evaluated rather than parsed; set NTS_NODE to name the binary"
            )
        })?;
    if !output.status.success() {
        let why = String::from_utf8_lossy(&output.stderr);
        // The one failure worth naming, because the fix is a word rather than a
        // diagnosis: the config imports `@nts/config` and node resolves it like
        // any dependency.
        if why.contains("@nts/config") {
            bail!(
                "{config} imports `@nts/config` and node cannot resolve it. It is a \
                 dependency of the project, like any other:\n\n{why}"
            );
        }
        bail!("evaluating {config} failed:\n\n{why}");
    }
    let text = String::from_utf8(output.stdout).context("config output is not UTF-8")?;
    serde_json::from_str(&text)
        .with_context(|| format!("{config} resolved to something this does not understand"))
}

/// The one product a command should build, given an optional `--product` name.
///
/// **A config with several products and no name is an error, not a guess.**
/// `apps/react` is one product over four targets and `examples/workspace`'s
/// brownfield apps are one each, but a shared library beside a static archive of
/// the same code is two -- and picking either silently would emit an artifact
/// nobody asked for under a name that says otherwise.
pub fn product<'a>(resolved: &'a Resolved, named: Option<&str>) -> Result<Option<(&'a str, &'a Product)>> {
    if let Some(name) = named {
        let Some((key, value)) = resolved.products.get_key_value(name) else {
            let known: Vec<&str> = resolved.products.keys().map(String::as_str).collect();
            bail!("no product named `{name}`; this config declares {known:?}")
        };
        return Ok(Some((key.as_str(), value)));
    }
    let mut products = resolved.products.iter();
    let (Some((name, only)), None) = (products.next(), products.next()) else {
        if resolved.products.len() > 1 {
            let known: Vec<&str> = resolved.products.keys().map(String::as_str).collect();
            bail!("this config declares {known:?}; name one with --product");
        }
        return Ok(None);
    };
    Ok(Some((name.as_str(), only)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(names: &[&str]) -> Resolved {
        Resolved {
            products: names
                .iter()
                .map(|name| {
                    (
                        (*name).to_owned(),
                        Product {
                            kind: "shared-library".to_owned(),
                            entry: "./src/main.ts".to_owned(),
                            targets: Vec::new(),
                            soname: None,
                        },
                    )
                })
                .collect(),
        }
    }

    #[test]
    fn one_product_needs_no_name() {
        let resolved = with(&["hello"]);
        assert_eq!(product(&resolved, None).expect("one product needs no name").map(|(n, _)| n), Some("hello"));
    }

    #[test]
    fn no_products_is_not_an_error() {
        // A package, or a workspace root. It declares no build and that is a
        // legitimate config rather than a broken one.
        assert_eq!(product(&Resolved::default(), None).expect("no products is legitimate").map(|(n, _)| n), None);
    }

    #[test]
    fn several_products_refuse_to_be_guessed() {
        let resolved = with(&["sdk", "sdkStatic"]);
        let why = product(&resolved, None).expect_err("two products cannot be guessed").to_string();
        assert!(why.contains("--product"), "{why}");
        assert!(why.contains("sdkStatic"), "{why}");
    }

    #[test]
    fn a_named_product_that_is_not_there_says_what_is() {
        let resolved = with(&["sdk"]);
        let why = product(&resolved, Some("addon")).expect_err("no such product").to_string();
        assert!(why.contains("addon") && why.contains("sdk"), "{why}");
    }

}
