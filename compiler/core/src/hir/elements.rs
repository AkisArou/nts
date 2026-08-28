//! What an array's elements can hold.
//!
//! # The hole this fills
//!
//! [`super::fields::analyze`] gives a *field* read the facts of every store into
//! it, so `this.count` is not an unknown number. An *element* read had nothing
//! at all: `xs[i]` was TOP however obvious its contents.
//!
//! That is expensive in a way that is easy to miss. An array of `number` is
//! `double[]`, so an element arrives as a double; with no facts about it,
//! nothing can prove it whole, and every use of it stays floating point. The
//! `dispatch` benchmark is the clearest case — an array holding only the values
//! `0` to `7`, switched on, compiled to a chain of *floating-point* comparisons,
//! which no C compiler will turn into a jump table.
//!
//! # Why the key is the element type
//!
//! A field's aliasing question is answered by `shares_storage`: a store through
//! a base-typed pointer lands in a known set of layouts. An array has no such
//! structure — `number[]` is one type, and any `number[]` can be passed
//! anywhere another is expected — so every array with the same element type has
//! to be treated as one.
//!
//! That is coarse, and correct rather than convenient: one array of fractions
//! anywhere in a program costs every `number[]` in it the narrowing. The
//! alternative is deciding which array *values* can reach which reads, which is
//! a points-to analysis and a much larger thing than the win here.
//!
//! # Where it has to give up
//!
//! An array this program did not fill. A root's parameter comes from outside the
//! compiled set, and an external call's result was built somewhere this cannot
//! see — either can hold anything, so its element type is TOP and so is every
//! read of one.
//!
//! And, separately, an array this program does not solely *read*: one handed to
//! a runtime helper is stored the way that helper was compiled to expect. That
//! is a limit on the storage rather than on the contents, so it lives in
//! [`representations`].

use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::Analysis;
use super::{Callee, HirType, ManagedType, OpKind, Program};

/// What the elements of each array type can hold.
pub type ElementFacts = FxHashMap<HirType, Facts>;

/// Join every store into every array, by element type.
pub(super) fn analyze(
    program: &Program,
    analyses: &[Analysis],
    outward: &rustc_hash::FxHashSet<&str>,
) -> ElementFacts {
    // An allocation leaves zeros, and `new Array(n)` is reachable as an element
    // nothing wrote. Seeded per element type as the stores are found, so a type
    // no array of which is ever allocated here stays absent.
    let mut stored: ElementFacts = FxHashMap::default();
    let mut opaque: rustc_hash::FxHashSet<HirType> = rustc_hash::FxHashSet::default();

    for (index, func) in program.funcs.iter().enumerate() {
        // An array that crosses the boundary of the compiled set was filled
        // where this cannot look.
        if outward.contains(func.name.as_str()) {
            for ty in func
                .params
                .iter()
                .map(|param| &param.ty)
                .chain(std::iter::once(&func.return_type))
            {
                if let HirType::Managed(ManagedType::Array(element)) = ty {
                    opaque.insert((**element).clone());
                }
            }
        }
        for op in &func.values {
            match &op.kind {
                OpKind::ArrayNew { .. } => {
                    if let HirType::Managed(ManagedType::Array(element)) = &op.ty {
                        let entry = stored
                            .entry((**element).clone())
                            .or_insert(Facts::constant(0.0));
                        *entry = entry.join(Facts::constant(0.0));
                    }
                }
                OpKind::ArraySet { array, value, .. } => {
                    let HirType::Managed(ManagedType::Array(element)) =
                        &func.values[array.0 as usize].ty
                    else {
                        continue;
                    };
                    let entry = stored
                        .entry((**element).clone())
                        .or_insert(Facts::constant(0.0));
                    *entry = entry.join(analyses[index].get(*value));
                }
                // `fill` writes one value into every slot, and `push` appends
                // one. Both are stores that no `ArraySet` records.
                OpKind::Call {
                    callee: Callee::External(name),
                    args,
                    ..
                } => {
                    let writes = matches!(name.as_str(), "nts_array_fill" | "nts_array_push");
                    if !writes {
                        // Anything else that hands back an array built
                        // elsewhere. `slice` and `reverse` return this
                        // program's own array, so they say nothing new.
                        if let HirType::Managed(ManagedType::Array(element)) = &op.ty
                            && !RETURNS_ITS_ARRAY.contains(&name.as_str())
                        {
                            opaque.insert((**element).clone());
                        }
                        continue;
                    }
                    let (Some(array), Some(value)) = (args.first(), args.get(1)) else {
                        continue;
                    };
                    let HirType::Managed(ManagedType::Array(element)) =
                        &func.values[array.0 as usize].ty
                    else {
                        continue;
                    };
                    let entry = stored
                        .entry((**element).clone())
                        .or_insert(Facts::constant(0.0));
                    *entry = entry.join(analyses[index].get(*value));
                }
                _ => {}
            }
        }
    }

    stored.retain(|element, _| !opaque.contains(element));
    stored
}

