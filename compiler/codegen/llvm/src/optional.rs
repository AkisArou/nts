//! Logical optional SSA and the shared target ABI plan. The aggregate is an
//! SSA value inside a function; only ABI coercions need temporary native slots.
use crate::{Arch, Platform};
use crate::{Diagnostic, Func, HirType, OpKind, ValueId, name, refuse, ty_of};
use nts_codegen_common::optional::{self as abi, Passing};
use nts_core::hir::{BlockId, Callee, Terminator};

fn target(platform: Platform) -> abi::Target {
    abi::Target {
        arch: match platform.arch {
            Arch::X86_64 => abi::Arch::X86_64,
            Arch::Aarch64 => abi::Arch::Aarch64,
        },
        abi: platform.abi,
    }
}

pub(super) fn active(parameters: &[HirType], returns: &HirType) -> bool {
    parameters
        .iter()
        .chain(std::iter::once(returns))
        .any(|ty| matches!(ty, HirType::PossiblyUndefined(_)))
}

pub(super) fn active_func(func: &Func) -> bool {
    matches!(func.return_type, HirType::PossiblyUndefined(_))
        || func
            .params
            .iter()
            .any(|p| matches!(p.ty, HirType::PossiblyUndefined(_)))
}

fn extent(ty: &HirType, func: &Func) -> Result<nts_core::hir::layout::Shape, Diagnostic> {
    nts_core::hir::layout::shape_of(ty)
        .ok_or_else(|| refuse(func, "an optional ABI value without storage"))
}

fn allocation(slot: &str, ty: &HirType, func: &Func) -> Result<String, Diagnostic> {
    let shape = extent(ty, func)?;
    Ok(format!(
        "{slot} = alloca [{} x i8], align {}",
        shape.size.max(8),
        shape.align.max(8)
    ))
}

fn store_registers(
    passing: &Passing,
    values: &[String],
    slot: &str,
    prefix: &str,
    lines: &mut Vec<String>,
) {
    if let Passing::Registers(registers) = passing {
        for (at, (register, value)) in registers.iter().zip(values).enumerate() {
            let address = if at == 0 {
                slot.to_owned()
            } else {
                let address = format!("{prefix}.at{at}");
                lines.push(format!(
                    "{address} = getelementptr i8, ptr {slot}, i64 {}",
                    at * 8
                ));
                address
            };
            lines.push(format!(
                "store {} {value}, ptr {address}, align 1",
                register.llvm()
            ));
        }
    }
}

fn load_registers(
    passing: &Passing,
    slot: &str,
    prefix: &str,
    lines: &mut Vec<String>,
) -> Vec<String> {
    let Passing::Registers(registers) = passing else {
        return vec![];
    };
    registers
        .iter()
        .enumerate()
        .map(|(at, register)| {
            let address = if at == 0 {
                slot.to_owned()
            } else {
                let address = format!("{prefix}.at{at}");
                lines.push(format!(
                    "{address} = getelementptr i8, ptr {slot}, i64 {}",
                    at * 8
                ));
                address
            };
            let value = format!("{prefix}.r{at}");
            lines.push(format!(
                "{value} = load {}, ptr {address}, align 1",
                register.llvm()
            ));
            value
        })
        .collect()
}

fn indirect_parameter(passing: &Passing, name: &str, result: bool) -> String {
    let Passing::Indirect { size, align, byval } = passing else {
        unreachable!("indirect parameter");
    };
    if result {
        format!("ptr sret([{size} x i8]) align {align} {name}")
    } else if *byval {
        format!("ptr byval([{size} x i8]) align {align} {name}")
    } else {
        format!("ptr align {align} {name}")
    }
}

pub(super) struct Signature {
    pub returns: String,
    pub parameters: Vec<String>,
    pub prologue: Vec<String>,
    pub result: Option<Passing>,
}

