//! Preserve incoming slot facts where a shared entry or loop header meets them.
//!
//! Only original bodies are candidates. Copies never feed another versioning
//! round. The ordinary slot summary is rebuilt after the rewrite and proves
//! each private entry's contract from its actual callers.

use std::collections::BTreeMap;

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Inputs, Slot, Summaries, freshness};
use crate::hir::{self, BlockId, Callee, Func, OpKind, Program, Terminator, ValueId};

const VARIANTS: usize = 4;

#[cfg(test)]
mod tests;

/// A committed copy and the additional old-slot releases it makes unnecessary.
/// This counts static opportunities, not a claim about execution frequency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub original: String,
    pub entry: String,
    pub duplicated: usize,
    pub removed: usize,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Versioning {
    pub original_ops: usize,
    pub duplicated_ops: usize,
    pub versions: Vec<Version>,
    pub capped: Vec<String>,
    pub exhausted: Vec<&'static str>,
}

type Shape = Vec<(u32, u32)>;
type Key = (usize, Shape);

#[derive(Clone)]
struct Entry {
    name: String,
    removed: usize,
}

struct Planner<'a> {
    program: &'a Program,
    releases: &'a hir::ForeignReleases,
    harmless: &'a FxHashSet<String>,
    summaries: &'a Summaries,
    targets: FxHashMap<String, usize>,
    fields: FxHashMap<usize, Shape>,
    entries: BTreeMap<Key, Entry>,
    gains: BTreeMap<Key, usize>,
    baseline: FxHashMap<usize, FxHashSet<ValueId>>,
    counts: FxHashMap<usize, usize>,
    selected: Vec<Key>,
    work: usize,
    report: Versioning,
}

fn size(func: &Func) -> usize {
    func.blocks
        .iter()
        .map(|block| block.params.len() + block.ops.len() + 1)
        .sum()
}

impl Planner<'_> {
    fn spend_work(&mut self, amount: usize) -> bool {
        if amount > self.work {
            self.exhausted("slot version analysis work");
            return false;
        }
        self.work -= amount;
        true
    }

    fn exhausted(&mut self, reason: &'static str) {
        if !self.report.exhausted.contains(&reason) {
            self.report.exhausted.push(reason);
        }
    }

    fn charge(&mut self, amount: usize) -> bool {
        if amount > self.report.original_ops - self.report.duplicated_ops {
            self.exhausted("slot version HIR growth");
            return false;
        }
        self.report.duplicated_ops += amount;
        true
    }

    fn gain(&mut self, key: &Key) -> usize {
        if let Some(&gain) = self.gains.get(key) {
            return gain;
        }
        let at = key.0;
        if self.at_cap(at) {
            return 0;
        }
        let program = self.program;
        let func = &program.funcs[at];
        if !self.spend_work(size(func).saturating_mul(2)) {
            return 0;
        }
        let base = self
            .baseline
            .entry(at)
            .or_insert_with(|| initializing(func, self.harmless, self.summaries, None));
        let shape: FxHashSet<_> = key.1.iter().copied().collect();
        let specialized = initializing(func, self.harmless, self.summaries, Some(&shape));
        let gain = specialized.difference(base).count();
        self.gains.insert(key.clone(), gain);
        gain
    }

    fn at_cap(&self, at: usize) -> bool {
        self.counts.get(&at).copied().unwrap_or(0) == VARIANTS
    }

    fn select(&mut self, key: &Key, removed: usize) -> bool {
        if self.entries.contains_key(key) {
            return true;
        }
        if removed == 0 || self.at_cap(key.0) || !self.charge(size(&self.program.funcs[key.0])) {
            return false;
        }
        let original = &self.program.funcs[key.0].name;
        let fields = key
            .1
            .iter()
            .map(|(p, f)| format!("{p}.{f}"))
            .collect::<Vec<_>>()
            .join("_");
        let name = format!("@slots:{original}:{fields}");
        self.report.versions.push(Version {
            original: original.clone(),
            entry: name.clone(),
            duplicated: size(&self.program.funcs[key.0]),
            removed,
        });
        self.entries.insert(key.clone(), Entry { name, removed });
        self.selected.push(key.clone());
        *self.counts.entry(key.0).or_default() += 1;
        true
    }

    fn sites(
        &mut self,
        func: &Func,
        original_inputs: Option<&Inputs>,
    ) -> Vec<(ValueId, Key, usize)> {
        if !self.spend_work(size(func)) {
            return Vec::new();
        }
        let created;
        let inputs = if let Some(inputs) = original_inputs {
            inputs
        } else {
            created = Inputs::of(
                func,
                &self.program.layouts,
                &self.program.globals,
                self.releases,
            );
            &created
        };
        let analysis = freshness(
            func,
            &self.program.layouts,
            self.harmless,
            &self.summaries.parameters[&func.name],
            &self.summaries.returned,
            inputs,
        );
        let mut sites = Vec::new();
        for ((block, mut state), after) in func
            .blocks
            .iter()
            .zip(analysis.entering)
            .zip(analysis.leaving)
        {
            if after.is_none() {
                continue;
            }
            for &id in &block.ops {
                let kind = &func.value(id).kind;
                state.before(id, inputs);
                if let OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                    ..
                } = kind
                    && let Some(&target) = self.targets.get(name)
                {
                    // Target parameter definitions are scanned once, not once
                    // per call to a potentially large body.
                    let mut shape: Shape = self.fields[&target]
                        .iter()
                        .copied()
                        .filter(|&(slot, field)| {
                            args.get(slot as usize)
                                .is_some_and(|&arg| state.known_zero(arg, Slot::Field(field)))
                        })
                        .collect();
                    shape.sort_unstable();
                    shape.dedup();
                    if !shape.is_empty()
                        && shape
                            .iter()
                            .any(|fact| !self.summaries.parameters[name].contains(fact))
                    {
                        let key = (target, shape);
                        let gain = self.gain(&key);
                        if gain > 0 {
                            sites.push((id, key, gain));
                        }
                    }
                }
                state.observe(
                    func,
                    id,
                    kind,
                    self.harmless,
                    &self.summaries.returned,
                    inputs,
                );
            }
        }
        sites
    }
}

