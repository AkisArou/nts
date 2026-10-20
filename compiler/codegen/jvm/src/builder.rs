//! String accumulators this target holds as a `StringBuilder`.
//!
//! # The measurement this exists for
//!
//! `benchmarks/cases/node-utf8` runs node's own UTF-8 decoder, which builds its
//! answer with `out += ...` at seven sites in a loop. Record 0166:
//!
//! ```text
//! node-utf8   ours 784,888 B/op   java 65,568 B/op   11.97x
//! node-utf8   ours    91.71 us    java    8.14 us    11.27x
//! ```
//!
//! The allocation ratio and the time ratio agree to six percent, which is as
//! close to a cause as that instrument gets. `String.concat` allocates a
//! `byte[]` of both lengths and copies both, so an accumulator built one piece
//! at a time is quadratic in its own length.
//!
//! # Why the reference is not the thing to correct
//!
//! The Java reference uses a `StringBuilder`, which is O(n), and it is **right**
//! to: `+=` in a loop is the thing Java programmers are taught not to write.
//! Nor is the row unfair for that. A JavaScript `+=` is a rope and V8 makes it
//! O(n) as well, so the program is linear in the language it is written in and
//! this lane's lowering is what makes it quadratic. The reference and the oracle
//! agree; only we disagree.
//!
//! # What the C lane does instead, and why it does not transfer
//!
//! `hir::rc` rewrites a `Concat` whose left operand is counted, owned,
//! unborrowed and dead at that point into `nts_str_append`, which appends in
//! place when the runtime count says the string is unique. That pass runs only
//! under `Provider::ReferenceCounting`, so this lane never sees it -- and it
//! could not use it if it did, because the mechanism is a mutable string and
//! `java.lang.String` is immutable.
//!
//! The JVM plan drew the wrong conclusion from that:
//!
//! > `Call { frame: Some(n) }` has no analogue (`java.lang.String` is
//! > immutable, there is no fill-this-storage form), so the `_into` placement
//! > price is C-specific.
//!
//! True about `String`. It does not follow, because the accumulate pattern does
//! not need a mutable string: it needs a builder and one materialisation at the
//! end. Immutability rules out the C lane's *mechanism*, not the optimisation.
//!
//! # What this pass may not assume
//!
//! A builder is a different object from what it replaces and the only thing
//! that makes the substitution invisible is that nothing observes the
//! accumulator between appends. So a class survives only if **every** use of
//! **every** member is either the left operand of a concatenation inside the
//! same class or the function's return -- and the return is the one
//! materialisation this version allows.
//!
//! Requiring a return rather than counting materialisation points is the
//! conservative half. A single read anywhere else would also be correct if it
//! ran once, and nothing here knows whether it does: a `toString` inside a loop
//! copies the accumulator every iteration and reintroduces exactly the quadratic
//! this pass exists to remove. A return runs once per call by construction,
//! which is a proof rather than a guess, and it is the shape the row has.
//!
//! Values are joined into classes by block-parameter edges, for the reason
//! `unbox` joins them, and by the concatenation itself: `out = out + piece`
//! names one storage location twice and deciding the halves separately would
//! let a header hold a builder while a back edge hands it a string.

use nts_codegen_common::destruct::outgoing;
use nts_core::hir::{
    BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId, operands_of,
};
use rustc_hash::{FxHashMap, FxHashSet};

/// Disjoint sets over `ValueId`, by index.
struct Classes {
    parent: Vec<u32>,
}

impl Classes {
    fn new(count: usize) -> Self {
        Self {
            parent: (0..u32::try_from(count).unwrap_or(u32::MAX)).collect(),
        }
    }

    fn find(&mut self, at: u32) -> u32 {
        let mut root = at;
        while self.parent[root as usize] != root {
            root = self.parent[root as usize];
        }
        let mut walk = at;
        while self.parent[walk as usize] != root {
            let next = self.parent[walk as usize];
            self.parent[walk as usize] = root;
            walk = next;
        }
        root
    }

