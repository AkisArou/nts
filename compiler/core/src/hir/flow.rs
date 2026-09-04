//! Propagating [`Facts`] through a function.
//!
//! # Why this is short
//!
//! Classic range analysis threads an environment keyed by *variable* through
//! the program, because in a tree-shaped IR a variable's value depends on where
//! you are standing. In SSA it does not: a value is assigned once, so the set of
//! numbers it may hold is decided at its definition and is the same everywhere
//! it is readable.
//!
//! What is left is the part SSA does not solve. Two of them:
//!
//! - **Block parameters** genuinely differ by edge, and their facts are the join
//!   of the arguments each predecessor passes.
//! - **Guards** tell you more than a definition does. `i` defined as `0` and
//!   incremented in a loop is unbounded from its definitions alone; it is the
//!   `i < n` on the loop header that bounds it. That information belongs to an
//!   *edge*, not to a value, which is the one thing SSA does not already carry.
//!
//! So the environment here exists only to hold what an edge refined, and
//! everything else is read from the value's own fact.

// Exact float comparison, for the same reason as in `facts`: these are questions
// about which IEEE value a bound *is*, not about whether two measurements are
// close. See the note there.
#![allow(clippy::float_cmp)]

use rustc_hash::FxHashMap;

use super::facts::{self, Facts};
use super::{BinOp, BlockId, Callee, Func, OpKind, Terminator, UnOp, ValueId};

/// Rounds before a loop header stops trying for precision and widens.
///
/// A counter's bound grows by one per round, so a loop that runs a million
/// times would need a million rounds. Three is enough to see that a bound is
/// still moving without giving up on one that was going to settle.
const WIDEN_AFTER: u32 = 3;

/// A hard bound on the whole fixpoint, in case a lattice mistake makes some
/// value oscillate rather than converge. Thresholds converge far earlier;
/// reaching this means a bug, and looping forever would hide it.
const ROUND_CAP: u32 = 64;

/// Blocks a back edge returns to.
///
/// The only places a value can grow without bound, and therefore the only
/// places widening belongs. Applying it anywhere else destroys information
/// rather than forcing convergence: a loop *body* holds values a guard just
/// narrowed, and widening those throws the guard away.
fn loop_headers(func: &Func) -> rustc_hash::FxHashSet<BlockId> {
    const UNVISITED: u8 = 0;
    const ON_STACK: u8 = 1;
    const DONE: u8 = 2;

    let mut headers = rustc_hash::FxHashSet::default();
    let mut state = vec![UNVISITED; func.blocks.len()];
    let mut stack = vec![(BlockId(0), 0_usize)];
    state[0] = ON_STACK;

    // An edge to a block already on the search stack is a back edge, and its
    // target is a loop header. Iterative rather than recursive: a deeply nested
    // function should not decide how much stack the compiler needs.
    while let Some(&mut (block, ref mut next)) = stack.last_mut() {
        let successors = func.blocks[block.0 as usize].terminator.successors();
        let Some(successor) = successors.get(*next).copied() else {
            state[block.0 as usize] = DONE;
            stack.pop();
            continue;
        };
        *next += 1;
        match state[successor.0 as usize] {
            UNVISITED => {
                state[successor.0 as usize] = ON_STACK;
                stack.push((successor, 0));
            }
            ON_STACK => {
                headers.insert(successor);
            }
            _ => {}
        }
    }
    headers
}

/// What was proven about each value in one function.
#[derive(Debug, Clone)]
pub struct Analysis {
    /// Indexed by [`ValueId`]. The set of numbers the value may hold, anywhere
    /// it can be read.
    values: Vec<Facts>,
    /// Per block, pairs `(a, b)` where `a < b` is known to hold throughout.
    ///
    /// A deliberately thin slice of relational information on top of an
    /// interval domain, and it exists for one question intervals cannot answer:
    /// whether an index is inside an array whose length is unknown.
    /// `for (i = 0; i < xs.length; i++)` bounds `i` by a number the analysis has
    /// no value for — so no interval proves it, and the *identity* of the value
    /// that guards the loop is the whole of the proof.
    ///
    /// Only strict `<` is recorded, because that is what a bounds check needs.
    less_than: Vec<Vec<(ValueId, ValueId)>>,
    /// Per block, what a guard on the way in narrowed a value to.
    ///
    /// A value's own fact is the join over every path that reaches it, which is
    /// necessarily wider than what holds at any one of them. Inside
    /// `if (i < 5)`, `i` is `[0, 4]`; its definition only promises `[0, 5]`,
    /// because the value that leaves the loop is the one that failed the test.
    /// One is enough to prove an index in bounds and the other is not.
    refined: Vec<Refinements>,
    /// Whether any array in the program can change length. Carried here because
    /// every consumer of an analysis already holds one, and threading a
    /// whole-program flag beside it would mean two things to keep in step.
    growable: bool,
    /// How long the array each parameter points at can be, per slot.
    param_lengths: Vec<Facts>,
}

impl Analysis {
    /// Whether any array in the program can change length.
    #[must_use]
    pub fn growable(&self) -> bool {
        self.growable
    }

    /// How long the array a parameter points at can be. `TOP` where unknown,
    /// which proves nothing and is what an absent answer has to be.
    #[must_use]
    pub fn param_length(&self, slot: u32) -> Facts {
        self.param_lengths
            .get(slot as usize)
            .copied()
            .unwrap_or(Facts::TOP)
    }

    /// How many values were analyzed.
    #[must_use]
    pub fn len(&self) -> usize {
        self.values.len()
    }

    /// Whether the function had no values at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Whether a value is known to be less than some value the predicate
    /// accepts, everywhere in a block.
    ///
    /// Taking a predicate rather than a value because the caller is asking
    /// "less than *this array's* length", and which value that is depends on
    /// what the guard happened to compare against.
    #[must_use]
    pub fn guarded_by(
        &self,
        block: BlockId,
        value: ValueId,
        accept: impl Fn(ValueId) -> bool,
    ) -> bool {
        self.less_than
            .get(block.0 as usize)
            .is_some_and(|relations| {
                relations
                    .iter()
                    .any(|(lesser, greater)| *lesser == value && accept(*greater))
            })
    }