/// The array methods that hand back the array they were given, rather than one
/// built somewhere this analysis cannot see.
const RETURNS_ITS_ARRAY: &[&str] = &[
    "nts_array_fill",
    "nts_array_fill_bool",
    "nts_array_fill_ref",
    "nts_array_reverse",
];

/// What each array type's elements should be *stored* as.
///
/// The storage question, where [`analyze`] answers the contents question. An
/// array of `number` holding only small whole numbers is `int32_t[]`: half the
/// memory, and — the reason this was written — an element that arrives as an
/// integer rather than as a double, so what follows it is integer arithmetic.
///
/// The same decision [`super::fields::representations`] makes for a field, with
/// the coarser aliasing key [`analyze`] explains.
///
/// # Fitting is not enough: the elements have to be *used* as integers
///
/// Narrowing pays when what follows a read is integer work, and costs when the
/// value goes straight back to floating point — the conversion is worth more
/// than the narrower load saves. Both cases are in the benchmark suite and they
/// point opposite ways:
///
/// - `dispatch` reads an opcode and compares it. Narrowing takes it from 4.40x
///   the C++ reference to parity, because a chain of *floating-point*
///   comparisons is one no compiler will turn into a jump table.
/// - `arrays` reads an element and accumulates it into a `double`. Narrowing
///   made it 9% slower, because every element was converted back at the point
///   of use.
///
/// So a type is narrowed only when no read of it feeds a floating-point result.
/// That is a property of the program rather than a guess about it, and it is
/// checked before anything is rewritten.
///
/// # And only when this compiler owns the storage
///
/// `xs.indexOf(n)` is `nts_array_index_of`, which is compiled ahead of any
/// program and reads the block through `nts_numbers` — a `const double *`.
/// Narrowing the array under it does not make the helper read `int32_t`; it
/// makes the helper read pairs of them as doubles. The `array-methods`
/// benchmark caught exactly that, silently returning -512 where node returns
/// 4864.
///
/// A helper's signature *is* the element representation, so an array that
/// reaches one cannot be re-represented. See [`reaches_a_runtime_helper`].
pub(super) fn representations(
    program: &Program,
    facts: &ElementFacts,
) -> FxHashMap<HirType, HirType> {
    let converted = read_into_floating_point(program);
    let borrowed = reaches_a_runtime_helper(program);
    facts
        .iter()
        .filter(|(element, _)| matches!(element, HirType::Float { .. }))
        .filter(|(element, _)| !converted.contains(*element))
        .filter(|(element, _)| !borrowed.contains(*element))
        .filter_map(|(element, facts)| Some((element.clone(), width_for(*facts)?)))
        .collect()
}

/// Element types whose arrays are handed to the runtime.
///
/// Every helper that touches elements fixes their width in its own compiled
/// code — `nts_numbers` for a `number[]`, and a parallel family for the other
/// element kinds. This compiler can choose the storage for an array only while
/// it is the only thing that reads it.
///
/// The test is deliberately the crude one: *any* external call taking the
/// array. A narrower rule would have to say which helpers read elements and at
/// what width, which is a second, unchecked copy of the runtime's signatures —
/// and the failure mode of getting it wrong is silently wrong output rather
/// than a compile error. Nothing in the benchmark suite pays for the crudeness:
/// an array used through helpers is one whose loop is inside the runtime.
fn reaches_a_runtime_helper(program: &Program) -> rustc_hash::FxHashSet<HirType> {
    let mut borrowed = rustc_hash::FxHashSet::default();
    for func in &program.funcs {
        for op in &func.values {
            let OpKind::Call {
                callee: Callee::External(_),
                args,
                ..
            } = &op.kind
            else {
                continue;
            };
            for arg in args {
                if let HirType::Managed(ManagedType::Array(element)) =
                    &func.values[arg.0 as usize].ty
                {
                    borrowed.insert((**element).clone());
                }
            }
        }
    }
    borrowed
}

/// Element types whose reads flow into a floating-point operation.
///
/// Narrowing one of these buys a smaller load and pays for it at every use.
fn read_into_floating_point(program: &Program) -> rustc_hash::FxHashSet<HirType> {
    let mut converted = rustc_hash::FxHashSet::default();
    for func in &program.funcs {
        // Which values are element reads, and of what.
        let mut element_of: FxHashMap<u32, HirType> = FxHashMap::default();
        for (index, op) in func.values.iter().enumerate() {
            let OpKind::ArrayGet { array, .. } = op.kind else {
                continue;
            };
            if let HirType::Managed(ManagedType::Array(element)) = &func.values[array.0 as usize].ty
            {
                element_of.insert(u32::try_from(index).unwrap_or(0), (**element).clone());
            }
        }
        if element_of.is_empty() {
            continue;
        }
        for op in &func.values {
            if !matches!(op.ty, HirType::Float { .. }) {
                continue;
            }
            for operand in super::verify::operands(&op.kind) {
                if let Some(element) = element_of.get(&operand.0) {
                    converted.insert(element.clone());
                }
            }
        }
    }
    converted
}

