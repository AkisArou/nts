//! First provider: fresh intraprocedural Map/record identities. Unknown uses
//! close no writer set. Arrays and interprocedural identities are deliberately
//! left to the same interface's later provider rather than guessed from types.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Facts, Tags, Unknown, ValueFact};
use crate::hir::{self, Callee, Func, HirType, OpKind, Origin, Terminator, ValueId};

mod refine;

const MAX_VALUES: usize = 4096;
const MAX_BLOCKS: usize = 256;
const WORK: usize = 65_536;

struct Budget {
    left: usize,
}

impl Budget {
    fn new() -> Self {
        Self { left: WORK }
    }

    fn charge(&mut self, count: usize) -> Result<(), ()> {
        if count > self.left {
            self.left = 0;
            return Err(());
        }
        self.left -= count;
        Ok(())
    }

    fn used(&self) -> usize {
        WORK - self.left
    }
}

#[derive(Debug)]
pub struct Container {
    pub value: ValueId,
    pub origin: Origin,
    pub contents: ValueFact,
}

/// A snapshot of actual SSA producers. Inserted counting operations can read
/// it, but a rewrite changing producers must ask the provider again.
#[derive(Debug, Default)]
pub struct FunctionFacts {
    values: Vec<ValueFact>,
    pub containers: Vec<Container>,
    pub visits: usize,
    pub budget_exhaustions: usize,
    fallback: Option<Unknown>,
}

/// Why a particular actual use prevented a closed writer-set proof.
#[derive(Debug, Clone, Copy)]
pub struct RejectedUse {
    pub root: ValueId,
    /// None for a return terminator.
    pub operation: Option<ValueId>,
    pub operand: ValueId,
    pub argument: Option<usize>,
    pub reason: Unknown,
}

/// One recognized store, not a claim that every store has been found.
#[derive(Debug, Clone, Copy)]
pub struct RecognizedWrite {
    pub root: ValueId,
    pub value: ValueId,
}

/// Observation only. `facts` remains the only authoritative content proof.
/// Rejected uses and recognized writes can be partial on budget exhaustion;
/// their absence must never license an optimization or a complete-writer claim.
#[derive(Debug)]
pub struct Inspection {
    pub facts: FunctionFacts,
    pub rejected: Vec<RejectedUse>,
    pub writes: Vec<RecognizedWrite>,
}

#[derive(Debug)]
enum Observation {
    Rejected(RejectedUse),
    Write(RecognizedWrite),
}

fn ignore_observation(_: Observation) {}

impl FunctionFacts {
    #[must_use]
    pub fn value(&self, id: ValueId) -> ValueFact {
        self.values
            .get(id.0 as usize)
            .copied()
            .unwrap_or_else(|| ValueFact::Unknown(self.fallback.unwrap_or(Unknown::NotAnalysed)))
    }

    #[must_use]
    pub fn of(func: &Func) -> Self {
        Self::build(func, false, &mut ignore_observation)
    }

    /// Candidate-only arithmetic queries also need ordinary scalar producers
    /// when a function has no container. They use this same lattice/provider.
    pub(crate) fn for_arithmetic(func: &Func) -> Self {
        Self::build(func, true, &mut ignore_observation)
    }

    /// Reuse the exact production identity/effects walk with an explicit sink.
    /// The ordinary build monomorphizes a no-op sink and allocates no trace.
    #[must_use]
    pub fn inspect(func: &Func) -> Inspection {
        let mut rejected = Vec::new();
        let mut writes = Vec::new();
        let facts = Self::build(func, false, &mut |event| match event {
            Observation::Rejected(use_) => rejected.push(use_),
            Observation::Write(write) => writes.push(write),
        });
        Inspection {
            facts,
            rejected,
            writes,
        }
    }