    /// What is known about a value *at a particular block*.
    ///
    /// Narrower than [`Self::get`] wherever a guard on the way in said more.
    #[must_use]
    pub fn get_at(&self, block: BlockId, value: ValueId) -> Facts {
        self.refined
            .get(block.0 as usize)
            .and_then(|refinements| refinements.get(&value).copied())
            .unwrap_or_else(|| self.get(value))
    }

    /// What is known about a value.
    #[must_use]
    pub fn get(&self, value: ValueId) -> Facts {
        self.values[value.0 as usize]
    }

    /// Whether a value is provably inside a range, whole or not.
    ///
    /// Weaker than [`Self::is_integral_within`] on purpose. Truncating `3.7` to
    /// `3` is exactly what `ToInt32` does, so a coercion only needs its operand
    /// to be *in range* — being an integer already is not required, and
    /// demanding it would refuse the ordinary case.
    #[must_use]
    pub fn is_within(&self, value: ValueId, lo: f64, hi: f64) -> bool {
        let facts = self.get(value);
        !facts.is_bottom() && !facts.maybe_nan && facts.lo >= lo && facts.hi <= hi
    }

    /// Whether a value is provably a whole number within a range, and therefore
    /// representable exactly as an integer.
    ///
    /// The three obligations together: not NaN, integral on every path, and
    /// inside the given bounds. `-0` refuses too — an integer slot cannot hold
    /// it, and `1 / -0` can tell that it was lost.
    #[must_use]
    pub fn is_integral_within(&self, value: ValueId, lo: f64, hi: f64) -> bool {
        self.integral_within(value, lo, hi, false)
    }

    /// The same, for a value whose zero's sign nothing can distinguish.
    ///
    /// `-0` and `0` are different doubles and the same integer, so a value that
    /// might be `-0` normally cannot be one. Where nothing downstream can tell
    /// the two apart — see [`super::zero_sign`] — the difference is not a
    /// difference, and refusing to represent it costs a great deal for nothing.
    #[must_use]
    pub fn is_integral_within_ignoring_zero_sign(&self, value: ValueId, lo: f64, hi: f64) -> bool {
        self.integral_within(value, lo, hi, true)
    }

    fn integral_within(&self, value: ValueId, lo: f64, hi: f64, any_zero: bool) -> bool {
        let facts = self.get(value);
        !facts.is_bottom()
            && facts.whole
            && !facts.maybe_nan
            && (any_zero || !facts.maybe_negative_zero)
            && facts.lo >= lo
            && facts.hi <= hi
    }
}

/// Values whose facts an edge refined, relative to their own definitions.
type Refinements = FxHashMap<ValueId, Facts>;

/// Pairs `(a, b)` for which `a < b` is known.
type Relations = Vec<(ValueId, ValueId)>;

/// What the rest of the program contributes to one function's analysis.
///
/// Empty means "assume nothing", which is what a function analyzed on its own
/// must do. Neither field can be inferred from inside the function: a parameter
/// is written by callers and a call's result by the callee.
#[derive(Debug, Default, Clone)]
pub struct Context {
    /// Facts for each parameter, overriding the declared type. Absent entries
    /// fall back to the declaration.
    pub params: Vec<Facts>,
    /// What each function returns, by name.
    pub returns: FxHashMap<String, Facts>,
    /// What a dispatch through each slot returns: the join over every
    /// implementation in it.
    ///
    /// Keyed by slot rather than by name because a dispatch has no single
    /// callee. Without it every virtual call and every closure call is a wall,
    /// and a wall in a loop is the difference between integer arithmetic and a
    /// double round trip per iteration.
    pub slot_returns: FxHashMap<u32, Facts>,
    /// What each `(layout, field)` can hold, from every store in the program.
    ///
    /// A field read is otherwise TOP, and a TOP in a loop that touches an
    /// object is a double round trip per iteration.
    pub field_facts: super::fields::FieldFacts,
    /// What each module-scope variable can hold, from every store in the
    /// program.
    ///
    /// A global read is otherwise TOP, and that TOP is worth more than it
    /// looks: `benches/cases/module-closures` reads one `let step` inside a
    /// loop body, and without this every operation after the read is floating
    /// point however narrow the slot is. Narrowing the storage alone moved that
    /// case 17.84us to 16.05us against C++'s 2.30us; the arithmetic was never
    /// waiting on the width.
    pub global_facts: super::globals::GlobalFacts,
    /// What each array type's elements can hold, from every store in the
    /// program. The same idea as [`Self::field_facts`] for the other kind of
    /// container. See [`super::elements`].
    pub element_facts: super::elements::ElementFacts,
    /// Interval bounds for loop-carried values, from counting iterations.
    ///
    /// The value domain cannot derive these: it knows what one round does, not
    /// how many rounds there are. See [`super::loops`].
    pub caps: FxHashMap<ValueId, Facts>,
    /// Whether any array in the program can change length.
    ///
    /// A whole-program answer, because the question is about what could happen
    /// to an array between its allocation and a read of its length -- and that
    /// is not a local question. See [`super::arrays_can_grow`].
    pub growable: bool,
    /// How long the array each parameter points at can be, per slot.
    ///
    /// The other way a reference arrives. A method reading `this.flags` has no
    /// allocation in front of it, and neither does one taking `flags` as an
    /// argument -- and the second is the shape of every function that is handed
    /// a buffer to work on.
    pub param_lengths: Vec<Facts>,
}

/// Compute what is provable about every value in a function, alone.
#[must_use]
pub fn analyze(func: &Func) -> Analysis {
    analyze_with(func, &Context::default())
}

