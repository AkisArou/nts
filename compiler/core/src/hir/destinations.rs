//! A string a call builds only to be appended is built where it is appended.
//!
//! `object += member(key, quoted, "")` had `member` build
//! `quoteJSONString(key) + ":" + quoted` as a string of its own, hand it back,
//! and the caller copy it onto `object`: every character of every member written twice, and the
//! member's string allocated, filled and released only to be copied. That is
//! the inner loop of `benchmarks/cases/json-serialize`, and the same shape
//! nests four deep in `json-stringify-typed` (document, row, tags, meta).
//!
//! The answer is a second body for such a function, its **variant**, which
//! takes the caller's string as one more parameter and appends onto it what
//! the original would have returned: `member#into(key, quoted, gap, object)`.
//! Which calls are only appended and how each function builds what it returns
//! are core facts ([`super::appended_results`]); this pass acts on them.
//!
//! - Each return that reads an accumulation appends there instead: the
//!   accumulation's seed -- a literal, or a direct call's answer -- becomes
//!   the seed appended onto the caller's string (the seed call's own variant,
//!   where it has one), and every concatenation onto a member is unchanged.
//! - A return of a call's answer becomes a call of that callee's variant, or
//!   the answer appended where the callee has none; any other return is
//!   appended as it is.
//! - Each call whose answer is only appended -- `lhs + f(args)` -- becomes
//!   `f#into(args, lhs)`, at the call's own position, so nothing it evaluates
//!   moves past anything else.
//! - Each runtime helper's answer only appended -- `lhs + String(n)`,
//!   `lhs + s[i]`, `lhs + s.charAt(i)`, `lhs + String.fromCharCode(c)`,
//!   `lhs + s.slice(a, b)` -- becomes the helper that appends it without
//!   making it (`nts_str_append_number` and its siblings), where the call
//!   stands. In a variant too, so `numberText#into` writes the number into
//!   its caller's string.
//!
//! # Under counting only
//!
//! What pays is the reference the caller hands over and the in-place append
//! that follows: the variant takes its last parameter over, by the general
//! rule in [`super::own`] (a string read only as the left side of one
//! concatenation, or handed to a slot its callee takes over, once on every
//! path), so the caller moves its string in where it dies, and `rc` turns the
//! variant's first concatenation into `nts_str_append`, which writes in place
//! when the count says nobody else can see it. A caller that still reads its
//! string, a string a module binding or a closure also holds, a handler that
//! will read it if the callee throws: each keeps a reference, the count is
//! not one, and the append copies, as the concatenation did.
//!
//! A variant whose last parameter that rule does not take over would copy the
//! whole of the caller's string at its first append, every call -- quadratic
//! where the original was linear -- so a variant is kept only once
//! [`super::own::summarize`] says it takes the string over, and the calls into
//! it are rewritten only then.

use std::collections::{BTreeMap, BTreeSet};

use rustc_hash::{FxHashMap, FxHashSet};

use super::appended_results::{
    ReturnedString, appended_calls, appended_runtime_calls, returned_strings,
};
use super::{
    BinOp, Block, Callee, Func, HirType, ManagedType, Op, OpKind, Param, ParamShape, Program,
    Provider, Terminator, ValueId, reachable::Roots,
};

const STRING: HirType = HirType::Managed(ManagedType::String);