    fn build(func: &Func, numbers: bool, observe: &mut impl FnMut(Observation)) -> Self {
        // Reject large inputs before scanning roots or cloning an edge. Block
        // and value counts do not bound repeated operands, so charge those
        // separately before visiting or allocating their vectors below.
        if func.values.len() > MAX_VALUES || func.blocks.len() > MAX_BLOCKS {
            return Self {
                fallback: Some(Unknown::Budget),
                visits: 1,
                budget_exhaustions: 1,
                ..Self::default()
            };
        }
        let mut budget = Budget::new();
        let mut roots = Vec::new();
        let scan = (|| {
            for block in &func.blocks {
                budget.charge(1)?;
                budget.charge(block.ops.len())?;
                for &id in &block.ops {
                    if matches!(&func.value(id).kind,
                        OpKind::Call { callee: Callee::External(name), .. }
                            if matches!(name.as_str(), "nts_map_new" | "nts_table_new"))
                    {
                        roots.push(id);
                    }
                }
            }
            Ok::<(), ()>(())
        })();
        if scan.is_err() {
            return Self {
                fallback: Some(Unknown::Budget),
                visits: budget.used(),
                budget_exhaustions: 1,
                ..Self::default()
            };
        }
        if roots.is_empty() && !numbers {
            return Self {
                fallback: Some(Unknown::AmbiguousIdentity),
                visits: budget.used(),
                ..Self::default()
            };
        }
        match analyze(func, &roots, &mut budget, observe) {
            Ok(result) => result,
            Err(()) => Self {
                fallback: Some(Unknown::Budget),
                visits: budget.used(),
                budget_exhaustions: 1,
                containers: roots
                    .into_iter()
                    .map(|value| Container {
                        value,
                        origin: func.value(value).origin.clone(),
                        contents: ValueFact::Unknown(Unknown::Budget),
                    })
                    .collect(),
                ..Self::default()
            },
        }
    }
}

#[derive(Clone, Default)]
struct Identity {
    roots: FxHashSet<ValueId>,
    unknown: bool,
}

/// Queries the existing identity-preserving views and runtime return-alias
/// contract. No field/element alias inference is invented here: storing an
/// identity into anything outside these views invalidates the closed proof.
struct Identities<'a, 'b> {
    func: &'a Func,
    roots: FxHashSet<ValueId>,
    incoming: Vec<Vec<ValueId>>,
    cache: FxHashMap<ValueId, Identity>,
    context: Option<refine::Contexts>,
    budget: &'b mut Budget,
}

impl<'a, 'b> Identities<'a, 'b> {
    fn new(func: &'a Func, roots: &[ValueId], budget: &'b mut Budget) -> Result<Self, ()> {
        budget.charge(func.values.len())?;
        budget.charge(roots.len())?;
        let mut incoming = vec![Vec::new(); func.values.len()];
        for block in &func.blocks {
            budget.charge(1)?;
            budget.charge(block.params.len())?;
            let mut edge = |target: hir::BlockId, arguments: &[ValueId]| {
                // Charge the full edge, including repeated arguments, before
                // appending anything. No predecessor helper clones it first.
                budget.charge(arguments.len())?;
                for (&param, &argument) in
                    func.blocks[target.0 as usize].params.iter().zip(arguments)
                {
                    incoming[param.0 as usize].push(argument);
                }
                Ok::<(), ()>(())
            };
            match &block.terminator {
                Terminator::Jump { target, args } => edge(*target, args)?,
                Terminator::Branch {
                    then_target,
                    then_args,
                    else_target,
                    else_args,
                    ..
                } => {
                    edge(*then_target, then_args)?;
                    edge(*else_target, else_args)?;
                }
                _ => {}
            }
        }
        Ok(Self {
            func,
            roots: roots.iter().copied().collect(),
            incoming,
            cache: FxHashMap::default(),
            context: None,
            budget,
        })
    }

    fn spend(&mut self) -> Result<(), ()> {
        self.budget.charge(1)
    }

