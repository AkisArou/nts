//! Linear, unpublished string storage, independent of its physical representation.
//!
//! Factored from the JVM accumulator proof. Local storage joins block-parameter
//! edges and the left side of concatenations. A mutable carrier is sound only
//! where each consumed immutable version has no later reader; scalar UTF-16
//! measurements leave it unchanged. A materializing read may run at most once
//! per seeded lifetime. No backend representation is chosen here.

use super::{
    BinOp, BlockId, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId, operands_of,
};
use rustc_hash::{FxHashMap, FxHashSet};

struct Control<'a, const LIMITED: bool> {
    charge: &'a mut dyn FnMut(usize) -> bool,
}
impl<const LIMITED: bool> Control<'_, LIMITED> {
    fn take(&mut self, units: usize) -> Option<()> {
        if !LIMITED || (self.charge)(units) {
            Some(())
        } else {
            None
        }
    }
}

struct Analysis {
    held: FxHashSet<ValueId>,
    roots: Vec<u32>,
}

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

    fn find<const LIMITED: bool>(
        &mut self,
        at: u32,
        control: &mut Control<'_, LIMITED>,
    ) -> Option<u32> {
        let mut root = at;
        while self.parent[root as usize] != root {
            control.take(1)?;
            root = self.parent[root as usize];
        }
        let mut walk = at;
        while self.parent[walk as usize] != root {
            control.take(1)?;
            let next = self.parent[walk as usize];
            self.parent[walk as usize] = root;
            walk = next;
        }
        Some(root)
    }

    fn union<const LIMITED: bool>(
        &mut self,
        a: u32,
        b: u32,
        control: &mut Control<'_, LIMITED>,
    ) -> Option<()> {
        let (a, b) = (self.find(a, control)?, self.find(b, control)?);
        if a != b {
            self.parent[b as usize] = a;
        }
        Some(())
    }
}

/// Values that are one storage location, for the reasons the module note
/// gives.
fn locations<const LIMITED: bool>(
    func: &Func,
    calls: &impl Fn(&str) -> Option<u32>,
    control: &mut Control<'_, LIMITED>,
) -> Option<Classes> {
    control.take(
        func.values
            .len()
            .saturating_mul(3)
            .saturating_add(func.blocks.len()),
    )?;
    let mut classes = Classes::new(func.values.len());

    // A block parameter and every argument that reaches it are one location.
    for block in &func.blocks {
        for (target, args) in outgoing(&block.terminator)? {
            let Some(params) = func.blocks.get(target.0 as usize).map(|it| &it.params) else {
                continue;
            };
            for (param, arg) in params.iter().zip(&args) {
                classes.union(param.0, arg.0, control)?;
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
            classes.union(u32::try_from(at).unwrap_or(0), lhs.0, control)?;
        }
        if let OpKind::Call {
            callee: Callee::Direct(name),
            args,
            ..
        } = &op.kind
            && let Some(slot) = calls(name)
            && let Some(argument) = args.get(slot as usize)
        {
            classes.union(u32::try_from(at).unwrap_or(0), argument.0, control)?;
        }
    }
    Some(classes)
}

/// String values this backend can hold as a `StringBuilder`.
#[must_use]
pub fn local(func: &Func) -> FxHashSet<ValueId> {
    analyze(func, &|_| None, None)
}

pub mod chains;

/// The same proof with a proved incoming carrier and proved static calls.
fn analyze(
    func: &Func,
    calls: &impl Fn(&str) -> Option<u32>,
    incoming: Option<u32>,
) -> FxHashSet<ValueId> {
    analyze_using(
        func,
        calls,
        incoming,
        &mut Control::<false> {
            charge: &mut |_| true,
        },
    )
    .map_or_else(FxHashSet::default, |analysis| analysis.held)
}

fn analyze_limited(
    func: &Func,
    calls: &impl Fn(&str) -> Option<u32>,
    incoming: Option<u32>,
    charge: &mut dyn FnMut(usize) -> bool,
) -> Option<Analysis> {
    analyze_using(func, calls, incoming, &mut Control::<true> { charge })
}

fn analyze_using<const LIMITED: bool>(
    func: &Func,
    calls: &impl Fn(&str) -> Option<u32>,
    incoming: Option<u32>,
    control: &mut Control<'_, LIMITED>,
) -> Option<Analysis> {
    control.take(func.values.len().saturating_mul(4))?;
    let Definitions {
        roots,
        appended,
        mut refused,
    } = definitions(func, calls, incoming, control)?;
    let string = |value: ValueId| {
        matches!(
            func.values.get(value.0 as usize).map(|op| &op.ty),
            Some(HirType::Managed(ManagedType::String))
        )
    };
    // Worth a builder, then rules 1 and 2, over the classes still standing.
    let uses = uses(func, &string, calls, control)?;
    let seeds = seeds(func, &roots, control)?;
    let mut accumulating = accumulating(
        func,
        &uses,
        &roots,
        &seeds,
        &|root| appended.contains(&root) && !refused.contains(&root),
        control,
    )?;
    let policy = carrier_policy(func, calls, incoming, &roots, &uses, control)?;
    accumulating.extend(policy.forced);
    refused.extend(policy.forbidden);
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
        shared(func, &uses, &member, control)?
            .into_iter()
            .chain(repeated(func, &uses, &member, &roots, &seeds, control)?)
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
    Some(Analysis { held: keep, roots })
}

struct Definitions {
    roots: Vec<u32>,
    appended: FxHashSet<u32>,
    refused: FxHashSet<u32>,
}

fn definitions<const LIMITED: bool>(
    func: &Func,
    calls: &impl Fn(&str) -> Option<u32>,
    incoming: Option<u32>,
    control: &mut Control<'_, LIMITED>,
) -> Option<Definitions> {
    let count = func.values.len();
    let mut classes = locations(func, calls, control)?;

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
        let root = classes.find(value.0, control)?;
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
            } if classes.find(lhs.0, control)? == root => {
                appended.insert(root);
            }
            // A block parameter arrives on an edge and its arguments carry
            // the obligation; a literal is the seed the accumulation starts
            // from, and `string_operation` constructs the builder there.
            // Neither is a definition this has to refuse.
            OpKind::BlockParam(_) | OpKind::ConstString(_) => {}
            OpKind::Param(slot) if Some(*slot) == incoming => {}
            OpKind::Call {
                callee: Callee::Direct(name),
                args,
                ..
            } if calls(name)
                .and_then(|slot| args.get(slot as usize))
                .is_some() =>
            {
                appended.insert(root);
            }
            _ => {
                refused.insert(root);
            }
        }
    }

    let roots: Vec<u32> = (0..count)
        .map(|at| classes.find(u32::try_from(at).unwrap_or(0), control))
        .collect::<Option<_>>()?;

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

    Some(Definitions {
        roots,
        appended,
        refused,
    })
}