/// Give every function whose string answer some call only appends a variant
/// that appends it into the caller's string, and send those calls there,
/// under counting only (the module note says why). Answers how many calls it
/// rewrote.
pub(super) fn pass(program: &mut Program, provider: Provider, roots: Roots<'_>) -> usize {
    if provider != Provider::ReferenceCounting {
        return 0;
    }
    let answers: FxHashMap<String, BTreeMap<ValueId, ReturnedString>> = program
        .funcs
        .iter()
        .filter(|func| !func.abstract_declaration && !func.blocks.is_empty())
        .filter_map(|func| Some((func.name.clone(), returned_strings(func)?)))
        .collect();
    let mut wanted = wanted(program, &answers);
    let names = variant_names(program, &wanted);
    // A variant whose string the ownership rule does not take over is
    // dropped, which can leave another handing its string to one that no
    // longer exists; so build, ask, drop and build again until nothing drops.
    // Each round removes a function, so it ends.
    loop {
        let mut trial = program.clone();
        for name in &wanted {
            let Some(func) = trial.funcs.iter().find(|func| func.name == *name) else {
                continue;
            };
            let variant = variant(func, &answers[name], &wanted, &names);
            trial.funcs.push(variant);
        }
        // The runtime helpers' appends, in the variants as everywhere else: a
        // variant's first append may become one, and whether it takes its
        // string over is asked of what it will be.
        let fused: usize = trial.funcs.iter_mut().map(send_helper_appends).sum();
        if wanted.is_empty() {
            *program = trial;
            return fused;
        }
        // The calls first, then the question: whether a variant takes its
        // string over is asked of its callers as well (`own`), and these are
        // they.
        let sent: usize = trial
            .funcs
            .iter_mut()
            .map(|func| send_appends(func, &wanted, &names))
            .sum();
        let summaries = super::own::summarize(&trial, &trial.layouts);
        let refused: Vec<String> = wanted
            .iter()
            .filter(|name| {
                let variant = &names[*name];
                let last = trial
                    .funcs
                    .iter()
                    .find(|func| func.name == *variant)
                    .map_or(0, |func| func.params.len().saturating_sub(1));
                !summaries.consumes(variant).is_some_and(|slots| {
                    u32::try_from(last).is_ok_and(|last| slots.contains(&last))
                })
            })
            .cloned()
            .collect();
        if refused.is_empty() {
            let rewritten = fused + sent;
            // An original every caller now reaches through its variant is
            // called by nothing, and C refuses an uncalled static function
            // under `-Werror` (`unicodeEscape` in `json-serialize`).
            super::reachable::prune(&mut trial, roots);
            *program = trial;
            return rewritten;
        }
        for name in refused {
            wanted.remove(&name);
        }
    }
}

