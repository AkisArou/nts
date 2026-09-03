//! Splitting a union-typed block parameter into its tag and its payload.
//!
//! # The measurement this exists for
//!
//! `benches/cases/absences` is the absence primitive's speed ratchet, and it
//! was the last row on the board losing to node — 4.45x C++ and 1.06x node.
//! 0053 measured the cause and named the fix without building it; this is the
//! fix.
//!
//! The shape is one line of TypeScript:
//!
//! ```ts
//! const held: number | undefined = i % 5 === 0 ? undefined : i;
//! total = (total + (held ?? -1)) | 0;
//! ```
//!
//! and it lowered, in the *specialized* function where `i` is already an `i32`,
//! to a round trip through a double:
//!
//! ```text
//! %131 = convert %11 : f64        cvtsi2sd  -- only because an erased
//! %45  = erase %131 : erased                --  value's payload *is* a double
//! %54  = unerase %44 : f64
//! %121 = convert %36 : f64        cvtsi2sd
//! %56  = add %121, %55 : f64
//! %58  = toint32 %56 : i32        cvttsd2si
//! ```
//!
//! Four conversions and a floating-point add per iteration, where the C++ a
//! person writes for the same union does an integer select and an integer add.
//! Writing the split by hand in TypeScript and measuring it is what justified
//! the pass before it existed: 793.4ns to 188.5ns on the C backend, against
//! C++'s 187.2 — parity — and 1.06x node to 0.53x.
//!
//! # What it does
//!
//! A block parameter of erased type, every argument to which carries a
//! statically known tag, and every use of which asks only for the tag or for
//! the payload, becomes *two* parameters: the tag, and the payload at its own
//! representation. The erasures before the jumps go, the tag reads become the
//! tag parameter, and the unerasures become the payload parameter.
//!
//! Nothing here narrows anything. The pass runs before specialization and
//! leaves ordinary dataflow where a tagged value used to be; the specializer
//! then narrows the payload the same way it narrows everything else, which is
//! why `%11` reaches the add as an `i32` rather than as a double.
//!
//! # Webs, not parameters
//!
//! `T | null | undefined` does not lower to one parameter. It lowers to two,
//! chained — one merges `undefined` with the value, the next merges `null` with
//! that:
//!
//! ```text
//! b24(%71: erased):  jump b25(%71)
//! b25(%73: erased):  %74 = tag.of %73
//! ```
//!
//! Splitting either alone is impossible: `%71`'s only use is being passed to
//! `%73`, which is not a tag read, and `%73`'s only source is `%71`, which is
//! not an erasure. So the unit is the *web* — every erased parameter reachable
//! from another through a jump argument — and the conditions are asked of the
//! web's outside edges. Two thirds of this benchmark's absences are that shape,
//! so a version that handled single parameters would have measured almost
//! nothing.
//!
//! # What it refuses
//!
//! **A payload that is not a scalar.** An erased *reference* already carries
//! its payload as the pointer, so there is nothing to win, and splitting one
//! would put a reference into a block parameter — which is the reference
//! counter's business and not this pass's. The measured win is entirely the
//! scalar case.
//!
//! **Any use that is not a tag read or an unerase.** A member passed to a call,
//! returned, stored, or erased again is a use that wants the general
//! representation, and one of those sinks the whole web.
//!
//! **An unerase at a type the payload does not have.** The pass could insert a
//! conversion and stay correct, but a conversion is what it exists to remove.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{Func, HirType, Op, OpKind, Terminator, ValueId, tags};

/// Split every erased block parameter this function can. Reports how many.
pub fn split_unions(func: &mut Func) -> usize {
    let members = erased_params(func);
    if members.is_empty() {
        return 0;
    }

    let mut split = 0;
    for web in webs(func, &members) {
        if let Some(payload) = splittable(func, &web) {
            rewrite(func, &web, &payload);
            split += web.len();
        }
    }
    split
}

/// What a tag is, as a type: the `u32` the runtime's `NtsTag` is, which is what
/// [`OpKind::TagOf`] already produces.
const fn tag_type() -> HirType {
    HirType::Int {
        bits: 32,
        signed: false,
    }
}

/// Every block parameter of erased type, and where it sits.
fn erased_params(func: &Func) -> FxHashMap<ValueId, (usize, usize)> {
    let mut found = FxHashMap::default();
    for (block, at) in func.blocks.iter().enumerate() {
        for (index, param) in at.params.iter().enumerate() {
            if func.values[param.0 as usize].ty == HirType::Erased {
                found.insert(*param, (block, index));
            }
        }
    }
    found
}

