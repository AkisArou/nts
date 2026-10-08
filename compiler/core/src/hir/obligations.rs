//! Where a value must fit a slot of a written scalar kind, and whether the
//! range analysis proves it does.
//!
//! # Why this exists
//!
//! `docs/scalar-numbers.md` makes such stores *strict*: proven to fit, or a
//! compile error, with no check nts inserts (decisions D1, D2). A store into a
//! written kind is also what makes the kind a fact: a parameter written
//! `n: c_int` may be read as `int`'s range, whole, *because* every call had to
//! prove its argument fits (decision Q1). The two arrive together or not at
//! all.
//!
//! # Where obligations come from
//!
//! **From the slot, where the HIR has one.** A store's operation names where
//! it goes, and the slot records the kind it was written as:
//! - a call names its callee, whose [`super::Param::written`] is the kind;
//! - a native call names the C function, whose parameter types are the kinds;
//! - a field store names the field ([`super::Field::written`]), a global store
//!   the global ([`super::Global::written`]);
//! - a `return` is the function's ([`super::Func::written_return`]), and in a
//!   function C calls back, the callback's C result type too;
//! - a store through a native pointer has the pointee's type, a bit-field's
//!   its width.
//!
//! [`Slots::obligations`] reads them off the operations, so the kind is
//! derived in one place -- the slot -- and a store can't be missed by
//! forgetting to record it.
//!
//! **From the lowering, where it has none:** a local's assignment
//! (`let x: Uint8 = n`), an `n as Uint16` (D4), and an argument to a closure,
//! whose callee is any function of the type. Those the lowering records
//! ([`super::Func::obligations`]) from the checker's types.
//!
//! A typed array's store takes the same `ToInt32` helper as a native call
//! does today and is deliberately *not* an obligation: it keeps JavaScript's
//! wrapping semantics (decision C27).
//!
//! # Which facts may prove one (decision Q2)
//!
//! **Only local ones:** what the function proves alone, its loop bounds, and
//! its written types. Never what callers pass, nor what the whole program
//! stores into a field. The whole-program analysis makes code fast; it must
//! not decide whether code compiles -- otherwise adding a caller in one file
//! breaks a call in another, and a speculative copy's facts would pass for
//! proof. [`local_analysis`] is that rule, in one place.

use nts_diagnostics::Location;
use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::{Analysis, Context, Whole, Written};
use super::native::{Pointee, Scalar};
use super::{BlockId, Callee, Func, Global, HirType, Layout, ManagedType, OpKind, Program, Terminator, TypeId, ValueId};

/// One store into a slot of a written scalar kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Obligation {
    /// The value that must fit, as the program computed it: before any
    /// conversion to the slot's representation.
    pub value: ValueId,
    /// The block the store is made in: a guard on the way in counts.
    pub block: BlockId,
    pub kind: Scalar,
    /// A C bit-field's width, which narrows `kind`'s range to that many bits.
    pub bits: Option<u32>,
    pub into: Into,
    pub location: Location,
}

impl Obligation {
    /// The integers the slot holds, or `None` for a float kind.
    #[must_use]
    pub fn range(&self) -> Option<(i128, i128)> {
        let (lo, hi) = self.kind.integer_range()?;
        Some(match self.bits {
            Some(bits) if lo < 0 => (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1),
            Some(bits) => (0, (1i128 << bits) - 1),
            None => (lo, hi),
        })
    }
}

/// Where the value goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Into {
    /// The `position`th parameter of the program's function `function`,
    /// written as a kind -- through a direct call, or a method's dispatch.
    Parameter { function: String, position: usize },
    /// The `position`th parameter of the native function `function`.
    NativeArgument { function: String, position: usize },
    /// A store through a native pointer: a struct field, a bit-field or a
    /// buffer element.
    NativeStore,
    /// The program's field `field`.
    Field { field: String },
    /// The module-scope variable `global`.
    Global { global: String },
    /// The function's own result, written as a kind.
    Return,
    /// The result of a function C calls back through `callback`, which C
    /// reads as the callback type's result.
    CallbackReturn { callback: String },
    /// A local written as a kind (`let n: Uint8 = ...`, and every later
    /// assignment): recorded by the lowering, as the HIR keeps no slot for it.
    Local { local: String },
    /// The `position`th argument of a call through a function type, whose
    /// parameter is written as a kind: recorded by the lowering, as the callee
    /// is any function of the type.
    ClosureArgument { position: usize },
    /// `n as Uint16`, which nts verifies (D4): recorded by the lowering.
    Assertion,
}

