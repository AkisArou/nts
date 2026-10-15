//! A dispatch slot answers in one representation.
//!
//! A virtual call reads a function pointer out of the receiver's table and calls
//! it at the signature its `declared` names (see `dispatch`). TypeScript lets an
//! override **narrow** its result -- `read(): unknown` overridden by
//! `read(): string | undefined` -- and the two are different representations
//! here: an `NtsValue` and an `NtsString *`. With the override in the table as
//! itself, a caller through the root reads sixteen bytes of `NtsValue` out of a
//! function that returned a pointer: deterministic wrong answers on C and LLVM,
//! and `NTS4009` on the JVM, whose descriptors cannot spell the mistake.
//! `tests/programs/a-nullable-virtual-return-keeps-its-absence` and
//! `a-virtual-return-is-erased-with-its-actual-storage` are the witnesses.
//!
//! The answer is Java's covariant-return **bridge**, made once in the IR rather
//! than once per backend: where a slot's results disagree and one of them is
//! erased, the slot's representation is `Erased`, and every entry that answers
//! something else is replaced in the tables by `{entry}@erased` -- the same
//! parameters, a direct call to the entry, and an `Erase` of what it returned.
//! The JVM then writes that bridge's forwarder under the slot's member name with
//! an `NtsValue` descriptor, which *is* an override of the root's method, so it
//! needs no bridge of its own.
//!
//! # The two places a slot's signature was decided wrongly
//!
//! - **An interface's declaration was its first implementer's.**
//!   `declare_interface_methods` copied a body's signature, return included, so
//!   `interface Producer { read(): unknown }` answered `managed<str>` whenever
//!   `Optional` happened to be lowered before `Fallback`, and the C call site
//!   assigned an `NtsString *` to an `NtsValue`: clang refused the program. The
//!   declaration now uses the interface's contract, and a structural adapter
//!   reconciles parameters and results before that body enters the table.
//! - **A class chain is one slot entered through two signatures.** `Base#read():
//!   unknown` and `Sub#read(): string | undefined` share the root's slot, and a
//!   call through a `Sub` names `Sub#read`. Once every entry in the slot answers
//!   erased, that call is retargeted to the root's declaration and its result is
//!   unerased back to what the checker said it was -- `Unerase` of an absent
//!   value reads a zero payload, which is the null pointer `string | undefined`
//!   is represented by.
//!
//! # What it leaves alone
//!
//! Records against records (`dispatch::check` decides those by layout prefix),
//! two object pointers (a covariant `this` is a pointer either way), and a slot
//! where some answer has no erased form: no bridge can be built there, and the
//! slot keeps the representation it had.
use std::collections::BTreeMap;

use rustc_hash::FxHashMap;

use nts_semantic_schema::{GeneratedReason, Origin, SemanticSnapshot, TypeId, TypeKind};

use super::interfaces::{AbiType, abi_type};
use super::{Hierarchy, LoweringSnapshot, without_the_raising_suffix};
use crate::hir::{
    Absent, Block, Callee, Func, HirType, Op, OpKind, Param, Program, Terminator, ValueId,
};

/// The suffix a bridge takes after the entry it answers for.
const ERASED_SUFFIX: &str = "@erased";

