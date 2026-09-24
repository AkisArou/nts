//! Authored C declarations. Runtime helpers continue to use the generated
//! signature table; neither source may redefine a symbol owned by the other.

use std::collections::BTreeMap;

use nts_core::hir::{Callee, Func, HirType, OpKind, Program, ValueId, native::{Function, NativeAbi}};
use nts_diagnostics::Diagnostic;

use super::aggregate::{self, Crossing, Plan};
use super::{extension, name, refuse, signatures, ty_of};

/// How this call's arguments and result cross, or the refusal that names why
/// a record in it cannot: under Win64, whose aggregate convention this backend
/// does not implement, or a record `aggregate::classify` does not describe.
pub(super) fn plan(func: &Func, target: &Function, leading: usize, abi: NativeAbi) -> Result<Plan, Diagnostic> {
    aggregate::plan(leading, &target.parameters, &target.result, abi).ok_or_else(|| {
        refuse(func, if abi == NativeAbi::Win64 {
            "a C record passed or returned by value under Win64, whose aggregate calling convention this backend does not implement; the C backend builds it"
        } else {
            "a C record passed or returned by value that this backend cannot classify (a union, or a member it cannot place); the C backend builds it"
        })
    })
}

/// The declared spelling of one fixed parameter.
fn parameter_spelling(func: &Func, ty: &nts_core::hir::native::Type, crossing: &Crossing, abi: NativeAbi) -> Result<Vec<String>, Diagnostic> {
    Ok(match crossing {
        Crossing::ErasedInMemory => vec!["ptr byval({ i32, i64 }) align 8".to_owned()],
        Crossing::Record(passing) => aggregate::parameter_types(passing),
        Crossing::Scalar => {
            let ty = ty.abi(abi);
            if ty == HirType::Erased {
                vec!["i32, i64".to_owned()]
            } else {
                vec![format!("{} {}", ty_of(&ty, func)?, extension(&ty).trim_end()).trim_end().to_owned()]
            }
        }
    })
}

/// The return type a call is declared and made with: a record's eightbytes or
/// `void` for one in memory, and otherwise the slot C returns in.
fn returned_type(func: &Func, target: &Function, plan: &Plan, abi: NativeAbi) -> Result<String, Diagnostic> {
    if let Some(passing) = &plan.result {
        return Ok(aggregate::result_type(passing));
    }
    let result = target.result.abi(abi);
    Ok(format!("{}{}", extension(&result), ty_of(&result, func)?))
}

/// The arguments C sees, and a record result's storage: the last HIR
/// argument, which is where the result is stored or the `sret` pointer and
/// never an argument of its own.
pub(super) fn split_destination<'a>(target: &Function, args: &'a [ValueId]) -> (&'a [ValueId], Option<ValueId>) {
    match (target.destination(), args.split_last()) {
        (Some(_), Some((last, rest))) => (rest, Some(*last)),
        _ => (args, None),
    }
}

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
    let plan = plan(func, target, 0, abi)?;
    let mut parameters: Vec<String> = plan.result.as_ref().and_then(|passing| aggregate::sret(passing, "")).map(|hidden| hidden.trim_end().to_owned()).into_iter().collect();
    for (ty, crossing) in target.parameters.iter().zip(&plan.arguments) {
        parameters.extend(parameter_spelling(func, ty, crossing, abi)?);
    }
    // `...` and nothing after it, as in C. LLVM needs the declaration to say
    // so, because a call to a variadic function has to spell the function type
    // at the call site and the two must agree.
    if target.variadic.is_some() {
        parameters.push("...".to_owned());
    }
    Ok(format!(
        "declare {} @{}({})",
        returned_type(func, target, &plan, abi)?,
        target.name,
        parameters.join(", ")
    ))
}