impl Into {
    /// Whether the program can read the value back from the slot, so that
    /// holding it at an integer width would show: then `-0` must be ruled out
    /// (Q3), since node keeps it and `1 / x` tells.
    ///
    /// Not where the value leaves the program -- C, Java and wasm can't tell
    /// `-0` from `0`, and receive the same integer either way -- nor at an
    /// `as`, which stores nothing: the value stays what it was, in nts as in
    /// node, and wherever it is stored next is obliged there.
    #[must_use]
    pub const fn reads_back(&self) -> bool {
        match self {
            Self::Parameter { .. }
            | Self::Field { .. }
            | Self::Global { .. }
            | Self::Return
            | Self::Local { .. }
            | Self::ClosureArgument { .. } => true,
            Self::NativeArgument { .. } | Self::NativeStore | Self::CallbackReturn { .. } | Self::Assertion => false,
        }
    }
}

/// What crosses: a `number` (with what the analysis knows), an integer the
/// program already holds at a width, a `bigint`, a boolean, or something else.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Source {
    Number(Facts),
    /// An integer representation already, with its range.
    Integer { lo: i128, hi: i128 },
    /// A `bigint`: its literal value when it is one, and otherwise unknown.
    BigInt(Option<i128>),
    /// A boolean, which C's integer kinds take as 0 or 1.
    Bool,
    /// `undefined` or `null` into an optional slot: an absence, which fits.
    Absent,
    /// A value of any other representation: an erased union, an `any`.
    Other,
}

/// Why an obligation isn't proven.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Why {
    /// It may not be a whole number.
    Fraction,
    /// It may be NaN.
    NaN,
    /// It may be `-0`, which a program slot held at an integer width would
    /// read back as `0` where node keeps it (`1 / x`): ruled out, or written
    /// (Q3). Only where the program can read it back -- see [`Into::reads_back`].
    NegativeZero,
    /// It may be below the kind's least value: the analysis's lower bound.
    Below(f64),
    /// It may be above the kind's greatest value: the analysis's upper bound.
    Above(f64),
    /// A `bigint` that isn't a literal: the analysis has no bigint ranges yet.
    NoBigIntRanges,
    /// A `bigint` literal outside the kind.
    LiteralOutside(i128),
    /// A `float` slot, and the value may not be exactly a `float` (Q3):
    /// `Math.fround(x)` is the explicit narrowing.
    FloatExactness,
    /// It may not be a number at all: an `any`, or a union the program holds
    /// erased (Q1: `any` into a written kind is a store like any other).
    NotANumber,
}

/// What made the value: which kind of fact would prove it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Made {
    Parameter,
    /// A value from native code: a binding's result.
    NativeResult,
    /// A call to a function of the program.
    ProgramCall,
    /// A call to a runtime helper.
    RuntimeCall,
    Field,
    Element,
    Global,
    Length,
    Arithmetic,
    Literal,
    /// A value joined from several paths: a loop variable, or one assigned
    /// in branches.
    Join,
    Other,
}

/// An obligation, judged.
#[derive(Debug, Clone, PartialEq)]
pub struct Judged {
    /// The program function it is in.
    pub func: String,
    pub obligation: Obligation,
    pub source: Source,
    pub made: Made,
    /// Empty when proven.
    pub unproven: Vec<Why>,
}

impl Judged {
    #[must_use]
    pub fn proven(&self) -> bool {
        self.unproven.is_empty()
    }
}

