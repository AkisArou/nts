//! Provenance for effective strict flags, from the native resolver's actual
//! extends edges and the config bytes that its host read in this revision.
//! This observer delegates every parse; it neither caches nor resolves a path.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use camino::Utf8PathBuf;
use tsrs_core::{CompilerOptions, P, Tristate, tspath};
use tsrs_tsoptions::{
    CompilerOptionsValue, ExtendedConfigCache, ExtendedConfigCacheEntry, ParseConfigHost,
};

use crate::host::Host;

// Bounds apply only to diagnostic provenance, never to native resolution or
// effective settings. Exhaustion keeps the refusal and omits uncertain origins.
pub(crate) const MAX_CONFIGS: usize = 128;
pub(crate) const MAX_EDGES: usize = 1024;
const MAX_PARSE_BYTES: usize = 4 * 1024 * 1024;

type ReadOption = fn(&CompilerOptions) -> Tristate;
pub(crate) const STRICT_OPTIONS: [(&str, ReadOption); 9] = [
    ("noImplicitAny", |o| o.no_implicit_any),
    ("strictNullChecks", |o| o.strict_null_checks),
    ("strictFunctionTypes", |o| o.strict_function_types),
    ("strictBindCallApply", |o| o.strict_bind_call_apply),
    ("strictPropertyInitialization", |o| {
        o.strict_property_initialization
    }),
    ("strictBuiltinIteratorReturn", |o| {
        o.strict_builtin_iterator_return
    }),
    ("noImplicitThis", |o| o.no_implicit_this),
    ("useUnknownInCatchVariables", |o| {
        o.use_unknown_in_catch_variables
    }),
    ("alwaysStrict", |o| o.always_strict),
];

fn enabled(options: &CompilerOptions, name: &str, value: Tristate) -> bool {
    if name == "alwaysStrict" {
        // Native declares this default true independently of the strict bundle;
        // explicit false is a removed option, still observable by raw audits.
        !value.is_false()
    } else {
        options.get_strict_option_value(value)
    }
}

/// The actual setting responsible for one disabled effective strict option.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrictOptionSource {
    pub name: &'static str,
    pub configuration: Utf8PathBuf,
    /// The individual option, or `strict` when its value supplies the default.
    pub setting: &'static str,
}

pub(crate) struct ConfigSources<'a> {
    host: &'a Host,
    root: String,
    edges: Mutex<BTreeMap<String, Vec<String>>>,
    edge_reads: AtomicUsize,
    exhausted: AtomicBool,
}

struct Resolved {
    options: CompilerOptions,
    raw: CompilerOptionsValue,
    origins: BTreeMap<&'static str, (Utf8PathBuf, &'static str)>,
}

fn readers() -> impl Iterator<Item = (&'static str, ReadOption)> {
    STRICT_OPTIONS
        .into_iter()
        .chain([("strict", (|o: &CompilerOptions| o.strict) as ReadOption)])
}

