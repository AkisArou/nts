//! Symbol resolution, including aliases and declarations in other source files.

use nts_frontend_tsrs::{InternalName, JsString, Symbol, SymbolClassification, SymbolName};
use nts_semantic_schema::{
    Library, PropertyKey, SnapshotError, SymbolFlags, SymbolId, SymbolRecord,
};

use super::{Capture, arena_index};

impl<'p> Capture<'p, '_> {
    pub(super) fn intern_symbol(&mut self, symbol: Symbol<'p>) -> Result<SymbolId, SnapshotError> {
        if let Some(id) = self.symbols.get(&symbol) {
            return Ok(*id);
        }
        let declarations: Vec<_> = symbol.declarations().collect();
        let mut declaration_sites = Vec::new();
        for &node in &declarations {
            if let Some(site) = self.declaration_site(node)? {
                declaration_sites.push(site);
            }
        }
        declaration_sites.sort_unstable();
        declaration_sites.dedup();
        let mut captured: Vec<_> = declarations
            .iter()
            .filter_map(|node| self.nodes.get(node).copied())
            .collect();
        captured.sort_unstable();
        captured.dedup();
        let classification = symbol.classification();
        let module = classification.module;
        let library = if captured.is_empty() {
            declarations
                .first()
                .and_then(|node| Library::of_path(node.source_file().path().as_str()))
        } else {
            None
        };
        let id = SymbolId(arena_index(self.snapshot.symbols.len())?);
        self.snapshot.symbols.push(SymbolRecord {
            builtin: symbol.builtin_binding().map(|binding| match binding {
                nts_frontend_tsrs::BuiltinBinding::Undefined => {
                    nts_semantic_schema::BuiltinBinding::Undefined
                }
                nts_frontend_tsrs::BuiltinBinding::NaN => nts_semantic_schema::BuiltinBinding::NaN,
                nts_frontend_tsrs::BuiltinBinding::Infinity => {
                    nts_semantic_schema::BuiltinBinding::Infinity
                }
                nts_frontend_tsrs::BuiltinBinding::GlobalThis => {
                    nts_semantic_schema::BuiltinBinding::GlobalThis
                }
                nts_frontend_tsrs::BuiltinBinding::Arguments => {
                    nts_semantic_schema::BuiltinBinding::Arguments
                }
            }),
            name: PropertyKey::Name(String::new()),
            flags: schema_flags(classification),
            declarations: captured,
            declaration_sites,
            ty: None,
            aliased: None,
            library,
        });
        self.symbols.insert(symbol, id);
        self.symbol_work.push(symbol);
        let mut name = self.property_key(symbol.name())?;
        if module && let PropertyKey::Name(text) = &mut name {
            *text = self.normalized_name(text)?;
        }
        self.snapshot.symbols[id.0 as usize].name = name;
        Ok(id)
    }

    pub(super) fn property_key(
        &mut self,
        name: SymbolName<'p>,
    ) -> Result<PropertyKey, SnapshotError> {
        Ok(match name {
            SymbolName::Plain(text) => {
                PropertyKey::Name(required_text(text, "symbol name")?.to_owned())
            }
            SymbolName::Private(text) => {
                PropertyKey::Private(required_text(text, "private name")?.to_owned())
            }
            SymbolName::Keyed(ty) => PropertyKey::Symbol(self.intern_type(ty)?),
            SymbolName::Internal(name) => {
                PropertyKey::Name(semantic_name(SymbolName::Internal(name))?)
            }
        })
    }

    pub(super) fn resolve_symbols(&mut self) -> Result<(), SnapshotError> {
        // The vector is arena/visitor order. The identity map is never iterated
        // to choose which symbol gets the next serialized ID.
        for index in 0..self.native_nodes.len() {
            if !self.queries[index].symbols {
                continue;
            }
            if let Some(symbol) = self.native_nodes[index].and_then(nts_frontend_tsrs::Node::symbol)
            {
                let id = self.intern_symbol(symbol)?;
                self.snapshot.nodes[index].symbol = Some(id);
            }
        }
        for index in 0..self.files.len() {
            let (file, root) = self.files[index];
            if let Some(symbol) = file.module_symbol() {
                let module = self.intern_symbol(symbol)?;
                self.snapshot.nodes[root.0 as usize].symbol = Some(module);
                let mut exports = Vec::new();
                for exported in symbol.exports() {
                    let name = semantic_name(exported.name)?;
                    exports.push((name, self.intern_symbol(exported.symbol)?));
                }
                self.snapshot.modules[index].exports = exports;
            }
        }
        // Insert before following aliases: even malformed cyclic data cannot
        // make the builder recurse. All declarations were associated above.
        let mut next = 0;
        while let Some(&symbol) = self.symbol_work.get(next) {
            if let Some(target) = symbol.alias_target() {
                let target = self.intern_symbol(target)?;
                let id = self.symbols[&symbol];
                self.snapshot.symbols[id.0 as usize].aliased = Some(target);
            }
            next += 1;
        }
        Ok(())
    }
}

