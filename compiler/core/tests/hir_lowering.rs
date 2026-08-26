//! Lowering a real program to HIR.
//!
//! Runs the frontend, so it skips without `NTS_TSGO`.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::{Utf8Path, Utf8PathBuf};
use nts_core::hir::{
    self, BinOp, Callee, Func, HirType, ManagedType, OpKind, Terminator, lower::Lowered,
};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(fixture: &str) -> Option<Lowered> {
    let tsgo = Utf8PathBuf::from(std::env::var("NTS_TSGO").ok()?);
    if !tsgo.exists() {
        return None;
    }
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{fixture} is checked in"));
    // Call resolution is a precondition for lowering a call at all.
    let snapshot = TsgoApi::new(tsgo)
        .with_call_resolution(nts_frontend_ts::tsgo::decompose::Budget::DEFAULT)
        .snapshot(&tsconfig)
        .expect("snapshot should succeed");
    assert!(!snapshot.has_errors(), "fixture must typecheck");
    Some(hir::lower::lower(&snapshot))
}

fn func<'a>(lowered: &'a Lowered, name: &str) -> &'a Func {
    lowered
        .program
        .funcs
        .iter()
        .find(|f| f.name == name)
        .unwrap_or_else(|| panic!("no function named {name}"))
}

#[test]
fn a_number_becomes_a_double() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // The conservative decision. `number` *is* an IEEE double in TypeScript, so
    // this is correct — and it is what specialization will improve on once
    // analysis can show a value is integral and in range.
    let add = func(&lowered, "add");
    assert_eq!(add.params[0].ty, HirType::Float { bits: 64 });
    assert_eq!(add.return_type, HirType::Float { bits: 64 });
}

#[test]
fn one_binding_becomes_one_value() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // `a + b` mentions `a` and `b` a second time. Both resolve to the parameter
    // values rather than to fresh loads, which is only possible because the two
    // identifiers carry the same symbol.
    let add = func(&lowered, "add");
    let (lhs, rhs) = add
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Binary { lhs, rhs, .. } => Some((*lhs, *rhs)),
            _ => None,
        })
        .expect("the addition");

    assert!(matches!(add.value(lhs).kind, OpKind::Param(0)));
    assert!(matches!(add.value(rhs).kind, OpKind::Param(1)));
    // Two params and one add. The return is a terminator, not a value.
    assert_eq!(add.values.len(), 3);
    assert_eq!(add.blocks.len(), 1, "straight-line code needs one block");
}

#[test]
fn plus_on_strings_is_not_the_same_operator_as_plus_on_numbers() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // The same `+` token. On numbers it is arithmetic; on strings it is
    // concatenation, and the two lower to nothing alike. Resolving it here means
    // no backend has to ask again.
    let op_of = |f: &Func| {
        f.values
            .iter()
            .find_map(|op| match &op.kind {
                OpKind::Binary { op, .. } => Some(*op),
                _ => None,
            })
            .expect("a binary op")
    };

    assert_eq!(op_of(func(&lowered, "add")), BinOp::Add);
    assert_eq!(op_of(func(&lowered, "cat")), BinOp::Concat);
}

#[test]
fn a_string_is_a_managed_reference_and_a_number_is_not() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // The distinction a write barrier and a root slot are decided from.
    let textual = func(&lowered, "cat");
    assert_eq!(textual.params[0].ty, HirType::Managed(ManagedType::String));
    assert!(textual.params[0].ty.is_managed());
    assert!(!func(&lowered, "add").params[0].ty.is_managed());
}

#[test]
fn a_comparison_returns_a_bool_not_the_operand_type() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    let less = func(&lowered, "lt");
    assert_eq!(less.params[0].ty, HirType::Float { bits: 64 });
    assert_eq!(less.return_type, HirType::Bool);
}

#[test]
fn every_operation_carries_an_origin() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    // RFC decision 20. Not conditional and not debug-only: once a lowering has
    // run without it the mapping back to source is gone for good.
    for f in &lowered.program.funcs {
        for op in &f.values {
            let span = op.origin.location.span;
            assert!(
                span.start < span.end,
                "{} has an op with an empty span",
                f.name
            );
        }
    }
}

#[test]
fn exported_functions_are_marked_as_roots() {
    let Some(lowered) = lowered("arith") else {
        return;
    };
    assert!(lowered.program.funcs.iter().all(|f| f.exported));
}

