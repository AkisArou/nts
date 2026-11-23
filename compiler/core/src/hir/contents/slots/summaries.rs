use super::{Analysis, Inputs, Returned, Slot, freshness};
use crate::hir::{self, Func, Layout, OpKind, own::reference_fields};
use crate::hir::{Program, Terminator};
use rustc_hash::{FxHashMap, FxHashSet};

/// One snapshot of the interprocedural slot contracts, consumed before counts
/// are inserted. Return guarantees are unconditional on incoming slot facts;
/// parameter guarantees require every reachable direct caller to vouch for them.
#[derive(Debug, Default)]
pub(in crate::hir) struct Summaries {
    pub(in crate::hir) inputs: FxHashMap<String, Inputs>,
    pub(in crate::hir) returned: Returned,
    pub(in crate::hir) parameters: FxHashMap<String, FxHashSet<(u32, u32)>>,
}

impl Analysis {
    fn returned_fields(&self, func: &Func, layouts: &[Layout]) -> FxHashSet<u32> {
        let mut agreed: Option<FxHashSet<u32>> = None;
        for (block, after) in func.blocks.iter().zip(&self.leaving) {
            let (Terminator::Return(Some(value)), Some(after)) = (&block.terminator, after) else {
                continue;
            };
            // A null path has no object whose field a caller can overwrite.
            if matches!(
                func.value(*value).kind,
                OpKind::ConstNull | OpKind::ConstUndefined
            ) {
                continue;
            }
            let fields: FxHashSet<_> = reference_fields(func, layouts, *value)
                .into_iter()
                .filter(|field| after.known_zero(*value, Slot::Field(*field)))
                .collect();
            agreed = Some(match agreed {
                None => fields,
                Some(before) => before.intersection(&fields).copied().collect(),
            });
        }
        agreed.unwrap_or_default()
    }
}

/// Direct-call dependencies, using the HIR's common iterative SCC owner.
/// Tarjan numbers caller -> callee components bottom-up. No recursive walk or
/// round cap can expose an unfinished optimistic contract.
struct Calls<'a> {
    by_name: FxHashMap<&'a str, usize>,
    component: Vec<usize>,
    members: Vec<Vec<usize>>,
    callers: Vec<Vec<usize>>,
}

impl<'a> Calls<'a> {
    fn of(program: &'a Program) -> Self {
        let by_name: FxHashMap<_, _> = program
            .funcs
            .iter()
            .enumerate()
            .map(|(at, func)| (func.name.as_str(), at))
            .collect();
        let edges: Vec<Vec<usize>> = program
            .funcs
            .iter()
            .map(|func| {
                func.blocks
                    .iter()
                    .flat_map(|block| &block.ops)
                    .filter_map(|id| match &func.value(*id).kind {
                        OpKind::Call {
                            callee: hir::Callee::Direct(name),
                            ..
                        } => by_name.get(name.as_str()).copied(),
                        _ => None,
                    })
                    .collect()
            })
            .collect();
        let component = hir::strongly_connected(&edges);
        let mut members = vec![Vec::new(); component.iter().max().map_or(0, |at| at + 1)];
        let mut callers = vec![Vec::new(); program.funcs.len()];
        for (at, callees) in edges.iter().enumerate() {
            members[component[at]].push(at);
            for callee in callees {
                callers[*callee].push(at);
            }
        }
        Self {
            by_name,
            component,
            members,
            callers,
        }
    }
}

fn return_contracts(
    program: &Program,
    layouts: &[Layout],
    harmless: &FxHashSet<String>,
    calls: &Calls<'_>,
    inputs: &FxHashMap<String, Inputs>,
) -> Returned {
    let mut returned = Returned::default();
    let empty = FxHashSet::default();
    // Least fixpoint, bottom-up: at most one insertion per function/return
    // field. A recursive return alone cannot manufacture a null guarantee.
    // Revisit only callers in this component; later components see its fixpoint.
    for (component, members) in calls.members.iter().enumerate() {
        let mut pending: std::collections::VecDeque<_> = members.iter().copied().collect();
        let mut queued: FxHashSet<_> = members.iter().copied().collect();
        while let Some(at) = pending.pop_front() {
            queued.remove(&at);
            let func = &program.funcs[at];
            if !matches!(
                func.return_type,
                hir::HirType::Managed(hir::ManagedType::Object(_))
            ) {
                continue;
            }
            let fields = freshness(
                func,
                layouts,
                harmless,
                &empty,
                &returned,
                &inputs[&func.name],
            )
            .returned_fields(func, layouts);
            let previous = returned.entry(func.name.clone()).or_default();
            if fields == *previous {
                continue;
            }
            debug_assert!(previous.is_subset(&fields));
            *previous = fields;
            for caller in &calls.callers[at] {
                if calls.component[*caller] == component && queued.insert(*caller) {
                    pending.push_back(*caller);
                }
            }
        }
    }

    returned
}

