//! Match detached memory contexts to the actual post-placement call variants.
//! No printed context label or clone suffix supplies a lineage fact.

use std::collections::{BTreeSet, VecDeque};

use rustc_hash::{FxHashMap, FxHashSet};

use super::super::{Callee, Memory, OpKind, Program, ValueId};
use super::{Report, Storage};

/// Identity in one detached analysis inventory, unrelated to function indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ContextId(pub usize);

#[derive(Debug, Clone, Copy)]
pub struct ContextView<'a> {
    pub id: ContextId,
    pub function: &'a str,
    pub key: &'a str,
    pub root: bool,
    pub merged: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct ContextArrival {
    pub parent: ContextId,
    pub child: ContextId,
    pub operation: ValueId,
}

/// Detached identities from the same call index that built the memory graph.
#[derive(Debug, Default)]
pub(super) struct Inputs {
    pub contexts: Vec<Context>,
    pub calls: Vec<Call>,
    pub complete: bool,
}

#[derive(Debug)]
pub(super) struct Context {
    pub function: String,
    pub key: String,
    pub root: bool,
    pub merged: bool,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct Call {
    pub parent: usize,
    pub child: usize,
    pub operation: ValueId,
}

/// A physical variant actually reached in this analysis context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Variant {
    pub function: String,
    pub home: String,
}

struct Budget {
    used: usize,
    limit: usize,
    exhausted: bool,
}

impl Budget {
    fn charge(&mut self) -> bool {
        self.used = self.used.saturating_add(1);
        if self.used > self.limit {
            self.exhausted = true;
            false
        } else {
            true
        }
    }
}

#[derive(Default)]
struct Targets {
    by_origin: FxHashMap<String, Vec<usize>>,
    unknown: Option<String>,
}

struct Index<'p> {
    program: &'p Program,
    by_name: FxHashMap<&'p str, usize>,
    origins: Vec<String>,
    region: FxHashSet<usize>,
    placed: Vec<FxHashSet<ValueId>>,
    dispatch: FxHashMap<u32, Vec<&'p str>>,
    calls: FxHashMap<(usize, ValueId), Targets>,
}

impl<'p> Index<'p> {
    fn of(program: &'p Program, clones: &FxHashMap<String, String>, budget: &mut Budget) -> Self {
        let mut index = Self {
            program,
            by_name: FxHashMap::default(),
            origins: Vec::new(),
            region: FxHashSet::default(),
            placed: Vec::new(),
            dispatch: FxHashMap::default(),
            calls: FxHashMap::default(),
        };
        for (at, function) in program.funcs.iter().enumerate() {
            if !budget.charge() {
                return index;
            }
            index.by_name.insert(function.name.as_str(), at);
            let original = clones.get(&function.name);
            index
                .origins
                .push(original.unwrap_or(&function.name).clone());
            if original.is_some() {
                index.region.insert(at);
            }
            let mut placed = FxHashSet::default();
            for &value in function.blocks.iter().flat_map(|block| &block.ops) {
                if !budget.charge() {
                    return index;
                }
                placed.insert(value);
            }
            index.placed.push(placed);
        }
        for (selector, target) in program.dispatch_entries() {
            if !budget.charge() {
                return index;
            }
            index.dispatch.entry(selector).or_default().push(target);
        }
        index
    }

    fn resolve(&mut self, variant: usize, operation: ValueId, budget: &mut Budget) -> &Targets {
        let key = (variant, operation);
        if !self.calls.contains_key(&key) {
            let function = &self.program.funcs[variant];
            let op = self.placed[variant]
                .contains(&operation)
                .then(|| function.values.get(operation.0 as usize))
                .flatten();
            let mut targets = Targets::default();
            let direct;
            let names: &[&str] = match op.map(|op| &op.kind) {
                Some(OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                }) => {
                    direct = [name.as_str()];
                    &direct
                }
                Some(OpKind::Call {
                    callee: Callee::Closure { slot } | Callee::Virtual { slot, .. },
                    ..
                }) => self.dispatch.get(slot).map_or(&[], Vec::as_slice),
                _ => &[],
            };
            if names.is_empty() {
                targets.unknown = Some(format!(
                    "no actual compiled call at {}:%{}",
                    function.name, operation.0
                ));
            }
            for &name in names {
                if !budget.charge() {
                    break;
                }
                if let Some(&at) = self.by_name.get(name) {
                    targets
                        .by_origin
                        .entry(self.origins[at].clone())
                        .or_default()
                        .push(at);
                } else {
                    targets
                        .unknown
                        .get_or_insert_with(|| format!("actual target body unavailable: {name}"));
                }
            }
            self.calls.insert(key, targets);
        }
        &self.calls[&key]
    }

    fn home(
        &self,
        variant: usize,
        value: u32,
        storage: Storage,
        provider: Memory,
    ) -> Result<String, String> {
        let function = &self.program.funcs[variant];
        let id = ValueId(value);
        let op = self.placed[variant]
            .contains(&id)
            .then(|| function.values.get(value as usize))
            .flatten()
            .ok_or_else(|| {
                format!(
                    "allocation is no longer placed at {}:%{value}",
                    function.name
                )
            })?;
        if storage == Storage::Native {
            return Err("manual storage has no managed placement observation".to_owned());
        }
        // A frame allocation inside a region clone still belongs to its frame.
        Ok(if matches!(op.kind, OpKind::ObjectNew { frame: true })
            || matches!(op.kind, OpKind::Call { frame: Some(_), .. })
        {
            "frame"
        } else if self.region.contains(&variant) {
            "call-region"
        } else if provider == Memory::HostGc {
            "host"
        } else {
            "heap"
        }
        .to_owned())
    }
}

