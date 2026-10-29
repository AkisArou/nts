//! Structured type facts; graph budgets and traversal remain capture policy.

use super::{Declaration, JsString, Symbol, SymbolName, Type};
use tsrs_checker::{ObjectFlags, TypeData, TypeFlags};

#[derive(Debug, Clone)]
pub struct Reference<'p> {
    pub target: Type<'p>,
    pub arguments: Vec<Type<'p>>,
    /// Outer plus local declared parameters, excluding the synthetic `this`
    /// parameter. None means the native target is not an interface/class.
    pub declared_parameter_count: Option<usize>,
}
#[derive(Debug, Clone, Copy)]
pub struct TypeParameter<'p> {
    pub name: JsString<'p>,
    pub constraint: Option<Type<'p>>,
    /// True only for the native polymorphic receiver parameter.
    pub is_this: bool,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TupleElementKind {
    Required,
    Optional,
    Rest,
    Variadic,
}

#[derive(Debug, Clone)]
pub struct Tuple<'p> {
    pub elements: Vec<Type<'p>>,
    pub element_flags: Vec<TupleElementKind>,
    /// Required/optional positions before the first rest or variadic element.
    /// Required suffixes after a spread do not extend this prefix. This is
    /// neither a minimum length nor a certificate of a runtime array's extent.
    pub fixed_length: usize,
    /// The checker's readonly view does not exclude a writable alias.
    pub readonly: bool,
}

fn tuple_element_kind(flags: tsrs_checker::ElementFlags) -> TupleElementKind {
    use tsrs_checker::ElementFlags as F;
    [
        (F::Required, TupleElementKind::Required),
        (F::Optional, TupleElementKind::Optional),
        (F::Rest, TupleElementKind::Rest),
        (F::Variadic, TupleElementKind::Variadic),
    ]
    .into_iter()
    .find_map(|(native, owned)| (flags == native).then_some(owned))
    .expect("native tuple positions have one required, optional, rest or variadic kind")
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
        self.tuple().map(|tuple| tuple.elements)
    }
    #[must_use]
    pub fn tuple(self) -> Option<Tuple<'p>> {
        self.file.with_checker(|c| {
            if !self.native.is_tuple_type() {
                return None;
            }
            let target = self
                .native
                .target()
                .expect("a native tuple reference has its target")
                .as_tuple_type();
            let tuple = Tuple {
                elements: c
                    .get_type_arguments_exported(self.native)
                    .iter()
                    .map(|&native| self.view(native))
                    .collect(),
                element_flags: target
                    .element_flags()
                    .into_iter()
                    .map(tuple_element_kind)
                    .collect(),
                fixed_length: target.fixed_length(),
                readonly: target.is_readonly(),
            };
            assert_eq!(
                tuple.elements.len(),
                tuple.element_flags.len(),
                "native tuple types and flags must share one target"
            );
            assert_eq!(
                tuple.fixed_length,
                tuple
                    .element_flags
                    .iter()
                    .take_while(|flag| matches!(
                        flag,
                        TupleElementKind::Required | TupleElementKind::Optional
                    ))
                    .count(),
                "native tuple fixed length must describe its initial fixed prefix"
            );
            Some(tuple)
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
            self.native.try_as_type_reference()?;
            let target = self
                .native
                .target()
                .expect("Reference constructors initialize the target before publishing the type");
            let arguments = c
                .get_type_arguments_exported(self.native)
                .iter()
                .map(|&native| self.view(native))
                .collect();
            let declared_parameter_count = target
                .try_as_interface_type()
                .map(|interface| interface.type_parameters().len());
            Some(Reference {
                target: self.view(target),
                arguments,
                declared_parameter_count,
            })
        })
    }
    #[must_use]
    pub fn type_parameter(self) -> Option<TypeParameter<'p>> {
        let (name, constraint, is_this) = self.file.with_checker(|c| {
            if !self.native.flags.get().intersects(TypeFlags::TypeParameter) {
                return None;
            }
            let TypeData::TypeParameter(parameter) = self.native.data() else {
                return None;
            };
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
                parameter.is_this_type(),
            ))
        })?;
        Some(TypeParameter {
            name: self.file.intern_string(name.as_bytes()),
            constraint: constraint.map(|native| self.view(native)),
            is_this,
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
                check: self.view(data.check_type().expect(
                    "Conditional constructor initializes its check type before publication",
                )),
                extends: self.view(data.extends_type().expect(
                    "Conditional constructor initializes its extends type before publication",
                )),
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
                object: self.view(data.object_type().expect(
                    "IndexedAccess constructor initializes its object type before publication",
                )),
                index: self.view(data.index_type().expect(
                    "IndexedAccess constructor initializes its index type before publication",
                )),
            })
        })
    }
    #[must_use]
    pub fn template(self) -> Option<Template<'p>> {
        let (texts, types) = self.file.with_checker(|_| {
            let TypeData::TemplateLiteral(data) = self.native.data() else {
                return None;
            };
            Some((data.texts(), self.native.types()))
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
                base: self.view(data.base_type().expect(
                    "Substitution constructor initializes its base type before publication",
                )),
                constraint: self.view(data.subst_constraint().expect(
                    "Substitution constructor initializes its constraint before publication",
                )),
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

#[cfg(test)]
mod tuple_flag_tests {
    use super::tuple_element_kind;
    use tsrs_checker::ElementFlags;

    #[test]
    #[should_panic(
        expected = "native tuple positions have one required, optional, rest or variadic kind"
    )]
    fn unknown_flags_are_rejected() {
        tuple_element_kind(ElementFlags::from_bits_retain(1 << 8));
    }

    #[test]
    #[should_panic(
        expected = "native tuple positions have one required, optional, rest or variadic kind"
    )]
    fn combined_flags_are_rejected() {
        tuple_element_kind(ElementFlags::Required | ElementFlags::Optional);
    }
}