/// Every obligation in `program`, each judged by [`local_analysis`].
///
/// Meaningful on the program the lowering produced: the obligations it
/// recorded name its values, and a pass that renumbers them, or makes a
/// speculative copy, would leave them stale.
#[must_use]
pub fn census(program: &Program) -> Vec<Judged> {
    let slots = Slots::of(program);
    let written = Written::of(program);
    program
        .funcs
        .iter()
        .flat_map(|func| {
            let obligations = slots.obligations(func);
            if obligations.is_empty() {
                return Vec::new();
            }
            let analysis = local_analysis(func, &written);
            obligations.iter().map(|obligation| slots.judge(func, &analysis, obligation)).collect()
        })
        .collect()
}

/// The program's slots, as a store's operation names them.
struct Slots<'a> {
    by_name: FxHashMap<&'a str, &'a Func>,
    layouts: FxHashMap<TypeId, &'a Layout>,
    globals: &'a [Global],
    /// The C result type of each function a native callback bridges to, by
    /// the function's name, and the callback type's.
    bridged: FxHashMap<&'a str, (Scalar, &'a str)>,
}

impl<'a> Slots<'a> {
    fn of(program: &'a Program) -> Self {
        let by_name: FxHashMap<&str, &Func> = program.funcs.iter().map(|func| (func.name.as_str(), func)).collect();
        let layouts: FxHashMap<TypeId, &Layout> =
            program.layouts.iter().flat_map(|layout| layout.types.iter().map(move |ty| (*ty, layout))).collect();
        let mut bridged = FxHashMap::default();
        for func in &program.funcs {
            for &op in func.blocks.iter().flat_map(|block| &block.ops) {
                let OpKind::NativeBridge { closure, signature, .. } = &func.value(op).kind else { continue };
                let super::native::Type::Scalar(kind) = *signature.result else { continue };
                let HirType::Managed(ManagedType::Object(ty)) = func.value(*closure).ty else { continue };
                // The function the bridge calls, as `native_callback` finds it.
                if let Some(body) = layouts.get(&ty).and_then(|layout| layout.closure_call()) {
                    bridged.insert(body, (kind, signature.name.as_str()));
                }
            }
        }
        Self { by_name, layouts, globals: &program.globals, bridged }
    }