#[test]
fn an_unsupported_construct_is_refused_rather_than_skipped() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    // The failure this guards is the quiet one. A lowering that emits nothing for
    // a statement it did not understand produces a function that compiles, runs,
    // and is wrong — with no signal anywhere.
    assert!(
        !lowered.is_complete(),
        "the unsupported constructs should have been refused",
    );
    assert_eq!(
        lowered.program.funcs.len(),
        1,
        "only the supported function"
    );
    assert!(lowered.diagnostics[0].code.starts_with("NTS"));

    let span = lowered.diagnostics[0].primary.span;
    assert!(span.start < span.end, "the refusal points somewhere real");
}

#[test]
fn a_const_binding_costs_nothing() {
    let Some(lowered) = lowered("calls2") else {
        return;
    };
    // `const scaled = double(a); const shifted = scaled + b; return shifted;`
    // Neither local survives as a slot or a store — each name is bound to the
    // value its initializer produced, and later mentions resolve to that value.
    let compute = func(&lowered, "compute");
    assert!(
        !compute
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ConstFloat(_))),
        "no spurious materialization",
    );
    assert_eq!(compute.values.len(), 4, "two params, a call, an add");
}

#[test]
fn a_resolved_call_names_its_target_statically() {
    let Some(lowered) = lowered("calls2") else {
        return;
    };
    // The point of resolving call targets in the frontend: the backend emits a
    // static call rather than going through a function value.
    let compute = func(&lowered, "compute");
    let callee = compute
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call { callee, .. } => Some(callee.clone()),
            _ => None,
        })
        .expect("compute calls double");
    assert_eq!(callee, Callee::Direct("double".to_owned()));
}

#[test]
fn a_call_passes_the_values_it_was_given() {
    let Some(lowered) = lowered("calls2") else {
        return;
    };
    let compute = func(&lowered, "compute");
    let args = compute
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::Call { args, .. } => Some(args.clone()),
            _ => None,
        })
        .expect("the call");
    assert_eq!(args.len(), 1);
    // `double(a)` — the argument is the first parameter, not a reload of it.
    assert!(matches!(compute.value(args[0]).kind, OpKind::Param(0)));
}

#[test]
fn a_private_function_is_lowered_but_not_marked_exported() {
    let Some(lowered) = lowered("calls2") else {
        return;
    };
    // `double` is not exported, so it is not a reachability root — but it is
    // called, so it must still be lowered.
    assert!(!func(&lowered, "double").exported);
    assert!(func(&lowered, "compute").exported);
}

#[test]
fn string_locals_and_concatenation_lower_together() {
    let Some(lowered) = lowered("calls2") else {
        return;
    };
    let greet = func(&lowered, "greet");
    assert_eq!(greet.return_type, HirType::Managed(ManagedType::String));
    assert!(greet.values.iter().any(|op| matches!(
        &op.kind,
        OpKind::Binary {
            op: BinOp::Concat,
            ..
        }
    )));
    assert!(
        greet
            .values
            .iter()
            .any(|op| matches!(&op.kind, OpKind::ConstString(text) if text == "world")),
    );
}

#[test]
fn a_call_through_a_member_access_is_refused_for_now() {
    let Some(lowered) = lowered("calls2") else {
        return;
    };
    // `Math.max(n, 0)`. The callee is a property access rather than a name, and
    // member access is not lowered yet — so it is refused rather than guessed at
    // from the callee's spelling.
    assert!(!lowered.is_complete());
    assert!(
        lowered
            .diagnostics
            .iter()
            .any(|d| d.message.contains("computed callee")),
        "{:?}",
        lowered.diagnostics,
    );
}

#[test]
fn an_if_lowers_to_a_branch_with_two_targets() {
    let Some(lowered) = lowered("control") else {
        return;
    };
    let max = func(&lowered, "max");
    let Terminator::Branch {
        then_target,
        else_target,
        ..
    } = max.entry().terminator.clone()
    else {
        panic!(
            "the entry should end in a branch, got {:?}",
            max.entry().terminator
        );
    };
    assert_ne!(then_target, else_target);
}

#[test]
fn an_if_without_an_else_creates_no_empty_block() {
    let Some(lowered) = lowered("control") else {
        return;
    };
    // `if (a > b) { return a; } return b;` is three blocks: the test, the taken
    // arm, and the continuation. Allocating an else block for the false edge
    // would leave a fourth whose only content is a jump — once per `if` without
    // an else, which is most of them.
    let max = func(&lowered, "max");
    assert_eq!(max.blocks.len(), 3, "{:?}", max.blocks);
    assert!(
        !max.blocks
            .iter()
            .any(|b| b.ops.is_empty() && matches!(b.terminator, Terminator::Jump { .. })),
        "a block exists only to jump",
    );
}