    fn union(&mut self, a: u32, b: u32) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.parent[b as usize] = a;
        }
    }
}

/// The verification type an accumulator is held as.
///
/// Split out so `body::Emitter::new` reads one call rather than a branch, for
/// the reason `unbox::held_as` is.
#[must_use]
pub(crate) fn held_as(
    accumulated: &FxHashSet<ValueId>,
    value: ValueId,
) -> Option<nts_jvm_emitter::VType> {
    accumulated
        .contains(&value)
        .then(|| nts_jvm_emitter::VType::Object(BUILDER.to_owned()))
}

/// The class a string accumulator is held in.
pub(crate) const BUILDER: &str = "java/lang/StringBuilder";

/// Values that are one storage location, for the reasons the module note
/// gives.
fn locations(func: &Func) -> Classes {
    let mut classes = Classes::new(func.values.len());

    // A block parameter and every argument that reaches it are one location.
    for block in &func.blocks {
        for (target, args) in outgoing(&block.terminator) {
            let Some(params) = func.blocks.get(target.0 as usize).map(|it| &it.params) else {
                continue;
            };
            for (param, arg) in params.iter().zip(&args) {
                classes.union(param.0, arg.0);
            }
        }
    }

    // `out = out + piece` is one location written twice.
    for (at, op) in func.values.iter().enumerate() {
        if let OpKind::Binary {
            op: BinOp::Concat,
            lhs,
            ..
        } = &op.kind
        {
            classes.union(u32::try_from(at).unwrap_or(0), lhs.0);
        }
    }
    classes
}

/// String values this backend can hold as a `StringBuilder`.
#[must_use]
pub(crate) fn accumulators(func: &Func) -> FxHashSet<ValueId> {
    let count = func.values.len();
    let mut classes = locations(func);

    let string = |value: ValueId| {
        matches!(
            func.values.get(value.0 as usize).map(|it| &it.ty),
            Some(HirType::Managed(ManagedType::String))
        )
    };

    let mut refused: FxHashSet<u32> = FxHashSet::default();
    // A class is only worth anything if something in it accumulates.
    let mut accumulating: FxHashSet<u32> = FxHashSet::default();

    for (at, op) in func.values.iter().enumerate() {
        let value = ValueId(u32::try_from(at).unwrap_or(0));
        let root = classes.find(value.0);
        if !string(value) {
            // A non-string joined to a string by an edge means the two
            // disagree about representation, which nothing here can fix.
            if root != value.0 {
                refused.insert(root);
            }
            continue;
        }
        match &op.kind {
            OpKind::Binary {
                op: BinOp::Concat,
                lhs,
                ..
            } if classes.find(lhs.0) == root => {
                accumulating.insert(root);
            }
            // A block parameter arrives on an edge and its arguments carry
            // the obligation; a literal is the seed the accumulation starts
            // from, and `string_operation` constructs the builder there.
            // Neither is a definition this has to refuse.
            OpKind::BlockParam(_) | OpKind::ConstString(_) => {}
            _ => {
                refused.insert(root);
            }
        }
    }

    // Uses. Anything not listed here observes the accumulator, and an observed
    // accumulator has to be a `String` -- which is the right default for a
    // representation change.
    for op in &func.values {
        match &op.kind {
            // The left operand is the accumulator itself and is not a read of
            // it; the right operand is appended and is an ordinary use.
            OpKind::Binary {
                op: BinOp::Concat,
                lhs,
                rhs,
            } => {
                if string(*rhs) {
                    refused.insert(classes.find(rhs.0));
                }
                let _ = lhs;
            }
            other => {
                for operand in operands_of(other) {
                    if string(operand) {
                        refused.insert(classes.find(operand.0));
                    }
                }
            }
        }
    }

    // A terminator's operands leave the function or cross an edge. Edges are
    // already joined, and a return is the one materialisation allowed -- see
    // the note above for why it is a return rather than a count.
    for block in &func.blocks {
        match &block.terminator {
            Terminator::Return(_) => {}
            other => {
                for value in nts_core::hir::operands_of_terminator(other) {
                    if string(value) {
                        // Joined already where it is an edge argument; anything
                        // else leaves the function by a route this cannot see.
                        if !matches!(other, Terminator::Jump { .. } | Terminator::Branch { .. }) {
                            refused.insert(classes.find(value.0));
                        }
                    }
                }
            }
        }
    }

    // Linearity, which everything above assumes: see `reconsumed`.
    let roots: Vec<u32> = (0..count)
        .map(|at| classes.find(u32::try_from(at).unwrap_or(0)))
        .collect();
    let shared = {
        let member = |value: ValueId| {
            let root = roots[value.0 as usize];
            accumulating.contains(&root) && !refused.contains(&root)
        };
        reconsumed(func, &member)
    };
    for value in shared {
        refused.insert(roots[value.0 as usize]);
    }

    let mut keep = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        let value = ValueId(u32::try_from(at).unwrap_or(0));
        let root = classes.find(value.0);
        if matches!(op.ty, HirType::Managed(ManagedType::String))
            && accumulating.contains(&root)
            && !refused.contains(&root)
        {
            keep.insert(value);
        }
    }
    keep
}

