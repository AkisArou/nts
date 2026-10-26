//! Additional internal selectors for distinct certified refused entries.
//! Ordinary public methods stay in place; nothing here equates stopped bodies.

use std::collections::{BTreeMap, BTreeSet};

use nts_core::hir::{Callee, Func, HirType, ManagedType, OpKind, Terminator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{JvmProgram, hierarchy, identity_forwarder_target, instance_descriptor, types};

mod class_contracts;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ContractKind {
    Interface,
    Companion,
    ClassContract,
}

/// Both source interface representations have an actual JVM interface surface.
/// A split face keeps its class for state; dispatch uses its companion.
pub(super) fn interface_surface(program: &JvmProgram<'_>, layout: &nts_core::hir::Layout) -> bool {
    hierarchy::is_interface(program, layout) || program.is_split(layout)
}

struct Row<'a> {
    slot: usize,
    target: &'a Func,
    certified: bool,
    contract: Option<ContractKind>,
}

type Group<'a> = Vec<Row<'a>>;

// Source names always double a literal currency marker, or introduce it with
// the existing u200c/u200d escape. This single-marker namespace is disjoint;
// currency letters are also valid DEX member characters. Never re-mangle it.
pub(super) fn internal_name(slot: usize) -> String {
    format!("¢nts$dispatch${slot}")
}

#[derive(Debug)]
pub(super) struct Member {
    pub name: String,
    pub default_owner: usize,
    pub kind: ContractKind,
}

pub(super) fn plan(program: &JvmProgram<'_>) -> FxHashMap<usize, Member> {
    if program.guarded_dispatch.is_empty() {
        return FxHashMap::default();
    }
    let functions: FxHashMap<&str, &Func> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    let reasons = first_reasons(program);
    let contracts = class_contracts::Contracts::new(program, &functions);
    let groups = conflicts(program, &functions, &reasons, &contracts);
    let mut candidates: BTreeSet<usize> = groups
        .iter()
        .filter(|group| licensed(group))
        .flat_map(|group| {
            group
                .iter()
                .filter(|row| row.contract.is_some())
                .map(|row| row.slot)
        })
        .collect();
    // A globally shared slot cannot conceal an unrelated receiver's unsafe
    // collision. ANY uncovered conflicting population denies its selector.
    for group in &groups {
        if !licensed(group) {
            for row in group {
                candidates.remove(&row.slot);
            }
        }
    }
    candidates.retain(|slot| complete_family(program, &functions, *slot, &contracts));
    // Exactly the parent edges emitted on interface class bytes. Ordinary
    // interfaces currently emit no source-parent edges; split companions do.
    let parents: Vec<Vec<usize>> = program
        .layouts
        .iter()
        .map(|face| {
            if program.is_split(face) {
                crate::split_faces::interface_parents(program, types::DEFAULT_PACKAGE, face)
                    .into_iter()
                    .filter_map(|parent| program.index(parent))
                    .collect()
            } else {
                Vec::new()
            }
        })
        .collect();
    candidates
        .into_iter()
        .filter_map(|slot| {
            let (default_owner, kind) = if let Some(owner) = contracts.owner(slot) {
                (owner, ContractKind::ClassContract)
            } else {
                let owner = default_owner(program, &parents, slot)?;
                let kind = if program.is_split(&program.layouts[owner]) {
                    ContractKind::Companion
                } else {
                    ContractKind::Interface
                };
                (owner, kind)
            };
            Some((
                slot,
                Member {
                    name: internal_name(slot),
                    default_owner,
                    kind,
                },
            ))
        })
        .collect()
}

