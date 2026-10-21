//! A table key read and then written is looked up once.
//!
//! `counts[w] = (counts[w] || 0) + 1` is a `get` of `w` and a `set` of `w`, and
//! each hashes the key and probes the table: on C and LLVM a string key's hash
//! is a pass over every code unit, not cached, so the idiom read each word
//! twice. Here a `set` that a `get` of the same table and key dominates, with
//! nothing between them that can write anything, shares the `get`'s lookup:
//!
//! ```text
//! e = nts_map_entry(t, k)            -- hash and probe, once
//! v = nts_map_entry_get(t, e, k)     -- the get, through the entry
//! ...
//! nts_map_entry_set(t, e, k, v')     -- the set, through the entry
//! ```
//!
//! **The entry is a hint, never a promise.** It names the slot the lookup found
//! and the table's generation, a count every structural write moves (a new key,
//! a delete, a clear, growth). A helper that finds the generation moved does
//! what the plain `get` or `set` would, which is why both still carry the key:
//! a backend without a fast path reads `entry_get(t, e, k)` as `get(t, k)` and
//! `entry_set(t, e, k, v)` as `set(t, k, v)`. What this pass proves buys speed,
//! and the answer never depends on it.
//!
//! What it does prove, and must: that the two name **one table and one key**.
//! A generation says the table has not changed shape; it cannot say an entry
//! came from this table, or for this key. So a pair is two operands that are
//! one value -- the same value, an erase of one value, or a read of one global
//! nothing writes in between -- and the window between the two operations
//! writes nothing at all: no call, no store, no table operation, no suspension.
//!
//! In preparation, and only where the backend's tables answer an entry
//! ([`super::PreparationOptions::table_entries`]): the C runtime's, behind
//! every native provider, and Wasm's, which says so. The JVM's answer none,
//! so a program prepared for it keeps the plain `get` and `set` and every
//! optimization it makes of them. For Wasm the gain was measured before it
//! was built: its record-word-counts with the write reusing the read's entry,
//! by hand, was 20.6 points faster than with the read unboxed alone
//! (2026-10-21).

use rustc_hash::FxHashSet;

use super::{BlockId, Callee, Func, HirType, OpKind, Program, ValueId};

/// The lookup that answers an entry: `(table, key) -> u64`.
pub const ENTRY: &str = "nts_map_entry";
/// `get` through an entry: `(table, entry, key) -> erased`.
pub const ENTRY_GET: &str = "nts_map_entry_get";
/// `set` through an entry: `(table, entry, key, value)`, answering what
/// `nts_map_set` answers.
pub const ENTRY_SET: &str = "nts_map_entry_set";

/// What the entry is: a generation and a slot, in one word.
pub const ENTRY_TYPE: HirType = HirType::Int {
    bits: 64,
    signed: false,
};

/// Where an operation is: its block and its position among the block's ops.
#[derive(Clone, Copy, PartialEq, Eq)]
struct At {
    block: BlockId,
    index: usize,
}

/// A `get` or `set` of a table, with its operands.
struct Access {
    op: ValueId,
    at: At,
    table: ValueId,
    key: ValueId,
}

/// The external a call names, and its arguments.
fn external(func: &Func, op: ValueId) -> Option<(&str, &[ValueId])> {
    match &func.values[op.0 as usize].kind {
        OpKind::Call {
            callee: Callee::External(name),
            args,
            ..
        } => Some((name.as_str(), args.as_slice())),
        _ => None,
    }
}

/// Whether an operation between the two may write anything a lookup reads, or
/// hand control to code that might. The removability fact
/// ([`super::dce::has_effects`]), and the suspensions it calls effect-free only
/// because none survives to the pass that asks.
fn writes(func: &Func, op: ValueId) -> bool {
    let value = &func.values[op.0 as usize];
    super::dce::has_effects(value)
        || matches!(
            value.kind,
            OpKind::Await { .. } | OpKind::Yield { .. } | OpKind::Suspend { .. }
        )
}

/// Share lookups across `program` where its backend's tables answer an
/// entry; one whose tables do not keeps its plain `get` and `set`.
pub fn share(program: &mut Program, table_entries: bool) {
    if !table_entries {
        return;
    }
    for func in &mut program.funcs {
        share_entries(func);
    }
}

