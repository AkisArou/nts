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
//! under `Memory::ReferenceCounting`, so this lane never sees it -- and it
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
//! A builder is a different object from what it replaces, and the
//! substitution is invisible only while nothing observes the builder itself.
//! Every use of a member is one of three things ([`Use`]):
//!
//! - it **consumes** the builder: appends to it (the left operand of a
//!   concatenation in the class), returns it, or hands it across an edge to a
//!   parameter in the class;
//! - it **measures** it: `.length`, which `StringBuilder.length()` answers in
//!   UTF-16 units, as JavaScript does;
//! - or it **materialises** it: any other read -- an argument, a field store,
//!   an erase, a comparison, the right operand of another concatenation --
//!   sees the `String` a `toString` makes there (`Emitter::load`), so a
//!   builder never escapes its function, whatever reads it.
//!
//! The reads below are for a class that **accumulates** ([`accumulating`]):
//! one of its appends can run again before a seed -- a literal in the class,
//! where the builder is constructed -- makes a fresh one. That is the
//! quadratic. A straight line keeps record 0166's rule: held only where
//! nothing but appends, edges and its return use it. As a builder a straight
//! line saves copies in proportion to its appends -- `json-stringify-typed`'s
//! `serializeRow` makes twenty, and as concatenations the row allocated 80%
//! more -- and it costs a `toString` and bytecode, which a two-piece error
//! message on a cold path does not repay: given the reads, `awfy-queens` held
//! one in each of its hot accessors. Which straight lines a builder pays for
//! is a question of its own, and an exact-size concatenation is its likely
//! answer.
//!
//! Three rules keep that invisible, and linear:
//!
//! 1. **One consumer** ([`shared`]): every consumer of a member is its last
//!    use, by core's liveness. A member consumed twice, or read after it was
//!    consumed, would show the second use the first's characters.
//! 2. **One materialisation a lifetime** ([`repeated`]): a `toString` copies the
//!    whole accumulator, so one inside a loop that keeps the same builder
//!    copies it every iteration and reintroduces the quadratic this pass exists
//!    to remove. Every builder starts at a literal seed, so a materialisation
//!    is allowed only where every way back to it runs one of its class's
//!    seeds. A return needs no rule: it runs once a call.
//! 3. **No prepend**: `out = piece + out` reads the accumulator as the right
//!    operand of its own class's concatenation, which a builder does not make
//!    linear.
//!
//! Record 0166 held only an accumulator whose one other use was the return;
//! `json-build-append` and `json-serialize` build a fresh one per round and
//! read its `.length`, which that version refused.
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
    // Classes something is appended to: the candidates.
    let mut appended: FxHashSet<u32> = FxHashSet::default();

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
                appended.insert(root);
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

    let roots: Vec<u32> = (0..count)
        .map(|at| classes.find(u32::try_from(at).unwrap_or(0)))
        .collect();

    // Rule 3: a prepend reads the accumulator as the right operand of its own
    // class's concatenation.
    for (at, op) in func.values.iter().enumerate() {
        if let OpKind::Binary {
            op: BinOp::Concat,
            rhs,
            ..
        } = &op.kind
            && string(*rhs)
            && roots[rhs.0 as usize] == roots[at]
        {
            refused.insert(roots[at]);
        }
    }

    // Worth a builder, then rules 1 and 2, over the classes still standing.
    let uses = uses(func, &string);
    let seeds = seeds(func, &roots);
    let accumulating = accumulating(func, &uses, &roots, &seeds, &|root| {
        appended.contains(&root) && !refused.contains(&root)
    });
    // A straight line is held only if nothing reads it but its return.
    for (value, sites) in &uses {
        let root = roots[value.0 as usize];
        if !accumulating.contains(&root) && sites.iter().any(|site| site.does != Use::Consumes) {
            refused.insert(root);
        }
    }
    let broken: Vec<ValueId> = {
        let member = |value: ValueId| {
            let root = roots[value.0 as usize];
            appended.contains(&root) && !refused.contains(&root)
        };
        shared(func, &uses, &member)
            .into_iter()
            .chain(repeated(func, &uses, &member, &roots, &seeds))
            .collect()
    };
    for value in broken {
        refused.insert(roots[value.0 as usize]);
    }

    let mut keep = FxHashSet::default();
    for (at, op) in func.values.iter().enumerate() {
        let root = roots[at];
        if matches!(op.ty, HirType::Managed(ManagedType::String))
            && appended.contains(&root)
            && !refused.contains(&root)
        {
            keep.insert(ValueId(u32::try_from(at).unwrap_or(0)));
        }
    }
    keep
}