pub(super) fn required_text<'p>(text: JsString<'p>, what: &str) -> Result<&'p str, SnapshotError> {
    text.utf8().ok_or_else(|| SnapshotError::Project(format!("a {what} containing unpaired UTF-16 code units, which nts's semantic names cannot represent")))
}

/// All upstream naming conventions have already been classified by the safe
/// adapter. Ordinary names stay exactly as written, including leading `_`.
pub(super) fn semantic_name(name: SymbolName<'_>) -> Result<String, SnapshotError> {
    Ok(match name {
        SymbolName::Plain(text) | SymbolName::Private(text) => {
            required_text(text, "symbol name")?.to_owned()
        }
        SymbolName::Internal(name) => match name {
            InternalName::Call => "call",
            InternalName::Constructor => "constructor",
            InternalName::New => "new",
            InternalName::Index => "index",
            InternalName::ExportStar => "export *",
            InternalName::Global => "global",
            InternalName::Missing => "missing",
            InternalName::Type => "anonymous type",
            InternalName::Object => "anonymous object",
            InternalName::JSXAttributes => "JSX attributes",
            InternalName::Class => "anonymous class",
            InternalName::Function => "anonymous function",
            InternalName::Computed => "computed member",
            InternalName::AssignmentDeclaration => "assignment declaration",
            InternalName::InstantiationExpression => "instantiation expression",
            InternalName::ImportAttributes => "import attributes",
            InternalName::ExportEquals => "export=",
            InternalName::Default => "default",
            InternalName::This => "this",
            InternalName::ModuleExports => "module.exports",
            InternalName::Other(text) => {
                return Err(SnapshotError::Project(format!(
                    "an unmodelled native internal symbol name: {:?}",
                    text.utf16()
                )));
            }
        }
        .to_owned(),
        SymbolName::Keyed(_) => {
            return Err(SnapshotError::Project(
                "a unique-symbol key where an ordinary identifier is required".into(),
            ));
        }
    })
}

fn schema_flags(class: SymbolClassification) -> SymbolFlags {
    let mut flags = SymbolFlags::default();
    for (present, flag) in [
        (class.variable, SymbolFlags::VARIABLE),
        (class.function, SymbolFlags::FUNCTION),
        (class.class, SymbolFlags::CLASS),
        (class.interface, SymbolFlags::INTERFACE),
        (class.type_alias, SymbolFlags::TYPE_ALIAS),
        (class.enum_, SymbolFlags::ENUM),
        (class.module, SymbolFlags::MODULE),
        (class.property, SymbolFlags::PROPERTY),
        (class.method, SymbolFlags::METHOD),
    ] {
        if present {
            flags = flags.union(flag);
        }
    }
    flags
}

impl Capture<'_, '_> {
    /// Module names carry paths; arbitrary property keys do not.
    fn normalized_name(&mut self, name: &str) -> Result<String, SnapshotError> {
        let path = camino::Utf8Path::new(name.trim_matches('"'));
        if path.is_absolute() {
            self.workspace_uri(path)
        } else {
            Ok(name.to_owned())
        }
    }
}
