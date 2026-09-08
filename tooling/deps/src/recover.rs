//! Getting a package's TypeScript back out of what was installed.
//!
//! Two routes, in the order `docs/npm-deps.md` measured them worth trying:
//! the package shipped its sources, or the package shipped a source map that
//! embeds them. Both read files that are already on disk in `node_modules`.
//! Neither runs anything.

use camino::{Utf8Path, Utf8PathBuf};
use rustc_hash::FxHashMap;

use crate::manifest::EntryPoint;
use crate::resolve::{Installed, relative_import};

/// How a package's implementation was obtained, or why it was not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// The entry names a `.ts` file and the package shipped it.
    ShippedTypeScript,
    /// The entry is generated, and its source map embeds the original.
    SourceMap,
    /// A map was found and `sourcesContent` had holes in it. Half a module
    /// graph is not a package, so this is a refusal rather than a partial win.
    MapIncomplete { have: usize, want: usize },
    /// A map was found and its sources were JavaScript to begin with.
    MapOfJavaScript,
    /// A bundle's map named several sources and none of them is identifiably
    /// the entry. The files are real and were recovered; which one the
    /// specifier *means* is not knowable from the map, so it is not mapped.
    MapAmbiguous { sources: usize },
    /// Nothing was published but generated JavaScript.
    JavaScriptOnly,
    /// The entry the manifest names is not in the installed package.
    EntryMissing,
    /// The source was recovered and cannot be built: it imports something the
    /// package does not install. Almost always a `paths` alias from the
    /// package's own tsconfig, which is not published — `drizzle-orm` writes
    /// `~/entity.ts` throughout and ships no config defining `~`.
    SourceNeedsUnpublishedConfig { specifier: String },
}

impl Route {
    #[must_use]
    pub const fn recovered(&self) -> bool {
        matches!(self, Self::ShippedTypeScript | Self::SourceMap)
    }

    #[must_use]
    pub fn describe(&self) -> String {
        match self {
            Self::ShippedTypeScript => "shipped TypeScript".to_owned(),
            Self::SourceMap => "source map".to_owned(),
            Self::MapIncomplete { have, want } => {
                format!("source map has holes — {have} of {want} sources embedded")
            }
            Self::MapOfJavaScript => "source map, but its sources are JavaScript".to_owned(),
            Self::MapAmbiguous { sources } => format!(
                "source map bundles {sources} sources and names no entry among them"
            ),
            Self::JavaScriptOnly => "published JavaScript only".to_owned(),
            Self::EntryMissing => "the entry its package.json names is not installed".to_owned(),
            Self::SourceNeedsUnpublishedConfig { specifier } => format!(
                "its source imports `{specifier}`, which the package does not install — \
                 a path alias from a tsconfig it did not publish"
            ),
        }
    }
}

/// One recovered file: where it should be written, and what goes in it.
#[derive(Debug, Clone)]
pub struct RecoveredFile {
    /// Path relative to the package's vendor root.
    pub at: Utf8PathBuf,
    pub text: String,
}

/// What one specifier resolved to.
#[derive(Debug, Clone)]
pub struct RecoveredEntry {
    pub specifier: String,
    pub route: Route,
    /// Vendor-relative path of the file this specifier should resolve to.
    pub entry: Option<Utf8PathBuf>,
}

/// Everything recovered for one package.
#[derive(Debug, Clone, Default)]
pub struct Recovery {
    pub entries: Vec<RecoveredEntry>,
    pub files: Vec<RecoveredFile>,
}

impl Recovery {
    #[must_use]
    pub fn any_recovered(&self) -> bool {
        self.entries.iter().any(|entry| entry.route.recovered())
    }

