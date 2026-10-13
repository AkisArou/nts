//! What a value prints as, and the refusals a lowering leaves for run time.
//!
//! `nts_refused` and `nts_assertion_failed` end a path the compiler could not
//! decide statically: a construct this compiler refuses, or an input that fails
//! a representation assertion. Both report through the host's named input
//! refusal with the reason the lowering gave, never an answer node would not
//! give. `nts_bool_to_string` and `nts_value_to_string` are `String(value)`
//! for a boolean and for an erased value.
use crate::{
    body::Body,
    contract, erased,
    error::Failure,
    host,
    ir::Function,
    module::{Builder, Func, FuncKey},
    strings,
};
use nts_core::hir::{HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, Instruction as I, RefType, ValType};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Helper {
    /// A construct this compiler refuses, reached at run time.
    Refused,
    /// An input that fails a representation assertion.
    AssertionFailed,
    /// `String(b)` of a boolean.
    BoolText,
    /// `String(v)` of an erased value.
    ValueText,
    /// `typeof`, spelled from a tag.
    TagName,
    /// One line to the console's stdout or stderr, through the host.
    ConsoleWrite,
}

#[cfg(test)]
impl Helper {
    /// Whether the call is code at its site rather than a module helper, which
    /// the support catalog's routing test checks against its rows.
    pub(crate) const fn inline(self) -> bool {
        !matches!(self, Self::ValueText | Self::TagName | Self::ConsoleWrite)
    }
}

pub(crate) fn external(name: &str) -> Option<Helper> {
    match name {
        "nts_refused" => Some(Helper::Refused),
        "nts_assertion_failed" => Some(Helper::AssertionFailed),
        "nts_bool_to_string" => Some(Helper::BoolText),
        "nts_value_to_string" => Some(Helper::ValueText),
        "nts_tag_name" => Some(Helper::TagName),
        "nts_console_write" => Some(Helper::ConsoleWrite),
        _ => None,
    }
}

pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    helper: Helper,
    args: &[ValueId],
) -> Result<(), Failure> {
    if helper == Helper::ConsoleWrite {
        return console_write(b, args);
    }
    let &[arg] = args else {
        return Err(format!("value helper {helper:?} arity mismatch").into());
    };
    let wanted = match helper {
        Helper::Refused | Helper::AssertionFailed => HirType::Managed(ManagedType::String),
        Helper::BoolText => HirType::Bool,
        Helper::ValueText => HirType::Erased,
        Helper::TagName => HirType::Int {
            bits: 32,
            signed: false,
        },
        Helper::ConsoleWrite => {
            return Err(Failure::Invariant("console write past its arm".into()));
        }
    };
    if b.ty(arg) != &wanted {
        return Err(format!("value helper {helper:?} expects {wanted:?}").into());
    }
    match helper {
        Helper::Refused | Helper::AssertionFailed => {
            let target = contract::decline(b.m)?;
            strings::constant(b, &b.func.name.clone());
            b.load(arg)?;
            b.call(target);
            b.instruction(&I::Unreachable);
            return Ok(());
        }
        Helper::BoolText => {
            let yes = b.m.literal("true");
            let no = b.m.literal("false");
            b.load(arg)?;
            b.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::EXTERNREF))));
            b.global_get(yes);
            b.instruction(&I::Else);
            b.global_get(no);
            b.instruction(&I::End);
        }
        Helper::ConsoleWrite => {
            return Err(Failure::Invariant("console write past its arm".into()));
        }
        Helper::ValueText | Helper::TagName => {
            let text = if helper == Helper::ValueText {
                value_text(b.m)?
            } else {
                tag_name(b.m)?
            };
            b.load(arg)?;
            strings::constant(b, &b.func.name.clone());
            b.call(text);
        }
    }
    if !strings::is_string(b.ty(result)) {
        return Err(format!("value helper {helper:?} result {:?}", b.ty(result)).into());
    }
    Ok(())
}