/// Group erased parameters that hand values to one another.
///
/// A parameter reached only through another parameter has no erasure to read
/// and no tag to test, so neither can be judged alone. See the module comment.
fn webs(func: &Func, members: &FxHashMap<ValueId, (usize, usize)>) -> Vec<Vec<ValueId>> {
    let mut parent: FxHashMap<ValueId, ValueId> = members.keys().map(|id| (*id, *id)).collect();
    for block in &func.blocks {
        for (target, args) in edges(&block.terminator) {
            for (index, arg) in args.iter().enumerate() {
                let Some(param) = func.blocks[target].params.get(index) else {
                    continue;
                };
                if !members.contains_key(param) || !members.contains_key(arg) {
                    continue;
                }
                let (a, b) = (root(&mut parent, *param), root(&mut parent, *arg));
                if a != b {
                    parent.insert(a, b);
                }
            }
        }
    }

    let mut grouped: FxHashMap<ValueId, Vec<ValueId>> = FxHashMap::default();
    let mut keys: Vec<ValueId> = members.keys().copied().collect();
    keys.sort_unstable_by_key(|id| id.0);
    for id in keys {
        let at = root(&mut parent, id);
        grouped.entry(at).or_default().push(id);
    }
    let mut out: Vec<Vec<ValueId>> = grouped.into_values().collect();
    out.sort_unstable_by_key(|web| web[0].0);
    out
}

/// The representative of a value's group, with the path to it compressed so a
/// long chain costs one walk rather than one per question.
fn root(parent: &mut FxHashMap<ValueId, ValueId>, of: ValueId) -> ValueId {
    let mut at = of;
    while parent[&at] != at {
        at = parent[&at];
    }
    let mut walk = of;
    while parent[&walk] != at {
        let next = parent[&walk];
        parent.insert(walk, at);
        walk = next;
    }
    at
}

/// Where a terminator can go, and what it carries.
fn edges(terminator: &Terminator) -> Vec<(usize, &Vec<ValueId>)> {
    match terminator {
        Terminator::Jump { target, args } => vec![(target.0 as usize, args)],
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (then_target.0 as usize, then_args),
            (else_target.0 as usize, else_args),
        ],
        _ => Vec::new(),
    }
}

/// The representation a web's payload would have, when it can have one.
///
/// `None` is a refusal, and every one of them is a use or a source that wants
/// the general representation. See the module comment for what each means.
fn splittable(func: &Func, web: &[ValueId]) -> Option<HirType> {
    let members: FxHashSet<ValueId> = web.iter().copied().collect();
    let mut payload: Option<HirType> = None;

    // Sources: everything an edge hands to a member from outside the web.
    for block in &func.blocks {
        for (target, args) in edges(&block.terminator) {
            for (index, arg) in args.iter().enumerate() {
                let Some(param) = func.blocks[target].params.get(index) else {
                    continue;
                };
                if !members.contains(param) || members.contains(arg) {
                    continue;
                }
                match &func.values[arg.0 as usize].kind {
                    OpKind::ConstUndefined | OpKind::ConstNull => {}
                    OpKind::Erase { value } => {
                        let ty = func.values[value.0 as usize].ty.clone();
                        // A reference already carries its payload as the
                        // pointer, and moving one into a block parameter is the
                        // reference counter's question rather than this pass's.
                        if !ty.is_scalar() {
                            return None;
                        }
                        if payload.get_or_insert_with(|| ty.clone()) != &ty {
                            return None;
                        }
                    }
                    // Anything else arrives already erased from somewhere this
                    // pass cannot see the tag of.
                    _ => return None,
                }
            }
        }
    }

    // Uses: every read of a member, other than being handed to another member.
    for (index, op) in func.values.iter().enumerate() {
        let reads = super::operands_of(&op.kind);
        if !reads.iter().any(|value| members.contains(value)) {
            continue;
        }
        match &op.kind {
            OpKind::TagOf { .. } => {}
            OpKind::Unerase { value } if members.contains(value) => {
                let want = &func.values[index].ty;
                // A conversion here would be correct and would give back what
                // the pass exists to remove.
                if payload.as_ref().is_some_and(|it| it != want) {
                    return None;
                }
                payload.get_or_insert_with(|| want.clone());
            }
            _ => return None,
        }
    }

    // And the terminators, which are uses too. A member returned is a member
    // handed to a caller that expects the general representation -- and a
    // member as a branch condition would be a truthiness test on a tag.
    //
    // Missing this was a real hole rather than a hypothetical one: the pass
    // split a web whose parameter was returned, because `operands_of` covers
    // operations and the terminator is not one.
    for block in &func.blocks {
        match &block.terminator {
            Terminator::Return(Some(value)) if members.contains(value) => return None,
            Terminator::Branch { cond, .. } if members.contains(cond) => return None,
            _ => {}
        }
        for (target, args) in edges(&block.terminator) {
            for (index, arg) in args.iter().enumerate() {
                if !members.contains(arg) {
                    continue;
                }
                // A member can only be handed to another member: the parameter
                // it feeds has its type, so it is erased, so it is one too.
                // Anything else is a shape this pass has not seen.
                match func.blocks[target].params.get(index) {
                    Some(param) if members.contains(param) => {}
                    _ => return None,
                }
            }
        }
    }

    // A web every source of which is an absence carries no payload at all. It
    // still splits -- the tag is the whole value -- and the payload parameter
    // that falls out is dead, which `dce` collects.
    Some(payload.unwrap_or(HirType::Float { bits: 64 }))
}

