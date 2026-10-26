//! Where a string a call answers is only appended, and how a function builds
//! the string it returns.
//!
//! `out += serializeRow(row)` builds a row's string in the callee, hands it
//! back, and copies it into the caller's accumulator: every character of the
//! row is written twice, and the row's own string exists only to be copied.
//! `benchmarks/cases/json-stringify-typed` nests four such builders --
//! document, row, tags, meta -- and on the JVM their growth and their
//! `toString`s were half of the row's 6.47 MB an operation, the document's own
//! string 5.7% of it. C pays the same copy: its in-place append saves one of
//! them, and the row's characters are still built in the row's string first.
//!
//! What a backend needs to stop that is two answers, and neither depends on
//! how it holds a string:
//!
//! - which calls' answers are **only appended** ([`appended_calls`]): the one
//!   live use of the string a direct call returns is the right operand of a
//!   concatenation. Such a call could append into the left operand instead of
//!   returning anything.
//! - how a string function **builds what it returns** ([`returned_strings`]):
//!   each return reads an accumulation that nothing else reads, a call's answer
//!   as it is, or some other string. Asked to append into a caller's
//!   accumulator, a function whose return reads an accumulation appends its
//!   literals and its concatenations there, and no string of its own exists.
//!
//! Which accumulators a backend holds mutably, and so which of these calls it
//! sends into one, is the backend's: the JVM's is its `StringBuilder` pass.
//!
//! # What an accumulation may not do
//!
//! An appended-into accumulation is the caller's storage, written in place,
//! so the callee's accumulation is invisible only while nothing could tell its
//! characters were never a string of their own:
//!
//! - its members are defined only by a literal or a direct call's answer
//!   (where it starts), a concatenation onto a member, or a block parameter
//!   between members; one started by a call has at least one concatenation,
//!   so that `return g(x)` stays a [`ReturnedString::Call`];
//! - nothing reads a member but the left operand of a concatenation onto it,
//!   an edge to a member, or a return. A `.length` would count the caller's
//!   characters as well, and any other read needs a string;
//! - no concatenation reads a member as its right operand: a prepend;
//! - the members are **one storage**, by core's liveness: none is dropped --
//!   each dies where it is read. That also keeps two from being live at once:
//!   members never merge -- an edge hands each to a parameter of its own, a
//!   concatenation has one member operand, a return reads one -- so of two
//!   live together on a path that returns, one is dropped on the way.
//!
//! The third is the JVM `StringBuilder` pass's rule for holding a string in a
//! builder at all. The fourth is what one storage handed in from outside needs
//! beyond it. A function holding its own builders may begin a second while the
//! first is live, or leave one behind on a path, and each is a builder of its
//! own; handed the caller's, every member is that one builder. Two appends
//! onto one member would both land there, the second seeing the first's
//! characters; so would a seed begun beside another, as in `return c ? out :
//! "A"` with the literal before the accumulation, and a seed one path
//! abandons, as in `let out = "a"; if (c) out = "b"`.

use std::collections::{BTreeMap, BTreeSet};

use super::{BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId};

/// How one return of a string function builds what it returns, for a caller
/// that would have it appended rather than returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReturnedString {
    /// An accumulation nothing else reads: one storage location, its members
    /// joined by block-parameter edges and by the left operand of the
    /// concatenations onto them. Appended into a caller's accumulator, its
    /// literals and its concatenations append there.
    Accumulated(BTreeSet<ValueId>),
    /// A direct call's answer whose one live use is this return: appended,
    /// it is the callee's to append, and nothing else needs it to exist.
    Call(ValueId),
    /// Any other string, appended as it is.
    Value(ValueId),
}

/// Direct calls in `func` whose string answer's one live use is the right
/// operand of a concatenation: the calls whose answer is only appended.
#[must_use]
pub fn appended_calls(func: &Func) -> BTreeSet<ValueId> {
    let reads = reads(func);
    let live: BTreeSet<ValueId> = func
        .blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .collect();
    live.into_iter()
        .filter(|&id| {
            let op = func.value(id);
            matches!(
                op.kind,
                OpKind::Call {
                    callee: Callee::Direct(_),
                    ..
                }
            ) && is_string(&op.ty)
                && reads
                    .get(&id)
                    .is_some_and(|&(count, appended)| count == 1 && appended)
        })
        .collect()
}

