//! Lowering a real program to HIR.
//!
//! Runs the frontend, so it skips only when `tsgo` is not built.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
use nts_core::hir::{
    self, BinOp, Callee, Func, HirType, ManagedType, OpKind, Terminator, lower::Lowered,
};
use nts_frontend_ts::{SemanticSource, TsgoApi};

fn lowered(fixture: &str) -> Option<Lowered> {
    let tsgo = nts_frontend_ts::tsgo::locate()?;
    let tsconfig = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples")
        .join(fixture)
        .join("tsconfig.json")
        .canonicalize_utf8()
        .unwrap_or_else(|_| panic!("examples/{fixture} is checked in"));
    // The configuration the compiler itself uses. Building a lighter one here
    // tested a snapshot no user of this compiler ever gets: without decomposed
    // signatures, an un-annotated function's return type is unavailable and
    // lowering has to fall back to reading the annotation that is not there.
    let snapshot = TsgoApi::for_compilation(tsgo)
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
    // Stated over *exports* rather than as a count of functions. Every export
    // in this fixture is a construct the lowering refuses, save `supported` --
    // so an export that survives is one that was silently skipped, which is
    // exactly the failure above. A non-exported helper may lower perfectly well
    // and says nothing about that: the fixture grew an accessor whose getter
    // and setter are fine, and it is the function *using* them that is refused.
    // The count said `1` and started failing the moment that helper arrived,
    // which is a test breaking on a change it was never about.
    let exported: Vec<&str> = lowered
        .program
        .funcs
        .iter()
        .filter(|f| f.exported)
        .map(|f| f.name.as_str())
        .collect();
    assert_eq!(exported, ["supported"], "only the supported export");
    assert!(lowered.diagnostics[0].code.starts_with("NTS"));

    let span = lowered.diagnostics[0].primary.span;
    assert!(span.start < span.end, "the refusal points somewhere real");
}

#[test]
fn an_async_function_is_refused_rather_than_emptied() {
    let Some(lowered) = lowered("async-unsupported") else {
        return;
    };
    // The failure this guards against: `Promise<number>` had no representation,
    // so an `async` function's return type resolved to `void`, the returned
    // value was converted away, and the verifier accepted it. A caller read
    // `undefined` where it asked for a number, with nothing said at compile
    // time.
    //
    // Which is the failure `an_unsupported_construct_is_refused_rather_than_skipped`
    // guards against — and cannot catch, because one refusal among many
    // satisfies it while the silent case sits in the same file.
    //
    // Stated as the invariant rather than as one function's name, so it keeps
    // holding as the fixture changes: an `async` function either is refused, or
    // hands back a promise. Never `void`, and never the payload bare.
    for func in &lowered.program.funcs {
        assert!(
            !matches!(func.return_type, HirType::Void),
            "`{}` is async and lowered to a function returning nothing",
            func.name,
        );
    }
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
fn a_known_math_member_becomes_an_operation() {
    let Some(program) = lowered("calls2") else {
        return;
    };
    // `Math.max(n, 0)` is an operation, not a call. Lowering it as one is what
    // lets the analysis know the result is bounded by its arguments; a call
    // would return TOP and poison everything downstream of it.
    let via_library = program
        .program
        .funcs
        .iter()
        .find(|f| f.name == "viaLibrary")
        .expect("`Math.max` should lower");
    assert!(
        via_library
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::Binary { op: BinOp::Max, .. })),
        "the call should have become a Max operation",
    );
}

#[test]
fn an_unimplemented_math_member_is_refused_rather_than_guessed() {
    let Some(program) = lowered("mathops-unsupported") else {
        return;
    };
    // Emitting a call to a C function that happens to share a name would be
    // assuming libm agrees about the semantics — and for `round` and `min` it
    // demonstrably does not. RFC 4.1: refuse rather than approximate.
    assert!(!program.is_complete());
    assert!(program.diagnostics[0].code.starts_with("NTS"));
}

