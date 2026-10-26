//! `nts expect-ir`: facts about the program a backend receives, written beside
//! the source and checked against `hir::Program` itself.
//!
//! A representation decision is a performance decision, and until this existed
//! one regressed silently: the checked read cost Wasm 6.3x and was found weeks
//! later, by a benchmark. A fact here fails the day a change breaks it, with no
//! timing noise, and it says which fact.
//!
//! # The form
//!
//! One fact per comment line in the project's own sources:
//!
//! ```text
//! // expect-ir: all: no erase in sum
//! // expect-ir: c llvm: count call.virtual in work <= 1
//! // expect-ir: all: count call.extern(nts_raising) in work == 1
//! // expect-ir: all: block params in run#whole are integer
//! // expect-ir: jvm: field Box.value is f64
//! // expect-ir: all: weigh returns i32
//! // expect-ir: all: draw param max is integer
//! ```
//!
//! Before the colon, the backends it holds on: `all`, or any of `c llvm jvm
//! wasm`. After it, one of six facts:
//!
//! | Fact | Holds when |
//! |---|---|
//! | `no <op> in <fn>` | no operation of that kind is in the function |
//! | `count <op> in <fn> <cmp> <n>` | their number compares so (`== != < <= > >=`) |
//! | `<fn> returns <type>` | the function's return type is that |
//! | `<fn> param <name> is <type>` | the named parameter's type is that |
//! | `field <Layout>.<field> is <type>` | the layout's field is laid out so |
//! | `block params in <fn> are <type>` | every numeric block parameter is |
//!
//! `<op>` is the word `nts hir` prints for the operation (`erase`,
//! `call.virtual`, `toint32`, `object.new`, ...), plus `object.new.heap` and
//! `object.new.frame` for one placement, and `array.get.checked` and
//! `array.set.checked` for an access that kept its bounds check.
//! `call.extern(<helper>)` selects one declared runtime helper; an unknown
//! helper is a parse error, so a misspelled negative fact cannot pass.
//! `<type>` is a type as `nts hir`
//! prints it (`i32`, `f64`, `bool`, ...) or one of `integer`, `float`,
//! `number`. `<fn>` names a function and every copy specialization made of it:
//! `run` is `run`, `run#whole` and any other `run#...`.
//!
//! # Failing loudly
//!
//! A word outside the vocabulary is a parse error, not a fact that never
//! matches. A fact whose function or layout the program does not have is
//! UNRESOLVED, and fails: a rename that left `no erase in sum` looking at
//! nothing would otherwise pass forever. A project with no fact fails too, so
//! a gate step pointed at the wrong directory says so.

use anyhow::{Result, bail};
use camino::{Utf8Path, Utf8PathBuf};
use nts_codegen_common::Backend;
use nts_core::hir::{self, BinOp, Func, HirType, OpKind, UnOp};

/// Every backend, in the order facts are reported.
const BACKENDS: [Backend; 4] = [Backend::C, Backend::Llvm, Backend::Jvm, Backend::Wasm];