/// Bridge every member slot whose results disagree with an erased one.
///
/// **Linear in the program, by construction.** A runtime module has tens of
/// thousands of functions and hundreds of slots, so every lookup goes through
/// one of two indexes built once: function by name (`index`, kept current as
/// bridges are added) and, per slot, each entry with the layouts holding it
/// (`slot_tables`).
pub(super) fn bridge(
    snapshot: &LoweringSnapshot<'_>,
    hierarchy: &Hierarchy,
    program: &mut Program,
) {
    let mut index: FxHashMap<String, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(at, func)| (func.name.clone(), at))
        .collect();
    let mut made = FxHashMap::default();
    adapt_interfaces(snapshot, hierarchy, program, &mut index, &mut made);
    let calls = virtual_calls(program);
    let owners = owners_by_name(hierarchy);
    let tables = slot_tables(program);
    // Sorted, so one compiler on one input makes its bridges in one order.
    let mut slots: Vec<(&(TypeId, String), &u32)> = hierarchy.slots.iter().collect();
    slots.sort_by_key(|(_, slot)| **slot);
    for ((root, member), &slot) in slots {
        let Some(owner) = hierarchy.name.get(root) else {
            continue;
        };
        let root_declaration = format!("{owner}#{member}");
        let through = calls.get(&slot).map(Vec::as_slice).unwrap_or_default();
        let empty = BTreeMap::new();
        let table = tables.get(&slot).unwrap_or(&empty);
        if !disagrees_with_an_erased_answer(program, &index, table, through) {
            continue;
        }
        // The declarations first: an abstract one is a signature, and its result
        // is the slot's.
        for name in table.keys() {
            if let Some(&at) = index.get(name)
                && program.funcs[at].abstract_declaration
            {
                program.funcs[at].return_type = HirType::Erased;
            }
        }
        for (name, holders) in table {
            let Some(&at) = index.get(name) else { continue };
            let func = &program.funcs[at];
            if func.abstract_declaration || func.return_type == HirType::Erased {
                continue;
            }
            let projection = Projection {
                params: func.params.clone(),
                returns: HirType::Erased,
                arguments_absent: Vec::new(),
                result_absent: result_absent(snapshot, &owners, name, &func.return_type),
            };
            let bridge = intern_projection(
                snapshot,
                program,
                &mut index,
                &mut made,
                at,
                &projection,
                format!("{name}{ERASED_SUFFIX}"),
            );
            for &layout in holders {
                program.layouts[layout].methods[slot as usize] = Some(bridge.clone());
            }
        }
        for &(at, value) in through {
            retarget(program, &index, at, value, &root_declaration);
        }
    }
}

/// Every `Callee::Virtual` call in the program, by slot.
fn virtual_calls(program: &Program) -> FxHashMap<u32, Vec<(usize, ValueId)>> {
    let mut calls: FxHashMap<u32, Vec<(usize, ValueId)>> = FxHashMap::default();
    for (at, func) in program.funcs.iter().enumerate() {
        for block in &func.blocks {
            for &value in &block.ops {
                if let OpKind::Call {
                    callee: Callee::Virtual { slot, .. },
                    ..
                } = &func.value(value).kind
                {
                    calls.entry(*slot).or_default().push((at, value));
                }
            }
        }
    }
    calls
}

/// Each slot's entries, in name order, each with the layouts whose table holds
/// it there: one pass over the tables.
fn slot_tables(program: &Program) -> FxHashMap<u32, BTreeMap<String, Vec<usize>>> {
    let mut tables: FxHashMap<u32, BTreeMap<String, Vec<usize>>> = FxHashMap::default();
    for (at, layout) in program.layouts.iter().enumerate() {
        for (slot, entry) in layout.methods.iter().enumerate() {
            let (Some(entry), Ok(slot)) = (entry, u32::try_from(slot)) else {
                continue;
            };
            tables
                .entry(slot)
                .or_default()
                .entry(entry.clone())
                .or_default()
                .push(at);
        }
    }
    tables
}

/// Whether the answers through a slot -- what its entries return, what each
/// call's declaration returns, and what each call's result is typed -- include
/// an erased one and something else, every one of which can be erased.
fn disagrees_with_an_erased_answer(
    program: &Program,
    index: &FxHashMap<String, usize>,
    table: &BTreeMap<String, Vec<usize>>,
    calls: &[(usize, ValueId)],
) -> bool {
    let by_name = |name: &str| index.get(name).map(|&at| &program.funcs[at]);
    let mut answers: Vec<&HirType> = table
        .keys()
        .filter_map(|name| by_name(name))
        .map(|func| &func.return_type)
        .collect();
    for &(at, value) in calls {
        let op = program.funcs[at].value(value);
        answers.push(&op.ty);
        if let OpKind::Call {
            callee: Callee::Virtual { declared, .. },
            ..
        } = &op.kind
            && let Some(func) = by_name(declared)
        {
            answers.push(&func.return_type);
        }
    }
    answers.contains(&&HirType::Erased)
        && answers.iter().any(|answer| **answer != HirType::Erased)
        && answers.iter().all(|answer| crosses(answer))
}

