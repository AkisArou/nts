//! Structured type facts; graph budgets and traversal remain capture policy.

use super::{Declaration, JsString, Symbol, SymbolName, Type};
use tsrs_checker::{ObjectFlags, TypeData, TypeFlags};

#[derive(Debug, Clone)]
pub struct Reference<'p> {
    pub target: Type<'p>,
    pub arguments: Vec<Type<'p>>,
}
#[derive(Debug, Clone, Copy)]
pub struct TypeParameter<'p> {
    pub name: JsString<'p>,
    pub constraint: Option<Type<'p>>,
}
#[derive(Debug, Clone, Copy)]
pub struct Conditional<'p> {
    pub check: Type<'p>,
    pub extends: Type<'p>,
    pub true_type: Type<'p>,
    pub false_type: Type<'p>,
}
#[derive(Debug, Clone, Copy)]
pub struct IndexedAccess<'p> {
    pub object: Type<'p>,
    pub index: Type<'p>,
}
#[derive(Debug, Clone)]
pub struct Template<'p> {
    pub texts: Vec<JsString<'p>>,
    pub types: Vec<Type<'p>>,
}
#[derive(Debug, Clone, Copy)]
pub struct Substitution<'p> {
    pub base: Type<'p>,
    pub constraint: Type<'p>,
}
#[derive(Debug, Clone)]
pub struct Property<'p> {
    pub symbol: Symbol<'p>,
    pub name: SymbolName<'p>,
    pub ty: Type<'p>,
    pub optional: bool,
    pub readonly: bool,
    pub declared_readonly: bool,
    pub kind: PropertyKind,
    pub declarations: Vec<Declaration<'p>>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PropertyKind {
    Field,
    Method,
    Getter,
    Setter,
    GetterSetter,
}
#[derive(Debug, Clone, Copy)]
pub struct IndexSignature<'p> {
    pub key: Type<'p>,
    pub value: Type<'p>,
    pub readonly: bool,
}