/// One `// expect-ir:` line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Expectation {
    pub(crate) file: Utf8PathBuf,
    pub(crate) line: usize,
    /// The fact as written, without its backends, for the report.
    pub(crate) text: String,
    pub(crate) backends: Vec<Backend>,
    pub(crate) fact: Fact,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Fact {
    No {
        op: String,
        func: String,
    },
    Count {
        op: String,
        func: String,
        cmp: Cmp,
        n: usize,
    },
    Returns {
        func: String,
        ty: TypeSpec,
    },
    Param {
        func: String,
        name: String,
        ty: TypeSpec,
    },
    Field {
        layout: String,
        field: String,
        ty: TypeSpec,
    },
    BlockParams {
        func: String,
        ty: TypeSpec,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Cmp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Cmp {
    fn parse(word: &str) -> Option<Self> {
        Some(match word {
            "==" => Self::Eq,
            "!=" => Self::Ne,
            "<" => Self::Lt,
            "<=" => Self::Le,
            ">" => Self::Gt,
            ">=" => Self::Ge,
            _ => return None,
        })
    }

    const fn holds(self, found: usize, n: usize) -> bool {
        match self {
            Self::Eq => found == n,
            Self::Ne => found != n,
            Self::Lt => found < n,
            Self::Le => found <= n,
            Self::Gt => found > n,
            Self::Ge => found >= n,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TypeSpec {
    Integer,
    Float,
    Number,
    /// A type as `nts hir` prints it.
    Exact(String),
}

impl TypeSpec {
    fn parse(word: &str) -> Self {
        match word {
            "integer" => Self::Integer,
            "float" => Self::Float,
            "number" => Self::Number,
            other => Self::Exact(other.to_owned()),
        }
    }

    fn admits(&self, ty: &HirType) -> bool {
        match self {
            Self::Integer => matches!(ty, HirType::Int { .. }),
            Self::Float => matches!(ty, HirType::Float { .. }),
            Self::Number => matches!(ty, HirType::Int { .. } | HirType::Float { .. }),
            Self::Exact(text) => super::render(ty) == *text,
        }
    }
}

/// What a fact came to on one backend.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Verdict {
    Pass,
    Fail(String),
    Unresolved(String),
}

/// The word `nts hir` prints for an operation, which is the word a fact names
/// it by. `rendering_tests` holds the two to each other over a whole program.
pub(crate) fn op_word(kind: &OpKind) -> &'static str {
    match kind {
        OpKind::NativeLoad { .. } => "native.load",
        OpKind::NativeStore { .. } => "native.store",
        OpKind::NativeLocal { .. } => "native.local",
        OpKind::ObjcClass { .. } => "objc.class",
        OpKind::ObjcSelector { .. } => "objc.selector",
        OpKind::NativeSizeOf(_) => "native.sizeof",
        OpKind::ConstHandle(_) => "const.handle",
        OpKind::NativeMalloc { .. } => "native.malloc",
        OpKind::NativeFree { .. } => "native.free",
        OpKind::NativePointerBits { .. } => "native.bits",
        OpKind::NativeStringView { .. } => "native.string.view",
        OpKind::NativeIndexAddress { .. } => "native.index.addr",
        OpKind::NativeFieldAddress { .. } => "native.field.addr",
        OpKind::NativeBitLoad { .. } => "native.bit.load",
        OpKind::NativeBitStore { .. } => "native.bit.store",
        OpKind::NativeCopy { .. } => "native.copy",
        OpKind::NativeBridge { .. } => "native.bridge",
        OpKind::NativeBlock { .. } => "native.block",
        OpKind::DelegateInvoke { .. } => "native.delegate.invoke",
        OpKind::Param(_) => "param",
        OpKind::BlockParam(_) => "blockparam",
        OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::DispatchSlot(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstString(_)
        | OpKind::ConstTemplate { .. }
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ClosureStatic => "const",
        OpKind::Provided(_) => "provided",
        OpKind::Erase { .. } => "erase",
        OpKind::TagOf { .. } => "tagof",
        OpKind::Unerase { .. } => "unerase",
        OpKind::Binary { op, .. } => super::render_bin(*op),
        OpKind::Unary { op, .. } => super::render_un(*op),
        OpKind::Convert(_) => "convert",
        OpKind::FieldView { .. } => "field.view",
        OpKind::Call { callee, .. } => match callee {
            hir::Callee::Direct(_) => "call",
            hir::Callee::External(_) => "call.extern",
            hir::Callee::Native(_) => "call.native",
            hir::Callee::Virtual { .. } => "call.virtual",
            hir::Callee::Closure { .. } => "call.closure",
        },
        OpKind::Return(_) => "ret",
        OpKind::ArrayNew { .. } => "array.new",
        OpKind::Length(_) => "array.len",
        OpKind::ArrayGet { .. } => "array.get",
        OpKind::ArraySet { .. } => "array.set",
        OpKind::Retain(_) => "retain",
        OpKind::Release(_) => "release",
        OpKind::StringUnitAt { .. } => "str.unit",
        OpKind::GlobalGet(_) => "global.get",
        OpKind::GlobalSet { .. } => "global.set",
        OpKind::ObjectNew { .. } => "object.new",
        OpKind::CellReady { .. } => "cell.ready",
        OpKind::InstanceOf { .. } => "instanceof",
        OpKind::FieldGet { .. } => "field.get",
        OpKind::SharedFieldGet { .. } => "field.get.shared",
        OpKind::OpenFieldGet { .. } => "field.get.open",
        OpKind::OpenFieldSet { .. } => "field.set.open",
        OpKind::FieldSet { .. } => "field.set",
        OpKind::Await { .. } => "await",
        OpKind::Yield { .. } => "yield",
        OpKind::Suspend { .. } => "suspend",
        OpKind::PromiseSubscribe { .. } => "promise.subscribe",
    }
}

/// Every word a fact may name an operation by.
fn vocabulary() -> Vec<&'static str> {
    let mut words = vec![
        "native.load",
        "native.store",
        "native.local",
        "objc.class",
        "objc.selector",
        "native.sizeof",
        "native.malloc",
        "native.free",
        "native.bits",
        "native.string.view",
        "native.index.addr",
        "native.field.addr",
        "native.bit.load",
        "native.bit.store",
        "native.copy",
        "native.bridge",
        "native.block",
        "native.delegate.invoke",
        "param",
        "blockparam",
        "const",
        "const.handle",
        "erase",
        "tagof",
        "unerase",
        "convert",
        "field.view",
        "call",
        "call.extern",
        "call.native",
        "call.virtual",
        "call.closure",
        "ret",
        "array.new",
        "array.len",
        "array.get",
        "array.set",
        // A read or store that still carries its bounds check, which `nts hir`
        // does not print: the check is a flag on the op, and whether one
        // survived is the representation question `bounds` answers.
        "array.get.checked",
        "array.set.checked",
        "retain",
        "release",
        "str.unit",
        "global.get",
        "global.set",
        "object.new",
        "object.new.heap",
        "object.new.frame",
        "cell.ready",
        "instanceof",
        "field.get",
        "field.get.shared",
        "field.get.open",
        "field.set.open",
        "field.set",
        "await",
        "yield",
        "suspend",
        "promise.subscribe",
    ];
    words.extend(BINARY.iter().map(|&op| super::render_bin(op)));
    words.extend(UNARY.iter().map(|&op| super::render_un(op)));
    words
}

/// Every binary operation, in [`binary_index`]'s order.
const BINARY: [BinOp; 20] = [
    BinOp::Add,
    BinOp::Sub,
    BinOp::Mul,
    BinOp::Div,
    BinOp::Rem,
    BinOp::Concat,
    BinOp::Lt,
    BinOp::Le,
    BinOp::Gt,
    BinOp::Ge,
    BinOp::Eq,
    BinOp::Ne,
    BinOp::BitAnd,
    BinOp::BitOr,
    BinOp::BitXor,
    BinOp::Shl,
    BinOp::Shr,
    BinOp::UShr,
    BinOp::Min,
    BinOp::Max,
];

/// Every unary operation, in [`unary_index`]'s order.
const UNARY: [UnOp; 11] = [
    UnOp::Neg,
    UnOp::Not,
    UnOp::ToInt32,
    UnOp::ToUint32,
    UnOp::Floor,
    UnOp::Ceil,
    UnOp::Trunc,
    UnOp::Round,
    UnOp::Abs,
    UnOp::Sqrt,
    UnOp::Truthy,
];

/// A position for every binary operation. Exhaustive, so a new operation
/// stops this compiling until it is in [`BINARY`], and the vocabulary cannot
/// silently lack its word; `the_operation_lists_are_complete` holds the two
/// in the same order.
#[cfg_attr(not(test), allow(dead_code))]
const fn binary_index(op: BinOp) -> usize {
    match op {
        BinOp::Add => 0,
        BinOp::Sub => 1,
        BinOp::Mul => 2,
        BinOp::Div => 3,
        BinOp::Rem => 4,
        BinOp::Concat => 5,
        BinOp::Lt => 6,
        BinOp::Le => 7,
        BinOp::Gt => 8,
        BinOp::Ge => 9,
        BinOp::Eq => 10,
        BinOp::Ne => 11,
        BinOp::BitAnd => 12,
        BinOp::BitOr => 13,
        BinOp::BitXor => 14,
        BinOp::Shl => 15,
        BinOp::Shr => 16,
        BinOp::UShr => 17,
        BinOp::Min => 18,
        BinOp::Max => 19,
    }
}

/// [`binary_index`] for the unary operations.
#[cfg_attr(not(test), allow(dead_code))]
const fn unary_index(op: UnOp) -> usize {
    match op {
        UnOp::Neg => 0,
        UnOp::Not => 1,
        UnOp::ToInt32 => 2,
        UnOp::ToUint32 => 3,
        UnOp::Floor => 4,
        UnOp::Ceil => 5,
        UnOp::Trunc => 6,
        UnOp::Round => 7,
        UnOp::Abs => 8,
        UnOp::Sqrt => 9,
        UnOp::Truthy => 10,
    }
}

/// Whether an operation is one a fact's word names.
fn named(word: &str, kind: &OpKind) -> bool {
    if let Some(helper) = external_name(word) {
        return matches!(kind, OpKind::Call { callee: hir::Callee::External(name), .. } if name == helper);
    }
    match (word, kind) {
        ("object.new.heap", OpKind::ObjectNew { frame }) => !frame,
        ("object.new.frame", OpKind::ObjectNew { frame }) => *frame,
        ("array.get.checked", OpKind::ArrayGet { checked, .. })
        | ("array.set.checked", OpKind::ArraySet { checked, .. }) => *checked,
        _ => op_word(kind) == word,
    }
}

fn external_name(word: &str) -> Option<&str> {
    word.strip_prefix("call.extern(")?.strip_suffix(')')
}

/// Parse one comment's text after `expect-ir:`.
pub(crate) fn parse(text: &str) -> Result<(Vec<Backend>, Fact), String> {
    let (before, fact) = text
        .split_once(':')
        .ok_or("expected `<backends>: <fact>`, e.g. `all: no erase in sum`")?;
    let mut backends = Vec::new();
    for word in before.split([' ', ',']).filter(|word| !word.is_empty()) {
        if word == "all" {
            backends.extend(BACKENDS);
        } else {
            backends
                .push(word.parse::<Backend>().map_err(|_| {
                    format!("`{word}` is not a backend: all, c, llvm, jvm or wasm")
                })?);
        }
    }
    backends.sort_by_key(|backend| BACKENDS.iter().position(|b| b == backend));
    backends.dedup();
    if backends.is_empty() {
        return Err("no backend before the colon".to_owned());
    }
    let words: Vec<&str> = fact.split_whitespace().collect();
    let op = |word: &str| -> Result<String, String> {
        if vocabulary().contains(&word)
            || external_name(word).is_some_and(|name| {
                // The core table carries scalar conversions (including static
                // inline helpers); LLVM's table also has the non-scalar ABI.
                hir::runtime::parameters(name).is_some()
                    || nts_codegen_llvm::signatures::signature(name).is_some()
            })
        {
            Ok(word.to_owned())
        } else {
            Err(format!(
                "`{word}` is not an operation `nts hir` prints (e.g. erase, call.virtual, toint32, object.new.heap)"
            ))
        }
    };
    let fact = match words.as_slice() {
        ["no", word, "in", func] => Fact::No {
            op: op(word)?,
            func: (*func).to_owned(),
        },
        ["count", word, "in", func, cmp, n] => Fact::Count {
            op: op(word)?,
            func: (*func).to_owned(),
            cmp: Cmp::parse(cmp).ok_or_else(|| format!("`{cmp}` is not one of == != < <= > >="))?,
            n: n.parse().map_err(|_| format!("`{n}` is not a count"))?,
        },
        [func, "returns", ty] => Fact::Returns {
            func: (*func).to_owned(),
            ty: TypeSpec::parse(ty),
        },
        [func, "param", name, "is", ty] => Fact::Param {
            func: (*func).to_owned(),
            name: (*name).to_owned(),
            ty: TypeSpec::parse(ty),
        },
        ["block", "params", "in", func, "are", ty] => Fact::BlockParams {
            func: (*func).to_owned(),
            ty: TypeSpec::parse(ty),
        },
        ["field", .., "is", ty] if words.len() >= 4 => {
            // A layout's name may hold spaces (`Map<string, number>`), so the
            // place is everything between `field` and the last `is`.
            let place = words[1..words.len() - 2].join(" ");
            let (layout, field) = place
                .rsplit_once('.')
                .ok_or_else(|| format!("`{place}` is not `<Layout>.<field>`"))?;
            Fact::Field {
                layout: layout.to_owned(),
                field: field.to_owned(),
                ty: TypeSpec::parse(ty),
            }
        }
        _ => {
            return Err(format!(
                "`{}` is not a fact: no, count, returns, param, field or block params",
                fact.trim()
            ));
        }
    };
    Ok((backends, fact))
}

/// Every `// expect-ir:` line in `text`, parsed, or the first that does not
/// parse.
pub(crate) fn collect(file: &Utf8Path, text: &str) -> Result<Vec<Expectation>> {
    let mut found = Vec::new();
    for (at, line) in text.lines().enumerate() {
        let Some(rest) = line.trim_start().strip_prefix("// expect-ir:") else {
            continue;
        };
        match parse(rest) {
            Ok((backends, fact)) => found.push(Expectation {
                file: file.to_owned(),
                line: at + 1,
                text: rest
                    .split_once(':')
                    .map_or(rest, |(_, fact)| fact)
                    .trim()
                    .to_owned(),
                backends,
                fact,
            }),
            Err(why) => bail!("{file}:{}: {why}", at + 1),
        }
    }
    Ok(found)
}

/// The functions a fact's `<fn>` names: itself, and every copy of it.
fn functions<'a>(program: &'a hir::Program, name: &str) -> Vec<&'a Func> {
    let copies = format!("{name}#");
    program
        .funcs
        .iter()
        .filter(|func| func.name == name || func.name.starts_with(&copies))
        .collect()
}

/// The operations a function's blocks hold, which are the ones it runs: the
/// value arena keeps entries dead-code elimination dropped.
fn ops(func: &Func) -> impl Iterator<Item = (hir::ValueId, &hir::Op)> {
    func.blocks
        .iter()
        .flat_map(|block| &block.ops)
        .map(|&id| (id, func.value(id)))
}

/// What a fact comes to on one prepared program.
pub(crate) fn check(program: &hir::Program, fact: &Fact) -> Verdict {
    let result = match fact {
        Fact::No { op, func } => resolve(program, func).map(|funcs| count(&funcs, op, None)),
        Fact::Count { op, func, cmp, n } => {
            resolve(program, func).map(|funcs| count(&funcs, op, Some((*cmp, *n))))
        }
        Fact::Returns { func, ty } => resolve(program, func).map(|funcs| {
            let wrong: Vec<String> = funcs
                .iter()
                .filter(|func| !ty.admits(&func.return_type))
                .map(|func| format!("{} returns {}", func.name, super::render(&func.return_type)))
                .collect();
            verdict(&wrong)
        }),
        Fact::Param { func, name, ty } => {
            resolve(program, func).and_then(|funcs| param(&funcs, func, name, ty))
        }
        Fact::Field { layout, field, ty } => self::field(program, layout, field, ty),
        Fact::BlockParams { func, ty } => {
            resolve(program, func).map(|funcs| block_params(&funcs, ty))
        }
    };
    result.unwrap_or_else(|unresolved| unresolved)
}

/// The functions a fact names, or why there are none.
fn resolve<'a>(program: &'a hir::Program, name: &str) -> Result<Vec<&'a Func>, Verdict> {
    let found = functions(program, name);
    if found.is_empty() {
        Err(Verdict::Unresolved(format!("no function `{name}`")))
    } else {
        Ok(found)
    }
}

