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
    /// R8 rules an AAR ships to its consumer, so their minifier keeps what
    /// reflection reaches.
    #[serde(default, rename = "consumerProguard")]
    pub consumer_proguard: Option<String>,
    /// The package generated classes land in, for a JVM product.
    ///
    /// Read so a build can refuse a jar that would not match it: the emitter
    /// hardcodes `nts/gen`, and `docs/jvm-interop.md` lists that under packaging
    /// gaps. A jar whose classes are somewhere other than where its config says
    /// is an artifact that does not match its declaration.
    #[serde(default, rename = "javaPackage")]
    pub java_package: Option<String>,
    /// Reverse-DNS application identifier, where the platform needs one.
    ///
    /// Read because an APK's manifest must declare a package name and one
    /// cannot be invented: two apps sharing an id cannot be installed side by
    /// side, and a wrong one silently replaces somebody else's app on the
    /// device. So a generated manifest without this is a refusal rather than a
    /// default, and a project supplying its own fragment does not need it.
    #[serde(default, rename = "id")]
    pub application_id: Option<String>,
    /// Versioned soname, where a library must match a name it did not choose.
    ///
    /// Read because the linker takes it. Deserialized fields are added when
    /// something consumes them, not when the TypeScript type grows one: a
    /// member that is parsed and never read is the same shape as a config field
    /// nothing reaches.
    #[serde(default)]
    pub soname: Option<String>,
}

/// Build settings a root config carries.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct BuildSettings {
    #[serde(default)]
    pub cache: Option<CacheSettings>,
}

/// Where compiled objects are kept between builds.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CacheSettings {
    #[serde(default)]
    pub local: Option<bool>,
    #[serde(default)]
    pub directory: Option<String>,
}

/// A manifest fragment a package contributes to its consumer's application.
///
/// **Read, not merged.** AGP has a manifest merger with a specification, and
/// `runtime/jvm/web-platform/android/` already relies on it -- so an AAR carries
/// the fragment and the consumer's build merges it. Reimplementing XML merging
/// here would be a second answer to a question the platform already answers.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Manifest {
    #[serde(default)]
    pub targets: Vec<String>,
    pub path: String,
}

impl Manifest {
    /// Whether this fragment is for a target.
    #[must_use]
    pub fn covers(&self, id: &str, floor: Option<&str>) -> bool {
        self.targets.is_empty() || self.targets.iter().any(|it| claim_covers(it, id, floor))
    }
}

/// Whether a package's support claim covers the target being built.
///
/// **A versioned claim is a floor, not an equality, and this was exact string
/// comparison.** `targets: ["android-29"]` says "needs API 29 at run time" --
/// that is what `minSdk` means and what makes a claim useful, since a package
/// cannot enumerate every SDK that will ever ship. An app compiling against the
/// `android-36` surface with a floor of 29 is the *recommended* Android
/// configuration, and under equality it matched nothing: `apps/android` built
/// two signed APKs carrying neither `notifications`' Java nor `biometrics`'
/// `USE_BIOMETRIC` permission, and said nothing about either.
///
/// It was found by an A/B rather than by reading, and the arms differed in one
/// word: `apps/android-brownfield` declares no `compileSdk`, so its id is
/// `android-29`, and it refused by name on the same package the other one
/// dropped. A fragment whose own comment reads "without it the prompt throws
/// rather than returning false, so a consumer that omits it sees a crash and
/// not a denial" is the cost of the silent half.
///
/// **The claim is compared against the consumer's floor, not against its
/// surface**, and the first version of this got that wrong in a way that has a
/// real case: an app with `compileSdk: 36` and `minSdk: 21` compiles against a
/// surface newer than the claim and still runs on devices older than it, so a
/// package needing API 29 is *not* satisfied and comparing against the id would
/// have said it was. `docs/nts-config.md` states the rule, which is the half
/// that was already written down -- the audit derived it and the build did not
/// read it back.
///
/// **Split at the last `-`, and only when the suffix is a number.** `linux-gnu`
/// and `windows` have no version to order, so they stay exact; `node-api-8`,
/// `java-8` and `ios-17` are floors for the same reason `android-29` is. The
/// direction matters and only one way round is sound: a claim of 29 is met by a
/// floor of 36, and a claim of 36 is not met by a floor of 29.
#[must_use]
pub fn claim_covers(claim: &str, id: &str, floor: Option<&str>) -> bool {
    fn split(value: &str) -> Option<(&str, u64)> {
        let (platform, version) = value.rsplit_once('-')?;
        Some((platform, version.parse().ok()?))
    }
    let (Some((claimed, needs)), Some((wanted, surface))) = (split(claim), split(id)) else {
        // Nothing to order: an unversioned id is its own whole answer, and
        // `linux-gnu` against `linux-musl` is two C libraries rather than a
        // floor and a ceiling.
        return claim == id;
    };
    if claimed != wanted {
        return false;
    }
    // **Absent means the surface, which is `minSdk == compileSdk`.** Every
    // target `tooling/config` builds carries `minimumVersion`; a hand-written
    // target literal need not, and the honest reading of "no floor declared" is
    // the one it compiles against rather than a lower number nobody wrote.
    let have = floor.and_then(|value| value.split('.').next()?.parse().ok()).unwrap_or(surface);
    needs <= have
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
    pub fn covers(&self, id: &str, floor: Option<&str>) -> bool {
        self.targets.as_ref().is_none_or(|ids| ids.iter().any(|it| claim_covers(it, id, floor)))
    }
}

