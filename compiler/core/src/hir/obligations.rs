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
//! A typed array's store is deliberately *not* an obligation: it keeps
//! JavaScript's wrapping semantics (decision C27).
//!
//! # Which facts may prove one (decision Q2)
//!
//! **Only local ones:** what the function proves alone, its loop bounds, and
//! its written types. Never what callers pass, nor what the whole program
//! stores into a field. The whole-program analysis makes code fast; it must
//! not decide whether code compiles -- otherwise adding a caller in one file
//! breaks a call in another, and a speculative copy's facts would pass for
//! proof. [`local_analysis`] is that rule, in one place.

use nts_diagnostics::{Diagnostic, Location};
use rustc_hash::FxHashMap;

use super::facts::Facts;
use super::flow::{Analysis, Context, Whole, Written};
use super::native::{NativeAbi, Pointee, Scalar};
use super::{BinOp, BlockId, Callee, Func, Global, HirType, Layout, ManagedType, OpKind, Program, Terminator, TypeId, UnOp, ValueId};

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
        range_of(self.kind, self.bits)
    }
}

/// The integers `kind` holds -- `bits` of them, for a bit-field -- or `None`
/// for a float kind.
fn range_of(kind: Scalar, bits: Option<u32>) -> Option<(i128, i128)> {
    let (lo, hi) = kind.integer_range()?;
    Some(match bits {
        Some(bits) if lo < 0 => (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1),
        Some(bits) => (0, (1i128 << bits) - 1),
        None => (lo, hi),
    })
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
    /// A `bigint`, with the exact range [`Slots::bigint_ranges`] proved.
    BigInt { lo: i128, hi: i128 },
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
    /// [`Self::Below`], for an integer or a `bigint`, whose bound is exact.
    ExactlyBelow(i128),
    /// [`Self::Above`], for an integer or a `bigint`.
    ExactlyAbove(i128),
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

/// Every obligation in `program`, each judged by [`local_analysis`], against
/// its kind as every one of `targets` holds it ([`Scalar::on`]).
///
/// Meaningful on the program the lowering produced: the obligations it
/// recorded name its values, and a pass that renumbers them, or makes a
/// speculative copy, would leave them stale.
#[must_use]
pub fn census(program: &Program, targets: &[NativeAbi]) -> Vec<Judged> {
    let slots = Slots::of(program, targets);
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
            // Only a function that obliges a `bigint` pays for their ranges.
            let bigints = std::cell::OnceCell::new();
            obligations.iter().map(|obligation| slots.judge(func, (&analysis, &bigints), obligation)).collect()
        })
        .collect()
}

/// The strict check (`docs/scalar-numbers.md`, D1, D2, Q1): every store into
/// a written kind proven by local facts, and no function let in where a call
/// could hand it a kind it relies on and was never obliged to fit. Each
/// failure is a compile error -- nts inserts no check the program didn't
/// write.
///
/// An `as` and the slot it feeds are one claim about one value, reported once
/// and at the `as`, where the program made it.
#[must_use]
pub fn check(program: &Program, arrivals: &[super::lower::Arrival], targets: &[NativeAbi]) -> Vec<Diagnostic> {
    let slots = Slots::of(program, targets);
    let mut unproven: Vec<Judged> = census(program, targets).into_iter().filter(|judged| !judged.proven()).collect();
    // The `as` first, so it is the one kept.
    unproven.sort_by_key(|judged| judged.obligation.into != Into::Assertion);
    let mut kept: Vec<&Judged> = Vec::new();
    for judged in &unproven {
        let same = |other: &&Judged| {
            other.func == judged.func
                && other.obligation.value == judged.obligation.value
                && other.obligation.range() == judged.obligation.range()
        };
        if !kept.iter().any(same) {
            kept.push(judged);
        }
    }
    let mut errors: Vec<Diagnostic> = kept.into_iter().map(|judged| slots.unproven(judged)).collect();
    errors.extend(slots.closures_relying_on_kinds(arrivals));
    errors.extend(slots.overrides_writing_kinds_otherwise(program));
    errors.sort_by_key(|error| (error.primary.file.0, error.primary.span.start));
    errors
}

