//! Authored C declarations. Runtime helpers continue to use the generated
//! signature table; neither source may redefine a symbol owned by the other.

use std::collections::BTreeMap;

use nts_core::hir::{Callee, Func, HirType, OpKind, Program, ValueId, native::{Function, NativeAbi}};
use nts_diagnostics::Diagnostic;

use super::{extension, name, refuse, signatures, ty_of};

pub(super) fn declarations(program: &Program, abi: NativeAbi) -> Result<Vec<String>, Vec<Diagnostic>> {
    let mut seen: BTreeMap<&str, (&Function, String)> = BTreeMap::new();
    let mut errors = Vec::new();
    for func in &program.funcs {
        for op in func
            .blocks
            .iter()
            .flat_map(|b| &b.ops)
            .map(|id| &func.values[id.0 as usize])
        {
            let OpKind::Call {
                callee: Callee::Native(target),
                ..
            } = &op.kind
            else {
                continue;
            };
            // A message has no symbol: `objc::module` declares `objc_msgSend`,
            // and each call spells its own function type.
            if target.send.is_some() {
                continue;
            }
            let symbol = target.name.as_str();
            let problem = if !nts_codegen_common::symbols::is_native_c_identifier(symbol) {
                Some(format!(
                    "foreign symbol `{symbol}` is not an available C identifier"
                ))
            } else if ((signatures::signature(symbol).is_some()
                || nts_core::hir::runtime::parameters(symbol).is_some())
                && target.convention == nts_core::hir::native::Convention::C)
                || program
                    .funcs
                    .iter()
                    .any(|f| nts_codegen_common::symbols::c_identifier(&f.name) == symbol)
            {
                Some(format!(
                    "foreign symbol `{symbol}` collides with a runtime or compiled function"
                ))
            } else if seen
                .get(symbol)
                .is_some_and(|(previous, _)| !previous.same_abi(target))
            {
                Some(format!(
                    "foreign symbol `{symbol}` has conflicting ABI declarations"
                ))
            } else {
                None
            };
            if let Some(problem) = problem {
                errors.push(refuse(func, &problem));
                continue;
            }
            match declaration(func, target, abi) {
                Ok(line) => {
                    if let Some(known) = signatures::signature(symbol) {
                        let expected = format!(
                            "declare {} @{}({})",
                            known.returns,
                            symbol,
                            known.params.join(", ")
                        );
                        if line != expected {
                            errors.push(refuse(func, &format!("managed declaration `{symbol}` disagrees with the runtime header ABI")));
                            continue;
                        }
                    }
                    seen.entry(symbol).or_insert((target, line));
                }
                Err(error) => errors.push(error),
            }
        }
    }
    if errors.is_empty() {
        Ok(seen
            .into_values()
            .filter(|(target, _)| signatures::signature(&target.name).is_none())
            .map(|(_, line)| line)
            .collect())
    } else {
        Err(errors)
    }
}

fn declaration(func: &Func, target: &Function, abi: NativeAbi) -> Result<String, Diagnostic> {
    let result = target.result.abi(abi);
    let parameters = target.parameters.iter().zip(memory_arguments(target))
        .map(|(ty, memory)| {
            let ty = ty.abi(abi);
            if memory { return Ok("ptr byval({ i32, i64 }) align 8".to_owned()); }
            if ty == HirType::Erased { return Ok("i32, i64".to_owned()); }
            Ok(format!("{} {}", ty_of(&ty, func)?, extension(&ty).trim_end()).trim_end().to_owned())
        }).collect::<Result<Vec<_>, Diagnostic>>()?;
    // `...` and nothing after it, as in C. LLVM needs the declaration to say
    // so, because a call to a variadic function has to spell the function type
    // at the call site and the two must agree.
    let mut parameters = parameters;
    if target.variadic.is_some() {
        parameters.push("...".to_owned());
    }
    Ok(format!(
        "declare {}{} @{}({})",
        extension(&result),
        ty_of(&result, func)?,
        target.name,
        parameters.join(", ")
    ))
}

/// `i32 (ptr, i32, ...)` -- the function type a variadic call must name.
///
/// A call to a non-variadic function may leave it out, and does; LLVM takes it
/// from the callee. For a variadic one it is required, because the call is what
/// says how many arguments are actually being passed.
fn variadic_type(func: &Func, target: &Function, abi: NativeAbi) -> Result<String, Diagnostic> {
    let mut parameters = target
        .parameters
        .iter()
        .zip(memory_arguments(target))
        .map(|(ty, memory)| {
            if memory { return Ok("ptr".to_owned()); }
            let ty = ty.abi(abi);
            if ty == HirType::Erased { return Ok("i32, i64".to_owned()); }
            ty_of(&ty, func).map(str::to_owned)
        })
        .collect::<Result<Vec<_>, Diagnostic>>()?;
    parameters.push("...".to_owned());
    Ok(format!(
        "{} ({})",
        ty_of(&target.result.abi(abi), func)?,
        parameters.join(", ")
    ))
}

