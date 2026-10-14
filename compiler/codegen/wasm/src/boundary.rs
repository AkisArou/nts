//! Open values (`unknown`, `any`) at the public boundary.
//!
//! An export whose parameters or result are open takes and gives JS values
//! (`externref`), and a wrapper converts them, as the declared TS type says a
//! JS caller passes and receives them:
//! - **In:** a primitive becomes the open value it is: a number, a string, a
//!   boolean, `undefined` or `null`. The glue refuses an object, a function, a
//!   symbol or a bigint by name before the call: nothing yet says how one of
//!   those crosses.
//! - **Out:** an open primitive becomes the JS value it denotes, as a raise
//!   that leaves the program is thrown; any other kind refuses by name.
use crate::{
    erased::{self, Singleton},
    error::Failure,
    ir::Function,
    module::{Builder, Func, FuncKey},
    strings,
    types::{Physical, Slot},
};
use nts_core::hir::{Func as HirFunc, HirType};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

/// What a value leaving for the host is: a thrown raise, or an export's
/// result. Each refuses a value it cannot convert in its own words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Purpose {
    Thrown,
    Result,
}

/// What `valueKind` answers for a JS primitive.
const NUMBER: i32 = 0;
const STRING: i32 = 1;
const TRUE: i32 = 2;
const FALSE: i32 = 3;
const UNDEFINED: i32 = 4;

/// The host's classification of a JS value, in the codes above (5 for any
/// other), as the glue implements `valueKind`.
pub(crate) const VALUE_KIND: &str = "v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : v === true ? 2 : v === false ? 3 : v === undefined ? 4 : 5";

/// The export `target` of `func`, wrapped where a parameter or the result is
/// open; otherwise `target` itself.
pub(crate) fn entry(m: &mut Builder<'_>, target: Func, func: &HirFunc) -> Result<Func, Failure> {
    let open: Vec<bool> = func
        .params
        .iter()
        .map(|p| p.ty == HirType::Erased)
        .collect();
    let open_result = func.return_type == HirType::Erased;
    if !open_result && !open.contains(&true) {
        return Ok(target);
    }
    let mut params = Vec::new();
    for (param, &open) in func.params.iter().zip(&open) {
        params.push(if open {
            strings::STRING
        } else {
            m.types.value_slot(&param.ty)?
        });
    }
    let result = if open_result {
        Some(strings::STRING)
    } else {
        m.types.slot(&func.return_type)?
    };
    let from = open.contains(&true).then(|| from_host(m)).transpose()?;
    let to = open_result
        .then(|| host_value(m, Purpose::Result))
        .transpose()?;
    let name = m.literal(&func.name);
    m.helper(
        FuncKey::Boundary(target),
        format!("boundary.{}", func.name),
        params,
        result,
        move |_| {
            let mut f = Function::default();
            for (at, open) in (0u32..).zip(&open) {
                f.instruction(&I::LocalGet(at));
                if let (true, Some(from)) = (*open, from) {
                    f.global_get(name);
                    f.call(from);
                }
            }
            f.call(target);
            if let Some(to) = to {
                f.global_get(name);
                f.call(to);
            }
            f.instruction(&I::End);
            Ok(f)
        },
    )
}

/// `(JS value, caller's name) -> open value`, for a primitive.
fn from_host(m: &mut Builder<'_>) -> Result<Func, Failure> {
    m.helper(
        FuncKey::FromHost,
        "value.fromHost",
        vec![strings::STRING, strings::STRING],
        Some(Physical::Reference(RefType::ANYREF)),
        |m| {
            let kind = m.import(
                FuncKey::Host("valueKind"),
                "nts:host/v1",
                "valueKind",
                vec![strings::STRING],
                Some(Physical::Scalar(Slot::I32)),
                false,
            );
            let number = m.import(
                FuncKey::Host("valueNumber"),
                "nts:host/v1",
                "valueNumber",
                vec![strings::STRING],
                Some(Physical::Scalar(Slot::F64)),
                false,
            );
            let boxed = erased::callee(m, erased::Helper::BoxNumber)?;
            let null = erased::singleton(m, Singleton::Null)?;
            let undefined = erased::singleton(m, Singleton::Undefined)?;
            let yes = erased::singleton(m, Singleton::True)?;
            let no = erased::singleton(m, Singleton::False)?;
            // Params: value, name. Locals: its kind.
            let mut f = Function::new([ValType::I32]);
            f.instructions(&[I::LocalGet(0), I::RefIsNull, I::If(BlockType::Empty)]);
            f.global_get(null);
            f.instructions(&[I::Return, I::End, I::LocalGet(0)]);
            f.call(kind);
            f.instruction(&I::LocalSet(2));
            let case = |f: &mut Function, code: i32| {
                f.instructions(&[
                    I::LocalGet(2),
                    I::I32Const(code),
                    I::I32Eq,
                    I::If(BlockType::Empty),
                ]);
            };
            // A JS string is already the open string's payload.
            case(&mut f, STRING);
            f.instructions(&[I::LocalGet(0), I::AnyConvertExtern, I::Return, I::End]);
            case(&mut f, NUMBER);
            f.instruction(&I::LocalGet(0));
            f.call(number);
            f.call(boxed);
            f.instructions(&[I::Return, I::End]);
            for (code, singleton) in [(TRUE, yes), (FALSE, no), (UNDEFINED, undefined)] {
                case(&mut f, code);
                f.global_get(singleton);
                f.instructions(&[I::Return, I::End]);
            }
            crate::contract::refuse_in(
                &mut f,
                m,
                1,
                "an object, a function, a symbol or a bigint as an open value, which this boundary does not convert",
            )?;
            f.instruction(&I::End);
            Ok(f)
        },
    )
}

