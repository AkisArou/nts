//! Semantic names, separated from the checker's private spelling conventions.

use super::{JsString, Symbol, Type};

#[path = "internal_names.rs"]
mod internal;
pub use internal::InternalName;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SymbolName<'p> {
    Plain(JsString<'p>),
    /// Written private name, e.g. `#count`; identity belongs to `Symbol`.
    Private(JsString<'p>),
    /// The actual unique-symbol key type; its symbol owns the declaration.
    Keyed(Type<'p>),
    Internal(InternalName<'p>),
}

#[derive(Clone, Copy)]
pub(super) enum NameTable {
    Automatic,
    Export,
    Member,
    ThisParameter,
}

impl<'p> Symbol<'p> {
    pub(super) fn name_in(self, table: NameTable) -> SymbolName<'p> {
        let (text, exported, common_js, key) = self.file.with_checker(|checker| {
            let text = self.native.name();
            let exported = self.native.parent().is_some_and(|parent| {
                parent.flags().intersects(tsrs_ast::SymbolFlags::Module)
                    && parent
                        .exports()
                        .and_then(|table| table.get().get(text))
                        .is_some_and(|symbol| {
                            checker.get_merged_symbol_exported(symbol) == self.native
                        })
            });
            let common_js = self.native.declarations().iter().any(|&node| {
                node.kind() == tsrs_ast::Kind::SourceFile
                    && tsrs_ast::is_source_file_js(node.as_source_file_p())
                    && node
                        .as_source_file()
                        .common_js_module_indicator
                        .get()
                        .is_some()
            });
            let key = checker.get_name_type_of_symbol(self.native).filter(|ty| {
                ty.flags()
                    .intersects(tsrs_checker::TypeFlags::UniqueESSymbol)
            });
            (text, exported, common_js, key)
        });
        if let Some(native) = key {
            return SymbolName::Keyed(Type {
                native,
                file: self.file,
            });
        }
        let bytes = text.as_bytes();
        if let Some(rest) = bytes.strip_prefix(&[tsrs_ast::INTERNAL_SYMBOL_NAME_PREFIX_BYTE, b'#'])
            && let Some(at) = rest.iter().position(|&byte| byte == b'@')
            && at > 0
            && rest[..at].iter().all(u8::is_ascii_digit)
            && rest[at + 1..].starts_with(b"#")
        {
            return SymbolName::Private(self.file.intern_string(&rest[at + 1..]));
        }
        let del = bytes.first() == Some(&tsrs_ast::INTERNAL_SYMBOL_NAME_PREFIX_BYTE);
        let internal = std::str::from_utf8(bytes)
            .ok()
            .and_then(internal::internal_name);
        let common_js_name = common_js && matches!(internal, Some(InternalName::ModuleExports));
        let allowed = del
            || match table {
                NameTable::Export => {
                    matches!(
                        internal,
                        Some(InternalName::Default | InternalName::ExportEquals)
                    ) || common_js_name
                }
                NameTable::Automatic => {
                    exported
                        && matches!(
                            internal,
                            Some(InternalName::Default | InternalName::ExportEquals)
                        )
                        || common_js_name
                }
                NameTable::Member => false,
                NameTable::ThisParameter => matches!(internal, Some(InternalName::This)),
            };
        if allowed {
            SymbolName::Internal(
                internal.unwrap_or_else(|| InternalName::Other(self.file.intern_string(bytes))),
            )
        } else {
            SymbolName::Plain(self.file.intern_string(bytes))
        }
    }
}
