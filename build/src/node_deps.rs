//! One embedded upstream build plan for every native runtime consumer.
mod cache;
mod compile;
mod invocation;
mod search;
mod source;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::OnceLock, time::Instant};

const RECIPE: &str = include_str!("../node-deps/recipes.json");
const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/node-deps.zlib"));
pub const SOURCE_BUNDLE: &str = env!("NTS_NODE_BUNDLE_SHA256");
pub const RAW_BYTES: &str = env!("NTS_NODE_BUNDLE_RAW_BYTES");
pub const COMPRESSED_BYTES: &str = env!("NTS_NODE_BUNDLE_COMPRESSED_BYTES");

#[derive(Debug, Deserialize)]
pub struct Bundle {
    pub node: String,
    pub source_sha256: String,
    pub files: BTreeMap<String, String>,
    pub versions: BTreeMap<String, String>,
    pub notices: BTreeMap<String, String>,
    pub plans: Vec<Recipe>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Recipe {
    pub target: String,
    pub object_format: ObjectFormat,
    pub policy: serde_json::Value,
    pub roots: BTreeMap<String, String>,
    pub public: BTreeMap<String, Settings>,
    pub targets: Vec<Target>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObjectFormat {
    Elf,
    Coff,
    Macho,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Target {
    pub name: String,
    pub sources: Vec<String>,
    pub dependencies: Vec<String>,
    pub includes: Vec<String>,
    pub defines: Vec<String>,
    pub cflags: Vec<String>,
    pub libraries: Vec<String>,
    pub ldflags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Settings {
    pub includes: Vec<String>,
    pub defines: Vec<String>,
    pub libraries: Vec<String>,
    pub ldflags: Vec<String>,
}

#[must_use]
pub fn bundle() -> &'static Bundle {
    static PARSED: OnceLock<Bundle> = OnceLock::new();
    PARSED.get_or_init(|| serde_json::from_str(RECIPE).expect("generated Node recipe"))
}

#[must_use]
pub fn recipe() -> &'static Recipe {
    recipe_for("x86_64-unknown-linux-gnu").expect("host dependency recipe")
}

pub fn recipe_for(target: &str) -> Result<&'static Recipe> {
    bundle()
        .plans
        .iter()
        .find(|plan| plan.target == target)
        .with_context(|| format!("bundled Node dependencies have no verified plan for {target}"))
}

pub(super) fn hash(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut result = String::with_capacity(64);
    for byte in hmac_sha256::Hash::hash(bytes) {
        write!(result, "{byte:02x}").expect("writing digest");
    }
    result
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub target: String,
    /// Command words, never interpreted by a shell (for example `zig cc`).
    pub compiler: Vec<String>,
    pub archiver: Vec<String>,
    pub flags: Vec<String>,
    /// Public names: uv, openssl, zlib, brotli, zstd.
    pub libraries: Vec<String>,
    pub cache: PathBuf,
    pub jobs: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Artifacts {
    pub node: String,
    pub target: String,
    pub source_sha256: String,
    pub bundle_sha256: String,
    pub source_raw_bytes: u64,
    pub source_compressed_bytes: u64,
    pub include_flags: Vec<String>,
    pub link_flags: Vec<String>,
    pub archives: Vec<PathBuf>,
    pub notices: BTreeMap<String, PathBuf>,
    pub timings: Timings,
}

/// Diagnostic build phases, including the validation that a warm client pays.
#[derive(Debug, Serialize, Deserialize)]
pub struct Timings {
    pub source_validation_s: f64,
    pub toolchain_validation_s: f64,
    pub archives_s: f64,
}

/// Building requires only the selected compiler and archiver. Source is embedded.
pub fn ensure(request: &Request) -> Result<Artifacts> {
    let plan = recipe_for(&request.target)?;
    if request.compiler.is_empty() || request.archiver.is_empty() || request.jobs == 0 {
        bail!("Node dependency toolchain and worker count must be explicit");
    }
    let targets = closure(plan, &request.libraries)?;
    let start = Instant::now();
    let source = source::ensure(&request.cache)?;
    let source_validation_s = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let identity = invocation::Context::new(request, &source, plan)?;
    let toolchain_validation_s = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let mut archives = Vec::new();
    for target in targets.iter().rev() {
        archives.push(cache::ensure(request, &identity, &source, target)?);
    }
    archives.reverse();
    let mut include_flags = vec![format!("-I{}", source.display())];
    let mut link_flags = Vec::new();
    for name in &request.libraries {
        let settings = plan
            .public
            .get(name)
            .context("public dependency settings")?;
        include_flags.extend(
            settings
                .includes
                .iter()
                .map(|p| format!("-I{}", source.join(p).display())),
        );
        include_flags.extend(settings.defines.iter().map(|d| format!("-D{d}")));
        // Owned -l names in upstream descriptions become our archive closure.
        link_flags.extend(
            settings
                .libraries
                .iter()
                .filter(|f| !owned_library(f))
                .cloned(),
        );
        link_flags.extend(
            settings
                .ldflags
                .iter()
                .filter(|f| f.as_str() != "-rdynamic")
                .cloned(),
        );
    }
    for target in &targets {
        link_flags.extend(
            target
                .libraries
                .iter()
                .filter(|f| !owned_library(f))
                .cloned(),
        );
    }
    let grouped = plan.object_format == ObjectFormat::Elf;
    let mut ordered = Vec::new();
    if grouped {
        link_flags.insert(0, "-Wl,--exclude-libs,ALL".into());
        ordered.push("-Wl,--start-group".to_owned());
    }
    ordered.extend(archives.iter().map(|p| p.to_string_lossy().into_owned()));
    if grouped {
        ordered.push("-Wl,--end-group".into());
    }
    ordered.extend(link_flags);
    let components: Vec<String> = targets
        .iter()
        .map(|t| {
            plan.roots
                .get(&t.name)
                .cloned()
                .unwrap_or_else(|| "zlib".into())
        })
        .collect();
    Ok(Artifacts {
        node: bundle().node.clone(),
        target: request.target.clone(),
        source_sha256: bundle().source_sha256.clone(),
        bundle_sha256: SOURCE_BUNDLE.into(),
        source_raw_bytes: RAW_BYTES.parse()?,
        source_compressed_bytes: COMPRESSED_BYTES.parse()?,
        include_flags,
        link_flags: ordered,
        archives,
        notices: source::notices(&source, &components)?,
        timings: Timings {
            source_validation_s,
            toolchain_validation_s,
            archives_s: start.elapsed().as_secs_f64(),
        },
    })
}

#[must_use]
pub fn owned_library(flag: &str) -> bool {
    library_for(flag).is_some()
}

/// Recognize an owned library request, including a resolver's absolute path.
#[must_use]
pub fn library_for(flag: &str) -> Option<&'static str> {
    let filename = std::path::Path::new(flag.strip_prefix("-l:").unwrap_or(flag))
        .file_name()?
        .to_str()?;
    for (name, component) in [
        ("uv", "uv"),
        ("z", "zlib"),
        ("zlib", "zlib"),
        ("zlib1", "zlib"),
        ("zstd", "zstd"),
        ("crypto", "openssl"),
        ("ssl", "openssl"),
        ("openssl", "openssl"),
        ("brotli", "brotli"),
        ("brotlienc", "brotli"),
        ("brotlidec", "brotli"),
        ("brotlicommon", "brotli"),
    ] {
        if flag == format!("-l{name}") || library_filename(filename, name) {
            return Some(component);
        }
    }
    None
}

fn library_filename(filename: &str, name: &str) -> bool {
    let Some(suffix) = filename
        .strip_prefix("lib")
        .unwrap_or(filename)
        .strip_prefix(name)
    else {
        return false;
    };
    matches!(suffix, ".a" | ".so" | ".lib" | ".dll" | ".dll.a" | ".dylib")
        || suffix.strip_prefix(".so.").is_some_and(dotted_version)
        || suffix
            .strip_suffix(".dylib")
            .and_then(|value| value.strip_prefix('.'))
            .is_some_and(dotted_version)
        || matches!(name, "crypto" | "ssl" | "openssl") && openssl_windows_suffix(suffix)
}

fn dotted_version(value: &str) -> bool {
    value
        .split('.')
        .all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit()))
}