#[test]
fn a_declaration_with_a_type_annotation_lowers() {
    let Some(program) = lowered("nested") else {
        return;
    };
    // `const scale: number = 3` — the annotation is a child of the declaration,
    // so reading its children positionally found the *type* where the
    // initializer should be and refused it as having none.
    let annotated = program
        .program
        .funcs
        .iter()
        .find(|f| f.name == "annotated")
        .expect("an annotated local should not refuse the whole function");
    assert!(
        annotated
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ConstFloat(v) if (v - 3.0).abs() < f64::EPSILON)),
        "the initializer should have been lowered",
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

/// The blocks a `throw` jumps to: a handler is the only thing that receives an
/// erased value as its first parameter.
fn handlers(func: &Func) -> Vec<&hir::Block> {
    func.blocks
        .iter()
        .filter(|block| {
            block
                .params
                .first()
                .is_some_and(|param| func.values[param.0 as usize].ty == HirType::Erased)
        })
        .collect()
}

#[test]
fn a_thrown_error_is_the_object_and_not_its_message() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // The lowering used to reduce `new Error(m)` to `m` and throw the string,
    // on the reasoning that `Error` was `lib.d.ts`'s and could not be
    // constructed. It is `hir::builtin`'s. Nothing could observe the difference
    // while an uncaught throw was the only outcome -- both spellings print the
    // message and stop -- and a `catch` binding observes it immediately.
    let guarded = func(&lowered, "guarded");
    let erased = guarded
        .values
        .iter()
        .find_map(|op| match op.kind {
            OpKind::Erase { value } => Some(value),
            _ => None,
        })
        .expect("a `throw` erases what it throws");
    assert!(
        matches!(
            guarded.values[erased.0 as usize].ty,
            HirType::Managed(ManagedType::Object(_))
        ),
        "the thrown value is the `Error`, not its `message`: {:?}",
        guarded.values[erased.0 as usize].ty
    );
}

#[test]
fn a_handler_receives_the_thrown_value_as_a_block_parameter() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // Which is the whole mechanism: no unwinder, no landing pad, no table --
    // an edge carrying an argument, of the kind every merge in the program
    // already is.
    let guarded = func(&lowered, "guarded");
    let handlers = handlers(guarded);
    assert_eq!(handlers.len(), 1, "one `try`, one handler");
    assert_eq!(
        handlers[0].params.len(),
        1,
        "nothing but the thrown value: the single `throw` and the handler agree \
         about every name in scope"
    );
}

#[test]
fn a_name_the_throws_disagree_about_becomes_a_parameter() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // `edgesDisagree` assigns `seen` between its two `throw`s, so the handler
    // cannot read one value for it -- and it takes a parameter for `seen` and
    // for nothing else, because every other name in scope is the same value on
    // both edges.
    let disagree = func(&lowered, "edgesDisagree");
    let handlers = handlers(disagree);
    assert_eq!(handlers.len(), 1);
    assert_eq!(
        handlers[0].params.len(),
        2,
        "the thrown value, and `seen`, and nothing else"
    );
}

#[test]
fn a_try_that_cannot_throw_leaves_no_handler() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // A `try` around code that cannot throw is how a person writes
    // defensively. It should cost nothing, and the block is not merely dead --
    // it is never created: a block with no predecessors is one the verifier
    // rejects, which is how this was found.
    let never = func(&lowered, "neverThrows");
    assert!(
        handlers(never).is_empty(),
        "no `throw` in the body, so no handler block"
    );
}

#[test]
fn a_throw_in_a_catch_belongs_to_the_enclosing_try() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // The handler stack is popped before the handler's own body is lowered, so
    // a `throw` inside a `catch` finds the *enclosing* `try` and not the one it
    // is the handler for -- which would be a loop back into itself.
    let nested = func(&lowered, "nested");
    assert_eq!(
        handlers(nested).len(),
        2,
        "two `try`s, two handlers, and the inner one throws to the outer"
    );
}

