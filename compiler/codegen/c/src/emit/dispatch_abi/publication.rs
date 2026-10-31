//! Read-only physical entries, tied to their producer and surviving output.
use super::{Plan, channel_type};
use crate::emit::{Emission, c_type_of, return_c_type};
use nts_core::hir::{Func, Global, Layout, Program};
use nts_diagnostics::Diagnostic;
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;

/// An actual definition or native dispatch entry. `function` is the source
/// body identity; an adapter's padding and representation are not source arity.
#[derive(Debug)]
pub struct PhysicalEntry<'p> {
    pub function: &'p Func,
    pub symbol: String,
    pub parameters: Vec<String>,
    pub result: String,
    pub logical_slot: Option<u32>,
    pub column: Option<u32>,
    /// Whether a separate translation unit may declare this symbol.
    pub linkable: bool,
}

impl PhysicalEntry<'_> {
    #[must_use]
    pub fn pointer_type(&self) -> String {
        format!(
            "{} (*)({})",
            self.result,
            if self.parameters.is_empty() {
                "void".to_owned()
            } else {
                self.parameters.join(", ")
            }
        )
    }
}

/// A C-owned, actually emitted exported-value reader. Its result is a native
/// channel, not a request for the addon to invent a concrete object layout.
/// The result borrows the global value; keeping it requires the caller's own
/// reference under the existing runtime ownership contract.
#[derive(Debug)]
pub struct PhysicalValue<'p> {
    pub global: &'p Global,
    pub symbol: String,
    pub result: String,
    pub linkable: bool,
}

#[derive(Debug)]
pub(in crate::emit) struct ValueReader {
    pub symbol: String,
    pub result: String,
}

impl<'p> Plan<'p> {
    #[must_use]
    pub fn program(&self) -> &'p Program {
        self.program
    }

    pub(super) fn owns(&self, function: &Func) -> bool {
        self.function_named(&function.name)
            .is_some_and(|own| std::ptr::eq(own, function))
    }

    pub(in crate::emit) fn row(&self, layout: &Layout) -> Result<&[Option<&'p str>], String> {
        self.rows
            .get(&std::ptr::from_ref(layout))
            .ok_or_else(|| "layout does not belong to this entry ABI plan".to_owned())?
            .1
            .as_ref()
            .map(Vec::as_slice)
            .map_err(Clone::clone)
    }

    /// Describe a definition's actual C function type. Survival is a separate
    /// backend fact, available only through `Emitted::published_entries`.
    pub fn function(&self, function: &Func) -> Result<Option<PhysicalEntry<'p>>, Diagnostic> {
        let Some(function) = self
            .function_named(&function.name)
            .filter(|own| std::ptr::eq(*own, function))
        else {
            return Ok(None);
        };
        let emission = Emission::planned(self);
        let mut parameters = function
            .params
            .iter()
            .enumerate()
            .map(|(at, param)| {
                if at == 0
                    && let Some(receiver) = self.receiver_type(function)
                {
                    Ok(receiver.to_owned())
                } else {
                    c_type_of(&emission, &param.ty, &param.origin)
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        for ty in self.parameters.extra(function) {
            parameters.push(channel_type(&emission, ty, false, &function.origin)?);
        }
        Ok(Some(PhysicalEntry {
            function,
            symbol: self.source_symbols.function(&function.name),
            parameters,
            result: return_c_type(&emission, &function.return_type, &function.origin)?,
            logical_slot: None,
            column: None,
            linkable: self.source_symbols.is_public(&function.name),
        }))
    }

    fn dispatch(
        &self,
        layout: &Layout,
        slot: u32,
    ) -> Result<Option<PhysicalEntry<'p>>, Diagnostic> {
        let Some(column) = self.program.native_column(slot) else {
            return Ok(None);
        };
        let Some((_, Ok(row))) = self.rows.get(&std::ptr::from_ref(layout)) else {
            return Ok(None);
        };
        let Some(name) = row.get(column as usize).and_then(|name| *name) else {
            return Ok(None);
        };
        let Some(function) = self.function_named(name) else {
            return Ok(None);
        };
        // A table entry must have the canonical dispatch role. A source name
        // alone cannot license the function-pointer cast.
        let Some(entry) = self.entries.get(name) else {
            return Ok(None);
        };
        let emission = Emission::planned(self);
        let parameters = self
            .parameter_types(function)
            .enumerate()
            .map(|(at, ty)| channel_type(&emission, ty, at == 0, &function.origin))
            .collect::<Result<Vec<_>, Diagnostic>>()?;
        Ok(Some(PhysicalEntry {
            function,
            symbol: self.symbol(&emission, name),
            parameters,
            result: channel_type(&emission, &function.return_type, false, &function.origin)?,
            logical_slot: Some(slot),
            column: Some(column),
            linkable: entry.adapter.is_none() && self.source_symbols.is_public(name),
        }))
    }
}