pub(super) fn call(
    func: &Func,
    target: &Function,
    args: &[ValueId],
    result: &HirType,
    out: &str,
    abi: NativeAbi,
) -> Result<String, Diagnostic> {
    let miscounted = match target.variadic {
        Some(_) => args.len() < target.parameters.len(),
        None => args.len() != target.parameters.len(),
    };
    if miscounted || *result != target.result.representation() {
        return Err(refuse(
            func,
            "a native call whose HIR disagrees with its declared ABI",
        ));
    }
    for (at, arg) in args.iter().enumerate() {
        let Some(expected) = target.parameters.get(at).or(target.variadic.as_ref()) else {
            continue;
        };
        if !expected.accepts(&func.values[arg.0 as usize].ty) {
            return Err(refuse(
                func,
                "a native argument not reconciled to its declared ABI",
            ));
        }
    }
    let mut before = Vec::new();
    let mut parameters = Vec::new();
    // The tail is never a memory argument: every type that would be passed
    // that way is refused as a variadic tail where the declaration is read.
    let passing = memory_arguments(target)
        .into_iter()
        .chain(std::iter::repeat(false))
        .take(args.len());
    for (at, (arg, memory)) in args.iter().zip(passing).enumerate() {
        let temp = format!("{out}.arg{at}");
        let declared = target.parameters.get(at).or(target.variadic.as_ref());
        let value = &func.values[arg.0 as usize].ty;
        if memory {
            before.push(format!("store {{ i32, i64 }} {}, ptr {temp}.storage, align 8", name(*arg)));
            parameters.push(format!("ptr byval({{ i32, i64 }}) align 8 {temp}.storage"));
        } else if let Some(slot) = declared.map(|ty| ty.abi(abi)).filter(|slot| super::widening(slot, value).is_some()) {
            // A value wider than the slot C reads -- a `c_long` under Win64 --
            // is truncated here, as C truncates. A constant that would lose
            // bits was refused before emission (`abi::unrepresentable_constants`).
            let (from, to) = (ty_of(value, func)?, ty_of(&slot, func)?);
            before.push(format!("{temp}.narrow = trunc {from} {} to {to}", name(*arg)));
            parameters.push(format!("{to} {}{temp}.narrow", extension(&slot)));
        } else {
            parameters.extend(super::arguments(func, &temp, &[*arg], &mut before)?);
        }
    }
    let prefix = if *result == HirType::Void {
        String::new()

    } else {
        format!("{out} = ")
    };
    // A variadic call names the function type; an ordinary one names only the
    // return type and lets LLVM take the rest from the callee.
    // The slot C returns in, which is narrower than the value for a `c_long`
    // under Win64: called into a temporary and widened by its signedness.
    let returned = target.result.abi(abi);
    let widened = super::widening(&returned, result);
    let prefix = if widened.is_some() { format!("{out}.narrow = ") } else { prefix };
    let spelled = match target.variadic {
        Some(_) => variadic_type(func, target, abi)?,
        None => ty_of(&returned, func)?.to_owned(),
    };
    before.push(format!(
        "{prefix}call {}{} @{}({})",
        extension(&returned),
        spelled,
        target.name,
        parameters.join(", ")
    ));
    if let Some(widen) = widened {
        before.push(format!("{out} = {widen} {} {out}.narrow to {}", ty_of(&returned, func)?, ty_of(result, func)?));
    }
    Ok(before.join("\n"))
}

/// AMD64 System V assigns an aggregate wholly to registers or wholly to memory.
/// In particular, one free integer register cannot carry half an `NtsValue`.
fn memory_arguments(target: &Function) -> Vec<bool> {
    let mut available = 6usize;
    target.parameters.iter().map(|parameter| {
        let ty = parameter.representation();
        let words = match ty {
            HirType::Erased | HirType::BigInt => 2,
            HirType::Float { .. } | HirType::Void => 0,
            _ => 1,
        };
        let memory = ty == HirType::Erased && available < words;
        if available >= words { available -= words; }
        memory
    }).collect()
}

/// One temporary per call site, in the entry block, so a call in a loop does
/// not accumulate stack allocations. The callee receives a by-value copy.
pub(super) fn stack_arguments(func: &Func) -> Vec<String> {
    let mut storage = Vec::new();
    for value in func.blocks.iter().flat_map(|block| &block.ops) {
        let OpKind::Call { callee: Callee::Native(target), .. } = &func.values[value.0 as usize].kind else { continue; };
        for (at, memory) in memory_arguments(target).into_iter().enumerate() {
            if memory {
                storage.push(format!("{}.arg{at}.storage = alloca {{ i32, i64 }}, align 8", name(*value)));
            }
        }
    }
    storage
}