/// Runtime-helper calls in `func` whose string answer's one live use is the
/// right operand of a concatenation: `out + String(n)`, `out + s[i]`, the
/// appends a helper could write into `out` instead of making a string.
#[must_use]
pub fn appended_runtime_calls(func: &Func) -> BTreeSet<ValueId> {
    let reads = reads(func);
    func.blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .filter(|&id| {
            let op = func.value(id);
            matches!(
                op.kind,
                OpKind::Call {
                    callee: Callee::External(_),
                    ..
                }
            ) && is_string(&op.ty)
                && reads
                    .get(&id)
                    .is_some_and(|&(count, appended)| count == 1 && appended)
        })
        .collect()
}

/// Concatenations in `func` whose string's one live read is the left side of
/// an append that takes it over, in the same block: the left side of a further
/// concatenation, or the first argument of a runtime append
/// (`nts_str_append_number` and its siblings, [`super::own::non_consuming_twin`]).
/// `name + ":"` in `${name}:${id}`, and `"{" + parts.join(",")` before `+ "}"`.
///
/// Made with room, the appends after it write in place (`rc` calls
/// `nts_str_concat_grown` for it). A string anything else reads -- kept,
/// returned, read twice, or read in another block, where a loop could read it
/// again -- is made to fit, since the room would be kept with it.
#[must_use]
pub(super) fn consumed_left_sides(func: &Func) -> BTreeSet<ValueId> {
    // Each value's live readers: the block, and the reading operation (`None`
    // for a terminator).
    let mut readers: BTreeMap<ValueId, Vec<(usize, Option<ValueId>)>> = BTreeMap::new();
    for (at, block) in func.blocks.iter().enumerate() {
        for &id in &block.ops {
            for operand in super::operands_of(&func.value(id).kind) {
                readers.entry(operand).or_default().push((at, Some(id)));
            }
        }
        for operand in super::operands_of_terminator(&block.terminator) {
            readers.entry(operand).or_default().push((at, None));
        }
    }
    let takes_over = |reader: ValueId, value: ValueId| match &func.value(reader).kind {
        OpKind::Binary {
            op: BinOp::Concat,
            lhs,
            rhs,
        } => *lhs == value && *rhs != value,
        OpKind::Call {
            callee: Callee::External(helper),
            args,
            ..
        } => {
            super::own::non_consuming_twin(helper).is_some()
                && args.first() == Some(&value)
                && !args[1..].contains(&value)
        }
        _ => false,
    };
    func.blocks
        .iter()
        .enumerate()
        .flat_map(|(at, block)| block.ops.iter().map(move |&id| (at, id)))
        .filter(|&(at, id)| {
            matches!(
                func.value(id).kind,
                OpKind::Binary {
                    op: BinOp::Concat,
                    ..
                }
            ) && matches!(
                readers.get(&id).map(Vec::as_slice),
                Some(&[(block, Some(reader))]) if block == at && takes_over(reader, id)
            )
        })
        .map(|(_, id)| id)
        .collect()
}

/// How many live reads each value has, and whether every one is the right
/// operand of a concatenation.
fn reads(func: &Func) -> BTreeMap<ValueId, (usize, bool)> {
    let mut reads: BTreeMap<ValueId, (usize, bool)> = BTreeMap::new();
    let mut note = |value: ValueId, appended: bool| {
        let entry = reads.entry(value).or_insert((0, true));
        entry.0 += 1;
        entry.1 &= appended;
    };
    for block in &func.blocks {
        for &id in &block.ops {
            match &func.value(id).kind {
                OpKind::Binary {
                    op: BinOp::Concat,
                    lhs,
                    rhs,
                } => {
                    note(*lhs, false);
                    note(*rhs, true);
                }
                other => {
                    for operand in super::operands_of(other) {
                        note(operand, false);
                    }
                }
            }
        }
        for operand in super::operands_of_terminator(&block.terminator) {
            note(operand, false);
        }
    }
    reads
}