/// Where a member is consumed: an append to it, or a terminator that returns
/// it or hands it across an edge.
struct Consumer {
    block: usize,
    /// Its place in the block: an op's index, or the block's length for the
    /// terminator, which runs after every op.
    at: usize,
    /// Where control goes once it has run: the block's successors after an
    /// op, the edges that carry the member after a terminator.
    onward: Vec<BlockId>,
}

/// Members whose builder one consumer would let another see.
///
/// # Linearity
///
/// A builder appends in place, so it stands in for a string only while each
/// member is *consumed* -- appended to, returned, or handed across an edge --
/// once between its definition running and running again. Two consumers one
/// run can reach in turn share one builder, and the second sees the first's
/// characters: `a = s + "x"; b = s + "y"` answered `twice(0)` "xyz" where node
/// answers "xz", and `more = out + "!"; return out` answered `after(4)` "aa!"
/// where node answers "aa" (tests/programs/a-string-accumulator-appended-twice).
///
/// **Counting consumers cannot say this, in either direction.** A loop's
/// header parameter is consumed by the body's append and by the exit edge, and
/// only one of them runs per arrival, so a count refuses every accumulator;
/// one append inside a loop that does not redefine its operand is one consumer
/// that runs once an iteration, so a count admits it. What decides it is
/// reachability: a consumer conflicts with one it can reach, or with itself,
/// along a path that does not run the definition again. The walk stops at the
/// defining block, because arriving there makes a new value.
fn reconsumed(func: &Func, member: &impl Fn(ValueId) -> bool) -> Vec<ValueId> {
    let mut defined_in = vec![usize::MAX; func.values.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        for value in block.params.iter().chain(&block.ops) {
            defined_in[value.0 as usize] = index;
        }
    }

    let mut consumers: FxHashMap<ValueId, Vec<Consumer>> = FxHashMap::default();
    let mut shared = FxHashSet::default();
    for (index, block) in func.blocks.iter().enumerate() {
        for (at, op) in block.ops.iter().enumerate() {
            if let OpKind::Binary {
                op: BinOp::Concat,
                lhs,
                ..
            } = &func.values[op.0 as usize].kind
                && member(*lhs)
            {
                consumers.entry(*lhs).or_default().push(Consumer {
                    block: index,
                    at,
                    onward: block.terminator.successors(),
                });
            }
        }
        let mut handed: Vec<(ValueId, Vec<BlockId>)> = Vec::new();
        if let Terminator::Return(Some(value)) = &block.terminator
            && member(*value)
        {
            handed.push((*value, Vec::new()));
        }
        for (target, args) in outgoing(&block.terminator) {
            for (position, arg) in args.iter().enumerate() {
                if !member(*arg) {
                    continue;
                }
                // One edge handing a member to two parameters makes two
                // names for one builder.
                if args[..position].contains(arg) {
                    shared.insert(*arg);
                }
                match handed.iter_mut().find(|(value, _)| value == arg) {
                    Some((_, targets)) => targets.push(target),
                    None => handed.push((*arg, vec![target])),
                }
            }
        }
        for (value, onward) in handed {
            consumers.entry(value).or_default().push(Consumer {
                block: index,
                at: block.ops.len(),
                onward,
            });
        }
    }

    for (value, uses) in &consumers {
        let barrier = defined_in[value.0 as usize];
        for (index, consumer) in uses.iter().enumerate() {
            let reached = reach(func, &consumer.onward, barrier);
            let conflicts = reached[consumer.block]
                || uses.iter().enumerate().any(|(other, next)| {
                    other != index
                        && ((next.block == consumer.block && next.at > consumer.at)
                            || reached[next.block])
                });
            if conflicts {
                shared.insert(*value);
                break;
            }
        }
    }
    let mut shared: Vec<ValueId> = shared.into_iter().collect();
    shared.sort_unstable_by_key(|value| value.0);
    shared
}