// Each interface row inherits its default from one actual ancestor. Distinct
// roots, including unrelated same-shaped declarations, cannot be combined:
// an existing Java class may implement both and has no new internal override.
fn default_owner(program: &JvmProgram<'_>, parents: &[Vec<usize>], slot: usize) -> Option<usize> {
    let mut state = vec![0; parents.len()];
    let mut roots = vec![None; parents.len()];
    let mut owner = None;
    for (at, face) in program.layouts.iter().enumerate() {
        if !interface_surface(program, face) || !face.methods.get(slot).is_some_and(Option::is_some)
        {
            continue;
        }
        default_root(program, parents, slot, at, &mut state, &mut roots)?;
        let root = roots[at]?;
        if owner.is_some_and(|prior| prior != root) {
            return None;
        }
        owner = Some(root);
    }
    owner
}

fn default_root(
    program: &JvmProgram<'_>,
    parents: &[Vec<usize>],
    slot: usize,
    at: usize,
    state: &mut [u8],
    roots: &mut [Option<usize>],
) -> Option<()> {
    match state[at] {
        1 => return None,
        2 => return Some(()),
        _ => {}
    }
    state[at] = 1;
    let mut root = None;
    for &parent in &parents[at] {
        default_root(program, parents, slot, parent, state, roots)?;
        if let Some(inherited) = roots[parent] {
            if root.is_some_and(|prior| prior != inherited) {
                return None;
            }
            root = Some(inherited);
        }
    }
    if root.is_none()
        && program.layouts[at]
            .methods
            .get(slot)
            .is_some_and(Option::is_some)
    {
        root = Some(at);
    }
    roots[at] = root;
    state[at] = 2;
    Some(())
}

fn first_reasons<'a>(program: &'a JvmProgram<'_>) -> FxHashMap<&'a str, &'a str> {
    let mut reasons = FxHashMap::default();
    for (name, reason) in &program.uncompiled {
        reasons.entry(name.as_str()).or_insert(reason.as_str());
    }
    reasons
}

fn conflicts<'a>(
    program: &'a JvmProgram<'_>,
    functions: &FxHashMap<&str, &'a Func>,
    reasons: &FxHashMap<&str, &str>,
    contracts: &class_contracts::Contracts,
) -> Vec<Group<'a>> {
    let package = types::DEFAULT_PACKAGE;
    let mut descriptors: FxHashMap<&str, Option<String>> = FxHashMap::default();
    let mut conflicts = Vec::new();
    for layout in &program.layouts {
        let mut groups: BTreeMap<(String, String), Group<'_>> = BTreeMap::new();
        for (slot, entry) in layout.methods.iter().enumerate() {
            let Some(func) = entry
                .as_deref()
                .and_then(|name| functions.get(name))
                .copied()
            else {
                continue;
            };
            if func.abstract_declaration {
                continue;
            }
            let target = identity_forwarder_target(package, program, func);
            let descriptor = descriptors
                .entry(target.name.as_str())
                .or_insert_with(|| instance_descriptor(package, program, target));
            let Some(descriptor) = descriptor.as_ref() else {
                continue;
            };
            let Some(member) = hierarchy::original_declared_member(program, layout, slot) else {
                continue;
            };
            let contract = if contracts.reaches(program, layout, slot) {
                Some(ContractKind::ClassContract)
            } else {
                hierarchy::declaring_interface(program, layout, slot).and_then(|face| {
                    if program.is_split(face) {
                        Some(ContractKind::Companion)
                    } else if hierarchy::is_interface(program, face) {
                        Some(ContractKind::Interface)
                    } else {
                        None
                    }
                })
            };
            let certificate = certified(program, functions, reasons, func, slot)
                && func.name == target.name
                && hierarchy::ancestry(program, layout).iter().any(|owner| {
                    owner.types.iter().any(|ty| {
                        func.params
                            .first()
                            .is_some_and(|p| p.ty == HirType::Managed(ManagedType::Object(*ty)))
                    })
                });
            groups
                .entry((member, descriptor.clone()))
                .or_default()
                .push(Row {
                    slot,
                    target,
                    certified: certificate,
                    contract,
                });
        }
        conflicts.extend(groups.into_values().filter(|group| {
            group
                .iter()
                .map(|row| row.target.name.as_str())
                .collect::<FxHashSet<_>>()
                .len()
                > 1
        }));
    }
    conflicts
}

