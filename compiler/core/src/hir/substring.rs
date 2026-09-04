//! A substring nothing reads as a string.
//!
//! # The measurement this exists for
//!
//! `benches/cases/substrings` is the worst C++ ratio on the board, and its own
//! header says why it is there: `substring` is O(1) for anything that can
//! return a *view* of its input and O(n) for anything that must copy.
//!
//! What it costs was mismeasured twice. 0049 said we allocate, and we do not —
//! a substring that does not escape is written into frame storage. 0059 then
//! put the copy at 13% from a `perf` profile and blamed the rest on the scan
//! loop not unrolling. That was wrong too: the samples land in `memcpy`'s libc
//! internals and on the call, so no single symbol carries the cost.
//!
//! Reducing the copy to one byte — which this benchmark cannot tell apart,
//! since it reads only the length and the first character — answers it:
//!
//! ```text
//! full copy      3.02us   1.87x C++   0.48x node
//! one byte       1.91us   1.11x C++   0.28x node
//! ```
//!
//! The copy is 1.11us of a 1.32us gap. Not 13%.
//!
//! # What it does
//!
//! A substring whose every use asks for its *length* or one of its
//! *characters* is never read as a string, so it does not have to be one. Both
//! questions can be answered from the source and the two endpoints:
//!
//! ```text
//! text.substring(a, b).length      ->  end - start
//! text.substring(a, b)[k]          ->  text[start + k]
//! ```
//!
//! where `start` and `end` are the endpoints after the clamping `substring`
//! does. The call goes, and `dce` collects it.
//!
//! # The clamping is not optional, and it is not free either
//!
//! `substring` is not `slice`. It clamps both endpoints into `[0, length]` and
//! *swaps* them if they arrive out of order, so `"abc".substring(2, 0)` is
//! `"ab"`. Emitting `b - a` and `text[a + k]` would be right for the loop this
//! benchmark is written as and wrong for the language.
//!
//! So four operations go in where the call came out: two `Min`/`Max` pairs to
//! clamp, then a `Min` and a `Max` to order. They are integer instructions, and
//! against a call and a `memcpy` that is the trade this pass is making.
//!
//! Two attempts to *estimate* that trade in TypeScript first were both unfair
//! and both said the opposite of the truth. Writing `i - start` loses the
//! bound the clamping supplies, so the accumulator sank to a double and the
//! row got slower. Writing `Math.min`/`Math.max` lowers to `nts_min` and
//! `nts_max`, which carry JavaScript's NaN and negative-zero rules and are
//! calls. Neither is what this emits.
//!
//! # What it refuses
//!
//! **An endpoint that is not already an integer.** Then `substring` also has to
//! apply `ToIntegerOrInfinity` — truncate toward zero, and NaN becomes 0 —
//! which the clamping above does not do and `Max(NaN, 0)` does not fix. This
//! runs after specialization precisely so that the common case has integers and
//! this one can be declined.
//!
//! **Any use that is not a length or a character.** A substring that is
//! returned, stored, compared or concatenated is read as a string, and one of
//! those sinks it.

use rustc_hash::FxHashMap;

use super::{BinOp, Callee, Func, HirType, ManagedType, Op, OpKind, ValueId};

/// The runtime helper a `substring` lowers to.
const SUBSTRING: &str = "nts_str_substring";

/// Replace every substring nothing reads as a string. Reports how many.
pub fn elide(func: &mut Func) -> usize {
    let candidates: Vec<ValueId> = (0..func.values.len())
        .map(|index| ValueId(u32::try_from(index).unwrap_or(0)))
        .filter(|value| is_substring(func, *value))
        .collect();
    if candidates.is_empty() {
        return 0;
    }

    let mut done = 0;
    for value in candidates {
        if rewrite(func, value).is_some() {
            done += 1;
        }
    }
    done
}