/// A kind as a message names it: its C spelling, a bit-field's width, and
/// the range.
fn spelled(kind: Scalar, bits: Option<u32>) -> String {
    let name = super::native::Type::Scalar(kind).c_type().into_owned();
    let width = bits.map_or_else(String::new, |bits| format!(" : {bits}"));
    match range_of(kind, bits) {
        Some((lo, hi)) => format!("`{name}{width}` ({lo}..{hi})"),
        None => format!("`{name}`"),
    }
}

/// A slot's kind or its absence, as a message names it.
fn kind_or_number(kind: Option<Scalar>) -> String {
    kind.map_or_else(|| "a plain `number`".to_owned(), |kind| spelled(kind, None))
}

/// The program's slots, as a store's operation names them.
struct Slots<'a> {
    by_name: FxHashMap<&'a str, &'a Func>,
    layouts: FxHashMap<TypeId, &'a Layout>,
    globals: &'a [Global],
    /// The C result type of each function a native callback bridges to, by
    /// the function's name, and the callback type's.
    bridged: FxHashMap<&'a str, (Scalar, &'a str)>,
    /// The C ABIs the build targets: an obligation's kind is the one every
    /// target holds.
    targets: &'a [NativeAbi],
}

impl<'a> Slots<'a> {
    fn of(program: &'a Program, targets: &'a [NativeAbi]) -> Self {
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
        Self { by_name, layouts, globals: &program.globals, bridged, targets }
    }