/// `no` when `bound` is absent, `count` when it is a comparison and a number.
fn count(funcs: &[&Func], op: &str, bound: Option<(Cmp, usize)>) -> Verdict {
    let found: Vec<String> = funcs
        .iter()
        .flat_map(|func| {
            ops(func)
                .filter(|(_, value)| named(op, &value.kind))
                .map(move |(id, _)| format!("%{} in {}", id.0, func.name))
        })
        .collect();
    let holds = bound.map_or(found.is_empty(), |(cmp, n)| cmp.holds(found.len(), n));
    if holds {
        Verdict::Pass
    } else {
        Verdict::Fail(format!("{} found: {}", found.len(), found.join(", ")))
    }
}

fn param(funcs: &[&Func], named: &str, name: &str, ty: &TypeSpec) -> Result<Verdict, Verdict> {
    let params: Vec<(&Func, &hir::Param)> = funcs
        .iter()
        .flat_map(|func| {
            func.params
                .iter()
                .filter(|param| param.name == name)
                .map(move |param| (*func, param))
        })
        .collect();
    if params.is_empty() {
        return Err(Verdict::Unresolved(format!(
            "no parameter `{name}` in `{named}`"
        )));
    }
    let wrong: Vec<String> = params
        .iter()
        .filter(|(_, param)| !ty.admits(&param.ty))
        .map(|(func, param)| format!("{}'s {name} is {}", func.name, super::render(&param.ty)))
        .collect();
    Ok(verdict(&wrong))
}