impl ConfigSources<'_> {
    pub(crate) fn new<'a>(host: &'a Host, root: &str) -> ConfigSources<'a> {
        let root = host.retain_config(root);
        ConfigSources {
            host,
            edges: Mutex::new(BTreeMap::from([(root.clone(), Vec::new())])),
            root,
            edge_reads: AtomicUsize::new(0),
            exhausted: AtomicBool::new(false),
        }
    }

    /// Unknown provenance remains unknown. It must never be replaced with a
    /// guessed root/last-read file. Effective booleans still come from Program.
    pub(crate) fn disabled(&self, actual: &CompilerOptions) -> Vec<StrictOptionSource> {
        if STRICT_OPTIONS
            .iter()
            .all(|(name, read)| enabled(actual, name, read(actual)))
        {
            return Vec::new();
        }
        if self.exhausted.load(Ordering::Relaxed) {
            return Vec::new();
        }
        let edges = self
            .edges
            .lock()
            .expect("config edge observer calls no user code");
        let Some((resolved, _)) = self.resolve(&edges) else {
            return Vec::new();
        };
        if readers().any(|(_, read)| read(&resolved.options) != read(actual)) {
            return Vec::new();
        }
        STRICT_OPTIONS
            .into_iter()
            .filter_map(|(name, read)| {
                let value = read(actual);
                if enabled(actual, name, value) {
                    return None;
                }
                let supplied = if value == Tristate::Unknown {
                    "strict"
                } else {
                    name
                };
                let (configuration, setting) = resolved.origins.get(supplied)?;
                Some(StrictOptionSource {
                    name,
                    configuration: configuration.clone(),
                    setting,
                })
            })
            .collect()
    }

    fn resolve(&self, edges: &BTreeMap<String, Vec<String>>) -> Option<(Resolved, usize)> {
        let mut pending = vec![(self.root.clone(), false)];
        let mut active = BTreeSet::new();
        let mut memo: BTreeMap<String, Resolved> = BTreeMap::new();
        let mut edge_work = 0;
        let mut parse_bytes = 0;
        let mut parsed = 0;
        while let Some((path, finish)) = pending.pop() {
            if memo.contains_key(&path) {
                continue;
            }
            if !finish {
                if !active.insert(path.clone()) || active.len() + memo.len() > MAX_CONFIGS {
                    return None;
                }
                pending.push((path.clone(), true));
                for base in edges.get(&path).into_iter().flatten().rev() {
                    edge_work += 1;
                    if edge_work > MAX_EDGES {
                        return None;
                    }
                    if !memo.contains_key(base) {
                        pending.push((base.clone(), false));
                    }
                }
                continue;
            }
            let text = self.host.config_text(&path)?;
            parse_bytes += text.len();
            if parse_bytes > MAX_PARSE_BYTES {
                return None;
            }
            let (raw, errors) = tsrs_tsoptions::parse_config_file_text_to_json(
                &path,
                tspath::to_path(&path, "", true),
                &text,
            );
            if !errors.is_empty() {
                return None;
            }
            parsed += 1;
            let mut local_options = CompilerOptions::default();
            if let CompilerOptionsValue::Object(root) = &raw
                && let Some(CompilerOptionsValue::Object(options)) = root.get("compilerOptions")
            {
                for (name, value) in options {
                    if !readers().any(|(required, _)| required == name) {
                        continue;
                    }
                    // This helper applies already converted native values.
                    // Raw enum strings such as target/module are not inputs
                    // to provenance, and malformed booleans are unavailable.
                    if !matches!(
                        value,
                        CompilerOptionsValue::Bool(_) | CompilerOptionsValue::Null
                    ) {
                        return None;
                    }
                    tsrs_tsoptions::parse_compiler_options_worker(name, value, &mut local_options);
                }
            }
            let mut resolved = Resolved {
                options: CompilerOptions::default(),
                raw: CompilerOptionsValue::Null,
                origins: BTreeMap::new(),
            };
            for base in edges.get(&path).into_iter().flatten() {
                resolved.merge(memo.get(base)?);
            }
            let local = Resolved {
                origins: readers()
                    .filter(|(_, read)| read(&local_options) != Tristate::Unknown)
                    .map(|(name, _)| (name, (Utf8PathBuf::from(&path), name)))
                    .collect(),
                options: local_options,
                raw,
            };
            resolved.merge(&local);
            // Native merges effective options with this config's own raw nulls.
            resolved.raw = local.raw;
            active.remove(&path);
            memo.insert(path, resolved);
        }
        Some((memo.remove(&self.root)?, parsed))
    }
}

