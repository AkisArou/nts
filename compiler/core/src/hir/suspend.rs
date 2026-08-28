//! Making an `async` function resumable.
//!
//! # What this is
//!
//! An `async` function that contains an `await` cannot be a C function. It has
//! to be able to stop in the middle, hand control back to the event loop, and
//! *resume* later — in a different call, with its locals intact. RFC §12 says
//! how: a state machine plus a managed frame, rather than a stackful fiber.
//!
//! ```text
//! async function f(n) { return await g(n); }
//!
//!         becomes
//!
//! f(n)              frame = new Frame; frame.n = n;
//!                   frame.result = promise_new();
//!                   f__resume(frame);
//!                   return frame.result;
//!
//! f__resume(frame)  switch (frame.state) { 0: goto b0; 1: goto r1; }
//!                b0: p = g(frame.n);
//!                    frame.awaited = p; frame.state = 1;
//!                    promise_subscribe(p, f__resume, frame);
//!                    return;                       <- the suspension
//!                r1: v = promise_number(frame.awaited);
//!                    promise_fulfill_number(frame.result, v);
//!                    return;
//! ```
//!
//! # Why the frame is an ordinary object
//!
//! It is a synthetic class, exactly as a closure is. That is not a shortcut: a
//! frame *is* captured state, which is what an object is — so it inherits the
//! layout, the descriptor, the precise tracing, the escape analysis and the
//! reference counting rather than needing a second mechanism for each. RFC §12's
//! argument for frames over fibers is precisely this: nothing is hidden on a
//! native stack that a collector would have to learn to scan.
//!
//! # Why it is a pass rather than part of lowering
//!
//! Which values must live in the frame is a whole-function question — the ones
//! that are live *across* a suspension — and the AST walk that lowers a body is
//! in no position to answer it. Here the function is already SSA with a control
//! flow graph, and [`super::liveness`] answers it directly.
//!
//! # What is not done yet
//!
//! Spilling. A value that is live across an `await` and is neither a parameter
//! nor the function's own result promise needs a frame slot and every use of it
//! rewritten to a load. That is the general case, and it is refused by name
//! until it is written, because the alternative — dropping the value and
//! resuming with whatever the register held — is the kind of wrong that runs.

use nts_diagnostics::Diagnostic;

use super::{
    Field, Func, HirType, Layout, ManagedType, Op, OpKind, Program, Terminator, TypeId, ValueId,
};

/// Fixed frame fields, before the parameters.
const FIELD_STATE: u32 = 0;
const FIELD_RESULT: u32 = 1;
const FIELD_AWAITED: u32 = 2;
const FIXED_FIELDS: u32 = 3;

/// The synthetic type id for the `n`th frame.
///
/// Below the closure ids and above the floor, so the two cannot collide: a
/// closure counts up from `u32::MAX` and a frame counts up from halfway into
/// the synthetic space.
fn frame_type(index: usize) -> TypeId {
    let id = super::SYNTHETIC_TYPE_FLOOR + (1 << 19) + u32::try_from(index).unwrap_or(0);
    TypeId(id)
}

fn frame_names(function: &str) -> (String, String) {
    (format!("{function}#frame"), format!("{function}__resume"))
}

/// Whether a function has anything to suspend at.
fn suspends(func: &Func) -> bool {
    func.values
        .iter()
        .any(|op| matches!(op.kind, OpKind::Await { .. }))
}

/// Rewrite every `async` function that awaits into a state machine.
///
/// Returns a diagnostic per function it could not transform. Those functions are
/// left containing `Await`, which nothing downstream accepts — the caller drops
/// them, the way it drops any refused function.
pub fn transform(program: &mut Program) -> Vec<Diagnostic> {
    let mut refusals = Vec::new();
    let mut added: Vec<Func> = Vec::new();
    let mut layouts: Vec<Layout> = Vec::new();
    let mut dropped: Vec<usize> = Vec::new();

    for index in 0..program.funcs.len() {
        if !suspends(&program.funcs[index]) {
            continue;
        }
        match rewrite(&program.funcs[index], index) {
            Ok(Rewritten {
                entry,
                resume,
                layout,
            }) => {
                program.funcs[index] = entry;
                added.push(resume);
                layouts.push(layout);
            }
            Err(diagnostic) => {
                refusals.push(diagnostic);
                // Left in the program it would reach the backend still holding
                // an `Await`, which has no C. Removing it makes the caller's
                // call a call to nothing, which `drop_callers_of_refused`
                // already knows how to turn into a diagnostic of its own.
                dropped.push(index);
            }
        }
    }
    for index in dropped.into_iter().rev() {
        program.funcs.remove(index);
    }
    program.funcs.extend(added);
    program.layouts.extend(layouts);
    refusals
}