/// Compute what is provable, given what the rest of the program contributes.
#[must_use]
pub fn analyze_with(func: &Func, context: &Context) -> Analysis {
    // Start at BOTTOM and grow. A value's fact only ever widens as more paths
    // are discovered, so the fixpoint is the least one.
    let mut values = vec![Facts::BOTTOM; func.values.len()];

    // A parameter is an input, so nothing inside the function constrains it.
    // What *does* constrain it is its declared type — `0 | 1 | 2` is a fact
    // about every possible caller, available without seeing one. For an ordinary
    // `number` this is TOP, and assuming otherwise would be exactly the
    // unsoundness this analysis exists to avoid.
    for (index, op) in func.values.iter().enumerate() {
        if let OpKind::Param(slot) = op.kind {
            values[index] = parameter_facts(func, context, slot);
        }
    }

    let mut entry: Vec<Option<Refinements>> = vec![None; func.blocks.len()];
    entry[0] = Some(Refinements::default());
    // What each block was handed last time, so that widening compares against
    // the previous round rather than against one predecessor's contribution.
    let mut previous: Vec<Option<Refinements>> = vec![None; func.blocks.len()];
    let mut visits = vec![0_u32; func.blocks.len()];
    let headers = loop_headers(func);

    for _ in 0..ROUND_CAP {
        let mut changed = false;
        for index in 0..func.blocks.len() {
            let Some(mut refinements) = entry[index].clone() else {
                // Not yet reached by any path.
                continue;
            };
            visits[index] += 1;

            // Widening, once per header per round and only on the parameters
            // that actually accumulate across iterations. Two restrictions, each
            // of which was a bug without it:
            //
            // - once per *block*, not once per incoming edge, or a header with
            //   two predecessors takes two threshold jumps per round of growth;
            // - only at a *header*, or a loop body widens the value its guard
            //   just narrowed, and the loop stops being provable at all.
            let block = BlockId(u32::try_from(index).unwrap_or(0));
            if visits[index] > WIDEN_AFTER
                && headers.contains(&block)
                && let Some(before) = &previous[index]
            {
                for param in &func.blocks[index].params {
                    if let (Some(earlier), Some(now)) =
                        (before.get(param).copied(), refinements.get(param).copied())
                    {
                        refinements.insert(*param, facts::widen(earlier, now));
                    }
                }
                // Keep the widened value, or the next round joins the narrow one
                // back in and the bound crawls upward again.
                entry[index] = Some(refinements.clone());
            }
            // What counting iterations proved, applied whether or not widening
            // ran. Without it an accumulator's bound grows by one increment per
            // round until widening sends it to infinity — and an infinite bound
            // is not a whole number, so the accumulator stays a double.
            if !context.caps.is_empty() {
                for param in &func.blocks[index].params {
                    if let (Some(cap), Some(current)) =
                        (context.caps.get(param), refinements.get(param).copied())
                    {
                        refinements.insert(*param, current.narrow(*cap));
                    }
                }
                entry[index] = Some(refinements.clone());
            }

            previous[index] = Some(refinements.clone());

            changed |= transfer_block(
                func,
                context,
                BlockId(u32::try_from(index).unwrap_or(0)),
                refinements,
                &mut values,
                &mut entry,
            );
        }
        if !changed {
            break;
        }
    }

    Analysis {
        values,
        less_than: relations(func, &entry),
        refined: entry.into_iter().map(Option::unwrap_or_default).collect(),
        growable: context.growable,
        param_lengths: context.param_lengths.clone(),
    }
}

/// The `a < b` facts that hold at the top of each block.
///
/// Derived once the intervals have settled, by asking each branch what taking
/// it proves. A block reached from more than one edge keeps only what every
/// edge agrees on.
fn relations(func: &Func, entry: &[Option<Refinements>]) -> Vec<Relations> {
    let mut incoming: Vec<Option<Relations>> = vec![None; func.blocks.len()];

    for (index, block) in func.blocks.iter().enumerate() {
        if entry[index].is_none() {
            // Unreached, so it proves nothing to anyone.
            continue;
        }
        let Terminator::Branch {
            cond,
            then_target,
            else_target,
            ..
        } = &block.terminator
        else {
            for successor in block.terminator.successors() {
                merge(&mut incoming[successor.0 as usize], Vec::new());
            }
            continue;
        };

        let (taken, not_taken) = match &func.values[cond.0 as usize].kind {
            OpKind::Binary {
                op: BinOp::Lt,
                lhs,
                rhs,
            } => (vec![(*lhs, *rhs)], Vec::new()),
            // `!(a >= b)` is `a < b`, so the *false* edge of a `>=` proves it.
            OpKind::Binary {
                op: BinOp::Ge,
                lhs,
                rhs,
            } => (Vec::new(), vec![(*lhs, *rhs)]),
            OpKind::Binary {
                op: BinOp::Gt,
                lhs,
                rhs,
            } => (vec![(*rhs, *lhs)], Vec::new()),
            OpKind::Binary {
                op: BinOp::Le,
                lhs,
                rhs,
            } => (Vec::new(), vec![(*rhs, *lhs)]),
            _ => (Vec::new(), Vec::new()),
        };
        merge(&mut incoming[then_target.0 as usize], taken);
        merge(&mut incoming[else_target.0 as usize], not_taken);
    }

    incoming
        .into_iter()
        .map(Option::unwrap_or_default)
        .collect()
}

/// Intersect what a block already knew with what one more edge proves.
fn merge(slot: &mut Option<Relations>, arriving: Relations) {
    match slot {
        Some(existing) => existing.retain(|pair| arriving.contains(pair)),
        None => *slot = Some(arriving),
    }
}

/// Run one block, then hand its successors what it proved.
/// What a parameter holds: what callers were proven to pass, if anything
/// determined that, and otherwise what its declared type admits.
fn parameter_facts(func: &Func, context: &Context, slot: u32) -> Facts {
    let declared = func
        .params
        .get(slot as usize)
        .map_or(Facts::TOP, |param| param.known);
    context
        .params
        .get(slot as usize)
        .map_or(declared, |from_callers| from_callers.narrow(declared))
}