impl Resolved {
    fn merge(&mut self, source: &Self) {
        let local = match &source.raw {
            CompilerOptionsValue::Object(root) => match root.get("compilerOptions") {
                Some(CompilerOptionsValue::Object(options)) => Some(options),
                _ => None,
            },
            _ => None,
        };
        for (name, read) in readers() {
            if local.is_some_and(|options| {
                matches!(options.get(name), Some(CompilerOptionsValue::Null))
            }) {
                self.origins.remove(name);
            } else if read(&source.options) != Tristate::Unknown {
                match source.origins.get(name) {
                    Some(origin) => {
                        self.origins.insert(name, origin.clone());
                    }
                    None => {
                        self.origins.remove(name);
                    }
                }
            }
        }
        tsrs_tsoptions::merge_compiler_options(
            &mut self.options,
            Some(&source.options),
            Some(&source.raw),
        );
    }
}

impl ExtendedConfigCache for ConfigSources<'_> {
    fn get_extended_config(
        &self,
        file_name: &str,
        path: &tspath::Path,
        resolution_stack: &[tspath::Path],
        host: &dyn ParseConfigHost,
    ) -> P<ExtendedConfigCacheEntry> {
        if !self.exhausted.load(Ordering::Relaxed) {
            let work = self.edge_reads.fetch_add(1, Ordering::Relaxed);
            let child = path.to_string();
            let mut edges = self
                .edges
                .lock()
                .expect("config edge observer calls no user code");
            if work >= MAX_EDGES || (!edges.contains_key(&child) && edges.len() >= MAX_CONFIGS) {
                self.exhausted.store(true, Ordering::Relaxed);
            } else {
                self.host.retain_config(file_name);
                if let Some(parent) = resolution_stack.last() {
                    edges
                        .entry(parent.to_string())
                        .or_default()
                        .push(child.clone());
                }
                edges.insert(child, Vec::new());
            }
        }
        tsrs_tsoptions::parse_extended_config(
            file_name,
            path.clone(),
            resolution_stack,
            host,
            Some(self),
        )
    }
}

#[cfg(test)]
#[test]
fn captured_strict_options_match_the_native_group() {
    // The native group marker is private. Check its actual pinned declarations
    // without adding an upstream accessor or inferring the group from help text.
    let declarations = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../third_party/tsrs/crates/tsrs_tsoptions/src/declscompiler.rs"
    ));
    let mut native = Vec::new();
    for row in declarations.split("CommandLineOption {").skip(1) {
        if !row.lines().any(|line| line.trim() == "strict_flag: true,") {
            continue;
        }
        let Some(name) = row.lines().find_map(|line| {
            line.trim()
                .strip_prefix("name: \"")
                .and_then(|name| name.strip_suffix("\","))
        }) else {
            panic!("native strict option declaration has no recognized name");
        };
        native.push(name);
    }
    assert_eq!(
        native.len(),
        declarations
            .lines()
            .filter(|line| line.trim() == "strict_flag: true,")
            .count(),
        "every native strict-group marker must belong to a recognized declaration"
    );
    let mut captured: Vec<_> = STRICT_OPTIONS
        .iter()
        .map(|(name, _)| *name)
        .filter(|name| *name != "alwaysStrict")
        .collect();
    native.sort_unstable();
    captured.sort_unstable();
    assert_eq!(
        captured, native,
        "a native strict-group change needs a schema/capture/policy review"
    );
    let always = tsrs_tsoptions::OPTIONS_DECLARATIONS
        .iter()
        .find(|option| option.name == "alwaysStrict")
        .expect("native alwaysStrict declaration");
    assert!(matches!(
        always.default_value_description,
        tsrs_tsoptions::DefaultValueDescription::Bool(true)
    ));
}

#[cfg(test)]
mod work_controls {
    use super::*;
    use tsrs_vfs::FS as _;