    /// `func`'s obligations: each store into a slot of a written kind, read
    /// off its operation, then those the lowering recorded.
    fn obligations(&self, func: &Func) -> Vec<Obligation> {
        let mut found = Vec::new();
        for (index, block) in func.blocks.iter().enumerate() {
            let block_id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
            let mut oblige = |at: ValueId, value: ValueId, (kind, bits): (Scalar, Option<u32>), into: Into| {
                let location = func.value(at).origin.location;
                found.push(Obligation { value: before_conversion(func, value), block: block_id, kind, bits, into, location });
            };
            for &op in &block.ops {
                match &func.value(op).kind {
                    OpKind::Call { callee, args, .. } => match callee {
                        // A method's dispatch reaches the declaration or an
                        // override of it, which can't write its parameter
                        // narrower (Q1).
                        Callee::Direct(name) | Callee::Virtual { declared: name, .. } => {
                            let Some(callee) = self.by_name.get(name.as_str()) else { continue };
                            for (position, (param, &argument)) in callee.params.iter().zip(args).enumerate() {
                                if let Some(kind) = param.written {
                                    oblige(op, argument, (kind, None), Into::Parameter { function: name.clone(), position });
                                }
                            }
                        }
                        Callee::Native(target) => {
                            for (position, (parameter, &argument)) in target.parameters.iter().zip(args).enumerate() {
                                if let super::native::Type::Scalar(kind) = parameter {
                                    let into = Into::NativeArgument { function: target.name.clone(), position };
                                    oblige(op, argument, (*kind, None), into);
                                }
                            }
                        }
                        // A runtime helper's parameters aren't written by the
                        // program; a closure's callee is any function of the
                        // type, which the lowering obliges from the type.
                        Callee::External(_) | Callee::Closure { .. } => {}
                    },
                    OpKind::NativeStore { pointer, value, .. } => {
                        if let HirType::NativePointer(pointee) = &func.value(*pointer).ty
                            && let Some(kind) = stored_kind(pointee)
                        {
                            oblige(op, *value, kind, Into::NativeStore);
                        }
                    }
                    OpKind::NativeBitStore { pointer, field, value } => {
                        if let HirType::NativePointer(pointee) = &func.value(*pointer).ty
                            && let Some(member) = record_of(pointee).and_then(|record| record.fields.get(*field as usize))
                            && let Some(kind) = stored_kind(&member.ty)
                        {
                            oblige(op, *value, kind, Into::NativeStore);
                        }
                    }
                    OpKind::FieldSet { object, field, value } => {
                        if let Some((kind, name)) = self.field(&func.value(*object).ty, *field) {
                            oblige(op, *value, (kind, None), Into::Field { field: name.to_owned() });
                        }
                    }
                    // Each layout that can arrive; their kinds agree (Q1),
                    // and each is obliged, so a disagreement is still caught.
                    OpKind::OpenFieldSet { arms, value, .. } => {
                        let mut kinds: Vec<(Scalar, &str)> = Vec::new();
                        for arm in arms {
                            let object = HirType::Managed(ManagedType::Object(arm.ty));
                            if let Some(found) = self.field(&object, arm.field)
                                && !kinds.iter().any(|(kind, _)| *kind == found.0)
                            {
                                kinds.push(found);
                            }
                        }
                        for (kind, name) in kinds {
                            oblige(op, *value, (kind, None), Into::Field { field: name.to_owned() });
                        }
                    }
                    OpKind::GlobalSet { global, value } => {
                        if let Some(slot) = self.globals.get(*global as usize)
                            && let Some(kind) = slot.written
                        {
                            oblige(op, *value, (kind, None), Into::Global { global: slot.name.clone() });
                        }
                    }
                    _ => {}
                }
            }
            if let Terminator::Return(Some(value)) = block.terminator {
                if let Some(kind) = func.written_return {
                    oblige(value, value, (kind, None), Into::Return);
                }
                if let Some(&(kind, callback)) = self.bridged.get(func.name.as_str()) {
                    oblige(value, value, (kind, None), Into::CallbackReturn { callback: callback.to_owned() });
                }
            }
        }
        found.extend(func.obligations.iter().map(|obligation| Obligation {
            value: before_conversion(func, obligation.value),
            ..obligation.clone()
        }));
        found
    }

    /// The kind a field of an object of type `object` was written as, and its
    /// name.
    fn field(&self, object: &HirType, field: u32) -> Option<(Scalar, &'a str)> {
        let HirType::Managed(ManagedType::Object(ty)) = object else { return None };
        let field = self.layouts.get(ty)?.fields.get(field as usize)?;
        Some((field.written?, field.name.as_str()))
    }
}

/// The kind a store through a pointer to `pointee` writes, and a bit-field's
/// width.
fn stored_kind(pointee: &Pointee) -> Option<(Scalar, Option<u32>)> {
    match pointee {
        Pointee::Scalar(kind) => Some((*kind, None)),
        Pointee::Bits { unit, width } => Some((*unit, Some(*width))),
        Pointee::Unaligned(inner) | Pointee::Const(inner) => stored_kind(inner),
        _ => None,
    }
}

/// The record a pointer to `pointee` points at.
fn record_of(pointee: &Pointee) -> Option<&super::native::Record> {
    match pointee {
        Pointee::Record(record) => Some(record),
        Pointee::Unaligned(inner) | Pointee::Const(inner) => record_of(inner),
        _ => None,
    }
}

/// The value as the program computed it, before the conversion that made it
/// the slot's representation: a `Convert`, or JavaScript's `ToInt32` family
/// ([`super::builtin::element_coercion`]), which a native call applies today
/// and step 1g deletes.
fn before_conversion(func: &Func, value: ValueId) -> ValueId {
    let op = func.value(value);
    match &op.kind {
        // An optional slot holds its value erased beside the tag that says
        // it is there.
        OpKind::Convert(from) | OpKind::Erase { value: from, .. } => *from,
        OpKind::Call { callee: Callee::External(name), args, .. }
            if super::builtin::element_coercion(&op.ty) == Some(name.as_str()) =>
        {
            args.first().copied().unwrap_or(value)
        }
        _ => value,
    }
}