/// What a call is worth, whoever it is calling.
///
/// A function this program defines has its returns in the interprocedural
/// fixpoint. A dispatch has the join over every body its slot can reach -- the
/// tables are the complete list, so the join is sound. One of the runtime's own
/// has a known result. Anything else is a wall.
fn call_result(context: &Context, callee: &Callee) -> Facts {
    match callee {
        Callee::Direct(name) => context.returns.get(name).copied().unwrap_or(Facts::TOP),
        Callee::Virtual { slot, .. } | Callee::Closure { slot } => context
            .slot_returns
            .get(slot)
            .copied()
            .unwrap_or(Facts::TOP),
        Callee::External(name) => runtime_result(name).unwrap_or(Facts::TOP),
    }
}

/// What one of the runtime's own functions returns.
///
/// Only the ones whose result is certainly a whole number in a known range. A
/// helper that can return `NaN` -- `pop` and `at` on an empty array, which is
/// what `undefined` is for a number -- is absent, because absent means TOP and
/// TOP is the truth about those.
///
/// An index is `-1` or a position, and a position is bounded by a length, which
/// is a `uint32`. So the range is exactly `[-1, 2^32 - 1]`.
/// How long a string can be, from the operation that produced it.
///
/// # Why a string needs this and an array does not
///
/// An array's length is its allocation's, and the allocation is usually right
/// in front of the read. A string's is not: the whole point of a tokenizer is
/// that it makes strings whose length is never written down anywhere, and
/// without a bound every one of them is `[0, 2^32)`.
///
/// That is not a bounds-check question -- string reads are already checked
/// against a length the object carries. It is an *arithmetic* question.
/// `total + word.length * step` with an unbounded length is a product that can
/// leave the exactly-representable integers, so it has to be computed in
/// doubles and truncated back with the full wrapping `ToInt32`. With a bound it
/// is an `int64` multiply and a cast, and on `benches/cases/substrings` that
/// difference is 27% of the benchmark.
///
/// # The rule
///
/// Every string-producing operation this compiler emits either says its length
/// outright or bounds it by its input's, so the bound follows the chain back to
/// a literal. Where the chain reaches something else -- a parameter, a field, a
/// phi -- there is no bound and the caller keeps `[0, 2^32)`.
///
/// Only the *upper* bound is claimed. A slice can be empty whatever it was cut
/// from, which is why every case here starts at zero.
/// What a machine type says about every value in it.
///
/// An `i8` holds -128 to 127, and no fraction and no NaN. That is stronger than
/// anything a flow analysis can derive, it costs nothing to know, and for a
/// declared typed array it is the *only* fact there is — no pass narrowed the
/// storage, so no pass recorded what it holds.
fn held_by(ty: &super::HirType) -> Option<Facts> {
    let super::HirType::Int { bits, signed } = ty else {
        return None;
    };
    let (lo, hi) = match (bits, signed) {
        (8, true) => (-128.0, 127.0),
        (8, false) => (0.0, 255.0),
        (16, true) => (-32768.0, 32767.0),
        (16, false) => (0.0, 65535.0),
        (32, true) => (facts::I32_MIN, facts::I32_MAX),
        (32, false) => (0.0, facts::U32_MAX),
        // A 64-bit slot holds more than a `double` can tell apart. Every one
        // this compiler makes holds a value already proved inside the safe
        // range -- that proof is what `specialize` requires before it uses the
        // width at all -- but *this* function is about what the type says on its
        // own, and a 64-bit integer type says nothing a double can act on.
        _ => return None,
    };
    Some(Facts::new(lo, hi, true, false, false))
}

pub(super) fn string_span(func: &Func, value: ValueId, depth: u32) -> Option<Facts> {
    /// A slice of a slice of a slice is worth following; an unbounded chain is
    /// not, and a cheap cap means this needs no reasoning about cycles.
    const MAX_DEPTH: u32 = 8;

    if depth > MAX_DEPTH {
        return None;
    }
    let span = |of: ValueId| Some(string_span(func, of, depth + 1)?.hi);
    Some(match &func.values[value.0 as usize].kind {
        // A literal's length is written down in the literal. It is the count of
        // UTF-16 code units and not of characters, which is what
        // `String::length` means -- an emoji is two.
        OpKind::ConstString(text) => {
            let units = text.encode_utf16().count();
            Facts::constant(f64::from(u32::try_from(units).unwrap_or(u32::MAX)))
        }
        OpKind::Binary {
            op: super::BinOp::Concat,
            lhs,
            rhs,
        } => upto(span(*lhs)? + span(*rhs)?),
        OpKind::Call {
            callee: super::Callee::External(name),
            args,
            ..
        } => match (name.as_str(), args.first()) {
            // Both clamp into the receiver, so neither can be longer than it.
            ("nts_str_substring" | "nts_str_slice", Some(&source)) => upto(span(source)?),
            // At most one code unit, for two different reasons: `charAt` clamps
            // into the receiver and yields none where the index is out of
            // range, while `fromCharCode` truncates its argument to sixteen
            // bits and always yields exactly one.
            //
            // `hir::frame_capacity` has known the second since it was written.
            // Saying it *here* too is what lets a **concatenation** of two of
            // them be bounded -- and `String.fromCharCode(hi, lo)`, the
            // surrogate pair every astral character goes through, was three of
            // the eight allocations `node-utf8` made per decoded string.
            ("nts_str_at" | "nts_str_char_at" | "nts_string_from_char_code", _) => upto(1.0),
            // One or two: a code point above the basic plane is a surrogate
            // pair, which is what makes this a different function.
            ("nts_string_from_code_point", _) => upto(2.0),
            // `a.concat(b)`. The `a + b` spelling is a `BinOp::Concat` and is
            // handled above.
            ("nts_concat", _) => match (args.first(), args.get(1)) {
                (Some(&a), Some(&b)) => upto(span(a)? + span(b)?),
                _ => return None,
            },
            _ => return None,
        },
        _ => return None,
    })
}

/// `[0, hi]`, saturating at the largest length a string can have.
fn upto(hi: f64) -> Facts {
    Facts::new(0.0, hi.min(facts::U32_MAX), true, false, false)
}