/// A call to the substring helper that produces a string.
fn is_substring(func: &Func, value: ValueId) -> bool {
    let op = func.value(value);
    let OpKind::Call { callee, args, .. } = &op.kind else {
        return false;
    };
    let (Callee::Direct(name) | Callee::External(name)) = callee else {
        return false;
    };
    name.as_str() == SUBSTRING
        && args.len() == 3
        && op.ty == HirType::Managed(ManagedType::String)
}

/// The integer underneath a conversion, where there is one.
///
/// The call takes doubles because the C signature does, so specialization puts
/// a `convert` in front of an index it had already made an integer. Reading
/// through it is what lets this fire at all.
fn integer_under(func: &Func, value: ValueId) -> Option<(ValueId, HirType)> {
    let op = func.value(value);
    if let HirType::Int { .. } = op.ty {
        return Some((value, op.ty.clone()));
    }
    let OpKind::Convert(inner) = op.kind else {
        return None;
    };
    let under = func.value(inner);
    match under.ty {
        HirType::Int { .. } => Some((inner, under.ty.clone())),
        _ => None,
    }
}

/// Every use of a value: which operations read it, and whether anything else
/// does.
///
/// A terminator counts. A substring returned from a block is read as a string
/// by whoever receives it, and missing that would be the same hole `split` had.
fn uses(func: &Func, value: ValueId) -> Option<Vec<ValueId>> {
    let mut readers = Vec::new();
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        let reads = super::operands_of(&func.values[index].kind);
        if !reads.contains(&value) {
            continue;
        }
        match &func.values[index].kind {
            OpKind::Length(of) if *of == value => readers.push(id),
            OpKind::StringUnitAt { string, .. } if *string == value => readers.push(id),
            _ => return None,
        }
    }
    for block in &func.blocks {
        if super::operands_of_terminator(&block.terminator).contains(&value) {
            return None;
        }
    }
    Some(readers)
}

/// Where a value is defined, as a position in a block's operations.
fn site(func: &Func, value: ValueId) -> Option<(usize, usize)> {
    for (block, at) in func.blocks.iter().enumerate() {
        if let Some(index) = at.ops.iter().position(|id| *id == value) {
            return Some((block, index));
        }
    }
    None
}