fn initializing(
    func: &Func,
    harmless: &FxHashSet<String>,
    summaries: &Summaries,
    shape: Option<&FxHashSet<(u32, u32)>>,
) -> FxHashSet<ValueId> {
    let inputs = &summaries.inputs[&func.name];
    let analysis = freshness(
        func,
        &[],
        harmless,
        shape.unwrap_or(&summaries.parameters[&func.name]),
        &summaries.returned,
        inputs,
    );
    let mut stores = FxHashSet::default();
    for ((block, mut state), after) in func
        .blocks
        .iter()
        .zip(analysis.entering)
        .zip(analysis.leaving)
    {
        if after.is_none() {
            continue;
        }
        for &id in &block.ops {
            let kind = &func.value(id).kind;
            state.before(id, inputs);
            if let OpKind::FieldSet { value, .. } = kind
                && func.value(*value).ty.may_hold_a_reference()
                && state.initializing(func, kind)
            {
                stores.insert(id);
            }
            state.observe(func, id, kind, harmless, &summaries.returned, inputs);
        }
    }
    stores
}

/// One bounded planning pass over original callers. Entry bodies copy all Func
/// semantic metadata unchanged (signature, raising mode, absence and origins).
/// Constructors, suspension/region bodies and interface storage grants are
/// excluded. No publication, dispatch or foreign target is redirected, and all
/// name-keyed analysis/backend indexes are rebuilt after this rewrite.
pub(in crate::hir) fn materialize(
    program: &mut Program,
    ownership: &hir::own::Summaries,
) -> Versioning {
    let (harmless, summaries) = ownership.slot_contracts();
    let original_ops: usize = program.funcs.iter().map(size).sum();
    if !hir::own::eliding() {
        return Versioning {
            original_ops,
            ..Versioning::default()
        };
    }
    let direct = super::summaries::invoked_only_directly(program, &program.layouts);
    let targets: FxHashMap<_, _> = program
        .funcs
        .iter()
        .enumerate()
        .filter(|(_, func)| {
            direct.contains(func.name.as_str())
                && eligible(program, func)
                && func
                    .blocks
                    .iter()
                    .flat_map(|block| &block.ops)
                    .any(|&id| matches!(func.value(id).kind, OpKind::FieldSet { .. }))
        })
        .map(|(at, func)| (func.name.clone(), at))
        .collect();
    if targets.is_empty() {
        return Versioning {
            original_ops,
            ..Versioning::default()
        };
    }
    let source: &Program = program;
    let fields = targets
        .values()
        .map(|&at| {
            let func = &source.funcs[at];
            let fields = func
                .parameter_values()
                .unwrap_or_default()
                .into_iter()
                .enumerate()
                .filter_map(|(slot, value)| Some((u32::try_from(slot).ok()?, value?)))
                .flat_map(|(slot, value)| {
                    hir::own::reference_fields(func, &source.layouts, value)
                        .into_iter()
                        .map(move |field| (slot, field))
                })
                .collect();
            (at, fields)
        })
        .collect();
    let releases = program.foreign_releases();
    let mut planner = Planner {
        program,
        releases: &releases,
        harmless,
        summaries,
        targets,
        fields,
        entries: BTreeMap::new(),
        gains: BTreeMap::new(),
        baseline: FxHashMap::default(),
        counts: FxHashMap::default(),
        selected: Vec::new(),
        work: original_ops.saturating_mul(32),
        report: Versioning {
            original_ops,
            ..Versioning::default()
        },
    };
    let mut rewritten = Vec::new();
    for (at, func) in program.funcs.iter().enumerate() {
        if hir::regions::is_clone(&func.name) || !func.blocks.iter().flat_map(|block| &block.ops).any(|&id| {
            matches!(&func.value(id).kind, OpKind::Call { callee: Callee::Direct(name), .. } if planner.targets.contains_key(name))
        }) { continue; }
        let sites = planner.sites(func, Some(&summaries.inputs[&func.name]));
        for (_, key, gain) in &sites {
            planner.select(key, *gain);
        }
        let mut replacement = None;
        if eligible(program, func)
            && planner.spend_work(size(func).saturating_mul(8))
            && let Some((mut trial, copied, duplicated)) = first_arrival(func, &mut planner)
        {
            let checkpoint = (
                planner.report.duplicated_ops,
                planner.report.versions.len(),
                planner.selected.len(),
            );
            if planner.charge(duplicated) {
                let trial_sites = planner.sites(&trial, None);
                let original_gain: FxHashMap<_, _> =
                    sites.iter().map(|(id, _, gain)| (*id, *gain)).collect();
                let mut removed = 0;
                for (id, key, gain) in &trial_sites {
                    if let Some(source) = copied.get(id)
                        && *gain > original_gain.get(source).copied().unwrap_or(0)
                        && planner.select(key, *gain)
                    {
                        removed += gain - original_gain.get(source).copied().unwrap_or(0);
                    }
                }
                if removed > 0 {
                    planner.report.versions.push(Version {
                        original: func.name.clone(),
                        entry: format!("{}:first-arrival", func.name),
                        duplicated,
                        removed,
                    });
                    redirect(&mut trial, &trial_sites, &planner.entries);
                    hir::dce::prune_unreachable(&mut trial);
                    hir::dce::collect(&mut trial);
                    replacement = Some(trial);
                }
            }
            if replacement.is_none() {
                for key in planner.selected.drain(checkpoint.2..) {
                    planner.entries.remove(&key);
                    *planner
                        .counts
                        .get_mut(&key.0)
                        .expect("a selected entry was counted") -= 1;
                }
                planner.report.duplicated_ops = checkpoint.0;
                planner.report.versions.truncate(checkpoint.1);
            }
        }
        if replacement.is_none()
            && !sites
                .iter()
                .any(|(_, key, _)| planner.entries.contains_key(key))
        {
            continue;
        }
        let mut replacement = replacement.unwrap_or_else(|| func.clone());
        redirect(&mut replacement, &sites, &planner.entries);
        rewritten.push((at, replacement));
    }
    let entries = planner
        .entries
        .iter()
        .map(|((at, _), entry)| {
            debug_assert!(entry.removed > 0);
            let mut body = program.funcs[*at].clone();
            body.name.clone_from(&entry.name);
            body.exported = false;
            body
        })
        .collect::<Vec<_>>();
    planner.report.capped = planner
        .counts
        .iter()
        .filter(|(_, count)| **count == VARIANTS)
        .map(|(at, _)| program.funcs[*at].name.clone())
        .collect();
    planner.report.capped.sort();
    let report = planner.report;
    debug_assert!(report.duplicated_ops <= report.original_ops);
    debug_assert!(report.versions.iter().all(|version| version.removed > 0));
    for (at, func) in rewritten {
        program.funcs[at] = func;
    }
    program.funcs.extend(entries);
    report
}