    fn of(&mut self, value: ValueId) -> Result<Identity, ()> {
        if let Some(known) = self.cache.get(&value) {
            self.budget.charge(known.roots.len() + 1)?;
            return Ok(known.clone());
        }
        let mut result = Identity::default();
        let mut pending = vec![value];
        let mut seen = FxHashSet::default();
        while let Some(id) = pending.pop() {
            self.spend()?;
            if !seen.insert(id) {
                continue;
            }
            if self.roots.contains(&id) {
                result.roots.insert(id);
                continue;
            }
            let op = self.func.value(id);
            if let Some(source) = hir::carried_source(&op.kind) {
                pending.push(source);
            } else if let OpKind::BlockParam(_) = op.kind {
                let arriving = &self.incoming[id.0 as usize];
                result.unknown |= arriving.is_empty();
                self.budget.charge(arriving.len())?;
                pending.extend(arriving.iter().copied());
            } else if let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = &op.kind
                && hir::own::runtime_hands_back(name)
                && let Some(receiver) = args.first()
            {
                pending.push(*receiver);
            } else {
                result.unknown = true;
            }
        }
        result.unknown |= result.roots.is_empty();
        self.budget.charge(result.roots.len())?;
        self.cache.insert(value, result.clone());
        Ok(result)
    }
}

struct Effects {
    problems: FxHashMap<ValueId, Unknown>,
    writes: FxHashMap<ValueId, Vec<ValueId>>,
    reads: FxHashMap<ValueId, ValueId>,
}

fn stored_value(name: &str, args: &[ValueId]) -> Option<ValueId> {
    match name {
        "nts_map_set" => args.get(2),
        hir::entries::ENTRY_SET => args.get(3),
        _ => None,
    }
    .copied()
}

fn effects(
    identities: &mut Identities<'_, '_>,
    roots: &[ValueId],
    observe: &mut impl FnMut(Observation),
) -> Result<Effects, ()> {
    let func = identities.func;
    let mut problems = FxHashMap::default();
    let mut writes: FxHashMap<ValueId, Vec<ValueId>> =
        roots.iter().map(|r| (*r, Vec::new())).collect();
    let mut reads = FxHashMap::default();
    for block in &func.blocks {
        for &id in &block.ops {
            identities.spend()?;
            let op = func.value(id);
            if hir::carried_source(&op.kind).is_some()
                || matches!(op.kind, OpKind::Retain(_) | OpKind::Release(_))
            {
                continue;
            }
            let call = match &op.kind {
                OpKind::Call {
                    callee: Callee::External(name),
                    args,
                    ..
                } => Some((name.as_str(), args.as_slice())),
                _ => None,
            };
            // These are the only variable-length arms of verify::operands;
            // charge them before that shared enumerator allocates its vector.
            let variable = match &op.kind {
                OpKind::Call { args, .. } => args.len(),
                OpKind::Await {
                    rejects_to: Some(edge),
                    ..
                } => edge.args.len(),
                _ => 0,
            };
            identities.budget.charge(variable)?;
            for (index, operand) in hir::operands_of(&op.kind).into_iter().enumerate() {
                identities.spend()?;
                let of = identities.of(operand)?;
                for root in of.roots {
                    if of.unknown || !is_receiver(call, index) {
                        observe(Observation::Rejected(RejectedUse {
                            root,
                            operation: Some(id),
                            operand,
                            argument: Some(index),
                            reason: Unknown::OpenWriterSet,
                        }));
                        problems.insert(root, Unknown::OpenWriterSet);
                    }
                }
            }
            if let Some((name, args)) = call
                && let Some(&receiver) = args.first()
            {
                let of = identities.of(receiver)?;
                if of.roots.len() != 1 || of.unknown {
                    for root in of.roots {
                        observe(Observation::Rejected(RejectedUse {
                            root,
                            operation: Some(id),
                            operand: receiver,
                            argument: Some(0),
                            reason: Unknown::AmbiguousIdentity,
                        }));
                        problems.insert(root, Unknown::AmbiguousIdentity);
                    }
                    continue;
                }
                let root = *of.roots.iter().next().ok_or(())?;
                if let Some(value) = stored_value(name, args) {
                    writes.entry(root).or_default().push(value);
                    observe(Observation::Write(RecognizedWrite { root, value }));
                }
                if matches!(
                    name,
                    "nts_map_get" | "nts_map_value_at" | hir::entries::ENTRY_GET
                ) {
                    reads.insert(id, root);
                }
            }
        }
        // Edge arguments are identity views already followed above. A return
        // hands the object outside the closed writer scope.
        if let hir::Terminator::Return(Some(value)) = block.terminator {
            for root in identities.of(value)?.roots {
                observe(Observation::Rejected(RejectedUse {
                    root,
                    operation: None,
                    operand: value,
                    argument: None,
                    reason: Unknown::EscapingIdentity,
                }));
                problems.insert(root, Unknown::EscapingIdentity);
            }
        }
    }
    Ok(Effects {
        problems,
        writes,
        reads,
    })
}