/// The blocks control can reach from `from` without entering `barrier`.
fn reach(func: &Func, from: &[BlockId], barrier: usize) -> Vec<bool> {
    let mut seen = vec![false; func.blocks.len()];
    let mut stack = from.to_vec();
    while let Some(block) = stack.pop() {
        let index = block.0 as usize;
        if index == barrier || seen[index] {
            continue;
        }
        seen[index] = true;
        stack.extend(func.blocks[index].terminator.successors());
    }
    seen
}

/// `out += String.fromCharCode(c)` where `out` is a builder: the one-character
/// string that `appendCharCode` makes unnecessary.
///
/// # This set exists so that two places cannot disagree
///
/// `ops` decided this at emission time and `block` did not know, so the call
/// was emitted *and* the fused append was emitted -- the string was built,
/// stored to a slot and never read:
///
/// ```text
/// 321: invokestatic  NtsRuntime.stringFromCharCode:(D)Ljava/lang/String;
/// 324: astore        27
/// 326: aload         9
/// 328: dload         21
/// 330: invokestatic  NtsRuntime.appendCharCode:(...)
/// ```
///
/// **C2 deletes the dead allocation, so on `HotSpot` the fusion measured as a
/// saving it was not making.** ART does not, and `node-utf8` allocates two
/// objects per character for it -- a `String` and its backing array, 15,366 an
/// operation at 23 bytes. That is the goal's premise exactly: "C2 handles it,
/// therefore it is free" was the whole of the original measurement.
///
/// So `ops` asks this set rather than re-deriving the condition, and `block`
/// asks the same one.
#[must_use]
pub(crate) fn char_code_appends(
    func: &Func,
    uses: &[u32],
    accumulated: &FxHashSet<ValueId>,
) -> FxHashSet<ValueId> {
    let mut fused = FxHashSet::default();
    for op in &func.values {
        let OpKind::Binary {
            op: BinOp::Concat,
            lhs,
            rhs,
        } = &op.kind
        else {
            continue;
        };
        if !accumulated.contains(lhs) || uses.get(rhs.0 as usize).copied() != Some(1) {
            continue;
        }
        let Some(source) = func.values.get(rhs.0 as usize) else {
            continue;
        };
        if let OpKind::Call {
            callee: Callee::External(name),
            args,
            ..
        } = &source.kind
            && name == "nts_string_from_char_code"
            && args.len() == 1
        {
            fused.insert(*rhs);
        }
    }
    fused
}
