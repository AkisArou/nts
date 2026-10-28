//! A truncating demand for the sum/difference of two proved signed int32s.
//!
//! Their floating sum is exact, and `ToInt32` of that sum is the wrapping i32
//! operation. This pass changes no other floating use, inserts no predicate,
//! and asks the coupled content provider only in functions with a candidate.

use super::{
    BinOp, Func, HirType, Op, OpKind, Origin, Program, Terminator, UnOp, ValueId, contents,
};

const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};
const F64: HirType = HirType::Float { bits: 64 };
const MAX_VALUES: usize = 4096;
const MAX_BLOCKS: usize = 256;
const WORK: usize = 65_536;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Wrapping,
    ExtraSumUse,
    LeftUnproved,
    RightUnproved,
    Budget,
}

impl Decision {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::Wrapping => "both operands proved signed int32",
            Self::ExtraSumUse => "untruncated arithmetic has another live use",
            Self::LeftUnproved => "left operand is not proved numeric signed int32",
            Self::RightUnproved => "right operand is not proved numeric signed int32",
            Self::Budget => "arithmetic proof budget exhausted",
        }
    }
}

/// Original operands survive for diagnostics and disable-the-rewrite controls.
#[derive(Debug)]
pub struct Site {
    pub function: String,
    pub sink: ValueId,
    pub sum: ValueId,
    pub lhs: ValueId,
    pub rhs: ValueId,
    pub bin: BinOp,
    pub origin: Origin,
    pub decision: Decision,
}

#[derive(Debug, Default)]
pub struct Report {
    pub sites: Vec<Site>,
    pub rewritten: usize,
    pub visits: usize,
    pub mutation_visits: usize,
    pub budget_exhaustions: usize,
}

#[derive(Clone, Copy)]
struct Candidate {
    sink: ValueId,
    sum: ValueId,
    lhs: ValueId,
    rhs: ValueId,
    bin: BinOp,
}

fn candidate(func: &Func, sink: ValueId) -> Option<Candidate> {
    if func.value(sink).ty != I32 {
        return None;
    }
    let OpKind::Unary {
        op: UnOp::ToInt32,
        operand: sum,
    } = func.value(sink).kind
    else {
        return None;
    };
    let op = func.value(sum);
    let OpKind::Binary {
        op: bin @ (BinOp::Add | BinOp::Sub),
        lhs,
        rhs,
    } = op.kind
    else {
        return None;
    };
    (op.ty == F64 && func.value(lhs).ty == F64 && func.value(rhs).ty == F64).then_some(Candidate {
        sink,
        sum,
        lhs,
        rhs,
        bin,
    })
}

/// Charge variable vectors before `operands_of` clones them. All other kinds
/// have at most three operands. Count edges and terminators too.
fn uses(func: &Func, spent: &mut usize) -> Option<Vec<usize>> {
    let mut counts = vec![0_usize; func.values.len()];
    for block in &func.blocks {
        for &id in &block.ops {
            let extra = match &func.value(id).kind {
                OpKind::Call { args, .. } => args.len(),
                OpKind::Await {
                    rejects_to: Some(edge),
                    ..
                } => edge.args.len(),
                _ => 0,
            };
            *spent = spent.saturating_add(extra + 3);
            if *spent > WORK {
                return None;
            }
            for operand in super::operands_of(&func.value(id).kind) {
                counts[operand.0 as usize] += 1;
            }
        }
        let extra = match &block.terminator {
            Terminator::Jump { args, .. } => args.len(),
            Terminator::Branch {
                then_args,
                else_args,
                ..
            } => then_args.len() + else_args.len(),
            _ => 0,
        };
        *spent = spent.saturating_add(extra + 1);
        if *spent > WORK {
            return None;
        }
        for operand in super::operands_of_terminator(&block.terminator) {
            counts[operand.0 as usize] += 1;
        }
    }
    Some(counts)
}

fn int32(fact: contents::ValueFact) -> bool {
    fact.numeric().is_some_and(|n| {
        // A -0 member is safe only because this use's final ToInt32 discards
        // its sign. The original SSA operand and all its other uses stay f64.
        n.integral()
            && !n.maybe_nan
            && n.lo <= n.hi
            && n.lo >= f64::from(i32::MIN)
            && n.hi <= f64::from(i32::MAX)
    })
}