/// What a strict obligation may rely on in `func` (decision Q2): the function
/// alone, with what the program wrote (`written`, and each parameter's
/// kind), and its loops' bounds -- which
/// [`super::loops::accumulator_caps`] counts from the function itself. The caps
/// feed the analysis and the analysis feeds the caps, so the two are run to a
/// fixpoint, as the whole-program driver runs them.
#[must_use]
pub fn local_analysis(func: &Func, written: &Written) -> Analysis {
    let whole = Whole::default();
    let mut caps: FxHashMap<ValueId, Facts> = FxHashMap::default();
    let analyze = |caps: &FxHashMap<ValueId, Facts>| {
        super::flow::analyze_with(func, &Context { params: &[], caps, param_lengths: &[], whole: &whole, written })
    };
    let mut analysis = analyze(&caps);
    // Each round only adds caps it has proven; a loop nest is not deeper than
    // the function has blocks, which bounds the rounds.
    for _ in 0..func.blocks.len().max(1) {
        let next = super::loops::accumulator_caps(func, &analysis);
        if next == caps {
            break;
        }
        caps = next;
        analysis = analyze(&caps);
    }
    analysis
}

impl Slots<'_> {
fn judge(&self, func: &Func, analysis: &Analysis, obligation: &Obligation) -> Judged {
    let value = obligation.value;
    let (source, unproven) = match func.value(value).ty {
        HirType::Float { .. } => {
            let facts = analysis.get_at(obligation.block, value);
            let exact = obligation.kind == Scalar::Float
                && self.exact_in_float(func, analysis, (obligation.block, value), &mut Vec::new());
            (Source::Number(facts), number_fits(facts, obligation, exact))
        }
        HirType::Int { bits, signed } => {
            let (lo, hi) = if signed {
                let half = 1i128 << (bits - 1);
                (-half, half - 1)
            } else {
                (0, (1i128 << bits) - 1)
            };
            let mut why = Vec::new();
            if let Some((least, greatest)) = obligation.range() {
                #[allow(clippy::cast_precision_loss)]
                if lo < least {
                    why.push(Why::Below(lo as f64));
                }
                #[allow(clippy::cast_precision_loss)]
                if hi > greatest {
                    why.push(Why::Above(hi as f64));
                }
            }
            (Source::Integer { lo, hi }, why)
        }
        HirType::BigInt => {
            let literal = match func.value(value).kind {
                OpKind::ConstInt(literal) => Some(literal),
                _ => None,
            };
            let why = match (literal, obligation.range()) {
                (Some(literal), Some((lo, hi))) if literal < lo || literal > hi => vec![Why::LiteralOutside(literal)],
                (Some(_), _) => Vec::new(),
                (None, _) => vec![Why::NoBigIntRanges],
            };
            (Source::BigInt(literal), why)
        }
        HirType::Bool => {
            let fits = obligation.range().is_none_or(|(lo, hi)| lo <= 0 && hi >= 1);
            (Source::Bool, if fits { Vec::new() } else { vec![Why::Above(1.0)] })
        }
        // An optional slot's absence (`x?: Uint8`, S4).
        _ if matches!(func.value(value).kind, OpKind::ConstUndefined | OpKind::ConstNull) => (Source::Absent, Vec::new()),
        _ => (Source::Other, vec![Why::NotANumber]),
    };
    Judged { func: func.name.clone(), obligation: obligation.clone(), source, made: made_by(func, value), unproven }
}

