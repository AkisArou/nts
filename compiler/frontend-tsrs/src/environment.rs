//! Native process settings are captured before initialization, never mutated.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::sync::OnceLock;

use xxhash_rust::xxh3::Xxh3;

use crate::{Diagnostic, DiagnosticCategory, SessionOptions};

#[derive(Debug)]
pub(crate) struct Environment {
    values: BTreeMap<String, Option<OsString>>,
}

fn current() -> BTreeMap<String, Option<OsString>> {
    let values: BTreeMap<_, _> = std::env::vars_os()
        .filter_map(|(key, value)| {
            let key = key.into_string().ok()?;
            key.starts_with("TSRS_").then_some((key, Some(value)))
        })
        .collect();
    values
}

pub(crate) fn initialize() -> &'static Environment {
    static ENVIRONMENT: OnceLock<Environment> = OnceLock::new();
    let environment = ENVIRONMENT.get_or_init(|| {
        let values = current();
        // Public native API; canonical history is nts's fixed mode. No process
        // environment variable is changed.
        tsrs_core::compat::set_go_compatible_history(false);
        Environment { values }
    });
    assert!(
        environment.values == current(),
        "native runtime environment changed after initialization"
    );
    environment
}

impl Environment {
    pub(crate) fn cache_identity(&self, options: &SessionOptions) -> String {
        let mut hash = Xxh3::new();
        for (key, value) in &self.values {
            hash.update(&(key.len() as u64).to_le_bytes());
            hash.update(key.as_bytes());
            hash.update(&[u8::from(value.is_some())]);
            if let Some(value) = value {
                let bytes = value.as_encoded_bytes();
                hash.update(&(bytes.len() as u64).to_le_bytes());
                hash.update(bytes);
            }
        }
        let settings = format!(
            "cwd={};lib={:?};checkers={:?};stable=true;history=canonical;capture-before-pool;first-checker;compressed={};shared-graph={}",
            options.cwd,
            options.library_path,
            options.checker_count,
            tsrs_core::COMPRESSED_PTRS,
            tsrs_core::sharedgraph::COMPILED_IN
        );
        hash.update(settings.as_bytes());
        format!(
            "tsrs:{}:{}:{:032x}",
            env!("NTS_TSRS_VENDOR_HASH"),
            env!("NTS_TSRS_ADAPTER_HASH"),
            hash.digest128()
        )
    }

    pub(crate) fn notes(&self) -> Vec<Diagnostic> {
        // Every TSRS value is in identity. These explicitly ignored knobs do
        // not change this adapter's mode and need no user note.
        const REACHABLE: &[&str] = &[
            "TSRS_ARENA_POISON",
            "TSRS_ASSIGNMENT_DUMP",
            "TSRS_CHECKER_ASSIGNMENT",
            "TSRS_CHECKER_COST_CACHE",
            "TSRS_CHECK_SHARED",
            "TSRS_DEBUG_REGIONS",
            "TSRS_DEEP_NESTED",
            "TSRS_FILE_TIMES",
            "TSRS_FLOW_MEMO",
            "TSRS_FLOW_MEMO_BITS",
            "TSRS_FRONTEND_STATS",
            "TSRS_HEAVY_SHARE_DIVISOR",
            "TSRS_IA_MEMO",
            "TSRS_INFER_MEMO",
            "TSRS_INFER_MEMO_MIN_STEPS",
            "TSRS_INFER_MEMO_STATS",
            "TSRS_LAZY_COND_MAPPER",
            "TSRS_LAZY_EMPTY",
            "TSRS_LAZY_HAS_PROP",
            "TSRS_LAZY_INFERENCE_MAPPERS",
            "TSRS_LAZY_MEMBERS",
            "TSRS_LAZY_PROP_CACHE",
            "TSRS_LAZY_TUPLES",
            "TSRS_LAZY_UNAFFECTED",
            "TSRS_LAZY_UNMATCHED",
            "TSRS_LEAVES_FIRST",
            "TSRS_MAX_MEMORY",
            "TSRS_MEM_SPLIT",
            "TSRS_MODULE_AFFINITY",
            "TSRS_MODULE_AFFINITY_GAMMA",
            "TSRS_MODULE_AFFINITY_PASSES",
            "TSRS_RELATION_CACHE_LIMIT",
            "TSRS_SHARED_GRAPH",
            "TSRS_SITE_COUNTS_TOP",
            "TSRS_SPLIT_FILES",
            "TSRS_SPLIT_MIN_SHARE",
            "TSRS_SPLIT_PIECE_DIVISOR",
            "TSRS_STEAL_MAX_THIEVES",
            "TSRS_STEAL_STICKY",
            "TSRS_TRACE_UNION_REDUCTION",
            "TSRS_UNION_CACHE",
            "TSRS_UNION_CACHE_BITS",
            "TSRS_UNION_CACHE_STATS",
            "TSRS_WORK_CENSUS",
            "TSRS_WORK_CENSUS_SLOW",
            "TSRS_WORK_CENSUS_TOP",
        ];
        self.values
            .iter()
            .filter(|(key, value)| value.is_some() && REACHABLE.contains(&key.as_str()))
            .map(|(key, value)| Diagnostic {
                path: None,
                span: None,
                category: DiagnosticCategory::Message,
                code: 0,
                message: format!(
                    "{key}={} is set; tsrs is running in a non-default mode",
                    value
                        .as_ref()
                        .expect(
                            "the preceding filter retained only environment entries with a value"
                        )
                        .to_string_lossy()
                ),
                chain: Vec::new(),
                related: Vec::new(),
            })
            .collect()
    }
}
