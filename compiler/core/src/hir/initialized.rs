//! Evidence that a local array read observes a store, rather than a hole.
//!
//! Matching element representations do not establish initialization. Only a
//! dominating store to the same slot, dominating constant stores covering the
//! read's range, or a completed unit-stride fill establishes it. An unproved
//! read keeps the erased array, whose zeroed slot already reads `undefined`.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{BlockId, Func, HirType, OpKind, ValueId};

pub(super) struct Reads {
    initialized: FxHashSet<ValueId>,
}

impl Reads {
    pub(super) fn analyze(func: &Func) -> Self {
        let Accesses {
            reads,
            stores,
            positions,
        } = Accesses::collect(func);
        let reads: Vec<_> = reads
            .into_iter()
            .filter(|(array, _)| local_writers(func, *array) && stores.contains_key(array))
            .collect();
        let mut initialized = FxHashSet::default();
        if reads.is_empty() {
            return Self { initialized };
        }
        let reachable = super::verify::reachable_blocks(func);
        let idom = super::verify::dominators(func, &reachable);
        let dominates = |over: BlockId, under: BlockId| {
            let mut at = Some(under);
            while let Some(block) = at {
                if block == over {
                    return true;
                }
                at = idom[block.0 as usize];
            }
            false
        };
        let before = |first: ValueId, second: ValueId| match (
            positions[first.0 as usize],
            positions[second.0 as usize],
        ) {
            (Some((a, x)), Some((b, y))) => {
                if a == b {
                    x < y
                } else {
                    dominates(a, b)
                }
            }
            _ => false,
        };
        let analysis = super::flow::analyze(func);
        let predecessors = super::loops::predecessors(func);
        let loops = super::loops::prefix_loops(func, &analysis, &predecessors, dominates);
        for (array, reads) in reads {
            let Some(stores) = stores.get(&array) else {
                continue;
            };
            let full_fills: Vec<_> = loops
                .iter()
                .filter(|fill| {
                    stores_every_iteration(
                        func,
                        &positions,
                        array,
                        stores,
                        &predecessors,
                        fill,
                        dominates,
                    )
                })
                .collect();
            for (read, index, checked) in reads {
                // A successful checked store establishes that this exact SSA
                // slot exists. Array writes cannot remove a preceding store.
                if stores
                    .iter()
                    .any(|(store, at)| *at == index && before(*store, read))
                {
                    initialized.insert(read);
                    continue;
                }
                let Some((block, _)) = positions[read.0 as usize] else {
                    continue;
                };
                let range = analysis.get_at(block, index);
                let finite_range = range.whole
                    && !range.maybe_nan
                    && !range.is_bottom()
                    && range.lo >= 0.0
                    && range.hi <= f64::from(u32::MAX);
                if full_fills.iter().any(|fill| {
                    dominates(fill.exit, block)
                        && ((finite_range && range.hi < fill.length)
                            || (!checked
                                && super::allocated_length_is_exact(func, array, true)
                                && allocated_length(func, &analysis, array) == Some(fill.length)))
                }) {
                    initialized.insert(read);
                    continue;
                }
                if !finite_range {
                    continue;
                }
                if constants_cover(&analysis, stores, index, block, |store| before(store, read)) {
                    initialized.insert(read);
                }
            }
        }
        Self { initialized }
    }

    pub(super) fn contains(&self, read: ValueId) -> bool {
        self.initialized.contains(&read)
    }
}

fn allocated_length(func: &Func, analysis: &super::flow::Analysis, array: ValueId) -> Option<f64> {
    let OpKind::ArrayNew { length, .. } = func.value(array).kind else {
        return None;
    };
    let length = analysis.get(length);
    (length.is_singleton()
        && length.whole
        && !length.maybe_nan
        && (0.0..=f64::from(u32::MAX)).contains(&length.lo))
    .then_some(length.lo)
}

struct Accesses {
    reads: FxHashMap<ValueId, Vec<(ValueId, ValueId, bool)>>,
    stores: FxHashMap<ValueId, Vec<(ValueId, ValueId)>>,
    positions: Vec<Option<(BlockId, usize)>>,
}

impl Accesses {
    fn collect(func: &Func) -> Self {
        let mut reads = FxHashMap::<ValueId, Vec<(ValueId, ValueId, bool)>>::default();
        let mut stores = FxHashMap::<ValueId, Vec<(ValueId, ValueId)>>::default();
        let mut positions = vec![None; func.values.len()];
        for (block, body) in func.blocks.iter().enumerate() {
            let at = BlockId(u32::try_from(block).unwrap_or(u32::MAX));
            for (position, id) in body.ops.iter().enumerate() {
                positions[id.0 as usize] = Some((at, position));
                match func.value(*id).kind {
                    OpKind::ArrayGet {
                        array,
                        index,
                        checked,
                    } if func.value(*id).ty == HirType::Erased => {
                        reads.entry(array).or_default().push((*id, index, checked));
                    }
                    OpKind::ArraySet { array, index, .. } => {
                        stores.entry(array).or_default().push((*id, index));
                    }
                    _ => {}
                }
            }
        }
        Self {
            reads,
            stores,
            positions,
        }
    }
}

fn constants_cover(
    analysis: &super::flow::Analysis,
    stores: &[(ValueId, ValueId)],
    index: ValueId,
    block: BlockId,
    before: impl Fn(ValueId) -> bool,
) -> bool {
    let range = analysis.get_at(block, index);
    let mut written = Vec::new();
    for (store, index) in stores {
        if before(*store) {
            let at = analysis.get(*index);
            if at.is_singleton()
                && at.whole
                && !at.maybe_nan
                && (range.lo..=range.hi).contains(&at.lo)
            {
                written.push(at.lo.max(0.0));
            }
        }
    }
    // Iterate the stores, not an arbitrary array length or read interval.
    written.sort_by(f64::total_cmp);
    written.dedup_by(|a, b| a.to_bits() == b.to_bits());
    let mut expected = range.lo.max(0.0);
    for at in written {
        if at.to_bits() != expected.to_bits() {
            break;
        }
        expected += 1.0;
    }
    expected > range.hi
}

fn stores_every_iteration(
    func: &Func,
    positions: &[Option<(BlockId, usize)>],
    array: ValueId,
    stores: &[(ValueId, ValueId)],
    predecessors: &[Vec<(BlockId, Vec<ValueId>)>],
    fill: &super::loops::PrefixLoop,
    dominates: impl Fn(BlockId, BlockId) -> bool,
) -> bool {
    let Some((allocated, _)) = positions[array.0 as usize] else {
        return false;
    };
    allocated != fill.header
        && dominates(allocated, fill.header)
        && stores.iter().any(|(store, index)| {
            let Some((block, _)) = positions[store.0 as usize] else {
                return false;
            };
            block != fill.header
                && dominates(fill.header, block)
                && dominates(block, fill.latch)
                && super::loops::copies_counter(func, predecessors, *index, fill.counter)
        })
}

/// A checker element type and a previous store cannot close an alias that may
/// delete a slot or shrink the array. Reuse the existing confinement predicate.
fn local_writers(func: &Func, array: ValueId) -> bool {
    matches!(func.value(array).kind, OpKind::ArrayNew { .. })
        && func
            .values
            .iter()
            .all(|op| super::use_keeps_the_array_here(array, &op.kind))
        && !func
            .blocks
            .iter()
            .any(|block| super::verify::terminator_operands(&block.terminator).contains(&array))
}
