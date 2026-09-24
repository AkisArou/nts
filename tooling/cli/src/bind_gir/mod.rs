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
mod parse;
mod facts;
mod prerequisites;

use std::collections::BTreeMap;
use std::fmt::Write;

use anyhow::{Context, Result};
use camino::Utf8PathBuf;

/// What `nts bind-gir` was asked for.
pub(crate) struct Request {
    /// `Name-Version`, as in `Gtk-4.0`.
    pub root: String,
    pub search: Vec<Utf8PathBuf>,
    pub out: Utf8PathBuf,
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

/// The namespace a `c:` module names, when it names one this machine has GIR
/// for: `c:Gtk-4.0` is `Gtk-4.0`. A `c:` module naming a header binding
/// (`c:sys/stat`) is not one, and is left to `bind-c`.
pub(crate) fn namespace_of(module: &str, search: &[Utf8PathBuf]) -> Option<String> {
    let spec = module.strip_prefix("c:")?;
    let (name, version) = spec.split_once('-')?;
    let plausible = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric())
        && version.chars().all(|c| c.is_ascii_digit() || c == '.');
    (plausible && search.iter().any(|dir| dir.join(format!("{spec}.gir")).exists())).then(|| spec.to_owned())
}

/// Bind `roots` into `out` unless the bindings there are already of these
/// GIR files, read by this `nts`.
///
/// **The stamp is what the bindings depend on, and nothing coarser.** It lists
/// the executable and every GIR file the last run read, with each one's
/// modification time and size, and the executable must be the one running. A system update that changes `GLib-2.0.gir`
/// without touching `Gtk-4.0.gir` still regenerates, and a build that changes
/// nothing costs one `stat` per file. `roots` are added to those the stamp
/// already names, so a program that stops importing a namespace does not make
/// the next build regenerate without it.
pub(crate) fn ensure(roots: &std::collections::BTreeSet<String>, search: &[Utf8PathBuf], out: &Utf8PathBuf) -> Result<()> {
    let stamp_path = out.join(".nts-stamp");
    let previous = std::fs::read_to_string(&stamp_path).unwrap_or_default();
    let mut wanted: std::collections::BTreeSet<String> =
        previous.lines().filter_map(|line| line.strip_prefix("root ")).map(str::to_owned).collect();
    let before = wanted.len();
    wanted.extend(roots.iter().cloned());
    let exe = std::env::current_exe().ok().and_then(|p| Utf8PathBuf::from_path_buf(p).ok());
    // The `nts` running now must be the one that wrote them. Checking only
    // that each file the stamp names is unchanged let a *different* `nts` --
    // a newer binder -- reuse bindings an older one wrote, since the older
    // binary had not changed either.
    let this_nts = exe
        .as_deref()
        .and_then(|exe| Some(format!("file {exe} {}", fingerprint(exe)?)))
        .is_some_and(|line| previous.lines().any(|seen| seen == line));
    let fresh = wanted.len() == before
        && this_nts
        && !previous.is_empty()
        && previous.lines().all(|line| match line.split_once(' ') {
            Some(("root", _)) => true,
            Some(("file", rest)) => rest.rsplit_once(' ').is_some_and(|(path, seen)| {
                fingerprint(camino::Utf8Path::new(path)).as_deref() == Some(seen)
            }),
            _ => false,
        });
    if fresh {
        return Ok(());
    }
    let mut stamp = String::new();
    let mut files: Vec<Utf8PathBuf> = Vec::new();
    // Largest closures first, and a root another root's closure already
    // bound is not bound again: `Gtk-4.0` brings `GLib-2.0` with it, and a
    // program importing both would otherwise pay for GLib twice.
    let mut order: Vec<&String> = wanted.iter().collect();
    order.sort_by_key(|root| std::cmp::Reverse(closure_size(root, search)));
    for root in order {
        let _ = writeln!(stamp, "root {root}");
        let already = files.iter().any(|file| file.file_name() == Some(&format!("{root}.gir")));
        if !already {
            files.extend(bind(root, search, out, false)?);
        }
    }
    files.extend(exe);
    files.sort();
    files.dedup();
    for file in files {
        if let Some(seen) = fingerprint(&file) {
            let _ = writeln!(stamp, "file {file} {seen}");
        }
    }
    write(&stamp_path, &stamp)
}

/// How many namespaces `root` includes, transitively: a cheap read of the
/// `<include>` lines, used only to order roots.
fn closure_size(root: &str, search: &[Utf8PathBuf]) -> usize {
    parse::repository(root, search).map_or(0, |repository| repository.namespaces.len())
}

/// Modification time and size: what changes when a file is replaced.
fn fingerprint(path: &camino::Utf8Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(format!("{}.{:09}:{}", modified.as_secs(), modified.subsec_nanos(), metadata.len()))
}

/// Bind `request.root` and its closure into `request.out`.
pub(crate) fn run(request: &Request) -> Result<()> {
    bind(&request.root, &request.search, &request.out, true).map(|_| ())
}