    /// The best route across the package's specifiers, for a one-line report.
    #[must_use]
    pub fn headline(&self) -> Route {
        let rank = |route: &Route| match route {
            Route::ShippedTypeScript => 0,
            Route::SourceMap => 1,
            Route::MapIncomplete { .. } => 2,
            Route::MapAmbiguous { .. } => 3,
            Route::MapOfJavaScript => 4,
            Route::SourceNeedsUnpublishedConfig { .. } => 5,
            Route::JavaScriptOnly => 6,
            Route::EntryMissing => 7,
        };
        self.entries
            .iter()
            .map(|entry| entry.route.clone())
            .min_by_key(|route| rank(route))
            .unwrap_or(Route::EntryMissing)
    }
}

const TS_EXTENSIONS: [&str; 5] = [".ts", ".tsx", ".mts", ".cts", ".d.ts"];

fn is_declaration(path: &str) -> bool {
    path.ends_with(".d.ts") || path.ends_with(".d.mts") || path.ends_with(".d.cts")
}

fn is_typescript(path: &str) -> bool {
    TS_EXTENSIONS.iter().any(|ext| path.ends_with(ext)) && !is_declaration(path)
}

fn is_javascript(path: &str) -> bool {
    [".js", ".mjs", ".cjs", ".jsx"].iter().any(|ext| path.ends_with(ext))
}

/// Recover every specifier a package publishes.
#[must_use]
pub fn recover(installed: &Installed, entry_points: &[EntryPoint]) -> Recovery {
    let mut recovery = Recovery::default();
    let mut written: FxHashMap<Utf8PathBuf, String> = FxHashMap::default();
    let index = map_index(&installed.dir);

    for entry_point in entry_points {
        let (route, at) = recover_one(installed, entry_point, &index, &mut written);
        recovery.entries.push(RecoveredEntry {
            specifier: entry_point.specifier.clone(),
            route,
            entry: at,
        });
    }

    let mut files: Vec<RecoveredFile> = written
        .into_iter()
        .map(|(at, text)| RecoveredFile { at, text })
        .collect();
    files.sort_by(|a, b| a.at.cmp(&b.at));
    recovery.files = files;
    reject_unbuildable(installed, &mut recovery);
    recovery
}

/// The file a manifest target names.
///
/// `main` predates extensions being required, so `"./index"` and `"./lib"` are
/// ordinary and mean `index.js` and `lib/index.js`. Returned as the
/// package-relative path so the caller keeps working in one coordinate system.
fn entry_file(package_dir: &Utf8Path, target: &str) -> Option<String> {
    let direct = package_dir.join(target);
    if direct.is_file() {
        return Some(target.to_owned());
    }
    for extension in ["ts", "tsx", "mts", "cts", "js", "mjs", "cjs"] {
        let candidate = format!("{target}.{extension}");
        if package_dir.join(&candidate).is_file() {
            return Some(candidate);
        }
    }
    for leaf in ["index.ts", "index.mts", "index.js", "index.mjs", "index.cjs"] {
        let candidate = format!("{}/{leaf}", target.trim_end_matches('/'));
        if package_dir.join(&candidate).is_file() {
            return Some(candidate);
        }
    }
    None
}


/// Recover the specifiers a program actually imported, as the checker resolved
/// them.
///
/// The difference from [`recover`] is where the specifier list comes from. That
/// one enumerates what a manifest *offers* and has to rank `exports` conditions
/// to choose among them; this one takes what the program *used*, already
/// resolved, so subpath patterns and condition order are somebody else's
/// solved problem. What is left is the half resolution cannot answer: a
/// checker resolves to declarations, and declarations have no bodies.
#[must_use]
pub fn recover_resolved(
    installed: &Installed,
    resolved: &[(String, Utf8PathBuf)],
) -> Recovery {
    let offered = installed.manifest.entry_points();
    let mut recovery = Recovery::default();
    let mut written: FxHashMap<Utf8PathBuf, String> = FxHashMap::default();
    let index = map_index(&installed.dir);

    for (specifier, declaration) in resolved {
        let targets = implementation_candidates(installed, specifier, declaration, &offered);
        let entry_point = EntryPoint {
            specifier: specifier.clone(),
            targets,
        };
        let (route, at) = recover_one(installed, &entry_point, &index, &mut written);
        recovery.entries.push(RecoveredEntry {
            specifier: specifier.clone(),
            route,
            entry: at,
        });
    }

    let mut files: Vec<RecoveredFile> = written
        .into_iter()
        .map(|(at, text)| RecoveredFile { at, text })
        .collect();
    files.sort_by(|a, b| a.at.cmp(&b.at));
    recovery.files = files;
    reject_unbuildable(installed, &mut recovery);
    recovery
}