#[derive(Default)]
struct CarrierPolicy {
    forced: FxHashSet<u32>,
    forbidden: FxHashSet<u32>,
}

/// Carrier safety is distinct from a backend's local profitability heuristic.
/// Compute published roots once, rather than rescan all uses at every call.
fn carrier_policy<const LIMITED: bool>(
    func: &Func,
    calls: &impl Fn(&str) -> Option<u32>,
    incoming: Option<u32>,
    roots: &[u32],
    uses: &FxHashMap<ValueId, Vec<Site>>,
    control: &mut Control<'_, LIMITED>,
) -> Option<CarrierPolicy> {
    control.take(func.values.len())?;
    let mut policy = CarrierPolicy::default();
    for (at, op) in func.values.iter().enumerate() {
        if matches!(&op.kind, OpKind::Call { callee: Callee::Direct(name), .. } if calls(name).is_some())
        {
            policy.forced.insert(roots[at]);
        }
    }
    if let Some(parameter) = incoming.and_then(|slot| {
        func.parameter_values()?
            .get(slot as usize)
            .copied()
            .flatten()
    }) {
        let root = roots[parameter.0 as usize];
        policy.forced.insert(root);
        if func
            .values
            .iter()
            .enumerate()
            .any(|(at, op)| roots[at] == root && matches!(op.kind, OpKind::ConstString(_)))
        {
            policy.forbidden.insert(root);
        }
    }
    if policy.forced.is_empty() {
        return Some(policy);
    }
    for (value, sites) in uses {
        control.take(sites.len().saturating_add(1))?;
        let root = roots[value.0 as usize];
        if policy.forced.contains(&root) && sites.iter().any(|site| site.does == Use::Materialises)
        {
            policy.forbidden.insert(root);
        }
    }
    Some(policy)
}