fn runtime_result(name: &str) -> Option<Facts> {
    const INDEX: &[&str] = &[
        "nts_str_index_of",
        "nts_str_last_index_of",
        "nts_array_index_of",
        "nts_array_last_index_of",
    ];
    const LENGTH: &[&str] = &["nts_array_push"];
    if INDEX.contains(&name) {
        return Some(Facts::new(-1.0, facts::U32_MAX, true, false, false));
    }
    if LENGTH.contains(&name) {
        return Some(Facts::new(0.0, facts::U32_MAX, true, false, false));
    }
    None
}

/// What a field of an object of this type can hold.
fn field_facts(context: &Context, object: &super::HirType, field: u32) -> Facts {
    let super::HirType::Managed(super::ManagedType::Object(ty)) = object else {
        return Facts::TOP;
    };
    context
        .field_facts
        .get(&(*ty, field))
        .copied()
        .unwrap_or(Facts::TOP)
}

/// What one operation says about its result.
///
/// An operation with no arm here does not fail -- it returns `TOP`, which is
/// indistinguishable from an honest unknown at every use downstream. That
/// degrades silently and at a distance: a missing `Convert` arm cost the
/// `bytes` benchmark 2.4x, in a specializer that was working correctly. Adding
/// a producer of values to the HIR means adding an arm here. See record 0016.
fn transfer_op(
    func: &Func,
    context: &Context,
    op: &super::Op,
    refinements: &Refinements,
    values: &[Facts],
) -> Facts {
    // Every fact in this lattice is a fact about a *double*: a range, whether the
    // value is whole, whether it could be `-0`. A `bigint` is none of those. It
    // is exact to 128 bits, its shift count is not masked to five, and its
    // operands are not truncated to int32 -- so folding `1n << 100n` here
    // answered 16, because 100 & 31 is 4. Nothing true of a double is true of it,
    // so nothing is claimed.
    if matches!(op.ty, super::HirType::BigInt) {
        return Facts::TOP;
    }
    match &op.kind {
        OpKind::ConstFloat(v) => Facts::constant(*v),
        #[allow(clippy::cast_precision_loss)]
        OpKind::ConstInt(v) => Facts::constant(*v as f64),
        OpKind::Binary { op: bin, lhs, rhs } => facts::transfer_binary(
            *bin,
            lookup(refinements, values, *lhs),
            lookup(refinements, values, *rhs),
        )
        .unwrap_or(Facts::TOP),
        OpKind::Unary {
            op: UnOp::Neg,
            operand,
        } => facts::neg(lookup(refinements, values, *operand)),
        // The coercions are where an unconstrained value becomes a known
        // integer. Everything about `x | 0` depends on this arm.
        OpKind::Unary {
            op: UnOp::ToInt32,
            operand,
        } => facts::to_int32(lookup(refinements, values, *operand)),
        OpKind::Unary {
            op: UnOp::ToUint32,
            operand,
        } => facts::to_uint32(lookup(refinements, values, *operand)),
        OpKind::Unary {
            op: rounding @ (UnOp::Floor | UnOp::Ceil | UnOp::Trunc | UnOp::Round),
            operand,
        } => facts::round_to_integer(*rounding, lookup(refinements, values, *operand)),
        OpKind::Unary {
            op: UnOp::Abs,
            operand,
        } => facts::abs(lookup(refinements, values, *operand)),
        // A length is a `uint32`, always. Where the array was allocated
        // here with a known size, it is that size exactly — which is what
        // lets an index into an array literal be proven in bounds by the
        // interval domain alone, with no reasoning about the array at all.
        // A code unit is a `uint16`. Out of range is NaN rather than a
        // trap, so an unproven index is the same set plus NaN -- and once
        // the index is proven inside the string it is just the range, which
        // is what lets a scan by code unit stay in integers.
        OpKind::StringUnitAt { checked, .. } => Facts::new(0.0, 65535.0, true, *checked, false),
        OpKind::Length(array) => {
            let bound = Facts::new(0.0, facts::U32_MAX, true, false, false);
            match &func.values[array.0 as usize].kind {
                // Only while nothing can have grown it: an array handed to a
                // call may come back longer, and the object does not move so
                // every reference sees the new length.
                OpKind::ArrayNew { length, .. }
                    if super::allocated_length_is_exact(func, *array, context.growable) =>
                {
                    lookup(refinements, values, *length).narrow(bound)
                }
                // A string's length is bounded by the string it was made
                // from, however many slices back that is.
                _ => string_span(func, *array, 0).unwrap_or(bound).narrow(bound),
            }
        }
        // A parameter keeps what its declared type said. It is an operation
        // in the entry block like any other, so without this arm the
        // transfer recomputes it as TOP and joins that over the seed —
        // silently discarding the one thing that makes a parameter provable.
        OpKind::Param(slot) => parameter_facts(func, context, *slot),
        // What the callee was proven to return. Without this every call is
        // a wall: an unanalyzed result poisons everything downstream of it,
        // which for a program made of small functions is everything.
        OpKind::Call { callee, .. } => call_result(context, callee),
        // What was stored into this field, anywhere in the program.
        OpKind::FieldGet { object, field } => {
            field_facts(context, &func.values[object.0 as usize].ty, *field)
        }
        // The same idea for the third kind of storage. Absent is TOP, which is
        // what an exported global gets: a writer outside the compiled set is
        // not in any join this program can take.
        OpKind::GlobalGet(global) => context
            .global_facts
            .get(global)
            .copied()
            .unwrap_or(Facts::TOP),
        // What anything in the program stored into an array of this type,
        // but *only once the storage agrees*.
        //
        // The fact is true either way -- an array of `number` holding 0 to
        // 100 holds them whether it is `double[]` or `int32_t[]`. Acting on
        // it is what needs the storage: from a `double[]`, proving the
        // element whole makes the arithmetic after it integer, and every
        // one of those results is converted back at the first floating
        // point use. Measured on `arrays`, that is four conversions per
        // iteration and 18% slower.
        //
        // So `hir::elements` decides the storage, and the fact follows it.
        OpKind::ArrayGet { array, .. } => match &func.values[array.0 as usize].ty {
            super::HirType::Managed(super::ManagedType::Array(element))
                if matches!(**element, super::HirType::Int { .. }) =>
            {
                // The width *is* a range, whatever the stores say. A
                // `Uint8Array`'s element is 0 to 255 by construction, and
                // for a declared typed array that is the only fact there
                // is: nothing narrowed it, so nothing recorded it.
                let stored = context
                    .element_facts
                    .get(element.as_ref())
                    .copied()
                    .unwrap_or(Facts::TOP);
                match held_by(element) {
                    Some(width) => stored.narrow(width),
                    None => stored,
                }
            }
            _ => Facts::TOP,
        },
        // A conversion keeps the value it was given, as far as it fits.
        //
        // Without this every typed array read was TOP: the read is narrow
        // and the expression around it is `number`, so lowering converts —
        // and an operand with no facts is an operand nothing can specialize.
        // `bytes` compiled its two `% 65521` to `fmod`, a library call, two
        // per byte, and ran at 2.36x the C++ reference.
        OpKind::Convert(operand) => {
            let incoming = lookup(refinements, values, *operand);
            match held_by(&op.ty) {
                Some(width) => incoming.narrow(width),
                None => incoming,
            }
        }
        // A bool is not a number, and a call's result needs the callee
        // analyzed — neither is a claim this pass can make.
        _ => Facts::TOP,
    }
}