/// How each return of `func` builds the string it returns, keyed by the value
/// it returns; `None` for a function that does not return a string.
#[must_use]
pub fn returned_strings(func: &Func) -> Option<BTreeMap<ValueId, ReturnedString>> {
    if !is_string(&func.return_type) {
        return None;
    }
    let returned: BTreeSet<ValueId> = func
        .blocks
        .iter()
        .filter_map(|block| match block.terminator {
            Terminator::Return(Some(value)) => Some(value),
            _ => None,
        })
        .collect();
    let classes = Classes::of(func);
    let reads = reads(func);
    let mut answers = BTreeMap::new();
    for &value in &returned {
        let members = classes.members(value);
        let answer = if accumulates(func, &members) {
            ReturnedString::Accumulated(members)
        } else if matches!(
            func.value(value).kind,
            OpKind::Call {
                callee: Callee::Direct(_),
                ..
            }
        ) && reads.get(&value).is_some_and(|&(count, _)| count == 1)
        {
            ReturnedString::Call(value)
        } else {
            ReturnedString::Value(value)
        };
        answers.insert(value, answer);
    }
    Some(answers)
}

fn is_string(ty: &HirType) -> bool {
    matches!(ty, HirType::Managed(ManagedType::String))
}

/// A terminator's edges: each target, and the values it hands that target's
/// parameters.
fn edges(terminator: &Terminator) -> Vec<(BlockId, &[ValueId])> {
    match terminator {
        Terminator::Jump { target, args } => vec![(*target, args.as_slice())],
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (*then_target, then_args.as_slice()),
            (*else_target, else_args.as_slice()),
        ],
        Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => Vec::new(),
    }
}

/// Storage locations: string values joined by block-parameter edges and by
/// the left operand of a concatenation, `out = out + piece` naming one
/// location twice.
struct Classes {
    parent: Vec<usize>,
}

impl Classes {
    fn of(func: &Func) -> Self {
        let mut classes = Self {
            parent: (0..func.values.len()).collect(),
        };
        for block in &func.blocks {
            for (target, args) in edges(&block.terminator) {
                let params = &func.blocks[target.0 as usize].params;
                for (param, arg) in params.iter().zip(args) {
                    if is_string(&func.value(*param).ty) {
                        classes.union(param.0 as usize, arg.0 as usize);
                    }
                }
            }
            for &id in &block.ops {
                if let OpKind::Binary {
                    op: BinOp::Concat,
                    lhs,
                    ..
                } = func.value(id).kind
                {
                    classes.union(id.0 as usize, lhs.0 as usize);
                }
            }
        }
        classes
    }

    fn find(&mut self, at: usize) -> usize {
        let mut root = at;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut walk = at;
        while self.parent[walk] != root {
            let next = self.parent[walk];
            self.parent[walk] = root;
            walk = next;
        }
        root
    }

    fn union(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[a] = b;
        }
    }

    fn members(&self, value: ValueId) -> BTreeSet<ValueId> {
        let mut classes = Self {
            parent: self.parent.clone(),
        };
        let root = classes.find(value.0 as usize);
        (0..classes.parent.len())
            .filter(|&at| classes.find(at) == root)
            .map(|at| ValueId(u32::try_from(at).unwrap_or(u32::MAX)))
            .collect()
    }
}

/// Whether `members` is an accumulation nothing else reads; the module note
/// says why each rule.
fn accumulates(func: &Func, members: &BTreeSet<ValueId>) -> bool {
    defined_as_an_accumulation(func, members)
        && read_as_an_accumulation(func, members)
        && one_storage(func, members)
}

