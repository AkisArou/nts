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
pub(crate) mod emit;
mod facts;
mod iid;
pub(crate) mod map;
mod read;
mod resource_params;
pub(crate) mod winrt;

use anyhow::{Context, Result};
use camino::{Utf8Path, Utf8PathBuf};

/// The metadata this binder is written against.
///
/// **A `-preview` on purpose.** Microsoft publishes
/// `Microsoft.Windows.SDK.Win32Metadata` only as previews -- there is no
/// release to move to -- and windows-rs pins a preview too. A reader tempted
/// to "fix" this to a stable version will find none.
pub(crate) const WIN32_METADATA_VERSION: &str = "71.0.26-preview";

/// What `nts bind-winmd` was asked for.
#[derive(Clone)]
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
    // Windows Runtime namespaces are read straight off their own metadata;
    // Win32 ones are checked against the headers too.
    let (winrt, win32): (Vec<String>, Vec<String>) = request
        .namespaces
        .iter()
        .cloned()
        .partition(|namespace| winrt::is_winrt(namespace));
    if !winrt.is_empty() {
        for line in winrt::write(&winrt, &winrt::default_metadata(), &request.out, &command)? {
            println!("{line}");
        }
    }
    if !win32.is_empty() {
        for line in bind(
            &Request {
                namespaces: win32,
                ..request.clone()
            },
            &command,
        )? {
            println!("{line}");
        }
    }
    Ok(())
}

/// The namespace a `c:` module names, when it is a Win32 metadata one.
pub(crate) fn namespace_of(module: &str) -> Option<String> {
    let namespace = module.strip_prefix("c:")?;
    namespace
        .starts_with("Windows.Win32.")
        .then(|| namespace.to_owned())
}

/// Bind `request.namespaces` into `request.out`, answering one line per module.
fn bind(request: &Request, command: &str) -> Result<Vec<String>> {
    let (bindings, owners) = generate(&request.namespaces, &request.winmd, &request.arch)?;
    std::fs::create_dir_all(&request.out).with_context(|| format!("creating {}", request.out))?;
    for binding in &bindings {
        emit::write(binding, &request.out, command, &owners)?;
    }
    Ok(bindings.iter().map(summary).collect())
}

/// The headers the probe asks for: `<windows.h>`, which leaves out whole
/// subsystems (`shlobj.h` for the Shell), plus the header each function's or
/// COM method's documentation page names. The page names the SDK's split header
/// (`shlobj_core.h`); mingw may carry only the unsplit one
/// (`shlobj.h`), so each entry is the alternatives for one header, and
/// the probe asks clang which it has (`__has_include`) rather than
/// reproducing any toolchain's include layout here.
fn probe_headers(model: &read::Model) -> Vec<Vec<String>> {
    let mut headers: Vec<Vec<String>> = vec![vec!["windows.h".to_owned()]];
    let mut seen: std::collections::BTreeSet<String> =
        ["windows.h".to_owned()].into_iter().collect();
    let methods = model
        .types
        .values()
        .filter_map(|info| match &info.kind {
            read::Kind::Interface(interface) => Some(&interface.methods),
            _ => None,
        })
        .flatten();
    let pages = model
        .functions
        .iter()
        .map(|function| function.documentation.as_deref())
        .chain(methods.map(|method| method.documentation.as_deref()));
    for page in pages {
        let Some(header) = emit::header_of(page) else {
            continue;
        };
        if !seen.insert(header.clone()) {
            continue;
        }
        let mut group = vec![header.clone()];
        if let Some(stem) = header.strip_suffix("_core.h") {
            group.push(format!("{stem}.h"));
        }
        headers.push(group);
    }
    headers
}

/// One binding's summary line.
fn summary(binding: &map::Binding) -> String {
    format!(
        "{}: {} functions, {} types, {} constants; {} refused (see {}.refused.txt)",
        binding.module,
        binding.functions.len(),
        binding.types.len(),
        binding.constants.len(),
        binding.refused.len(),
        binding.namespace
    )
}