pub(super) fn signature(func: &Func, platform: Platform) -> Result<Option<Signature>, Diagnostic> {
    if !active_func(func) {
        return Ok(None);
    }
    let types: Vec<_> = func.params.iter().map(|p| p.ty.clone()).collect();
    let plan = abi::plan(&types, &func.return_type, target(platform));
    let returns = plan.result.as_ref().map_or_else(
        || crate::return_ty_of(&func.return_type, func).map(str::to_owned),
        |p| Ok(p.result_type()),
    )?;
    let mut parameters = vec![];
    let mut prologue = vec![];
    match &plan.result {
        Some(passing @ Passing::Indirect { .. }) => {
            parameters.push(indirect_parameter(passing, "%optional.return", true));
        }
        Some(Passing::Registers(_)) => prologue.push(allocation(
            "%optional.return.coerce",
            &func.return_type,
            func,
        )?),
        None => {}
    }
    for (at, (ty, passing)) in types.iter().zip(&plan.arguments).enumerate() {
        let value = func
            .values
            .iter()
            .position(|v| matches!(v.kind,OpKind::Param(i) if i as usize==at))
            .map_or_else(
                || format!("%unused{at}"),
                |i| name(ValueId(u32::try_from(i).unwrap_or(u32::MAX))),
            );
        let logical = ty_of(ty, func)?;
        match passing {
            None => parameters.push(format!("{logical} {}{value}", platform.extension(ty))),
            Some(passing @ Passing::Indirect { .. }) => {
                let input = format!("{value}.optional.input");
                parameters.push(indirect_parameter(passing, &input, false));
                prologue.push(format!("{value} = load {logical}, ptr {input}, align 1"));
            }
            Some(passing @ Passing::Registers(registers)) => {
                let slot = format!("{value}.optional.coerce");
                prologue.push(allocation(&slot, ty, func)?);
                let values: Vec<_> = registers
                    .iter()
                    .enumerate()
                    .map(|(i, register)| {
                        let input = format!("{value}.optional.input{i}");
                        parameters.push(format!("{} {input}", register.llvm()));
                        input
                    })
                    .collect();
                store_registers(
                    passing,
                    &values,
                    &slot,
                    &format!("{value}.optional.in"),
                    &mut prologue,
                );
                prologue.push(format!("{value} = load {logical}, ptr {slot}, align 1"));
            }
        }
    }
    Ok(Some(Signature {
        returns,
        parameters,
        prologue,
        result: plan.result,
    }))
}

fn call_plan(func: &Func, id: ValueId, platform: Platform) -> Option<(Vec<HirType>, abi::Plan)> {
    let op = func.value(id);
    let OpKind::Call { callee, args, .. } = &op.kind else {
        return None;
    };
    if matches!(callee, Callee::Native(_)) {
        return None;
    }
    if !matches!(op.ty, HirType::PossiblyUndefined(_))
        && !args
            .iter()
            .any(|v| matches!(func.value(*v).ty, HirType::PossiblyUndefined(_)))
    {
        return None;
    }
    let parameters: Vec<_> = args.iter().map(|v| func.value(*v).ty.clone()).collect();
    active(&parameters, &op.ty).then(|| {
        let plan = abi::plan(&parameters, &op.ty, target(platform));
        (parameters, plan)
    })
}

pub(super) fn scratch(func: &Func, platform: Platform) -> Result<Vec<String>, Diagnostic> {
    let mut result = vec![];
    for id in func.blocks.iter().flat_map(|b| &b.ops) {
        let Some((types, plan)) = call_plan(func, *id, platform) else {
            continue;
        };
        let out = name(*id);
        for (at, (ty, passing)) in types.iter().zip(&plan.arguments).enumerate() {
            if passing.is_some() {
                result.push(allocation(&format!("{out}.optional.a{at}"), ty, func)?);
            }
        }
        if plan.result.is_some() {
            result.push(allocation(
                &format!("{out}.optional.result"),
                &func.value(*id).ty,
                func,
            )?);
        }
    }
    Ok(result)
}

pub(super) fn has_call(func: &Func, id: ValueId, platform: Platform) -> bool {
    call_plan(func, id, platform).is_some()
}

