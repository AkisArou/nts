//! Render the shared physical arity through the existing LLVM ABI machinery.
//! The prepared Program and its logical parameter lists remain immutable.
use crate::Emission;
use nts_core::hir::{self, Callee, Func, OpKind, Param, ParamShape, ValueId};
use std::borrow::Cow;

pub(super) fn physical<'a>(program: &Emission<'_>, source: &'a Func) -> Cow<'a, Func> {
    let mut result = Cow::Borrowed(source);
    for (at, ty) in program.entry_parameters.extra(source).iter().enumerate() {
        result.to_mut().params.push(Param {
            name: format!("__nts_ignored{at}"),
            ty: (*ty).clone(),
            origin: source.origin.clone(),
            shape: ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        });
    }
    if !program.entry_parameters.pads_calls(source) {
        return result;
    }
    for (block, body) in source.blocks.iter().enumerate() {
        let mut operations = Vec::new();
        let mut changed = false;
        for id in &body.ops {
            let op = source.value(*id);
            if let OpKind::Call { callee, args, .. } = &op.kind
                && let Some(target) = program.source_symbols.declaration(callee)
                && matches!(callee, Callee::Direct(_) | Callee::Virtual { .. })
            {
                let supplied = args.len().saturating_sub(target.params.len());
                let extras = program.entry_parameters.extra(target).iter().skip(supplied);
                let mut padding = Vec::new();
                for ty in extras {
                    let function = result.to_mut();
                    let id =
                        ValueId(u32::try_from(function.values.len()).expect("physical ABI value"));
                    function.values.push(hir::Op {
                        kind: hir::zero_of(ty),
                        ty: (*ty).clone(),
                        origin: op.origin.clone(),
                    });
                    operations.push(id);
                    padding.push(id);
                    changed = true;
                }
                if !padding.is_empty()
                    && let OpKind::Call { args, .. } =
                        &mut result.to_mut().values[id.0 as usize].kind
                {
                    args.extend(padding);
                }
            }
            operations.push(*id);
        }
        if changed {
            result.to_mut().blocks[block].ops = operations;
        }
    }
    result
}

/// Native bridges have already converted their logical arguments. Append the
/// unused tail through the definition's existing physical ABI machinery.
pub(super) fn pad(
    program: &Emission<'_>,
    source: &Func,
    arguments: &mut Vec<String>,
    platform: crate::Platform,
    lines: &mut String,
) -> Result<(), nts_diagnostics::Diagnostic> {
    let extra = program.entry_parameters.extra(source);
    if extra.is_empty() {
        return Ok(());
    }
    let types: Vec<_> = source
        .params
        .iter()
        .map(|p| p.ty.clone())
        .chain(extra.iter().map(|ty| (*ty).clone()))
        .collect();
    let mut before = Vec::new();
    arguments.extend(crate::optional::zero_arguments(
        source,
        &types,
        platform,
        "%entry",
        &mut before,
    )?);
    for line in before {
        lines.push_str("  ");
        lines.push_str(&line);
        lines.push('\n');
    }
    Ok(())
}

/// Publish only the fixed roles whose arity differs from their actual body.
pub(super) fn printers(
    program: &Emission<'_>,
    kept: &std::collections::BTreeSet<&str>,
    platform: crate::Platform,
    text: &mut String,
) -> Result<(), nts_diagnostics::Diagnostic> {
    use std::fmt::Write as _;
    for function in &program.funcs {
        let Some(adapter) = program.entry_parameters.printer_adapter(function) else {
            continue;
        };
        if !kept.contains(function.name.as_str()) {
            continue;
        }
        if function.params.len() != 1
            || function.return_type != hir::HirType::Managed(hir::ManagedType::String)
        {
            return Err(crate::refuse(
                function,
                "a descriptor printer without the logical receiver/string contract",
            ));
        }
        let mut args = vec!["ptr %receiver".to_owned()];
        let mut before = String::new();
        pad(program, function, &mut args, platform, &mut before)?;
        let target = crate::definition(program, function, platform).1;
        let _ = writeln!(
            text,
            "define internal ptr @{}(ptr %receiver) nounwind {{\nentry:\n{before}  %answer = call ptr {target}({})\n  ret ptr %answer\n}}",
            adapter,
            args.join(", ")
        );
    }
    Ok(())
}