/// A resolved `nts.config.ts`: the value `defineConfig` returned.
///
/// Deliberately not every field the TypeScript type carries. A field is added
/// here when something reads it, because a struct member that is parsed and
/// never read is the same shape as a config field nothing reaches.
///
/// **That sentence used to name `manifests`, `dependencies` and `integrate` as
/// the three nothing consumed, and it went stale one field at a time without
/// anything noticing.** All three are read now, and so is `build.cache` -- which
/// the replacement for that sentence wrongly listed as unread on the same day
/// it was written, so the correction needed correcting.
///
/// `workspace` is the one field the TypeScript shapes and this does not
/// deserialize. It is absent *because* nothing reads it: `above` finds a root by
/// finding a config, not by reading that field.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct Resolved {
    /// The program this config describes, where it is not `./tsconfig.json`.
    ///
    /// Read because something now honours it. It is documented as "the
    /// program's source of truth ... named only when it differs", and until
    /// this existed a config naming `./program.json` was ignored and the build
    /// demanded a file its author had deliberately not written.
    #[serde(default)]
    pub tsconfig: Option<String>,
    #[serde(default)]
    pub products: BTreeMap<String, Product>,
    /// Where compiled objects are kept between builds.
    ///
    /// Root config only, and `§34` already reserved it. Read because 87% of a
    /// build of `examples/library` was recompiling the runtime, which is the
    /// same translation unit every time.
    /// Build-system hooks to emit for a brownfield consumer.
    ///
    /// Read now that something emits them. A host build system has a "run this
    /// before compiling" step and every one of them is different; the adapter
    /// stays thin -- it invokes the compiler and declares its inputs and
    /// outputs -- or there are N implementations of the build.
    #[serde(default)]
    pub integrate: Vec<String>,
    #[serde(default)]
    pub build: Option<BuildSettings>,
    /// Manifest fragments a package contributes to its consumer.
    #[serde(default)]
    pub manifests: Vec<Manifest>,
    /// Target ids a package claims to support.
    ///
    /// A claim rather than a build: a package emits nothing of its own. Read so
    /// that a package with native code can generate the bindings its own sources
    /// import, which is what lets it typecheck in isolation.
    #[serde(default)]
    pub targets: Option<Vec<String>>,
    #[serde(default)]
    pub native: Vec<NativeSources>,
    /// What this project needs that this compiler did not build.
    ///
    /// Keyed by target, so a build consults only the claim covering the target
    /// it is building -- which is why a resolver this cannot read refuses for
    /// the targets naming it rather than refusing the project.
    #[serde(default)]
    pub dependencies: BTreeMap<String, crate::dependencies::Dependencies>,
    /// The React stage: the project's TSX compiled by the React Compiler and
    /// its JSX lowered, before nts reads it. Absent, the files are read as
    /// written -- and JSX, which nts does not compile, is refused.
    #[serde(default)]
    pub react: Option<ReactSettings>,
}

