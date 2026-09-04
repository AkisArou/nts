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
//! # Spilling
//!
//! A value live across a suspension and neither a parameter nor the function's
//! own result needs a frame slot, and every use of it rewritten to a load.
//! [`crossing`] finds them, [`frame_fields`] gives them slots, and [`reload`]
//! and [`carry`] rewrite the uses. The alternative — dropping the value and
//! resuming with whatever the register held — is the kind of wrong that runs.
//!
//! This paragraph said the work was *not done* for some time after it was, and
//! record 0101 is about what that costs: a comment claiming a gap gets
//! believed, and the belief is what does the damage.
//!
//! # Generators
//!
//! `function*` is the same machine. See [`Mode`]: what differs is who resumes
//! it, and everything else follows from that one sentence.

use nts_diagnostics::Diagnostic;

use super::{
    Field, Func, HirType, Layout, ManagedType, Op, OpKind, Program, Terminator, TypeId, ValueId,
};

/// Fixed frame fields, before the parameters.
const FIELD_STATE: u32 = 0;
const FIELD_RESULT: u32 = 1;
const FIELD_AWAITED: u32 = 2;
const FIXED_FIELDS: u32 = 3;

/// The element a generator most recently yielded.
///
/// Slot one, where an `async` frame keeps its promise, because a generator has
/// neither a promise nor anything awaited: it has two fixed fields where an
/// `async` frame has three. The walk reads this by number, which is why it is
/// public -- the layout is built here and named there.
pub const FIELD_YIELDED: u32 = 1;

/// Which protocol a function's suspensions speak.
///
/// The state machine is the same in both: cut the body at each suspension,
/// spill what is live across one, dispatch on a stored state. What differs is
/// *who resumes it and with what*. An `await` hands control to the event loop
/// and comes back through a subscription; a `yield` hands control to whoever is
/// walking the generator and comes back when they ask for another element.
///
/// So an `async` frame carries a promise to settle and the thing most recently
/// awaited, and its resumption returns nothing -- there is no caller left to
/// return to. A generator's carries the element it stopped on, and its
/// resumption returns *done*, to the caller that is still standing there.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Async,
    Generator,
}

impl Mode {
    /// How many fields sit before the parameters.
    fn fixed(self) -> u32 {
        match self {
            Self::Async => FIXED_FIELDS,
            // `state` and `yielded`, and nothing else.
            Self::Generator => 2,
        }
    }
}

/// The synthetic type id for the `n`th frame.
///
/// In the frames' own part of the synthetic space -- see `SYNTHETIC_FRAMES`.
///
/// It used to start where the closures' part now begins, which was safe only
/// because neither ever ran to 2^19 entries, and left no way to tell a frame's
/// id from a closure's.
fn frame_type(index: usize) -> TypeId {
    let id = super::SYNTHETIC_FRAMES + u32::try_from(index).unwrap_or(0);
    debug_assert!(
        id < super::SYNTHETIC_CLOSURES,
        "more suspended frames than the synthetic id space holds"
    );
    TypeId(id)
}

fn frame_names(function: &str) -> (String, String) {
    (format!("{function}#frame"), resume_name(function))
}

/// What a function's resumption is called.
///
/// Public because a `for...of` over a generator calls it, and is lowered long
/// before this pass builds it. One function so that the two spellings cannot
/// drift apart into a link error.
#[must_use]
pub fn resume_name(function: &str) -> String {
    format!("{function}__resume")
}

