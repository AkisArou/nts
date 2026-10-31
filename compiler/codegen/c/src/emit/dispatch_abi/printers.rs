//! Fixed descriptor-printer role entries for methods with a physical tail.
use super::{Emission, Plan};
use nts_codegen_common::CodeWriter;
use nts_core::hir::{HirType, ManagedType};
use nts_diagnostics::Diagnostic;
use rustc_hash::FxHashSet;

pub(super) fn emit(
    plan: &Plan<'_>,
    writer: &mut CodeWriter,
    program: &Emission<'_>,
    defined: &FxHashSet<String>,
) -> Result<(), Diagnostic> {
    for function in &program.funcs {
        let Some(name) = plan.parameters.printer_adapter(function) else {
            continue;
        };
        if !defined.contains(&program.function(&function.name)) {
            continue;
        }
        if function.params.len() != 1
            || function.return_type != HirType::Managed(ManagedType::String)
        {
            return Err(Diagnostic::error(
                "NTS2006",
                "a descriptor printer without the logical receiver/string contract",
                function.origin.location,
            ));
        }
        let mut arguments = vec!["__nts_receiver".to_owned()];
        program.direct_arguments(function, &mut arguments)?;
        writer.line(
            &function.origin,
            format!(
                "static NtsHeader *{name}(NtsHeader *__nts_receiver) {{ return {}({}); }}",
                program.function(&function.name),
                arguments.join(", ")
            ),
        );
    }
    Ok(())
}