struct Rewritten {
    entry: Func,
    resume: Func,
    layout: Layout,
}

fn refuse(func: &Func, what: &str) -> Diagnostic {
    Diagnostic::error(
        "NTS1001",
        format!("{what} is not supported by this lowering yet"),
        func.origin.location,
    )
}

/// Where the one suspension is: the block it is in, and its index among that
/// block's operations.
///
/// One, in one block, for now. A second suspension point needs the state
/// dispatch to be a chain rather than a single test, and an `await` inside a
/// branch or a loop needs the block graph split and renumbered -- both of which
/// are the general case that follows this one. Refusing them by name beats
/// transforming them nearly right.
fn sole_await(func: &Func) -> Result<(usize, usize, ValueId), Diagnostic> {
    let mut found = None;
    for (block, body) in func.blocks.iter().enumerate() {
        for (at, value) in body.ops.iter().enumerate() {
            if !matches!(func.values[value.0 as usize].kind, OpKind::Await { .. }) {
                continue;
            }
            if found.is_some() {
                return Err(refuse(func, "more than one `await` in a function"));
            }
            found = Some((block, at, *value));
        }
    }
    let (block, at, value) = found.ok_or_else(|| refuse(func, "an `await`"))?;
    if block != 0 {
        return Err(refuse(func, "an `await` inside a branch or a loop"));
    }
    if func.blocks.len() != 1 {
        return Err(refuse(func, "an `await` in a function that branches"));
    }
    Ok((block, at, value))
}

fn rewrite(func: &Func, index: usize) -> Result<Rewritten, Diagnostic> {
    let (_, at, awaited) = sole_await(func)?;
    let result = func
        .async_result
        .ok_or_else(|| refuse(func, "an `await` outside an `async` function"))?;
    let OpKind::Await { promise } = func.values[awaited.0 as usize].kind else {
        unreachable!("sole_await returns an await");
    };

    // What lives in the frame: the fixed three, then the parameters. Every use
    // of one becomes a load, so the value survives the suspension without the
    // C stack having to.
    let mut slot_of: rustc_hash::FxHashMap<ValueId, u32> = rustc_hash::FxHashMap::default();
    slot_of.insert(result, FIELD_RESULT);
    for (value, op) in func.values.iter().enumerate() {
        if let OpKind::Param(slot) = op.kind {
            slot_of.insert(
                ValueId(u32::try_from(value).unwrap_or(0)),
                FIXED_FIELDS + slot,
            );
        }
    }

    // Nothing else may cross the suspension. A value defined before the
    // `await` and read after it needs a frame slot of its own and every use
    // rewritten to a load -- which is the general spilling this does not do
    // yet. Dropping it instead would resume with whatever the register held.
    let body = &func.blocks[0];
    let before: rustc_hash::FxHashSet<ValueId> = body.ops[..at].iter().copied().collect();
    let mut crossing = Vec::new();
    for value in &body.ops[at + 1..] {
        for operand in super::operands_of(&func.values[value.0 as usize].kind) {
            if before.contains(&operand) && !slot_of.contains_key(&operand) {
                crossing.push(operand);
            }
        }
    }
    for operand in super::operands_of_terminator(&body.terminator) {
        if before.contains(&operand) && !slot_of.contains_key(&operand) {
            crossing.push(operand);
        }
    }
    if !crossing.is_empty() {
        return Err(refuse(func, "an `await` with a value that outlives it"));
    }

    let frame_ty = HirType::Managed(ManagedType::Object(frame_type(index)));
    let (frame_name, resume_name) = frame_names(&func.name);
    let layout = Layout {
        types: vec![frame_type(index)],
        name: frame_name,
        fields: frame_fields(func),
        methods: Vec::new(),
    };
    let entry = entry_function(func, &frame_ty, &resume_name, &slot_of);
    let resume = resume_function(
        func,
        &frame_ty,
        &resume_name,
        &slot_of,
        at,
        awaited,
        promise,
    );
    Ok(Rewritten {
        entry,
        resume,
        layout,
    })
}

