//! Borrowed publication adapters over a single consuming implementation.
//!
//! This is a rewrite, before counting, driven by `own::consuming`. Publication
//! and dispatch keep the original function; only placed direct calls change.
//! The body is moved, not copied, and the ordinary ownership pass counts both
//! functions. In particular the adapter's borrowed arguments cannot be moved:
//! its call retains exactly the references the consuming implementation takes.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::hir::{Block, Callee, Func, HirType, Op, OpKind, Program, Terminator, ValueId};

/// Keep the private name outside any published class's `Owner#member` space.
const PREFIX: &str = "@consuming:";

/// The source identity of an implementation, for user-facing diagnostics.
#[must_use]
pub fn source_name(name: &str) -> &str {
    name.strip_prefix(PREFIX).unwrap_or(name)
}

/// The entry rewrite's decision, carried with preparation rather than
/// recomputed by listings or stored as part of the executable program.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryDecision {
    pub function: String,
    pub kind: EntryDecisionKind,
    pub reason: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryDecisionKind {
    Selected,
    Excluded,
    Implementation,
}

impl EntryDecisionKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Selected => "selected",
            Self::Excluded => "excluded",
            Self::Implementation => "implementation",
        }
    }
}

/// A slot copy has only redirected direct callers and inherits its source
/// body's handoff contract. It needs no separate borrowed/consuming split.
/// Keep historical consuming decisions: diagnostic lineage still needs them
/// after reachability removes an adapter or its original private body.
pub(in crate::hir) fn record_slot_copies(
    decisions: &mut Vec<EntryDecision>,
    copies: &[crate::hir::contents::slots::versioning::Lineage],
) {
    decisions.extend(copies.iter().filter(|copy| copy.function != copy.source).map(|copy| {
        EntryDecision {
            function: copy.function.clone(),
            kind: EntryDecisionKind::Excluded,
            reason: "private slot entry inherits its handoff contract and has no borrowed arrivals",
        }
    }));
    decisions.sort_by(|left, right| left.function.cmp(&right.function));
}

/// Actual bodies created by this rewrite, paired with their source entries.
/// Diagnostic readers consume this result rather than infer entry provenance
/// from a function's spelling or repeat the selection analysis.
pub(in crate::hir) fn implementations(
    decisions: &[EntryDecision],
) -> impl Iterator<Item = (&str, &str)> {
    decisions
        .iter()
        .filter(|decision| decision.kind == EntryDecisionKind::Implementation)
        .map(|decision| (source_name(&decision.function), decision.function.as_str()))
}

/// Materialize only useful consuming entries, after all call reshaping and
/// placement, before the ownership summary and its counting pass.
pub(in crate::hir) fn materialize(program: &mut Program) -> Vec<EntryDecision> {
    let mut decisions = plan(program);
    let entries: FxHashMap<String, String> = decisions
        .iter()
        .filter(|decision| decision.kind == EntryDecisionKind::Selected)
        .map(|decision| {
            (
                decision.function.clone(),
                format!("{PREFIX}{}", decision.function),
            )
        })
        .collect();
    if entries.is_empty() {
        return decisions;
    }

    // Do this before constructing the adapters: their one direct call must
    // remain a call to the implementation, and recursive calls move with it.
    for func in &mut program.funcs {
        for block in &func.blocks {
            for id in &block.ops {
                if let OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                } = &mut func.values[id.0 as usize].kind
                    && let Some(body) = entries.get(name)
                {
                    name.clone_from(body);
                }
            }
        }
    }

    let mut bodies = Vec::with_capacity(entries.len());
    for entry in &mut program.funcs {
        if let Some(name) = entries.get(&entry.name) {
            bodies.push(move_body(entry, name));
            decisions.push(EntryDecision {
                function: name.clone(),
                kind: EntryDecisionKind::Implementation,
                reason: "consuming implementation for direct callers",
            });
        }
    }
    program.funcs.extend(bodies);
    move_metadata(program, &entries);
    decisions.sort_by(|a, b| a.function.cmp(&b.function));
    decisions
}