/// Where the implementation behind a resolved declaration might be, best first.
///
/// Three sources, and the second is the one that carries most packages:
///
/// 1. the file the checker resolved, when it is already an implementation --
///    a package whose `exports` names TypeScript under a condition tsgo took;
/// 2. the manifest's own targets for this exact subpath, which is where a
///    publisher's source condition lives -- `zod` ships `src/index.ts` behind
///    `@zod/source` and no checker will ever pick it;
/// 3. the declaration's sibling: `index.d.ts` describes `index.js` sitting
///    beside it. That is TypeScript's own rule for what a declaration file is
///    *about*, not a guess that `dist` mirrors `src`.
fn implementation_candidates(
    installed: &Installed,
    specifier: &str,
    declaration: &Utf8Path,
    offered: &[EntryPoint],
) -> Vec<String> {
    let mut targets = Vec::new();
    let relative = |path: &Utf8Path| -> Option<String> {
        path.strip_prefix(&installed.dir)
            .ok()
            .map(|at| at.as_str().to_owned())
    };

    if let Some(at) = relative(declaration)
        && is_typescript(&at)
    {
        targets.push(at);
    }
    if let Some(entry) = offered.iter().find(|entry| entry.specifier == specifier) {
        for target in &entry.targets {
            if !targets.contains(target) {
                targets.push(target.clone());
            }
        }
    }
    if let Some(at) = relative(declaration) {
        // `index.d.ts` -> `index`, `index.d.cts` -> `index`.
        let stem = at
            .strip_suffix(".d.ts")
            .or_else(|| at.strip_suffix(".d.mts"))
            .or_else(|| at.strip_suffix(".d.cts"));
        if let Some(stem) = stem {
            for extension in ["js", "mjs", "cjs"] {
                let sibling = format!("{stem}.{extension}");
                if installed.dir.join(&sibling).is_file() && !targets.contains(&sibling) {
                    targets.push(sibling);
                }
            }
        }
    }
    targets
}

/// Turn a recovery whose source cannot build into a refusal, with the reason.
fn reject_unbuildable(installed: &Installed, recovery: &mut Recovery) {
    let Some(specifier) = unbuildable(installed, &recovery.files) else {
        return;
    };
    for entry in &mut recovery.entries {
        if entry.route.recovered() {
            entry.route = Route::SourceNeedsUnpublishedConfig {
                specifier: specifier.clone(),
            };
            entry.entry = None;
        }
    }
    recovery.files.clear();
}

fn recover_one(
    installed: &Installed,
    entry_point: &EntryPoint,
    index: &MapIndex,
    written: &mut FxHashMap<Utf8PathBuf, String>,
) -> (Route, Option<Utf8PathBuf>) {
    let mut best = Route::JavaScriptOnly;
    let mut saw_entry = false;

    // Every target, as the file it actually names.
    let resolved: Vec<String> = entry_point
        .targets
        .iter()
        .filter_map(|target| entry_file(&installed.dir, target))
        .collect();

    // Route 1: the package shipped the source the entry names.
    for target in &resolved {
        if !is_typescript(target) {
            continue;
        }
        let absolute = installed.dir.join(target);
        let at = crate::resolve::normalize(Utf8Path::new(target));
        walk_shipped(&installed.dir, &absolute, written);
        return (Route::ShippedTypeScript, Some(at));
    }

    // Route 2: the entry is generated and its map carries the original.
    for target in &resolved {
        if !is_javascript(target) {
            continue;
        }
        let absolute = installed.dir.join(target);
        saw_entry = true;
        let Some(map) = read_map(&absolute) else {
            continue;
        };
        match harvest(&map, &absolute, index, written) {
            Harvest::Recovered(entry) => return (Route::SourceMap, Some(entry)),
            Harvest::Holes { have, want } => best = worse(best, Route::MapIncomplete { have, want }),
            Harvest::Ambiguous { sources } => best = worse(best, Route::MapAmbiguous { sources }),
            Harvest::JavaScript => best = worse(best, Route::MapOfJavaScript),
            Harvest::Nothing => {}
        }
    }

    if !saw_entry && resolved.is_empty() {
        return (Route::EntryMissing, None);
    }
    (best, None)
}