/// Give every member a tag parameter and a payload parameter, and move every
/// edge and every use onto them.
fn rewrite(func: &mut Func, web: &[ValueId], payload_ty: &HirType) {
    let members: FxHashSet<ValueId> = web.iter().copied().collect();

    // The tag reuses the member's slot, so nothing has to renumber; the payload
    // is appended, so every predecessor appends one argument.
    //
    // In parameter order, and that is load-bearing rather than tidy.
    // `fill_edges` walks a jump's arguments by index and pushes each payload as
    // it reaches the parameter it belongs to, so payloads arrive in ascending
    // parameter order. Appending them here in any other order -- web order is
    // by `ValueId`, which need not agree -- would pair every argument after the
    // first with the wrong parameter, in the one case where a block takes two
    // union-typed values at once.
    let mut ordered: Vec<(usize, usize, ValueId)> = web
        .iter()
        .map(|member| {
            let (block, index) = func
                .blocks
                .iter()
                .enumerate()
                .find_map(|(at, it)| it.params.iter().position(|p| p == member).map(|i| (at, i)))
                .expect("a web member is a block parameter");
            (block, index, *member)
        })
        .collect();
    ordered.sort_unstable();

    let mut payloads: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for (block, _, member) in ordered {
        func.values[member.0 as usize].ty = tag_type();
        let index = func.blocks[block].params.len();
        let origin = func.values[member.0 as usize].origin.clone();
        let id = push_value(
            func,
            Op {
                kind: OpKind::BlockParam(u32::try_from(index).unwrap_or(0)),
                ty: payload_ty.clone(),
                origin,
            },
        );
        func.blocks[block].params.push(id);
        payloads.insert(member, id);
    }

    fill_edges(func, &members, &payloads, payload_ty);

    // The reads. A tag read *is* the tag parameter and an unerase *is* the
    // payload parameter, so both become substitutions rather than operations.
    let mut replacements: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));
        match func.values[index].kind {
            OpKind::TagOf { value } if members.contains(&value) => {
                replacements.insert(id, value);
            }
            OpKind::Unerase { value } if members.contains(&value) => {
                replacements.insert(id, payloads[&value]);
            }
            _ => {}
        }
    }
    if replacements.is_empty() {
        return;
    }
    let of = |value: ValueId| replacements.get(&value).copied().unwrap_or(value);
    for index in 0..func.values.len() {
        let mut kind = func.values[index].kind.clone();
        super::simplify::substitute(&mut kind, of);
        func.values[index].kind = kind;
    }
    for block in &mut func.blocks {
        super::simplify::substitute_terminator(&mut block.terminator, of);
    }

    // And the operations themselves go, rather than being left for `dce`.
    //
    // `unerase` leaves its replaced reads in place on the grounds that a pass
    // should not also be a peephole, and it can: the value underneath keeps a
    // type its operation still accepts. Here the member's own type changed from
    // erased to a tag, so a `tag.of` left standing on it is ill-typed the moment
    // this returns, and `verify` runs before anything cleans up.
    for block in &mut func.blocks {
        block.ops.retain(|id| !replacements.contains_key(id));
    }
}