struct States {
    known: Vec<FxHashSet<usize>>,
    unknown: Vec<Option<String>>,
    pending: VecDeque<(usize, Option<usize>)>,
}

impl States {
    fn known(&mut self, context: usize, variant: usize) {
        if self.known[context].insert(variant) {
            self.pending.push_back((context, Some(variant)));
        }
    }

    fn unknown(&mut self, context: usize, reason: String) {
        if self.unknown[context].is_none() {
            self.unknown[context] = Some(reason);
            self.pending.push_back((context, None));
        }
    }
}

fn follow(inputs: &Inputs, index: &mut Index<'_>, budget: &mut Budget) -> States {
    let mut states = States {
        known: vec![FxHashSet::default(); inputs.contexts.len()],
        unknown: vec![None; inputs.contexts.len()],
        pending: VecDeque::new(),
    };
    let mut calls = vec![Vec::new(); inputs.contexts.len()];
    for call in &inputs.calls {
        if !budget.charge() {
            break;
        }
        calls[call.parent].push(*call);
    }
    for (at, context) in inputs.contexts.iter().enumerate() {
        if !budget.charge() {
            break;
        }
        if !inputs.complete {
            states.unknown(
                at,
                "analysis did not complete its context/call inventory".to_owned(),
            );
        } else if context.root {
            if let Some(&variant) = index.by_name.get(context.function.as_str()) {
                states.known(at, variant);
            } else {
                states.unknown(
                    at,
                    format!("actual entry body unavailable: {}", context.function),
                );
            }
        }
    }
    while let Some((parent, variant)) = states.pending.pop_front() {
        if !budget.charge() || budget.exhausted {
            break;
        }
        for call in &calls[parent] {
            if !budget.charge() {
                break;
            }
            if let Some(variant) = variant {
                let targets = index.resolve(variant, call.operation, budget);
                if let Some(reason) = &targets.unknown {
                    states.unknown(call.child, reason.clone());
                }
                let child = &inputs.contexts[call.child];
                if let Some(variants) = targets.by_origin.get(&child.function) {
                    for &variant in variants {
                        if !budget.charge() {
                            break;
                        }
                        states.known(call.child, variant);
                    }
                } else {
                    states.unknown(
                        call.child,
                        format!(
                            "no actual target for {} at context {parent}, %{}",
                            child.function, call.operation.0
                        ),
                    );
                }
            } else if let Some(reason) = states.unknown[parent].clone() {
                states.unknown(call.child, reason);
            }
        }
    }
    states
}

fn publish(
    report: &mut Report,
    index: &Index<'_>,
    states: &States,
    provider: Memory,
    budget: &mut Budget,
) {
    let inputs = &report.comparison_inputs;
    for site in &mut report.sites {
        let _ = budget.charge();
        site.legacy.clear();
        site.legacy_variants.clear();
        site.legacy_unknown = None;
        let context = site.context_id.0;
        if inputs.contexts.get(context).is_some() {
            site.legacy_unknown.clone_from(&states.unknown[context]);
            if states.known[context].is_empty() && site.legacy_unknown.is_none() {
                site.legacy_unknown =
                    Some("context has no proved post-placement arrival".to_owned());
            }
            let mut variants = states.known[context].iter().copied().collect::<Vec<_>>();
            variants.sort_unstable();
            for variant in variants {
                if !budget.charge() {
                    break;
                }
                match index.home(variant, site.id.value, site.id.storage, provider) {
                    Ok(home) => site.legacy_variants.push(Variant {
                        function: index.program.funcs[variant].name.clone(),
                        home,
                    }),
                    Err(reason) => {
                        site.legacy_unknown.get_or_insert(reason);
                    }
                }
            }
        } else {
            site.legacy_unknown =
                Some("context identity missing from detached inventory".to_owned());
        }
        site.legacy_variants.sort_by(|left, right| {
            (&left.function, &left.home).cmp(&(&right.function, &right.home))
        });
        site.legacy_variants.dedup();
    }
    if budget.exhausted {
        for site in &mut report.sites {
            site.legacy_unknown = Some("legacy comparison work budget".to_owned());
        }
    }
    for site in &mut report.sites {
        site.legacy = site
            .legacy_variants
            .iter()
            .map(|variant| variant.home.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        if let Some(reason) = &site.legacy_unknown {
            site.legacy.push(format!("unknown: {reason}"));
        }
    }
    report.comparison_work = budget.used;
    report.comparison_failure = budget
        .exhausted
        .then(|| "legacy comparison work budget".to_owned());
}

pub(super) fn compare(
    report: &mut Report,
    program: &Program,
    provider: Memory,
    clones: &FxHashMap<String, String>,
) {
    let mut budget = Budget {
        used: 0,
        limit: report.work_limit.saturating_sub(report.work),
        exhausted: false,
    };
    report.legacy_clones.clear();
    for (variant, original) in clones {
        let _ = budget.charge();
        report
            .legacy_clones
            .push((variant.clone(), original.clone()));
    }
    report.legacy_clones.sort_by(|left, right| {
        let _ = budget.charge();
        left.cmp(right)
    });
    let mut index = Index::of(program, clones, &mut budget);
    let states = follow(&report.comparison_inputs, &mut index, &mut budget);
    publish(report, &index, &states, provider, &mut budget);
}
