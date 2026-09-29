//! The `gi:` surface: a namespace's binding as a TypeScript program spells it
//! -- `import { Box, Orientation } from "gi:gtk"`, `box.setChild(label)`,
//! `PRIORITY_DEFAULT` -- where the `c:` surface keeps C's names (`GtkBox`,
//! `set_child`, `G_PRIORITY_DEFAULT`).
//!
//! **Naming is presentation, so it is done here, after mapping.** The mapping
//! decides what a binding says, in C's terms, and is the same for both
//! surfaces; the self-check has already compiled it. This renames what a
//! program reads -- types, members, parameters, the free functions GIR
//! declares on the namespace -- and nothing a C symbol, a struct tag, a
//! `GType` function or a class struct is named by, which the tags carry as
//! they were.
//!
//! **A type is renamed by one table** ([`Names`]), built from every namespace
//! the repository read: its own namespace's types bare (`GtkBox` is `Box`),
//! another's qualified by that namespace (`GListModel` is `Gio.ListModel`,
//! imported as `import type * as Gio from "gi:gio"`). Qualified, so a type
//! named like one of this namespace's -- Gtk's `Application` beside its parent
//! `Gio.Application` -- cannot collide. Type text is renamed token by token
//! through the table: an identifier the table does not hold (a brand, a
//! parameter name, `string`) is left as it is.
//!
//! **A member is camelCased**: `set_child` is `setChild`, `vfunc_measure` is
//! `vfuncMeasure`, a property `use_markup` is `useMarkup`. The tags that name
//! a member or a parameter (`@ntsGet`, `@ntsSet`, `@ntsConstruct`,
//! `@ntsNoEscape`, `@ntsDefault`, `@ntsThrows`, `@ntsVfuncOut`) name it as
//! renamed, since the compiler finds each by the name the declaration has.

use std::collections::{BTreeMap, BTreeSet};

use super::map::{Accessor, Binding, Cast, Constructed, Constructor, Function, Mapped, Reason, Shape, TypeDecl, Vfunc};
use super::model::{Namespace, Repository};

/// Names a program already has from JavaScript, which an imported class would
/// shadow in every module that imports it: `GObject.Object` keeps its C name,
/// `GObject`, as `GLib.Error` keeps `GError`.
const GLOBALS: [&str; 13] =
    ["Object", "Error", "String", "Array", "Date", "Map", "Set", "Promise", "Function", "Symbol", "Number", "Boolean", "RegExp"];

/// A `gi:` module's name: GIR's namespace, lowercased -- `gi:gtk`, `gi:gio`.
#[must_use]
pub(crate) fn module_of(namespace: &str) -> String {
    format!("gi:{}", namespace.to_ascii_lowercase())
}

/// Every type the repository declares, by its C name: the namespace declaring
/// it and its name there.
pub(crate) struct Names {
    types: BTreeMap<String, (String, String)>,
}

impl Names {
    #[must_use]
    pub(crate) fn of(repository: &Repository) -> Self {
        let mut types = BTreeMap::new();
        for namespace in repository.namespaces.values() {
            let classes = namespace.classes.iter().filter_map(|c| Some((c.c_type.clone()?, c.name.clone())));
            let records = namespace.records.iter().filter(|r| !r.class_struct).filter_map(|r| Some((r.c_type.clone()?, r.name.clone())));
            for (c_type, name) in classes.chain(records) {
                types.entry(c_type).or_insert_with(|| (namespace.name.clone(), name));
            }
        }
        // An enum two namespaces declare -- GObject's GIR registers GLib's
        // `GIOCondition` again -- belongs to the one the other includes, as
        // the mapping's `enum_owner` decides: the binding declares it there.
        let mut enums: BTreeMap<String, Vec<(&Namespace, String)>> = BTreeMap::new();
        for namespace in repository.namespaces.values() {
            for e in &namespace.enums {
                if let Some(c_type) = &e.c_type {
                    enums.entry(c_type.clone()).or_default().push((namespace, e.name.clone()));
                }
            }
        }
        for (c_type, declared) in enums {
            let owner = declared
                .iter()
                .find(|(namespace, _)| {
                    let included = includes(repository, namespace);
                    !declared.iter().any(|(other, _)| other.name != namespace.name && included.contains(other.name.as_str()))
                })
                .or_else(|| declared.first());
            if let Some((namespace, name)) = owner {
                types.entry(c_type).or_insert_with(|| (namespace.name.clone(), name.clone()));
            }
        }
        Self { types }
    }

