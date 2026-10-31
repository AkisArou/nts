//! The C function type published by each program-owned indirect entry.
//!
//! Equal pointer bits do not make different C function types compatible.
//! Receiver-only differences are removed at the definition, with a typed
//! projection inside the body. An adapter exists only when another argument
//! or result really changes representation at the dispatch boundary.

use super::{Emission, c_type_of, format_signature, return_c_type};
use nts_codegen_common::CodeWriter;
use nts_core::hir::{Func, HirType, ManagedType, OpKind, Program};
use nts_diagnostics::Diagnostic;
use nts_semantic_schema::Origin;
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;
type LayoutRows<'a> =
    FxHashMap<*const nts_core::hir::Layout, (usize, Result<Vec<Option<&'a str>>, String>)>;
mod callbacks;
mod printers;
mod publication;
pub(super) use callbacks::append_row as append_callback_row;
pub(super) use nts_codegen_common::callback_abi::slot_argument;
pub use publication::{PhysicalEntry, PhysicalValue, PublishedEntries};
pub(super) use publication::{Published, ValueReader};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Receiver {
    Header,
    Task,
}

#[derive(Debug)]
struct Entry {
    receiver: Receiver,
    adapter: Option<String>,
}

/// Bound to one immutable Program. Names here are the Program's unique Func
/// identities, indexed once; source spelling never selects an ABI role.
#[derive(Debug, Clone)]
pub struct Plan<'a> {
    program: &'a Program,
    functions: Rc<FxHashMap<&'a str, &'a Func>>,
    entries: Rc<FxHashMap<&'a str, Entry>>,
    printers: Rc<FxHashSet<&'a str>>,
    tasks: Rc<FxHashSet<&'a str>>,
    rows: Rc<LayoutRows<'a>>,
    globals: Rc<FxHashMap<*const nts_core::hir::Global, usize>>,
    pub(super) value_readers: bool,
    pub(super) parameters: Rc<nts_codegen_common::entry_parameters::EntryParameters<'a>>,
    pub(super) callbacks: Rc<nts_codegen_common::callback_abi::Callbacks<'a>>,
    pub(super) source_symbols: Rc<nts_codegen_common::source_symbols::SourceSymbols<'a>>,
    pub(super) native_symbols: Rc<nts_codegen_common::native_symbols::NativeSymbols<'a>>,
    seal: Rc<()>,
}

impl<'a> Plan<'a> {
    #[must_use]
    pub fn new(program: &'a Program) -> Self {
        Self::build(program, false)
    }

    /// Request readers consumed by a separately emitted addon. Ordinary
    /// native products do not pay for readers they never use.
    #[must_use]
    pub fn for_addon(program: &'a Program) -> Self {
        Self::build(program, true)
    }