impl<'p> Type<'p> {
    fn view(self, native: tsrs_core::P<tsrs_checker::Type>) -> Self {
        Self {
            native,
            file: self.file,
        }
    }
    #[must_use]
    pub fn constituents(self) -> Option<Vec<Self>> {
        self.file.with_checker(|_| {
            self.native.try_as_union_or_intersection_type().map(|data| {
                data.types()
                    .iter()
                    .map(|&native| self.view(native))
                    .collect()
            })
        })
    }
    #[must_use]
    pub fn is_array(self) -> bool {
        self.file
            .with_checker(|c| c.is_array_type_exported(self.native))
    }
    #[must_use]
    pub fn tuple_elements(self) -> Option<Vec<Self>> {
        self.file.with_checker(|c| {
            self.native.is_tuple_type().then(|| {
                c.get_type_arguments_exported(self.native)
                    .iter()
                    .map(|&native| self.view(native))
                    .collect()
            })
        })
    }
    #[must_use]
    pub fn reference(self) -> Option<Reference<'p>> {
        self.file.with_checker(|c| {
            if !self
                .native
                .object_flags()
                .intersects(ObjectFlags::Reference)
            {
                return None;
            }
            let data = self.native.try_as_type_reference()?;
            let target = data
                .target
                .get()
                .expect("native type reference has a target");
            Some(Reference {
                target: self.view(target),
                arguments: c
                    .get_type_arguments_exported(self.native)
                    .iter()
                    .map(|&native| self.view(native))
                    .collect(),
            })
        })
    }
    #[must_use]
    pub fn type_parameter(self) -> Option<TypeParameter<'p>> {
        let (name, constraint) = self.file.with_checker(|c| {
            if !self.native.flags.get().intersects(TypeFlags::TypeParameter) {
                return None;
            }
            // Native synthetic `this` parameters need not have a symbol. Ask
            // the checker for their spelling instead of inventing a name.
            let name = self.native.symbol().map_or_else(
                || {
                    c.type_to_string_ex_exported(
                        self.native,
                        None,
                        tsrs_checker::TypeFormatFlags::None,
                        None,
                    )
                },
                |symbol| symbol.name().to_owned(),
            );
            Some((
                name,
                c.get_constraint_of_type_parameter_exported(self.native),
            ))
        })?;
        Some(TypeParameter {
            name: self.file.intern_string(name.as_bytes()),
            constraint: constraint.map(|native| self.view(native)),
        })
    }
    #[must_use]
    pub fn bases(self) -> Vec<Self> {
        self.file.with_checker(|c| {
            c.get_base_types_exported(self.native)
                .iter()
                .map(|&native| self.view(native))
                .collect()
        })
    }
    #[must_use]
    pub fn conditional(self) -> Option<Conditional<'p>> {
        self.file.with_checker(|c| {
            let TypeData::Conditional(data) = self.native.data() else {
                return None;
            };
            Some(Conditional {
                check: self.view(data.check_type().expect("native conditional check type")),
                extends: self.view(
                    data.extends_type()
                        .expect("native conditional extends type"),
                ),
                true_type: self.view(c.get_true_type_of_conditional_type(self.native)),
                false_type: self.view(c.get_false_type_of_conditional_type(self.native)),
            })
        })
    }
    #[must_use]
    pub fn indexed_access(self) -> Option<IndexedAccess<'p>> {
        self.file.with_checker(|_| {
            let TypeData::IndexedAccess(data) = self.native.data() else {
                return None;
            };
            Some(IndexedAccess {
                object: self.view(data.object_type().expect("native indexed object")),
                index: self.view(data.index_type().expect("native indexed key")),
            })
        })
    }
    #[must_use]
    pub fn template(self) -> Option<Template<'p>> {
        let (texts, types) = self.file.with_checker(|_| {
            let TypeData::TemplateLiteral(data) = self.native.data() else {
                return None;
            };
            Some((data.texts(), data.types()))
        })?;
        Some(Template {
            texts: texts
                .iter()
                .map(|text| self.file.intern_string(text.as_bytes()))
                .collect(),
            types: types.iter().map(|&native| self.view(native)).collect(),
        })
    }
    #[must_use]
    pub fn substitution(self) -> Option<Substitution<'p>> {
        self.file.with_checker(|_| {
            let TypeData::Substitution(data) = self.native.data() else {
                return None;
            };
            Some(Substitution {
                base: self.view(data.base_type().expect("native substitution base")),
                constraint: self.view(
                    data.subst_constraint()
                        .expect("native substitution constraint"),
                ),
            })
        })
    }
    #[must_use]
    pub fn properties(self) -> Vec<Property<'p>> {
        self.file
            .with_checker(|c| c.get_properties_of_type_exported(self.native))
            .iter()
            .map(|&native| {
                let symbol = Symbol::new(native, self.file);
                let classification = symbol.classification();
                let kind = match (classification.getter, classification.setter) {
                    (true, true) => PropertyKind::GetterSetter,
                    (true, false) => PropertyKind::Getter,
                    (false, true) => PropertyKind::Setter,
                    (false, false) if classification.method => PropertyKind::Method,
                    (false, false) => PropertyKind::Field,
                };
                let declarations: Vec<_> = symbol.declarations().collect();
                let declared_readonly = declarations
                    .iter()
                    .any(|d| d.attributes().modifiers.readonly);
                Property {
                    symbol,
                    name: symbol.name_in(super::names::NameTable::Member),
                    ty: symbol.ty(),
                    optional: classification.optional,
                    readonly: symbol.readonly(),
                    declared_readonly,
                    kind,
                    declarations,
                }
            })
            .collect()
    }
    #[must_use]
    pub fn index_signatures(self) -> Vec<IndexSignature<'p>> {
        self.file.with_checker(|c| {
            c.get_index_infos_of_type_exported(self.native)
                .iter()
                .map(|info| IndexSignature {
                    key: self.view(info.key_type()),
                    value: self.view(info.value_type()),
                    readonly: info.is_readonly(),
                })
                .collect()
        })
    }
}