/// `i32 (ptr, i32, ...)` -- the function type a variadic call must name.
///
/// A call to a non-variadic function may leave it out, and does; LLVM takes it
/// from the callee. For a variadic one it is required, because the call is what
/// says how many arguments are actually being passed.
fn variadic_type(func: &Func, target: &Function, plan: &Plan, abi: NativeAbi) -> Result<String, Diagnostic> {
    let mut parameters = Vec::new();
    for (ty, crossing) in target.parameters.iter().zip(&plan.arguments) {
        match crossing {
            Crossing::ErasedInMemory | Crossing::Record(aggregate::Passing::Memory { .. }) => parameters.push("ptr".to_owned()),
            Crossing::Record(passing) => parameters.extend(aggregate::parameter_types(passing)),
            Crossing::Scalar => {
                let ty = ty.abi(abi);
                parameters.push(if ty == HirType::Erased { "i32, i64".to_owned() } else { ty_of(&ty, func)?.to_owned() });
            }
        }
    }
    parameters.push("...".to_owned());
    // A variadic function never returns a record: `from_signature` refuses it.
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
    let plan = plan(func, target, 0, abi)?;
    let carried = target.argument_types().count();
    let miscounted = match target.variadic {
        Some(_) => args.len() < carried,
        None => args.len() != carried,
    };
    if miscounted || *result != target.call_result() {
        return Err(refuse(
            func,
            "a native call whose HIR disagrees with its declared ABI",
        ));
    }
    for (at, arg) in args.iter().enumerate() {
        let Some(expected) = target.argument(at) else {
            continue;
        };
        if !expected.accepts(&func.values[arg.0 as usize].ty) {
            return Err(refuse(
                func,
                "a native argument not reconciled to its declared ABI",
            ));
        }
    }
    let (args, destination) = split_destination(target, args);
    let mut before = Vec::new();
    let mut parameters = Vec::new();
    if let (Some(passing), Some(destination)) = (&plan.result, destination) {
        parameters.extend(aggregate::sret(passing, &name(destination)));
    }
    // The tail is never a memory argument: every type that would be passed
    // that way is refused as a variadic tail where the declaration is read.
    let crossings = plan.arguments.iter().cloned().chain(std::iter::repeat(Crossing::Scalar)).take(args.len());
    for (at, (arg, crossing)) in args.iter().zip(crossings).enumerate() {
        let temp = format!("{out}.arg{at}");
        let declared = target.argument(at);
        let value = &func.values[arg.0 as usize].ty;
        match crossing {
            Crossing::ErasedInMemory => {
                before.push(format!("store {{ i32, i64 }} {}, ptr {temp}.storage, align 8", name(*arg)));
                parameters.push(format!("ptr byval({{ i32, i64 }}) align 8 {temp}.storage"));
            }
            Crossing::Record(passing) => {
                let align = record_alignment(func, declared, abi)?;
                parameters.extend(aggregate::load_argument(&passing, align, &name(*arg), &temp, &mut before));
            }
            Crossing::Scalar => {
                if let Some(slot) = declared.map(|ty| ty.abi(abi)).filter(|slot| super::widening(slot, value).is_some()) {
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
        }
    }
    if let (Some(passing), Some(destination)) = (&plan.result, destination) {
        let align = record_alignment(func, Some(&target.result), abi)?;
        let returned = format!("{out}.returned");
        let prefix = if matches!(passing, aggregate::Passing::Memory { .. }) { String::new() } else { format!("{returned} = ") };
        before.push(format!(
            "{prefix}call {} @{}({})",
            aggregate::result_type(passing),
            target.name,
            parameters.join(", ")
        ));
        aggregate::store_result(passing, align, &returned, &name(destination), &mut before);
        return Ok(before.join("\n"));
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
        Some(_) => variadic_type(func, target, &plan, abi)?,
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

/// The alignment of a record crossing by value, for the loads and stores that
/// move its eightbytes.
pub(super) fn record_alignment(func: &Func, ty: Option<&nts_core::hir::native::Type>, abi: NativeAbi) -> Result<u32, Diagnostic> {
    match ty {
        Some(nts_core::hir::native::Type::Record(record)) => aggregate::alignment(record, abi),
        _ => None,
    }
    .ok_or_else(|| refuse(func, "a C record by value whose layout this backend cannot place"))
}

/// One temporary per call site, in the entry block, so a call in a loop does
/// not accumulate stack allocations. The callee receives a by-value copy.
pub(super) fn stack_arguments(func: &Func, abi: NativeAbi) -> Vec<String> {
    let mut storage = Vec::new();
    for value in func.blocks.iter().flat_map(|block| &block.ops) {
        let OpKind::Call { callee: Callee::Native(target), .. } = &func.values[value.0 as usize].kind else { continue; };
        // A call whose records cannot be planned is refused where it is
        // emitted, so it needs no storage here.
        let Some(plan) = aggregate::plan(0, &target.parameters, &target.result, abi) else { continue };
        for (at, crossing) in plan.arguments.iter().enumerate() {
            if *crossing == Crossing::ErasedInMemory {
                storage.push(format!("{}.arg{at}.storage = alloca {{ i32, i64 }}, align 8", name(*value)));
            }
        }
    }
    storage
}