/// Whether `value`, at `block`, is exactly a `float`, which a `float` slot
/// then stores unchanged (Q3).
///
/// Judged from how the value was made rather than tracked by the analysis:
/// `Math.fround(x)`, the explicit narrowing; a value that was a `float`
/// already -- C's, or read from a slot written `float`; a number a `float`
/// holds exactly; or a join of those.
fn exact_in_float(&self, func: &Func, analysis: &Analysis, (block, value): (BlockId, ValueId), seen: &mut Vec<ValueId>) -> bool {
    /// Every integer up to 2^24 is a `float`.
    const FLOAT_INTEGERS: f64 = 16_777_216.0;
    let facts = analysis.get_at(block, value);
    #[allow(clippy::cast_possible_truncation)]
    let single = facts.is_singleton() && !facts.maybe_nan && f64::from(facts.lo as f32).to_bits() == facts.lo.to_bits();
    if single || facts.integral() && facts.lo >= -FLOAT_INTEGERS && facts.hi <= FLOAT_INTEGERS {
        return true;
    }
    let float = Some(Scalar::Float);
    match &func.value(value).kind {
        OpKind::Call { callee: Callee::External(name), .. } => name == "nts_math_fround",
        OpKind::Call { callee: Callee::Native(target), .. } => target.result == super::native::Type::Scalar(Scalar::Float),
        OpKind::Call { callee: Callee::Direct(name), .. } => self.by_name.get(name.as_str()).is_some_and(|callee| callee.written_return == float),
        OpKind::Convert(from) => func.value(*from).ty == HirType::Float { bits: 32 },
        OpKind::Param(slot) => func.params.get(*slot as usize).is_some_and(|param| param.written == float),
        OpKind::FieldGet { object, field } => self.field(&func.value(*object).ty, *field).is_some_and(|(kind, _)| kind == Scalar::Float),
        OpKind::GlobalGet(global) => self.globals.get(*global as usize).is_some_and(|slot| slot.written == float),
        OpKind::BlockParam(_) => {
            if seen.contains(&value) {
                return true;
            }
            seen.push(value);
            incoming(func, value).into_iter().all(|edge| self.exact_in_float(func, analysis, edge, seen))
        }
        _ => false,
    }
}
}

/// What each edge into the block that defines the block parameter `param`
/// passes for it, with the block the edge leaves.
fn incoming(func: &Func, param: ValueId) -> Vec<(BlockId, ValueId)> {
    let Some((target, at)) = func.blocks.iter().enumerate().find_map(|(index, block)| {
        Some((BlockId(u32::try_from(index).ok()?), block.params.iter().position(|p| *p == param)?))
    }) else {
        return Vec::new();
    };
    let mut passed = Vec::new();
    for (index, block) in func.blocks.iter().enumerate() {
        let from = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
        let edges: Vec<(BlockId, &Vec<ValueId>)> = match &block.terminator {
            Terminator::Jump { target, args } => vec![(*target, args)],
            Terminator::Branch { then_target, then_args, else_target, else_args, .. } => {
                vec![(*then_target, then_args), (*else_target, else_args)]
            }
            Terminator::Return(_) | Terminator::Unreachable | Terminator::FellThrough => Vec::new(),
        };
        passed.extend(edges.into_iter().filter(|(to, _)| *to == target).filter_map(|(_, args)| Some((from, *args.get(at)?))));
    }
    passed
}

/// Why `facts` may not fit the obligation's slot, or nothing when it does;
/// `exact` is whether the value is exactly a `float`, which a `float` slot
/// asks.
fn number_fits(facts: Facts, obligation: &Obligation, exact: bool) -> Vec<Why> {
    let Some((least, greatest)) = obligation.range() else {
        // A `double` slot holds every `number`.
        return if obligation.kind == Scalar::Double || exact { Vec::new() } else { vec![Why::FloatExactness] };
    };
    let mut why = Vec::new();
    if !facts.whole {
        why.push(Why::Fraction);
    }
    if facts.maybe_nan {
        why.push(Why::NaN);
    }
    if facts.maybe_negative_zero && obligation.into.reads_back() {
        why.push(Why::NegativeZero);
    }
    // As `f64`: the integer bounds are exact up to 2^53, and past it no
    // `number` is provably whole anyway.
    #[allow(clippy::cast_precision_loss)]
    let (lo, hi) = (least as f64, greatest as f64);
    if facts.lo < lo {
        why.push(Why::Below(facts.lo));
    }
    if facts.hi > hi {
        why.push(Why::Above(facts.hi));
    }
    why
}