fn eligible(program: &Program, func: &Func) -> bool {
    !func.initializes_receiver
        && !func.abstract_declaration
        && func.async_result.is_none()
        && func.frame.is_none()
        && func.validation.is_none()
        && !hir::regions::is_clone(&func.name)
        && !program
            .interface_access
            .storage_bodies
            .contains_key(&func.name)
        && !program.constructed_as.contains_key(&func.name)
        && !program.guarded_dispatch.contains_key(&func.name)
        && func
            .values
            .iter()
            .all(|op| !matches!(op.kind, OpKind::Suspend { .. } | OpKind::Await { .. }))
}

fn redirect(func: &mut Func, sites: &[(ValueId, Key, usize)], entries: &BTreeMap<Key, Entry>) {
    for (id, key, _) in sites {
        if let Some(entry) = entries.get(key)
            && let OpKind::Call {
                callee: Callee::Direct(name),
                ..
            } = &mut func.values[id.0 as usize].kind
        {
            name.clone_from(&entry.name);
        }
    }
}

/// Copy one first-arrival region, including its dominated continuations. Any
/// backedge goes to the original header; shared exits keep their existing SSA
/// arguments. A direct live-out would require a new join, so that candidate
/// stays generic. This is a proof restriction, never an optimistic SSA repair.
fn first_arrival(
    func: &Func,
    planner: &mut Planner<'_>,
) -> Option<(Func, FxHashMap<ValueId, ValueId>, usize)> {
    let summaries = planner.summaries;
    let dominates = hir::loops::dominance(func);
    let incoming = hir::loops::predecessors(func);
    let inputs = &summaries.inputs[&func.name];
    let analysis = freshness(
        func,
        &planner.program.layouts,
        planner.harmless,
        &planner.summaries.parameters[&func.name],
        &planner.summaries.returned,
        inputs,
    );
    for (header, predecessors) in incoming.iter().enumerate() {
        let header = BlockId(u32::try_from(header).ok()?);
        if !predecessors
            .iter()
            .any(|(from, _)| dominates(header, *from))
        {
            continue;
        }
        if !planner.spend_work(size(func)) {
            return None;
        }
        let entries: Vec<_> = predecessors
            .iter()
            .filter(|(from, _)| !dominates(header, *from))
            .collect();
        let [(entry, arguments)] = entries.as_slice() else {
            continue;
        };
        let Some(before) = &analysis.leaving[entry.0 as usize] else {
            continue;
        };
        let region: FxHashSet<_> = (0..func.blocks.len())
            .map(|i| BlockId(u32::try_from(i).unwrap()))
            .filter(|&block| dominates(header, block))
            .collect();
        let useful = region.iter().any(|block| {
            func.blocks[block.0 as usize].ops.iter().any(|&id| {
                let OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                    ..
                } = &func.value(id).kind
                else {
                    return false;
                };
                planner.targets.contains_key(name)
                    && args.iter().any(|&arg| {
                        hir::own::reference_fields(func, &planner.program.layouts, arg)
                            .iter()
                            .any(|&field| {
                                before.known_zero(arg, Slot::Field(field))
                                    && !analysis.entering[header.0 as usize]
                                        .known_zero(arg, Slot::Field(field))
                            })
                    })
            })
        });
        if !useful {
            continue;
        }
        let defined: FxHashSet<_> = region
            .iter()
            .flat_map(|at| {
                let block = &func.blocks[at.0 as usize];
                block.params.iter().chain(&block.ops).copied()
            })
            .collect();
        let has_live_out = func.blocks.iter().enumerate().any(|(at, block)| {
            !region.contains(&BlockId(u32::try_from(at).unwrap()))
                && (block.ops.iter().any(|&id| {
                    hir::operands_of(&func.value(id).kind)
                        .iter()
                        .any(|id| defined.contains(id))
                }) || hir::operands_of_terminator(&block.terminator)
                    .iter()
                    .any(|id| defined.contains(id)))
        });
        if has_live_out {
            continue;
        }
        let cost: usize = region
            .iter()
            .map(|at| {
                let block = &func.blocks[at.0 as usize];
                block.params.len() + block.ops.len() + 1
            })
            .sum();
        if cost > planner.report.original_ops - planner.report.duplicated_ops {
            planner.exhausted("slot version HIR growth");
            return None;
        }
        return copy_arrival(func, header, *entry, arguments, &region);
    }
    None
}