fn licensed(group: &Group<'_>) -> bool {
    // One ordinary class slot and one owned source-interface contract.
    // The contract's physical JVM kind never grants a new reference relation.
    // More complicated collision populations retain their refusal.
    group.len() == 2
        && group[0].contract.is_some() != group[1].contract.is_some()
        && group
            .iter()
            .all(|row| row.certified && row.target.return_type == HirType::Void)
}

fn certified(
    program: &JvmProgram<'_>,
    functions: &FxHashMap<&str, &Func>,
    reasons: &FxHashMap<&str, &str>,
    entry: &Func,
    slot: usize,
) -> bool {
    let Some(proof) = program.guarded_dispatch.get(&entry.name) else {
        return false;
    };
    let Ok(slot) = u32::try_from(slot) else {
        return false;
    };
    if functions
        .get(proof.original.as_str())
        .is_some_and(|func| !func.abstract_declaration)
        || !proof.slots.contains(&slot)
        || program.selector(slot as usize).is_some()
        || [
            program.closure_slot,
            program.erased_call_slot,
            program.raising_call_slot,
        ]
        .contains(&Some(slot))
        || program.identity_projections.contains_key(&entry.name)
    {
        return false;
    }
    let (Some(contract), Some(reason)) = (
        functions.get(proof.contract.as_str()),
        reasons.get(proof.original.as_str()),
    ) else {
        return false;
    };
    if entry.params.is_empty()
        || entry.params.len() != contract.params.len()
        || entry.return_type != HirType::Void
        || entry.return_type != contract.return_type
        || entry.result_absent != contract.result_absent
        || entry.written_return != contract.written_return
        || entry.written_return_elements != contract.written_return_elements
        || entry.origin != contract.origin
        || entry.abstract_declaration
        || entry.frame.is_some()
        || entry.async_result.is_some()
        || entry.params[0].ty != HirType::Managed(ManagedType::Object(proof.receiver))
        || !entry
            .params
            .iter()
            .zip(&contract.params)
            .enumerate()
            .all(|(at, (mine, theirs))| {
                (at == 0 || mine.ty == theirs.ty)
                    && mine.shape == theirs.shape
                    && mine.origin == theirs.origin
                    && mine.written == theirs.written
            })
    {
        return false;
    }
    named_stop(entry, &proof.original, reason)
}

fn named_stop(entry: &Func, original: &str, reason: &str) -> bool {
    let [block] = entry.blocks.as_slice() else {
        return false;
    };
    if !matches!(block.terminator, Terminator::Unreachable) {
        return false;
    }
    let [message, stopped] = block.ops.as_slice() else {
        return false;
    };
    let (Some(message_op), Some(stopped_op)) = (
        entry.values.get(message.0 as usize),
        entry.values.get(stopped.0 as usize),
    ) else {
        return false;
    };
    let OpKind::ConstString(text) = &message_op.kind else {
        return false;
    };
    let expected = format!("`{original}` was refused: {reason}");
    text.as_utf8() == Some(expected.as_str())
        && matches!(&stopped_op.kind, OpKind::Call {
            callee: Callee::External(name), args, frame: None,
        } if name == "nts_refused" && args.as_slice() == [*message])
        && stopped_op.ty == HirType::Void
}