/// `(open value, caller's name) -> JS value`: the JS value an open primitive
/// denotes. Any other kind has no JS form here yet and refuses by name, in
/// the words of `purpose`. A thrown value also takes its message, or null,
/// which the refusal carries with the value's class name.
pub(crate) fn host_value(m: &mut Builder<'_>, purpose: Purpose) -> Result<Func, Failure> {
    let mut params = vec![Physical::Reference(RefType::ANYREF), strings::STRING];
    if purpose == Purpose::Thrown {
        params.push(strings::STRING);
    }
    m.helper(
        FuncKey::HostValue(purpose),
        match purpose {
            Purpose::Thrown => "value.thrownToHost",
            Purpose::Result => "value.toHost",
        },
        params,
        Some(strings::STRING),
        move |m| host_value_body(m, purpose),
    )
}

/// Params: value, name, and a thrown value's message. Locals: its tag.
fn host_value_body(m: &mut Builder<'_>, purpose: Purpose) -> Result<Function, Failure> {
    let tag = erased::callee(m, erased::Helper::Tag)?;
    let number = erased::callee(m, erased::Helper::Number)?;
    let boolean = erased::callee(m, erased::Helper::Boolean)?;
    let to_number = m.import(
        FuncKey::Host("toNumber"),
        "nts:host/v1",
        "toNumber",
        vec![Physical::Scalar(Slot::F64)],
        Some(strings::STRING),
        false,
    );
    let (decline_name, decline_params, tag_local) = match purpose {
        // The caller's name, the class's name and the message.
        Purpose::Thrown => ("uncaughtDecline", vec![strings::STRING; 3], 3),
        Purpose::Result => ("resultDecline", vec![strings::STRING], 2),
    };
    let decline = m.import(
        FuncKey::Host(decline_name),
        "nts:host/v1",
        decline_name,
        decline_params,
        None,
        false,
    );
    let undefined = m.host_global("undefined");
    let yes = m.host_global("true");
    let no = m.host_global("false");
    let mut f = Function::new([ValType::I32]);
    f.instruction(&I::LocalGet(0));
    f.call(tag);
    f.instruction(&I::LocalSet(tag_local));
    let case = |f: &mut Function, kind: i32| {
        f.instructions(&[
            I::LocalGet(tag_local),
            I::I32Const(kind),
            I::I32Eq,
            I::If(BlockType::Empty),
        ]);
    };
    // A small integer is an i31, which externalizes as the same JS number.
    case(&mut f, erased::NUMBER);
    f.instructions(&[
        I::LocalGet(0),
        I::RefTestNonNull(HeapType::I31),
        I::If(BlockType::Result(ValType::EXTERNREF)),
        I::LocalGet(0),
        I::ExternConvertAny,
        I::Else,
        I::LocalGet(0),
    ]);
    f.call(number);
    f.call(to_number);
    f.instructions(&[I::End, I::Return, I::End]);
    case(&mut f, erased::BOOLEAN);
    f.instruction(&I::LocalGet(0));
    f.call(boolean);
    f.instruction(&I::If(BlockType::Result(ValType::EXTERNREF)));
    f.global_get(yes);
    f.instruction(&I::Else);
    f.global_get(no);
    f.instructions(&[I::End, I::Return, I::End]);
    case(&mut f, erased::STRING);
    f.instruction(&I::LocalGet(0));
    erased::string_payload(&mut f);
    f.instructions(&[I::Return, I::End]);
    case(&mut f, erased::UNDEFINED);
    f.global_get(undefined);
    f.instructions(&[I::Return, I::End]);
    case(&mut f, erased::NULL);
    f.instructions(&[I::RefNull(HeapType::EXTERN), I::Return, I::End]);
    f.instruction(&I::LocalGet(1));
    if purpose == Purpose::Thrown {
        let class_name = crate::raising::callee(m, crate::raising::Helper::ClassName)?;
        f.instruction(&I::LocalGet(0));
        f.call(class_name);
        f.instruction(&I::LocalGet(2));
    }
    f.call(decline);
    f.instructions(&[I::Unreachable, I::End]);
    Ok(f)
}