/// `react` in `nts.config.ts`.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReactSettings {
    /// Whether components and hooks go through the React Compiler. On unless
    /// turned off; off, the stage only lowers JSX.
    #[serde(default = "on")]
    pub compiler: bool,
    /// Which functions the compiler considers: its `compilationMode`
    /// (`infer`, `annotation`, `syntax` or `all`), `infer` when absent.
    #[serde(default)]
    pub compilation_mode: Option<String>,
}

const fn on() -> bool {
    true
}

/// The config above a file, if any -- the package that file belongs to.
///
/// **Walking up from the file rather than from the project**, because the config
/// describing a package's native code is the package's own, and the file doing
/// the `import` is inside it. An app's program contains its dependencies'
/// sources, so the question "which config describes this `c:` module" is
/// answered by where the importing file is, not by where the build started.
///
/// **It does not stop at a workspace root, and the comment here used to say it
/// did.** That would be right for one of this function's two callers and wrong
/// for the other, which is the reason to write the distinction down rather than
/// implement the sentence.
///
/// `bind_one` asks "which config declares this `c:` module's header", and for
/// that a root genuinely describes nothing -- attributing a package's native
/// code to the monorepo root is a wrong answer.
///
/// `generate_bindings` asks "which configs are in play for this program", and
/// for *that* the root is a legitimate answer: `examples/workspace/packages/storage`
/// has no config of its own, so every source in it walks up to the root -- which
/// is how a root-level `dependencies` or `manifests` reaches a build at all.
/// Skipping roots here would silently drop them.
///
/// So both callers get the nearest config and the one that cares filters
/// afterwards, on the field it actually needs.
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
    // **Evaluated once per path per process.** A build asks this from eight
    // call sites -- the products, the native roots, the manifests a package
    // contributes, the ones it does not, its support claim -- and once per
    // target, so `apps/android` spawned **35** `node` processes to answer six
    // distinct questions. Counted with a `node` shim on PATH, after the first
    // shim broke the build and reported 1, which was a true count of a run that
    // did not happen.
    //
    // Keyed on the canonicalised path and nothing else: within one process a
    // config file does not change, and a key that tried to notice would be
    // claiming to support something this does not do. A *new* process re-reads
    // it, which is when a config can have changed.
    if let Some(known) = cached(&absolute) {
        return Ok(known);
    }
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
    let resolved: Resolved = serde_json::from_str(&text)
        .with_context(|| format!("{config} resolved to something this does not understand"))?;
    remember(&absolute, &resolved);
    Ok(resolved)
}

/// What this process has already evaluated.
///
/// A `Mutex` rather than a `RefCell` because `resolve` is a free function with
/// no owner to hang a cell off, and poisoning is not a concern: nothing here
/// panics while holding it.
fn evaluated() -> &'static std::sync::Mutex<BTreeMap<Utf8PathBuf, Resolved>> {
    static SEEN: std::sync::OnceLock<std::sync::Mutex<BTreeMap<Utf8PathBuf, Resolved>>> =
        std::sync::OnceLock::new();
    SEEN.get_or_init(|| std::sync::Mutex::new(BTreeMap::new()))
}

fn cached(absolute: &Utf8Path) -> Option<Resolved> {
    evaluated().lock().ok()?.get(absolute).cloned()
}