fn openssl_windows_suffix(suffix: &str) -> bool {
    let Some(version) = [".dll.a", ".dll", ".lib"]
        .iter()
        .find_map(|extension| suffix.strip_suffix(extension))
        .and_then(|value| value.strip_prefix('-'))
    else {
        return false;
    };
    let (version, architecture) = version
        .split_once('-')
        .map_or((version, None), |(v, a)| (v, Some(a)));
    version
        .split(['.', '_'])
        .all(|part| !part.is_empty() && part.bytes().all(|c| c.is_ascii_digit()))
        && architecture.is_none_or(|a| matches!(a, "x64" | "x86" | "arm64" | "x86_64" | "aarch64"))
}

/// Owned pkg-config names resolve to the same source closure without discovery.
#[must_use]
pub fn package_library(package: &str) -> Option<&'static str> {
    match package {
        "libuv" => Some("-luv"),
        "openssl" | "libssl" | "libcrypto" => Some("-lcrypto"),
        "zlib" => Some("-lz"),
        "libzstd" => Some("-lzstd"),
        "libbrotlicommon" | "libbrotlidec" | "libbrotlienc" => Some("-lbrotli"),
        _ => None,
    }
}

fn closure(plan: &'static Recipe, names: &[String]) -> Result<Vec<&'static Target>> {
    fn add(plan: &'static Recipe, name: &str, list: &mut Vec<&'static Target>) -> Result<()> {
        if list.iter().any(|t| t.name == name) {
            return Ok(());
        }
        let target = plan
            .targets
            .iter()
            .find(|t| t.name == name)
            .with_context(|| format!("unknown Node dependency {name}"))?;
        list.push(target);
        for dep in &target.dependencies {
            add(plan, dep, list)?;
        }
        Ok(())
    }
    let mut result = Vec::new();
    for name in names {
        let target = plan
            .roots
            .iter()
            .find(|(_, public)| *public == name)
            .map(|(target, _)| target)
            .with_context(|| format!("unknown Node library {name}"))?;
        add(plan, target, &mut result)?;
    }
    let mut ordered = Vec::new();
    while !result.is_empty() {
        let index = result
            .iter()
            .position(|target| {
                !result
                    .iter()
                    .any(|other| other.dependencies.contains(&target.name))
            })
            .context("cycle in Node archive graph")?;
        ordered.push(result.remove(index));
    }
    Ok(ordered)
}
