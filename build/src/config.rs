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
    /// The package generated classes land in, for a JVM product.
    ///
    /// Read so a build can refuse a jar that would not match it: the emitter
    /// hardcodes `nts/gen`, and `docs/jvm-interop.md` lists that under packaging
    /// gaps. A jar whose classes are somewhere other than where its config says
    /// is an artifact that does not match its declaration.
    #[serde(default, rename = "javaPackage")]
    pub java_package: Option<String>,
    /// Versioned soname, where a library must match a name it did not choose.
    ///
    /// Read because the linker takes it. Deserialized fields are added when
    /// something consumes them, not when the TypeScript type grows one: a
    /// member that is parsed and never read is the same shape as a config field
    /// nothing reaches.
    #[serde(default)]
    pub soname: Option<String>,
}

/// Native sources a package contributes, and the header that describes them.
///
/// **Read because a binding has to come from somewhere.** A package's source
/// says `import { digest32 } from "c:digest"`; this says which header declares
/// it. Neither alone is enough and neither repeats the other -- the specifier is
/// the program's, the header is the package's, and `nts bind-c` needs both.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct NativeSources {
    pub dir: String,
    /// Targets this root is compiled for. Absent means every target.
    #[serde(default)]
    pub targets: Option<Vec<String>>,
    /// The C header to bind, where the surface is C rather than class files.
    #[serde(default)]
    pub header: Option<String>,
}

impl NativeSources {
    /// Whether this root is compiled for a target.
    #[must_use]
    pub fn covers(&self, id: &str) -> bool {
        self.targets.as_ref().is_none_or(|ids| ids.iter().any(|it| it == id))
    }
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
    /// Target ids a package claims to support.
    ///
    /// A claim rather than a build: a package emits nothing of its own. Read so
    /// that a package with native code can generate the bindings its own sources
    /// import, which is what lets it typecheck in isolation.
    #[serde(default)]
    pub targets: Option<Vec<String>>,
    #[serde(default)]
    pub native: Vec<NativeSources>,
}

/// The config above a file, if any -- the package that file belongs to.
///
/// **Walking up from the file rather than from the project**, because the config
/// describing a package's native code is the package's own, and the file doing
/// the `import` is inside it. An app's program contains its dependencies'
/// sources, so the question "which config describes this `c:` module" is
/// answered by where the importing file is, not by where the build started.
///
/// Stops at a config that declares `workspace`, which is a root and describes
/// nothing's native code.
#[must_use]
pub fn above(file: &Utf8Path) -> Option<Utf8PathBuf> {
    let mut at = file.parent();
    while let Some(directory) = at {
        let candidate = directory.join(FILE_NAME);
        if candidate.exists() {
            return Some(candidate);
        }
        at = directory.parent();
    }
    None
}

/// Whether a config declaring a `workspace` sits above this project.
///
/// A monorepo, in other words -- which is the signal that a package this app
/// does not itself describe may contribute native code. An app's own config
/// says nothing about its dependencies' C, and should not: `apps/native`
/// declares no `native:` and its program contains `crypto-core`'s `c:digest`.
#[must_use]
pub fn workspace_above(tsconfig: &Utf8Path) -> bool {
    let mut at = tsconfig.parent().and_then(Utf8Path::parent);
    while let Some(directory) = at {
        let candidate = directory.join(FILE_NAME);
        if candidate.exists()
            && std::fs::read_to_string(&candidate).is_ok_and(|text| text.contains("workspace:"))
        {
            return true;
        }
        at = directory.parent();
    }
    false
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
            native: Vec::new(),
            targets: None,
            products: names
                .iter()
                .map(|name| {
                    (
                        (*name).to_owned(),
                        Product {
                            kind: "shared-library".to_owned(),
                            entry: "./src/main.ts".to_owned(),
                            targets: Vec::new(),
                            java_package: None,
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
