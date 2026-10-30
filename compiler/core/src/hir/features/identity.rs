//! Library-global identity, independently of which provider is selected.
//!
//! Scope membership and provenance come from the checker-owned symbol record.
//! A written name, a type with that name, or a module export is not that fact.

use nts_semantic_schema::{Library, SnapshotError, SymbolFlags, SymbolId, SymbolRecord};

/// The two independent meanings in the checker's global binding tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobalMeaning {
    Value,
    Type,
}

/// A checked binding in one snapshot. It borrows that snapshot and cannot be
/// retained as the identity of a later checking revision.
#[derive(Debug, Clone, Copy)]
pub struct GlobalBinding<'a> {
    symbol: SymbolId,
    record: &'a SymbolRecord,
    name: &'a str,
    library: &'a Library,
    meaning: GlobalMeaning,
}

impl<'a> GlobalBinding<'a> {
    #[must_use]
    pub const fn symbol(self) -> SymbolId {
        self.symbol
    }
    #[must_use]
    pub const fn record(self) -> &'a SymbolRecord {
        self.record
    }
    #[must_use]
    pub const fn name(self) -> &'a str {
        self.name
    }
    #[must_use]
    pub const fn library(self) -> &'a Library {
        self.library
    }
    #[must_use]
    pub const fn meaning(self) -> GlobalMeaning {
        self.meaning
    }

    /// Source-level membership only. Target/helper and call-shape eligibility
    /// remain separate resolver/lowering obligations.
    #[must_use]
    pub fn compiler_provided(self) -> bool {
        super::compiler::provides_binding(self.library, self.name)
    }
}

/// Follow checked aliases, then require the exact global meaning and the
/// declaration-library fact. Source-owned declarations never acquire a provider
/// merely because a library also declares the same name.
///
/// Invalid identities and alias cycles are errors, not an absent requirement.
pub fn global_binding(
    symbols: &[SymbolRecord],
    mut symbol: SymbolId,
    meaning: GlobalMeaning,
) -> Result<Option<GlobalBinding<'_>>, SnapshotError> {
    // A non-cyclic chain visits at most the number of symbols in the arena.
    // This bounds malformed inputs without recursion or a per-lookup hash set.
    for _ in 0..symbols.len() {
        let record = symbols.get(symbol.0 as usize).ok_or_else(|| {
            SnapshotError::Project("global binding refers to an unknown symbol".into())
        })?;
        if let Some(target) = record.aliased {
            symbol = target;
            continue;
        }
        let flag = match meaning {
            GlobalMeaning::Value => SymbolFlags::GLOBAL_VALUE,
            GlobalMeaning::Type => SymbolFlags::GLOBAL_TYPE,
        };
        if !record.flags.contains(flag) {
            return Ok(None);
        }
        let Some(library) = record.library.as_ref() else {
            return Ok(None);
        };
        if !record.declarations.is_empty() || record.declaration_sites.is_empty() {
            return Err(SnapshotError::Project(
                "a library global has contradictory declaration provenance".into(),
            ));
        }
        let name = record.name.public_name().ok_or_else(|| {
            SnapshotError::Project("a library global has no public binding name".into())
        })?;
        return Ok(Some(GlobalBinding {
            symbol,
            record,
            name,
            library,
            meaning,
        }));
    }
    Err(SnapshotError::Project("cyclic global binding alias".into()))
}