/// What a use does with the builder it reads; see the module note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Use {
    /// Appended to, returned, or handed across an edge: the builder moves on.
    Consumes,
    /// `.length`, which the builder answers and leaves as it was.
    Measures,
    /// Anything else, which sees the `String` a `toString` makes there.
    Materialises,
}

/// One use of a string value, and where it is.
struct Site {
    block: usize,
    /// Its place in the block: an op's index, or the block's length for the
    /// terminator, which runs after every op.
    at: usize,
    does: Use,
    /// The blocks a terminator hands the value to, for a consumer that is an
    /// edge; empty otherwise.
    onward: Vec<BlockId>,
}

/// Every use of every string value, by block and place.
fn uses(func: &Func, string: &impl Fn(ValueId) -> bool) -> FxHashMap<ValueId, Vec<Site>> {
    let mut uses: FxHashMap<ValueId, Vec<Site>> = FxHashMap::default();
    for (index, block) in func.blocks.iter().enumerate() {
        let mut note = |value: ValueId, at: usize, does: Use, onward: Vec<BlockId>| {
            if string(value) {
                uses.entry(value).or_default().push(Site {
                    block: index,
                    at,
                    does,
                    onward,
                });
            }
        };
        for (at, op) in block.ops.iter().enumerate() {
            match &func.values[op.0 as usize].kind {
                OpKind::Binary {
                    op: BinOp::Concat,
                    lhs,
                    rhs,
                } => {
                    note(*lhs, at, Use::Consumes, Vec::new());
                    note(*rhs, at, Use::Materialises, Vec::new());
                }
                OpKind::Length(of) => note(*of, at, Use::Measures, Vec::new()),
                other => {
                    for operand in operands_of(other) {
                        note(operand, at, Use::Materialises, Vec::new());
                    }
                }
            }
        }

        // A terminator hands a value on once however many of its edges carry
        // it, because only one of them runs. One edge handing it to two
        // parameters makes two names for one builder: two consumers.
        let end = block.ops.len();
        if let Terminator::Return(Some(value)) = &block.terminator {
            note(*value, end, Use::Consumes, Vec::new());
        }
        let mut handed: Vec<(ValueId, Vec<BlockId>)> = Vec::new();
        for (target, args) in outgoing(&block.terminator) {
            for (position, arg) in args.iter().enumerate() {
                if args[..position].contains(arg) {
                    note(*arg, end, Use::Consumes, vec![target]);
                }
                match handed.iter_mut().find(|(value, _)| value == arg) {
                    Some((_, targets)) if !targets.contains(&target) => targets.push(target),
                    Some(_) => {}
                    None => handed.push((*arg, vec![target])),
                }
            }
        }
        for (value, onward) in handed {
            note(value, end, Use::Consumes, onward);
        }
    }
    uses
}

/// Rule 1: members whose builder one consumer would let another use see.
///
/// A builder appends in place, so it stands in for a string only while every
/// consumer of a member is that member's **last use**: nothing reads it after
/// it was appended to, returned or handed on, until its definition runs again.
/// Two consumers one run can reach in turn share one builder, and the second
/// sees the first's characters: `a = s + "x"; b = s + "y"` answered `twice(0)`
/// "xyz" where node answers "xz", and `more = out + "!"; return out` answered
/// `after(4)` "aa!" where node answers "aa"
/// (tests/programs/a-string-accumulator-appended-twice). A `.length` or a
/// `toString` after an append is the same mistake, read rather than written.
///
/// **Counting consumers cannot say this, in either direction.** A loop's
/// header parameter is consumed by the body's append and by the exit edge, and
/// only one of them runs per arrival, so a count refuses every accumulator;
/// one append inside a loop that does not redefine its operand is one consumer
/// that runs once an iteration, so a count admits it. Liveness says both:
/// core's (`liveness::analyze`, the analysis reference counting releases by),
/// asked after each consumer -- the rest of its block, then `live_out` after
/// an op, or the `live_in` of each target an edge hands the member to. Where
/// that analysis keeps a value live longer than its reads (a frame object's
/// names, a counted handle's views), this refuses more, never less.
fn shared(
    func: &Func,
    uses: &FxHashMap<ValueId, Vec<Site>>,
    member: &impl Fn(ValueId) -> bool,
) -> Vec<ValueId> {
    if !uses.keys().any(|value| member(*value)) {
        return Vec::new();
    }
    let live = nts_core::hir::liveness::analyze(func);

    let mut shared = Vec::new();
    for (value, sites) in uses {
        if !member(*value) {
            continue;
        }
        let conflicts = sites
            .iter()
            .enumerate()
            .filter(|(_, site)| site.does == Use::Consumes)
            .any(|(index, consumer)| {
                let later = sites.iter().enumerate().any(|(other, next)| {
                    other != index && next.block == consumer.block && next.at >= consumer.at
                });
                let block = BlockId(u32::try_from(consumer.block).unwrap_or(u32::MAX));
                let beyond = if consumer.at == func.blocks[consumer.block].ops.len() {
                    consumer
                        .onward
                        .iter()
                        .any(|target| live.live_in(*target).contains(value))
                } else {
                    live.live_out(block).contains(value)
                };
                later || beyond
            });
        if conflicts {
            shared.push(*value);
        }
    }
    shared
}