fn parameter_candidates(
    program: &Program,
    layouts: &[Layout],
) -> FxHashMap<String, FxHashSet<(u32, u32)>> {
    let mut parameters = FxHashMap::default();
    let direct_only = invoked_only_directly(program, layouts);
    for func in &program.funcs {
        let mut fields = FxHashSet::default();
        if direct_only.contains(func.name.as_str()) {
            for (slot, value) in func
                .parameter_values()
                .unwrap_or_default()
                .into_iter()
                .enumerate()
            {
                let (Ok(slot), Some(value)) = (u32::try_from(slot), value) else {
                    continue;
                };
                fields.extend(
                    reference_fields(func, layouts, value)
                        .into_iter()
                        .map(|field| (slot, field)),
                );
            }
        }
        parameters.insert(func.name.clone(), fields);
    }
    parameters
}

pub(in crate::hir) fn summarize(
    program: &Program,
    layouts: &[Layout],
    harmless: &FxHashSet<String>,
) -> Summaries {
    let calls = Calls::of(program);
    let inputs = program
        .funcs
        .iter()
        .map(|func| {
            (
                func.name.clone(),
                Inputs::of(func, layouts, &program.globals),
            )
        })
        .collect();
    let mut result = Summaries {
        returned: return_contracts(program, layouts, harmless, &calls, &inputs),
        inputs,
        parameters: parameter_candidates(program, layouts),
    };
    // Greatest fixpoint, top-down: at most one removal per parameter/field.
    // A changed callee contract requeues that callee (not all functions), so its
    // callers' accepted facts reach the next component and recursive forwarding
    // settles within this component. Both phases have finite, explicit heights.
    for (component, members) in calls.members.iter().enumerate().rev() {
        let mut pending: std::collections::VecDeque<_> = members.iter().copied().collect();
        let mut queued: FxHashSet<_> = members.iter().copied().collect();
        while let Some(at) = pending.pop_front() {
            queued.remove(&at);
            let func = &program.funcs[at];
            let needs_facts = func.blocks.iter().flat_map(|block| &block.ops).any(|id| {
                matches!(&func.value(*id).kind, OpKind::Call { callee: hir::Callee::Direct(name), .. }
                    if result.parameters.get(name).is_some_and(|fields| !fields.is_empty()))
            });
            if !needs_facts {
                continue;
            }
            let analysis = freshness(
                func,
                layouts,
                harmless,
                &result.parameters[&func.name],
                &result.returned,
                &result.inputs[&func.name],
            );
            for ((block, entering), reachable) in func
                .blocks
                .iter()
                .zip(analysis.entering)
                .zip(analysis.leaving)
            {
                if reachable.is_none() {
                    continue;
                }
                let mut state = entering;
                for id in &block.ops {
                    let kind = &func.value(*id).kind;
                    if let OpKind::Call {
                        callee: hir::Callee::Direct(name),
                        args,
                        ..
                    } = kind
                        && let Some(fields) = result.parameters.get_mut(name)
                    {
                        let old_len = fields.len();
                        fields.retain(|(slot, field)| {
                            args.get(*slot as usize)
                                .is_some_and(|value| state.known_zero(*value, Slot::Field(*field)))
                        });
                        if fields.len() != old_len
                            && let Some(&callee) = calls.by_name.get(name.as_str())
                            && calls.component[callee] == component
                            && queued.insert(callee)
                        {
                            pending.push_back(callee);
                        }
                    }
                    state.observe(
                        func,
                        *id,
                        kind,
                        harmless,
                        &result.returned,
                        &result.inputs[&func.name],
                    );
                }
            }
        }
    }
    result
}

/// Functions whose every caller is a direct call in this program.
///
/// The callers the slot summary can read, and so the only functions it may
/// say anything about. Not exported, because the code calling an export is not
/// here. Not in any layout's method table, because a dispatch or a closure call
/// reaches it through a slot. Not a suspension's resume, because the runtime
/// calls that. And called directly at least once: an assumption over no callers
/// is true of every caller only because there are none to check.
fn invoked_only_directly<'a>(
    program: &'a Program,
    layouts: &'a [Layout],
) -> rustc_hash::FxHashSet<&'a str> {
    let mut indirect: rustc_hash::FxHashSet<&str> = layouts
        .iter()
        .flat_map(|layout| layout.methods.iter().flatten())
        .map(String::as_str)
        .chain(program.interface_access.defaults().map(|(_, body)| body))
        .collect();
    indirect.extend(hir::reachable::outside_callers(program));
    let mut called: rustc_hash::FxHashSet<&str> = rustc_hash::FxHashSet::default();
    for func in &program.funcs {
        for op in &func.values {
            match &op.kind {
                OpKind::Call {
                    callee: hir::Callee::Direct(name),
                    ..
                } => {
                    called.insert(name.as_str());
                }
                OpKind::Suspend { resume, .. } => {
                    indirect.insert(resume.as_str());
                }
                _ => {}
            }
        }
    }
    called.retain(|name| !indirect.contains(name));
    called
}
