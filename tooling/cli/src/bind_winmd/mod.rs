//! `nts bind-winmd`: TypeScript bindings from Windows metadata.
//!
//! `Windows.Win32.winmd` (ECMA-335, read with Microsoft's `windows-metadata`)
//! records what a header cannot: which parameter is optional, which pointer
//! the callee only reads, which DLL a function is imported from, what a
//! handle is. The headers record what the metadata cannot: that `LONG` is
//! `long` and `INT` is `int`, which the metadata writes as one `I32` and the
//! witness tells apart. So each declaration takes its meaning from the
//! metadata and its C type from the headers, the way `bind-gir` takes
//! ownership from GIR and types from `c:type`:
//!
//! - [`read`] reads the metadata into plain data, deciding nothing;
//! - [`facts`] asks clang for the C type of everything read;
//! - [`map`] decides each TypeScript spelling;
//! - [`check`] compiles the C spelling nts will emit against the headers and
//!   drops what they reject;
//! - [`emit`] writes one module per namespace.

mod check;
mod ctype;
mod emit;
mod facts;
mod map;
mod read;

use std::fmt::Write as _;

use anyhow::{Context, Result};
use camino::Utf8PathBuf;

/// The metadata this binder is written against.
///
/// **A `-preview` on purpose.** Microsoft publishes
/// `Microsoft.Windows.SDK.Win32Metadata` only as previews -- there is no
/// release to move to -- and windows-rs pins a preview too. A reader tempted
/// to "fix" this to a stable version will find none.
pub(crate) const WIN32_METADATA_VERSION: &str = "71.0.26-preview";

/// What `nts bind-winmd` was asked for.
pub(crate) struct Request {
    /// Metadata namespaces, as in `Windows.Win32.UI.WindowsAndMessaging`.
    pub(crate) namespaces: Vec<String>,
    pub(crate) winmd: Utf8PathBuf,
    pub(crate) out: Utf8PathBuf,
    /// `x86_64` or `aarch64`: which headers answer the C questions.
    pub(crate) arch: String,
}

/// Where `tooling/windows/fetch-win32metadata.sh` puts the metadata.
pub(crate) fn default_winmd() -> Utf8PathBuf {
    if let Ok(path) = std::env::var("NTS_WIN32_WINMD") {
        return Utf8PathBuf::from(path);
    }
    crate::windows_root()
        .join("metadata")
        .join(format!("win32-{WIN32_METADATA_VERSION}"))
        .join("Windows.Win32.winmd")
}

pub(crate) fn run(request: &Request) -> Result<()> {
    let command = format!("nts bind-winmd {}", request.namespaces.join(" "));
    for line in bind(request, &command)? {
        println!("{line}");
    }
    Ok(())
}

/// A program's `c:Windows.Win32.*` imports, bound into `out` unless the stamp
/// there says the same `nts` already bound them from the same metadata.
///
/// The `bind-gir` scheme: every namespace asked for, ever, is kept in the
/// stamp, so a second program sharing `types/winmd` does not drop the first's.
pub(crate) fn ensure(namespaces: &std::collections::BTreeSet<String>, out: &Utf8PathBuf) -> Result<()> {
    let winmd = default_winmd();
    let stamp_path = out.join(".nts-stamp");
    let previous = std::fs::read_to_string(&stamp_path).unwrap_or_default();
    let mut wanted: std::collections::BTreeSet<String> =
        previous.lines().filter_map(|line| line.strip_prefix("root ")).map(str::to_owned).collect();
    let before = wanted.len();
    wanted.extend(namespaces.iter().cloned());
    let exe = std::env::current_exe().ok().and_then(|p| Utf8PathBuf::from_path_buf(p).ok());
    let inputs: Vec<Utf8PathBuf> = exe.into_iter().chain([winmd.clone()]).collect();
    let fingerprints: Vec<String> = inputs
        .iter()
        .filter_map(|file| Some(format!("file {file} {}", crate::bind_gir::fingerprint(file)?)))
        .collect();
    let fresh = wanted.len() == before
        && !previous.is_empty()
        && fingerprints.iter().all(|line| previous.lines().any(|seen| seen == line));
    if fresh {
        return Ok(());
    }
    let request = Request { namespaces: wanted.iter().cloned().collect(), winmd, out: out.clone(), arch: "x86_64".into() };
    let command = format!("nts build (bind-winmd {})", request.namespaces.join(" "));
    for line in bind(&request, &command)? {
        println!("  {line}");
    }
    let mut stamp = String::new();
    for namespace in &wanted {
        let _ = writeln!(stamp, "root {namespace}");
    }
    for line in fingerprints {
        stamp.push_str(&line);
        stamp.push('\n');
    }
    std::fs::write(&stamp_path, stamp).with_context(|| format!("writing {stamp_path}"))
}

/// The namespace a `c:` module names, when it is a Win32 metadata one.
pub(crate) fn namespace_of(module: &str) -> Option<String> {
    let namespace = module.strip_prefix("c:")?;
    namespace.starts_with("Windows.Win32.").then(|| namespace.to_owned())
}

/// Bind `request.namespaces` into `request.out`, answering one line per module.
fn bind(request: &Request, command: &str) -> Result<Vec<String>> {
    let index = windows_metadata::reader::Index::read(&request.winmd)
        .with_context(|| {
            format!(
                "reading {}: fetch it with tooling/windows/fetch-win32metadata.sh, or pass --winmd",
                request.winmd
            )
        })?
        .leak();
    let model = read::read(index, &request.namespaces);
    let zig = crate::zig_lib_dir().context("`zig env` did not answer; the Windows headers come from zig")?;
    let clang_args = crate::windows_compile_flags(&request.arch, &zig);
    let headers = vec!["windows.h".to_owned()];
    let facts = map::ask(&model, &headers, &clang_args)?;
    let mut bindings = map::bindings(&model, &facts);
    check::against_headers(&mut bindings, &headers, &clang_args)?;
    std::fs::create_dir_all(&request.out).with_context(|| format!("creating {}", request.out))?;
    // Which namespace declares each name, for the imports between modules.
    let owners: std::collections::BTreeMap<String, String> = bindings
        .iter()
        .flat_map(|binding| binding.types.iter().map(|decl| (decl.name().to_owned(), binding.namespace.clone())))
        .collect();
    for binding in &bindings {
        emit::write(binding, &request.out, command, &owners)?;
    }
    Ok(bindings
        .iter()
        .map(|binding| {
            format!(
                "{}: {} functions, {} types, {} constants; {} refused (see {}.refused.txt)",
                binding.module,
                binding.functions.len(),
                binding.types.len(),
                binding.constants.len(),
                binding.refused.len(),
                binding.namespace
            )
        })
        .collect())
}