fn propagated(
    identities: &mut Identities<'_, '_>,
    id: ValueId,
    values: &[Option<ValueFact>],
) -> Result<Option<ValueFact>, ()> {
    let func = identities.func;
    Ok(match &func.value(id).kind {
        OpKind::Erase { value, .. } => values[value.0 as usize].map(|fact| {
            if matches!(func.value(*value).ty, HirType::Managed(_)) {
                // Erase's Absent contract selects the tag of a null pointer.
                // Keep both alternatives in this first cleanup-only slice.
                fact.join(ValueFact::Known {
                    tags: Tags::NULL.union(Tags::UNDEFINED),
                    numbers: Facts::BOTTOM,
                })
            } else {
                fact
            }
        }),
        OpKind::Convert(value) | OpKind::Unerase { value, .. }
            if func.value(id).ty == (HirType::Float { bits: 64 }) =>
        {
            let incoming = values[value.0 as usize];
            match incoming {
                Some(fact) => {
                    let fact = if fact.numeric().is_some() {
                        fact
                    } else {
                        if identities.context.is_none() {
                            identities.context =
                                Some(refine::Contexts::new(func, identities.budget)?);
                        }
                        identities.context.as_ref().ok_or(())?.at(
                            func,
                            id,
                            *value,
                            fact,
                            identities.budget,
                        )?
                    };
                    // An unproved coercion still returns a number, but not a
                    // bounded one. Never use just the numeric subset while
                    // undefined or managed alternatives remain possible.
                    Some(ValueFact::number(fact.numeric().unwrap_or(Facts::TOP)))
                }
                None => None,
            }
        }
        OpKind::Convert(value) | OpKind::Unerase { value, .. } => values[value.0 as usize],
        OpKind::BlockParam(_) => {
            identities
                .budget
                .charge(identities.incoming[id.0 as usize].len())?;
            join_ready(&identities.incoming[id.0 as usize], values)
        }
        _ => Some(ValueFact::Unknown(Unknown::ExternalValue)),
    })
}

