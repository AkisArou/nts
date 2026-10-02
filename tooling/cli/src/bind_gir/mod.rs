//! `nts bind-gir`: TypeScript bindings from `GObject` introspection data.
//!
//! GIR records what a header cannot -- who owns a returned object, which
//! pointer may be null, which parameter carries a callback's `user_data` and
//! when that callback is called -- so a binding generated from it can say
//! more than one generated from the header alone, and `bind-c` is not asked
//! to guess. The pipeline is five steps, one file each:
//!
//! - [`parse`] reads the XML into [`model`], deciding nothing;
//! - [`facts`] asks the headers which struct each C type name is, and which
//!   enums C made signed;
//! - [`map`] makes every decision, each type in two spellings, TypeScript
//!   and the compiler's `native::Type`;
//! - [`check`] compiles the C spelling of every declaration against the real
//!   headers and drops what they reject;
//! - [`emit`] writes what is left.
//!
//! One namespace's closure at a time: binding `Gtk-4.0` binds `Gdk`, `Gio`,
//! `GObject` and everything else it names, because a declaration that names
//! `GdkDisplay` needs a module that declares it.

mod check;
mod emit;
mod map;
mod model;
mod naming;
mod parse;
mod facts;
mod prerequisites;

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use camino::Utf8PathBuf;

/// What `nts bind-gir` was asked for.
pub(crate) struct Request {
    /// `Name-Version`, as in `Gtk-4.0`.
    pub root: String,
    pub search: Vec<Utf8PathBuf>,
    pub out: Utf8PathBuf,
}

/// The GIR files `root`'s closure is read from (`parse::closure_files`).
pub(crate) fn closure_files(root: &str, search: &[Utf8PathBuf]) -> Result<Vec<Utf8PathBuf>> {
    parse::closure_files(root, search)
}

/// The namespaces of `root`'s closure (`parse::closure`), cairo included.
pub(crate) fn closure_namespaces(root: &str, search: &[Utf8PathBuf]) -> Vec<String> {
    parse::closure(root, search).map(|(_, namespaces)| namespaces).unwrap_or_default()
}

/// Where GIR files are looked for, in order: `GI_GIR_PATH` (colon-separated,
/// the variable `GObject` introspection's own tools read), then `gir-1.0` under
/// each of `XDG_DATA_DIRS`, then where distributions install them.
pub(crate) fn search_path() -> Vec<Utf8PathBuf> {
    let mut search: Vec<Utf8PathBuf> = Vec::new();
    let mut add = |dir: Utf8PathBuf| {
        if !search.contains(&dir) {
            search.push(dir);
        }
    };
    if let Ok(dirs) = std::env::var("GI_GIR_PATH") {
        dirs.split(':').filter(|d| !d.is_empty()).for_each(|d| add(Utf8PathBuf::from(d)));
    }
    if let Ok(dirs) = std::env::var("XDG_DATA_DIRS") {
        dirs.split(':').filter(|d| !d.is_empty()).for_each(|d| add(Utf8PathBuf::from(d).join("gir-1.0")));
    }
    for dir in ["/usr/share/gir-1.0", "/usr/local/share/gir-1.0"] {
        add(Utf8PathBuf::from(dir));
    }
    search
}

/// The namespace a `c:` or `gi:` module names, when it names one this machine
/// has GIR for: `c:Gtk-4.0` is `Gtk-4.0`, and `gi:gtk` the newest `Gtk-*.gir`
/// installed. A `c:` module naming a header binding (`c:sys/stat`) is not one,
/// and is left to `bind-c`.
pub(crate) fn namespace_of(module: &str, search: &[Utf8PathBuf]) -> Option<String> {
    if let Some(name) = module.strip_prefix("gi:") {
        return newest(name, None, search);
    }
    let spec = module.strip_prefix("c:")?;
    let (name, version) = spec.split_once('-')?;
    let plausible = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric())
        && version.chars().all(|c| c.is_ascii_digit() || c == '.');
    // cairo is the binder's own (`parse::CAIRO`), shipped or not.
    let known = spec == "cairo-1.0" || search.iter().any(|dir| dir.join(format!("{spec}.gir")).exists());
    (plausible && known).then(|| spec.to_owned())
}