fn made_by(func: &Func, value: ValueId) -> Made {
    match &func.value(value).kind {
        OpKind::Param(_) => Made::Parameter,
        OpKind::BlockParam(_) => Made::Join,
        OpKind::Call { callee: Callee::Native(_), .. } => Made::NativeResult,
        OpKind::Call { callee: Callee::Direct(_), .. } => Made::ProgramCall,
        OpKind::Call { callee: Callee::External(_), .. } => Made::RuntimeCall,
        OpKind::FieldGet { .. } => Made::Field,
        OpKind::ArrayGet { .. } => Made::Element,
        OpKind::GlobalGet(_) => Made::Global,
        OpKind::Length(_) => Made::Length,
        OpKind::Binary { .. } | OpKind::Unary { .. } => Made::Arithmetic,
        OpKind::ConstFloat(_) | OpKind::ConstInt(_) => Made::Literal,
        // A conversion between number representations says nothing new about
        // where the value came from: look through it.
        OpKind::Convert(from) => made_by(func, *from),
        _ => Made::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::{number_fits, Into, Obligation, Why};
    use crate::hir::facts::Facts;
    use crate::hir::native::Scalar;
    use crate::hir::{BlockId, ValueId};

    fn into(kind: Scalar, bits: Option<u32>) -> Obligation {
        Obligation {
            value: ValueId(0),
            block: BlockId(0),
            kind,
            bits,
            into: Into::NativeStore,
            location: nts_diagnostics::Location { file: nts_diagnostics::SourceId(0), span: nts_diagnostics::Span::new(0, 0) },
        }
    }

    #[test]
    fn a_whole_number_in_range_fits() {
        assert!(number_fits(Facts::new(0.0, 255.0, true, false, false), &into(Scalar::UInt8, None), false).is_empty());
    }

    #[test]
    fn negative_zero_matters_only_where_the_program_reads_it_back() {
        let maybe_negative_zero = Facts::new(0.0, 255.0, true, false, true);
        assert!(
            number_fits(maybe_negative_zero, &into(Scalar::UInt8, None), false).is_empty(),
            "C stores -0 and 0 as the same integer"
        );
        let field = Obligation { into: Into::Field { field: "size".to_owned() }, ..into(Scalar::UInt8, None) };
        assert_eq!(
            number_fits(maybe_negative_zero, &field, false),
            vec![Why::NegativeZero],
            "a field held at an integer width would read back 0 where node keeps -0"
        );
    }

    #[test]
    fn each_way_of_not_fitting_is_named() {
        let byte = into(Scalar::UInt8, None);
        assert_eq!(number_fits(Facts::new(0.0, 256.0, true, false, false), &byte, false), vec![Why::Above(256.0)]);
        assert_eq!(number_fits(Facts::new(-1.0, 10.0, true, false, false), &byte, false), vec![Why::Below(-1.0)]);
        assert_eq!(number_fits(Facts::new(0.0, 10.0, false, true, false), &byte, false), vec![Why::Fraction, Why::NaN]);
        assert!(number_fits(Facts::TOP, &into(Scalar::Double, None), false).is_empty());
        assert_eq!(number_fits(Facts::new(0.0, 1.0, true, false, false), &into(Scalar::Float, None), false), vec![Why::FloatExactness]);
        assert!(number_fits(Facts::new(0.0, 1.0, true, false, false), &into(Scalar::Float, None), true).is_empty());
    }

    #[test]
    fn a_bit_field_narrows_its_unit() {
        assert_eq!(into(Scalar::UInt32, Some(3)).range(), Some((0, 7)));
        assert_eq!(into(Scalar::Int32, Some(3)).range(), Some((-4, 3)));
        assert_eq!(number_fits(Facts::new(0.0, 8.0, true, false, false), &into(Scalar::UInt32, Some(3)), false), vec![Why::Above(8.0)]);
    }
}