/// Rule 2: members materialised more than once in one builder's lifetime.
///
/// A `toString` copies the whole accumulator, so one that runs again on the
/// same builder after more appends is the quadratic this pass removes, put
/// back one copy at a time. A builder's lifetime starts at a seed -- a literal
/// in its class, where `string_operation` constructs one -- so a
/// materialisation is allowed only where every way back to it runs one of its
/// class's seeds. That is what lets `json-build-append` keep a builder: its
/// accumulator is seeded fresh each round, and read once a round, after the
/// appends.
///
/// This is the plan's first statement of the rule ("no loop containing the use
/// carries the class through its header") said without dominators: a loop
/// carries the builder round exactly when some way round it misses every seed.
fn repeated(
    func: &Func,
    uses: &FxHashMap<ValueId, Vec<Site>>,
    member: &impl Fn(ValueId) -> bool,
    roots: &[u32],
    seeds: &Seeds,
) -> Vec<ValueId> {
    let unseeded = FxHashSet::default();
    let mut repeated = Vec::new();
    for (value, sites) in uses {
        if !member(*value) {
            continue;
        }
        let seeded = seeds.get(&roots[value.0 as usize]).unwrap_or(&unseeded);
        if sites
            .iter()
            .any(|site| site.does == Use::Materialises && runs_again(func, site.block, seeded))
        {
            repeated.push(*value);
        }
    }
    repeated
}

/// Each class's seeds: the blocks holding a literal in it, where
/// `string_operation` constructs a builder afresh.
type Seeds = FxHashMap<u32, FxHashSet<usize>>;

fn seeds(func: &Func, roots: &[u32]) -> Seeds {
    let mut seeds = Seeds::default();
    for (index, block) in func.blocks.iter().enumerate() {
        for op in &block.ops {
            if matches!(func.values[op.0 as usize].kind, OpKind::ConstString(_)) {
                seeds.entry(roots[op.0 as usize]).or_default().insert(index);
            }
        }
    }
    seeds
}

/// Whether a block can run again before its class's builder is made afresh:
/// some way from it back to itself misses every one of the class's seeds.
fn runs_again(func: &Func, block: usize, seeded: &FxHashSet<usize>) -> bool {
    let onward = func.blocks[block].terminator.successors();
    reach(func, &onward, |at| seeded.contains(&at))[block]
}

/// The classes that accumulate: an append can run again in one builder's
/// lifetime. See the module note for what a class that does not may be.
fn accumulating(
    func: &Func,
    uses: &FxHashMap<ValueId, Vec<Site>>,
    roots: &[u32],
    seeds: &Seeds,
    candidate: &impl Fn(u32) -> bool,
) -> FxHashSet<u32> {
    let unseeded = FxHashSet::default();
    let mut accumulating = FxHashSet::default();
    for (value, sites) in uses {
        let root = roots[value.0 as usize];
        if accumulating.contains(&root) || !candidate(root) {
            continue;
        }
        let seeded = seeds.get(&root).unwrap_or(&unseeded);
        let appends_again = sites.iter().any(|site| {
            site.does == Use::Consumes
                && site.at < func.blocks[site.block].ops.len()
                && runs_again(func, site.block, seeded)
        });
        if appends_again {
            accumulating.insert(root);
        }
    }
    accumulating
}

/// The blocks control can reach from `from` without entering one `stop` names.
///
/// Rule 2's question alone; rule 1's is liveness, which core answers. Core's
/// own walks (`loops::in_a_cycle`, `verify::reachable_blocks`) ask about every
/// path, and this asks about the paths that miss a set of blocks.
fn reach(func: &Func, from: &[BlockId], stop: impl Fn(usize) -> bool) -> Vec<bool> {
    let mut seen = vec![false; func.blocks.len()];
    let mut stack = from.to_vec();
    while let Some(block) = stack.pop() {
        let index = block.0 as usize;
        if stop(index) || seen[index] {
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