fn remember(absolute: &Utf8Path, resolved: &Resolved) {
    if let Ok(mut seen) = evaluated().lock() {
        seen.insert(absolute.to_owned(), resolved.clone());
    }
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
            tsconfig: None,
            native: Vec::new(),
            dependencies: BTreeMap::new(),
            integrate: Vec::new(),
            build: None,
            manifests: Vec::new(),
            targets: None,
            react: None,
            products: names
                .iter()
                .map(|name| {
                    (
                        (*name).to_owned(),
                        Product {
                            kind: "shared-library".to_owned(),
                            entry: "./src/main.ts".to_owned(),
                            targets: Vec::new(),
                            consumer_proguard: None,
                            java_package: None,
                            application_id: None,
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

    /// The A/B that found this: two arms differing in one word.
    ///
    /// `apps/android` declares `compileSdk: 36` and `apps/android-brownfield`
    /// does not, so their target ids are `android-36` and `android-29` -- and
    /// under exact comparison the first matched no package claim at all while
    /// the second matched every one. Both directions are here because a test of
    /// the permissive one alone cannot fail when the comparison is wrong in the
    /// other.
    #[test]
    fn a_version_claim_is_met_by_the_floor_and_only_in_one_direction() {
        let floor = Some("29");
        // What was broken: the recommended configuration, compiling against a
        // newer surface than the floor a package claims.
        assert!(claim_covers("android-29", "android-36", floor));
        assert!(claim_covers("ios-17", "ios-18", Some("17.0")));
        assert!(claim_covers("node-api-8", "node-api-9", Some("9")));
        assert!(claim_covers("java-8", "java-17", Some("17")));

        // The direction that must not hold. A package needing the API 36
        // surface cannot be built into an app running back to 29, and a
        // comparison that merely ordered the pair would say it could.
        assert!(!claim_covers("android-36", "android-29", floor));
        assert!(!claim_covers("ios-18", "ios-17", Some("17.0")));

        // Equality still holds, which is the case every existing config uses.
        assert!(claim_covers("android-29", "android-29", floor));
        assert!(claim_covers("linux-gnu", "linux-gnu", None));
        assert!(claim_covers("windows", "windows", None));

        // A platform is never another platform, whatever the numbers do.
        assert!(!claim_covers("android-29", "ios-18", Some("18")));
        assert!(!claim_covers("linux-gnu", "windows", None));

        // An unversioned suffix is not a number and is not ordered: `gnu` and
        // `musl` are different C libraries, not a floor and a ceiling.
        assert!(!claim_covers("linux-gnu", "linux-musl", None));
        assert!(!claim_covers("linux-musl", "linux-gnu", None));
    }

    /// **The surface is not the floor**, which the first version of this
    /// conflated and `docs/nts-config.md` had already written down.
    ///
    /// An app compiling against API 36 and running back to 21 is a real
    /// configuration, and a package needing API 29 is not satisfied by it --
    /// the app would install on a device the package cannot run on. Comparing
    /// the claim against the id would answer yes, so this is the case that
    /// separates the two readings, and nothing else here does.
    #[test]
    fn the_claim_is_measured_against_the_floor_and_not_the_surface() {
        assert!(!claim_covers("android-29", "android-36", Some("21")));
        assert!(claim_covers("android-29", "android-36", Some("29")));

        // No floor declared reads as `minSdk == compileSdk` -- the surface --
        // rather than as a lower number nobody wrote.
        assert!(claim_covers("android-29", "android-36", None));

        // A floor with a minor version, which is how every Apple target spells
        // it: `minimumVersion: "17.0"` against a claim of `ios-17`.
        assert!(claim_covers("ios-17", "ios-18", Some("17.0")));
        assert!(!claim_covers("ios-17", "ios-18", Some("16.4")));
    }

    /// The two call sites, because routing them through one function is the
    /// claim and a test of the function alone does not check it.
    #[test]
    fn both_manifests_and_native_read_the_claim_as_a_floor() {
        let fragment = Manifest {
            targets: vec!["android-29".to_owned()],
            path: "manifests/android.xml".to_owned(),
        };
        assert!(fragment.covers("android-36", Some("29")), "the USE_BIOMETRIC fragment was dropped");
        assert!(!fragment.covers("android-36", Some("21")));

        let sources = NativeSources {
            dir: "native/android".to_owned(),
            targets: Some(vec!["android-29".to_owned()]),
            header: None,
        };
        assert!(sources.covers("android-36", Some("29")), "the Java half was dropped");
        assert!(!sources.covers("ios-18", Some("18.0")));

        // No claim is every target, which is the other half of `covers` and is
        // untouched by any of this.
        let everywhere =
            NativeSources { dir: "native".to_owned(), targets: None, header: None };
        assert!(everywhere.covers("windows", None));
    }
}