fn analyze(
    func: &Func,
    roots: &[ValueId],
    budget: &mut Budget,
    observe: &mut impl FnMut(Observation),
) -> Result<FunctionFacts, ()> {
    let mut identities = Identities::new(func, roots, budget)?;
    let Effects {
        problems,
        writes,
        reads,
    } = effects(&mut identities, roots, observe)?;
    identities.budget.charge(func.values.len())?;
    let mut values: Vec<_> = func.values.iter().map(|op| scalar(func, op)).collect();
    let mut contents: FxHashMap<ValueId, Option<ValueFact>> = roots
        .iter()
        .map(|root| {
            (
                *root,
                problems.get(root).map(|why| ValueFact::Unknown(*why)),
            )
        })
        .collect();
    loop {
        let mut changed = false;
        for &root in roots {
            identities.spend()?;
            if contents[&root].is_some() {
                continue;
            }
            let written = &writes[&root];
            identities.budget.charge(written.len())?;
            if written.iter().any(|v| values[v.0 as usize].is_none()) {
                continue;
            }
            // An empty map has no stored payload. Absence belongs to a read,
            // not to the stored numeric subset. Clear cannot recover a proof.
            let empty = ValueFact::Known {
                tags: Tags(0),
                numbers: Facts::BOTTOM,
            };
            let joined = written.iter().fold(empty, |held, value| {
                held.join(
                    values[value.0 as usize].unwrap_or(ValueFact::Unknown(Unknown::RecursiveValue)),
                )
            });
            contents.insert(root, Some(joined));
            changed = true;
        }
        for block in &func.blocks {
            for &id in &block.ops {
                identities.spend()?;
                if values[id.0 as usize].is_some() {
                    continue;
                }
                let next = if let Some(root) = reads.get(&id) {
                    contents[root].map(|fact| fact.join(ValueFact::undefined()))
                } else {
                    propagated(&mut identities, id, &values)?
                };
                if next.is_some() {
                    values[id.0 as usize] = next;
                    changed = true;
                }
            }
            for &id in &block.params {
                identities.spend()?;
                identities
                    .budget
                    .charge(identities.incoming[id.0 as usize].len())?;
                if values[id.0 as usize].is_none()
                    && let Some(fact) = join_ready(&identities.incoming[id.0 as usize], &values)
                {
                    values[id.0 as usize] = Some(fact);
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    Ok(FunctionFacts {
        values: values
            .into_iter()
            .map(|value| value.unwrap_or(ValueFact::Unknown(Unknown::RecursiveValue)))
            .collect(),
        containers: roots
            .iter()
            .map(|&value| Container {
                value,
                origin: func.value(value).origin.clone(),
                contents: contents[&value].unwrap_or(ValueFact::Unknown(Unknown::RecursiveValue)),
            })
            .collect(),
        visits: identities.budget.used(),
        budget_exhaustions: 0,
        fallback: None,
    })
}

fn is_receiver(call: Option<(&str, &[ValueId])>, index: usize) -> bool {
    index == 0
        && call.is_some_and(|(name, _)| {
            matches!(
                name,
                "nts_map_get"
                    | "nts_map_has"
                    | "nts_map_set"
                    | "nts_map_delete"
                    | "nts_map_clear"
                    | "nts_map_size"
                    | "nts_map_next"
                    | "nts_map_key_at"
                    | "nts_map_value_at"
                    | hir::entries::ENTRY
                    | hir::entries::ENTRY_GET
                    | hir::entries::ENTRY_SET
            )
        })
}

fn join_ready(arriving: &[ValueId], values: &[Option<ValueFact>]) -> Option<ValueFact> {
    let mut sources = arriving.iter();
    let mut result = values[sources.next()?.0 as usize]?;
    for source in sources {
        result = result.join(values[source.0 as usize]?);
    }
    Some(result)
}

fn scalar(func: &Func, op: &hir::Op) -> Option<ValueFact> {
    let known = |tags| {
        Some(ValueFact::Known {
            tags,
            numbers: Facts::BOTTOM,
        })
    };
    match &op.kind {
        OpKind::ConstUndefined => return Some(ValueFact::undefined()),
        OpKind::ConstNull => return known(Tags::NULL),
        OpKind::Erase { .. } | OpKind::Unerase { .. } | OpKind::BlockParam(_)
            if op.ty == HirType::Erased =>
        {
            return None;
        }
        OpKind::Unerase { .. } | OpKind::BlockParam(_)
            if op.ty == (HirType::Float { bits: 64 }) =>
        {
            return None;
        }
        OpKind::Convert(value)
            if op.ty == (HirType::Float { bits: 64 })
                && matches!(
                    func.value(*value).ty,
                    HirType::Int {
                        bits: 8 | 16 | 32,
                        ..
                    } | HirType::Float { bits: 32 | 64 }
                ) =>
        {
            return None;
        }
        _ => {}
    }
    match op.ty {
        HirType::Float { bits: 64 } => Some(ValueFact::number(match op.kind {
            OpKind::ConstFloat(value) => Facts::constant(value),
            _ => Facts::TOP,
        })),
        // A narrower store may round a constant across an int32 boundary.
        // This first numeric consumer makes no range claim for that storage.
        HirType::Float { .. } => Some(ValueFact::number(Facts::TOP)),
        HirType::Int { bits, signed } => {
            let facts = if bits <= 32 {
                let (lo, hi) = if signed {
                    let edge = 2_f64.powi(i32::from(bits) - 1);
                    (-edge, edge - 1.0)
                } else {
                    (0.0, 2_f64.powi(i32::from(bits)) - 1.0)
                };
                Facts::new(lo, hi, true, false, false)
            } else {
                Facts::TOP
            };
            Some(ValueFact::number(facts))
        }
        HirType::Bool => known(Tags::BOOLEAN),
        HirType::Managed(_) | HirType::BigInt => {
            known(Tags::MANAGED.union(Tags::NULL).union(Tags::UNDEFINED))
        }
        HirType::Erased => match op.kind {
            OpKind::Call { .. } | OpKind::Convert(_) => None,
            _ => Some(ValueFact::Unknown(Unknown::ExternalValue)),
        },
        _ => Some(ValueFact::Unknown(Unknown::ExternalValue)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hir::{Absent, Block, JsText, ManagedType, Op, Program, Terminator};
    use nts_diagnostics::{Location, SourceId, Span};

    mod numeric;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }
    fn number() -> HirType {
        HirType::Float { bits: 64 }
    }
    fn string() -> HirType {
        HirType::Managed(ManagedType::String)
    }
    fn map(value: HirType) -> HirType {
        HirType::Managed(ManagedType::Map(Box::new(string()), Box::new(value)))
    }
    fn call(name: &str, args: &[u32], ty: HirType) -> Op {
        op(
            OpKind::Call {
                callee: Callee::External(name.to_owned()),
                args: args.iter().copied().map(ValueId).collect(),
                frame: None,
            },
            ty,
        )
    }
    fn erase(value: u32) -> Op {
        op(
            OpKind::Erase {
                value: ValueId(value),
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
        )
    }

    // The receiver is declared number-valued; writes go through an erased and
    // widened view. Only the actual producer of value 4 differs in the pair.
    fn fixture(stored: Op) -> Func {
        let values = vec![
            op(
                OpKind::ConstInt(i128::from(hir::tables::STRING)),
                hir::tables::KIND_TYPE,
            ),
            call("nts_map_new", &[0], map(number())),
            op(
                OpKind::ConstString(JsText::Utf8("key".to_owned())),
                string(),
            ),
            erase(2),
            stored,
            erase(4),
            erase(1),
            op(
                OpKind::Unerase {
                    value: ValueId(6),
                    failure: None,
                },
                map(HirType::Erased),
            ),
            call("nts_map_set", &[7, 3, 5, 0], map(HirType::Erased)),
            call("nts_map_get", &[1, 3, 0], HirType::Erased),
            op(OpKind::Release(ValueId(9)), HirType::Void),
        ];
        Func {
            name: "closed".to_owned(),
            params: Vec::new(),
            return_type: HirType::Void,
            blocks: vec![Block {
                params: Vec::new(),
                ops: (0..values.len())
                    .map(|n| ValueId(u32::try_from(n).expect("small fixture")))
                    .collect(),
                terminator: Terminator::Return(None),
            }],
            values,
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
            obligations: Vec::new(),
            exact: FxHashMap::default(),
            written_return: None,
            result_absent: Absent::Impossible,
            written_return_elements: Vec::new(),
        }
    }

    #[test]
    fn inspection_reports_the_actual_rejection_without_licensing_its_writes() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        let id = ValueId(u32::try_from(body.values.len()).expect("small fixture"));
        body.values.push(op(OpKind::Length(ValueId(1)), number()));
        body.blocks[0].ops.push(id);
        let plain = FunctionFacts::of(&body);
        let inspection = FunctionFacts::inspect(&body);
        assert_eq!(plain.values, inspection.facts.values);
        assert_eq!(plain.visits, inspection.facts.visits);
        assert_eq!(
            plain.budget_exhaustions,
            inspection.facts.budget_exhaustions
        );
        assert_eq!(
            plain.containers[0].contents,
            inspection.facts.containers[0].contents
        );
        assert!(matches!(
            inspection.facts.containers[0].contents,
            ValueFact::Unknown(Unknown::OpenWriterSet)
        ));
        assert_eq!(inspection.rejected.len(), 1);
        assert_eq!(inspection.rejected[0].operation, Some(id));
        assert_eq!(inspection.rejected[0].root, ValueId(1));
        assert_eq!(inspection.writes.len(), 1);
        assert_eq!(inspection.writes[0].value, ValueId(5));
        assert!(
            inspection.facts.value(ValueId(5)).numeric().is_some(),
            "a recognized scalar writer does not close the rejected writer set"
        );
    }

    #[test]
    fn inspection_budget_failure_is_explicit_and_retains_unknown_facts() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        body.values
            .resize(MAX_VALUES + 1, op(OpKind::ConstUndefined, HirType::Erased));
        let inspection = FunctionFacts::inspect(&body);
        assert_eq!(inspection.facts.budget_exhaustions, 1);
        assert_eq!(
            inspection.facts.value(ValueId(9)),
            ValueFact::Unknown(Unknown::Budget)
        );
        assert!(inspection.rejected.is_empty());
        assert!(inspection.writes.is_empty());
    }

    #[test]
    fn actual_writes_override_the_declared_map_value_type() {
        let scalar = fixture(op(OpKind::ConstFloat(4.0), number()));
        let managed = fixture(op(
            OpKind::ConstString(JsText::Utf8("owned".to_owned())),
            string(),
        ));
        let positive = FunctionFacts::of(&scalar);
        assert!(positive.value(ValueId(9)).is_inert());
        assert!(
            positive.value(ValueId(9)).numeric().is_none(),
            "get still includes absence"
        );
        assert!(positive.containers[0].contents.numeric().is_some());
        assert!(!FunctionFacts::of(&managed).value(ValueId(9)).is_inert());
    }

    #[test]
    fn unresolved_writers_and_returned_maps_keep_cleanup() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        if let OpKind::Call { callee, .. } = &mut body.values[8].kind {
            *callee = Callee::External("unknown_writer".to_owned());
        }
        assert!(!FunctionFacts::of(&body).value(ValueId(9)).is_inert());
        let mut returned = fixture(op(OpKind::ConstFloat(4.0), number()));
        returned.return_type = map(number());
        returned.blocks[0].terminator = Terminator::Return(Some(ValueId(1)));
        assert_eq!(
            FunctionFacts::of(&returned).value(ValueId(9)),
            ValueFact::Unknown(Unknown::EscapingIdentity)
        );
    }

    #[test]
    fn receiver_return_aliases_use_the_existing_runtime_contract() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        // Map.set returns the receiver: read through that result this time.
        if let OpKind::Call { args, .. } = &mut body.values[9].kind {
            args[0] = ValueId(8);
        }
        assert!(FunctionFacts::of(&body).value(ValueId(9)).is_inert());
    }

    #[test]
    fn unknown_after_clear_is_not_recovered_by_a_scalar_store() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        body.values.push(op(
            OpKind::Call {
                callee: Callee::External("unknown_writer".to_owned()),
                args: vec![ValueId(1)],
                frame: None,
            },
            HirType::Void,
        ));
        body.values.push(call("nts_map_clear", &[1], HirType::Void));
        body.blocks[0].ops.splice(8..8, [ValueId(11), ValueId(12)]);
        assert!(!FunctionFacts::of(&body).value(ValueId(9)).is_inert());
    }

    #[test]
    fn consumer_removes_only_inert_erased_cleanup() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        for value in [ValueId(1), ValueId(3)] {
            let id = ValueId(u32::try_from(body.values.len()).expect("small fixture"));
            body.values.push(op(OpKind::Release(value), HirType::Void));
            body.blocks[0].ops.push(id);
        }
        let old_len = body.values.len();
        let mut program = Program {
            funcs: vec![body],
            ..Program::default()
        };
        let report = super::super::elide(&mut program, &[old_len]);
        assert_eq!(report.elisions.len(), 1);
        assert_eq!(report.elisions[0].operand, ValueId(9));
        assert_eq!(
            report.inserted_releases_removed, 0,
            "existing operations are not newly inserted counts"
        );
        assert!(
            program.funcs[0].blocks[0].ops.contains(&ValueId(11)),
            "map still dies"
        );
        assert!(
            program.funcs[0].blocks[0].ops.contains(&ValueId(12)),
            "key still dies"
        );
    }

    #[test]
    fn function_limit_publishes_no_partial_fact() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        body.values.resize_with(MAX_VALUES + 1, || {
            op(OpKind::ConstUndefined, HirType::Erased)
        });
        assert_eq!(
            FunctionFacts::of(&body).value(ValueId(9)),
            ValueFact::Unknown(Unknown::Budget)
        );
        assert_eq!(FunctionFacts::of(&body).budget_exhaustions, 1);
    }

    #[test]
    fn repeated_call_arguments_are_charged_before_cloning() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        let OpKind::Call { args, .. } = &mut body.values[8].kind else {
            panic!("fixture setter");
        };
        args.resize(WORK + 1, ValueId(1));
        let facts = FunctionFacts::of(&body);
        assert_eq!(facts.value(ValueId(9)), ValueFact::Unknown(Unknown::Budget));
        assert_eq!(facts.visits, WORK);
        assert_eq!(facts.budget_exhaustions, 1);
    }

    #[test]
    fn repeated_cfg_edges_are_charged_before_copying() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        let params: Vec<_> = (0..300)
            .map(|index| {
                let id = ValueId(u32::try_from(body.values.len()).expect("small fixture"));
                body.values
                    .push(op(OpKind::BlockParam(index), map(number())));
                id
            })
            .collect();
        body.blocks.push(Block {
            params,
            ops: Vec::new(),
            terminator: Terminator::Return(None),
        });
        for _ in 0..240 {
            body.blocks.push(Block {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: Terminator::Jump {
                    target: hir::BlockId(1),
                    args: vec![ValueId(1); 300],
                },
            });
        }
        let facts = FunctionFacts::of(&body);
        assert_eq!(facts.value(ValueId(9)), ValueFact::Unknown(Unknown::Budget));
        assert_eq!(facts.visits, WORK);
        assert_eq!(facts.budget_exhaustions, 1);
    }

    #[test]
    fn shared_walk_budget_fails_closed_without_recursive_stack_growth() {
        let mut body = fixture(op(OpKind::ConstFloat(4.0), number()));
        let mut previous = ValueId(1);
        let mut views = Vec::new();
        for _ in 0..1800 {
            let id = ValueId(u32::try_from(body.values.len()).expect("small fixture"));
            body.values
                .push(op(OpKind::Convert(previous), map(number())));
            body.blocks[0].ops.push(id);
            views.push(id);
            previous = id;
        }
        for receiver in views.into_iter().rev().take(100) {
            let id = ValueId(u32::try_from(body.values.len()).expect("small fixture"));
            body.values
                .push(call("nts_map_get", &[receiver.0, 3, 0], HirType::Erased));
            body.blocks[0].ops.push(id);
        }
        let result = FunctionFacts::of(&body);
        assert_eq!(
            result.value(ValueId(9)),
            ValueFact::Unknown(Unknown::Budget)
        );
        assert!(
            result
                .containers
                .iter()
                .all(|row| row.contents == ValueFact::Unknown(Unknown::Budget))
        );
    }
}