/// `String(v)` of an erased value, by its tag: the absences and booleans by
/// name, a number by `Number.prototype.toString`, a string as itself. An object
/// or a function prints as its type says it does, which nothing here records
/// yet, so it is refused by name rather than answered `"[object Object]"`.
///
/// Params: the value, and the calling function's name for the refusal.
fn value_text(m: &mut Builder<'_>) -> Result<Func, Failure> {
    m.helper(
        FuncKey::ValueText,
        "value.toString",
        vec![
            crate::types::Physical::Reference(RefType::ANYREF),
            strings::STRING,
        ],
        Some(strings::STRING),
        |m| {
            let tag = erased::callee(m, erased::Helper::Tag)?;
            let boolean = erased::callee(m, erased::Helper::Boolean)?;
            let number = erased::callee(m, erased::Helper::Number)?;
            let number_text = host::external("nts_number_to_string")
                .ok_or_else(|| Failure::Invariant("number text service".into()))?
                .callee(m);
            let undefined = m.literal("undefined");
            let null = m.literal("null");
            let yes = m.literal("true");
            let no = m.literal("false");
            let mut f = Function::new([ValType::I32]);
            f.instruction(&I::LocalGet(0));
            f.call(tag);
            f.instructions(&[
                I::LocalSet(2),
                I::Block(BlockType::Result(ValType::Ref(RefType::EXTERNREF))),
            ]);
            // Each arm leaves the text and leaves the block.
            let arm = |f: &mut Function, which: i32| {
                f.instructions(&[
                    I::LocalGet(2),
                    I::I32Const(which),
                    I::I32Eq,
                    I::If(BlockType::Empty),
                ]);
            };
            arm(&mut f, erased::STRING);
            f.instruction(&I::LocalGet(0));
            erased::string_payload(&mut f);
            f.instructions(&[I::Br(1), I::End]);
            arm(&mut f, erased::UNDEFINED);
            f.global_get(undefined);
            f.instructions(&[I::Br(1), I::End]);
            arm(&mut f, erased::NULL);
            f.global_get(null);
            f.instructions(&[I::Br(1), I::End]);
            arm(&mut f, erased::BOOLEAN);
            f.instruction(&I::LocalGet(0));
            f.call(boolean);
            f.instruction(&I::If(BlockType::Result(ValType::Ref(RefType::EXTERNREF))));
            f.global_get(yes);
            f.instruction(&I::Else);
            f.global_get(no);
            f.instructions(&[I::End, I::Br(1), I::End]);
            arm(&mut f, erased::NUMBER);
            f.instruction(&I::LocalGet(0));
            f.call(number);
            f.call(number_text);
            f.instructions(&[I::Br(1), I::End]);
            if m.types.symbol.is_some() {
                arm(&mut f, erased::SYMBOL);
                crate::symbols::erased_text(m, &mut f, 0)?;
                f.instructions(&[I::Br(1), I::End]);
            }
            if m.types.erased.is_some_and(|erased| erased.bigint.is_some()) {
                arm(&mut f, erased::BIGINT);
                crate::bigints::erased_text(m, &mut f, 0)?;
                f.instructions(&[I::Br(1), I::End]);
            }
            contract::refuse_in(
                &mut f,
                m,
                1,
                "String() of an object or a function, whose type says nothing here about how it prints",
            )?;
            f.instructions(&[I::End, I::End]);
            Ok(f)
        },
    )
}

/// `typeof` for a tag, as the language spells it: `null` and a native
/// handle answer `"object"`. A tag that names no value is refused by name.
///
/// Params: the tag, and the calling function's name for the refusal.
fn tag_name(m: &mut Builder<'_>) -> Result<Func, Failure> {
    use nts_core::hir::tags;
    m.helper(
        FuncKey::TagName,
        "value.typeof",
        vec![
            crate::types::Physical::Scalar(crate::types::Slot::I32),
            strings::STRING,
        ],
        Some(strings::STRING),
        |m| {
            // One block per answer, innermost first; the table sends each tag
            // to its answer's depth and anything else to the refusal.
            let answers = [
                "undefined",
                "boolean",
                "number",
                "string",
                "function",
                "symbol",
                "object",
                "bigint",
            ];
            let refusal = u32::try_from(answers.len()).expect("eight answers");
            let depth = |name: &str| {
                answers
                    .iter()
                    .position(|answer| *answer == name)
                    .and_then(|at| u32::try_from(at).ok())
                    .expect("a listed answer")
            };
            let mut table = vec![refusal; tags::BIGINT as usize + 1];
            for (tag, name) in [
                (tags::UNDEFINED, "undefined"),
                (tags::BOOLEAN, "boolean"),
                (tags::NUMBER, "number"),
                (tags::STRING, "string"),
                (tags::FUNCTION, "function"),
                (tags::SYMBOL, "symbol"),
                (tags::OBJECT, "object"),
                (tags::NULL, "object"),
                (tags::HANDLE_GOBJECT, "object"),
                (tags::HANDLE_OBJC, "object"),
                (tags::HANDLE_COM, "object"),
                (tags::BIGINT, "bigint"),
            ] {
                table[tag as usize] = depth(name);
            }
            let literals: Vec<_> = answers.iter().map(|answer| m.literal(answer)).collect();
            let mut f = Function::default();
            for _ in 0..=answers.len() {
                f.instruction(&I::Block(BlockType::Empty));
            }
            f.instructions(&[I::LocalGet(0), I::BrTable(table.into(), refusal), I::End]);
            for literal in literals {
                f.global_get(literal);
                f.instructions(&[I::Return, I::End]);
            }
            contract::refuse_in(&mut f, m, 1, "`typeof` of a value whose tag names no value")?;
            f.instruction(&I::End);
            Ok(f)
        },
    )
}

/// `console.log` and `console.error` of one line: the host writes it, as node
/// does, with its own newline.
fn console_write(b: &mut Body<'_, '_>, args: &[ValueId]) -> Result<(), Failure> {
    let &[line, to_stderr] = args else {
        return Err("console write arity mismatch".into());
    };
    if !strings::is_string(b.ty(line)) || b.ty(to_stderr) != &HirType::Bool {
        return Err("console write of a non-string line".into());
    }
    let write = b.m.import(
        FuncKey::ConsoleWrite,
        "nts:host/v1",
        "nts_console_write",
        vec![
            strings::STRING,
            crate::types::Physical::Scalar(crate::types::Slot::I32),
        ],
        None,
        false,
    );
    contract::nonnull(b, line, "writing a null line")?;
    b.load(line)?;
    b.load(to_stderr)?;
    b.call(write);
    Ok(())
}