/// Metadata disposition at this rewrite (entry means the borrowed adapter):
///
/// | Owner / table | Disposition |
/// | --- | --- |
/// | `Func values, blocks, exact, validation` | Move with the executable body. |
/// | `Func signature, raises, origins, result absence` | Same contract on both entries. |
/// | `Func name, exported` | Source identity on entry; private, unexported body. |
/// | `Func obligations` | Already discharged; must be empty. |
/// | `Func constructor, abstract, async/frame roles` | Excluded, never copied. |
/// | `interface_access.storage_bodies` | Move the existing field-access grant. |
/// | `interface_access.default_bodies` | Getter body role; selection excludes it. |
/// | `interface_access families, callable, defaults` | Keep selectors and their borrowed entry targets. |
/// | `interface_access native_views, materialized, receivers, by_field, by_selector, selectors` | Keep type/storage planning facts and indexes. |
/// | `receiving, identity_projections` | Keep logical ABI/value relations; the entry still implements them. |
/// | `guarded_dispatch, constructed_as, generators` | Body roles excluded by selection, asserted below. |
/// | `layouts.methods, printed/printed_classes, foreign_classes` | Keep borrowed dispatch/printing/foreign targets. |
/// | `public_api/namespaces/functions, roots, opaque_signatures, optional_scalars` | Keep publication names and boundary contracts. |
/// | `function_names, member_origins, uncompiled` | Keep observable source identities and refusal causes. |
/// | `NativeBridge/NativeCallback targets in ops` | Keep borrowed targets; only Direct calls are rewritten. |
/// | `native_dispatch; ownership/bounds/backend name indexes` | Not built yet; rebuilt from final functions. |
/// | `remaining Program type/layout/global/module tables` | Not keyed by executable function identity; unchanged. |
/// | `detached memory::Report (outside Program)` | Keep source sites/contexts; `compare_legacy` uses our decisions to resolve moved bodies. |
/// | `region_lineage (outside Program)` | Keep region identities; consuming bodies are not region clones. |
/// | `plan's direct/borrowed/suspension/effect indexes` | Temporary, dropped before mutation; never reused. |
///
/// Both this Program pattern and `move_body`'s Func pattern are exhaustive: a
/// new field must receive a disposition here instead of silently going stale.
fn move_metadata(program: &mut Program, entries: &FxHashMap<String, String>) {
    let Program {
        funcs,
        interface_access,
        native_dispatch,
        guarded_dispatch,
        constructed_as,
        generators,
        member_origins: _,
        closure_slot: _,
        erased_call_slot: _,
        receiving: _,
        identity_projections: _,
        raising_members: _,
        printed: _,
        printed_classes: _,
        typed_signatures: _,
        function_names: _,
        raising_call_slot: _,
        record_parents: _,
        signature_faces: _,
        disputed_layouts: _,
        native_headers: _,
        native_defines: _,
        objc: _,
        native_frameworks: _,
        native_libraries: _,
        native_packages: _,
        foreign: _,
        layouts: _,
        view_classes: _,
        foreign_classes: _,
        classes: _,
        plain_records: _,
        interface_identities: _,
        cast_faces: _,
        globals: _,
        provider: _,
        backend: _,
        entry_unwind: _,
        targets: _,
        roots: _,
        callbacks_checkpoint: _,
        public_api: _,
        abstract_generators: _,
        public_namespaces: _,
        unpublished_modules: _,
        opaque_signatures: _,
        optional_scalars: _,
        public_functions: _,
        uncompiled: _,
        module_evaluation_cuts: _,
    } = program;
    debug_assert!(native_dispatch.is_none(), "native tables are planned later");
    for (entry, body) in entries {
        if let Some(owner) = interface_access.storage_bodies.remove(entry) {
            let previous = interface_access.storage_bodies.insert(body.clone(), owner);
            debug_assert!(previous.is_none(), "a moved body has one storage grant");
        }
        debug_assert!(!interface_access.storage_bodies.contains_key(entry));
        debug_assert!(!interface_access.default_bodies.contains_key(entry));
        debug_assert!(!guarded_dispatch.contains_key(entry));
        debug_assert!(!constructed_as.contains_key(entry));
        debug_assert!(
            generators
                .iter()
                .all(|generator| { generator.constructor != *entry && generator.resume != *entry })
        );
    }
    debug_assert!(storage_grants_name_their_bodies(
        funcs,
        &interface_access.storage_bodies,
        entries
    ));
}

fn storage_grants_name_their_bodies(
    funcs: &[Func],
    grants: &std::collections::BTreeMap<String, crate::hir::TypeId>,
    entries: &FxHashMap<String, String>,
) -> bool {
    let by_name: FxHashMap<_, _> = funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    grants.iter().all(|(name, owner)| {
        !entries.contains_key(name)
            && by_name.get(name.as_str()).is_some_and(|func| {
                func.params.first().is_some_and(|parameter| {
                    parameter.ty == HirType::Managed(crate::hir::ManagedType::Object(*owner))
                })
            })
    })
}

fn plan(program: &Program) -> Vec<EntryDecision> {
    let direct = direct_callers(program);
    let borrowed = crate::hir::reachable::borrowed_names(program);
    let suspended = suspension_entries(program);
    let effects = crate::hir::memory::outcomes::DirectEffects::of(program);
    let mut decisions: Vec<_> = program
        .funcs
        .iter()
        .map(|func| {
            let reason = exclusion(func, program, &direct, &borrowed, &suspended, &effects);
            EntryDecision {
                function: func.name.clone(),
                kind: if reason.is_none() {
                    EntryDecisionKind::Selected
                } else {
                    EntryDecisionKind::Excluded
                },
                reason: reason
                    .unwrap_or("consuming parameter, direct caller and borrowed entry use"),
            }
        })
        .collect();
    decisions.sort_by(|a, b| a.function.cmp(&b.function));
    decisions
}