pub(super) fn call(
    func: &Func,
    id: ValueId,
    callable: &str,
    platform: Platform,
    mut lines: Vec<String>,
) -> Result<String, Diagnostic> {
    let op = func.value(id);
    let OpKind::Call { args, .. } = &op.kind else {
        return Err(refuse(func, "an optional ABI call without a callee"));
    };
    let (types, plan) = call_plan(func, id, platform)
        .ok_or_else(|| refuse(func, "an optional ABI call without its plan"))?;
    let out = name(id);
    let result_slot = format!("{out}.optional.result");
    let mut rendered = vec![];
    if let Some(passing @ Passing::Indirect { .. }) = &plan.result {
        rendered.push(indirect_parameter(passing, &result_slot, true));
    }
    for (at, ((arg, ty), passing)) in args.iter().zip(&types).zip(&plan.arguments).enumerate() {
        let logical = ty_of(ty, func)?;
        let Some(passing) = passing else {
            rendered.push(format!(
                "{logical} {}{}",
                platform.extension(ty),
                name(*arg)
            ));
            continue;
        };
        let slot = format!("{out}.optional.a{at}");
        lines.push(format!(
            "store {logical} {}, ptr {slot}, align 1",
            name(*arg)
        ));
        match passing {
            Passing::Indirect { .. } => rendered.push(indirect_parameter(passing, &slot, false)),
            Passing::Registers(registers) => {
                let values = load_registers(
                    passing,
                    &slot,
                    &format!("{out}.optional.arg{at}"),
                    &mut lines,
                );
                rendered.extend(
                    registers
                        .iter()
                        .zip(values)
                        .map(|(r, v)| format!("{} {v}", r.llvm())),
                );
            }
        }
    }
    match &plan.result {
        None => {
            let returns = crate::return_ty_of(&op.ty, func)?;
            let prefix = if returns == "void" {
                String::new()
            } else {
                format!("{out} = ")
            };
            lines.push(format!(
                "{prefix}call {}{returns} {callable}({})",
                platform.extension(&op.ty),
                rendered.join(", ")
            ));
        }
        Some(passing) => {
            let returns = passing.result_type();
            if let Passing::Registers(registers) = passing {
                let returned = format!("{out}.optional.returned");
                lines.push(format!(
                    "{returned} = call {returns} {callable}({})",
                    rendered.join(", ")
                ));
                let values = if registers.len() == 1 {
                    vec![returned.clone()]
                } else {
                    registers
                        .iter()
                        .enumerate()
                        .map(|(i, _)| {
                            let value = format!("{returned}.r{i}");
                            lines.push(format!("{value} = extractvalue {returns} {returned}, {i}"));
                            value
                        })
                        .collect()
                };
                store_registers(
                    passing,
                    &values,
                    &result_slot,
                    &format!("{out}.optional.result.in"),
                    &mut lines,
                );
            } else {
                lines.push(format!("call void {callable}({})", rendered.join(", ")));
            }
            lines.push(format!(
                "{out} = load {}, ptr {result_slot}, align 1",
                ty_of(&op.ty, func)?
            ));
        }
    }
    Ok(lines.join("\n  "))
}

pub(super) fn returned(
    func: &Func,
    term: &Terminator,
    block: BlockId,
    passing: Option<&Passing>,
) -> Result<Option<String>, Diagnostic> {
    let Some(passing) = passing else {
        return Ok(None);
    };
    let Terminator::Return(Some(value)) = term else {
        return Ok(None);
    };
    let slot = if matches!(passing, Passing::Indirect { .. }) {
        "%optional.return"
    } else {
        "%optional.return.coerce"
    };
    let mut lines = vec![format!(
        "store {} {}, ptr {slot}, align 1",
        ty_of(&func.return_type, func)?,
        name(*value)
    )];
    if let Passing::Registers(registers) = passing {
        let prefix = format!("%optional.return.block{}", block.0);
        let values = load_registers(passing, slot, &prefix, &mut lines);
        let result = passing.result_type();
        if registers.len() == 1 {
            lines.push(format!("ret {result} {}", values[0]));
        } else {
            let mut previous = "undef".to_owned();
            for (at, (register, value)) in registers.iter().zip(values).enumerate() {
                let next = format!("{prefix}.joined{at}");
                lines.push(format!(
                    "{next} = insertvalue {result} {previous}, {} {value}, {at}",
                    register.llvm()
                ));
                previous = next;
            }
            lines.push(format!("ret {result} {previous}"));
        }
    } else {
        lines.push("ret void".to_owned());
    }
    Ok(Some(lines.join("\n  ")))
}