/// The namespace `gi:` names in lowercase (`gtk`), among the GIR files of
/// `search`: at `pinned`, the version `nts.config.ts` gives it, or else the
/// newest -- `Gtk-4.0` where `Gtk-3.0` is installed beside it.
pub(crate) fn newest(name: &str, pinned: Option<&str>, search: &[Utf8PathBuf]) -> Option<String> {
    if name == "cairo" {
        return Some("cairo-1.0".to_owned());
    }
    let version = |text: &str| text.split('.').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>().ok();
    let mut found: Vec<(Vec<u32>, String)> = search
        .iter()
        .flat_map(|dir| std::fs::read_dir(dir).into_iter().flatten().flatten())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter_map(|file| {
            let stem = file.strip_suffix(".gir")?;
            let (namespace, at) = stem.split_once('-')?;
            let wanted = namespace.to_ascii_lowercase() == name && pinned.is_none_or(|pinned| pinned == at);
            wanted.then(|| Some((version(at)?, stem.to_owned())))?
        })
        .collect();
    found.sort();
    found.pop().map(|(_, stem)| stem)
}

/// Bind `request.root` and its closure into `request.out`.
pub(crate) fn run(request: &Request) -> Result<()> {
    bind(&request.root, &request.search, &request.out, true).map(|_| ())
}

/// What one namespace's headers say: one clang run over them.
/// `GLib`'s fundamental types, GJS's `GObject.TYPE_*`: macros, which GIR does
/// not list, each valued by the headers (`facts::Facts::macros`) and
/// declared as a `GType` constant of `GObject`'s module (`map::constants`).
pub(crate) const FUNDAMENTAL_TYPES: &[&str] = &[
    "G_TYPE_NONE",
    "G_TYPE_INTERFACE",
    "G_TYPE_CHAR",
    "G_TYPE_UCHAR",
    "G_TYPE_BOOLEAN",
    "G_TYPE_INT",
    "G_TYPE_UINT",
    "G_TYPE_LONG",
    "G_TYPE_ULONG",
    "G_TYPE_INT64",
    "G_TYPE_UINT64",
    "G_TYPE_ENUM",
    "G_TYPE_FLAGS",
    "G_TYPE_FLOAT",
    "G_TYPE_DOUBLE",
    "G_TYPE_STRING",
    "G_TYPE_POINTER",
    "G_TYPE_BOXED",
    "G_TYPE_PARAM",
    "G_TYPE_OBJECT",
    "G_TYPE_VARIANT",
];

fn namespace_facts(repository: &model::Repository, namespace: &model::Namespace) -> Result<facts::Facts> {
    let structs: Vec<&str> = namespace
        .classes
        .iter()
        .filter_map(|c| c.c_type.as_deref())
        .chain(
            namespace.records.iter().filter(|r| !r.class_struct).filter_map(|r| r.c_type.as_deref()),
        )
        .collect();
    let enums: Vec<&str> = namespace.enums.iter().filter_map(|e| e.c_type.as_deref()).collect();
    let slots = vfunc_slots(namespace);
    // Each boxed record, for its size.
    let sized: Vec<&str> = namespace
        .records
        .iter()
        .filter(|r| r.get_type.is_some() && !r.class_struct)
        .filter_map(|r| r.c_type.as_deref())
        .collect();
    // And each boxed record's `get_type`, for whether the
    // namespace's own headers declare it.
    let functions: Vec<&str> = namespace
        .records
        .iter()
        .filter(|r| !r.class_struct)
        .filter_map(|r| r.get_type.as_deref())
        .filter(|name| *name != "intern")
        .collect();
    let macros: &[&str] = if namespace.name == "GObject" { FUNDAMENTAL_TYPES } else { &[] };
    let flags = pkg_config(repository, namespace, "--cflags");
    let asked = facts::Asked { structs: &structs, enums: &enums, slots: &slots, sized: &sized, functions: &functions, macros };
    let mut facts = facts::resolve(&namespace.headers, &asked, &flags)?;
    // The interfaces GIR gives no prerequisite, which the
    // type system is asked about instead.
    let interfaces: Vec<(&str, &str)> = namespace
        .classes
        .iter()
        .filter(|c| c.interface && c.parent.is_none())
        .filter_map(|c| Some((c.c_type.as_deref()?, c.get_type.as_deref()?)))
        .collect();
    let libs = pkg_config(repository, namespace, "--libs");
    facts.prerequisites = prerequisites::resolve(&namespace.headers, &interfaces, &flags, &libs);
    Ok(facts)
}

/// One namespace's generated texts: its declarations, the companion module,
/// the refusals and the Promise census, and how many functions it bound.
pub(crate) struct Generated {
    /// `Gtk-4.0`: the namespace and its version.
    pub(crate) stem: String,
    pub(crate) declarations: String,
    /// The same declarations on the `gi:` surface (`naming`): `gi:gtk`.
    pub(crate) gi: String,
    pub(crate) values: String,
    pub(crate) refused: String,
    pub(crate) promises: String,
    pub(crate) bound: usize,
    /// Each refusal's kind, for the ranking.
    pub(crate) refusals: Vec<String>,
    /// Async methods, and how many have a Promise form.
    pub(crate) asyncs: usize,
    pub(crate) promised: usize,
}