fn direct_callers(program: &Program) -> FxHashSet<&str> {
    program
        .funcs
        .iter()
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| &block.ops)
                .filter_map(|id| match &func.value(*id).kind {
                    OpKind::Call {
                        callee: Callee::Direct(name),
                        ..
                    } => Some(name.as_str()),
                    _ => None,
                })
        })
        .collect()
}

fn suspension_entries(program: &Program) -> FxHashSet<&str> {
    program
        .generators
        .iter()
        .flat_map(|generator| [generator.constructor.as_str(), generator.resume.as_str()])
        .chain(program.funcs.iter().flat_map(|func| {
            func.values.iter().filter_map(|op| match &op.kind {
                OpKind::Suspend { resume, .. } => Some(resume.as_str()),
                _ => None,
            })
        }))
        .collect()
}

fn exclusion(
    func: &Func,
    program: &Program,
    direct: &FxHashSet<&str>,
    borrowed: &FxHashSet<&str>,
    suspended: &FxHashSet<&str>,
    effects: &crate::hir::memory::outcomes::DirectEffects<'_>,
) -> Option<&'static str> {
    if !borrowed.contains(func.name.as_str()) {
        return Some("no borrowed entry use");
    }
    if !direct.contains(func.name.as_str()) {
        return Some("no placed direct caller");
    }
    if func.initializes_receiver || func.name.contains("#constructor") {
        return Some("constructor");
    }
    if crate::hir::regions::is_clone(&func.name) {
        return Some("region clone");
    }
    if func.abstract_declaration {
        return Some("abstract declaration");
    }
    if is_suspension(func, suspended) {
        return Some("suspension entry");
    }
    if super::consuming(func, &program.layouts).is_empty() {
        return Some("no consuming stored parameter");
    }
    if super::can_raise_past_frame(func, effects) {
        return Some("can raise past the adapter");
    }
    None
}

fn is_suspension(func: &Func, suspended: &FxHashSet<&str>) -> bool {
    func.async_result.is_some()
        || func.frame.is_some()
        || suspended.contains(func.name.as_str())
        || func.name.ends_with("__resume")
        || func.values.iter().any(|op| {
            matches!(&op.kind,
            OpKind::Call { callee: Callee::Direct(name), .. }
            if *name == crate::hir::suspend::resume_name(&func.name))
        })
        || func
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::Suspend { .. }))
}

fn move_body(entry: &mut Func, name: &str) -> Func {
    // Clone only the signature/metadata, after taking every part of the code.
    let Func {
        values,
        blocks,
        exact,
        validation,
        obligations,
        name: _,
        params: _,
        return_type: _,
        written_return: _,
        written_return_elements: _,
        result_absent: _,
        origin: _,
        exported: _,
        raises: _,
        initializes_receiver: _,
        abstract_declaration: _,
        async_result: _,
        frame: _,
    } = entry;
    debug_assert!(
        obligations.is_empty(),
        "source obligations are discharged before entry selection"
    );
    let values = std::mem::take(values);
    let blocks = std::mem::take(blocks);
    let exact = std::mem::take(exact);
    let validation = validation.take();
    let mut body = entry.clone();
    name.clone_into(&mut body.name);
    body.exported = false;
    body.values = values;
    body.blocks = blocks;
    body.exact = exact;
    body.validation = validation;

    let args: Vec<ValueId> = entry
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| {
            let at = u32::try_from(at).expect("a function's parameters fit in HIR");
            entry.values.push(Op {
                kind: OpKind::Param(at),
                ty: param.ty.clone(),
                origin: param.origin.clone(),
            });
            ValueId(at)
        })
        .collect();
    let call = ValueId(u32::try_from(entry.values.len()).expect("an adapter fits in HIR"));
    entry.values.push(Op {
        kind: OpKind::Call {
            callee: Callee::Direct(name.to_owned()),
            args,
            frame: None,
        },
        ty: entry.return_type.clone(),
        origin: entry.origin.clone(),
    });
    entry.blocks.push(Block {
        params: Vec::new(),
        ops: (0..=call.0).map(ValueId).collect(),
        terminator: Terminator::Return((entry.return_type != HirType::Void).then_some(call)),
    });
    body
}

#[cfg(test)]
mod tests {
    /// Plan's private fields cannot be destructured by this sibling module.
    /// Hold its complete field inventory to the disposition table above, just
    /// as the exhaustive Rust patterns hold Program and Func to that audit.
    #[test]
    fn every_interface_plan_table_has_an_entry_disposition() {
        let source = include_str!("../interface_access.rs");
        let fields: std::collections::BTreeSet<_> = source
            .split("pub struct Plan {")
            .nth(1)
            .unwrap_or_default()
            .split("\n}")
            .next()
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("//"))
            .filter_map(|line| line.split_once(':'))
            .filter_map(|(name, _)| name.split_whitespace().last())
            .collect();
        assert_eq!(
            fields,
            [
                "families",
                "callable",
                "storage_bodies",
                "default_bodies",
                "native_views",
                "materialized",
                "defaults",
                "receivers",
                "by_field",
                "by_selector",
                "selectors",
            ]
            .into_iter()
            .collect(),
            "a new Plan field needs a disposition in own/entries.rs"
        );
    }
}