pub(super) fn rewrite(program: &mut Program) -> Report {
    let mut report = Report::default();
    for func in &mut program.funcs {
        if func.values.len() > MAX_VALUES || func.blocks.len() > MAX_BLOCKS {
            report.budget_exhaustions += 1;
            continue;
        }
        let mut spent = func.values.len() + func.blocks.len();
        let mut candidates = Vec::new();
        let mut operations = 0;
        let mut exhausted = false;
        for block in &func.blocks {
            operations += block.ops.len();
            spent = spent.saturating_add(block.ops.len());
            if spent > WORK {
                exhausted = true;
                break;
            }
            candidates.extend(block.ops.iter().filter_map(|&id| candidate(func, id)));
        }
        report.visits += spent.min(WORK);
        if exhausted {
            report.budget_exhaustions += 1;
            continue;
        }
        if candidates.is_empty() {
            continue;
        }
        let scanned = spent;
        let uses = uses(func, &mut spent);
        report.visits += spent.min(WORK).saturating_sub(scanned);
        let facts = uses
            .as_ref()
            .filter(|uses| candidates.iter().any(|c| uses[c.sum.0 as usize] == 1))
            .map(|_| contents::FunctionFacts::for_arithmetic(func));
        if let Some(facts) = &facts {
            report.visits += facts.visits;
            report.budget_exhaustions += facts.budget_exhaustions;
        }
        report.budget_exhaustions += usize::from(uses.is_none());
        let first_site = report.sites.len();
        let mut accepted = Vec::new();
        for c in candidates {
            let decision = if let Some(uses) = &uses {
                if uses[c.sum.0 as usize] != 1 {
                    Decision::ExtraSumUse
                } else if facts
                    .as_ref()
                    .is_none_or(|facts| facts.budget_exhaustions != 0)
                {
                    Decision::Budget
                } else if !facts
                    .as_ref()
                    .is_some_and(|facts| int32(facts.value(c.lhs)))
                {
                    Decision::LeftUnproved
                } else if !facts
                    .as_ref()
                    .is_some_and(|facts| int32(facts.value(c.rhs)))
                {
                    Decision::RightUnproved
                } else {
                    Decision::Wrapping
                }
            } else {
                Decision::Budget
            };
            report.sites.push(Site {
                function: func.name.clone(),
                sink: c.sink,
                sum: c.sum,
                lhs: c.lhs,
                rhs: c.rhs,
                bin: c.bin,
                origin: func.value(c.sink).origin.clone(),
                decision,
            });
            if decision == Decision::Wrapping {
                accepted.push(c);
            }
        }
        // Finish all queries before mutating producers. No stale facts are
        // reused across graph changes; cleanup asks again after RC insertion.
        if accepted.is_empty() {
            continue;
        }
        // Reserve the two indexed tables, one linear block rebuild (including
        // output growth), and the new conversions/producer edits before any
        // mutation. A dense function cannot multiply work by its site count.
        let mutation = 2 * func.values.len() + 3 * operations + 8 * accepted.len();
        if mutation > WORK.saturating_sub(spent) {
            report.visits += WORK.saturating_sub(spent);
            report.budget_exhaustions += 1;
            for site in &mut report.sites[first_site..] {
                if site.decision == Decision::Wrapping {
                    site.decision = Decision::Budget;
                }
            }
            continue;
        }
        report.visits += mutation;
        report.mutation_visits += mutation;
        report.rewritten += accepted.len();
        direct(func, &accepted);
    }
    report
}

fn direct(func: &mut Func, candidates: &[Candidate]) {
    let mut removed = vec![false; func.values.len()];
    let mut before = vec![None; func.values.len()];
    for c in candidates {
        let origin = func.value(c.sink).origin.clone();
        let mut convert = |value| {
            let id = ValueId(u32::try_from(func.values.len()).expect("bounded arithmetic values"));
            func.values.push(Op {
                kind: OpKind::Convert(value),
                ty: I32,
                origin: origin.clone(),
            });
            id
        };
        let lhs = convert(c.lhs);
        let rhs = convert(c.rhs);
        before[c.sink.0 as usize] = Some([lhs, rhs]);
        removed[c.sum.0 as usize] = true;
        func.values[c.sink.0 as usize].kind = OpKind::Binary {
            op: c.bin,
            lhs,
            rhs,
        };
    }
    for block in &mut func.blocks {
        let mut rewritten = Vec::with_capacity(block.ops.len());
        for id in std::mem::take(&mut block.ops) {
            if let Some(values) = before[id.0 as usize] {
                rewritten.extend(values);
            }
            if !removed[id.0 as usize] {
                rewritten.push(id);
            }
        }
        block.ops = rewritten;
    }
}

#[cfg(test)]
mod tests;