/// Defined only by a seed, a concatenation onto a member, or a block
/// parameter; and by at least one seed, where the accumulation starts.
///
/// A seed is a literal or a direct call's answer. `member` in
/// `runtime/web-platform/src/json/text.ts` returns
/// `quoteJSONString(key) + ":" + valueText`, which starts with a call:
/// appended into a caller's accumulator, the call appends there too (its own
/// variant, where it has one) and the colon and the value follow, where the
/// literal-only rule left the whole member a string of its own to copy. That is `json-serialize`'s
/// per-member site, and `json-build-append`'s two. A call seed needs a
/// concatenation onto it: an accumulation that is only a call's answer is
/// that call returned, which [`ReturnedString::Call`] already says.
///
/// A runtime helper's answer seeds one too. `numberText` returns
/// `Number.isFinite(value) ? String(value) : "null"`: the two arms meet in a
/// block parameter, and with the helper's `String(value)` a member the return
/// is an accumulation, so appended it writes the number into the caller's
/// string (`nts_str_append_number`) or the literal, where it was a value to
/// copy. A seed is only ever appended by value, so it need not be fresh.
fn defined_as_an_accumulation(func: &Func, members: &BTreeSet<ValueId>) -> bool {
    let live: BTreeSet<ValueId> = func
        .blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .collect();
    let (mut literal, mut call, mut concatenated) = (false, false, false);
    for &member in members {
        if !live.contains(&member) {
            continue;
        }
        match &func.value(member).kind {
            OpKind::ConstString(_) => literal = true,
            OpKind::Call {
                callee: Callee::Direct(_) | Callee::External(_),
                ..
            } => call = true,
            OpKind::BlockParam(_) => {}
            OpKind::Binary {
                op: BinOp::Concat,
                lhs,
                ..
            } if members.contains(lhs) => concatenated = true,
            _ => return false,
        }
    }
    literal || (call && concatenated)
}

/// Read only as a concatenation's left operand, across an edge to a member,
/// or by a return; never as a concatenation's right operand, which would be a
/// prepend, and never as a branch's condition.
fn read_as_an_accumulation(func: &Func, members: &BTreeSet<ValueId>) -> bool {
    func.blocks.iter().all(|block| {
        let ops = block.ops.iter().all(|&id| match &func.value(id).kind {
            OpKind::Binary {
                op: BinOp::Concat,
                rhs,
                ..
            } => !members.contains(rhs),
            other => !super::operands_of(other)
                .iter()
                .any(|operand| members.contains(operand)),
        });
        ops && match &block.terminator {
            Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => true,
            terminator => {
                let cond = match terminator {
                    Terminator::Branch { cond, .. } => members.contains(cond),
                    _ => false,
                };
                !cond
                    && edges(terminator).iter().all(|(target, args)| {
                        let params = &func.blocks[target.0 as usize].params;
                        params
                            .iter()
                            .zip(args.iter())
                            .all(|(param, arg)| !members.contains(arg) || members.contains(param))
                    })
            }
        }
    })
}

