//! The construction entries a Node-API addon calls, one per published class.
//!
//! `Program::published_classes` is the publication record. A host constructs
//! each of those classes through one exported factory,
//! `NtsHeader *nts_construct_<instance>(void)`, which allocates the instance
//! with its class's own descriptor and nothing else. Every native backend
//! defines exactly these entries, the addon layer declares and calls exactly
//! these, and both spell them here, so the list cannot drift between C, LLVM
//! and the wrapper that links against either.

use nts_core::hir::{Layout, Program, PublishedClass};
use nts_diagnostics::{Diagnostic, Location};

/// The physical C type spelling shared by the program and its addon wrappers.
/// The prefix makes a layout named after a C keyword an ordinary identifier.
///
/// ASCII punctuation is `_`, which keeps the names a generic instantiation or
/// a frame gets readable in the header (`Box<number>` is `NtsObj_Box_number_`).
/// `$` and every other character that is neither alphanumeric nor ASCII
/// punctuation are escaped as `c_identifier` escapes them, `_uXXXX_`: both had
/// been `_`, so the frames of `static async #$`, `#_` and `#\u2118` were all
/// `NtsObj_Type47____frame`, and clang refused the redefinition -- eight of
/// test262's private-name cases. Two layouts that still spell one name are
/// refused by name in the C backend's `emit_object_types`.
#[must_use]
pub fn object_type_name(layout: &Layout) -> String {
    use std::fmt::Write as _;
    let mut name = String::from("NtsObj_");
    for c in layout.name.chars() {
        if c.is_alphanumeric() {
            name.push(c);
        } else if (c.is_ascii_punctuation() && c != '$') || c == ' ' {
            name.push('_');
        } else {
            let _ = write!(name, "_u{:04x}_", c as u32);
        }
    }
    name
}

/// A factory and wrapper prefix over C's already-unique physical type name.
/// The first semantic identity keeps the original prefix. Other identities on
/// that storage get their declaration symbol, never a separately mangled name.
#[must_use]
pub fn class_instance_name(
    program: &Program,
    layout: &Layout,
    class: PublishedClass<'_>,
) -> String {
    let physical = object_type_name(layout);
    if program
        .classes_laid_out_as(layout)
        .first()
        .is_some_and(|first| first.symbol == class.identity.symbol)
    {
        physical
    } else {
        format!("{physical}__Class{}", class.identity.symbol)
    }
}

/// One published class's construction entry.
#[derive(Debug, Clone)]
pub struct ConstructionEntry<'p> {
    /// The class the host constructs; its receiver chooses the descriptor.
    pub class: PublishedClass<'p>,
    /// The index in `Program::layouts` of the storage it is allocated in.
    pub layout: usize,
    /// The instance name the factory and the addon's callbacks share.
    pub instance: String,
}

impl ConstructionEntry<'_> {
    /// The factory's linkage name, the one symbol the addon needs from the
    /// program besides its functions.
    #[must_use]
    pub fn symbol(&self) -> String {
        format!("nts_construct_{}", self.instance)
    }
}

/// Every construction entry, in publication order. A published class whose
/// receiver has no layout has none: no backend can allocate it, and the addon
/// layer leaves the class out for the same reason.
#[must_use]
pub fn construction_entries(program: &Program) -> Vec<ConstructionEntry<'_>> {
    program
        .published_classes()
        .filter_map(|class| {
            let layout = program
                .layouts
                .iter()
                .position(|layout| layout.types.contains(&class.receiver))?;
            Some(ConstructionEntry {
                instance: class_instance_name(program, &program.layouts[layout], class),
                class,
                layout,
            })
        })
        .collect()
}

/// The construction entry of the class published as `emitted`, if it has one.
#[must_use]
pub fn construction_entry<'p>(
    program: &'p Program,
    emitted: &str,
) -> Option<ConstructionEntry<'p>> {
    construction_entries(program)
        .into_iter()
        .find(|entry| entry.class.emitted == emitted)
}

/// Claims each factory's symbol in the ordinary identifier namespace the
/// backend's own functions already claimed (symbol to its owner's account),
/// and refuses one whose complete name is taken, every prefix and identity
/// suffix included.
pub fn claim_construction_entries<S: std::hash::BuildHasher>(
    entries: &[ConstructionEntry<'_>],
    claimed: &mut std::collections::HashMap<String, String, S>,
    location: Location,
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for entry in entries {
        let symbol = entry.symbol();
        let owner = format!("the constructor factory for {}", entry.class.emitted);
        if let Some(previous) = claimed.insert(symbol.clone(), owner.clone()) {
            diagnostics.push(Diagnostic::error(
                "NTS2004",
                format!("`{owner}` and `{previous}` both need the C name `{symbol}`"),
                location,
            ));
        }
    }
    diagnostics
}