/// Keep the more informative of two failures.
fn worse(current: Route, candidate: Route) -> Route {
    match (&current, &candidate) {
        (Route::JavaScriptOnly, _) => candidate,
        (Route::MapOfJavaScript, Route::MapIncomplete { .. } | Route::MapAmbiguous { .. }) => {
            candidate
        }
        _ => current,
    }
}

/// Copy a shipped `.ts` entry and everything it relatively imports.
///
/// Following imports rather than copying the package's whole `.ts` set is what
/// keeps `drizzle-orm` from contributing 442 files for one specifier, and it is
/// also the only way to leave a package's tests and type-test files behind
/// without a heuristic about their names.
fn walk_shipped(
    package_dir: &Utf8Path,
    entry: &Utf8Path,
    written: &mut FxHashMap<Utf8PathBuf, String>,
) {
    let mut queue = vec![crate::resolve::normalize(entry)];
    while let Some(file) = queue.pop() {
        let Ok(relative) = file.strip_prefix(package_dir) else {
            continue;
        };
        let at = relative.to_owned();
        if written.contains_key(&at) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        for specifier in import_specifiers(&text) {
            if !specifier.starts_with('.') {
                continue;
            }
            if let Some(next) = relative_import(&file, &specifier) {
                queue.push(next);
            }
        }
        written.insert(at, text);
    }
}

/// Import specifiers in a TypeScript source, textually.
///
/// A scanner rather than a parser, and deliberately so: it decides which files
/// to *copy*, and copying one file too many costs a few kilobytes while parsing
/// the whole ecosystem's syntax costs a parser. String and comment contexts are
/// skipped so a specifier inside a doc comment does not pull a file in.
fn import_specifiers(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut at = 0usize;

    while at < bytes.len() {
        // Skip comments, so a URL in a doc block is not mistaken for a module.
        if bytes[at] == b'/' && at + 1 < bytes.len() {
            if bytes[at + 1] == b'/' {
                while at < bytes.len() && bytes[at] != b'\n' {
                    at += 1;
                }
                continue;
            }
            if bytes[at + 1] == b'*' {
                at += 2;
                while at + 1 < bytes.len() && !(bytes[at] == b'*' && bytes[at + 1] == b'/') {
                    at += 1;
                }
                at = (at + 2).min(bytes.len());
                continue;
            }
        }

        // Only three keywords introduce a specifier, so most bytes cannot
        // start one. Checking the first byte before doing any string work is
        // what keeps this linear in practice: zod ships 4MB of TypeScript, and
        // without this the scan of one package dominated the whole run.
        if !matches!(bytes[at], b'f' | b'i' | b'r') {
            at += 1;
            continue;
        }
        // Byte indices, over text that is not all ASCII: package sources have
        // em dashes and box drawing in them, and slicing mid-character panics.
        if !text.is_char_boundary(at) {
            at += 1;
            continue;
        }
        let rest = &text[at..];
        let keyword = ["from", "import", "require"]
            .into_iter()
            .find(|word| rest.starts_with(word) && word_boundary(text, at, word.len()));
        let Some(keyword) = keyword else {
            at += 1;
            continue;
        };

        // Between the keyword and the specifier there may be whitespace and an
        // opening paren; anything else means this was not a module specifier.
        let mut cursor = at + keyword.len();
        while cursor < bytes.len() && (bytes[cursor].is_ascii_whitespace() || bytes[cursor] == b'(')
        {
            cursor += 1;
        }
        if cursor >= bytes.len() || (bytes[cursor] != b'"' && bytes[cursor] != b'\'') {
            at += keyword.len();
            continue;
        }
        let quote = bytes[cursor];
        cursor += 1;
        let start = cursor;
        while cursor < bytes.len() && bytes[cursor] != quote {
            cursor += 1;
        }
        if cursor < bytes.len() {
            out.push(text[start..cursor].to_owned());
        }
        at = cursor + 1;
    }
    out
}