/// Every value that is still needed on the far side of a suspension.
///
/// These are the ones that cannot be C locals: the function returns at each
/// `await`, so the C frame holding them is gone by the time the resumption
/// runs. They go in the managed frame, and every use of one becomes a load.
///
/// Computed on the *original* function rather than on the split one, which is
/// what avoids building the body twice. At an `await` in block `b` at position
/// `p`, what is live is whatever leaves `b` plus whatever the rest of `b`
/// reads, minus whatever `b` defines at or after `p` -- that last part being
/// the values that do not exist yet when the suspension happens.
fn crossing(func: &Func) -> rustc_hash::FxHashSet<ValueId> {
    let live = super::liveness::analyze(func);
    let mut crossing = rustc_hash::FxHashSet::default();
    for (index, block) in func.blocks.iter().enumerate() {
        for (at, value) in block.ops.iter().enumerate() {
            if !matches!(
                func.values[value.0 as usize].kind,
                OpKind::Await { .. } | OpKind::Yield { .. }
            ) {
                continue;
            }
            let later: rustc_hash::FxHashSet<ValueId> = block.ops[at..].iter().copied().collect();
            let mut consider = |operand: ValueId| {
                if !later.contains(&operand) {
                    crossing.insert(operand);
                }
            };
            for operand in live.live_out(super::BlockId(u32::try_from(index).unwrap_or(0))) {
                consider(*operand);
            }
            for op in &block.ops[at + 1..] {
                for operand in super::operands_of(&func.values[op.0 as usize].kind) {
                    consider(operand);
                }
            }
            for operand in super::operands_of_terminator(&block.terminator) {
                consider(operand);
            }
        }
    }
    crossing
}

/// Whether a function has anything to suspend at.
fn suspends(func: &Func) -> bool {
    func.values
        .iter()
        .any(|op| matches!(op.kind, OpKind::Await { .. } | OpKind::Yield { .. }))
}