fn field(
    program: &hir::Program,
    layout: &str,
    field: &str,
    ty: &TypeSpec,
) -> Result<Verdict, Verdict> {
    let found = program
        .layouts
        .iter()
        .find(|candidate| candidate.name == layout)
        .ok_or_else(|| Verdict::Unresolved(format!("no layout `{layout}`")))?;
    let slot = found
        .fields
        .iter()
        .find(|slot| slot.name.is_name(field))
        .ok_or_else(|| Verdict::Unresolved(format!("no field `{field}` in `{layout}`")))?;
    Ok(if ty.admits(&slot.ty) {
        Verdict::Pass
    } else {
        Verdict::Fail(format!("{layout}.{field} is {}", super::render(&slot.ty)))
    })
}

/// Every numeric block parameter: what a loop carries.
fn block_params(funcs: &[&Func], ty: &TypeSpec) -> Verdict {
    let wrong: Vec<String> = funcs
        .iter()
        .flat_map(|func| {
            func.blocks
                .iter()
                .flat_map(|block| &block.params)
                .map(move |&param| (func, param, &func.value(param).ty))
        })
        .filter(|(_, _, value)| matches!(value, HirType::Int { .. } | HirType::Float { .. }))
        .filter(|(_, _, value)| !ty.admits(value))
        .map(|(func, param, value)| {
            format!("%{} in {} is {}", param.0, func.name, super::render(value))
        })
        .collect();
    verdict(&wrong)
}