// Every unbroken implementer must still supply this EXACT interface ABI.
// Dropped/covariant/erased conversions stay outside this small naming repair.
fn complete_family(
    program: &JvmProgram<'_>,
    functions: &FxHashMap<&str, &Func>,
    slot: usize,
    contracts: &class_contracts::Contracts,
) -> bool {
    if contracts.blocked(slot) {
        return false;
    }
    let mut descriptor = None;
    let mut found_interface = false;
    for layout in &program.layouts {
        let Some(entry) = layout.methods.get(slot).and_then(Option::as_deref) else {
            continue;
        };
        if nts_core::hir::runtime::is_foreign_layout_name(&layout.name)
            || program
                .foreign_classes
                .iter()
                .any(|class| class.name == layout.name)
        {
            return false;
        }
        let Some(func) = functions.get(entry) else {
            return false;
        };
        if func.return_type != HirType::Void || program.selector(slot).is_some() {
            return false;
        }
        let Some(current) = instance_descriptor(types::DEFAULT_PACKAGE, program, func) else {
            return false;
        };
        if descriptor.as_ref().is_some_and(|prior| *prior != current) {
            return false;
        }
        descriptor = Some(current);
        let interface =
            interface_surface(program, layout) || contracts.owner(slot) == program.index(layout);
        // Only an abstract old declaration gets the compatibility default.
        // A concrete interface body must not bypass a Java implementer's
        // existing override of its public plain method.
        if interface && !func.abstract_declaration {
            return false;
        }
        found_interface |= interface;
    }
    found_interface
}

/// An existing Java implementation or abstract-base subclass needs only its
/// old plain override. The concrete internal entry forwards through that ABI.
/// The actual emitting owner supplies both the receiver `VType` and CP invoke
/// kind: a companion/interface default, or a stateful class wrapper.
pub(super) fn default_forwarder(
    package: &str,
    program: &JvmProgram<'_>,
    owner: (&str, bool),
    target: &Func,
    member: (&str, &str),
    pool: &mut nts_jvm_emitter::Pool,
) -> Result<nts_jvm_emitter::Body, nts_diagnostics::Diagnostic> {
    use nts_jvm_emitter::{Code, Kind, VType};
    let origin = crate::program_origin(program);
    let (class, interface) = owner;
    let shape = types::Shape::packaged(program, package);
    let mut locals = vec![VType::Object(class.to_owned())];
    for param in target.params.iter().skip(1) {
        let Some(value) = types::vtype(shape, &param.ty) else {
            return Err(nts_diagnostics::Diagnostic::error(
                "NTS4008",
                "an internal default parameter has no JVM representation",
                origin.location,
            ));
        };
        locals.push(value);
    }
    let slots = locals.iter().map(VType::slots).sum();
    let mut code = Code::new(locals, slots);
    code.load(&origin, Kind::Ref, 0);
    let mut at = 1;
    for param in target.params.iter().skip(1) {
        let Some(kind) = types::kind(&param.ty) else {
            return Err(nts_diagnostics::Diagnostic::error(
                "NTS4008",
                "an internal default parameter has no JVM kind",
                origin.location,
            ));
        };
        code.load(&origin, kind, at);
        at += kind.words();
    }
    if interface {
        code.invoke_interface(&origin, pool, class, member.0, member.1);
    } else {
        code.invoke_virtual(&origin, pool, class, member.0, member.1);
    }
    code.ret(&origin, None);
    code.finish(pool).map_err(|error| {
        nts_diagnostics::Diagnostic::error(
            "NTS4008",
            format!("the internal default forwarder could not be written: {error}"),
            origin.location,
        )
    })
}

#[cfg(test)]
mod guarded_member_tests {
    #[test]
    fn cyclic_emitted_parent_graph_cannot_introduce_an_internal_default() {
        let program = nts_core::hir::Program {
            layouts: vec![nts_core::hir::Layout {
                types: vec![nts_semantic_schema::TypeId(1)],
                name: "Cycle".into(),
                fields: Vec::new(),
                methods: vec![Some("Cycle#step".into())],
                base: None,
                interfaces: Vec::new(),
            }],
            ..nts_core::hir::Program::default()
        };
        let facts = crate::JvmProgram::new(&program);
        assert_eq!(
            super::default_root(&facts, &[vec![0]], 0, 0, &mut [0], &mut [None]),
            None
        );
    }
}