/// Win32 `namespaces` bound from `winmd` and checked against the headers for
/// `arch`, in memory, and which namespace declares each name -- what the
/// modules import from each other (`emit::render`).
pub(crate) fn generate(
    namespaces: &[String],
    winmd: &Utf8Path,
    arch: &str,
) -> Result<(
    Vec<map::Binding>,
    std::collections::BTreeMap<String, String>,
)> {
    let index = windows_metadata::reader::Index::read(winmd)
        .with_context(|| format!("reading {winmd}: fetch it with tooling/windows/fetch-win32metadata.sh, or pass --winmd"))?
        .leak();
    let model = read::read(index, namespaces);
    let resources = resource_params::Policy::embedded()?;
    resources.validate(&model, namespaces)?;
    let zig = crate::zig_lib_dir()
        .context("`zig env` did not answer; the Windows headers come from zig")?;
    let clang_args = crate::windows_compile_flags(arch, &zig);
    let headers = probe_headers(&model);
    let facts = map::ask(&model, &headers, &clang_args)?;
    let mut bindings = map::bindings(&model, &facts, &resources);
    check::against_headers(&mut bindings, &headers, &clang_args)?;
    let owners = bindings
        .iter()
        .flat_map(|binding| {
            binding
                .types
                .iter()
                .map(|decl| (decl.name().to_owned(), binding.namespace.clone()))
        })
        .collect();
    Ok((bindings, owners))
}

#[cfg(test)]
mod tests {
    use super::probe_headers;
    use super::read::{Interface, Kind, Method, Model, TypeInfo};

    #[test]
    fn method_documentation_reaches_headers_without_a_free_function() {
        let method = |name: &str, header: &str| Method {
            name: name.to_owned(),
            parameters: Vec::new(),
            result: windows_metadata::Type::Void,
            documentation: Some(format!(
                "https://learn.microsoft.com/windows/win32/api/{header}/nf-{header}-{name}"
            )),
            attributes: std::collections::BTreeMap::new(),
        };
        let model = Model {
            types: [(
                ("Windows.Win32.FactsTest".to_owned(), "ITest".to_owned()),
                TypeInfo {
                    kind: Kind::Interface(Interface {
                        iid: None,
                        parent: None,
                        methods: vec![
                            method("First", "shell_core"),
                            method("Second", "shell_core"),
                            method("Third", "other"),
                        ],
                    }),
                },
            )]
            .into(),
            ..Model::default()
        };
        assert_eq!(
            probe_headers(&model),
            vec![
                vec!["windows.h"],
                vec!["shell_core.h", "shell.h"],
                vec!["other.h"],
            ]
        );
    }
    #[test]
    fn real_header_record_layouts_cover_packed_and_unrepresentable_records() {
        let winmd = super::default_winmd();
        let Some(zig) = crate::zig_lib_dir().filter(|_| winmd.is_file()) else {
            eprintln!("skipping: needs zig and Win32 metadata");
            return;
        };
        let index = windows_metadata::reader::Index::read(&winmd)
            .expect("metadata")
            .leak();
        let model = super::read::read(
            index,
            &[
                "Windows.Win32.UI.Shell".into(),
                "Windows.Win32.UI.WindowsAndMessaging".into(),
            ],
        );
        for arch in ["x86_64", "aarch64"] {
            let facts = super::map::ask(
                &model,
                &super::probe_headers(&model),
                &crate::windows_compile_flags(arch, &zig),
            )
            .expect("header facts");
            for (record, size, align, natural_size, natural_align, packed) in [
                ("AUTO_SCROLL_DATA", 48, 1, 48, 4, true),
                ("SHChangeNotifyEntry", 12, 1, 16, 8, true),
                ("SHITEMID", 3, 1, 4, 2, true),
                ("ITEMIDLIST", 3, 1, 3, 1, true),
                ("DLGTEMPLATE", 18, 2, 20, 4, false),
            ] {
                let layout = &facts.records[record];
                eprintln!("{arch} {record}: {layout:?}");
                assert_eq!(
                    (
                        layout.size,
                        layout.align,
                        layout.natural_size,
                        layout.natural_align,
                        layout.packed_matches
                    ),
                    (size, align, natural_size, natural_align, packed),
                    "{arch} {record}"
                );
            }
        }
    }
}