    fn build(program: &'a Program, value_readers: bool) -> Self {
        let functions: FxHashMap<_, _> = program
            .funcs
            .iter()
            .map(|function| (function.name.as_str(), function))
            .collect();
        let mut table: FxHashSet<_> = program.dispatch_targets().collect();
        let printers: FxHashSet<_> = program.printing_functions().collect();
        table.extend(printers.iter().copied());
        let mut tasks = FxHashSet::default();
        for function in &program.funcs {
            for block in &function.blocks {
                for value in &block.ops {
                    if let OpKind::Suspend { resume, .. } = &function.value(*value).kind {
                        tasks.insert(resume.as_str());
                    }
                }
            }
        }
        let parameters = Rc::new(nts_codegen_common::entry_parameters::EntryParameters::new(
            program,
        ));
        let mut entries = FxHashMap::default();
        // Stable Func order also fixes private adapter names independently of
        // hash iteration and of how many times a descriptor names the entry.
        for (ordinal, function) in program.funcs.iter().enumerate() {
            let name = function.name.as_str();
            let receiver = if parameters.task_receiver(function) {
                Receiver::Task
            } else if table.contains(name) {
                Receiver::Header
            } else {
                continue;
            };
            let changes_channel = function
                .params
                .iter()
                .skip(1)
                .any(|param| object_reference(&param.ty))
                || object_reference(&function.return_type);
            entries.insert(
                name,
                Entry {
                    receiver,
                    adapter: changes_channel.then(|| format!("__nts_dispatch_{ordinal}")),
                },
            );
        }
        let callbacks = nts_codegen_common::callback_abi::Callbacks::new(program);
        Self {
            program,
            functions: Rc::new(functions),
            entries: Rc::new(entries),
            printers: Rc::new(printers),
            tasks: Rc::new(tasks),
            rows: Rc::new(
                program
                    .layouts
                    .iter()
                    .enumerate()
                    .map(|(at, layout)| {
                        (
                            std::ptr::from_ref(layout),
                            (at, program.native_methods(layout)),
                        )
                    })
                    .collect(),
            ),
            callbacks: Rc::new(callbacks),
            globals: Rc::new(if value_readers {
                program
                    .globals
                    .iter()
                    .enumerate()
                    .map(|(at, global)| (std::ptr::from_ref(global), at))
                    .collect()
            } else {
                FxHashMap::default()
            }),
            value_readers,
            parameters,
            source_symbols: Rc::new(nts_codegen_common::source_symbols::SourceSymbols::new(
                program,
            )),
            native_symbols: Rc::new(nts_codegen_common::native_symbols::NativeSymbols::new(
                program,
            )),
            seal: Rc::new(()),
        }
    }

    pub(super) fn function_named(&self, name: &str) -> Option<&'a Func> {
        self.functions.get(name).copied()
    }

    /// The canonical receiver is the real definition's first parameter. The
    /// original SSA parameter is a local projection, never a second call.
    #[must_use]
    pub fn receiver_type(&self, function: &Func) -> Option<&'static str> {
        self.owns(function).then_some(())?;
        self.entries
            .get(function.name.as_str())
            .map(|entry| match entry.receiver {
                Receiver::Header => "NtsHeader *",
                Receiver::Task => "void *",
            })
    }

    pub(super) fn dispatch_receiver(&self, function: &Func) -> &'static str {
        if self.parameters.task_receiver(function) {
            "void *"
        } else {
            "NtsHeader *"
        }
    }

    pub(super) fn parameter_types<'b>(
        &'b self,
        function: &'b Func,
    ) -> impl Iterator<Item = &'b HirType> {
        function
            .params
            .iter()
            .map(|param| &param.ty)
            .chain(self.parameters.extra(function).iter().copied())
    }

    pub(super) fn direct_arguments(&self, function: &Func, arguments: &mut [String]) {
        if let (Some(ty), Some(argument)) = (self.receiver_type(function), arguments.first_mut()) {
            *argument = format!("({ty})({argument})");
        }
    }

    pub(super) fn symbol(&self, program: &Emission<'_>, name: &str) -> String {
        self.entries
            .get(name)
            .and_then(|entry| entry.adapter.clone())
            .unwrap_or_else(|| program.function(name))
    }

    pub(super) fn printer_symbol(&self, program: &Emission<'_>, name: &str) -> String {
        self.function_named(name)
            .and_then(|f| self.parameters.printer_adapter(f))
            .map_or_else(|| program.function(name), str::to_owned)
    }

    /// Adapters precede tables and follow all body prototypes. A refused body
    /// never licenses an adapter or a table entry.
    pub(super) fn emit_adapters(
        &self,
        writer: &mut CodeWriter,
        program: &Emission<'_>,
        defined: &FxHashSet<String>,
    ) -> Result<(), Diagnostic> {
        for function in &program.funcs {
            let Some(entry) = self.entries.get(function.name.as_str()) else {
                continue;
            };
            let Some(name) = &entry.adapter else {
                continue;
            };
            if !defined.contains(&program.function(&function.name)) {
                continue;
            }
            emit_reference_adapter(writer, program, function, name)?;
        }
        printers::emit(self, writer, program, defined)?;
        for function in &program.funcs {
            if !defined.contains(&program.function(&function.name)) {
                continue;
            }
            if !self.entries.contains_key(function.name.as_str()) {
                continue;
            }
            let pointer = pointer_type(
                program,
                &function.return_type,
                self.parameter_types(function),
                self.dispatch_receiver(function),
                &function.origin,
            )?;
            let symbol = self.symbol(program, &function.name);
            writer.line(&function.origin, format!(
                "_Static_assert(_Generic(&{symbol}, {pointer}: 1, default: 0), \"dispatch entry ABI\");"));
            if self.printers.contains(function.name.as_str()) {
                let symbol = self.printer_symbol(program, &function.name);
                writer.line(&function.origin, format!(
                    "_Static_assert(_Generic(&{symbol}, NtsPrinterEntry: 1, default: 0), \"printer entry ABI\");"));
            }
            if self.tasks.contains(function.name.as_str()) {
                let symbol = program.function(&function.name);
                writer.line(&function.origin, format!(
                    "_Static_assert(_Generic(&{symbol}, NtsTaskEntry: 1, default: 0), \"task entry ABI\");"));
            }
        }
        callbacks::emit(&self.callbacks, writer, program, defined)
    }
}