/// Owned output retains only a private shared seal and the producer's actual
/// survival recording. It does not extend the borrowed Program's lifetime.
#[derive(Debug)]
pub(in crate::emit) struct Published {
    seal: Rc<()>,
    defined: FxHashSet<String>,
    layouts: FxHashSet<usize>,
    values: FxHashMap<usize, ValueReader>,
    available: bool,
}

impl Published {
    pub(in crate::emit) fn empty(plan: &Plan<'_>, diagnostics: &[Diagnostic]) -> Self {
        Self::new(
            plan,
            &FxHashSet::default(),
            FxHashSet::default(),
            FxHashMap::default(),
            true,
            diagnostics,
        )
    }
    pub(in crate::emit) fn new(
        plan: &Plan<'_>,
        defined: &FxHashSet<String>,
        layouts: FxHashSet<usize>,
        values: FxHashMap<usize, ValueReader>,
        available: bool,
        diagnostics: &[Diagnostic],
    ) -> Self {
        Self {
            seal: Rc::clone(&plan.seal),
            defined: defined.clone(),
            layouts,
            values,
            available: available
                && !diagnostics
                    .iter()
                    .any(crate::emit::leaves_the_program_inconsistent),
        }
    }
    pub(in crate::emit) fn view<'e, 'p>(
        &'e self,
        plan: &'e Plan<'p>,
        refused: &'e [String],
    ) -> Option<PublishedEntries<'e, 'p>> {
        (self.available && Rc::ptr_eq(&self.seal, &plan.seal)).then_some(PublishedEntries {
            plan,
            published: self,
            refused,
        })
    }
}

/// Surviving entries of one exact emission, borrowing its original plan.
#[derive(Debug)]
pub struct PublishedEntries<'e, 'p> {
    plan: &'e Plan<'p>,
    published: &'e Published,
    refused: &'e [String],
}

impl<'e, 'p> PublishedEntries<'e, 'p> {
    /// None for a foreign/private/absent global or for output whose producer
    /// never wrote its reader. The shared seal is checked before this view.
    #[must_use]
    pub fn value(&self, global: &Global) -> Option<PhysicalValue<'p>> {
        let at = *self.plan.globals.get(&std::ptr::from_ref(global))?;
        let reader = self.published.values.get(&at)?;
        Some(PhysicalValue {
            global: &self.plan.program.globals[at],
            symbol: reader.symbol.clone(),
            result: reader.result.clone(),
            linkable: true,
        })
    }
    #[must_use]
    pub fn program(&self) -> &'p Program {
        self.plan.program()
    }
    #[must_use]
    pub fn plan(&self) -> &'e Plan<'p> {
        self.plan
    }
    #[must_use]
    pub fn refused(&self) -> &'e [String] {
        self.refused
    }

    pub fn function(&self, function: &Func) -> Result<Option<PhysicalEntry<'p>>, Diagnostic> {
        Ok(self
            .plan
            .function(function)?
            .filter(|entry| self.published.defined.contains(&entry.symbol)))
    }
    pub fn dispatch(
        &self,
        layout: &Layout,
        slot: u32,
    ) -> Result<Option<PhysicalEntry<'p>>, Diagnostic> {
        let Some((at, _)) = self.plan.rows.get(&std::ptr::from_ref(layout)) else {
            return Ok(None);
        };
        if !self.published.layouts.contains(at) {
            return Ok(None);
        }
        Ok(self.plan.dispatch(layout, slot)?.filter(|entry| {
            self.published
                .defined
                .contains(&self.plan.source_symbols.function(&entry.function.name))
        }))
    }
}