/// The narrowest integer a set of values fits in, if any.
///
/// A `NaN` or a negative zero is not an integer, and neither is a fraction. The
/// second is the one that matters here: an array of prices is `number[]` too.
fn width_for(facts: Facts) -> Option<HirType> {
    if facts.is_bottom() || !facts.whole || facts.maybe_nan || facts.maybe_negative_zero {
        return None;
    }
    let bits = if facts.lo >= -2_147_483_648.0 && facts.hi <= 2_147_483_647.0 {
        32
    } else if facts.lo >= super::facts::SAFE_MIN && facts.hi <= super::facts::SAFE_MAX {
        64
    } else {
        return None;
    };
    Some(HirType::Int { bits, signed: true })
}

/// Apply the decision, and report how many array types changed.
///
/// Every place an array type is spelled has to move together — a parameter, a
/// return, a value, a field — because they are one type and C will not take one
/// for the other. The reads are retyped with them; the conversions that leaves
/// are inserted by [`super::specialize`], which runs afterwards for exactly
/// this reason.
pub(super) fn narrow(program: &mut Program, narrowed: &FxHashMap<HirType, HirType>) -> usize {
    if narrowed.is_empty() {
        return 0;
    }
    let rewrite = |ty: &mut HirType| retype(ty, narrowed);

    for layout in &mut program.layouts {
        for field in &mut layout.fields {
            rewrite(&mut field.ty);
        }
    }
    for func in &mut program.funcs {
        for param in &mut func.params {
            rewrite(&mut param.ty);
        }
        rewrite(&mut func.return_type);
        for op in &mut func.values {
            rewrite(&mut op.ty);
        }
        // An element read produces what the array now holds.
        for index in 0..func.values.len() {
            let OpKind::ArrayGet { array, .. } = func.values[index].kind else {
                continue;
            };
            if let HirType::Managed(ManagedType::Array(element)) =
                func.values[array.0 as usize].ty.clone()
            {
                func.values[index].ty = (*element).clone();
            }
        }
    }
    narrowed.len()
}

/// Replace a narrowed element type wherever it appears inside a type.
fn retype(ty: &mut HirType, narrowed: &FxHashMap<HirType, HirType>) {
    if let HirType::Managed(ManagedType::Array(element)) = ty {
        retype(element, narrowed);
        if let Some(replacement) = narrowed.get(element.as_ref()) {
            **element = replacement.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::facts::Facts;
    use crate::hir::{Block, Func, Op, Terminator, ValueId};
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::Origin;

    fn origin() -> Origin {
        Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        })
    }

    fn numbers() -> HirType {
        HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)))
    }

    fn op(kind: OpKind, ty: HirType) -> Op {
        Op {
            kind,
            ty,
            origin: origin(),
        }
    }

    /// `const xs = [0]; <handed to `helper`, or not>` — the array is value 1.
    fn program(helper: Option<&str>) -> Program {
        let mut values = vec![
            op(OpKind::ConstFloat(1.0), HirType::NUMBER),
            op(OpKind::ArrayNew { length: ValueId(0) }, numbers()),
        ];
        if let Some(name) = helper {
            values.push(op(
                OpKind::Call {
                    callee: Callee::External(name.to_owned()),
                    args: vec![ValueId(1)],
                    frame: None,
                },
                HirType::NUMBER,
            ));
        }
        let ops = (0..values.len())
            .map(|i| ValueId(u32::try_from(i).expect("a handful of values")))
            .collect();
        Program {
            funcs: vec![Func {
                name: "work".to_owned(),
                params: Vec::new(),
                return_type: HirType::Void,
                values,
                blocks: vec![Block {
                    params: Vec::new(),
                    ops,
                    terminator: Terminator::Return(None),
                }],
                origin: origin(),
                exported: true,
                initializes_receiver: false,
            }],
            layouts: Vec::new(),
            globals: Vec::new(),
        }
    }

    /// The elements fit in an `int32_t` and nothing else reads the block, so
    /// this compiler is free to choose the storage.
    #[test]
    fn an_array_only_this_program_reads_is_narrowed() {
        let facts = ElementFacts::from_iter([(HirType::NUMBER, Facts::constant(3.0))]);
        let chosen = representations(&program(None), &facts);
        assert_eq!(
            chosen.get(&HirType::NUMBER),
            Some(&HirType::Int {
                bits: 32,
                signed: true
            })
        );
    }

    /// The same elements, but `nts_array_index_of` reads the block as
    /// `const double *`. Narrowing under it does not make the helper read
    /// `int32_t`, it makes the helper read pairs of them as doubles — which is
    /// how the `array-methods` benchmark came to return -512 for 4864.
    #[test]
    fn an_array_a_runtime_helper_reads_keeps_its_width() {
        let facts = ElementFacts::from_iter([(HirType::NUMBER, Facts::constant(3.0))]);
        let chosen = representations(&program(Some("nts_array_index_of")), &facts);
        assert!(chosen.is_empty(), "narrowed under a helper: {chosen:?}");
    }
}