/// Pair each `set` with the `get` that dominates it, returning how many.
fn share_entries(func: &mut Func) -> usize {
    let (gets, sets) = accesses(func);
    if gets.is_empty() || sets.is_empty() {
        return 0;
    }
    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    let window = Window {
        func,
        idom: &idom,
        predecessors: predecessors(func),
    };

    // Each set's nearest `get` it can share: the latest of those that qualify,
    // which every other qualifying one dominates.
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    for (s, set) in sets.iter().enumerate() {
        if !reachable.contains(&set.at.block) {
            continue;
        }
        let nearest = gets
            .iter()
            .enumerate()
            .filter(|(_, get)| window.shares(get, set))
            .reduce(|best, candidate| {
                if window.dominates(best.1.at, candidate.1.at) {
                    candidate
                } else {
                    best
                }
            });
        if let Some((g, _)) = nearest {
            pairs.push((g, s));
        }
    }
    if !pairs.is_empty() {
        rewrite(func, &gets, &sets, &pairs);
    }
    pairs.len()
}

/// Every `get` and every `set` of a table in `func`, in block order.
fn accesses(func: &Func) -> (Vec<Access>, Vec<Access>) {
    let mut gets = Vec::new();
    let mut sets = Vec::new();
    for (block_index, block) in func.blocks.iter().enumerate() {
        let block_id = BlockId(u32::try_from(block_index).unwrap_or(u32::MAX));
        for (index, &op) in block.ops.iter().enumerate() {
            let at = At {
                block: block_id,
                index,
            };
            match external(func, op) {
                Some(("nts_map_get", [table, key])) => gets.push(Access {
                    op,
                    at,
                    table: *table,
                    key: *key,
                }),
                Some(("nts_map_set", [table, key, _])) => sets.push(Access {
                    op,
                    at,
                    table: *table,
                    key: *key,
                }),
                _ => {}
            }
        }
    }
    (gets, sets)
}

/// Give each paired `get` an entry, made just before it, and route the `get`
/// and every `set` paired with it through that entry.
fn rewrite(func: &mut Func, gets: &[Access], sets: &[Access], pairs: &[(usize, usize)]) {
    let mut entries: Vec<Option<ValueId>> = vec![None; gets.len()];
    for &(g, _) in pairs {
        if entries[g].is_some() {
            continue;
        }
        let get = &gets[g];
        let origin = func.values[get.op.0 as usize].origin.clone();
        let entry = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
        func.values.push(super::Op {
            kind: OpKind::Call {
                callee: Callee::External(ENTRY.to_owned()),
                args: vec![get.table, get.key],
                frame: None,
            },
            ty: ENTRY_TYPE,
            origin,
        });
        entries[g] = Some(entry);
    }
    // Inserted per block from the last position back, so the positions the
    // accesses recorded stay right while the block grows.
    let mut inserts: Vec<(At, ValueId)> = gets
        .iter()
        .zip(&entries)
        .filter_map(|(get, entry)| entry.map(|entry| (get.at, entry)))
        .collect();
    inserts.sort_by_key(|(at, _)| std::cmp::Reverse((at.block.0, at.index)));
    for (at, entry) in inserts {
        func.blocks[at.block.0 as usize].ops.insert(at.index, entry);
    }
    for (g, get) in gets.iter().enumerate() {
        if let Some(entry) = entries[g] {
            func.values[get.op.0 as usize].kind = OpKind::Call {
                callee: Callee::External(ENTRY_GET.to_owned()),
                args: vec![get.table, entry, get.key],
                frame: None,
            };
        }
    }
    for &(g, s) in pairs {
        let set = &sets[s];
        let Some(entry) = entries[g] else {
            continue;
        };
        let value = match external(func, set.op) {
            Some((_, [_, _, value])) => *value,
            _ => continue,
        };
        func.values[set.op.0 as usize].kind = OpKind::Call {
            callee: Callee::External(ENTRY_SET.to_owned()),
            args: vec![set.table, entry, set.key, value],
            frame: None,
        };
    }
}

/// The questions a pair asks of the function's shape.
struct Window<'a> {
    func: &'a Func,
    idom: &'a [Option<BlockId>],
    predecessors: Vec<Vec<BlockId>>,
}