/// Move every edge into the web onto the two parameters that replaced its one.
fn fill_edges(
    func: &mut Func,
    members: &FxHashSet<ValueId>,
    payloads: &FxHashMap<ValueId, ValueId>,
    payload_ty: &HirType,
) {
    // Collected first because filling one needs new constants, which is a
    // mutation of the same arena the scan is reading.
    let mut work: Vec<(usize, usize, usize, ValueId)> = Vec::new();
    for (from, block) in func.blocks.iter().enumerate() {
        for (which, (target, args)) in edges(&block.terminator).into_iter().enumerate() {
            for (index, arg) in args.iter().enumerate() {
                let Some(param) = func.blocks[target].params.get(index) else {
                    continue;
                };
                if members.contains(param) {
                    work.push((from, which, index, *arg));
                }
            }
        }
    }

    for (from, which, index, arg) in work {
        let (tag, carried) = match func.values[arg.0 as usize].kind.clone() {
            OpKind::ConstUndefined => (tags::UNDEFINED, None),
            OpKind::ConstNull => (tags::NULL, None),
            OpKind::Erase { value } => (
                tags::of_representation(&func.values[value.0 as usize].ty),
                Some(value),
            ),
            // A member, already split above.
            _ => {
                let tag = arg;
                let payload = payloads[&arg];
                set_arg(func, from, which, index, tag, payload);
                continue;
            }
        };

        let origin = func.values[arg.0 as usize].origin.clone();
        let tag_id = push_into(
            func,
            from,
            Op {
                kind: OpKind::ConstInt(i128::from(tag)),
                ty: tag_type(),
                origin: origin.clone(),
            },
        );
        // An absent edge carries no payload, and the parameter still needs an
        // argument. Zero rather than anything cleverer: it is never read, and a
        // constant is what every backend already knows how to pass.
        let payload_id = match carried {
            Some(value) => value,
            None => push_into(
                func,
                from,
                Op {
                    kind: zero(payload_ty),
                    ty: payload_ty.clone(),
                    origin,
                },
            ),
        };
        set_arg(func, from, which, index, tag_id, payload_id);
    }
}

/// The zero of a representation, for an edge that carries no payload.
fn zero(ty: &HirType) -> OpKind {
    match ty {
        HirType::Bool => OpKind::ConstBool(false),
        HirType::Int { .. } => OpKind::ConstInt(0),
        _ => OpKind::ConstFloat(0.0),
    }
}

/// Replace one argument and append the payload beside it.
fn set_arg(
    func: &mut Func,
    from: usize,
    which: usize,
    index: usize,
    tag: ValueId,
    payload: ValueId,
) {
    let args = match (&mut func.blocks[from].terminator, which) {
        (Terminator::Jump { args, .. }, _) | (Terminator::Branch { then_args: args, .. }, 0) => {
            args
        }
        (Terminator::Branch { else_args: args, .. }, _) => args,
        _ => return,
    };
    args[index] = tag;
    args.push(payload);
}

/// A new value, defined nowhere. For a block parameter, whose definition is the
/// block's parameter list rather than a position in its operations.
fn push_value(func: &mut Func, op: Op) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap_or(0));
    func.values.push(op);
    id
}