    /// `c_type` as a program in `namespace` spells it, if the repository
    /// declares it.
    fn spelled(&self, namespace: &str, c_type: &str) -> Option<String> {
        let (declaring, name) = self.types.get(c_type)?;
        let name = if GLOBALS.contains(&name.as_str()) { c_type.to_owned() } else { name.clone() };
        Some(if declaring == namespace { name } else { format!("{declaring}.{name}") })
    }

    /// The namespaces `text`, spelled for `namespace`, names another's types
    /// from.
    fn qualifiers(&self, namespace: &str, text: &str) -> BTreeSet<String> {
        identifiers(text)
            .filter_map(|(_, token)| self.types.get(token))
            .filter(|(declaring, _)| declaring != namespace)
            .map(|(declaring, _)| declaring.clone())
            .collect()
    }
}

/// Every namespace `namespace` includes, however indirectly.
fn includes<'a>(repository: &'a Repository, namespace: &'a Namespace) -> BTreeSet<&'a str> {
    let mut seen = BTreeSet::new();
    let mut pending: Vec<&str> = namespace.includes.iter().map(|(name, _)| name.as_str()).collect();
    while let Some(name) = pending.pop() {
        if !seen.insert(name) {
            continue;
        }
        if let Some(included) = repository.namespaces.get(name) {
            pending.extend(included.includes.iter().map(|(name, _)| name.as_str()));
        }
    }
    seen
}

/// Each identifier in `text`, with where it starts: the tokens type text is
/// renamed by. A string literal's contents are not tokens -- `CNumber<"int">`
/// names no type -- and neither is a name after a `.`, which is already a
/// member of something.
fn identifiers(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let bytes = text.as_bytes();
    let mut at = 0;
    let mut quoted = false;
    std::iter::from_fn(move || {
        while at < bytes.len() {
            let c = bytes[at];
            if c == b'"' {
                quoted = !quoted;
                at += 1;
                continue;
            }
            let starts = c.is_ascii_alphabetic() || c == b'_' || c == b'$';
            if quoted || !starts {
                at += 1;
                continue;
            }
            let start = at;
            while at < bytes.len() && (bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_' || bytes[at] == b'$') {
                at += 1;
            }
            if start > 0 && bytes[start - 1] == b'.' {
                continue;
            }
            return Some((start, &text[start..at]));
        }
        None
    })
}

