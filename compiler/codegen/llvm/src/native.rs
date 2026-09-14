//! Authored C declarations. Runtime helpers continue to use the generated
//! signature table; neither source may redefine a symbol owned by the other.

use std::collections::BTreeMap;

use nts_core::hir::{Callee, Func, HirType, OpKind, Program, ValueId, native::Function};
use nts_diagnostics::Diagnostic;

use super::{extension, name, refuse, signatures, ty_of};

pub(super) fn declarations(program: &Program) -> Result<Vec<String>, Vec<Diagnostic>> {
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
            match declaration(func, target) {
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

fn declaration(func: &Func, target: &Function) -> Result<String, Diagnostic> {
    let result = target.result.representation();
    let parameters = target.parameters.iter().zip(memory_arguments(target))
        .map(|(ty, memory)| {
            let ty = ty.representation();
            if memory { return Ok("ptr byval({ i32, i64 }) align 8".to_owned()); }
            if ty == HirType::Erased { return Ok("i32, i64".to_owned()); }
            Ok(format!("{} {}", ty_of(&ty, func)?, extension(&ty).trim_end()).trim_end().to_owned())
        }).collect::<Result<Vec<_>, Diagnostic>>()?;
    Ok(format!(
        "declare {}{} @{}({})",
        extension(&result),
        ty_of(&result, func)?,
        target.name,
        parameters.join(", ")
    ))
}

pub(super) fn call(
    func: &Func,
    target: &Function,
    args: &[ValueId],
    result: &HirType,
    out: &str,
) -> Result<String, Diagnostic> {
    if args.len() != target.parameters.len() || *result != target.result.representation() {
        return Err(refuse(
            func,
            "a native call whose HIR disagrees with its declared ABI",
        ));
    }
    for (arg, expected) in args.iter().zip(&target.parameters) {
        if !expected.accepts(&func.values[arg.0 as usize].ty) {
            return Err(refuse(
                func,
                "a native argument not reconciled to its declared ABI",
            ));
        }
    }
    let mut before = Vec::new();
    let mut parameters = Vec::new();
    for (at, (arg, memory)) in args.iter().zip(memory_arguments(target)).enumerate() {
        let temp = format!("{out}.arg{at}");
        if memory {
            before.push(format!("store {{ i32, i64 }} {}, ptr {temp}.storage, align 8", name(*arg)));
            parameters.push(format!("ptr byval({{ i32, i64 }}) align 8 {temp}.storage"));
        } else {
            parameters.extend(super::arguments(func, &temp, &[*arg], &mut before)?);
        }
    }
    let prefix = if *result == HirType::Void {
        String::new()

    } else {
        format!("{out} = ")
    };
    before.push(format!(
        "{prefix}call {}{} @{}({})",
        extension(result),
        ty_of(result, func)?,
        target.name,
        parameters.join(", ")
    ));
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