/// The frame's fields: the fixed three, then one per parameter.
fn frame_fields(func: &Func) -> Vec<Field> {
    let mut fields = vec![
        Field {
            name: "state".to_owned(),
            ty: HirType::Int {
                bits: 32,
                signed: true,
            },
            readonly: false,
        },
        Field {
            name: "result".to_owned(),
            ty: func.return_type.clone(),
            readonly: false,
        },
        Field {
            name: "awaited".to_owned(),
            // Whatever was most recently awaited. The payload varies between
            // suspension points, and the *reader* knows which it is because the
            // resume block was generated beside the `await` that set it.
            ty: HirType::Managed(ManagedType::Promise(Box::new(HirType::Void))),
            readonly: false,
        },
    ];
    for param in &func.params {
        fields.push(Field {
            name: param.name.clone(),
            ty: param.ty.clone(),
            readonly: false,
        });
    }
    fields
}

/// A small arena builder, so the two generated functions can append values
/// without renumbering the ones the original body already uses.
struct Build {
    values: Vec<Op>,
    ops: Vec<ValueId>,
    origin: super::Origin,
}

impl Build {
    fn push(&mut self, kind: OpKind, ty: HirType) -> ValueId {
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind,
            ty,
            origin: self.origin.clone(),
        });
        self.ops.push(id);
        id
    }

    fn constant(&mut self, value: i64) -> ValueId {
        self.push(
            OpKind::ConstInt(value),
            HirType::Int {
                bits: 32,
                signed: true,
            },
        )
    }

    fn set(&mut self, frame: ValueId, field: u32, value: ValueId) {
        self.push(
            OpKind::FieldSet {
                object: frame,
                field,
                value,
            },
            HirType::Void,
        );
    }

    fn get(&mut self, frame: ValueId, field: u32, ty: HirType) -> ValueId {
        self.push(
            OpKind::FieldGet {
                object: frame,
                field,
            },
            ty,
        )
    }
}

/// `f(args)`: make the frame, fill it, start the machine, hand back the promise.
///
/// The body it replaces is gone entirely -- it lives in the resume function
/// now. What is left is the part a caller sees, which is synchronous: a
/// promise, immediately, whether or not the work behind it has finished.
fn entry_function(
    func: &Func,
    frame_ty: &HirType,
    resume: &str,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
) -> Func {
    let mut build = Build {
        values: Vec::new(),
        ops: Vec::new(),
        origin: func.origin.clone(),
    };
    let mut params = Vec::new();
    for (at, param) in func.params.iter().enumerate() {
        let value = build.push(
            OpKind::Param(u32::try_from(at).unwrap_or(0)),
            param.ty.clone(),
        );
        params.push((value, param.clone()));
    }
    // `frame: false` -- on the heap, and that is the point. The whole reason
    // this object exists is to outlive the C frame that made it.
    let frame = build.push(OpKind::ObjectNew { frame: false }, frame_ty.clone());
    let zero = build.constant(0);
    build.set(frame, FIELD_STATE, zero);

    let promise = build.push(
        OpKind::Call {
            callee: super::Callee::External("nts_promise_new".to_owned()),
            args: Vec::new(),
            frame: None,
        },
        func.return_type.clone(),
    );
    build.set(frame, FIELD_RESULT, promise);
    for (value, param) in &params {
        let Some(slot) = slot_of.get(&find_param(func, &param.name)).copied() else {
            continue;
        };
        build.set(frame, slot, *value);
    }

    build.push(
        OpKind::Call {
            callee: super::Callee::Direct(resume.to_owned()),
            args: vec![frame],
            frame: None,
        },
        HirType::Void,
    );
    let settled = build.get(frame, FIELD_RESULT, func.return_type.clone());

    Func {
        name: func.name.clone(),
        params: func.params.clone(),
        return_type: func.return_type.clone(),
        values: build.values,
        blocks: vec![super::Block {
            params: Vec::new(),
            ops: build.ops,
            terminator: Terminator::Return(Some(settled)),
        }],
        origin: func.origin.clone(),
        exported: func.exported,
        initializes_receiver: false,
        async_result: None,
    }
}