#[test]
fn a_finally_is_lowered_once_per_way_out() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // `loopThroughFinally` leaves its `try` three ways -- `break`, `continue`,
    // and falling off the end of the body -- and the `finally` runs on each. It
    // is duplicated rather than shared, so its `10` is lowered three times.
    //
    // Sharing one copy would need a variable saying where to continue and a
    // switch on it at the bottom: a branch per exit and a value to carry, for a
    // block that is one statement.
    let loop_through = func(&lowered, "loopThroughFinally");
    let tens = loop_through
        .values
        .iter()
        .filter(|op| matches!(op.kind, OpKind::ConstFloat(ten) if (ten - 10.0).abs() < f64::EPSILON))
        .count();
    assert_eq!(tens, 3, "one copy of the `finally` per way out of the `try`");
}

#[test]
fn a_finally_that_returns_replaces_the_return() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // `try { return 5 } finally { return 99 }` returns 99, and neither 5 nor 6
    // is ever returned. The `finally` is lowered where the `return` would have
    // been, it terminates the block itself, and the `return` that called for it
    // is then never emitted.
    let replaced = func(&lowered, "finallyReplacesTheReturn");
    let returned: Vec<f64> = replaced
        .blocks
        .iter()
        .filter_map(|block| match block.terminator {
            Terminator::Return(Some(value)) => match replaced.values[value.0 as usize].kind {
                OpKind::ConstFloat(number) => Some(number),
                _ => None,
            },
            _ => None,
        })
        .collect();
    assert!(!returned.is_empty(), "the function returns something");
    assert!(
        returned.iter().all(|number| (number - 99.0).abs() < f64::EPSILON),
        "every `return` is the `finally`'s: {returned:?}"
    );
}

/// Whether a function calls a runtime helper by that name.
fn calls(func: &Func, helper: &str) -> bool {
    func.values.iter().any(|op| {
        matches!(&op.kind, OpKind::Call { callee: Callee::External(name), .. }
                 if name == helper)
    })
}

#[test]
fn a_promise_executor_is_lowered_where_the_promise_is_built() {
    let Some(lowered) = lowered("promise-constructor") else {
        return;
    };
    // `new Promise(f)` calls `f` synchronously, so when `f` is written at the
    // call its body belongs at the construction site -- and then `resolve` is
    // not a value at all, it is the settle it stands for. No closure is
    // allocated, nothing is captured, and the whole of `later` is two calls.
    let later = func(&lowered, "later");
    assert!(calls(later, "nts_promise_new"));
    assert!(
        calls(later, "nts_promise_fulfill_number"),
        "`resolve(n)` is the fulfil, not a call to anything"
    );
    assert!(
        !later
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ClosureStatic | OpKind::ObjectNew { .. })),
        "nothing is captured, so there is no closure and no object at all"
    );
}

#[test]
fn an_async_throw_rejects_its_own_promise() {
    let Some(lowered) = lowered("promise-constructor") else {
        return;
    };
    // A `throw` in an `async` function rejects the promise it already owns and
    // hands it back, which is what its `return` does through `settle`. It used
    // to end the program: node rejects, and a caller awaiting it sees a
    // rejection rather than a dead process.
    let failing = func(&lowered, "failing");
    assert!(calls(failing, "nts_promise_reject"));
    assert!(
        !calls(failing, "nts_uncaught"),
        "an `async` function has somewhere to put a throw"
    );
}

#[test]
fn a_default_that_cannot_apply_is_not_emitted() {
    let Some(lowered) = lowered("destructuring") else {
        return;
    };
    // `{ a = 99 }` where `a` is required: the representation has no room for
    // `undefined`, so the default is unreachable. The language says the same --
    // a default is evaluated only when the value is missing -- so the branch,
    // the merge and the constant are all absent rather than dead.
    let cannot = func(&lowered, "aDefaultThatCannotApply");
    assert!(
        !cannot
            .values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ConstFloat(v) if (v - 99.0).abs() < f64::EPSILON)),
        "the default is not lowered at all"
    );
}

#[test]
fn a_labelled_break_names_the_loop_it_leaves() {
    let Some(lowered) = lowered("loops") else {
        return;
    };
    // Three loops, two labels, and a `break`/`continue` naming each. That this
    // function is in the program at all is the assertion: a label is matched by
    // text, and picking the wrong loop for a name produces a jump to the wrong
    // block rather than a refusal -- which is what the 174 differential cases
    // behind it check.
    let two = func(&lowered, "twoLabels");
    assert!(
        two.blocks.len() > 6,
        "three nested loops, each with a header, a body and an exit"
    );
}