/// Bind `root` and its closure into `out`, returning the GIR files read. The
/// summary is printed in full when asked for, and in one line otherwise.
fn bind(root: &str, search: &[Utf8PathBuf], out: &Utf8PathBuf, verbose: bool) -> Result<Vec<Utf8PathBuf>> {
    let request = Request { root: root.to_owned(), search: search.to_vec(), out: out.clone() };
    let repository = parse::repository(&request.root, &request.search)?;
    if verbose {
        for missing in &repository.missing {
            println!("  {missing}: no GIR file found, so its types are unknown here");
        }
    }
    std::fs::create_dir_all(&request.out).with_context(|| format!("creating {}", request.out))?;
    let command = format!("nts bind-gir {}", request.root);
    let mut totals: BTreeMap<String, usize> = BTreeMap::new();
    let (mut bound, mut refused) = (0, 0);
    let (mut asyncs, mut promised) = (0, 0);
    // Every struct tag first, because a namespace's signatures name the types
    // of the namespaces it includes. Each namespace is one clang run that
    // parses its headers, independent of the others, so they run at once.
    let namespaces: Vec<&model::Namespace> = repository.namespaces.values().collect();
    let facts: facts::Facts = std::thread::scope(|scope| {
        let runs: Vec<_> = namespaces
            .iter()
            .map(|namespace| {
                let repository = &repository;
                scope.spawn(move || {
                    let structs: Vec<&str> = namespace
                        .classes
                        .iter()
                        .filter_map(|c| c.c_type.as_deref())
                        .chain(
                            namespace.records.iter().filter(|r| !r.class_struct).filter_map(|r| r.c_type.as_deref()),
                        )
                        .collect();
                    let enums: Vec<&str> = namespace.enums.iter().filter_map(|e| e.c_type.as_deref()).collect();
                    let flags = pkg_config(repository, namespace, "--cflags");
                    let mut facts = facts::resolve(&namespace.headers, &structs, &enums, &flags)?;
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
                    Ok::<_, anyhow::Error>(facts)
                })
            })
            .collect();
        let mut all = facts::Facts::default();
        for run in runs {
            let one = run.join().map_err(|_| anyhow::anyhow!("a thread reading the headers panicked"))??;
            all.tags.extend(one.tags);
            all.signed.extend(one.signed);
            all.unsigned.extend(one.unsigned);
            all.prerequisites.extend(one.prerequisites);
        }
        Ok::<_, anyhow::Error>(all)
    })?;
    // Then each namespace's binding, checked and written, again at once.
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
    for (namespace, binding) in namespaces.iter().zip(&bindings) {
        let stem = format!("{}-{}", namespace.name, namespace.version);
        let (async_count, promise_count) = write_namespace(&request.out, &stem, binding, &command)?;
        asyncs += async_count;
        promised += promise_count;
        if verbose {
            println!(
                "  {:<16} {:>5} bound, {:>5} refused",
                stem,
                binding.functions.len(),
                binding.refused.len()
            );
        }
        bound += binding.functions.len();
        refused += binding.refused.len();
        for (_, reason) in &binding.refused {
            *totals.entry(reason.kind()).or_default() += 1;
        }
    }
    if !verbose {
        println!(
            "  bound {root}: {bound} function(s), {refused} refused (see *.refused.txt), {promised} of {asyncs} async method(s) with a Promise form (see *.promises.txt) into {}",
            request.out
        );
        return Ok(repository.files);
    }
    println!("{bound} function(s) bound, {refused} refused, into {}", request.out);
    println!("{promised} of {asyncs} async method(s) have a Promise form");
    print_ranking(totals);
    Ok(repository.files)
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
        let Ok(output) = std::process::Command::new("pkg-config").args([what, &package]).output() else {
            continue;
        };
        if output.status.success() {
            for flag in String::from_utf8_lossy(&output.stdout).split_whitespace() {
                if !flags.iter().any(|f| f == flag) {
                    flags.push(flag.to_owned());
                }
            }
        }
    }
    flags
}

/// One namespace's files -- the declarations, the companion module, the
/// refusals and the Promise census -- answering how many async methods it has
/// and how many of them have a Promise form.
fn write_namespace(out: &Utf8PathBuf, stem: &str, binding: &map::Binding, command: &str) -> Result<(usize, usize)> {
    write(&out.join(format!("{stem}.d.ts")), &emit::declarations(binding, command))?;
    // Not `{stem}.ts`: TypeScript reads a `.d.ts` beside a `.ts` of the same
    // stem as that file's own output and drops it, and every `c:` import of
    // the module then fails to resolve.
    write(&out.join(format!("{stem}.values.ts")), &emit::companion(binding, command))?;
    write(&out.join(format!("{stem}.refused.txt")), &report(binding))?;
    let census = emit::promise_census(binding);
    write(&out.join(format!("{stem}.promises.txt")), &promises_report(&census))?;
    let promised = census.iter().filter(|(_, outcome)| *outcome == "promise").count();
    Ok((census.len(), promised))
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

/// Every refused function and why, one per line: the queue, as a file.
fn report(binding: &map::Binding) -> String {
    let mut lines: Vec<String> =
        binding.refused.iter().map(|(name, reason)| format!("{name}\t{reason}")).collect();
    lines.sort();
    lines.join("\n") + "\n"
}

fn write(path: &camino::Utf8Path, text: &str) -> Result<()> {
    std::fs::write(path, text).with_context(|| format!("writing {path}"))
}