/// Reload one spilled value, as its own SSA name.
///
/// A load per use rather than one at the top of the function: two loads of the
/// same slot are two values, so nothing is defined twice, and a use that the
/// suspension never reaches costs nothing.
fn reload(
    build: &mut Build,
    frame: ValueId,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
    value: ValueId,
) -> ValueId {
    let Some(slot) = slot_of.get(&value).copied() else {
        return value;
    };
    let ty = build.values[value.0 as usize].ty.clone();
    build.get(frame, slot, ty)
}

/// Copy one operation across, reloading whatever it reads from the frame.
///
/// The loads are emitted *before* the operation that needs them and the
/// substitution is a plain lookup, rather than allocating inside
/// [`super::simplify::substitute`] -- which takes a `Fn` precisely so that a
/// substitution cannot quietly have effects.
fn carry(
    build: &mut Build,
    frame: ValueId,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
    original: ValueId,
) {
    let kind = build.values[original.0 as usize].kind.clone();
    let mut loaded: rustc_hash::FxHashMap<ValueId, ValueId> = rustc_hash::FxHashMap::default();
    for operand in super::operands_of(&kind) {
        if slot_of.contains_key(&operand) && !loaded.contains_key(&operand) {
            let value = reload(build, frame, slot_of, operand);
            loaded.insert(operand, value);
        }
    }
    let mut kind = kind;
    super::simplify::substitute(&mut kind, |v| loaded.get(&v).copied().unwrap_or(v));
    build.values[original.0 as usize].kind = kind;
    build.ops.push(original);
}

/// The parameter value for a name, in the original body.
fn find_param(func: &Func, name: &str) -> ValueId {
    for (at, param) in func.params.iter().enumerate() {
        if param.name != name {
            continue;
        }
        for (value, op) in func.values.iter().enumerate() {
            if matches!(op.kind, OpKind::Param(slot) if slot as usize == at) {
                return ValueId(u32::try_from(value).unwrap_or(0));
            }
        }
    }
    ValueId(0)
}

/// `f__resume(frame)`: the body, entered at whichever state it left off in.
///
/// It returns nothing. What the original body returned was the promise, and the
/// promise is in the frame — a resumption has no caller to hand anything to,
/// because the caller left long ago.
fn resume_function(
    func: &Func,
    frame_ty: &HirType,
    name: &str,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
    at: usize,
    awaited: ValueId,
    promise: ValueId,
) -> Func {
    let body = &func.blocks[0];

    // The frame has to be value zero, because the C parameter for `params[i]`
    // is named after `ValueId(i)` -- a parameter is not a computed value, it is
    // the signature. So every original value shifts up by one.
    let shift = |value: ValueId| ValueId(value.0 + 1);
    let mut values = vec![Op {
        kind: OpKind::Param(0),
        ty: frame_ty.clone(),
        origin: func.origin.clone(),
    }];
    for op in &func.values {
        let mut kind = op.kind.clone();
        super::simplify::substitute(&mut kind, shift);
        values.push(Op {
            kind,
            ty: op.ty.clone(),
            origin: op.origin.clone(),
        });
    }
    let slot_of: rustc_hash::FxHashMap<ValueId, u32> = slot_of
        .iter()
        .map(|(value, slot)| (shift(*value), *slot))
        .collect();
    let slot_of = &slot_of;
    let awaited = shift(awaited);
    let promise = shift(promise);
    let frame = ValueId(0);
    let mut build = Build {
        values,
        ops: Vec::new(),
        origin: func.origin.clone(),
    };

    let (dispatch, fresh) = dispatch_block(&mut build, frame);

    // --- before the suspension -----------------------------------------
    for original in &body.ops[..at] {
        let original = shift(*original);
        // The operations that *define* a spilled value are gone: the entry
        // function computes them and stores them, and running them again here
        // would allocate a second promise on every resumption.
        if slot_of.contains_key(&original) {
            continue;
        }
        carry(&mut build, frame, slot_of, original);
    }
    let subscribed = reload(&mut build, frame, slot_of, promise);
    build.set(frame, FIELD_AWAITED, subscribed);
    let one = build.constant(1);
    build.set(frame, FIELD_STATE, one);
    build.push(
        OpKind::Suspend {
            promise: subscribed,
            frame,
            resume: name.to_owned(),
        },
        HirType::Void,
    );
    let suspending = std::mem::take(&mut build.ops);

    let resumed = resumed_block(&mut build, body, at, awaited, frame, slot_of);

    Func {
        name: name.to_owned(),
        params: vec![super::Param {
            name: "frame".to_owned(),
            ty: frame_ty.clone(),
            origin: func.origin.clone(),
            known: super::facts::Facts::TOP,
        }],
        return_type: HirType::Void,
        values: build.values,
        blocks: vec![
            super::Block {
                params: Vec::new(),
                ops: dispatch,
                terminator: Terminator::Branch {
                    cond: fresh,
                    then_target: super::BlockId(1),
                    then_args: Vec::new(),
                    else_target: super::BlockId(2),
                    else_args: Vec::new(),
                },
            },
            super::Block {
                params: Vec::new(),
                ops: suspending,
                terminator: Terminator::Return(None),
            },
            super::Block {
                params: Vec::new(),
                ops: resumed,
                terminator: Terminator::Return(None),
            },
        ],
        origin: func.origin.clone(),
        exported: false,
        initializes_receiver: false,
        async_result: None,
    }
}