fn transfer_block(
    func: &Func,
    context: &Context,
    block: BlockId,
    mut refinements: Refinements,
    values: &mut [Facts],
    entry: &mut [Option<Refinements>],
) -> bool {
    let record = &func.blocks[block.0 as usize];
    let mut changed = false;

    // A block parameter's fact is whatever its predecessors passed, which the
    // edges recorded here.
    for param in &record.params {
        if let Some(passed) = refinements.get(param) {
            changed |= widen_into(&mut values[param.0 as usize], *passed);
        }
    }

    for &value in &record.ops {
        let op = &func.values[value.0 as usize];
        let computed = transfer_op(func, context, op, &refinements, values);
        // Monotone: a value's fact only grows as more paths reach it, so joining
        // rather than assigning keeps the iteration from oscillating.
        let slot = &mut values[value.0 as usize];
        let joined = slot.join(computed);
        if joined != *slot {
            *slot = joined;
            changed = true;
        }
        refinements.insert(value, joined);
    }

    match &record.terminator {
        Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => {}
        Terminator::Jump { target, args } => {
            changed |= send(func, *target, args, &refinements, values, entry);
        }
        Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        } => {
            // Each edge carries what taking it proves. This is the only place
            // a value learns something its definition did not say.
            let on_then = refine_edge(func, &refinements, values, *cond, true);
            let on_else = refine_edge(func, &refinements, values, *cond, false);
            changed |= send(func, *then_target, then_args, &on_then, values, entry);
            changed |= send(func, *else_target, else_args, &on_else, values, entry);
        }
    }
    changed
}

/// Hand an edge's facts to its target, binding the target's parameters to the
/// arguments this edge passes.
fn send(
    func: &Func,
    target: BlockId,
    args: &[ValueId],
    refinements: &Refinements,
    values: &[Facts],
    entry: &mut [Option<Refinements>],
) -> bool {
    let mut outgoing = refinements.clone();
    for (param, arg) in func.blocks[target.0 as usize].params.iter().zip(args) {
        outgoing.insert(*param, lookup(refinements, values, *arg));
    }

    let slot = &mut entry[target.0 as usize];
    let Some(existing) = slot else {
        *slot = Some(outgoing);
        return true;
    };

    let mut changed = false;
    for (value, incoming) in outgoing {
        let previous = existing
            .get(&value)
            .copied()
            .unwrap_or(values[value.0 as usize]);
        let joined = previous.join(incoming);
        if joined != previous {
            existing.insert(value, joined);
            changed = true;
        }
    }
    changed
}

/// What a value holds here: what an edge refined it to, or its own definition.
fn lookup(refinements: &Refinements, values: &[Facts], value: ValueId) -> Facts {
    refinements
        .get(&value)
        .copied()
        .unwrap_or_else(|| values[value.0 as usize])
}

fn widen_into(slot: &mut Facts, incoming: Facts) -> bool {
    let joined = slot.join(incoming);
    if joined == *slot {
        return false;
    }
    *slot = joined;
    true
}

/// The comparison with its operands swapped.
const fn flip(op: BinOp) -> BinOp {
    match op {
        BinOp::Lt => BinOp::Gt,
        BinOp::Le => BinOp::Ge,
        BinOp::Gt => BinOp::Lt,
        BinOp::Ge => BinOp::Le,
        other => other,
    }
}

/// The comparison that holds when this one does not.
const fn negate(op: BinOp) -> BinOp {
    match op {
        BinOp::Lt => BinOp::Ge,
        BinOp::Le => BinOp::Gt,
        BinOp::Gt => BinOp::Le,
        BinOp::Ge => BinOp::Lt,
        BinOp::Eq => BinOp::Ne,
        BinOp::Ne => BinOp::Eq,
        other => other,
    }
}

/// Facts that hold on one side of a branch.
fn refine_edge(
    func: &Func,
    refinements: &Refinements,
    values: &[Facts],
    cond: ValueId,
    taken: bool,
) -> Refinements {
    let mut refined = refinements.clone();
    let OpKind::Binary {
        op: comparison,
        lhs,
        rhs,
    } = &func.values[cond.0 as usize].kind
    else {
        return refined;
    };
    if !matches!(
        comparison,
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq | BinOp::Ne
    ) {
        return refined;
    }

    let holds = if taken {
        *comparison
    } else {
        negate(*comparison)
    };

    // An ordered comparison is false whenever either side is NaN, so only the
    // *true* edge proves NaN absent. Taking the false edge proves nothing about
    // it — which is why this cannot simply be the negated comparison.
    let excludes_nan = taken
        && matches!(
            comparison,
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::Eq
        );

    let a = lookup(refinements, values, *lhs);
    let b = lookup(refinements, values, *rhs);
    refined.insert(*lhs, refine(holds, a, b, excludes_nan));
    refined.insert(*rhs, refine(flip(holds), b, a, excludes_nan));
    refined
}