fn object_reference(ty: &HirType) -> bool {
    matches!(ty, HirType::Managed(ManagedType::Object(_)))
}

pub(super) fn channel_type(
    program: &Emission<'_>,
    ty: &HirType,
    receiver: bool,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    if receiver || object_reference(ty) {
        Ok("NtsHeader *".to_owned())
    } else {
        return_c_type(program, ty, origin)
    }
}

pub(super) fn pointer_type<'a>(
    program: &Emission<'_>,
    returns: &HirType,
    parameters: impl Iterator<Item = &'a HirType>,
    receiver: &str,
    origin: &Origin,
) -> Result<String, Diagnostic> {
    let params = parameters
        .enumerate()
        .map(|(at, ty)| {
            if at == 0 {
                Ok(receiver.to_owned())
            } else {
                channel_type(program, ty, false, origin)
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(format!(
        "{} (*)({})",
        channel_type(program, returns, false, origin)?,
        if params.is_empty() {
            "void".to_owned()
        } else {
            params.join(", ")
        }
    ))
}

fn emit_reference_adapter(
    writer: &mut CodeWriter,
    program: &Emission<'_>,
    function: &Func,
    name: &str,
) -> Result<(), Diagnostic> {
    let parameters = program
        .dispatch_abi
        .parameter_types(function)
        .enumerate()
        .map(|(at, ty)| {
            Ok(format!(
                "{} __nts_a{at}",
                if at == 0 {
                    program.dispatch_abi.dispatch_receiver(function).to_owned()
                } else {
                    channel_type(program, ty, false, &function.origin)?
                }
            ))
        })
        .collect::<Result<Vec<_>, Diagnostic>>()?;
    let returns = channel_type(program, &function.return_type, false, &function.origin)?;
    writer.line(
        &function.origin,
        format!(
            "{} {{",
            format_signature(name, &returns, &parameters, false)
        ),
    );
    let mut arguments = function
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| {
            if at == 0 {
                return Ok(format!("__nts_a{at}"));
            }
            let wanted = c_type_of(program, &param.ty, &param.origin)?;
            Ok(if object_reference(&param.ty) {
                format!("({wanted})__nts_a{at}")
            } else {
                format!("__nts_a{at}")
            })
        })
        .collect::<Result<Vec<_>, Diagnostic>>()?;
    arguments.extend(
        program
            .dispatch_abi
            .parameters
            .extra(function)
            .iter()
            .enumerate()
            .map(|(at, _)| format!("__nts_a{}", function.params.len() + at)),
    );
    program.direct_arguments(function, &mut arguments)?;
    let call = format!(
        "{}({})",
        program.function(&function.name),
        arguments.join(", ")
    );
    writer.indent();
    let statement = if function.return_type == HirType::Void {
        format!("{call};")
    } else if object_reference(&function.return_type) {
        format!("return (NtsHeader *){call};")
    } else {
        format!("return {call};")
    };
    writer.line(&function.origin, statement);
    writer.dedent();
    writer.line(&function.origin, "}");
    Ok(())
}