/// The second name a function about to be split provides.
///
/// [`super::drop_callers_of_refused`] runs *before* this pass and drops any
/// function calling a name that is not in `funcs`. A `for...of` over a
/// generator calls the resumption, which does not exist yet, so without this
/// every such loop is dropped as calling something refused. A function that is
/// going to be split into two provides both of its names.
#[must_use]
pub fn provides(func: &Func) -> Option<String> {
    suspends(func).then(|| frame_names(&func.name).1)
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

/// Where each suspension is, in the order the state numbers run.
///
/// State 0 is the function's start, so the first `await` resumes into state 1.
fn suspensions(func: &Func) -> Vec<(usize, usize, ValueId)> {
    let mut found = Vec::new();
    for (block, body) in func.blocks.iter().enumerate() {
        for (at, value) in body.ops.iter().enumerate() {
            if matches!(
                func.values[value.0 as usize].kind,
                OpKind::Await { .. } | OpKind::Yield { .. }
            ) {
                found.push((block, at, *value));
            }
        }
    }
    found
}

fn rewrite(func: &Func, index: usize) -> Result<Rewritten, Diagnostic> {
    let points = suspensions(func);
    if points.is_empty() {
        return Err(refuse(func, "an `await`"));
    }
    let yields = |kind: &OpKind| matches!(kind, OpKind::Yield { .. });
    let generator = func.frame.as_ref();
    // An `async function*` is both at once, and the two protocols disagree
    // about what a resumption is for: one settles a promise nobody is waiting
    // in front of, the other answers a caller who is. Refused by name rather
    // than by whichever check happened to fire first.
    if generator.is_some() != func.values.iter().any(|op| yields(&op.kind)) {
        return Err(refuse(func, "an `async` generator"));
    }
    let mode = if generator.is_some() {
        Mode::Generator
    } else {
        Mode::Async
    };
    if mode == Mode::Generator && func.values.iter().any(|op| matches!(op.kind, OpKind::Await { .. }))
    {
        return Err(refuse(func, "an `async` generator"));
    }
    let result = match mode {
        Mode::Async => Some(
            func.async_result
                .ok_or_else(|| refuse(func, "an `await` outside an `async` function"))?,
        ),
        Mode::Generator => None,
    };

    // What goes in the frame. Order is fixed rather than incidental: the fixed
    // three, then the parameters in declaration order, then everything that has
    // to survive a suspension -- sorted, so two compilations of one program
    // produce the same layout.
    let mut slot_of: rustc_hash::FxHashMap<ValueId, u32> = rustc_hash::FxHashMap::default();
    if let Some(result) = result {
        slot_of.insert(result, FIELD_RESULT);
    }
    let fixed = mode.fixed();
    let mut next = fixed;
    for (value, op) in func.values.iter().enumerate() {
        if let OpKind::Param(slot) = op.kind {
            slot_of.insert(ValueId(u32::try_from(value).unwrap_or(0)), fixed + slot);
            next = next.max(fixed + slot + 1);
        }
    }
    let mut spilled: Vec<ValueId> = crossing(func)
        .into_iter()
        .filter(|value| !slot_of.contains_key(value))
        .collect();
    spilled.sort_unstable_by_key(|value| value.0);
    for value in &spilled {
        slot_of.insert(*value, next);
        next += 1;
    }

    // A generator's frame type was reserved by the lowering, because the
    // `for...of` that walks one had to name it before this pass ran; an
    // `async` frame is named here from the function's index, which nothing
    // outside this pass ever says.
    let frame_id = generator.map_or_else(|| frame_type(index), |frame| frame.ty);
    let frame_ty = HirType::Managed(ManagedType::Object(frame_id));
    let (frame_name, resume_name) = frame_names(&func.name);
    let layout = Layout {
        types: vec![frame_id],
        name: frame_name,
        fields: frame_fields(func, &spilled, mode, generator.map(|frame| &frame.yields)),
        methods: Vec::new(),
        // A suspended frame extends nothing.
        base: None,
    };
    let entry = entry_function(func, &frame_ty, &resume_name, &slot_of, mode);
    let resume = resume_function(func, &frame_ty, &resume_name, &slot_of, &points, mode);
    Ok(Rewritten {
        entry,
        resume,
        layout,
    })
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
            OpKind::ConstInt(i128::from(value)),
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
    mode: Mode,
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

    if mode == Mode::Async {
        let promise = build.push(
            OpKind::Call {
                callee: super::Callee::External("nts_promise_new".to_owned()),
                args: Vec::new(),
                frame: None,
            },
            func.return_type.clone(),
        );
        build.set(frame, FIELD_RESULT, promise);
    }
    for (value, param) in &params {
        let Some(slot) = slot_of.get(&find_param(func, &param.name)).copied() else {
            continue;
        };
        build.set(frame, slot, *value);
    }

    // The resume *consumes* a reference to the frame: it either finishes and
    // gives it back, or suspends and leaves it with the runtime, which holds it
    // until the resumption runs. So every caller provides one, and this is the
    // first caller.
    //
    // Without it the frame was released here -- `hir::rc` gives back what the
    // allocation above took -- while a pending reaction still pointed at it,
    // and the resumption ran on freed memory. Invisible under a provider that
    // frees nothing, which is every provider this was ever tested under.
    //
    // A generator does none of this. Calling one runs *nothing*: the body does
    // not start until the first `next`, which is the walk's first step. So the
    // frame is handed straight back, owned by whoever asked for it, and the
    // resumption borrows it from them on every step -- which is why the
    // generator's resumption does not give it back the way the `async` one
    // does.
    let handed_back = match mode {
        Mode::Async => {
            build.push(OpKind::Retain(frame), HirType::Void);
            build.push(
                OpKind::Call {
                    callee: super::Callee::Direct(resume.to_owned()),
                    args: vec![frame],
                    frame: None,
                },
                HirType::Void,
            );
            build.get(frame, FIELD_RESULT, func.return_type.clone())
        }
        Mode::Generator => frame,
    };

    Func {
        name: func.name.clone(),
        params: func.params.clone(),
        return_type: func.return_type.clone(),
        values: build.values,
        blocks: vec![super::Block {
            params: Vec::new(),
            ops: build.ops,
            terminator: Terminator::Return(Some(handed_back)),
        }],
        origin: func.origin.clone(),
        exported: func.exported,
        initializes_receiver: false,
            abstract_declaration: false,
        async_result: None,
        frame: None,
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
    // And if this value itself has to survive a suspension, it is written to
    // the frame the moment it exists. Without this the loads on the far side
    // read whatever the field was left holding, which is a plausible-looking
    // number rather than an obvious one.
    if let Some(slot) = slot_of.get(&original).copied() {
        build.set(frame, slot, original);
    }
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

/// The frame's fields: the fixed three, then one per parameter, then one for
/// every value that has to survive a suspension.
///
/// Parameters are unconditional even when nothing reads them after a
/// suspension. In the resume function they are not parameters at all -- its one
/// argument is the frame -- so code *before* the first suspension has nowhere
/// else to read them from.
fn frame_fields(
    func: &Func,
    spilled: &[ValueId],
    mode: Mode,
    yields: Option<&HirType>,
) -> Vec<Field> {
    let state = Field {
        name: "state".to_owned(),
        ty: HirType::Int {
            bits: 32,
            signed: true,
        },
        readonly: false,
    };
    let mut fields = match mode {
        Mode::Async => vec![
            state,
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
        ],
        // Two, and the second is the element. There is no `done` field: the
        // resumption *returns* done, to a caller that is still there to read
        // it, so storing it as well would be a second copy of one fact.
        Mode::Generator => vec![
            state,
            Field {
                name: "yielded".to_owned(),
                ty: yields.cloned().unwrap_or(HirType::Void),
                readonly: false,
            },
        ],
    };
    for param in &func.params {
        fields.push(Field {
            name: param.name.clone(),
            ty: param.ty.clone(),
            readonly: false,
        });
    }
    for (at, value) in spilled.iter().enumerate() {
        fields.push(Field {
            // Named by position rather than by anything in the source: these
            // are SSA values, and most were never a name anyone wrote.
            name: format!("held{at}"),
            ty: func.values[value.0 as usize].ty.clone(),
            readonly: false,
        });
    }
    fields
}

/// `f__resume(frame)`: the body, entered at whichever state it left off in.
///
/// It returns nothing. What the original body returned was the promise, and the
/// promise is in the frame — a resumption has no caller to hand anything to,
/// because the caller left long ago.
///
/// Each original block is cut into segments at its `await`s. Segment zero keeps
/// the block's parameters and is reached the ordinary way; every later segment
/// is reached only from the dispatch, which is why everything live at one has
/// to be in the frame rather than in a block parameter.
fn resume_function(
    func: &Func,
    frame_ty: &HirType,
    name: &str,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
    points: &[(usize, usize, ValueId)],
    mode: Mode,
) -> Func {
    let shift = |value: ValueId| ValueId(value.0 + 1);
    let values = shifted_arena(func, frame_ty);
    let moved: rustc_hash::FxHashMap<ValueId, u32> = slot_of
        .iter()
        .map(|(value, slot)| (shift(*value), *slot))
        .collect();
    let slot_of = &moved;
    let frame = ValueId(0);
    let mut build = Build {
        values,
        ops: Vec::new(),
        origin: func.origin.clone(),
    };

    let (base, starts) = segment_layout(func, points, mode);
    // Immediately after the dispatch chain, which is what `segment_layout`
    // reserved the extra block for. A generator has no such block: a `yield`
    // cannot reject.
    let reject = super::BlockId(base.saturating_sub(1));

    let mut body: Vec<super::Block> = Vec::new();
    let mut resume_at: Vec<super::BlockId> = vec![super::BlockId(starts[0])];

    for (index, block) in func.blocks.iter().enumerate() {
        let mut params: Vec<ValueId> = block.params.iter().map(|value| shift(*value)).collect();
        // A block parameter that has to survive a suspension is stored the
        // moment the block is entered: it has no defining operation to put a
        // store after.
        for value in &params {
            if let Some(slot) = slot_of.get(value).copied() {
                build.set(frame, slot, *value);
            }
        }
        let mut from = 0usize;
        loop {
            let next = points
                .iter()
                .find(|(at, op, _)| *at == index && *op >= from)
                .map(|(_, op, value)| (*op, shift(*value)));
            let stop = next.map_or(block.ops.len(), |(op, _)| op);
            for original in &block.ops[from..stop] {
                let original = shift(*original);
                // A parameter and the result promise are computed once, in the
                // entry function, and stored. Replaying their definitions here
                // allocated a fresh promise on every resumption.
                if entry_owned(func, slot_of, original, mode) {
                    continue;
                }
                carry(&mut build, frame, slot_of, original);
            }
            let Some((op, awaited)) = next else {
                let mut terminator = retarget(&block.terminator, &starts, shift);
                // A generator's `return` is the end of the walk, and what it
                // returns is the `TReturn` of `Generator<T, TReturn>`, which a
                // `for...of` discards. So every finishing exit answers *done*
                // instead, which is what the resumption's caller asked.
                if mode == Mode::Generator && matches!(terminator, Terminator::Return(_)) {
                    let done = build.push(OpKind::ConstBool(true), HirType::Bool);
                    terminator = Terminator::Return(Some(done));
                }
                // A terminator reads values too, and a jump's arguments are the
                // easiest to forget: a loop's counter is a block parameter of
                // the header, and a segment reached only from the dispatch is
                // dominated by nothing that defines it. The verifier caught
                // exactly that -- `jump b7(%15, %7)` where `%7` was the header's
                // parameter -- which is the argument for having a verifier.
                let terminator = reload_terminator(&mut build, frame, slot_of, terminator);
                body.push(super::Block {
                    params: std::mem::take(&mut params),
                    ops: std::mem::take(&mut build.ops),
                    terminator,
                });
                break;
            };
            let marker = i64::try_from(resume_at.len()).unwrap_or(0);
            let paused = pause(&mut build, frame, slot_of, awaited, name, marker);
            body.push(super::Block {
                params: std::mem::take(&mut params),
                ops: std::mem::take(&mut build.ops),
                terminator: paused,
            });
            let landing = base + u32::try_from(body.len()).unwrap_or(0);
            resume_at.push(super::BlockId(landing));
            // A `yield` lands straight back in the body. The rejection test
            // below exists because a promise can settle either way; nothing
            // resumes a generator with a failure, because the caller resuming
            // it is not settling anything.
            if mode == Mode::Generator {
                from = op + 1;
                continue;
            }
            // The dispatch lands here rather than on the payload read. A
            // rejected promise holds a reason and no value, so both readers
            // assert -- `await` of one aborted the program, which is the
            // failure mode a test that only awaits successes never sees.
            //
            // There is no `try`/`catch` across an `await` yet, so the only
            // thing a rejection can do is reject this function's own promise,
            // which is what the shared block does.
            body.push(rejection_check(
                &mut build,
                frame,
                std::mem::take(&mut params),
                reject,
                super::BlockId(landing + 1),
            ));
            read_settled(&mut build, frame, awaited, slot_of);
            from = op + 1;
        }
    }

    let mut blocks = dispatch_chain(&mut build, frame, &resume_at);
    if mode == Mode::Async {
        blocks.push(rejection_exit(&mut build, frame));
    }
    blocks.extend(body);
    if mode == Mode::Async {
        give_the_frame_back(&mut build, &mut blocks, frame, &func.origin);
    }
    assembled_resume(name, func, frame_ty.clone(), build, blocks, mode)
}

/// Stop here, and say how to be started again.
///
/// The two protocols in one function because they are the same three steps in
/// the same order -- put what the far side needs in the frame, write the state
/// to come back to, leave. What differs is the third: an `await` leaves a
/// subscription and returns to nobody, and a `yield` returns *not done* to the
/// caller, which **is** the suspension.
fn pause(
    build: &mut Build,
    frame: ValueId,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
    stopping: ValueId,
    resume: &str,
    marker: i64,
) -> Terminator {
    match build.values[stopping.0 as usize].kind.clone() {
        OpKind::Await { promise } => {
            let promise = reload(build, frame, slot_of, promise);
            build.set(frame, FIELD_AWAITED, promise);
            let marker = build.constant(marker);
            build.set(frame, FIELD_STATE, marker);
            build.push(
                OpKind::Suspend {
                    promise,
                    frame,
                    resume: resume.to_owned(),
                },
                HirType::Void,
            );
            Terminator::Return(None)
        }
        OpKind::Yield { value } => {
            let value = reload(build, frame, slot_of, value);
            build.set(frame, FIELD_YIELDED, value);
            let marker = build.constant(marker);
            build.set(frame, FIELD_STATE, marker);
            let unfinished = build.push(OpKind::ConstBool(false), HirType::Bool);
            Terminator::Return(Some(unfinished))
        }
        _ => unreachable!("`suspensions` returns awaits and yields"),
    }
}

/// The resumption, as a function.
///
/// One parameter and no result: everything it reads is in the frame and
/// everything it produces goes into the frame's promise. Not exported -- it is
/// reached through the subscription the suspension left behind, never by name.
fn assembled_resume(
    name: &str,
    func: &Func,
    frame_ty: HirType,
    build: Build,
    blocks: Vec<super::Block>,
    mode: Mode,
) -> Func {
    Func {
        name: name.to_owned(),
        params: vec![super::Param {
            name: "frame".to_owned(),
                // A receiver is not a declared parameter.
                shape: super::ParamShape::Ordinary,
            ty: frame_ty,
            origin: func.origin.clone(),
            known: super::facts::Facts::TOP,
        }],
        // A generator's resumption answers *done*, which is the whole of what
        // the walk needs to decide whether to go round again; the element it
        // left in the frame.
        return_type: match mode {
            Mode::Async => HirType::Void,
            Mode::Generator => HirType::Bool,
        },
        values: build.values,
        blocks,
        origin: func.origin.clone(),
        exported: false,
        initializes_receiver: false,
            abstract_declaration: false,
        async_result: None,
        frame: None,
    }
}

/// Give the frame back at every exit that is *finishing*, and at none that
/// is pausing. A block whose last operation is the suspension is handing the
/// frame to the runtime and its reference with it; every other `return` is
/// the end of the resumption, and the reference it was called with dies
/// there.
///
/// `hir::rc` does not do this: the frame is a *parameter*, and a parameter
/// is borrowed by that pass's convention. It is borrowed from whoever
/// provided the reference, which is exactly what makes giving it back here
/// correct rather than double.
    fn give_the_frame_back(
    build: &mut Build,
    blocks: &mut [super::Block],
    frame: super::ValueId,
    origin: &nts_semantic_schema::Origin,
) {
    for block in blocks.iter_mut() {
        if !matches!(block.terminator, Terminator::Return(_)) {
            continue;
        }
        let pausing = block.ops.last().is_some_and(|last| {
            matches!(build.values[last.0 as usize].kind, OpKind::Suspend { .. })
        });
        if pausing {
            continue;
        }
        let id = super::ValueId(u32::try_from(build.values.len()).unwrap_or(u32::MAX));
        build.values.push(super::Op {
            kind: OpKind::Release(frame),
            ty: HirType::Void,
            origin: origin.clone(),
        });
        block.ops.push(id);
    }
}

/// Where each original block's first segment lands, and where the body starts.
///
/// The dispatch takes the front of the block list: one block per state, plus
/// one nothing reaches so the last test has somewhere to send a state that
/// cannot happen. Everything after that is the body, a block per segment.
fn segment_layout(
    func: &Func,
    points: &[(usize, usize, ValueId)],
    mode: Mode,
) -> (u32, Vec<u32>) {
    // The dispatch chain, then one block the whole function shares for
    // propagating a rejection, then the body. A generator has no rejection
    // block and no landing block per suspension, for the same reason: nothing
    // resumes it with a failure.
    let shared = usize::from(mode == Mode::Async);
    let base = u32::try_from(points.len() + 2 + shared).unwrap_or(0);
    let mut starts = Vec::new();
    let mut count = 0u32;
    for index in 0..func.blocks.len() {
        starts.push(base + count);
        let cuts = points
            .iter()
            .filter(|(block, _, _)| *block == index)
            .count();
        // Two blocks per suspension, not one: the segment that suspends, and
        // the one the dispatch lands on, which tests for a rejection before
        // anything reads a payload. A generator needs only the first.
        count += u32::try_from((1 + shared) * cuts + 1).unwrap_or(1);
    }
    (base, starts)
}

/// The original values, with the frame inserted in front of them.
///
/// The frame has to be value zero, because the C parameter for `params[i]` is
/// named after `ValueId(i)` -- a parameter is not a computed value, it is the
/// signature. So every original value shifts up by one, operands included.
fn shifted_arena(func: &Func, frame_ty: &HirType) -> Vec<Op> {
    let mut values = vec![Op {
        kind: OpKind::Param(0),
        ty: frame_ty.clone(),
        origin: func.origin.clone(),
    }];
    for op in &func.values {
        let mut kind = op.kind.clone();
        super::simplify::substitute(&mut kind, |value| ValueId(value.0 + 1));
        values.push(Op {
            kind,
            ty: op.ty.clone(),
            origin: op.origin.clone(),
        });
    }
    values
}

/// Whether the entry function owns this value's definition.
///
/// The parameters and the result promise are computed before the machine starts
/// and stored, so their defining operations are not part of the body any more.
/// Everything else that is spilled is computed *by* the body and stored right
/// after.
fn entry_owned(
    func: &Func,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
    value: ValueId,
    mode: Mode,
) -> bool {
    slot_of.get(&value).is_some_and(|slot| {
        (mode == Mode::Async && *slot == FIELD_RESULT)
            || *slot < mode.fixed() + u32::try_from(func.params.len()).unwrap_or(0)
    })
}

/// Read what the promise a suspension waited on settled with.
///
/// The `await` operation itself becomes that read, so every later reference to
/// it finds the settled value with none of them rewritten.
/// The block a resumption lands on: is this a rejection or a value?
///
/// A rejected promise holds a reason and no payload, so both readers assert.
/// The test comes before anything reads, which is why the dispatch targets this
/// block rather than the payload read itself.
fn rejection_check(
    build: &mut Build,
    frame: ValueId,
    params: Vec<ValueId>,
    reject: super::BlockId,
    settled: super::BlockId,
) -> super::Block {
    let held = build.get(
        frame,
        FIELD_AWAITED,
        HirType::Managed(ManagedType::Promise(Box::new(HirType::Void))),
    );
    let rejected = build.push(
        OpKind::Call {
            callee: super::Callee::External("nts_promise_is_rejected".to_owned()),
            args: vec![held],
            frame: None,
        },
        HirType::Bool,
    );
    super::Block {
        params,
        ops: std::mem::take(&mut build.ops),
        terminator: Terminator::Branch {
            cond: rejected,
            then_target: reject,
            then_args: Vec::new(),
            else_target: settled,
            else_args: Vec::new(),
        },
    }
}

/// The one block every resumption's rejection goes to.
///
/// Shared rather than one per suspension because it needs nothing from the
/// suspension: the awaited promise is a frame field, so this reads whichever
/// one this resumption was waiting on. With no `try`/`catch` across an `await`,
/// rejecting this function's own promise is the whole of what a rejection can
/// do.
/// The shared rejection exit.
///
/// It reads the awaited promise out of the frame rather than taking it as a
/// parameter, so every resumption can share one block: the field holds
/// whichever promise this resumption was waiting on.
fn rejection_exit(build: &mut Build, frame: ValueId) -> super::Block {
    let promise = HirType::Managed(ManagedType::Promise(Box::new(HirType::Void)));
    let result = build.get(frame, FIELD_RESULT, promise.clone());
    let held = build.get(frame, FIELD_AWAITED, promise);
    build.push(
        OpKind::Call {
            callee: super::Callee::External("nts_promise_reject_with".to_owned()),
            args: vec![result, held],
            frame: None,
        },
        HirType::Void,
    );
    super::Block {
        params: Vec::new(),
        ops: std::mem::take(&mut build.ops),
        terminator: Terminator::Return(None),
    }
}

fn read_settled(
    build: &mut Build,
    frame: ValueId,
    awaited: ValueId,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
) {
    let held = build.get(
        frame,
        FIELD_AWAITED,
        HirType::Managed(ManagedType::Promise(Box::new(HirType::Void))),
    );
    let payload = build.values[awaited.0 as usize].ty.clone();
    // Three cases, not two. A promise that settled with *nothing* has neither
    // slot filled and both readers assert, so `await` of a `Promise<void>`
    // aborted at run time until this had an arm of its own.
    let payload = match &payload {
        // Settled with nothing. There is no value to read and nothing that can
        // reference one, so the `await` leaves no operation behind at all --
        // emitting a `void`-typed assignment gave the backend a variable it
        // never declared.
        HirType::Void => return,
        payload => payload,
    };
    let reader = if matches!(payload, HirType::Managed(_)) {
        "nts_promise_reference"
    } else {
        "nts_promise_number"
    };
    let value = build.push(
        OpKind::Call {
            callee: super::Callee::External(reader.to_owned()),
            args: vec![held],
            frame: None,
        },
        payload.clone(),
    );
    build.values[awaited.0 as usize].kind = OpKind::Convert(value);
    build.ops.push(awaited);
    if let Some(slot) = slot_of.get(&awaited).copied() {
        build.set(frame, slot, awaited);
    }
}

/// A terminator with every spilled operand read back out of the frame.
///
/// The loads land in the block the terminator ends, so they are ordinary
/// operations that dominate their use the way any other does.
fn reload_terminator(
    build: &mut Build,
    frame: ValueId,
    slot_of: &rustc_hash::FxHashMap<ValueId, u32>,
    terminator: Terminator,
) -> Terminator {
    let mut loaded: rustc_hash::FxHashMap<ValueId, ValueId> = rustc_hash::FxHashMap::default();
    for operand in super::operands_of_terminator(&terminator) {
        if slot_of.contains_key(&operand) && !loaded.contains_key(&operand) {
            let value = reload(build, frame, slot_of, operand);
            loaded.insert(operand, value);
        }
    }
    let swap = |value: ValueId| loaded.get(&value).copied().unwrap_or(value);
    match terminator {
        Terminator::Return(value) => Terminator::Return(value.map(swap)),
        Terminator::Jump { target, args } => Terminator::Jump {
            target,
            args: args.into_iter().map(swap).collect(),
        },
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => Terminator::Branch {
            cond: swap(cond),
            then_target,
            then_args: then_args.into_iter().map(swap).collect(),
            else_target,
            else_args: else_args.into_iter().map(swap).collect(),
        },
        Terminator::Unreachable => Terminator::Unreachable,
        Terminator::FellThrough => Terminator::FellThrough,
    }
}

/// A terminator with its targets moved to the segment each block begins at, and
/// its operands shifted.
fn retarget(
    terminator: &Terminator,
    starts: &[u32],
    shift: impl Fn(ValueId) -> ValueId,
) -> Terminator {
    let target = |block: super::BlockId| super::BlockId(starts[block.0 as usize]);
    match terminator {
        // The resume function returns nothing: what the original handed back is
        // in the frame, and there is nobody left to hand it to.
        Terminator::Return(_) => Terminator::Return(None),
        Terminator::Jump { target: to, args } => Terminator::Jump {
            target: target(*to),
            args: args.iter().map(|value| shift(*value)).collect(),
        },
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => Terminator::Branch {
            cond: shift(*cond),
            then_target: target(*then_target),
            then_args: then_args.iter().map(|value| shift(*value)).collect(),
            else_target: target(*else_target),
            else_args: else_args.iter().map(|value| shift(*value)).collect(),
        },
        Terminator::Unreachable => Terminator::Unreachable,
        Terminator::FellThrough => Terminator::FellThrough,
    }
}

/// The blocks a resumption enters first: which state is this, and where does it
/// go?
///
/// A chain of comparisons, because the IR's only multi-way terminator is a
/// two-way branch. One test per state, then a block nothing reaches so the last
/// test has somewhere to send a state that cannot happen.
fn dispatch_chain(
    build: &mut Build,
    frame: ValueId,
    resume_at: &[super::BlockId],
) -> Vec<super::Block> {
    let state = build.get(
        frame,
        FIELD_STATE,
        HirType::Int {
            bits: 32,
            signed: true,
        },
    );
    let mut blocks = Vec::new();
    for (which, target) in resume_at.iter().enumerate() {
        let marker = build.constant(i64::try_from(which).unwrap_or(0));
        let same = build.push(
            OpKind::Binary {
                op: super::BinOp::Eq,
                lhs: state,
                rhs: marker,
            },
            HirType::Bool,
        );
        blocks.push(super::Block {
            params: Vec::new(),
            ops: std::mem::take(&mut build.ops),
            terminator: Terminator::Branch {
                cond: same,
                then_target: *target,
                then_args: Vec::new(),
                else_target: super::BlockId(u32::try_from(which + 1).unwrap_or(0)),
                else_args: Vec::new(),
            },
        });
    }
    blocks.push(super::Block {
        params: Vec::new(),
        ops: Vec::new(),
        terminator: Terminator::Unreachable,
    });
    blocks
}
