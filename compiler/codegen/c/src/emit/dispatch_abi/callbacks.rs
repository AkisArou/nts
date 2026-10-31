//! C spelling of the shared callback-role plan; no reach or target derivation.
use super::super::{Emission, return_c_type};
use nts_codegen_common::{CodeWriter, callback_abi::Callbacks};
use nts_core::hir::Layout;
use nts_diagnostics::Diagnostic;
use rustc_hash::FxHashSet;

pub(in super::super) fn append_row(
    plan: &Callbacks<'_>,
    program: &Emission<'_>,
    layout: &Layout,
    defined: &FxHashSet<String>,
    row: &mut Vec<String>,
) -> bool {
    if plan.slots().next().is_none() {
        return false;
    }
    row.resize(plan.width(), "0".to_owned());
    row.extend(plan.slots().map(|slot| {
        let Some((function, adapter)) = plan.binding(layout, slot) else {
            return "0".to_owned();
        };
        if !defined.contains(&program.function(&function.name)) {
            return "0".to_owned();
        }
        let symbol = adapter.map_or_else(|| program.function(&function.name), str::to_owned);
        format!("(void *){symbol}")
    }));
    true
}

pub(super) fn emit(
    plan: &Callbacks<'_>,
    writer: &mut CodeWriter,
    program: &Emission<'_>,
    defined: &FxHashSet<String>,
) -> Result<(), Diagnostic> {
    if let Some((origin, reason)) = plan.errors().next() {
        return Err(Diagnostic::error("NTS2006", reason, origin.location));
    }
    for adapter in plan.adapters() {
        let function = adapter.function;
        if !defined.contains(&program.function(&function.name)) {
            continue;
        }
        let mut arguments = vec!["__nts_receiver".to_owned()];
        if adapter.uniform {
            arguments.resize(function.params.len(), "nts_value_of_undefined()".to_owned());
        }
        program.direct_arguments(function, &mut arguments)?;
        let call = format!(
            "{}({})",
            program.function(&function.name),
            arguments.join(", ")
        );
        let body = if let Some(counter) = adapter.release {
            use nts_codegen_common::counting::Counter;
            let release = match counter {
                Counter::Runtime => "nts_release((NtsHeader *)__nts_result);".to_owned(),
                Counter::Tagged => "nts_value_release(__nts_result);".to_owned(),
                Counter::Foreign(counting) => {
                    format!("{}((void *)__nts_result);", counting.called(false))
                }
            };
            let result_type = return_c_type(program, &function.return_type, &function.origin)?;
            format!("{result_type} __nts_result = {call}; {release}")
        } else {
            format!("(void){call};")
        };
        writer.line(
            &function.origin,
            format!(
                "static void {}(NtsHeader *__nts_receiver) {{ {body} }}",
                adapter.name,
            ),
        );
        writer.line(&function.origin, format!("_Static_assert(_Generic(&{}, NtsManagedCallbackEntry: 1, default: 0), \"timer entry ABI\");", adapter.name));
    }
    Ok(())
}
