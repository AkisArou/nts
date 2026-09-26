//! What a program imports from Objective-C, read from its source text.
//!
//! `import { NSWindow, type NSWindowDelegate } from "objc:AppKit"` is the
//! whole of what a program says about which classes it uses, and it is said in
//! Swift's names. The binding is generated from that list, rather than from a
//! list kept beside it, so that importing a class is all it takes to use one.
//!
//! Read from the text, before the checker runs: the binding is what lets the
//! checker resolve these imports, so it cannot be asked first. An import
//! clause has a small grammar, and only the clause is read.

use std::collections::{BTreeMap, BTreeSet};

/// The `objc:` modules a program imports from, by what it names.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Imports {
    /// Each module's imported names, as the module exports them: an alias
    /// (`NSWindow as Window`) is its original name, and `type` is dropped.
    pub(crate) names: BTreeMap<String, BTreeSet<String>>,
    /// Modules imported whole (`import * as AppKit from "objc:AppKit"`), which
    /// name no class and so cannot say what to bind.
    pub(crate) whole: BTreeSet<String>,
    /// Modules the program declares itself (`declare module "objc:AppKit"`),
    /// whose binding it already has.
    pub(crate) declared: BTreeSet<String>,
}

/// The modules generated here: every `objc:` module but the two the runtime
/// writes by hand, `objc:runtime` and `objc:types`.
fn generated(module: &str) -> bool {
    !matches!(module, "runtime" | "types")
}

impl Imports {
    /// Add what one file imports and declares.
    pub(crate) fn scan(&mut self, text: &str) {
        for (at, module) in specifiers(text) {
            if !generated(module) {
                continue;
            }
            let before = &text[..at];
            if declares(before) {
                self.declared.insert(module.to_owned());
                continue;
            }
            match clause(before) {
                Clause::Named(names) => self.names.entry(module.to_owned()).or_default().extend(names),
                Clause::Whole => {
                    self.whole.insert(module.to_owned());
                }
                Clause::Other => {}
            }
        }
    }
}

/// Every `"objc:<module>"` string in `text`, with where its opening quote is.
fn specifiers(text: &str) -> Vec<(usize, &str)> {
    let mut found = Vec::new();
    for quote in ['"', '\''] {
        let opening = format!("{quote}objc:");
        let mut from = 0;
        while let Some(at) = text[from..].find(&opening).map(|at| from + at) {
            let name = &text[at + opening.len()..];
            let end = name.find(quote).unwrap_or(0);
            if end > 0 && name[..end].chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                found.push((at, &name[..end]));
            }
            from = at + opening.len();
        }
    }
    found.sort_unstable();
    found
}

/// Whether the specifier ending `before` is the name of a `declare module`.
fn declares(before: &str) -> bool {
    let mut words = before.split_whitespace().rev();
    words.next() == Some("module") && words.next() == Some("declare")
}

enum Clause {
    Named(Vec<String>),
    Whole,
    Other,
}

/// The clause of the `import` or `export ... from` whose specifier follows
/// `before`: its names, `* as`, or neither (a side-effect import, or a
/// string that is no specifier at all).
fn clause(before: &str) -> Clause {
    let trimmed = before.trim_end();
    let Some(rest) = trimmed.strip_suffix("from") else { return Clause::Other };
    let rest = rest.trim_end();
    if let Some(inside) = rest.strip_suffix('}') {
        let Some(open) = inside.rfind('{') else { return Clause::Other };
        let keyword = inside[..open].trim_end();
        let keyword = keyword.strip_suffix("type").map_or(keyword, str::trim_end);
        if !(keyword.ends_with("import") || keyword.ends_with("export")) {
            return Clause::Other;
        }
        let names = inside[open + 1..]
            .split(',')
            .filter_map(|item| {
                let item = item.trim();
                let item = item.strip_prefix("type ").map_or(item, str::trim_start);
                let name = item.split_whitespace().next()?;
                Some(name.to_owned())
            })
            .collect();
        return Clause::Named(names);
    }
    // `import * as AppKit from`, and `import AppKit, * as Rest from`.
    let mut words = rest.split_whitespace().rev();
    if words.next().is_some() && words.next() == Some("as") && words.next() == Some("*") {
        return Clause::Whole;
    }
    Clause::Other
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scanned(text: &str) -> Imports {
        let mut imports = Imports::default();
        imports.scan(text);
        imports
    }

    fn names(module: &str, list: &[&str]) -> (String, BTreeSet<String>) {
        (module.to_owned(), list.iter().map(|name| (*name).to_owned()).collect())
    }

    /// Named imports across lines, `type` on a name or on the clause, an
    /// alias read as the name it aliases, both quotes, and a re-export.
    #[test]
    fn named_imports_are_read_as_the_module_exports_them() {
        let imports = scanned(
            "import {\n  NSWindow,\n  type NSWindowDelegate,\n  NSButton as Button,\n} from \"objc:AppKit\";\n\
             import type { Timer } from 'objc:Foundation';\n\
             export { NSView } from \"objc:AppKit\";\n\
             import { selector } from \"objc:runtime\";\n\
             import type { Int } from \"objc:types\";\n",
        );
        let expected: BTreeMap<String, BTreeSet<String>> = [
            names("AppKit", &["NSButton", "NSView", "NSWindow", "NSWindowDelegate"]),
            names("Foundation", &["Timer"]),
        ]
        .into_iter()
        .collect();
        assert_eq!(imports.names, expected);
        assert!(imports.whole.is_empty() && imports.declared.is_empty(), "{imports:?}");
    }

    /// A whole-module import names nothing to bind; a module the program
    /// declares is its own; a specifier in a string that is no import is
    /// nothing.
    #[test]
    fn a_whole_import_and_a_declared_module_are_told_apart() {
        let imports = scanned(
            "import * as UIKit from \"objc:UIKit\";\n\
             declare module \"objc:AppKit\" {\n  export class NSWindow {}\n}\n\
             const text = \"objc:CoreGraphics\";\n",
        );
        assert!(imports.names.is_empty(), "{imports:?}");
        assert_eq!(imports.whole, ["UIKit".to_owned()].into_iter().collect());
        assert_eq!(imports.declared, ["AppKit".to_owned()].into_iter().collect());
    }
}