pub(super) fn ty(payload: &HirType) -> Option<&'static str> {
    nts_core::hir::possibly_undefined::Payload::new(payload.clone()).ok()?;
    Some(match payload {
        HirType::Managed(_) => "ptr",
        HirType::Bool | HirType::Int { bits: 8, .. } => "{ i8, i8 }",
        HirType::Int { bits: 16, .. } => "{ i16, i8 }",
        HirType::Int { bits: 32, .. } => "{ i32, i8 }",
        HirType::Int { bits: 64, .. } => "{ i64, i8 }",
        HirType::Float { bits: 32 } => "{ float, i8 }",
        HirType::Float { bits: 64 } => "{ double, i8 }",
        HirType::BigInt => "{ i128, i8 }",
        HirType::NativePointer(_) => "{ ptr, i8 }",
        _ => return None,
    })
}

pub(super) fn operation(func: &Func, id: ValueId) -> Result<String, Diagnostic> {
    let op = func.value(id);
    let out = name(id);
    let source = match op.kind {
        OpKind::OptionalDefined(v) | OpKind::OptionalPayload(v) => v,
        _ => id,
    };
    let HirType::PossiblyUndefined(payload) = &func.value(source).ty else {
        return Err(refuse(
            func,
            "an optional operation without its coupled type",
        ));
    };
    let pair = ty_of(&func.value(source).ty, func)?;
    let held = name(source);
    let reference = payload.is_managed();
    Ok(match op.kind {
        OpKind::Optional {
            defined,
            payload: input,
        } if reference => format!(
            "{out} = select i1 {}, ptr {}, ptr @nts_undefined_reference",
            name(defined),
            name(input)
        ),
        OpKind::Optional {
            defined,
            payload: input,
        } => {
            let mut lines = vec![format!("{out}.defined = zext i1 {} to i8", name(defined))];
            let (spelling, input) = if **payload == HirType::Bool {
                lines.push(format!("{out}.payload = zext i1 {} to i8", name(input)));
                ("i8", format!("{out}.payload"))
            } else {
                (ty_of(payload, func)?, name(input))
            };
            lines.push(format!(
                "{out}.half = insertvalue {pair} undef, {spelling} {input}, 0"
            ));
            lines.push(format!(
                "{out} = insertvalue {pair} {out}.half, i8 {out}.defined, 1"
            ));
            lines.join("\n  ")
        }
        OpKind::OptionalDefined(_) if reference => {
            format!("{out} = icmp ne ptr {held}, @nts_undefined_reference")
        }
        OpKind::OptionalDefined(_) => format!(
            "{out}.byte = extractvalue {pair} {held}, 1\n  {out} = icmp ne i8 {out}.byte, 0"
        ),
        OpKind::OptionalPayload(_) if reference => {
            format!("{out} = getelementptr i8, ptr {held}, i64 0")
        }
        OpKind::OptionalPayload(_) if **payload == HirType::Bool => format!(
            "{out}.byte = extractvalue {pair} {held}, 0\n  {out} = icmp ne i8 {out}.byte, 0"
        ),
        OpKind::OptionalPayload(_) => format!("{out} = extractvalue {pair} {held}, 0"),
        OpKind::ConstUndefined if reference => {
            format!("{out} = getelementptr i8, ptr @nts_undefined_reference, i64 0")
        }
        OpKind::ConstUndefined => format!("{out} = insertvalue {pair} zeroinitializer, i8 0, 1"),
        _ => return Err(refuse(func, "an unsupported optional operation")),
    })
}