    /// `func`'s obligations: each store into a slot of a written kind, read
    /// off its operation, then those the lowering recorded.
    fn obligations(&self, func: &Func) -> Vec<Obligation> {
        let mut found = Vec::new();
        for (index, block) in func.blocks.iter().enumerate() {
            let block_id = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
            let mut oblige = |at: ValueId, value: ValueId, (kind, bits): (Scalar, Option<u32>), into: Into| {
                let location = func.value(at).origin.location;
                let kind = kind.on(self.targets);
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
                        // Each argument as the call converts it (`argument`),
                        // a variadic tail's included.
                        Callee::Native(target) => {
                            for (position, &argument) in args.iter().enumerate() {
                                if let Some(super::native::Type::Scalar(kind)) = target.argument(position) {
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
            kind: obligation.kind.on(self.targets),
            ..obligation.clone()
        }));
        found
    }

    /// An unproven obligation as the error that teaches it (section H): what
    /// the value goes into, why it may not fit, and how to prove it.
    fn unproven(&self, judged: &Judged) -> Diagnostic {
        let obligation = &judged.obligation;
        let kind = spelled(obligation.kind, obligation.bits);
        let argument = |position: usize| format!("argument {}", position + 1);
        let (into, label) = match &obligation.into {
            Into::Parameter { function, position } => {
                let param = self.by_name.get(function.as_str()).and_then(|callee| callee.params.get(*position));
                let named = param.map_or_else(String::new, |param| format!(" `{}`", param.name));
                let label = param.map(|param| (param.origin.location, format!("the parameter{named} is written as {kind} here")));
                (format!("{}, for the parameter{named} written as {kind},", argument(*position)), label)
            }
            Into::NativeArgument { function, position } => (format!("{} of `{function}`, a C {kind},", argument(*position)), None),
            Into::NativeStore => (format!("this store into a C {kind}"), None),
            Into::Field { field } => (format!("this store into `{field}`, written as {kind},"), None),
            Into::Global { global } => (format!("this store into `{global}`, written as {kind},"), None),
            Into::Return => (format!("this result, which `{}` is written to return as {kind},", judged.func), None),
            Into::CallbackReturn { callback } => (format!("this result, which C reads back from `{callback}` as {kind},"), None),
            Into::Local { local } => (format!("this store into `{local}`, written as {kind},"), None),
            Into::ClosureArgument { position } => {
                (format!("{}, for a parameter the function type writes as {kind},", argument(*position)), None)
            }
            Into::Assertion => (format!("this `as` claims {kind}, and the value"), None),
        };
        // Nothing known is one reason, not five.
        let anything = matches!(judged.source, Source::Number(facts) if facts.maybe_nan && !facts.whole && facts.lo == f64::NEG_INFINITY && facts.hi == f64::INFINITY);
        let why = if anything {
            "could be any number".to_owned()
        } else {
            judged.unproven.iter().map(|why| reason(*why)).collect::<Vec<_>>().join(", ")
        };
        let message = format!("{into} may not fit: it {why}. {}", remedy(&judged.unproven, obligation));
        let error = Diagnostic::error("NTS5001", message, obligation.location);
        match label {
            Some((location, text)) => error.with_label(location, text),
            None => error,
        }
    }

    /// Closures admitted into a function type whose parameter is not written
    /// as the kind the closure's own is: a call through the type is obliged to
    /// fit the type's kind, and the closure reads its own (Q1).
    fn closures_relying_on_kinds(&self, arrivals: &[super::lower::Arrival]) -> Vec<Diagnostic> {
        let mut errors = Vec::new();
        for arrival in arrivals {
            let Some(func) = self
                .layouts
                .get(&arrival.closure)
                .and_then(|layout| layout.closure_call())
                .and_then(|call| self.by_name.get(call))
            else {
                continue;
            };
            // The environment is the closure's own first parameter.
            for (at, param) in func.params.iter().skip(1).enumerate() {
                let Some(relied) = param.written else { continue };
                let obliged = arrival.kinds.get(at).copied().flatten();
                if obliged == Some(relied) {
                    continue;
                }
                let message = format!(
                    "a function whose parameter `{}` is written as {}, where the function type it is \
                     passed as takes {} -- a call through the type is obliged to fit only that, and \
                     the function reads {}; write them alike",
                    param.name,
                    spelled(relied, None),
                    kind_or_number(obliged),
                    spelled(relied, None),
                );
                errors.push(
                    Diagnostic::error("NTS5002", message, arrival.origin.location)
                        .with_label(param.origin.location, "written here"),
                );
            }
        }
        errors
    }

    /// Overrides that write a parameter or the result as another kind than
    /// the method they override: a call dispatched through the base is
    /// obliged to the base's kinds (Q1), and a result read through it is
    /// taken as the base's.
    ///
    /// Only of a method a dispatch names (`Callee::Virtual`'s `declared`):
    /// a closure's entries share slots with its function type's, and a call
    /// through a function type is the closures' own rule
    /// ([`Self::closures_relying_on_kinds`]).
    fn overrides_writing_kinds_otherwise(&self, program: &Program) -> Vec<Diagnostic> {
        let dispatched: rustc_hash::FxHashSet<&str> = program
            .funcs
            .iter()
            .flat_map(|func| &func.values)
            .filter_map(|op| match &op.kind {
                OpKind::Call { callee: Callee::Virtual { declared, .. }, .. } => Some(declared.as_str()),
                _ => None,
            })
            .collect();
        let mut errors = Vec::new();
        let mut reported: Vec<(&str, &str)> = Vec::new();
        for layout in &program.layouts {
            // Everything `layout` is also: its bases, and the interfaces any of
            // them implements.
            let mut above: Vec<&Layout> = Vec::new();
            let mut pending: Vec<TypeId> = layout.base.into_iter().chain(layout.interfaces.iter().copied()).collect();
            while let Some(ty) = pending.pop() {
                let Some(ancestor) = self.layouts.get(&ty).copied() else { continue };
                if std::ptr::eq(ancestor, layout) || above.iter().any(|seen| std::ptr::eq(*seen, ancestor)) {
                    continue;
                }
                above.push(ancestor);
                pending.extend(ancestor.base.into_iter().chain(ancestor.interfaces.iter().copied()));
            }
            for (slot, method) in layout.methods.iter().enumerate() {
                let Some(method) = method.as_deref() else { continue };
                for ancestor in &above {
                    let Some(overridden) = ancestor.methods.get(slot).and_then(|m| m.as_deref()) else { continue };
                    if overridden == method || !dispatched.contains(overridden) || reported.contains(&(method, overridden)) {
                        continue;
                    }
                    let (Some(mine), Some(theirs)) = (self.by_name.get(method), self.by_name.get(overridden)) else {
                        continue;
                    };
                    let parameter = mine.params.iter().zip(&theirs.params).skip(1).find(|(m, t)| m.written != t.written);
                    let what = match parameter {
                        Some((m, t)) => Some((format!("parameter `{}`", m.name), m.written, t.written)),
                        None => (mine.written_return != theirs.written_return)
                            .then(|| ("result".to_owned(), mine.written_return, theirs.written_return)),
                    };
                    let Some((what, written, base)) = what else { continue };
                    reported.push((method, overridden));
                    let message = format!(
                        "`{method}` writes its {what} as {}, and the method it overrides, \
                         `{overridden}`, as {} -- a call through the base is obliged to the base's \
                         kinds, so an override writes them alike",
                        kind_or_number(written),
                        kind_or_number(base),
                    );
                    errors.push(Diagnostic::error("NTS5003", message, mine.origin.location));
                }
            }
        }
        errors
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
    match pointee.viewed() {
        Pointee::Scalar(kind) => Some((*kind, None)),
        Pointee::Bits { unit, width } => Some((*unit, Some(*width))),
        _ => None,
    }
}

/// One reason a value may not fit, as a message says it after "it".
#[must_use]
pub fn reason(why: Why) -> String {
    match why {
        Why::Fraction => "may be a fraction".to_owned(),
        Why::NaN => "may be NaN".to_owned(),
        Why::NegativeZero => "may be -0".to_owned(),
        Why::Below(lo) => format!("may be as low as {}", bound(lo)),
        Why::Above(hi) => format!("may be as high as {}", bound(hi)),
        Why::ExactlyBelow(lo) => format!("may be as low as {lo}"),
        Why::ExactlyAbove(hi) => format!("may be as high as {hi}"),
        Why::FloatExactness => "may not be exactly a `float`".to_owned(),
        Why::NotANumber => "may not be a number".to_owned(),
    }
}

/// A bound as a message prints it.
fn bound(value: f64) -> String {
    if value.is_infinite() {
        if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned()
    } else {
        format!("{value}")
    }
}

/// How to prove it: what JavaScript already has for each reason, so the fix
/// runs the same under node.
fn remedy(why: &[Why], obligation: &Obligation) -> String {
    let mut fixes = Vec::new();
    if why.iter().any(|why| matches!(why, Why::NotANumber)) {
        fixes.push("test `typeof x === \"number\"` first".to_owned());
    }
    if why.iter().any(|why| matches!(why, Why::Fraction | Why::NaN)) {
        fixes.push("`Number.isInteger(x)` rules out a fraction and NaN".to_owned());
    }
    if why.iter().any(|why| matches!(why, Why::Below(_) | Why::Above(_) | Why::ExactlyBelow(_) | Why::ExactlyAbove(_))) {
        fixes.push(match obligation.range() {
            Some((lo, hi)) => format!("a guard such as `x >= {lo} && x <= {hi}` bounds it"),
            None => "a guard on its range bounds it".to_owned(),
        });
    }
    if why.iter().any(|why| matches!(why, Why::NegativeZero)) {
        fixes.push("`x + 0` is `x` with -0 made 0".to_owned());
    }
    if why.iter().any(|why| matches!(why, Why::FloatExactness)) {
        fixes.push("`Math.fround(x)` is the value as a `float`".to_owned());
    }
    if fixes.is_empty() {
        return String::new();
    }
    format!("To prove it: {}.", fixes.join("; "))
}

/// The record a pointer to `pointee` points at.
fn record_of(pointee: &Pointee) -> Option<&super::native::Record> {
    match pointee.viewed() {
        Pointee::Record(record) => Some(record),
        _ => None,
    }
}

/// The value as the program computed it, before the conversion that made it
/// the slot's representation -- or, for an optional slot, erased it beside
/// the tag that says it is there.
fn before_conversion(func: &Func, value: ValueId) -> ValueId {
    match &func.value(value).kind {
        OpKind::Convert(from) | OpKind::Erase { value: from, .. } => *from,
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
fn judge(
    &self,
    func: &Func,
    (analysis, bigints): (&Analysis, &std::cell::OnceCell<BigRanges>),
    obligation: &Obligation,
) -> Judged {
    let value = obligation.value;
    let (source, unproven) = match func.value(value).ty {
        HirType::Float { .. } => {
            let facts = analysis.get_at(obligation.block, value);
            let exact = obligation.kind == Scalar::Float
                && self.exact_in_float(func, analysis, (obligation.block, value), &mut Vec::new());
            (Source::Number(facts), number_fits(facts, obligation, exact))
        }
        HirType::Int { bits, signed } => {
            let (lo, hi) = int_range(bits, signed);
            (Source::Integer { lo, hi }, exactly_fits(Bounds { lo, hi }, obligation))
        }
        HirType::BigInt => {
            let bounds = bigints.get_or_init(|| self.bigint_ranges(func, analysis)).get_at(obligation.block, value);
            (Source::BigInt { lo: bounds.lo, hi: bounds.hi }, exactly_fits(bounds, obligation))
        }
        HirType::Bool => {
            let fits = obligation.range().is_none_or(|(lo, hi)| lo <= 0 && hi >= 1);
            (Source::Bool, if fits { Vec::new() } else { vec![Why::ExactlyAbove(1)] })
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

/// The integers a machine integer of `bits` holds.
const fn int_range(bits: u8, signed: bool) -> (i128, i128) {
    if signed {
        let half = 1i128 << (bits - 1);
        (-half, half - 1)
    } else {
        (0, (1i128 << bits) - 1)
    }
}

/// Why an integer in `bounds` may not fit the obligation's slot. A float
/// slot takes every integer a machine type or a `bigint` here can hold
/// only approximately, which isn't this question.
fn exactly_fits(bounds: Bounds, obligation: &Obligation) -> Vec<Why> {
    let Some((least, greatest)) = obligation.range() else { return Vec::new() };
    let mut why = Vec::new();
    if bounds.lo < least {
        why.push(Why::ExactlyBelow(bounds.lo));
    }
    if bounds.hi > greatest {
        why.push(Why::ExactlyAbove(bounds.hi));
    }
    why
}

/// An exact range of integers, inclusive: what a `bigint` may be. nts's
/// bigints are 128-bit, so [`Self::FULL`] is every one of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub lo: i128,
    pub hi: i128,
}

impl Bounds {
    const FULL: Self = Self { lo: i128::MIN, hi: i128::MAX };
    /// No value: a block not reached yet.
    const EMPTY: Self = Self { lo: i128::MAX, hi: i128::MIN };

    const fn exact(value: i128) -> Self {
        Self { lo: value, hi: value }
    }

    const fn is_empty(self) -> bool {
        self.lo > self.hi
    }

    fn of(kind: Option<Scalar>) -> Self {
        kind.and_then(Scalar::integer_range).map_or(Self::FULL, |(lo, hi)| Self { lo, hi })
    }

    fn join(self, other: Self) -> Self {
        if self.is_empty() {
            other
        } else if other.is_empty() {
            self
        } else {
            Self { lo: self.lo.min(other.lo), hi: self.hi.max(other.hi) }
        }
    }

    fn meet(self, other: Self) -> Self {
        Self { lo: self.lo.max(other.lo), hi: self.hi.min(other.hi) }
    }

    /// Every result of `apply` on the corners, or everything where one
    /// overflows: nts's 128-bit arithmetic wraps there.
    fn corners(self, other: Self, apply: fn(i128, i128) -> Option<i128>) -> Self {
        if self.is_empty() || other.is_empty() {
            return Self::EMPTY;
        }
        let corners = [(self.lo, other.lo), (self.lo, other.hi), (self.hi, other.lo), (self.hi, other.hi)];
        corners.iter().try_fold(Self::EMPTY, |range, (a, b)| Some(range.join(Self::exact(apply(*a, *b)?)))).unwrap_or(Self::FULL)
    }
}

/// What [`Slots::bigint_ranges`] proved: each `bigint`'s range, and what each
/// block's guards narrowed.
struct BigRanges {
    values: Vec<Bounds>,
    refined: Vec<FxHashMap<ValueId, Bounds>>,
}

impl BigRanges {
    fn get_at(&self, block: BlockId, value: ValueId) -> Bounds {
        self.refined
            .get(block.0 as usize)
            .and_then(|refined| refined.get(&value))
            .copied()
            .unwrap_or(self.values[value.0 as usize])
    }
}

impl Slots<'_> {
    /// The exact range of every `bigint` in `func`, by local facts only (Q2):
    /// what a written kind, a native result, a literal, `BigInt.asIntN` and
    /// `asUintN` say, through `+`, `-`, `*`, `&`, `>>` and negation, joined
    /// where paths meet and narrowed by a comparison's guard.
    ///
    /// Its own small analysis because [`super::flow`]'s facts are about a
    /// double -- which can't tell `2^63 - 1` from `2^63`, the very edge
    /// `BigInt.asIntN(64, x)` sits on. A guard narrows along an edge into a
    /// block with that one predecessor, and on through blocks with one
    /// predecessor, which is every `if` and every `&&` chain.
    fn bigint_ranges(&self, func: &Func, numbers: &Analysis) -> BigRanges {
        /// Past this many rounds a block parameter that still grows is a loop
        /// accumulator, and is everything.
        const WIDEN_AFTER: u32 = 8;
        let blocks = func.blocks.len();
        let mut predecessors: Vec<Vec<BlockId>> = vec![Vec::new(); blocks];
        for (index, block) in func.blocks.iter().enumerate() {
            for successor in block.terminator.successors() {
                if let Some(into) = predecessors.get_mut(successor.0 as usize) {
                    into.push(BlockId(u32::try_from(index).unwrap_or(u32::MAX)));
                }
            }
        }
        let mut ranges = BigRanges { values: vec![Bounds::EMPTY; func.values.len()], refined: vec![FxHashMap::default(); blocks] };
        let mut rounds = vec![0u32; blocks];
        for _ in 0..(4 * blocks + 16) {
            let mut changed = false;
            for index in 0..blocks {
                let block = BlockId(u32::try_from(index).unwrap_or(u32::MAX));
                // What the one predecessor knew, and what its branch proves.
                let refined = match predecessors[index][..] {
                    [from] => Self::edge_refinements(func, &ranges, from, block),
                    _ => FxHashMap::default(),
                };
                ranges.refined[index] = refined;
                rounds[index] += 1;
                for (at, param) in func.blocks[index].params.iter().enumerate() {
                    if func.value(*param).ty != HirType::BigInt {
                        continue;
                    }
                    let mut passed = Bounds::EMPTY;
                    for from in &predecessors[index] {
                        for args in edge_args(&func.blocks[from.0 as usize].terminator, block) {
                            if let Some(arg) = args.get(at) {
                                passed = passed.join(ranges.get_at(*from, *arg));
                            }
                        }
                    }
                    let slot = &mut ranges.values[param.0 as usize];
                    let mut joined = slot.join(passed);
                    if joined != *slot && rounds[index] > WIDEN_AFTER {
                        joined = Bounds::FULL;
                    }
                    if joined != *slot {
                        *slot = joined;
                        changed = true;
                    }
                }
                for &value in &func.blocks[index].ops {
                    if func.value(value).ty != HirType::BigInt {
                        continue;
                    }
                    let computed = self.bigint_transfer(func, numbers, &ranges, block, value);
                    let slot = &mut ranges.values[value.0 as usize];
                    let joined = slot.join(computed);
                    if joined != *slot {
                        *slot = joined;
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }
        ranges
    }

    /// The refinements in force at `block`, entered from its one predecessor
    /// `from`: `from`'s own, and what `from`'s branch proves on this edge.
    fn edge_refinements(func: &Func, ranges: &BigRanges, from: BlockId, block: BlockId) -> FxHashMap<ValueId, Bounds> {
        let mut refined = ranges.refined[from.0 as usize].clone();
        let Terminator::Branch { cond, then_target, else_target, .. } = &func.blocks[from.0 as usize].terminator else {
            return refined;
        };
        if then_target == else_target {
            return refined;
        }
        let OpKind::Binary { op, lhs, rhs } = &func.value(*cond).kind else { return refined };
        if func.value(*lhs).ty != HirType::BigInt || func.value(*rhs).ty != HirType::BigInt {
            return refined;
        }
        // A `bigint` has no NaN, so the false edge proves the negation.
        let holds = if *then_target == block {
            *op
        } else {
            match op {
                BinOp::Lt => BinOp::Ge,
                BinOp::Le => BinOp::Gt,
                BinOp::Gt => BinOp::Le,
                BinOp::Ge => BinOp::Lt,
                BinOp::Eq => BinOp::Ne,
                BinOp::Ne => BinOp::Eq,
                _ => return refined,
            }
        };
        let (a, b) = (ranges.get_at(from, *lhs), ranges.get_at(from, *rhs));
        let below = |hi: i128| Bounds { lo: i128::MIN, hi };
        let above = |lo: i128| Bounds { lo, hi: i128::MAX };
        let (left, right) = match holds {
            BinOp::Lt => (below(b.hi.saturating_sub(1)), above(a.lo.saturating_add(1))),
            BinOp::Le => (below(b.hi), above(a.lo)),
            BinOp::Gt => (above(b.lo.saturating_add(1)), below(a.hi.saturating_sub(1))),
            BinOp::Ge => (above(b.lo), below(a.hi)),
            BinOp::Eq => (b, a),
            _ => return refined,
        };
        refined.insert(*lhs, a.meet(left));
        refined.insert(*rhs, b.meet(right));
        refined
    }

    /// What one operation producing a `bigint` may produce.
    fn bigint_transfer(&self, func: &Func, numbers: &Analysis, ranges: &BigRanges, block: BlockId, value: ValueId) -> Bounds {
        let get = |operand: ValueId| ranges.get_at(block, operand);
        match &func.value(value).kind {
            OpKind::ConstInt(literal) => Bounds::exact(*literal),
            OpKind::Convert(from) | OpKind::Unerase { value: from } => match func.value(*from).ty {
                HirType::Int { bits, signed } => {
                    let (lo, hi) = int_range(bits, signed);
                    Bounds { lo, hi }
                }
                HirType::BigInt => get(*from),
                // The `bigint` an erased value is, where a test proved it is
                // one: what made it says, as a uniform closure entry passes
                // a written parameter on.
                HirType::Erased if matches!(func.value(value).kind, OpKind::Unerase { .. }) => {
                    self.bigint_transfer(func, numbers, ranges, block, *from)
                }
                _ => Bounds::FULL,
            },
            OpKind::Param(slot) => Bounds::of(func.params.get(*slot as usize).and_then(|param| param.written)),
            OpKind::FieldGet { object, field } => Bounds::of(self.field(&func.value(*object).ty, *field).map(|(kind, _)| kind)),
            OpKind::GlobalGet(global) => Bounds::of(self.globals.get(*global as usize).and_then(|slot| slot.written)),
            OpKind::Call { callee: Callee::Direct(name), .. } => {
                Bounds::of(self.by_name.get(name.as_str()).and_then(|callee| callee.written_return))
            }
            OpKind::Call { callee: Callee::Native(target), .. } => match target.result {
                super::native::Type::Scalar(kind) => Bounds::of(Some(kind)),
                _ => Bounds::FULL,
            },
            // `BigInt.asIntN(w, x)` and `asUintN`: the explicit narrowing.
            OpKind::Call { callee: Callee::External(name), args, .. }
                if matches!(name.as_str(), "nts_bigint_as_intn" | "nts_bigint_as_uintn") =>
            {
                let width = args.first().map(|width| numbers.get_at(block, *width));
                match width.filter(|width| width.is_singleton() && width.integral() && (1.0..=127.0).contains(&width.lo)) {
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    Some(width) => {
                        let bits = width.lo as u8;
                        let (lo, hi) = int_range(bits, name == "nts_bigint_as_intn");
                        Bounds { lo, hi }
                    }
                    None => Bounds::FULL,
                }
            }
            OpKind::Binary { op, lhs, rhs } => {
                let (a, b) = (get(*lhs), get(*rhs));
                match op {
                    BinOp::Add => a.corners(b, i128::checked_add),
                    BinOp::Sub => a.corners(b, i128::checked_sub),
                    BinOp::Mul => a.corners(b, i128::checked_mul),
                    // A mask with a non-negative side is within that side.
                    BinOp::BitAnd if a.lo >= 0 || b.lo >= 0 => {
                        let hi = if a.lo >= 0 && b.lo >= 0 { a.hi.min(b.hi) } else if a.lo >= 0 { a.hi } else { b.hi };
                        Bounds { lo: 0, hi }
                    }
                    BinOp::Shr if b.lo >= 0 && b.hi < 128 => a.corners(b, |x, n| u32::try_from(n).ok().map(|n| x >> n)),
                    _ => Bounds::FULL,
                }
            }
            OpKind::Unary { op: UnOp::Neg, operand } => {
                let a = get(*operand);
                Bounds::exact(0).corners(a, i128::checked_sub)
            }
            _ => Bounds::FULL,
        }
    }
}

/// The arguments the terminator passes to `target`, on each edge to it.
fn edge_args(terminator: &Terminator, target: BlockId) -> Vec<&[ValueId]> {
    match terminator {
        Terminator::Jump { target: to, args } if *to == target => vec![args.as_slice()],
        Terminator::Branch { then_target, then_args, else_target, else_args, .. } => {
            let mut edges = Vec::new();
            if *then_target == target {
                edges.push(then_args.as_slice());
            }
            if *else_target == target {
                edges.push(else_args.as_slice());
            }
            edges
        }
        _ => Vec::new(),
    }
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
    use super::{exactly_fits, number_fits, Bounds, Into, Obligation, Why};
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
    fn bigint_bounds_are_exact_and_an_overflow_is_everything() {
        let int64 = Bounds { lo: -(1i128 << 63), hi: (1i128 << 63) - 1 };
        assert_eq!(int64.corners(Bounds::exact(1), i128::checked_add).hi, 1i128 << 63, "INT64_MAX + 1 is one past the kind");
        assert_eq!(Bounds::FULL.corners(Bounds::exact(1), i128::checked_add), Bounds::FULL, "past 128 bits it wraps");
        assert_eq!(exactly_fits(int64, &into(Scalar::Int64, None)), Vec::<Why>::new());
        assert_eq!(
            exactly_fits(Bounds { lo: 0, hi: 1i128 << 63 }, &into(Scalar::Int64, None)),
            vec![Why::ExactlyAbove(1i128 << 63)],
            "a double could not tell 2^63 from 2^63 - 1; the bound must be exact"
        );
    }

    #[test]
    fn a_bit_field_narrows_its_unit() {
        assert_eq!(into(Scalar::UInt32, Some(3)).range(), Some((0, 7)));
        assert_eq!(into(Scalar::Int32, Some(3)).range(), Some((-4, 3)));
        assert_eq!(number_fits(Facts::new(0.0, 8.0, true, false, false), &into(Scalar::UInt32, Some(3)), false), vec![Why::Above(8.0)]);
    }
}