/// A new value, at the end of a block's operations and so before its
/// terminator, which is where an argument to a jump has to be computed.
fn push_into(func: &mut Func, block: usize, op: Op) -> ValueId {
    let id = push_value(func, op);
    func.blocks[block].ops.push(id);
    id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, BlockId, ManagedType, Param, TypeId};
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

    fn func(values: Vec<Op>, blocks: Vec<Block>) -> Func {
        Func {
            name: "held".to_owned(),
            params: vec![Param {
                name: "p0".to_owned(),
                ty: HirType::NUMBER,
                origin: origin(),
                known: crate::hir::facts::Facts::TOP,
            }],
            return_type: HirType::Void,
            values,
            blocks,
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
        }
    }

    fn block(params: Vec<ValueId>, ops: Vec<ValueId>, terminator: Terminator) -> Block {
        Block {
            params,
            ops,
            terminator,
        }
    }

    fn jump(target: u32, args: Vec<ValueId>) -> Terminator {
        Terminator::Jump {
            target: BlockId(target),
            args,
        }
    }

    /// `const held: number | undefined = c ? undefined : n; held ?? -1`
    ///
    /// The shape the whole pass exists for. One parameter, two edges, a tag read
    /// and an unerase.
    fn merged(use_of_member: Vec<Op>, tail: Terminator) -> Func {
        let mut values = vec![
            op(OpKind::Param(0), HirType::NUMBER),
            op(OpKind::ConstBool(true), HirType::Bool),
            op(OpKind::ConstUndefined, HirType::Erased),
            op(OpKind::Erase { value: ValueId(0) }, HirType::Erased),
            op(OpKind::BlockParam(0), HirType::Erased),
        ];
        values.extend(use_of_member);
        let used: Vec<ValueId> = (5..values.len())
            .map(|at| ValueId(u32::try_from(at).unwrap_or(0)))
            .collect();
        func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1)],
                    Terminator::Branch {
                        cond: ValueId(1),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                ),
                block(Vec::new(), vec![ValueId(2)], jump(3, vec![ValueId(2)])),
                block(Vec::new(), vec![ValueId(3)], jump(3, vec![ValueId(3)])),
                block(vec![ValueId(4)], used, tail),
            ],
        )
    }

    /// The tag becomes a parameter of its own and the payload arrives beside it,
    /// unerased and unconverted.
    #[test]
    fn a_union_of_a_scalar_and_an_absence_becomes_a_tag_and_a_payload() {
        let mut it = merged(
            vec![
                op(OpKind::TagOf { value: ValueId(4) }, tag_type()),
                op(OpKind::Unerase { value: ValueId(4) }, HirType::NUMBER),
            ],
            Terminator::Return(None),
        );
        assert_eq!(split_unions(&mut it), 1);

        // Two parameters where there was one: the tag in the old slot, the
        // payload appended.
        assert_eq!(it.blocks[3].params.len(), 2);
        assert_eq!(it.values[4].ty, tag_type());
        let payload = it.blocks[3].params[1];
        assert_eq!(it.values[payload.0 as usize].ty, HirType::NUMBER);

        // The absent edge carries the tag of `undefined` and a payload nothing
        // reads; the present edge carries the number's tag and the value
        // itself, with no erasure between.
        let Terminator::Jump { args, .. } = &it.blocks[1].terminator else {
            panic!("b1 jumps");
        };
        assert_eq!(it.values[args[0].0 as usize].kind, OpKind::ConstInt(0));
        let Terminator::Jump { args, .. } = &it.blocks[2].terminator else {
            panic!("b2 jumps");
        };
        assert_eq!(
            it.values[args[0].0 as usize].kind,
            OpKind::ConstInt(i128::from(tags::NUMBER))
        );
        assert_eq!(args[1], ValueId(0));

        // And the reads are gone rather than left for `dce`: a `tag.of` on a
        // parameter that is now a tag would not verify.
        assert!(
            !it.blocks[3]
                .ops
                .iter()
                .any(|id| matches!(
                    it.values[id.0 as usize].kind,
                    OpKind::TagOf { .. } | OpKind::Unerase { .. }
                ))
        );
    }

    /// A member handed anywhere but a tag read or an unerase wants the general
    /// representation, and one of those sinks the whole web.
    #[test]
    fn a_member_that_is_returned_is_left_alone() {
        let mut it = merged(Vec::new(), Terminator::Return(Some(ValueId(4))));
        assert_eq!(split_unions(&mut it), 0);
        assert_eq!(it.blocks[3].params.len(), 1);
        assert_eq!(it.values[4].ty, HirType::Erased);
    }

    /// An erased *reference* already carries its payload as the pointer, so
    /// there is nothing to win and a reference would land in a block parameter,
    /// which is the reference counter's question rather than this one.
    #[test]
    fn a_reference_payload_is_left_alone() {
        let mut it = merged(
            vec![op(OpKind::TagOf { value: ValueId(4) }, tag_type())],
            Terminator::Return(None),
        );
        it.values[0].ty = HirType::Managed(ManagedType::Object(TypeId(1)));
        assert_eq!(split_unions(&mut it), 0);
        assert_eq!(it.values[4].ty, HirType::Erased);
    }

    /// Two unions merging at one block, whose parameter order and `ValueId`
    /// order disagree.
    ///
    /// Every payload is *appended* to the parameter list and every payload
    /// argument is *pushed* as a jump's list is walked by index, so a block
    /// carrying two of them has two chances to pair an argument with the wrong
    /// parameter. Here they are separate webs, and each `rewrite` keeps its own
    /// append and its own push in step; `rewrite` sorts its members by
    /// parameter position for the harder case, where one web has two members in
    /// one block and its own order -- by `ValueId` -- need not agree.
    ///
    /// The two are opposed deliberately: `%5` is parameter 0 and `%4` is
    /// parameter 1, so ascending position is descending `ValueId`.
    #[test]
    fn two_unions_merging_at_one_block_keep_their_arguments_paired() {
        let values = vec![
            op(OpKind::Param(0), HirType::NUMBER),
            op(OpKind::ConstBool(true), HirType::Bool),
            op(OpKind::ConstUndefined, HirType::Erased),
            op(OpKind::Erase { value: ValueId(0) }, HirType::Erased),
            op(OpKind::BlockParam(1), HirType::Erased),
            op(OpKind::BlockParam(0), HirType::Erased),
            op(OpKind::TagOf { value: ValueId(4) }, tag_type()),
            op(OpKind::TagOf { value: ValueId(5) }, tag_type()),
        ];
        let mut it = func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1), ValueId(2), ValueId(3)],
                    jump(1, vec![ValueId(2), ValueId(3)]),
                ),
                block(
                    vec![ValueId(5), ValueId(4)],
                    vec![ValueId(6), ValueId(7)],
                    Terminator::Return(None),
                ),
            ],
        );
        assert_eq!(split_unions(&mut it), 2);

        let params = it.blocks[1].params.clone();
        assert_eq!(params.len(), 4);
        let Terminator::Jump { args, .. } = &it.blocks[0].terminator else {
            panic!("b0 jumps");
        };
        assert_eq!(args.len(), 4);

        // Parameter 0 was the `undefined`, parameter 1 the erasure of `%0`. Each
        // payload argument has to sit under its own parameter.
        for (at, param) in params.iter().enumerate() {
            let want = it.values[param.0 as usize].ty.clone();
            let got = it.values[args[at].0 as usize].ty.clone();
            assert_eq!(want, got, "argument {at} does not match its parameter");
        }
        // And concretely: parameter 1 took the erasure, so the payload beneath
        // it is the erased value itself and not the absent edge's zero. It sits
        // at position 2 because parameter 1's payload was appended first --
        // which is the pairing, stated as a value rather than as a type.
        assert_eq!(args[2], ValueId(0));
        assert_eq!(
            it.values[args[3].0 as usize].kind,
            OpKind::ConstFloat(0.0),
            "parameter 0 was the absence, so its payload is the zero"
        );
    }

    /// `T | null | undefined` lowers to two parameters chained, and neither can
    /// be judged alone: the first's only use is the second, and the second's
    /// only source is the first. The web is the unit.
    #[test]
    fn a_chain_of_two_parameters_splits_as_one_web() {
        let values = vec![
            op(OpKind::Param(0), HirType::NUMBER),
            op(OpKind::ConstBool(true), HirType::Bool),
            op(OpKind::ConstUndefined, HirType::Erased),
            op(OpKind::Erase { value: ValueId(0) }, HirType::Erased),
            op(OpKind::BlockParam(0), HirType::Erased),
            op(OpKind::ConstNull, HirType::Erased),
            op(OpKind::BlockParam(0), HirType::Erased),
            op(OpKind::TagOf { value: ValueId(6) }, tag_type()),
        ];
        let mut it = func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0), ValueId(1)],
                    Terminator::Branch {
                        cond: ValueId(1),
                        then_target: BlockId(1),
                        then_args: Vec::new(),
                        else_target: BlockId(2),
                        else_args: Vec::new(),
                    },
                ),
                block(Vec::new(), vec![ValueId(2)], jump(3, vec![ValueId(2)])),
                block(Vec::new(), vec![ValueId(3)], jump(3, vec![ValueId(3)])),
                // The first merge hands its parameter straight to the second.
                block(vec![ValueId(4)], Vec::new(), jump(4, vec![ValueId(4)])),
                block(vec![ValueId(6)], vec![ValueId(7)], Terminator::Return(None)),
            ],
        );
        // Both halves of the chain, in one go.
        assert_eq!(split_unions(&mut it), 2);
        assert_eq!(it.blocks[3].params.len(), 2);
        assert_eq!(it.blocks[4].params.len(), 2);

        // The inner jump carries the outer's tag and payload straight through.
        let Terminator::Jump { args, .. } = &it.blocks[3].terminator else {
            panic!("b3 jumps");
        };
        assert_eq!(args[0], ValueId(4));
        assert_eq!(args[1], it.blocks[3].params[1]);
    }
}