#[test]
fn the_provided_error_classes_are_told_apart() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // All four hold a `message` and a `name` and nothing else, so the layout
    // merge -- which is *shape* everywhere else, and has to be, because that is
    // what makes two interfaces of one shape interchangeable -- put them in one
    // layout with one descriptor. `e instanceof TypeError` was then true of a
    // `RangeError`, and an uncaught `TypeError` printed `RangeError`.
    //
    // Nothing could see either until `instanceof` existed: a descriptor's name
    // is otherwise read only by a crash message.
    let names: Vec<&str> = lowered
        .program
        .layouts
        .iter()
        .map(|layout| layout.name.as_str())
        .filter(|name| ["Error", "TypeError", "RangeError", "URIError"].contains(name))
        .collect();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(
        names.len(),
        sorted.len(),
        "each provided error class the program builds has a layout of its own: {names:?}"
    );
    assert!(
        names.len() >= 3,
        "the example builds an `Error`, a `TypeError` and a `RangeError`: {names:?}"
    );
}

#[test]
fn instanceof_is_a_comparison_against_a_closed_set() {
    let Some(lowered) = lowered("exceptions") else {
        return;
    };
    // `e instanceof Error` names `Error` and everything extending it, which is
    // decided here and cannot grow: a compiled program gains no subclasses. So
    // there is no chain to walk, and the operation carries the whole answer.
    let is_error = func(&lowered, "aTypeErrorIsAnError");
    let classes = is_error
        .values
        .iter()
        .find_map(|op| match &op.kind {
            OpKind::InstanceOf { classes, .. } => Some(classes.len()),
            _ => None,
        })
        .expect("`e instanceof Error` lowers to the operation");
    assert!(
        classes >= 2,
        "`Error` admits the three classes that extend it as well as itself"
    );
}

#[test]
fn an_optional_call_evaluates_its_arguments_only_in_the_present_arm() {
    let Some(lowered) = lowered("optional-access") else {
        return;
    };
    // `f?.(g())` must not call `g` when `f` is absent. The branch is taken
    // first and the argument is lowered inside the arm, so the call to `bump`
    // is dominated by the test rather than sitting above it.
    let guarded = func(&lowered, "anAbsentCalleeEvaluatesNoArguments");
    let entry = &guarded.blocks[0];
    assert!(
        !entry.ops.iter().any(|op| matches!(
            &guarded.values[op.0 as usize].kind,
            OpKind::Call { callee: Callee::Direct(name), .. } if name == "bump"
        )),
        "`bump` is not called before the branch that decides whether to call at all"
    );
}

#[test]
fn a_dispatched_call_keeps_the_return_its_declaration_promises() {
    let Some(lowered) = lowered("optional-access") else {
        return;
    };
    // A closure's implementation is emitted from its declared function type,
    // which nothing narrows. So a call through the table has to keep that
    // return: narrowing it spelled `int32_t (*)(...)` for a body returning
    // `double`, and the answer came out of the wrong register.
    //
    // Raw lowering has no specialization in it, so what this pins is the other
    // half -- that the call takes its type from the *callee* and not from the
    // expression, which for `f?.(x)` carries an `undefined` the call cannot
    // produce.
    let optional = func(&lowered, "optionalCall");
    let call = optional
        .values
        .iter()
        .find(|op| matches!(op.kind, OpKind::Call { callee: Callee::Closure { .. }, .. }))
        .expect("`f?.(x)` calls through the closure table");
    assert_ne!(
        call.ty,
        HirType::Erased,
        "the call returns what the closure returns, not `number | undefined`"
    );
}