/// The functions worth a variant: those some only-appended call reaches, and
/// whose returns build into an accumulation, hand on to a function that does,
/// or answer a runtime helper that appends instead (`fused`) -- `return
/// nts_json_quote(value)`, which the variant's `into + ...` turns into the
/// helper's append -- through the variants that would call them in turn.
fn wanted(
    program: &Program,
    answers: &FxHashMap<String, BTreeMap<ValueId, ReturnedString>>,
) -> BTreeSet<String> {
    // Which would gain: an accumulation returned, or a call returned or
    // seeding one into a function that gains. A least fixpoint, so a cycle of
    // functions only handing on to each other gains nothing.
    let mut gains: BTreeSet<String> = BTreeSet::new();
    loop {
        let before = gains.len();
        for (name, returns) in answers {
            let func = program.funcs.iter().find(|func| func.name == *name);
            let gain = returns.values().any(|answer| match answer {
                ReturnedString::Accumulated(_) => true,
                ReturnedString::Call(call) => func
                    .and_then(|func| direct_callee(func, *call))
                    .is_some_and(|callee| gains.contains(callee)),
                ReturnedString::Value(value) => {
                    func.is_some_and(|func| appends_instead(func, *value))
                }
            });
            if gain {
                gains.insert(name.clone());
            }
        }
        if gains.len() == before {
            break;
        }
    }
    // Reached: from the calls only appended, then from what each variant calls.
    let mut reached: BTreeSet<String> = BTreeSet::new();
    let mut front: Vec<String> = program
        .funcs
        .iter()
        .flat_map(|func| {
            appended_calls(func)
                .into_iter()
                .filter_map(|call| direct_callee(func, call).map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect();
    while let Some(name) = front.pop() {
        if !gains.contains(&name) || !reached.insert(name.clone()) {
            continue;
        }
        let Some(func) = program.funcs.iter().find(|func| func.name == name) else {
            continue;
        };
        for answer in answers[&name].values() {
            let calls: Vec<ValueId> = match answer {
                ReturnedString::Accumulated(members) => members.iter().copied().collect(),
                ReturnedString::Call(call) => vec![*call],
                ReturnedString::Value(_) => Vec::new(),
            };
            front.extend(
                calls
                    .into_iter()
                    .filter_map(|call| direct_callee(func, call).map(str::to_owned)),
            );
        }
    }
    reached
}

/// Whether `value` is a runtime helper's answer that a helper could append
/// instead (`fused`).
fn appends_instead(func: &Func, value: ValueId) -> bool {
    matches!(
        &func.values[value.0 as usize].kind,
        OpKind::Call { callee: Callee::External(helper), .. } if fused(helper).is_some()
    )
}

/// The callee of a direct call, if `value` is one.
fn direct_callee(func: &Func, value: ValueId) -> Option<&str> {
    match &func.values[value.0 as usize].kind {
        OpKind::Call {
            callee: Callee::Direct(name),
            ..
        } => Some(name),
        _ => None,
    }
}

/// A name for each variant that no function in the program has: `f#into`,
/// numbered past any it would collide with. `#` cannot appear in an
/// identifier, so only a method named `into` on a class `f` could take it,
/// and the numbering is for exactly that.
fn variant_names(program: &Program, wanted: &BTreeSet<String>) -> BTreeMap<String, String> {
    let mut taken: FxHashSet<String> = program.funcs.iter().map(|func| func.name.clone()).collect();
    wanted
        .iter()
        .map(|name| {
            let variant = super::unclaimed_name(&taken, format!("{name}#into"));
            taken.insert(variant.clone());
            (name.clone(), variant)
        })
        .collect()
}

/// `func`'s variant: one more parameter, the caller's string, onto which it
/// appends what `func` would have returned, and returns it.
fn variant(
    func: &Func,
    answers: &BTreeMap<ValueId, ReturnedString>,
    wanted: &BTreeSet<String>,
    names: &BTreeMap<String, String>,
) -> Func {
    let mut variant = func.clone();
    variant.name.clone_from(&names[&func.name]);
    // Internal by construction: only the calls rewritten below reach it.
    variant.exported = false;
    let slot = u32::try_from(variant.params.len()).unwrap_or(u32::MAX);
    variant.params.push(Param {
        name: "into".to_owned(),
        ty: STRING,
        origin: func.origin.clone(),
        shape: ParamShape::Ordinary,
        known: super::facts::Facts::TOP,
        written: None,
    });
    let into = push(&mut variant, OpKind::Param(slot), &func.origin);
    if let Some(entry) = variant.blocks.first_mut() {
        entry.ops.insert(0, into);
    }
    let mut seeded: FxHashSet<ValueId> = FxHashSet::default();
    for (&returned, answer) in answers {
        match answer {
            ReturnedString::Accumulated(members) => {
                let live: BTreeSet<ValueId> = live_ops(&variant);
                for &member in members.iter().filter(|member| live.contains(member)) {
                    if !seeded.insert(member) {
                        continue;
                    }
                    match variant.values[member.0 as usize].kind.clone() {
                        OpKind::ConstString(_)
                        | OpKind::Call {
                            callee: Callee::External(_),
                            ..
                        } => append_after(&mut variant, member, into),
                        OpKind::Call {
                            callee: Callee::Direct(callee),
                            args,
                            frame,
                        } => {
                            if wanted.contains(&callee) {
                                let mut args = args;
                                args.push(into);
                                variant.values[member.0 as usize].kind = OpKind::Call {
                                    callee: Callee::Direct(names[&callee].clone()),
                                    args,
                                    frame,
                                };
                            } else {
                                append_after(&mut variant, member, into);
                            }
                        }
                        _ => {}
                    }
                }
            }
            ReturnedString::Call(call) => {
                let OpKind::Call {
                    callee: Callee::Direct(callee),
                    args,
                    frame,
                } = variant.values[call.0 as usize].kind.clone()
                else {
                    continue;
                };
                if wanted.contains(&callee) {
                    let mut args = args;
                    args.push(into);
                    variant.values[call.0 as usize].kind = OpKind::Call {
                        callee: Callee::Direct(names[&callee].clone()),
                        args,
                        frame,
                    };
                } else {
                    append_at_returns(&mut variant, returned, into);
                }
            }
            ReturnedString::Value(_) => append_at_returns(&mut variant, returned, into),
        }
    }
    variant
}

/// Every value some block evaluates.
fn live_ops(func: &Func) -> BTreeSet<ValueId> {
    func.blocks
        .iter()
        .flat_map(|block| block.ops.iter().copied())
        .collect()
}

/// A new value in `func`, not yet in any block.
fn push(func: &mut Func, kind: OpKind, origin: &nts_semantic_schema::Origin) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    let ty = match kind {
        OpKind::Param(_) | OpKind::Binary { .. } => STRING,
        _ => HirType::Void,
    };
    func.values.push(Op {
        kind,
        ty,
        origin: origin.clone(),
    });
    id
}

/// `into + seed` right after `seed`, standing for it everywhere it was read.
fn append_after(func: &mut Func, seed: ValueId, into: ValueId) {
    let origin = func.values[seed.0 as usize].origin.clone();
    let appended = push(
        func,
        OpKind::Binary {
            op: BinOp::Concat,
            lhs: into,
            rhs: seed,
        },
        &origin,
    );
    let rename = |value: ValueId| if value == seed { appended } else { value };
    for block in &mut func.blocks {
        for &op in &block.ops {
            super::simplify::substitute(&mut func.values[op.0 as usize].kind, rename);
        }
        super::simplify::substitute_terminator(&mut block.terminator, rename);
    }
    // The substitution renamed the new value's own operand too.
    func.values[appended.0 as usize].kind = OpKind::Binary {
        op: BinOp::Concat,
        lhs: into,
        rhs: seed,
    };
    for block in &mut func.blocks {
        if let Some(at) = block.ops.iter().position(|op| *op == seed) {
            block.ops.insert(at + 1, appended);
            break;
        }
    }
}

/// `into + returned` before each return of `returned`, returned instead.
fn append_at_returns(func: &mut Func, returned: ValueId, into: ValueId) {
    let origin = func.values[returned.0 as usize].origin.clone();
    for at in 0..func.blocks.len() {
        if func.blocks[at].terminator != Terminator::Return(Some(returned)) {
            continue;
        }
        let appended = push(
            func,
            OpKind::Binary {
                op: BinOp::Concat,
                lhs: into,
                rhs: returned,
            },
            &origin,
        );
        let block: &mut Block = &mut func.blocks[at];
        block.ops.push(appended);
        block.terminator = Terminator::Return(Some(appended));
    }
}

/// Send each call in `func` whose answer is only appended, to a function with
/// a variant, to that variant with the left side as its string: the call
/// becomes `f#into(args, lhs)` where it stands, and the concatenation goes.
fn send_appends(
    func: &mut Func,
    wanted: &BTreeSet<String>,
    names: &BTreeMap<String, String>,
) -> usize {
    let mut rewritten = 0;
    for call in appended_calls(func) {
        let Some(callee) = direct_callee(func, call).map(str::to_owned) else {
            continue;
        };
        if !wanted.contains(&callee) {
            continue;
        }
        let Some((block, appended, lhs)) = appending(func, call) else {
            continue;
        };
        if !defined_before(func, lhs, call) || !gives_itself_away(func, block, call, appended, lhs)
        {
            continue;
        }
        let OpKind::Call { args, frame, .. } = func.values[call.0 as usize].kind.clone() else {
            continue;
        };
        let mut args = args;
        args.push(lhs);
        func.values[call.0 as usize].kind = OpKind::Call {
            callee: Callee::Direct(names[&callee].clone()),
            args,
            frame,
        };
        let rename = |value: ValueId| if value == appended { call } else { value };
        for block in &mut func.blocks {
            for &op in &block.ops {
                super::simplify::substitute(&mut func.values[op.0 as usize].kind, rename);
            }
            super::simplify::substitute_terminator(&mut block.terminator, rename);
        }
        func.blocks[block].ops.retain(|op| *op != appended);
        rewritten += 1;
    }
    rewritten
}

/// The runtime helper that appends what `helper` would have answered,
/// without making it: `out + String(n)` is `nts_str_append_number(out, n)`,
/// and `out + quoteJSONString(s)`, where text.ts calls the escape kernel,
/// `nts_str_append_json_quoted(out, s)`. Each takes `out` over
/// (`own::consumes`) and keeps its method's rules.
fn fused(helper: &str) -> Option<&'static str> {
    Some(match helper {
        "nts_number_to_string" => "nts_str_append_number",
        "nts_str_at" => "nts_str_append_at",
        "nts_str_char_at" => "nts_str_append_char_at",
        "nts_string_from_char_code" => "nts_str_append_char_code",
        "nts_str_slice" => "nts_str_append_slice",
        "nts_json_quote" => "nts_str_append_json_quoted",
        _ => return None,
    })
}

/// Send each runtime-helper call in `func` whose answer is only appended to
/// the helper that appends it: `lhs + nts_number_to_string(n)` becomes
/// `nts_str_append_number(lhs, n)` where the call stands, and the
/// concatenation goes.
fn send_helper_appends(func: &mut Func) -> usize {
    let mut rewritten = 0;
    for call in appended_runtime_calls(func) {
        let OpKind::Call {
            callee: Callee::External(helper),
            args,
            ..
        } = func.values[call.0 as usize].kind.clone()
        else {
            continue;
        };
        let Some(writer) = fused(&helper) else {
            continue;
        };
        let Some((block, appended, lhs)) = appending(func, call) else {
            continue;
        };
        if !defined_before(func, lhs, call) {
            continue;
        }
        let mut arguments = vec![lhs];
        arguments.extend(args);
        func.values[call.0 as usize].kind = OpKind::Call {
            callee: Callee::External(writer.to_owned()),
            args: arguments,
            frame: None,
        };
        let rename = |value: ValueId| if value == appended { call } else { value };
        for block in &mut func.blocks {
            for &op in &block.ops {
                super::simplify::substitute(&mut func.values[op.0 as usize].kind, rename);
            }
            super::simplify::substitute_terminator(&mut block.terminator, rename);
        }
        func.blocks[block].ops.retain(|op| *op != appended);
        rewritten += 1;
    }
    rewritten
}

/// Whether the left side of the concatenation `appended`, onto which `call`'s
/// answer is appended, is a string its function gives away there: one it made
/// (or a literal), read by nothing between the call and the concatenation and
/// by nothing after. Sent to a variant, it is handed over at the call; a left
/// side that survives would have the variant borrow its string and copy all of
/// it at the first append, so such a call keeps calling the original. A
/// parameter is left out, since which ones are taken over is not known here.
fn gives_itself_away(
    func: &Func,
    block: usize,
    call: ValueId,
    appended: ValueId,
    lhs: ValueId,
) -> bool {
    let ops = &func.blocks[block].ops;
    let position = |wanted: ValueId| ops.iter().position(|op| *op == wanted);
    let (Some(at_call), Some(at_concat)) = (position(call), position(appended)) else {
        return false;
    };
    if at_call > at_concat
        || ops[at_call + 1..at_concat]
            .iter()
            .any(|op| super::operands_of(&func.values[op.0 as usize].kind).contains(&lhs))
    {
        return false;
    }
    let live = super::liveness::analyze(func);
    super::own::dies_at(func, &live, block, at_concat, lhs)
        && super::own::fresh(func, lhs, &FxHashMap::default(), &mut FxHashSet::default())
}

/// The concatenation that appends `call`'s answer: its block, itself, and
/// its left side.
fn appending(func: &Func, call: ValueId) -> Option<(usize, ValueId, ValueId)> {
    func.blocks.iter().enumerate().find_map(|(at, block)| {
        block
            .ops
            .iter()
            .find_map(|&op| match func.values[op.0 as usize].kind {
                OpKind::Binary {
                    op: BinOp::Concat,
                    lhs,
                    rhs,
                } if rhs == call => Some((at, op, lhs)),
                _ => None,
            })
    })
}

/// Whether `value` is available where `at` is evaluated: a parameter, or
/// defined earlier in `at`'s block or in a block that dominates it.
fn defined_before(func: &Func, value: ValueId, at: ValueId) -> bool {
    let block_of = |wanted: ValueId| {
        func.blocks
            .iter()
            .position(|block| block.ops.contains(&wanted) || block.params.contains(&wanted))
    };
    let (Some(defined), Some(used)) = (block_of(value), block_of(at)) else {
        return false;
    };
    if defined == used {
        let ops = &func.blocks[used].ops;
        if func.blocks[used].params.contains(&value) {
            return true;
        }
        let position = |wanted: ValueId| ops.iter().position(|op| *op == wanted);
        return position(value) < position(at);
    }
    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    let mut walk = idom[used];
    while let Some(block) = walk {
        if block.0 as usize == defined {
            return true;
        }
        walk = idom[block.0 as usize];
    }
    false
}