/// Whether an answer can be handed back erased: already erased, nothing at
/// all, or something with an erased form.
fn crosses(answer: &HirType) -> bool {
    matches!(answer, HirType::Erased | HirType::Void | HirType::Never) || super::erasable(answer)
}

/// One slot's calling convention, independent of the body it reaches.
#[derive(Debug)]
struct Projection {
    params: Vec<Param>,
    returns: HirType,
    arguments_absent: Vec<Absent>,
    result_absent: Absent,
}

impl Projection {
    fn is_identity(&self, target: &Func) -> bool {
        target
            .params
            .iter()
            .zip(&self.params)
            .all(|(target, through)| target.ty != HirType::Erased || through.ty == HirType::Erased)
            && if self.returns == HirType::Void {
                matches!(target.return_type, HirType::Void | HirType::Never)
            } else {
                !matches!(target.return_type, HirType::Void | HirType::Never)
                    && (self.returns != HirType::Erased || target.return_type == HirType::Erased)
            }
    }
}

/// Both return-only bridges and structural adapters use this body builder.
/// It introduces only widening conversions licensed before table construction.
fn projected_bridge(name: String, target: &Func, projection: &Projection) -> Func {
    let origin = Origin::generated(target.origin.location, GeneratedReason::AbiProjection);
    // A `Param` op *is* the signature in this IR, and value `i` is parameter `i`.
    let mut values: Vec<Op> = projection
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap_or(u32::MAX)),
            ty: param.ty.clone(),
            origin: origin.clone(),
        })
        .collect();
    let push = |values: &mut Vec<Op>, kind: OpKind, ty: HirType| {
        values.push(Op {
            kind,
            ty,
            origin: origin.clone(),
        });
        ValueId(u32::try_from(values.len() - 1).unwrap_or(u32::MAX))
    };
    let args = projected_arguments(&mut values, &origin, target, projection);
    let answered = push(
        &mut values,
        OpKind::Call {
            callee: Callee::Direct(target.name.clone()),
            args,
            frame: None,
        },
        target.return_type.clone(),
    );
    let answer = if projection.returns == HirType::Void {
        None
    } else if matches!(target.return_type, HirType::Void | HirType::Never) {
        Some(push(&mut values, OpKind::ConstUndefined, HirType::Erased))
    } else if projection.returns == HirType::Erased && target.return_type != HirType::Erased {
        Some(push(
            &mut values,
            OpKind::Erase {
                value: answered,
                absent: projection.result_absent,
                slots: crate::hir::Absent::Impossible,
            },
            HirType::Erased,
        ))
    } else {
        Some(answered)
    };
    let ops = (projection.params.len()..values.len())
        .map(|at| ValueId(u32::try_from(at).unwrap_or(u32::MAX)))
        .collect();
    Func {
        name,
        params: projection.params.clone(),
        return_type: projection.returns.clone(),
        values,
        blocks: vec![Block {
            params: Vec::new(),
            ops,
            terminator: Terminator::Return(answer),
        }],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        written_return: None,
        result_absent: crate::hir::Absent::Impossible,
        written_return_elements: Vec::new(),
    }
}