fn word_boundary(text: &str, at: usize, len: usize) -> bool {
    if !text.is_char_boundary(at) || !text.is_char_boundary(at + len) {
        return false;
    }
    let before = text[..at].chars().next_back();
    let after = text[at + len..].chars().next();
    let ident = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$');
    !ident(before) && !ident(after)
}


/// Every TypeScript source any map in a package embeds, by where it belongs.
///
/// # Why a package-wide index
///
/// A `tsc`-style build emits one file per input, so the *entry's* map carries
/// the entry and nothing else — recovering only that yields `src/index.ts`
/// alone, whose five sibling imports resolve to nothing. `minimatch` ships
/// twelve maps holding exactly those siblings, and the same is true of every
/// package that is more than one module and is not bundled.
///
/// The alternative was to guess that `dist/ast.js` came from `src/ast.ts`,
/// which is the inference `docs/npm-deps.md` says not to make. The index does
/// not guess: each map *states* which source it was built from, and the walk
/// below follows imports between the sources those statements produced.
type MapIndex = FxHashMap<Utf8PathBuf, String>;

fn map_index(package_dir: &Utf8Path) -> MapIndex {
    let mut index = MapIndex::default();
    let mut stack = vec![package_dir.to_owned()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let path = dir.join(&name);
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                // A package's own dependencies are their own packages.
                if name != "node_modules" {
                    stack.push(path);
                }
                continue;
            }
            if !is_javascript(&name) {
                continue;
            }
            let Some(map) = read_map(&path) else {
                continue;
            };
            for (at, source) in map.sources.iter().enumerate() {
                let leaf = source.rsplit('/').next().unwrap_or(source);
                if !is_typescript(leaf) {
                    continue;
                }
                let Some(text) = map.contents.get(at).and_then(Option::as_ref) else {
                    continue;
                };
                let Some(dest) = vendor_path(&map.root, source) else {
                    continue;
                };
                index.entry(dest).or_insert_with(|| text.clone());
            }
        }
    }
    index
}

/// Resolve a relative import against recovered sources rather than the disk.
///
/// The same extension substitution TypeScript uses — `./ast.js` names
/// `ast.ts` — applied to files that exist only as source-map content.
fn resolve_in_index(from: &Utf8Path, specifier: &str, index: &MapIndex) -> Option<Utf8PathBuf> {
    let base = crate::resolve::normalize(&from.parent()?.join(specifier));
    let stem = base.as_str();
    let swapped = [
        stem.strip_suffix(".js").map(|head| format!("{head}.ts")),
        stem.strip_suffix(".js").map(|head| format!("{head}.tsx")),
        stem.strip_suffix(".mjs").map(|head| format!("{head}.mts")),
        stem.strip_suffix(".cjs").map(|head| format!("{head}.cts")),
    ];
    swapped
        .into_iter()
        .flatten()
        .map(Utf8PathBuf::from)
        .chain([base.clone()])
        .chain(
            ["ts", "tsx", "mts", "cts"]
                .into_iter()
                .map(|ext| Utf8PathBuf::from(format!("{stem}.{ext}"))),
        )
        .chain(
            ["index.ts", "index.tsx", "index.mts", "index.cts"]
                .into_iter()
                .map(|leaf| base.join(leaf)),
        )
        .find(|candidate| index.contains_key(candidate))
}