/// The block a resumption lands in: read what the promise settled with, then
/// carry on with the rest of the original body.
fn resumed_block(
    build: &mut Build,
    body: &super::Block,
    at: usize,
    awaited: ValueId,
    frame: ValueId,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
) -> Vec<ValueId> {
    let shift = |value: ValueId| ValueId(value.0 + 1);
    let held = build.get(
        frame,
        FIELD_AWAITED,
        HirType::Managed(ManagedType::Promise(Box::new(HirType::Void))),
    );
    let payload = build.values[awaited.0 as usize].ty.clone();
    // Three cases, not two. A promise that settled with *nothing* has neither
    // slot filled, and both readers assert -- so `await` of a `Promise<void>`
    // aborted at run time until this had its own arm. There is no value to
    // read, and nothing can reference one: `void` has no value to reference.
    let value = match &payload {
        HirType::Void => held,
        payload => {
            let reader = if matches!(payload, HirType::Managed(_)) {
                "nts_promise_reference"
            } else {
                "nts_promise_number"
            };
            build.push(
                OpKind::Call {
                    callee: super::Callee::External(reader.to_owned()),
                    args: vec![held],
                    frame: None,
                },
                payload.clone(),
            )
        }
    };
    for original in &body.ops[at + 1..] {
        // The `await`'s own value is what the promise settled with, which was
        // just read out of the frame -- so it substitutes like a spilled one.
        let original = shift(*original);
        let mut kind = build.values[original.0 as usize].kind.clone();
        super::simplify::substitute(&mut kind, |v| if v == awaited { value } else { v });
        build.values[original.0 as usize].kind = kind;
        carry(build, frame, slot_of, original);
    }
    std::mem::take(&mut build.ops)
}

/// The block a resumption enters first: which state is this, and where does it
/// go?
///
/// A comparison rather than a jump table, because the IR's terminators are a
/// two-way branch and nothing else. With one suspension point that is one test;
/// a second would make it a chain, which is part of why more than one `await`
/// is still refused.
fn dispatch_block(build: &mut Build, frame: ValueId) -> (Vec<ValueId>, ValueId) {
    let state = build.get(
        frame,
        FIELD_STATE,
        HirType::Int {
            bits: 32,
            signed: true,
        },
    );
    let zero = build.constant(0);
    let fresh = build.push(
        OpKind::Binary {
            op: super::BinOp::Eq,
            lhs: state,
            rhs: zero,
        },
        HirType::Bool,
    );
    (std::mem::take(&mut build.ops), fresh)
}