fn projected_arguments(
    values: &mut Vec<Op>,
    origin: &Origin,
    target: &Func,
    projection: &Projection,
) -> Vec<ValueId> {
    target
        .params
        .iter()
        .enumerate()
        .map(|(at, wanted)| {
            let value = ValueId(u32::try_from(at).unwrap_or(u32::MAX));
            if wanted.ty != HirType::Erased || projection.params[at].ty == HirType::Erased {
                return value;
            }
            values.push(Op {
                kind: OpKind::Erase {
                    value,
                    absent: projection
                        .arguments_absent
                        .get(at)
                        .copied()
                        .unwrap_or(Absent::Impossible),
                    slots: Absent::Impossible,
                },
                ty: HirType::Erased,
                origin: origin.clone(),
            });
            ValueId(u32::try_from(values.len() - 1).unwrap_or(u32::MAX))
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AdapterKey {
    target: String,
    params: Vec<AbiType>,
    returns: AbiType,
    arguments_absent: Vec<Absent>,
    result_absent: Absent,
}

impl AdapterKey {
    fn of(snapshot: &SemanticSnapshot, target: &Func, projection: &Projection) -> Self {
        Self {
            target: target.name.clone(),
            params: projection
                .params
                .iter()
                .skip(1)
                .map(|param| abi_type(snapshot, &param.ty))
                .collect(),
            returns: abi_type(snapshot, &projection.returns),
            // Only conversions the body performs distinguish projections.
            // A class return bridge and an interface adapter with unchanged
            // inputs must share one body, whatever their source slot.
            arguments_absent: target
                .params
                .iter()
                .enumerate()
                .skip(1)
                .map(|(at, param)| {
                    if param.ty == HirType::Erased && projection.params[at].ty != HirType::Erased {
                        projection
                            .arguments_absent
                            .get(at)
                            .copied()
                            .unwrap_or(Absent::Impossible)
                    } else {
                        Absent::Impossible
                    }
                })
                .collect(),
            result_absent: if projection.returns == HirType::Erased
                && target.return_type != HirType::Erased
            {
                projection.result_absent
            } else {
                Absent::Impossible
            },
        }
    }
}

/// Class and interface slots share adapters by their complete conversion plan.
/// Joining input facts keeps specialization valid for every contributing slot.
fn intern_projection(
    snapshot: &SemanticSnapshot,
    program: &mut Program,
    index: &mut FxHashMap<String, usize>,
    made: &mut FxHashMap<AdapterKey, String>,
    target: usize,
    projection: &Projection,
    name: String,
) -> String {
    let key = AdapterKey::of(snapshot, &program.funcs[target], projection);
    if let Some(bridge) = made.get(&key) {
        let at = index[bridge];
        for (param, face) in program.funcs[at].params.iter_mut().zip(&projection.params) {
            param.known = param.known.join(face.known);
        }
        return bridge.clone();
    }
    let name = if index.contains_key(&name) {
        format!("{name}${}", program.funcs.len())
    } else {
        name
    };
    let bridge = projected_bridge(name.clone(), &program.funcs[target], projection);
    if projection.is_identity(&program.funcs[target]) {
        program
            .identity_projections
            .insert(name.clone(), program.funcs[target].name.clone());
    }
    index.insert(name.clone(), program.funcs.len());
    program.funcs.push(bridge);
    made.insert(key, name.clone());
    name
}

/// Replace interface entries with the interface's complete calling convention.
/// Class slots and direct calls retain their own signatures; an inherited body
/// is resolved by the table, so a subclass override receives its own adapter.
fn adapt_interfaces(
    snapshot: &LoweringSnapshot<'_>,
    hierarchy: &Hierarchy,
    program: &mut Program,
    index: &mut FxHashMap<String, usize>,
    made: &mut FxHashMap<AdapterKey, String>,
) {
    let owners = owners_by_name(hierarchy);
    let tables = slot_tables(program);
    let mut slots: Vec<_> = hierarchy
        .slots
        .iter()
        .filter(|((root, _), _)| hierarchy.faces.contains(root))
        .collect();
    slots.sort_by_key(|(_, slot)| **slot);
    let probe = super::FuncBuilder::probe(snapshot);
    for ((root, member), slot) in slots {
        let Some(owner) = hierarchy.name.get(root) else {
            continue;
        };
        let declared = format!("{owner}#{member}");
        let Some(&declaration) = index.get(&declared) else {
            continue;
        };
        let Some(table) = tables.get(slot) else {
            continue;
        };
        let plain = without_the_raising_suffix(member).0;
        let Some(property) = super::interfaces::property(snapshot, *root, plain) else {
            continue;
        };
        let Some(contract) = super::interfaces::contract(&probe, property) else {
            continue;
        };
        for (name, holders) in table {
            let Some(&at) = index.get(name) else { continue };
            let target = &program.funcs[at];
            let through = &program.funcs[declaration];
            if target.abstract_declaration || same_signature(through, target) {
                continue;
            }
            let Some(projection) =
                interface_projection(snapshot, hierarchy, &owners, through, target, &contract)
            else {
                continue;
            };
            let bridge = intern_projection(
                snapshot,
                program,
                index,
                made,
                at,
                &projection,
                format!("{name}@{owner}"),
            );
            for &layout in holders {
                program.layouts[layout].methods[*slot as usize] = Some(bridge.clone());
            }
        }
    }
}

fn same_signature(through: &Func, target: &Func) -> bool {
    through.return_type == target.return_type
        && through.params.len() == target.params.len()
        && through
            .params
            .iter()
            .zip(&target.params)
            .skip(1)
            .all(|(one, other)| one.ty == other.ty)
}

fn interface_projection(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    owners: &FxHashMap<&str, Vec<TypeId>>,
    through: &Func,
    target: &Func,
    contract: &super::interfaces::Contract,
) -> Option<Projection> {
    if target.params.is_empty()
        || target.params.len() > through.params.len()
        || !target
            .params
            .iter()
            .zip(&through.params)
            .skip(1)
            .all(|(target, through)| {
                super::interfaces::converts(snapshot, hierarchy, &through.ty, &target.ty)
            })
        || !super::interfaces::converts(
            snapshot,
            hierarchy,
            &target.return_type,
            &through.return_type,
        )
    {
        return None;
    }
    let mut params = through.params.clone();
    params[0] = target.params[0].clone();
    for param in params.iter_mut().skip(1) {
        // Facts remain valid across shared faces only after joining them at
        // reuse above. Retaining the first face alone would narrow unsafely;
        // discarding every face would prevent body parameter specialization.
        param.written = None;
        param.shape = crate::hir::ParamShape::Ordinary;
    }
    let arguments_absent = std::iter::once(Absent::Impossible)
        .chain(contract.sources.iter().enumerate().map(|(at, ty)| {
            if target
                .params
                .get(at + 1)
                .is_some_and(|param| param.ty == HirType::Erased)
                && through.params[at + 1].ty != HirType::Erased
            {
                super::absent_of_result(snapshot, *ty)
            } else {
                Absent::Impossible
            }
        }))
        .collect();
    Some(Projection {
        params,
        returns: through.return_type.clone(),
        arguments_absent,
        result_absent: result_absent(snapshot, owners, &target.name, &target.return_type),
    })
}

/// Point a call through a bridged slot at a declaration that answers erased,
/// and read its answer back as what the call was typed.
///
/// An interface's declaration already answers erased by now; a class chain's
/// call through a narrower class names that class's own body, and is pointed at
/// the slot's root -- whose parameters it must agree with, or it is left as it
/// was. A root with a body of its own answers what the checker said, and it is
/// its bridge, `{root}@erased`, that the root's table holds: the call names
/// that. Naming the body left C calling the bridge through a pointer typed to
/// return an object, and the JVM a method the class does not declare
/// (`tests/outcomes/an-override-called-through-an-interface-returning-unknown-*`). The call keeps its value id by moving: the call goes to a fresh id typed
/// `Erased`, and the old id becomes the `Unerase` of it, so every use of the old
/// id reads the value it always did.
fn retarget(
    program: &mut Program,
    index: &FxHashMap<String, usize>,
    at: usize,
    value: ValueId,
    root: &str,
) {
    let by_name = |name: &str| index.get(name).map(|&at| &program.funcs[at]);
    let erased_declaration =
        |name: &str| by_name(name).filter(|func| func.return_type == HirType::Erased);
    let OpKind::Call {
        callee: Callee::Virtual { declared, .. },
        ..
    } = &program.funcs[at].value(value).kind
    else {
        return;
    };
    let target = if erased_declaration(declared).is_some() {
        None
    } else {
        let bridge = format!("{root}{ERASED_SUFFIX}");
        let (root, root_func) = match (erased_declaration(root), erased_declaration(&bridge)) {
            (Some(func), _) => (root.to_owned(), func),
            (None, Some(func)) => (bridge, func),
            (None, None) => return,
        };
        let Some(through) = by_name(declared) else {
            return;
        };
        let agree = through.params.len() == root_func.params.len()
            && through
                .params
                .iter()
                .zip(&root_func.params)
                .skip(1)
                .all(|(a, b)| a.ty == b.ty);
        if !agree {
            return;
        }
        Some(root)
    };
    let func = &mut program.funcs[at];
    let op = &mut func.values[value.0 as usize];
    if let (
        Some(target),
        OpKind::Call {
            callee: Callee::Virtual { declared, .. },
            ..
        },
    ) = (target, &mut op.kind)
    {
        *declared = target;
    }
    if matches!(op.ty, HirType::Erased | HirType::Void | HirType::Never) {
        op.ty = HirType::Erased;
        return;
    }
    let mut call = op.clone();
    call.ty = HirType::Erased;
    let moved = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(call);
    func.values[value.0 as usize].kind = OpKind::Unerase { value: moved };
    for block in &mut func.blocks {
        if let Some(position) = block.ops.iter().position(|op| *op == value) {
            block.ops.insert(position, moved);
            break;
        }
    }
}

/// Each class's instance types, by the name its functions are spelled with.
fn owners_by_name(hierarchy: &Hierarchy) -> FxHashMap<&str, Vec<TypeId>> {
    let mut owners: FxHashMap<&str, Vec<TypeId>> = FxHashMap::default();
    for (ty, name) in &hierarchy.name {
        owners.entry(name.as_str()).or_default().push(*ty);
    }
    for types in owners.values_mut() {
        types.sort_by_key(|ty| ty.0);
    }
    owners
}

/// What a null pointer `entry` returns means, from the checker's type for its
/// member: the same rule `closure_result_absent` applies to a closure's
/// signature, asked of a method's.
fn result_absent(
    snapshot: &SemanticSnapshot,
    owners: &FxHashMap<&str, Vec<TypeId>>,
    entry: &str,
    returns: &HirType,
) -> Absent {
    if !crate::hir::tags::payload_is_a_reference(returns) {
        return Absent::Impossible;
    }
    let Some((owner, member)) = entry.split_once('#') else {
        return Absent::Impossible;
    };
    let member = without_the_raising_suffix(member).0;
    let result = owners
        .get(owner)
        .into_iter()
        .flatten()
        .find_map(|ty| member_result(snapshot, *ty, member));
    result.map_or(Absent::Impossible, |result| {
        super::absent_of_result(snapshot, result)
    })
}

/// The checker's result type for `member` of `owner`: a getter's property type,
/// or a method's signature's return.
fn member_result(snapshot: &SemanticSnapshot, owner: TypeId, member: &str) -> Option<TypeId> {
    let TypeKind::Object { properties } = &snapshot.types.get(owner.0 as usize)?.kind else {
        return None;
    };
    if let Some(getter) = member.strip_prefix("get ") {
        return properties
            .iter()
            .find(|property| property.name == getter)
            .map(|property| property.ty);
    }
    let property = properties.iter().find(|property| property.name == member)?;
    let TypeKind::Function(signature) = snapshot.types.get(property.ty.0 as usize)?.kind else {
        return None;
    };
    snapshot
        .signatures
        .get(signature.0 as usize)
        .map(|signature| signature.return_type)
}