impl Window<'_> {
    /// Whether `a` runs before `b` on every path to `b`.
    fn dominates(&self, a: At, b: At) -> bool {
        if a.block == b.block {
            return a.index < b.index;
        }
        let mut at = b.block;
        while let Some(parent) = self.idom.get(at.0 as usize).copied().flatten() {
            if parent == a.block {
                return true;
            }
            if parent == at {
                break;
            }
            at = parent;
        }
        false
    }

    /// Whether `set` can take `get`'s entry: the two name one table and one
    /// key, `get` dominates it, and nothing between them writes.
    ///
    /// The operands first: they are a comparison, and every pair of a read and
    /// a write of different tables or keys stops there, so the walk below is
    /// paid only by a pair that could share.
    fn shares(&self, get: &Access, set: &Access) -> bool {
        let mut globals = Vec::new();
        if !(self.same(get.table, set.table, &mut globals)
            && self.same(get.key, set.key, &mut globals))
        {
            return false;
        }
        if !self.dominates(get.at, set.at) {
            return false;
        }
        let Some(between) = self.between(get.at, set.at) else {
            return false;
        };
        if between.iter().any(|&op| writes(self.func, op)) {
            return false;
        }
        // A global read twice is one value only if nothing wrote it between the
        // two reads: each must be read in the window, or in the get's own
        // block before it with nothing writing from there to the get.
        globals
            .iter()
            .all(|&read| between.contains(&read) || self.clean_before(read, get.at))
    }

    /// Whether `a` and `b` are one value, collecting the global reads that
    /// make them so.
    fn same(&self, a: ValueId, b: ValueId, globals: &mut Vec<ValueId>) -> bool {
        if a == b {
            return true;
        }
        let (left, right) = (
            &self.func.values[a.0 as usize].kind,
            &self.func.values[b.0 as usize].kind,
        );
        match (left, right) {
            (OpKind::Erase { value: x, .. }, OpKind::Erase { value: y, .. }) => {
                self.same(*x, *y, globals)
            }
            (OpKind::GlobalGet(g), OpKind::GlobalGet(h)) if g == h => {
                globals.extend([a, b]);
                true
            }
            _ => false,
        }
    }

    /// Whether `read` sits in `at`'s block before it, with nothing that writes
    /// from it to `at`.
    fn clean_before(&self, read: ValueId, at: At) -> bool {
        let ops = &self.func.blocks[at.block.0 as usize].ops;
        let Some(position) = ops[..at.index].iter().position(|&op| op == read) else {
            return false;
        };
        !ops[position + 1..at.index]
            .iter()
            .any(|&op| writes(self.func, op))
    }

    /// Every operation that can run after `from` and before `to`, on a path
    /// that does not run `from` again, or `None` where `to` can run twice for
    /// one `from` -- a loop through `to` that avoids `from`'s block, which
    /// would write once and then read the entry it wrote past.
    fn between(&self, from: At, to: At) -> Option<Vec<ValueId>> {
        let blocks = &self.func.blocks;
        if from.block == to.block {
            return Some(blocks[from.block.0 as usize].ops[from.index + 1..to.index].to_vec());
        }
        // Forward from `from`'s successors, never re-entering its block.
        let forward = walk(
            from.block,
            blocks[from.block.0 as usize].terminator.successors(),
            |block| blocks[block.0 as usize].terminator.successors(),
        );
        if forward.contains(&to.block) && self.reenters(to.block, from.block) {
            return None;
        }
        // Back from `to`, never entering `from`'s block.
        let predecessors = &self.predecessors;
        let backward = walk(
            from.block,
            predecessors[to.block.0 as usize].clone(),
            |block| predecessors[block.0 as usize].clone(),
        );
        let mut ops: Vec<ValueId> = blocks[from.block.0 as usize].ops[from.index + 1..].to_vec();
        for block in forward.intersection(&backward) {
            if *block != to.block {
                ops.extend(&blocks[block.0 as usize].ops);
            }
        }
        ops.extend(&blocks[to.block.0 as usize].ops[..to.index]);
        Some(ops)
    }

    /// Whether `block` reaches itself again without passing through `avoid`.
    fn reenters(&self, block: BlockId, avoid: BlockId) -> bool {
        let blocks = &self.func.blocks;
        walk(
            avoid,
            blocks[block.0 as usize].terminator.successors(),
            |at| blocks[at.0 as usize].terminator.successors(),
        )
        .contains(&block)
    }
}

/// Each block's predecessors.
fn predecessors(func: &Func) -> Vec<Vec<BlockId>> {
    let mut predecessors = vec![Vec::new(); func.blocks.len()];
    for (index, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        for target in block.terminator.successors() {
            predecessors[target.0 as usize].push(from);
        }
    }
    predecessors
}

/// The blocks reached from `start` by `next`, never entering `avoid`.
fn walk(
    avoid: BlockId,
    start: Vec<BlockId>,
    next: impl Fn(BlockId) -> Vec<BlockId>,
) -> FxHashSet<BlockId> {
    let mut seen = FxHashSet::default();
    let mut work = start;
    while let Some(block) = work.pop() {
        if block == avoid || !seen.insert(block) {
            continue;
        }
        work.extend(next(block));
    }
    seen
}