fn copy_arrival(
    func: &Func,
    header: BlockId,
    entry: BlockId,
    arguments: &[ValueId],
    region: &FxHashSet<BlockId>,
) -> Option<(Func, FxHashMap<ValueId, ValueId>, usize)> {
    let mut trial = func.clone();
    let mut blocks = FxHashMap::default();
    let mut values = FxHashMap::default();
    let mut copied = FxHashMap::default();
    let first = trial.values.len();
    let mut duplicated = 0;
    for (at, block) in func.blocks.iter().enumerate() {
        let at = BlockId(u32::try_from(at).ok()?);
        if !region.contains(&at) {
            continue;
        }
        blocks.insert(
            at,
            BlockId(u32::try_from(func.blocks.len() + blocks.len()).ok()?),
        );
        duplicated += block.params.len() + block.ops.len() + 1;
        for &id in block.params.iter().chain(&block.ops) {
            let to = ValueId(u32::try_from(trial.values.len()).ok()?);
            values.insert(id, to);
            copied.insert(to, id);
            trial.values.push(func.value(id).clone());
            if let Some(exact) = func.exact.get(&id) {
                trial.exact.insert(to, exact.clone());
            }
        }
    }
    // The copied header has exactly the outside edge as predecessor. Its
    // arguments dominate the whole copy, so uses may name them directly.
    let forwarding: FxHashMap<_, _> = func.blocks[header.0 as usize]
        .params
        .iter()
        .copied()
        .zip(arguments.iter().copied())
        .collect();
    let of = |id| {
        forwarding
            .get(&id)
            .copied()
            .or_else(|| values.get(&id).copied())
            .unwrap_or(id)
    };
    for op in &mut trial.values[first..] {
        hir::simplify::substitute(&mut op.kind, of);
    }
    for (at, block) in func.blocks.iter().enumerate() {
        let at = BlockId(u32::try_from(at).ok()?);
        if !region.contains(&at) {
            continue;
        }
        let mut block = block.clone();
        block.params = block.params.iter().map(|id| values[id]).collect();
        block.ops = block.ops.iter().map(|id| values[id]).collect();
        hir::simplify::substitute_terminator(&mut block.terminator, of);
        targets(&mut block.terminator, |target| {
            if target == header {
                header
            } else {
                blocks.get(&target).copied().unwrap_or(target)
            }
        });
        trial.blocks.push(block);
    }
    targets(&mut trial.blocks[entry.0 as usize].terminator, |target| {
        if target == header {
            blocks[&header]
        } else {
            target
        }
    });
    // Let the existing numeric owner fold the copied first iteration's guard
    // (e.g. j > 1 at j = 1). Do not introduce new field-value folds here.
    let facts = hir::flow::analyze(&trial);
    let mut folded = trial.clone();
    hir::fold::fold(&mut folded, &facts);
    for at in 0..trial.values.len() {
        if matches!(
            trial.values[at].kind,
            OpKind::Binary { .. } | OpKind::Convert(_) | OpKind::Unary { .. }
        ) && matches!(
            folded.values[at].kind,
            OpKind::ConstBool(_) | OpKind::ConstInt(_) | OpKind::ConstFloat(_)
        ) {
            trial.values[at].kind = folded.values[at].kind.clone();
        }
    }
    for block in &mut trial.blocks {
        if let Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } = &block.terminator
            && let OpKind::ConstBool(answer) = trial.values[cond.0 as usize].kind
        {
            block.terminator = Terminator::Jump {
                target: if answer { *then_target } else { *else_target },
                args: if answer {
                    then_args.clone()
                } else {
                    else_args.clone()
                },
            };
        }
    }
    Some((trial, copied, duplicated))
}

fn targets(terminator: &mut Terminator, of: impl Fn(BlockId) -> BlockId) {
    match terminator {
        Terminator::Jump { target, .. } => *target = of(*target),
        Terminator::Branch {
            then_target,
            else_target,
            ..
        } => {
            *then_target = of(*then_target);
            *else_target = of(*else_target);
        }
        _ => {}
    }
}