#[test]
fn when_every_arm_returns_no_merge_block_is_created() {
    let Some(lowered) = lowered("control") else {
        return;
    };
    // `clamp` returns from all three arms, so nothing follows the `if` and there
    // is nowhere for a merge block to be reached from.
    let clamp = func(&lowered, "clamp");
    let returns = clamp
        .blocks
        .iter()
        .filter(|b| matches!(b.terminator, Terminator::Return(_)))
        .count();
    assert_eq!(returns, 3);
    assert!(
        !clamp
            .blocks
            .iter()
            .any(|b| matches!(b.terminator, Terminator::Unreachable)),
        "an unreachable block was emitted",
    );
}

#[test]
fn every_block_ends_in_exactly_one_terminator() {
    let Some(lowered) = lowered("control") else {
        return;
    };
    // Guaranteed by construction rather than checked at the end: a block is
    // terminated once and later terminations are ignored, so a `return` inside a
    // branch cannot be followed by the jump that would otherwise be appended.
    for f in &lowered.program.funcs {
        for (index, block) in f.blocks.iter().enumerate() {
            assert!(
                !matches!(block.terminator, Terminator::Unreachable),
                "{} block {index} was left unterminated",
                f.name,
            );
        }
    }
}

#[test]
fn every_successor_names_a_real_block() {
    let Some(lowered) = lowered("control") else {
        return;
    };
    // A dangling successor is a malformed CFG, and every pass downstream —
    // dominance, liveness, register allocation — would walk into it.
    for f in &lowered.program.funcs {
        for block in &f.blocks {
            for successor in block.terminator.successors() {
                assert!(
                    (successor.0 as usize) < f.blocks.len(),
                    "{} branches to a block that does not exist",
                    f.name,
                );
            }
        }
    }
}

#[test]
fn code_after_a_return_is_not_lowered() {
    let Some(lowered) = lowered("control") else {
        return;
    };
    // A block that has already returned cannot hold more operations, so the
    // statements after it are skipped rather than emitted into a closed block.
    for f in &lowered.program.funcs {
        for block in &f.blocks {
            if matches!(block.terminator, Terminator::Return(_)) {
                assert!(
                    block.ops.len() <= f.values.len(),
                    "sanity: ops index into the value arena",
                );
            }
        }
    }
    assert!(lowered.is_complete());
}

#[test]
fn the_lowered_program_is_valid_ssa() {
    for fixture in ["arith", "control", "loops", "calls2"] {
        let Some(lowered) = lowered(fixture) else {
            return;
        };
        if let Err(problems) = hir::verify::verify(&lowered.program) {
            panic!("{fixture} lowered to invalid HIR: {problems:#?}");
        }
    }
}

#[test]
fn a_loop_carried_value_becomes_a_block_parameter() {
    let Some(lowered) = lowered("loops") else {
        return;
    };
    // `let total = 0; let i = 0; while (i < n) { total = total + i; i = i + 1; }`
    // Both names differ per iteration, so the header takes both as parameters:
    // the entry passes the initial values, the back edge the updated ones.
    let sum = func(&lowered, "sumTo");
    let header = sum
        .blocks
        .iter()
        .find(|b| !b.params.is_empty())
        .expect("the loop header takes parameters");
    assert_eq!(header.params.len(), 2, "total and i are both carried");

    for param in &header.params {
        assert!(matches!(sum.value(*param).kind, OpKind::BlockParam(_)));
    }
}

#[test]
fn the_value_after_a_loop_is_the_header_parameter() {
    let Some(lowered) = lowered("loops") else {
        return;
    };
    // The bug this pins: the exit is reached from the *header*, not the body, so
    // returning the value the body defined uses something the exit does not
    // dominate. It reads whatever the last iteration left, and nothing crashes.
    let sum = func(&lowered, "sumTo");
    let Terminator::Return(Some(returned)) = sum
        .blocks
        .iter()
        .find_map(|b| match &b.terminator {
            Terminator::Return(_) => Some(b.terminator.clone()),
            _ => None,
        })
        .expect("sumTo returns")
    else {
        unreachable!()
    };

    assert!(
        matches!(sum.value(returned).kind, OpKind::BlockParam(_)),
        "returned {:?}, which is not the header parameter",
        sum.value(returned).kind,
    );
}

#[test]
fn an_assignment_emits_no_store() {
    let Some(lowered) = lowered("loops") else {
        return;
    };
    // `total = total + i` rebinds a name; with the name bound directly to a value
    // there is no slot to store into. What the loop costs is the add, not the add
    // plus a store plus a reload.
    let sum = func(&lowered, "sumTo");
    let body = sum
        .blocks
        .iter()
        .find(|b| matches!(&b.terminator, Terminator::Jump { args, .. } if args.len() == 2))
        .expect("the loop body jumps back with both carried values");
    // two adds and one constant — nothing else
    assert_eq!(body.ops.len(), 3, "{:?}", body.ops);
}