#[test]
fn a_nullish_assignment_to_a_never_absent_target_tests_nothing() {
    let Some(lowered) = lowered("logical-assignment") else {
        return;
    };
    // `x ??= 99` where `x` is a `number`. The type has no room for an absence,
    // so there is nothing to test -- and because there is nothing to test,
    // nothing is ever written. That is what the specification says happens
    // rather than an optimization of it, and getting it wrong is not subtle:
    // `nullishOnNeverAbsent(0)` is `0`, and a lowering that treated falsy as
    // absent would answer `99`.
    let f = func(&lowered, "nullishOnNeverAbsent");
    assert_eq!(f.blocks.len(), 1, "no test means no branch: {:?}", f.blocks);
    assert!(
        !f.values
            .iter()
            .any(|op| matches!(op.kind, OpKind::ConstFloat(v) if (v - 99.0).abs() < f64::EPSILON)),
        "the right operand is not evaluated, so it is not lowered either",
    );
}

#[test]
fn a_logical_assignment_leaves_its_right_operand_unevaluated_on_the_keeping_path() {
    let Some(lowered) = lowered("logical-assignment") else {
        return;
    };
    // `x ||= bump(n)` must not call `bump` when `x` is truthy. The call
    // therefore belongs inside the arm the test took, and an entry block
    // holding it would be a program that calls a function JavaScript does not.
    for name in [
        "rightOperandNotEvaluated",
        "nullishRightOperandNotEvaluated",
    ] {
        let f = func(&lowered, name);
        let calls = |block: &hir::Block| {
            block.ops.iter().any(|value| {
                matches!(
                    &f.values[value.0 as usize].kind,
                    OpKind::Call { callee: Callee::Direct(target), .. } if target.contains("bump"),
                )
            })
        };
        assert!(!calls(f.entry()), "`{name}` calls `bump` unconditionally");
        assert_eq!(
            f.blocks.iter().filter(|b| calls(b)).count(),
            1,
            "`{name}` should call `bump` from exactly one arm",
        );
    }
}

#[test]
fn nullish_assignment_asks_a_different_question_from_or_assignment() {
    let Some(lowered) = lowered("logical-assignment") else {
        return;
    };
    // The reason `??=` exists. `||=` overwrites a present `0` and `??=` does
    // not, so lowering one as the other is wrong on every falsy value the
    // argument pool supplies -- and the two are close enough in the source
    // that the mistake reads as a simplification.
    //
    // Asserted on the *shape of the test* rather than on an answer, because an
    // answer only differs on the falsy inputs and a lowering could pass the
    // arithmetic cases while asking the wrong question.
    let truthy = |f: &Func| {
        f.values.iter().any(|op| {
            matches!(
                op.kind,
                OpKind::Unary {
                    op: hir::UnOp::Truthy,
                    ..
                }
            )
        })
    };
    let tagged = |f: &Func| {
        f.values
            .iter()
            .any(|op| matches!(op.kind, OpKind::TagOf { .. }))
    };

    let nullish = func(&lowered, "nullishOnAbsent");
    assert!(tagged(nullish), "`??=` tests the tag for an absence");
    assert!(!truthy(nullish), "`??=` does not ask about truthiness");

    let or = func(&lowered, "orOnAbsent");
    assert!(truthy(or), "`||=` tests truthiness");
    assert!(!tagged(or), "`||=` has no reason to read the tag");
}

#[test]
fn a_conditional_write_in_a_loop_reaches_the_loop_header() {
    let Some(lowered) = lowered("logical-assignment") else {
        return;
    };
    // A logical assignment writes on one path, and "assigned anywhere in this
    // subtree" is still true of it. The collector that builds a loop header's
    // parameters has to agree, because missing a write there does not produce a
    // wrong answer -- it produces a header with no parameter for the name, a
    // body that reads the value it had on entry, and a back edge that never
    // passes the update.
    //
    // `orInALoop` enters carrying two values: the counter and the accumulator
    // the body writes conditionally. One argument here means the accumulator
    // was not collected.
    let f = func(&lowered, "orInALoop");
    let Terminator::Jump { args, .. } = &f.entry().terminator else {
        panic!("the entry should jump into the header, got {:?}", f.entry().terminator);
    };
    assert_eq!(
        args.len(),
        2,
        "the header carries the counter and the conditionally written accumulator",
    );
}