    // Exercise only provenance: native resolution has already chosen these
    // edges. Do not make the native resolver traverse an exponential fixture.
    fn graph(children: &[Vec<usize>], check: impl FnOnce(&ConfigSources<'_>)) {
        graph_with_options(children, r#""strict":false"#, check);
    }

    fn graph_with_options(
        children: &[Vec<usize>],
        options: &str,
        check: impl FnOnce(&ConfigSources<'_>),
    ) {
        let region = tsrs_core::arena::Region::new_scratch(1 << 20);
        let _scope = region.enter();
        let path = |i| format!("/config-origin-control/{i}.json");
        let overlays = (0..children.len())
            .map(|i| {
                (
                    Utf8PathBuf::from(path(i)),
                    format!(r#"{{"compilerOptions":{{{options}}}}}"#),
                )
            })
            .collect();
        let host = Host::new("/config-origin-control", &overlays);
        let trace = ConfigSources::new(&host, &path(0));
        for i in 0..children.len() {
            host.retain_config(&path(i));
            assert!(host.read_file(&path(i)).is_some());
        }
        *trace.edges.lock().expect("test edges") = children
            .iter()
            .enumerate()
            .map(|(i, bases)| (path(i), bases.iter().map(|&j| path(j)).collect()))
            .collect();
        check(&trace);
    }

    #[test]
    fn unrelated_raw_enum_options_are_not_reinterpreted() {
        graph_with_options(
            &[vec![]],
            r#""strict":false,"alwaysStrict":false,"target":"ES2022","module":"ESNext","moduleResolution":"bundler""#,
            |trace| {
                let (resolved, parsed) = trace
                    .resolve(&trace.edges.lock().expect("test edges"))
                    .expect("only strict booleans are applied");
                assert_eq!(parsed, 1);
                assert_eq!(resolved.options.strict, Tristate::False);
                assert_eq!(resolved.options.always_strict, Tristate::False);
            },
        );
    }

    #[test]
    fn malformed_strict_values_lose_only_provenance() {
        graph_with_options(
            &[vec![]],
            r#""alwaysStrict":false,"strictNullChecks":"not a boolean""#,
            |trace| {
                assert!(
                    trace
                        .resolve(&trace.edges.lock().expect("test edges"))
                        .is_none()
                );
                let actual = CompilerOptions {
                    always_strict: Tristate::False,
                    ..CompilerOptions::default()
                };
                assert_eq!(trace.disabled(&actual), []);
                assert!(
                    !enabled(&actual, "alwaysStrict", actual.always_strict),
                    "the native false remains a policy input"
                );
            },
        );
    }

    #[test]
    fn a_shared_graph_parses_each_config_once() {
        let count = 80;
        let children: Vec<_> = (0..count)
            .map(|i| ((i + 1)..(i + 3).min(count)).collect())
            .collect();
        graph(&children, |trace| {
            let edges = trace.edges.lock().expect("test edges");
            let (resolved, parsed) = trace.resolve(&edges).expect("bounded shared graph");
            assert_eq!(parsed, count, "shared subgraphs must not be reparsed");
            assert_eq!(resolved.options.strict, Tristate::False);
        });
    }

    #[test]
    fn a_deep_graph_exhausts_provenance_without_losing_effective_values() {
        let count = MAX_CONFIGS + 1;
        let children: Vec<_> = (0..count)
            .map(|i| if i + 1 < count { vec![i + 1] } else { vec![] })
            .collect();
        graph(&children, |trace| {
            assert!(
                trace
                    .resolve(&trace.edges.lock().expect("test edges"))
                    .is_none()
            );
            let actual = CompilerOptions {
                strict: Tristate::False,
                always_strict: Tristate::False,
                ..CompilerOptions::default()
            };
            assert!(
                trace.disabled(&actual).is_empty(),
                "exhausted origins stay unavailable"
            );
            assert!(
                STRICT_OPTIONS
                    .iter()
                    .all(|(name, read)| !enabled(&actual, name, read(&actual))),
                "the compile-policy inputs stay disabled"
            );
        });
    }

    #[test]
    fn cycles_and_an_excessive_edge_population_are_unavailable() {
        for children in [vec![vec![1], vec![0]], vec![vec![1; MAX_EDGES + 1], vec![]]] {
            graph(&children, |trace| {
                assert!(
                    trace
                        .resolve(&trace.edges.lock().expect("test edges"))
                        .is_none()
                );
            });
        }
    }
}