fn rewrite(func: &mut Func, value: ValueId) -> Option<()> {
    let OpKind::Call { args, .. } = func.value(value).kind.clone() else {
        return None;
    };
    let (source, from, to) = (args[0], args[1], args[2]);
    let (from, ty) = integer_under(func, from)?;
    let (to, other) = integer_under(func, to)?;
    if other != ty {
        return None;
    }
    let readers = uses(func, value)?;
    if readers.is_empty() {
        return None;
    }
    let (block, at) = site(func, value)?;
    let origin = func.value(value).origin.clone();

    // Built in order and inserted where the call was, so every one of them
    // dominates the uses the call dominated.
    let mut made = Vec::new();
    let mut push = |func: &mut Func, kind: OpKind| {
        let id = ValueId(u32::try_from(func.values.len()).unwrap_or(0));
        func.values.push(Op {
            kind,
            ty: ty.clone(),
            origin: origin.clone(),
        });
        made.push(id);
        id
    };

    let length = push(func, OpKind::Length(source));
    let zero = push(func, OpKind::ConstInt(0));
    let binary = |func: &mut Func, made: &mut Vec<ValueId>, op: BinOp, lhs, rhs| {
        let id = ValueId(u32::try_from(func.values.len()).unwrap_or(0));
        func.values.push(Op {
            kind: OpKind::Binary { op, lhs, rhs },
            ty: ty.clone(),
            origin: origin.clone(),
        });
        made.push(id);
        id
    };

    // `Min(Max(x, 0), length)` is the clamp, in that order: `Max` first so a
    // negative index becomes 0 rather than surviving as a negative that `Min`
    // would keep.
    let lo_raw = binary(func, &mut made, BinOp::Max, from, zero);
    let lo_clamped = binary(func, &mut made, BinOp::Min, lo_raw, length);
    let hi_raw = binary(func, &mut made, BinOp::Max, to, zero);
    let hi_clamped = binary(func, &mut made, BinOp::Min, hi_raw, length);
    // ...and then the swap, which is what makes this `substring` and not
    // `slice`.
    let start = binary(func, &mut made, BinOp::Min, lo_clamped, hi_clamped);
    let end = binary(func, &mut made, BinOp::Max, lo_clamped, hi_clamped);

    // The reads, each answered from the endpoints rather than from a string.
    let mut added: FxHashMap<ValueId, Vec<ValueId>> = FxHashMap::default();
    for reader in readers {
        match func.value(reader).kind.clone() {
            OpKind::Length(_) => {
                func.values[reader.0 as usize].kind = OpKind::Binary {
                    op: BinOp::Sub,
                    lhs: end,
                    rhs: start,
                };
            }
            OpKind::StringUnitAt { index, checked, .. } => {
                let shifted = ValueId(u32::try_from(func.values.len()).unwrap_or(0));
                func.values.push(Op {
                    kind: OpKind::Binary {
                        op: BinOp::Add,
                        lhs: start,
                        rhs: index,
                    },
                    ty: func.value(index).ty.clone(),
                    origin: origin.clone(),
                });
                added.entry(reader).or_default().push(shifted);
                func.values[reader.0 as usize].kind = OpKind::StringUnitAt {
                    string: source,
                    index: shifted,
                    checked,
                };
            }
            _ => {}
        }
    }

    // The new arithmetic goes where the call was, and the call goes with it.
    //
    // `dce` will not collect it: an external call is opaque, so nothing can
    // prove it has no effect and nothing tries. This one's only effect is
    // filling the frame storage that nothing reads any more, which is exactly
    // what the rewrite above established -- so the pass that established it is
    // the pass that may remove it.
    // The call stops being a call, rather than merely leaving its block.
    //
    // Two passes read the value arena directly and neither cares whether a
    // block still holds the operation: `place_allocations` hands frame storage
    // to every `Call` it finds that could take some, and the C emitter declares
    // a `_frame` for every `Call` that has any. Clearing the field is not
    // enough because the first of those puts it back. An unused `_frame` is
    // `-Wunused-variable`, which the generated file is compiled with as an
    // error, so this is a build failure rather than a waste.
    //
    // Nothing reads the value and no block defines it, so what it says is only
    // ever going to be read by a scan like those two.
    func.values[value.0 as usize].kind = OpKind::ConstNull;
    let ops = &mut func.blocks[block].ops;
    ops.remove(at);
    for (offset, id) in made.into_iter().enumerate() {
        ops.insert(at + offset, id);
    }
    for (reader, shifted) in added {
        if let Some((reader_block, reader_at)) = site(func, reader) {
            for id in shifted {
                func.blocks[reader_block].ops.insert(reader_at, id);
            }
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, Param, Terminator};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

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

    const I32: HirType = HirType::Int {
        bits: 32,
        signed: true,
    };

    /// `s.substring(a, b)` where the reads are whatever the caller supplies.
    fn program(reads: Vec<Op>, tail: Terminator, endpoint: HirType) -> Func {
        let mut values = vec![
            op(OpKind::Param(0), HirType::Managed(ManagedType::String)),
            op(OpKind::Param(1), endpoint.clone()),
            op(OpKind::Param(2), endpoint),
            op(
                OpKind::Call {
                    callee: Callee::External(SUBSTRING.to_owned()),
                    args: vec![ValueId(0), ValueId(1), ValueId(2)],
                    frame: Some(80),
                },
                HirType::Managed(ManagedType::String),
            ),
        ];
        let first = values.len();
        values.extend(reads);
        let ops: Vec<ValueId> = (3..values.len())
            .map(|at| ValueId(u32::try_from(at).unwrap_or(0)))
            .collect();
        let _ = first;
        Func {
            name: "span".to_owned(),
            params: vec![
                Param {
                    name: "s".to_owned(),
                    ty: HirType::Managed(ManagedType::String),
                    origin: origin(),
                    known: crate::hir::facts::Facts::TOP,
                },
                Param {
                    name: "a".to_owned(),
                    ty: I32,
                    origin: origin(),
                    known: crate::hir::facts::Facts::TOP,
                },
                Param {
                    name: "b".to_owned(),
                    ty: I32,
                    origin: origin(),
                    known: crate::hir::facts::Facts::TOP,
                },
            ],
            return_type: HirType::NUMBER,
            values,
            blocks: vec![Block {
                params: Vec::new(),
                ops,
                terminator: tail,
            }],
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            abstract_declaration: false,
        }
    }

    /// The whole point: the call goes, and what is left answers both questions
    /// from the endpoints.
    #[test]
    fn a_substring_read_only_for_its_length_and_characters_is_not_built() {
        let mut it = program(
            vec![
                op(OpKind::Length(ValueId(3)), I32),
                op(
                    OpKind::StringUnitAt {
                        string: ValueId(3),
                        index: ValueId(1),
                        checked: false,
                    },
                    I32,
                ),
            ],
            Terminator::Return(Some(ValueId(4))),
            I32,
        );
        assert_eq!(elide(&mut it), 1);

        // The call is neither in the block nor a call any more: `place_allocations`
        // would hand a `Call` frame storage again, and the emitter would name it.
        assert!(!it.blocks[0].ops.contains(&ValueId(3)));
        assert!(!matches!(it.values[3].kind, OpKind::Call { .. }));

        // The length became a subtraction and the character a read of the source.
        assert!(matches!(
            it.values[4].kind,
            OpKind::Binary {
                op: BinOp::Sub,
                ..
            }
        ));
        assert!(matches!(
            it.values[5].kind,
            OpKind::StringUnitAt {
                string: ValueId(0),
                ..
            }
        ));
    }

    /// A substring that is *returned* is read as a string by whoever gets it.
    #[test]
    fn a_substring_that_escapes_is_left_alone() {
        let mut it = program(
            vec![op(OpKind::Length(ValueId(3)), I32)],
            Terminator::Return(Some(ValueId(3))),
            I32,
        );
        assert_eq!(elide(&mut it), 0);
        assert!(matches!(it.values[3].kind, OpKind::Call { .. }));
    }

    /// An endpoint that is not an integer needs `ToIntegerOrInfinity` as well as
    /// clamping -- truncation toward zero, and NaN becoming 0 -- and clamping
    /// alone would answer `Max(NaN, 0)`, which is NaN.
    #[test]
    fn a_fractional_endpoint_is_declined() {
        let mut it = program(
            vec![op(OpKind::Length(ValueId(3)), I32)],
            Terminator::Return(Some(ValueId(4))),
            HirType::NUMBER,
        );
        assert_eq!(elide(&mut it), 0);
        assert!(matches!(it.values[3].kind, OpKind::Call { .. }));
    }

    /// Anything that wants the string itself sinks it, even beside reads that
    /// would have been fine on their own.
    #[test]
    fn one_use_that_wants_the_string_sinks_the_rest() {
        let mut it = program(
            vec![
                op(OpKind::Length(ValueId(3)), I32),
                op(
                    OpKind::Binary {
                        op: BinOp::Concat,
                        lhs: ValueId(3),
                        rhs: ValueId(0),
                    },
                    HirType::Managed(ManagedType::String),
                ),
            ],
            Terminator::Return(Some(ValueId(4))),
            I32,
        );
        assert_eq!(elide(&mut it), 0);
        assert!(matches!(it.values[3].kind, OpKind::Call { .. }));
    }
}