#[test]
fn an_assignment_that_reads_through_an_accessor_is_refused_in_those_words() {
    let Some(lowered) = lowered("unsupported") else {
        return;
    };
    // `g.level ||= n` reads the getter and writes the setter, and the place
    // built here knows only the setter.
    //
    // Pinned on the wording and not merely on the refusal, because the message
    // said "a compound assignment" while it was refusing `??=` as well -- a
    // refusal naming a construct the source does not contain, which sends
    // whoever reads it looking for a `+=` that is not there.
    assert!(
        lowered.diagnostics.iter().any(|d| d
            .message
            .contains("an assignment that reads through an accessor")),
        "no accessor refusal among {:?}",
        lowered
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>(),
    );
}

#[test]
fn a_symbol_keyed_method_is_emitted_and_reached_under_one_name() {
    let Some(lowered) = lowered("computed-members") else {
        return;
    };
    // Three places decide this name and all three have to agree letter for
    // letter: the declaration decides what the function is emitted as, the
    // hierarchy decides what a lookup finds, and the call site decides what is
    // looked up. Only the declaration had a rule for a symbol key.
    //
    // Asserted as emitted-*and*-called rather than as either alone, because
    // each half fails in a way the other half cannot see. With only the
    // declaration fixed, the method is emitted under `__@kStep@2` and every
    // call still asks for `kStep`, so it is dead code nothing reports. With the
    // call site fixed too, the call asks for `__@kStep@2` and the hierarchy has
    // never heard of it -- a refusal naming the emitted function's own name.
    let emitted: Vec<&str> = lowered
        .program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .filter(|name| name.contains("__@kStep@"))
        .collect();
    assert_eq!(emitted.len(), 1, "one symbol-keyed method, got {emitted:?}");
    let declared = emitted[0];

    let reached = lowered.program.funcs.iter().any(|func| {
        func.values.iter().any(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::Direct(target), .. } if target == declared,
            )
        })
    });
    assert!(reached, "`{declared}` is emitted and nothing calls it");
}

#[test]
fn a_user_iterable_is_stepped_once_per_iteration() {
    let Some(lowered) = lowered("iteration") else {
        return;
    };
    // The whole design of the protocol walk in one assertion. `next()` both
    // advances the iterator and produces the element, so calling it for the
    // test and again for the element would step twice and yield every other
    // item -- an answer that is wrong by a factor of two and looks like
    // arithmetic.
    //
    // One call, and both reads come out of its result.
    let func = func(&lowered, "userIterable");
    let steps: Vec<&hir::Op> = func
        .values
        .iter()
        .filter(|op| {
            matches!(
                &op.kind,
                OpKind::Call { callee: Callee::Direct(target), .. } if target.ends_with("#next"),
            )
        })
        .collect();
    assert_eq!(steps.len(), 1, "one `next()` per iteration, got {}", steps.len());

    // And the iterator itself is built once, outside the loop -- the entry
    // block runs exactly once per call.
    let built: usize = func
        .entry()
        .ops
        .iter()
        .filter(|value| {
            matches!(
                &func.values[value.0 as usize].kind,
                OpKind::Call { callee: Callee::Direct(target), .. } if target.contains("__@iterator@"),
            )
        })
        .count();
    assert_eq!(built, 1, "`[Symbol.iterator]()` is called once, before the loop");
}

#[test]
fn a_protocol_loop_carries_no_cursor() {
    let Some(lowered) = lowered("iteration") else {
        return;
    };
    // Every other walk advances an index the loop carries. This one's state is
    // inside the iterator, so a cursor would be a loop-carried value nothing
    // reads -- and the *reason* it must not exist is `continue`: the step lives
    // in the header, so the header has to be the latch, and a loop with a
    // cursor gets a latch of its own that would step the iterator nowhere.
    //
    // `userIterable` carries one value, the accumulator. A cursor would make
    // it two.
    let func = func(&lowered, "userIterable");
    let carried: usize = func
        .blocks
        .iter()
        .map(|block| block.params.len())
        .max()
        .unwrap_or(0);
    assert_eq!(
        carried, 1,
        "only the accumulator is carried; a cursor would make it two: {:?}",
        func.blocks.iter().map(|b| b.params.len()).collect::<Vec<_>>(),
    );
}