/// Pull an entry and everything it reaches out of the index.
///
/// `visited` is tracked separately from `written` on purpose. The entry is
/// already in `written` when this is called — that is how it was identified —
/// so keying the walk on `written` made it skip the seed and scan nothing,
/// which looked exactly like a package that genuinely had one module.
fn walk_recovered(entry: &Utf8Path, index: &MapIndex, written: &mut FxHashMap<Utf8PathBuf, String>) {
    let mut visited: Vec<Utf8PathBuf> = Vec::new();
    let mut queue = vec![entry.to_owned()];
    while let Some(at) = queue.pop() {
        if visited.contains(&at) {
            continue;
        }
        let Some(text) = index.get(&at).cloned().or_else(|| written.get(&at).cloned()) else {
            continue;
        };
        visited.push(at.clone());
        for specifier in import_specifiers(&text) {
            if !specifier.starts_with('.') {
                continue;
            }
            if let Some(next) = resolve_in_index(&at, &specifier, index) {
                queue.push(next);
            }
        }
        written.entry(at).or_insert(text);
    }
}


/// Whether recovered source can actually be built.
///
/// Recovering files and recovering a *package* are different things, and the
/// difference is measurable: acquiring a 141-package corpus produced 3,091
/// typecheck errors, and 2,850 of them were one package importing `~/entity.ts`
/// — a `paths` alias from a tsconfig it does not publish. Vendoring that and
/// reporting it as acquired is a partial recovery presented as a success, which
/// is the one thing this crate is not allowed to do.
///
/// The test is deliberately narrow: a bare specifier that names no installed
/// package and is not a node builtin. Anything a package legitimately imports
/// is installed beside it, because that is what a dependency is.
fn unbuildable(installed: &Installed, files: &[RecoveredFile]) -> Option<String> {
    for file in files {
        for specifier in import_specifiers(&file.text) {
            if specifier.starts_with('.') || specifier.starts_with("node:") {
                continue;
            }
            // `#internal` is the package's own `imports` field, which is
            // published in its manifest and therefore not this problem.
            if specifier.starts_with('#') {
                continue;
            }
            let name = package_name_of(&specifier);
            if BUILTINS.contains(&name.as_str()) {
                continue;
            }
            if crate::resolve::find_package(&installed.dir, &name).is_none() {
                return Some(specifier);
            }
        }
    }
    None
}

/// The package half of a specifier: `zod/v4` is `zod`, `@a/b/c` is `@a/b`.
fn package_name_of(specifier: &str) -> String {
    let parts: Vec<&str> = specifier.split('/').collect();
    if specifier.starts_with('@') && parts.len() >= 2 {
        format!("{}/{}", parts[0], parts[1])
    } else {
        parts.first().map_or_else(String::new, |head| (*head).to_owned())
    }
}

/// Node's own modules, which are imported without being installed.
const BUILTINS: [&str; 30] = [
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants",
    "crypto", "dgram", "diagnostics_channel", "dns", "events", "fs", "http", "http2", "https",
    "net", "os", "path", "process", "querystring", "readline", "stream", "string_decoder",
    "timers", "tls", "tty", "url", "util", "zlib",
];

// ---- source maps ---------------------------------------------------------

#[derive(Debug, Default)]
struct SourceMap {
    sources: Vec<String>,
    contents: Vec<Option<String>>,
    /// Where the map was found, so relative `sources` can be resolved.
    root: Utf8PathBuf,
}

enum Harvest {
    Recovered(Utf8PathBuf),
    Holes { have: usize, want: usize },
    Ambiguous { sources: usize },
    JavaScript,
    Nothing,
}