/// The closure of `root`, bound: each namespace's texts, the GIR files read,
/// and the namespaces no GIR file was found for. Nothing is written.
pub(crate) fn generate(root: &str, search: &[Utf8PathBuf]) -> Result<(Vec<Generated>, Vec<Utf8PathBuf>, Vec<String>)> {
    let repository = parse::repository(root, search)?;
    let command = format!("nts bind-gir {root}");
    // Every struct tag first, because a namespace's signatures name the types
    // of the namespaces it includes. Each namespace is one clang run that
    // parses its headers, independent of the others, so they run at once.
    let namespaces: Vec<&model::Namespace> = repository.namespaces.values().collect();
    let facts: facts::Facts = std::thread::scope(|scope| {
        let runs: Vec<_> = namespaces
            .iter()
            .map(|namespace| {
                let repository = &repository;
                scope.spawn(move || namespace_facts(repository, namespace))
            })
            .collect();
        let mut all = facts::Facts::default();
        for run in runs {
            let one = run.join().map_err(|_| anyhow::anyhow!("a thread reading the headers panicked"))??;
            all.merge(one);
        }
        Ok::<_, anyhow::Error>(all)
    })?;
    // Then each namespace's binding, checked, again at once.
    let bindings: Vec<map::Binding> = std::thread::scope(|scope| {
        let runs: Vec<_> = namespaces
            .iter()
            .map(|namespace| {
                let (repository, facts) = (&repository, &facts);
                scope.spawn(move || {
                    let mut binding = map::bind(repository, namespace, facts);
                    check::against_headers(&mut binding, &pkg_config(repository, namespace, "--cflags"))?;
                    Ok::<_, anyhow::Error>(binding)
                })
            })
            .collect();
        runs.into_iter()
            .map(|run| run.join().map_err(|_| anyhow::anyhow!("a binding thread panicked"))?)
            .collect::<Result<Vec<_>>>()
    })?;
    let names = naming::Names::of(&repository);
    let generated = namespaces
        .iter()
        .zip(&bindings)
        .map(|(namespace, binding)| {
            let census = emit::promise_census(binding);
            Generated {
                stem: format!("{}-{}", namespace.name, namespace.version),
                declarations: emit::declarations(binding, &command),
                gi: emit::declarations(&naming::gi(binding, namespace, &names), &command),
                values: emit::companion(binding, &command),
                refused: report(binding),
                promises: promises_report(&census),
                bound: binding.functions.len(),
                refusals: binding.refused.iter().map(|(_, reason)| reason.kind()).collect(),
                asyncs: census.len(),
                promised: census.iter().filter(|(_, outcome)| *outcome == "promise").count(),
            }
        })
        .collect();
    Ok((generated, repository.files, repository.missing.iter().cloned().collect()))
}

/// Bind `root` and its closure into `out`, returning the GIR files read. The
/// summary is printed in full when asked for, and in one line otherwise.
fn bind(root: &str, search: &[Utf8PathBuf], out: &Utf8PathBuf, verbose: bool) -> Result<Vec<Utf8PathBuf>> {
    let (generated, files, missing) = generate(root, search)?;
    if verbose {
        for missing in &missing {
            println!("  {missing}: no GIR file found, so its types are unknown here");
        }
    }
    std::fs::create_dir_all(out).with_context(|| format!("creating {out}"))?;
    let mut totals: BTreeMap<String, usize> = BTreeMap::new();
    let (mut bound, mut refused) = (0, 0);
    let (mut asyncs, mut promised) = (0, 0);
    for namespace in &generated {
        write_namespace(out, namespace)?;
        asyncs += namespace.asyncs;
        promised += namespace.promised;
        if verbose {
            println!("  {:<16} {:>5} bound, {:>5} refused", namespace.stem, namespace.bound, namespace.refusals.len());
        }
        bound += namespace.bound;
        refused += namespace.refusals.len();
        for kind in &namespace.refusals {
            *totals.entry(kind.clone()).or_default() += 1;
        }
    }
    if !verbose {
        println!(
            "  bound {root}: {bound} function(s), {refused} refused (see *.refused.txt), {promised} of {asyncs} async method(s) with a Promise form (see *.promises.txt) into {out}"
        );
        return Ok(files);
    }
    println!("{bound} function(s) bound, {refused} refused, into {out}");
    println!("{promised} of {asyncs} async method(s) have a Promise form");
    print_ranking(totals);
    Ok(files)
}

/// The refusals by kind, most first: what to build next.
fn print_ranking(totals: BTreeMap<String, usize>) {
    let mut ranked: Vec<_> = totals.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    for (kind, count) in ranked {
        println!("  {count:>5}  {kind}");
    }
}