/// The members are one storage, by core's liveness: none is dropped. A member
/// defined in a block is read there or live out of it, and a member live at a
/// block's end is live into each successor or handed to it on that edge. The
/// module note says why that also means no two are live at once, given the
/// reads [`read_as_an_accumulation`] allows.
///
/// A `throw` is not a way out: it lowers to an edge to its handler within the
/// function, which this checks like any other, and a call that can throw is
/// refused inside a `try`, so a variant's callee that throws ends the program
/// before anything reads the builder.
fn one_storage(func: &Func, members: &BTreeSet<ValueId>) -> bool {
    let liveness = super::liveness::analyze(func);
    func.blocks.iter().enumerate().all(|(index, block)| {
        let id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        let mut live: BTreeSet<ValueId> = liveness
            .live_out(id)
            .iter()
            .chain(&super::operands_of_terminator(&block.terminator))
            .copied()
            .filter(|value| members.contains(value))
            .collect();
        let kept = edges(&block.terminator).iter().all(|(target, args)| {
            live.iter()
                .all(|member| liveness.live_in(*target).contains(member) || args.contains(member))
        });
        if !kept {
            return false;
        }
        // Back from the block's end: a member's definition is where it stops
        // being live, and it has to have been, or it was dropped where it began.
        for &op in block.ops.iter().rev() {
            if members.contains(&op) && !live.remove(&op) {
                return false;
            }
            live.extend(
                super::operands_of(&func.value(op).kind)
                    .into_iter()
                    .filter(|operand| members.contains(operand)),
            );
        }
        block
            .params
            .iter()
            .all(|param| !members.contains(param) || live.remove(param))
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::collections::BTreeSet;

    use super::{ReturnedString, appended_calls, returned_strings};
    use crate::hir::{
        BinOp, Block, BlockId, Callee, Func, HirType, Op, OpKind, Terminator, ValueId,
    };
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    const STR: HirType = HirType::Managed(crate::hir::ManagedType::String);

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

    fn concat(lhs: u32, rhs: u32) -> OpKind {
        OpKind::Binary {
            op: BinOp::Concat,
            lhs: ValueId(lhs),
            rhs: ValueId(rhs),
        }
    }

    fn call(name: &str, args: &[u32]) -> OpKind {
        OpKind::Call {
            callee: Callee::Direct(name.to_owned()),
            args: args.iter().map(|&at| ValueId(at)).collect(),
            frame: None,
        }
    }

    /// A function of one block whose values are all live, in order.
    fn func(values: Vec<Op>, end: Terminator) -> Func {
        let ops = (0..values.len())
            .map(|at| ValueId(u32::try_from(at).unwrap()))
            .collect();
        Func {
            name: "f".to_owned(),
            params: Vec::new(),
            return_type: STR,
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            written_return_elements: Vec::new(),
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: end,
            }],
            origin: origin(),
            exported: false,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
        }
    }

    /// `let out = "{"; out += g(); out += "}"; return out`: the call is only
    /// appended, and the return reads an accumulation.
    fn row() -> Func {
        func(
            vec![
                op(OpKind::ConstString("{".into()), STR),
                op(call("g", &[]), STR),
                op(concat(0, 1), STR),
                op(OpKind::ConstString("}".into()), STR),
                op(concat(2, 3), STR),
            ],
            Terminator::Return(Some(ValueId(4))),
        )
    }

    #[test]
    fn a_call_appended_once_is_an_appended_call() {
        assert_eq!(appended_calls(&row()), BTreeSet::from([ValueId(1)]));
    }

    #[test]
    fn an_accumulation_only_appended_and_returned_is_accumulated() {
        let answer = returned_strings(&row()).unwrap();
        assert_eq!(
            answer.get(&ValueId(4)),
            Some(&ReturnedString::Accumulated(BTreeSet::from([
                ValueId(0),
                ValueId(2),
                ValueId(4)
            ])))
        );
    }

    /// The control for the call: read twice, or read other than appended, its
    /// answer has to exist.
    #[test]
    fn a_call_read_otherwise_is_not_appended() {
        let mut twice = row();
        twice.values.push(op(concat(1, 1), STR));
        twice.blocks[0].ops.push(ValueId(5));
        assert!(appended_calls(&twice).is_empty());
        let returned = func(
            vec![op(call("g", &[]), STR)],
            Terminator::Return(Some(ValueId(0))),
        );
        assert!(appended_calls(&returned).is_empty());
        assert_eq!(
            returned_strings(&returned).unwrap().get(&ValueId(0)),
            Some(&ReturnedString::Call(ValueId(0)))
        );
    }

    /// `return quote() + ":" + value()`: an accumulation a call's answer
    /// starts, which appends where that call does. `return g()` alone stays a
    /// call (above): a call seed needs a concatenation onto it.
    #[test]
    fn a_call_seeded_accumulation_is_accumulated() {
        let member = func(
            vec![
                op(call("quote", &[]), STR),
                op(OpKind::ConstString(":".into()), STR),
                op(concat(0, 1), STR),
                op(call("value", &[]), STR),
                op(concat(2, 3), STR),
            ],
            Terminator::Return(Some(ValueId(4))),
        );
        assert_eq!(
            returned_strings(&member).unwrap().get(&ValueId(4)),
            Some(&ReturnedString::Accumulated(BTreeSet::from([
                ValueId(0),
                ValueId(2),
                ValueId(4)
            ])))
        );
        assert_eq!(appended_calls(&member), BTreeSet::from([ValueId(3)]));
    }

    /// `return finite ? String(value) : "null"`: a runtime helper's answer and a
    /// literal meeting in a block parameter are an accumulation, which a
    /// caller's string can take the number or the literal into.
    #[test]
    fn a_helper_answer_or_a_literal_is_accumulated() {
        let text = Func {
            values: vec![
                op(OpKind::ConstBool(true), crate::hir::HirType::Bool),
                op(
                    OpKind::Call {
                        callee: Callee::External("nts_number_to_string".to_owned()),
                        args: Vec::new(),
                        frame: None,
                    },
                    STR,
                ),
                op(OpKind::ConstString("null".into()), STR),
                op(OpKind::BlockParam(0), STR),
            ],
            blocks: vec![
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(0)],
                    terminator: Terminator::Branch {
                        cond: ValueId(0),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(1)],
                    terminator: Terminator::Jump {
                        target: BlockId(3),
                        args: vec![ValueId(1)],
                    },
                },
                Block {
                    params: Vec::new(),
                    ops: vec![ValueId(2)],
                    terminator: Terminator::Jump {
                        target: BlockId(3),
                        args: vec![ValueId(2)],
                    },
                },
                Block {
                    params: vec![ValueId(3)],
                    ops: Vec::new(),
                    terminator: Terminator::Return(Some(ValueId(3))),
                },
            ],
            ..func(Vec::new(), Terminator::Unreachable)
        };
        assert_eq!(
            returned_strings(&text).unwrap().get(&ValueId(3)),
            Some(&ReturnedString::Accumulated(BTreeSet::from([
                ValueId(1),
                ValueId(2),
                ValueId(3)
            ])))
        );
    }

    /// A returned call whose answer something else reads has to exist, so it
    /// is a value, not a call to hand on.
    #[test]
    fn a_returned_call_read_elsewhere_is_a_value() {
        let shared = func(
            vec![
                op(call("g", &[]), STR),
                op(call("log", &[0]), HirType::Void),
            ],
            Terminator::Return(Some(ValueId(0))),
        );
        assert_eq!(
            returned_strings(&shared).unwrap().get(&ValueId(0)),
            Some(&ReturnedString::Value(ValueId(0)))
        );
    }

    /// A `.length` of the accumulation would count the caller's characters
    /// too, so the return falls back to a value of its own.
    #[test]
    fn a_measured_accumulation_is_a_value() {
        let mut measured = row();
        measured.values.push(op(
            OpKind::Length(ValueId(2)),
            HirType::Int {
                bits: 32,
                signed: true,
            },
        ));
        measured.blocks[0].ops.insert(3, ValueId(5));
        assert_eq!(
            returned_strings(&measured).unwrap().get(&ValueId(4)),
            Some(&ReturnedString::Value(ValueId(4)))
        );
    }

    /// Two appends onto one member would both land in the one storage.
    #[test]
    fn a_member_appended_twice_is_a_value() {
        let forked = func(
            vec![
                op(OpKind::ConstString("a".into()), STR),
                op(OpKind::ConstString("x".into()), STR),
                op(concat(0, 1), STR),
                op(OpKind::ConstString("y".into()), STR),
                op(concat(0, 3), STR),
            ],
            Terminator::Return(Some(ValueId(4))),
        );
        assert_eq!(
            returned_strings(&forked).unwrap().get(&ValueId(4)),
            Some(&ReturnedString::Value(ValueId(4)))
        );
    }

    /// A prepend reads the accumulation as its own concatenation's right
    /// operand: `out = "x" + out` round a loop, where the back edge makes the
    /// right operand a member.
    #[test]
    fn a_prepended_accumulation_is_a_value() {
        let mut looped = func(
            vec![
                op(OpKind::ConstString("".into()), STR),
                op(OpKind::BlockParam(0), STR),
                op(OpKind::ConstBool(true), HirType::Bool),
                op(OpKind::ConstString("x".into()), STR),
                op(concat(3, 1), STR),
            ],
            Terminator::Jump {
                target: BlockId(1),
                args: vec![ValueId(0)],
            },
        );
        loop_shape(&mut looped);
        assert_eq!(
            returned_strings(&looped).unwrap().get(&ValueId(1)),
            Some(&ReturnedString::Value(ValueId(1)))
        );
    }

    /// An accumulation carried round a loop is one location across the back
    /// edge, and still accumulated.
    #[test]
    fn an_accumulation_round_a_loop_is_accumulated() {
        let mut looped = func(
            vec![
                op(OpKind::ConstString("".into()), STR),
                op(OpKind::BlockParam(0), STR),
                op(OpKind::ConstBool(true), HirType::Bool),
                op(OpKind::ConstString("x".into()), STR),
                op(concat(1, 3), STR),
            ],
            Terminator::Jump {
                target: BlockId(1),
                args: vec![ValueId(0)],
            },
        );
        loop_shape(&mut looped);
        assert_eq!(
            returned_strings(&looped).unwrap().get(&ValueId(1)),
            Some(&ReturnedString::Accumulated(BTreeSet::from([
                ValueId(0),
                ValueId(1),
                ValueId(4)
            ])))
        );
    }

    /// `c ? "a" : "b"` and then appends: two seeds, one per path, are one
    /// storage. The control for the two below.
    #[test]
    fn seeds_on_exclusive_paths_are_accumulated() {
        let mut joined = func(
            vec![
                op(OpKind::ConstBool(true), HirType::Bool),
                op(OpKind::ConstString("a".into()), STR),
                op(OpKind::ConstString("b".into()), STR),
                op(OpKind::BlockParam(0), STR),
                op(OpKind::ConstString("x".into()), STR),
                op(concat(3, 4), STR),
            ],
            Terminator::Branch {
                cond: ValueId(0),
                then_target: BlockId(1),
                then_args: Vec::new(),
                else_target: BlockId(2),
                else_args: Vec::new(),
            },
        );
        joined.blocks[0].ops = vec![ValueId(0)];
        for seed in [1, 2] {
            joined.blocks.push(Block {
                params: Vec::new(),
                ops: vec![ValueId(seed)],
                terminator: Terminator::Jump {
                    target: BlockId(3),
                    args: vec![ValueId(seed)],
                },
            });
        }
        joined.blocks.push(Block {
            params: vec![ValueId(3)],
            ops: vec![ValueId(4), ValueId(5)],
            terminator: Terminator::Return(Some(ValueId(5))),
        });
        assert_eq!(
            returned_strings(&joined).unwrap().get(&ValueId(5)),
            Some(&ReturnedString::Accumulated(BTreeSet::from([
                ValueId(1),
                ValueId(2),
                ValueId(3),
                ValueId(5)
            ])))
        );
    }

    /// `let out = "a"; if (c) out = "b"; out += "x"`: the path through `"b"`
    /// leaves `"a"` behind, and handed one builder its characters would stay.
    #[test]
    fn a_seed_one_path_drops_is_a_value() {
        let mut dropped = func(
            vec![
                op(OpKind::ConstBool(true), HirType::Bool),
                op(OpKind::ConstString("a".into()), STR),
                op(OpKind::ConstString("b".into()), STR),
                op(OpKind::BlockParam(0), STR),
                op(OpKind::ConstString("x".into()), STR),
                op(concat(3, 4), STR),
            ],
            Terminator::Branch {
                cond: ValueId(0),
                then_target: BlockId(1),
                then_args: Vec::new(),
                else_target: BlockId(2),
                else_args: vec![ValueId(1)],
            },
        );
        dropped.blocks[0].ops = vec![ValueId(0), ValueId(1)];
        dropped.blocks.push(Block {
            params: Vec::new(),
            ops: vec![ValueId(2)],
            terminator: Terminator::Jump {
                target: BlockId(2),
                args: vec![ValueId(2)],
            },
        });
        dropped.blocks.push(Block {
            params: vec![ValueId(3)],
            ops: vec![ValueId(4), ValueId(5)],
            terminator: Terminator::Return(Some(ValueId(5))),
        });
        assert_eq!(
            returned_strings(&dropped).unwrap().get(&ValueId(5)),
            Some(&ReturnedString::Value(ValueId(5)))
        );
    }

    /// A seed handed to both arms of a branch, one returning it and the other
    /// returning `"q"` instead: the parameter that arm declares is dropped
    /// where the arm begins, and handed one builder the seed's characters
    /// would come before the `"q"`.
    #[test]
    fn a_parameter_one_path_drops_is_a_value() {
        let mut dropped = func(
            vec![
                op(OpKind::ConstBool(true), HirType::Bool),
                op(OpKind::ConstString("a".into()), STR),
                op(OpKind::BlockParam(0), STR),
                op(OpKind::BlockParam(0), STR),
                op(OpKind::ConstString("q".into()), STR),
            ],
            Terminator::Branch {
                cond: ValueId(0),
                then_target: BlockId(1),
                then_args: vec![ValueId(1)],
                else_target: BlockId(2),
                else_args: vec![ValueId(1)],
            },
        );
        dropped.blocks[0].ops = vec![ValueId(0), ValueId(1)];
        dropped.blocks.push(Block {
            params: vec![ValueId(2)],
            ops: vec![ValueId(4)],
            terminator: Terminator::Return(Some(ValueId(4))),
        });
        dropped.blocks.push(Block {
            params: vec![ValueId(3)],
            ops: Vec::new(),
            terminator: Terminator::Return(Some(ValueId(3))),
        });
        assert_eq!(
            returned_strings(&dropped).unwrap().get(&ValueId(3)),
            Some(&ReturnedString::Value(ValueId(3)))
        );
    }

    /// `const a = "A"; let out = "["; out += "x"; return c ? out : a`: two
    /// seeds live at once, which one builder would hold both of.
    #[test]
    fn seeds_live_at_once_are_a_value() {
        let mut overlapping = func(
            vec![
                op(OpKind::ConstString("A".into()), STR),
                op(OpKind::ConstString("[".into()), STR),
                op(OpKind::ConstString("x".into()), STR),
                op(concat(1, 2), STR),
                op(OpKind::ConstBool(true), HirType::Bool),
                op(OpKind::BlockParam(0), STR),
            ],
            Terminator::Branch {
                cond: ValueId(4),
                then_target: BlockId(1),
                then_args: vec![ValueId(3)],
                else_target: BlockId(1),
                else_args: vec![ValueId(0)],
            },
        );
        overlapping.blocks[0].ops = (0..5).map(ValueId).collect();
        overlapping.blocks.push(Block {
            params: vec![ValueId(5)],
            ops: Vec::new(),
            terminator: Terminator::Return(Some(ValueId(5))),
        });
        assert_eq!(
            returned_strings(&overlapping).unwrap().get(&ValueId(5)),
            Some(&ReturnedString::Value(ValueId(5)))
        );
    }

    /// Values 0..=4 as a loop: 0 seeds the header's parameter 1, the body
    /// computes 3 and 4 and hands 4 back, and the exit returns 1.
    fn loop_shape(looped: &mut Func) {
        looped.blocks[0].ops = vec![ValueId(0)];
        looped.blocks.push(Block {
            params: vec![ValueId(1)],
            ops: vec![ValueId(2)],
            terminator: Terminator::Branch {
                cond: ValueId(2),
                then_target: BlockId(2),
                then_args: Vec::new(),
                else_target: BlockId(3),
                else_args: Vec::new(),
            },
        });
        looped.blocks.push(Block {
            params: Vec::new(),
            ops: vec![ValueId(3), ValueId(4)],
            terminator: Terminator::Jump {
                target: BlockId(1),
                args: vec![ValueId(4)],
            },
        });
        looped.blocks.push(Block {
            params: Vec::new(),
            ops: Vec::new(),
            terminator: Terminator::Return(Some(ValueId(1))),
        });
    }

    #[test]
    fn a_function_returning_no_string_has_no_answer() {
        let mut number = row();
        number.return_type = HirType::NUMBER;
        assert!(returned_strings(&number).is_none());
    }
}