/// A GIR name as a TypeScript member: `set_child` is `setChild`, `get_2d`
/// `get2d`, `$ntsPropGet_width_request` `$ntsPropGetWidthRequest`. A leading
/// underscore stays.
#[must_use]
pub(crate) fn camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for c in name.chars() {
        if c == '_' || c == '-' {
            if out.is_empty() || out.ends_with('_') {
                out.push('_');
            } else {
                upper = true;
            }
            continue;
        }
        if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// A parameter's name, camelCased and escaped again where that makes it a
/// word TypeScript reserves: `for_size` is `forSize`, `in_` stays `in_`.
fn parameter(name: &str) -> String {
    super::map::identifier(&camel(name.strip_suffix('_').unwrap_or(name)))
}

/// `binding`, the namespace `namespace`'s, as the `gi:` surface spells it.
/// What would collide once renamed is refused, by name.
#[must_use]
pub(crate) fn gi(binding: &Binding, namespace: &Namespace, names: &Names) -> Binding {
    let rename = Renamer { names, namespace: &namespace.name };
    let mut out = Binding {
        module: module_of(&namespace.name),
        headers: binding.headers.clone(),
        brands: binding.brands.clone(),
        refused: binding.refused.clone(),
        deprecated: binding.deprecated.clone(),
        interface_types: binding.interface_types.clone(),
        ..Binding::default()
    };
    out.types = binding.types.iter().map(|decl| rename.decl(decl)).collect();
    out.enums = binding.enums.iter().map(|decl| super::map::EnumDecl { c_type: None, ..decl.clone() }).collect();
    out.constants = binding
        .constants
        .iter()
        .map(|constant| super::map::ConstantDecl { name: constant.gir_name.clone(), ts: rename.text(&constant.ts), ..constant.clone() })
        .collect();
    out.casts = binding.casts.iter().map(|cast| Cast { class: rename.class(&cast.class), get_type: cast.get_type.clone() }).collect();
    out.properties = binding
        .properties
        .iter()
        .map(|(class, all)| {
            let all = all
                .iter()
                .map(|p| Accessor { name: camel(&p.name), getter: p.getter.as_deref().map(camel), setter: p.setter.as_deref().map(camel) })
                .collect();
            (rename.class(class), all)
        })
        .collect();
    out.constructors = binding
        .constructors
        .iter()
        .map(|(class, c)| {
            let from = |from: &[String]| from.iter().map(|p| parameter(p)).collect::<Vec<_>>();
            let alternatives = c.alternatives.iter().map(|(function, taken)| (function.clone(), from(taken))).collect();
            (rename.class(class), Constructor { function: c.function.clone(), get_type: c.get_type.clone(), from: from(&c.from), alternatives })
        })
        .collect();
    // A construct-only property's thunk is found by name: the view's, less
    // `_construct`, then `_with_` and the key a props object writes.
    let mut thunks = BTreeMap::new();
    out.constructed = binding
        .constructed
        .iter()
        .map(|(class, c)| {
            for name in &c.names {
                thunks.insert(format!("{class}_with_{name}"), format!("{class}_with_{}", camel(name)));
            }
            let own = c.own.iter().map(|(name, ts)| (camel(name), rename.text(ts))).collect();
            (rename.class(class), Constructed { own, names: c.names.iter().map(|name| camel(name)).collect() })
        })
        .collect();
    let mut taken: BTreeSet<String> = out.types.iter().map(|TypeDecl::Class { name, .. }| name.clone()).collect();
    taken.extend(out.enums.iter().map(|e| e.name.clone()));
    taken.extend(out.constants.iter().map(|c| c.name.clone()));
    for function in &binding.functions {
        let mut function = rename.function(function);
        if let Some(thunk) = thunks.get(&function.name) {
            function.name.clone_from(thunk);
        }
        // Exported under GIR's name, which nothing else of the module may
        // already have.
        if function.gir_name.is_some() && !taken.insert(function.name.clone()) {
            out.refused.push((function.symbol.clone(), Reason::NameClash(function.name.clone())));
            continue;
        }
        out.functions.push(function);
    }
    // Every other namespace a spelling names, imported whole: read from the
    // C spellings, where each type is still a name the table holds.
    let mut qualifiers = BTreeSet::new();
    let texts = binding
        .functions
        .iter()
        .flat_map(|f| f.parameters.iter().map(|(_, m)| m.ts.as_str()).chain([f.result.ts.as_str()]))
        .chain(binding.constants.iter().map(|c| c.ts.as_str()))
        .chain(binding.constructed.values().flat_map(|c| c.own.iter().map(|(_, ts)| ts.as_str())));
    for text in texts {
        qualifiers.extend(names.qualifiers(&namespace.name, text));
    }
    for TypeDecl::Class { parent, implements, .. } in &binding.types {
        let bases = parent.iter().map(|(_, name)| name).chain(implements.iter().map(|(name, _)| name));
        qualifiers.extend(bases.flat_map(|base| names.qualifiers(&namespace.name, base)));
    }
    out.namespaces = qualifiers.into_iter().map(|qualifier| (module_of(&qualifier), qualifier)).collect();
    out
}

/// What renames one binding's names, for the namespace it is in.
struct Renamer<'a> {
    names: &'a Names,
    namespace: &'a str,
}