fn verdict(wrong: &[String]) -> Verdict {
    if wrong.is_empty() {
        Verdict::Pass
    } else {
        Verdict::Fail(wrong.join(", "))
    }
}

/// The backends any of `expectations` names, in report order.
pub(crate) fn backends_named(expectations: &[Expectation]) -> Vec<Backend> {
    BACKENDS
        .into_iter()
        .filter(|backend| {
            expectations
                .iter()
                .any(|expectation| expectation.backends.contains(backend))
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// The word a fact names an operation by is the word `nts hir` prints for
    /// it, over every operation of programs that between them hold awaits,
    /// generators, erased values, class tests, maps and interfaces. A printer
    /// change that renamed one would otherwise leave every fact using the old
    /// word unparseable, or worse, naming nothing.
    #[test]
    fn a_fact_names_an_operation_by_the_word_nts_hir_prints() {
        let programs = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/programs");
        let vocabulary = vocabulary();
        let mut seen = std::collections::BTreeSet::new();
        for fixture in [
            "a-cache-entry-array-keeps-a-shared-layout",
            "a-closure-over-a-module-scope-loop-head",
            "a-bigint-compared-with-an-erased-value",
            "a-base-typed-slot-narrowed-by-instanceof",
            "array-from",
        ] {
            let tsconfig = programs.join(fixture).join("tsconfig.json");
            let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
                .with_checkers(std::num::NonZeroU16::MIN)
                .snapshot(&tsconfig)
                .unwrap_or_else(|error| panic!("{fixture}: {error}"));
            let prepared = hir::prepare(&snapshot).unwrap_or_else(|_| panic!("{fixture} prepares"));
            for func in &prepared.program.funcs {
                for (id, op) in ops(func) {
                    let printed = super::super::render_op(id.0 as usize, op);
                    let text = if printed.starts_with('%') {
                        printed.split_once(" = ").map_or("", |(_, rest)| rest)
                    } else {
                        printed.as_str()
                    };
                    let word = text.split([' ', '[']).next().unwrap_or_default();
                    let named = op_word(&op.kind);
                    assert!(
                        word == named || word.starts_with(&format!("{named}.")),
                        "{fixture}: `{printed}` prints `{word}`, expect-ir names it `{named}`"
                    );
                    assert!(
                        vocabulary.contains(&named),
                        "`{named}` is not in the vocabulary"
                    );
                    seen.insert(named);
                }
            }
        }
        // Not vacuous: the sample holds a spread of operations.
        assert!(
            seen.len() >= 20,
            "only {} kinds of operation: {seen:?}",
            seen.len()
        );
    }

    #[test]
    fn the_operation_lists_are_complete() {
        for (at, &op) in BINARY.iter().enumerate() {
            assert_eq!(binary_index(op), at, "{op:?}");
        }
        for (at, &op) in UNARY.iter().enumerate() {
            assert_eq!(unary_index(op), at, "{op:?}");
        }
    }

    #[test]
    fn every_fact_form_parses() {
        let parsed = |text: &str| parse(text).unwrap_or_else(|why| panic!("{text}: {why}"));
        assert!(matches!(
            parsed("c llvm: count const.handle in broadcast == 1").1,
            Fact::Count { n: 1, .. }
        ));
        assert_eq!(
            parsed("all: no erase in sum"),
            (
                BACKENDS.to_vec(),
                Fact::No {
                    op: "erase".to_owned(),
                    func: "sum".to_owned()
                }
            )
        );
        assert_eq!(
            parsed("wasm c: count call.virtual in work <= 1").0,
            vec![Backend::C, Backend::Wasm],
            "backends in report order, whatever order they are written in"
        );
        assert!(matches!(
            parsed("c: count toint32 in run#whole == 0").1,
            Fact::Count {
                cmp: Cmp::Eq,
                n: 0,
                ..
            }
        ));
        assert!(matches!(
            parsed("all: weigh returns i32").1,
            Fact::Returns {
                ty: TypeSpec::Exact(_),
                ..
            }
        ));
        assert!(matches!(
            parsed("all: draw param max is integer").1,
            Fact::Param {
                ty: TypeSpec::Integer,
                ..
            }
        ));
        assert!(matches!(
            parsed("all: block params in run are number").1,
            Fact::BlockParams {
                ty: TypeSpec::Number,
                ..
            }
        ));
        assert_eq!(
            parsed("jvm: field Map<string, number>.size is f64").1,
            Fact::Field {
                layout: "Map<string, number>".to_owned(),
                field: "size".to_owned(),
                ty: TypeSpec::Exact("f64".to_owned()),
            },
            "a layout name may hold a space"
        );
        assert!(matches!(
            parsed("all: no object.new.heap in run").1,
            Fact::No { .. }
        ));
        assert!(matches!(
            parsed("all: count call.extern(nts_raising) in work == 1").1,
            Fact::Count { op, n: 1, .. } if op == "call.extern(nts_raising)"
        ));
    }

    #[test]
    fn a_named_external_selects_only_that_helper() {
        let external = |name: &str| OpKind::Call {
            callee: hir::Callee::External(name.to_owned()),
            args: Vec::new(),
            frame: None,
        };
        let poll = external("nts_raising");
        assert!(named("call.extern(nts_raising)", &poll));
        assert!(named("call.extern", &poll));
        assert!(!named("call.extern(nts_value_to_string)", &poll));
        assert!(!named(
            "call.extern(nts_raising)",
            &external("nts_raise_take")
        ));
        assert!(!named("call.extern(nts_raising)", &OpKind::ConstInt(0)));
    }

    #[test]
    fn a_word_outside_the_vocabulary_is_an_error_not_a_fact_that_never_matches() {
        for wrong in [
            "all: no erasure in sum",
            "all: no erase sum",
            "everything: no erase in sum",
            ": no erase in sum",
            "all no erase in sum",
            "all: count erase in sum about 3",
            "all: count erase in sum <= three",
            "all: no call.extern(nts_raisng) in sum",
            "all: no call.extern() in sum",
            "all: no call.extern(nts_raising in sum",
        ] {
            assert!(parse(wrong).is_err(), "`{wrong}` parsed");
        }
    }

    #[test]
    fn only_comment_lines_are_read_and_a_bad_one_names_its_line() {
        let text = "const a = 1; // expect-ir: all: no erase in a\n\
                    // expect-ir: c: no erase in sum\n\
                    \x20 // expect-ir: c: count call in sum >= 1\n";
        let found = collect(Utf8Path::new("main.ts"), text).unwrap();
        assert_eq!(
            found.iter().map(|e| e.line).collect::<Vec<_>>(),
            vec![2, 3],
            "a trailing comment after code is not a fact line"
        );
        let error = collect(
            Utf8Path::new("main.ts"),
            "\n// expect-ir: c: no nothing in sum\n",
        )
        .unwrap_err()
        .to_string();
        assert!(error.starts_with("main.ts:2:"), "{error}");
    }
}