/// What pkg-config says for `namespace` -- `--cflags` for its headers,
/// `--libs` for a program using them: its packages and every included
/// namespace's, since a header includes the headers it depends on.
///
/// A package pkg-config does not know is skipped rather than fatal. GIR names
/// the package its scanner ran against, which is not always one this machine
/// has a `.pc` for under that name; if the headers then fail to compile, the
/// self-check says so with clang's own message.
fn pkg_config(repository: &model::Repository, namespace: &model::Namespace, what: &str) -> Vec<String> {
    let mut packages: Vec<String> = Vec::new();
    let mut pending = vec![namespace];
    let mut seen = std::collections::BTreeSet::new();
    while let Some(ns) = pending.pop() {
        if !seen.insert(ns.name.clone()) {
            continue;
        }
        packages.extend(ns.packages.iter().cloned());
        pending.extend(ns.includes.iter().filter_map(|(name, _)| repository.namespaces.get(name)));
    }
    let mut flags = Vec::new();
    for package in packages {
        for flag in pkg_config_of(what, &package) {
            if !flags.contains(&flag) {
                flags.push(flag);
            }
        }
    }
    flags
}

/// `pkg-config <what> <package>`, asked once per process: every namespace
/// that includes `GLib` asks for its flags, and each answer is a process.
fn pkg_config_of(what: &str, package: &str) -> Vec<String> {
    type Answers = BTreeMap<(String, String), Vec<String>>;
    static ASKED: std::sync::OnceLock<std::sync::Mutex<Answers>> = std::sync::OnceLock::new();
    let asked = ASKED.get_or_init(Default::default);
    let key = (what.to_owned(), package.to_owned());
    if let Some(flags) = asked.lock().ok().and_then(|asked| asked.get(&key).cloned()) {
        return flags;
    }
    let flags: Vec<String> = std::process::Command::new("pkg-config")
        .args([what, package])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).split_whitespace().map(str::to_owned).collect())
        .unwrap_or_default();
    if let Ok(mut asked) = asked.lock() {
        asked.insert(key, flags.clone());
    }
    flags
}

/// One namespace's files -- the declarations, the companion module, the
/// refusals and the Promise census.
fn write_namespace(out: &Utf8PathBuf, namespace: &Generated) -> Result<()> {
    let stem = &namespace.stem;
    write(&out.join(format!("{stem}.d.ts")), &namespace.declarations)?;
    write(&out.join(format!("{stem}.gi.d.ts")), &namespace.gi)?;
    // Not `{stem}.ts`: TypeScript reads a `.d.ts` beside a `.ts` of the same
    // stem as that file's own output and drops it, and every `c:` import of
    // the module then fails to resolve.
    write(&out.join(format!("{stem}.values.ts")), &namespace.values)?;
    write(&out.join(format!("{stem}.refused.txt")), &namespace.refused)?;
    write(&out.join(format!("{stem}.promises.txt")), &namespace.promises)
}

/// Every async method and its Promise form or why it has none, one per line.
fn promises_report(census: &[(String, &'static str)]) -> String {
    if census.is_empty() {
        return String::new();
    }
    let mut lines: Vec<String> = census.iter().map(|(name, outcome)| format!("{name}\t{outcome}")).collect();
    lines.sort();
    lines.join("\n") + "\n"
}

/// Every refused function and why, one per line -- with a third column,
/// `deprecated`, where GIR marks it so: the queue, as a file.
fn report(binding: &map::Binding) -> String {
    let mut lines: Vec<String> = binding
        .refused
        .iter()
        .map(|(name, reason)| {
            let deprecated = if binding.deprecated.contains(name) { "\tdeprecated" } else { "" };
            format!("{name}\t{reason}{deprecated}")
        })
        .collect();
    lines.sort();
    lines.join("\n") + "\n"
}

fn write(path: &camino::Utf8Path, text: &str) -> Result<()> {
    std::fs::write(path, text).with_context(|| format!("writing {path}"))
}

/// Each virtual function's slot in a namespace, by its class struct's C type
/// and member, for the headers to be asked where it is (`facts::resolve`).
fn vfunc_slots(namespace: &model::Namespace) -> Vec<(String, String)> {
    namespace
        .classes
        .iter()
        .filter_map(|class| {
            let record = namespace.records.iter().find(|r| Some(&r.name) == class.type_struct.as_ref())?;
            Some((record.c_type.clone()?, class))
        })
        .flat_map(|(class_struct, class)| class.vfuncs.iter().map(move |v| (class_struct.clone(), v.name.clone())))
        .collect()
}