impl Renamer<'_> {
    fn class(&self, c_type: &str) -> String {
        self.names.spelled(self.namespace, c_type).unwrap_or_else(|| c_type.to_owned())
    }

    /// Type text with each type it names renamed.
    fn text(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut copied = 0;
        for (start, token) in identifiers(text) {
            if let Some(spelled) = self.names.spelled(self.namespace, token) {
                out.push_str(&text[copied..start]);
                out.push_str(&spelled);
                copied = start + token.len();
            }
        }
        out.push_str(&text[copied..]);
        out
    }

    fn mapped(&self, mapped: &Mapped) -> Mapped {
        let shape = match &mapped.shape {
            Shape::Handle { class, nullable } => Shape::Handle { class: self.class(class), nullable: *nullable },
            Shape::Lent { program } => Shape::Lent { program: self.text(program) },
            Shape::Out { value } => Shape::Out { value: self.text(value) },
            Shape::Filled { class } => Shape::Filled { class: self.text(class) },
            Shape::Length { value } => Shape::Length { value: self.text(value) },
            Shape::Bytes { length, owned } => Shape::Bytes { length: parameter(length), owned: *owned },
            other @ (Shape::Other | Shape::Once) => other.clone(),
        };
        Mapped { ts: self.text(&mapped.ts), c: mapped.c.clone(), shape }
    }

    fn decl(&self, decl: &TypeDecl) -> TypeDecl {
        let TypeDecl::Class { name, tag, parent, counted, interface, implements, boxed } = decl;
        TypeDecl::Class {
            name: self.class(name),
            tag: tag.clone(),
            // Qualified where it is another namespace's, so no module is
            // needed beside it: the namespace is imported whole.
            parent: parent.as_ref().map(|(_, parent)| (String::new(), self.class(parent))),
            counted: *counted,
            interface: *interface,
            implements: implements.iter().map(|(name, tag)| (self.class(name), tag.clone())).collect(),
            boxed: boxed.clone(),
        }
    }

    fn function(&self, function: &Function) -> Function {
        let parameters = function.parameters.iter().map(|(name, mapped)| (parameter(name), self.mapped(mapped))).collect();
        let vfunc = function.vfunc.as_ref().map(|vfunc| Vfunc {
            outs: vfunc.outs.iter().map(|(name, nullable)| (parameter(name), *nullable)).collect(),
            ..vfunc.clone()
        });
        Function {
            // GIR's own name for a function of the namespace, which is how a
            // program calls it; a view or a thunk keeps its name, which a tag
            // or the compiler finds it by.
            name: function.gir_name.as_deref().map_or_else(|| function.name.clone(), camel),
            parameters,
            result: self.mapped(&function.result),
            omissible: function.omissible.iter().map(|(name, value)| (parameter(name), *value)).collect(),
            no_escape: function.no_escape.iter().map(|name| parameter(name)).collect(),
            throws: function.throws.as_deref().map(parameter),
            method: function.method.as_ref().map(|(class, name)| (self.class(class), camel(name))),
            statics: function.statics.as_ref().map(|(class, name)| (self.class(class), camel(name))),
            finish: function.finish.as_deref().map(camel),
            // A method is a method only: `gi:` exports no free function
            // beside it, as GJS has none.
            method_only: function.method_only || function.method.is_some(),
            vfunc,
            ..function.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{camel, identifiers, parameter};

    #[test]
    fn a_member_is_camel_cased_and_a_parameter_stays_a_legal_name() {
        assert_eq!(camel("set_child"), "setChild");
        assert_eq!(camel("vfunc_measure"), "vfuncMeasure");
        assert_eq!(camel("get_2d"), "get2d");
        assert_eq!(camel("new"), "new");
        assert_eq!(camel("_private"), "_private");
        assert_eq!(camel("$ntsPropGet_width_request"), "$ntsPropGetWidthRequest");
        assert_eq!(parameter("for_size"), "forSize");
        assert_eq!(parameter("in_"), "in_");
        assert_eq!(parameter("delete_"), "delete_");
    }

    #[test]
    fn a_token_is_an_identifier_outside_a_string_and_not_after_a_dot() {
        let tokens: Vec<&str> = identifiers(r#"CNumber<"int"> | Gio.ListModel | (self: GtkButton) => void"#).map(|(_, t)| t).collect();
        assert_eq!(tokens, ["CNumber", "Gio", "self", "GtkButton", "void"]);
    }
}