/// Narrow `a` to an interval, keeping the flags an interval cannot express.
fn meet(a: Facts, lo: f64, hi: f64, clear_nan: bool) -> Facts {
    let new_lo = a.lo.max(lo);
    let new_hi = a.hi.min(hi);
    if new_lo > new_hi {
        // No numeric member survives, though NaN may still reach here.
        return Facts {
            maybe_nan: if clear_nan { false } else { a.maybe_nan },
            ..Facts::BOTTOM
        };
    }
    Facts::new(
        new_lo,
        new_hi,
        a.whole,
        if clear_nan { false } else { a.maybe_nan },
        a.maybe_negative_zero,
    )
}

/// Narrow `a` given that `a OP b` holds.
///
/// Wholeness sharpens a strict bound by a full step: a whole `x < b` is not
/// merely `x <= b`, it is `x <= ceil(b) - 1`. That single rule is what turns
/// `while (i < 10)` into `i` in `[0, 9]` rather than `[0, 10]` — and an
/// off-by-one in a range analysis is an off-by-one in the emitted program.
fn refine(op: BinOp, a: Facts, b: Facts, clear_nan: bool) -> Facts {
    let cleared = Facts {
        maybe_nan: if clear_nan { false } else { a.maybe_nan },
        ..a
    };
    if a.lo > a.hi || b.lo > b.hi {
        return cleared;
    }
    // On a failed ordered comparison, a NaN on the other side satisfies the
    // failure whatever this side holds, so nothing about this side is proven.
    if !clear_nan && b.maybe_nan && matches!(op, BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge) {
        return cleared;
    }

    match op {
        BinOp::Lt => meet(
            a,
            f64::NEG_INFINITY,
            if a.whole { b.hi.ceil() - 1.0 } else { b.hi },
            clear_nan,
        ),
        BinOp::Le => meet(
            a,
            f64::NEG_INFINITY,
            if a.whole { b.hi.floor() } else { b.hi },
            clear_nan,
        ),
        BinOp::Gt => meet(
            a,
            if a.whole { b.lo.floor() + 1.0 } else { b.lo },
            f64::INFINITY,
            clear_nan,
        ),
        BinOp::Ge => meet(
            a,
            if a.whole { b.lo.ceil() } else { b.lo },
            f64::INFINITY,
            clear_nan,
        ),
        BinOp::Eq => meet(a, b.lo, b.hi, clear_nan),
        // Knowing a value is not equal to something only helps when that
        // something sits on one of its endpoints; otherwise the set has a hole
        // in it, which an interval cannot represent.
        BinOp::Ne => {
            if b.is_singleton() && a.whole && b.lo.fract() == 0.0 {
                if a.lo == b.lo {
                    return meet(a, a.lo + 1.0, a.hi, clear_nan);
                }
                if a.hi == b.lo {
                    return meet(a, a.lo, a.hi - 1.0, clear_nan);
                }
            }
            cleared
        }
        _ => cleared,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{Block, HirType, Op, Param};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn op(kind: OpKind) -> Op {
        Op {
            kind,
            ty: HirType::Float { bits: 64 },
            origin: origin(),
        }
    }

    fn func(values: Vec<Op>, blocks: Vec<Block>, params: usize) -> Func {
        Func {
            name: "f".to_owned(),
            params: (0..params)
                .map(|_| Param {
                    name: "n".to_owned(),
                    ty: HirType::Float { bits: 64 },
                    origin: origin(),
                    known: Facts::TOP,
                    shape: crate::hir::ParamShape::Ordinary,
                })
                .collect(),
            return_type: HirType::Float { bits: 64 },
            values,
            blocks,
            origin: origin(),
            exported: true,
            initializes_receiver: false,
            async_result: None,
            frame: None,
            abstract_declaration: false,
        }
    }

    fn block(params: Vec<ValueId>, ops: Vec<ValueId>, terminator: Terminator) -> Block {
        Block {
            params,
            ops,
            terminator,
        }
    }

    /// `let i = 0; while (i < 10) { i = i + 1 } return i`
    ///
    /// The shape the whole analysis exists for. Nothing about `i`'s definitions
    /// bounds it — `0` and `i + 1` are all a definition-walk sees. The bound
    /// comes from the guard on the edge into the body.
    fn counted_loop(limit: f64) -> Func {
        let values = vec![
            op(OpKind::ConstFloat(0.0)),     // %0  i = 0
            op(OpKind::BlockParam(0)),       // %1  i at the header
            op(OpKind::ConstFloat(limit)),   // %2  the limit
            op(Op_binary(BinOp::Lt, 1, 2)),  // %3  i < limit
            op(OpKind::ConstFloat(1.0)),     // %4
            op(Op_binary(BinOp::Add, 1, 4)), // %5  i + 1
        ];
        func(
            values,
            vec![
                block(
                    Vec::new(),
                    vec![ValueId(0)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(0)],
                    },
                ),
                block(
                    vec![ValueId(1)],
                    vec![ValueId(2), ValueId(3)],
                    Terminator::Branch {
                        cond: ValueId(3),
                        then_target: BlockId(2),
                        then_args: Vec::new(),
                        else_target: BlockId(3),
                        else_args: Vec::new(),
                    },
                ),
                block(
                    Vec::new(),
                    vec![ValueId(4), ValueId(5)],
                    Terminator::Jump {
                        target: BlockId(1),
                        args: vec![ValueId(5)],
                    },
                ),
                block(Vec::new(), Vec::new(), Terminator::Return(Some(ValueId(1)))),
            ],
            0,
        )
    }

    #[allow(non_snake_case)]
    fn Op_binary(op: BinOp, lhs: u32, rhs: u32) -> OpKind {
        OpKind::Binary {
            op,
            lhs: ValueId(lhs),
            rhs: ValueId(rhs),
        }
    }

    #[test]
    fn a_constant_bounded_counter_is_provably_an_integer() {
        let analysis = analyze(&counted_loop(10.0));
        let counter = analysis.get(ValueId(1));
        assert!(counter.whole, "the counter is whole: {counter:?}");
        assert!(!counter.maybe_nan);
        assert_eq!(counter.lo, 0.0);

        // The upper bound is the widening threshold, not 10. A counter's bound
        // grows by one per round, so a loop bounded by a million would need a
        // million rounds; widening jumps a still-growing bound to the next point
        // where a verdict could change. The verdict is what matters, and it is
        // preserved: this is still provably `i32`.
        assert!(analysis.is_integral_within(ValueId(1), -2_147_483_648.0, 2_147_483_647.0));
    }

    #[test]
    fn widening_does_not_manufacture_a_verdict_it_cannot_prove() {
        // The counterpart to the test above, and the reason those thresholds are
        // the ones they are. A counter bounded past `i32` widens to the *next*
        // threshold rather than stopping at a convenient one, so it is reported
        // as `i64` and not as `i32`. Widening only ever grows a bound, so the
        // answer stays an over-approximation of the truth.
        let analysis = analyze(&counted_loop(3_000_000_000.0));
        assert!(
            !analysis.is_integral_within(ValueId(1), -2_147_483_648.0, 2_147_483_647.0),
            "{:?} does not fit i32",
            analysis.get(ValueId(1))
        );
        assert!(analysis.is_integral_within(ValueId(1), facts::SAFE_MIN, facts::SAFE_MAX));
    }

    #[test]
    fn a_counter_bounded_by_a_parameter_is_not() {
        // Same loop, but the limit is an unanalyzed input. This is the case that
        // makes exported functions hard, and the analysis has to say so rather
        // than guess: the counter really can exceed any integer range.
        let mut function = counted_loop(10.0);
        function.values[2] = op(OpKind::Param(0));
        function.params.push(Param {
            name: "limit".to_owned(),
            ty: HirType::Float { bits: 64 },
            origin: origin(),
            known: Facts::TOP,
            shape: crate::hir::ParamShape::Ordinary,
        });

        let analysis = analyze(&function);
        assert!(
            !analysis.is_integral_within(ValueId(1), -2_147_483_648.0, 2_147_483_647.0),
            "an unbounded counter must not be claimed as i32: {:?}",
            analysis.get(ValueId(1))
        );
    }

    #[test]
    fn wholeness_sharpens_a_strict_bound_by_a_full_step() {
        // A whole `x < 10` is `x <= 9`, not `x <= 10`. Without this the loop
        // above proves `[0, 11]` and every derived bound is one too wide.
        let whole = Facts::new(0.0, 100.0, true, false, false);
        let limit = Facts::constant(10.0);
        assert_eq!(refine(BinOp::Lt, whole, limit, true).hi, 9.0);

        // A value that is not known to be whole gets only the weak bound: it
        // may be 9.5.
        let fractional = Facts::new(0.0, 100.0, false, false, false);
        assert_eq!(refine(BinOp::Lt, fractional, limit, true).hi, 10.0);
    }

    #[test]
    fn a_failed_ordered_comparison_proves_nothing_about_nan() {
        // `!(x < 10)` does not mean `x >= 10`: a NaN fails every ordered
        // comparison. Narrowing on the false edge would let a NaN be proven to
        // be a large integer.
        let unknown = Facts::TOP;
        let limit = Facts::constant(10.0);
        let refined = refine(BinOp::Ge, unknown, limit, false);
        assert!(
            refined.maybe_nan,
            "NaN survives the false edge: {refined:?}"
        );

        // The true edge does exclude it: `x < 10` being true means `x` is a
        // number.
        let taken = refine(BinOp::Lt, unknown, limit, true);
        assert!(!taken.maybe_nan);
    }

    #[test]
    fn a_parameter_is_unknown_rather_than_assumed() {
        let function = func(
            vec![op(OpKind::Param(0))],
            vec![block(
                Vec::new(),
                vec![ValueId(0)],
                Terminator::Return(Some(ValueId(0))),
            )],
            1,
        );
        let analysis = analyze(&function);
        let facts = analysis.get(ValueId(0));
        assert!(facts.maybe_nan && !facts.whole, "{facts:?}");
    }

    /// The arm whose absence cost the `bytes` benchmark 2.4x. A conversion is
    /// not an unknown: it is the value it was given, as far as the result type
    /// can hold it.
    #[test]
    fn a_conversion_keeps_the_facts_of_its_operand() {
        let narrow = HirType::Int {
            bits: 8,
            signed: false,
        };
        let values = vec![
            Op {
                kind: OpKind::ConstInt(200),
                ty: narrow,
                origin: origin(),
            },
            Op {
                kind: OpKind::Convert(ValueId(0)),
                ty: HirType::Float { bits: 64 },
                origin: origin(),
            },
        ];
        let blocks = vec![block(
            Vec::new(),
            vec![ValueId(0), ValueId(1)],
            Terminator::Return(Some(ValueId(1))),
        )];
        let analysis = analyze(&func(values, blocks, 0));
        let converted = analysis.get(ValueId(1));
        assert!(
            converted.is_singleton() && converted.contains(200.0),
            "a widening conversion is exact: {converted:?}"
        );
    }

    /// And a machine type's width is a range on its own, which is the only
    /// fact a *declared* `Uint8Array` has — nothing narrowed it, so nothing
    /// recorded what it holds.
    #[test]
    fn a_narrow_result_type_bounds_the_conversion() {
        let values = vec![
            Op {
                kind: OpKind::ConstFloat(70_000.0),
                ty: HirType::Float { bits: 64 },
                origin: origin(),
            },
            Op {
                kind: OpKind::Convert(ValueId(0)),
                ty: HirType::Int {
                    bits: 16,
                    signed: false,
                },
                origin: origin(),
            },
        ];
        let blocks = vec![block(
            Vec::new(),
            vec![ValueId(0), ValueId(1)],
            Terminator::Return(Some(ValueId(1))),
        )];
        let analysis = analyze(&func(values, blocks, 0));
        let narrowed = analysis.get(ValueId(1));
        assert!(
            narrowed.hi <= 65535.0 && narrowed.lo >= 0.0,
            "a `u16` holds 0 to 65535 whatever reached it: {narrowed:?}"
        );
    }
}