/// Find and flatten the map for a generated file.
fn read_map(js: &Utf8Path) -> Option<SourceMap> {
    let text = std::fs::read_to_string(js).ok()?;
    let comment = text.rfind("sourceMappingURL=")?;
    let url: String = text[comment + "sourceMappingURL=".len()..]
        .chars()
        .take_while(|c| !c.is_whitespace())
        .collect();
    let url = url.trim_end_matches("*/").trim().to_owned();

    let (json, root) = if let Some(encoded) = url.strip_prefix("data:") {
        // `data:application/json;charset=utf-8;base64,…`
        let payload = encoded.split_once("base64,")?.1;
        let decoded = base64(payload)?;
        (String::from_utf8(decoded).ok()?, js.parent()?.to_owned())
    } else {
        let sibling = js.parent()?.join(&url);
        (
            std::fs::read_to_string(&sibling).ok()?,
            sibling.parent()?.to_owned(),
        )
    };

    let value: serde_json::Value = serde_json::from_str(&json).ok()?;
    let mut map = SourceMap {
        root,
        ..SourceMap::default()
    };
    flatten(&value, &mut map);
    Some(map)
}

/// Index maps nest a map per section; both shapes carry the same two arrays.
fn flatten(value: &serde_json::Value, into: &mut SourceMap) {
    if let Some(sections) = value.get("sections").and_then(serde_json::Value::as_array) {
        for section in sections {
            if let Some(inner) = section.get("map") {
                flatten(inner, into);
            }
        }
        return;
    }
    let sources = value.get("sources").and_then(serde_json::Value::as_array);
    let contents = value
        .get("sourcesContent")
        .and_then(serde_json::Value::as_array);
    let Some(sources) = sources else { return };
    for (index, source) in sources.iter().enumerate() {
        let Some(source) = source.as_str() else { continue };
        into.sources.push(source.to_owned());
        into.contents.push(
            contents
                .and_then(|all| all.get(index))
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
        );
    }
}

/// Take a map's embedded TypeScript, or say why it cannot be taken.
///
/// Recovering the *files* and deciding which one the specifier *means* are two
/// questions, and only the first is always answerable. A `tsc` output maps one
/// generated file to one source and the answer is forced; a bundle maps one
/// generated file to everything that went into it, and the map records no
/// notion of which was the entry. Where it cannot be known it is reported, not
/// guessed: `lru-cache` bundles `index.ts` together with two
/// `diagnostics-channel` modules, and taking the first source in the list
/// mapped the package's main specifier at a file it does not mean.
fn harvest(
    map: &SourceMap,
    generated: &Utf8Path,
    index: &MapIndex,
    written: &mut FxHashMap<Utf8PathBuf, String>,
) -> Harvest {
    let typescript: Vec<usize> = (0..map.sources.len())
        .filter(|&i| {
            let source = &map.sources[i];
            let path = source.rsplit('/').next().unwrap_or(source);
            is_typescript(path)
        })
        .collect();
    if typescript.is_empty() {
        return if map.sources.is_empty() {
            Harvest::Nothing
        } else {
            Harvest::JavaScript
        };
    }
    let have = typescript
        .iter()
        .filter(|&&i| map.contents[i].is_some())
        .count();
    if have != typescript.len() {
        return Harvest::Holes {
            have,
            want: typescript.len(),
        };
    }

    let mut placed: Vec<(usize, Utf8PathBuf)> = Vec::new();
    for index in typescript {
        let Some(text) = map.contents[index].clone() else {
            continue;
        };
        let Some(at) = vendor_path(&map.root, &map.sources[index]) else {
            continue;
        };
        // One logical path, one content. A conflict is a map disagreeing with
        // itself, and the first answer is as good as the second.
        if written.get(&at).is_some_and(|existing| *existing != text) {
            continue;
        }
        written.insert(at.clone(), text);
        placed.push((index, at));
    }

    if placed.len() == 1 {
        let entry = placed.remove(0).1;
        walk_recovered(&entry, index, written);
        return Harvest::Recovered(entry);
    }

    // Several sources: the entry is the one named after the file being mapped.
    let stem = generated
        .file_name()
        .map(|name| name.split('.').next().unwrap_or(name).to_owned());
    let named = placed.iter().find(|(_, at)| {
        stem.as_ref().is_some_and(|stem| {
            at.file_name()
                .is_some_and(|name| name.split('.').next() == Some(stem.as_str()))
        })
    });
    match named {
        Some((_, at)) => {
            let entry = at.clone();
            walk_recovered(&entry, index, written);
            Harvest::Recovered(entry)
        }
        None if placed.is_empty() => Harvest::Nothing,
        None => Harvest::Ambiguous {
            sources: placed.len(),
        },
    }
}