/// What a use does with the builder it reads; see the module note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Use {
    /// Appended to, returned, or handed across an edge: the builder moves on.
    Consumes,
    /// Length or a UTF-16 unit, answered directly without changing the builder.
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
fn uses<const LIMITED: bool>(
    func: &Func,
    string: &impl Fn(ValueId) -> bool,
    calls: &impl Fn(&str) -> Option<u32>,
    control: &mut Control<'_, LIMITED>,
) -> Option<FxHashMap<ValueId, Vec<Site>>> {
    control.take(
        func.blocks.len().saturating_add(1).saturating_mul(
            func.values
                .len()
                .saturating_mul(func.values.len())
                .saturating_add(1),
        ),
    )?;
    let mut uses: FxHashMap<ValueId, Vec<Site>> = FxHashMap::default();
    for (index, block) in func.blocks.iter().enumerate() {
        let mut note = |value: ValueId, at: usize, does: Use, onward: Vec<BlockId>| -> Option<()> {
            control.take(onward.len().saturating_add(1))?;
            if string(value) {
                uses.entry(value).or_default().push(Site {
                    block: index,
                    at,
                    does,
                    onward,
                });
            }
            Some(())
        };
        for (at, op) in block.ops.iter().enumerate() {
            match &func.values[op.0 as usize].kind {
                OpKind::Binary {
                    op: BinOp::Concat,
                    lhs,
                    rhs,
                } => {
                    note(*lhs, at, Use::Consumes, Vec::new())?;
                    note(*rhs, at, Use::Materialises, Vec::new())?;
                }
                OpKind::Length(of) | OpKind::StringUnitAt { string: of, .. } => {
                    note(*of, at, Use::Measures, Vec::new())?;
                }
                OpKind::Call {
                    callee: Callee::Direct(name),
                    args,
                    ..
                } if calls(name).is_some() => {
                    let slot = calls(name);
                    for (index, argument) in args.iter().enumerate() {
                        let does = if u32::try_from(index).ok() == slot {
                            Use::Consumes
                        } else {
                            Use::Materialises
                        };
                        note(*argument, at, does, Vec::new())?;
                    }
                }
                other => {
                    for operand in operands_of(other) {
                        note(operand, at, Use::Materialises, Vec::new())?;
                    }
                }
            }
        }

        // A terminator hands a value on once however many of its edges carry
        // it, because only one of them runs. One edge handing it to two
        // parameters makes two names for one builder: two consumers.
        let end = block.ops.len();
        if let Terminator::Return(Some(value)) = &block.terminator {
            note(*value, end, Use::Consumes, Vec::new())?;
        }
        let mut handed: Vec<(ValueId, Vec<BlockId>)> = Vec::new();
        for (target, args) in outgoing(&block.terminator)? {
            for (position, arg) in args.iter().enumerate() {
                if args[..position].contains(arg) {
                    note(*arg, end, Use::Consumes, vec![target])?;
                }
                match handed.iter_mut().find(|(value, _)| value == arg) {
                    Some((_, targets)) if !targets.contains(&target) => targets.push(target),
                    Some(_) => {}
                    None => handed.push((*arg, vec![target])),
                }
            }
        }
        for (value, onward) in handed {
            note(value, end, Use::Consumes, onward)?;
        }
    }
    Some(uses)
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
fn shared<const LIMITED: bool>(
    func: &Func,
    uses: &FxHashMap<ValueId, Vec<Site>>,
    member: &impl Fn(ValueId) -> bool,
    control: &mut Control<'_, LIMITED>,
) -> Option<Vec<ValueId>> {
    control.take(uses.len())?;
    if !uses.keys().any(|value| member(*value)) {
        return Some(Vec::new());
    }
    let live = if LIMITED {
        super::liveness::analyze_limited(func, &mut |units| control.take(units).is_some())
            .map_err(super::liveness::Failure::for_optional)
            .ok()?
    } else {
        super::liveness::analyze(func)
            .map_err(super::liveness::Failure::for_optional)
            .ok()?
    };

    let mut shared = Vec::new();
    for (value, sites) in uses {
        control.take(sites.len().saturating_mul(sites.len()).saturating_add(1))?;
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
    Some(shared)
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
fn repeated<const LIMITED: bool>(
    func: &Func,
    uses: &FxHashMap<ValueId, Vec<Site>>,
    member: &impl Fn(ValueId) -> bool,
    roots: &[u32],
    seeds: &Seeds,
    control: &mut Control<'_, LIMITED>,
) -> Option<Vec<ValueId>> {
    let unseeded = FxHashSet::default();
    let mut repeated = Vec::new();
    for (value, sites) in uses {
        control.take(1)?;
        if !member(*value) {
            continue;
        }
        let seeded = seeds.get(&roots[value.0 as usize]).unwrap_or(&unseeded);
        for site in sites {
            control.take(1)?;
            if site.does == Use::Materialises && runs_again(func, site.block, seeded, control)? {
                repeated.push(*value);
                break;
            }
        }
    }
    Some(repeated)
}

/// Each class's seeds: the blocks holding a literal in it, where
/// `string_operation` constructs a builder afresh.
type Seeds = FxHashMap<u32, FxHashSet<usize>>;

fn seeds<const LIMITED: bool>(
    func: &Func,
    roots: &[u32],
    control: &mut Control<'_, LIMITED>,
) -> Option<Seeds> {
    control.take(func.values.len().saturating_add(func.blocks.len()))?;
    let mut seeds = Seeds::default();
    for (index, block) in func.blocks.iter().enumerate() {
        for op in &block.ops {
            if matches!(func.values[op.0 as usize].kind, OpKind::ConstString(_)) {
                seeds.entry(roots[op.0 as usize]).or_default().insert(index);
            }
        }
    }
    Some(seeds)
}

/// Whether a block can run again before its class's builder is made afresh:
/// some way from it back to itself misses every one of the class's seeds.
fn runs_again<const LIMITED: bool>(
    func: &Func,
    block: usize,
    seeded: &FxHashSet<usize>,
    control: &mut Control<'_, LIMITED>,
) -> Option<bool> {
    let onward: Vec<_> = outgoing(&func.blocks[block].terminator)?
        .into_iter()
        .map(|(target, _)| target)
        .collect();
    Some(reach(func, &onward, |at| seeded.contains(&at), control)?[block])
}

/// The classes that accumulate: an append can run again in one builder's
/// lifetime. See the module note for what a class that does not may be.
fn accumulating<const LIMITED: bool>(
    func: &Func,
    uses: &FxHashMap<ValueId, Vec<Site>>,
    roots: &[u32],
    seeds: &Seeds,
    candidate: &impl Fn(u32) -> bool,
    control: &mut Control<'_, LIMITED>,
) -> Option<FxHashSet<u32>> {
    let unseeded = FxHashSet::default();
    let mut accumulating = FxHashSet::default();
    for (value, sites) in uses {
        control.take(1)?;
        let root = roots[value.0 as usize];
        if accumulating.contains(&root) || !candidate(root) {
            continue;
        }
        let seeded = seeds.get(&root).unwrap_or(&unseeded);
        for site in sites {
            control.take(1)?;
            if site.does == Use::Consumes
                && site.at < func.blocks[site.block].ops.len()
                && runs_again(func, site.block, seeded, control)?
            {
                accumulating.insert(root);
                break;
            }
        }
    }
    Some(accumulating)
}

/// The blocks control can reach from `from` without entering one `stop` names.
///
/// Rule 2's question alone; rule 1's is liveness, which core answers. Core's
/// own walks (`loops::in_a_cycle`, `verify::reachable_blocks`) ask about every
/// path, and this asks about the paths that miss a set of blocks.
fn reach<const LIMITED: bool>(
    func: &Func,
    from: &[BlockId],
    stop: impl Fn(usize) -> bool,
    control: &mut Control<'_, LIMITED>,
) -> Option<Vec<bool>> {
    control.take(func.blocks.len().saturating_add(from.len()))?;
    let mut seen = vec![false; func.blocks.len()];
    let mut stack = from.to_vec();
    while let Some(block) = stack.pop() {
        control.take(1)?;
        let index = block.0 as usize;
        if stop(index) || seen[index] {
            continue;
        }
        seen[index] = true;
        stack.extend(
            outgoing(&func.blocks[index].terminator)?
                .into_iter()
                .map(|(target, _)| target),
        );
    }
    Some(seen)
}

/// Edges and their block-parameter arguments. This match is exhaustive: a new
/// exception edge needs an explicit fallible proof adapter, never a default empty
/// edge. Missing continuation information is Unknown, never an empty successor set.
fn outgoing(terminator: &Terminator) -> Option<Vec<(BlockId, Vec<ValueId>)>> {
    Some(match terminator {
        Terminator::Return(_) | Terminator::Unreachable => Vec::new(),
        Terminator::FellThrough => return None,
        Terminator::Jump { target, args } => vec![(*target, args.clone())],
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => vec![
            (*then_target, then_args.clone()),
            (*else_target, else_args.clone()),
        ],
    })
}
