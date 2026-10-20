//! A pure read made once, wherever it is made.
//!
//! **A guard reads one value and the use another, unless something says they
//! are one.** `const x: any = n; if (typeof x === "number" && x >= 0 && x <=
//! 255) take(x)` reads `x` four times, and the lowering unerases it four times,
//! each read its own value. The guard narrowed three of them and the call
//! passed the fourth, so the strict check found nothing proven about it ("it
//! could be any number"), and no guard the program could write would have
//! helped (`docs/scalar-numbers.md`, Q1: an `any` into a written kind is a store
//! like any other, so it has to be provable like any other).
//!
//! An `unerase` of one erased value is that value read as its representation:
//! it has no effect, and every one of them answers the same. So an `unerase`
//! whose identical twin dominates it is replaced by the twin, and what was
//! proven about the twin is about every use. The emitted program reads the
//! value once instead of once per mention, which every pass after this one
//! and every backend also pays less for.
//!
//! **A string is read the same way.** A scanner tests one character several
//! ways -- `s.charCodeAt(at) === ZERO`, then `isDigit(s.charCodeAt(at))` -- and
//! each mention is a code-unit read, which on Wasm is a host call. Strings are
//! immutable, so two reads of one string at one index answer the same, and a
//! checked read's `NaN` out of range is a function of the same two values; a
//! string's length is fixed for its lifetime. An array's length is not: a
//! `push` between two reads moves it, so only a string's is a read here.
//!
//! **As the lowering's last step**, so the program every reader gets -- the
//! strict check, `prepare`, `nts facts` -- is this one, and the obligations the
//! lowering recorded are renamed with the values they name. The replaced
//! operations are left in place with no reader, as [`super::simplify`] leaves
//! an identity, for the passes that remove what nothing reads.

use rustc_hash::{FxHashMap, FxHashSet};

use super::simplify::{substitute, substitute_terminator};
use super::{BlockId, Func, HirType, ManagedType, OpKind, ValueId};

/// What makes two reads one: the operation, its operands, and the type it
/// answers in.
#[derive(Clone, PartialEq, Eq, Hash)]
enum Read {
    /// An erased value read as one representation.
    Unerase(ValueId, HirType),
    /// One code unit of a string. Checked and unchecked reads stay apart, so a
    /// read proven in range never takes the answer of one that may be `NaN`.
    Unit {
        string: ValueId,
        index: ValueId,
        checked: bool,
        ty: HirType,
    },
    /// A string's length.
    Length(ValueId, HirType),
}

/// The read `op` makes, with its operands as the replacements so far name
/// them, or nothing when it is not a pure read.
///
/// Through `of`, because the walk meets a definition before its uses: a read
/// of a replaced value is a read of its twin, so a chain folds in one walk.
fn read_of(func: &Func, op: ValueId, of: impl Fn(ValueId) -> ValueId) -> Option<Read> {
    let value = &func.values[op.0 as usize];
    match value.kind {
        OpKind::Unerase { value: erased } => Some(Read::Unerase(of(erased), value.ty.clone())),
        OpKind::StringUnitAt {
            string,
            index,
            checked,
        } => Some(Read::Unit {
            string: of(string),
            index: of(index),
            checked,
            ty: value.ty.clone(),
        }),
        OpKind::Length(string)
            if matches!(
                func.values[string.0 as usize].ty,
                HirType::Managed(ManagedType::String)
            ) =>
        {
            Some(Read::Length(of(string), value.ty.clone()))
        }
        _ => None,
    }
}

/// The dominator-tree walk, one block at a time: entering a block, and leaving
/// it with the reads it made, which then stop dominating.
enum Step {
    Enter(BlockId),
    Leave(Vec<Read>),
}

/// Replace each pure read dominated by an identical one, returning how many.
pub fn reads_once(func: &mut Func) -> usize {
    let reads_anything = func
        .blocks
        .iter()
        .flat_map(|block| &block.ops)
        .any(|&op| read_of(func, op, |value| value).is_some());
    if !reads_anything {
        return 0;
    }
    let reachable = super::verify::reachable_blocks(func);
    let idom = super::verify::dominators(func, &reachable);
    // The dominator tree, walked from the entry with one scope per block: a
    // twin found in an enclosing scope dominates the operation.
    let mut children: Vec<Vec<BlockId>> = vec![Vec::new(); func.blocks.len()];
    for (index, parent) in idom.iter().enumerate().skip(1) {
        if let (Some(parent), Ok(index)) = (parent, u32::try_from(index)) {
            children[parent.0 as usize].push(BlockId(index));
        }
    }
    let mut first: FxHashMap<Read, ValueId> = FxHashMap::default();
    let mut replaced: FxHashMap<ValueId, ValueId> = FxHashMap::default();
    let mut walk = vec![Step::Enter(BlockId(0))];
    let mut visited: FxHashSet<BlockId> = FxHashSet::default();
    while let Some(step) = walk.pop() {
        let block = match step {
            // Leaving a block: what it read no longer dominates.
            Step::Leave(made) => {
                for read in made {
                    first.remove(&read);
                }
                continue;
            }
            Step::Enter(block) => block,
        };
        if !reachable.contains(&block) || !visited.insert(block) {
            continue;
        }
        let mut made = Vec::new();
        for &op in &func.blocks[block.0 as usize].ops {
            let twin_of = |value: ValueId| replaced.get(&value).copied().unwrap_or(value);
            let Some(read) = read_of(func, op, twin_of) else {
                continue;
            };
            if let Some(&twin) = first.get(&read) {
                replaced.insert(op, twin);
            } else {
                first.insert(read.clone(), op);
                made.push(read);
            }
        }
        walk.push(Step::Leave(made));
        for &child in children[block.0 as usize].iter().rev() {
            walk.push(Step::Enter(child));
        }
    }
    if replaced.is_empty() {
        return 0;
    }
    let of = |value: ValueId| replaced.get(&value).copied().unwrap_or(value);
    for index in 0..func.values.len() {
        let mut kind = func.values[index].kind.clone();
        substitute(&mut kind, of);
        func.values[index].kind = kind;
    }
    for block in &mut func.blocks {
        substitute_terminator(&mut block.terminator, of);
    }
    for obligation in &mut func.obligations {
        obligation.value = of(obligation.value);
    }
    replaced.len()
}