/// Where a map-declared source belongs under the package's vendor root.
///
/// `sources` are relative to the map, routinely climb out of `dist/`, and are
/// written by whoever built the package. Leading `../` is folded away rather
/// than honoured, and the result is forced to stay inside the vendor root: a
/// path that would escape is dropped, not clamped.
fn vendor_path(map_root: &Utf8Path, source: &str) -> Option<Utf8PathBuf> {
    let joined = map_root.join(source.strip_prefix("./").unwrap_or(source));
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.as_str().split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    // Keep the tail below the package: everything from the last `node_modules`
    // or the package directory name onward is noise from the builder's machine.
    let cut = parts
        .iter()
        .rposition(|part| *part == "node_modules")
        .map_or(0, |at| {
            // A scoped name is two components, not one.
            let scoped = parts.get(at + 1).is_some_and(|part| part.starts_with('@'));
            at + if scoped { 3 } else { 2 }
        });
    let tail = parts.get(cut..)?;
    (!tail.is_empty()).then(|| Utf8PathBuf::from(tail.join("/")))
}

/// Just enough base64 for an inline source map.
fn base64(input: &str) -> Option<Vec<u8>> {
    const fn value(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut accumulator: u32 = 0;
    let mut bits = 0u32;
    for byte in input.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let six = value(byte)?;
        accumulator = (accumulator << 6) | u32::from(six);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(u8::try_from((accumulator >> bits) & 0xff).ok()?);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_a_known_vector() {
        assert_eq!(base64("aGVsbG8=").as_deref(), Some(&b"hello"[..]));
        assert_eq!(base64("eyJhIjoxfQ==").as_deref(), Some(&b"{\"a\":1}"[..]));
    }

    #[test]
    fn a_source_that_climbs_out_of_dist_lands_beside_it() {
        let at = vendor_path(Utf8Path::new("dist/esm"), "../../src/index.ts");
        assert_eq!(at.as_deref(), Some(Utf8Path::new("src/index.ts")));
    }

    /// A map that names a path under a bundled `node_modules` — `tar` does
    /// this — keeps only the part below that package, and cannot escape.
    #[test]
    fn a_bundled_dependency_keeps_only_its_own_tail() {
        let at = vendor_path(
            Utf8Path::new("dist"),
            "../node_modules/@isaacs/fs-minipass/src/index.ts",
        );
        assert_eq!(at.as_deref(), Some(Utf8Path::new("src/index.ts")));
    }

    #[test]
    fn a_source_that_would_escape_the_root_is_dropped() {
        assert_eq!(vendor_path(Utf8Path::new("dist"), "../../.."), None);
    }

    #[test]
    fn specifiers_are_found_and_comments_are_not() {
        let text = r#"
            // import "./not-this.ts"
            /* from "./nor-this.ts" */
            import { a } from "./a.js";
            export * from './b';
            const c = await import("./c.ts");
            const d = require("./d");
            const notAnImport = "from './e'";
        "#;
        let found = import_specifiers(text);
        assert!(found.contains(&"./a.js".to_owned()));
        assert!(found.contains(&"./b".to_owned()));
        assert!(found.contains(&"./c.ts".to_owned()));
        assert!(found.contains(&"./d".to_owned()));
        assert!(!found.contains(&"./not-this.ts".to_owned()));
        assert!(!found.contains(&"./nor-this.ts".to_owned()));
    }

    #[test]
    fn a_declaration_is_not_an_implementation() {
        assert!(!is_typescript("index.d.ts"));
        assert!(is_typescript("index.ts"));
        assert!(is_typescript("index.mts"));
    }
}
