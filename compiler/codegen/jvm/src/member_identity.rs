//! Source keys passed to the catalogue, never recovered from emitted names.
use nts_core::hir::{
    DispatchRoot, MemberAccessor, NamedClassSource, Program, SourcePosition, SymbolSource,
};
use nts_semantic_schema::PropertyKey;

fn part(out: &mut String, value: &str) {
    use std::fmt::Write as _;
    assert!(write!(out, "{}:{value}", value.len()).is_ok());
}
fn binding(source: &NamedClassSource) -> String {
    let mut key = String::new();
    part(&mut key, &source.module);
    for scope in &source.scopes {
        part(&mut key, scope);
    }
    key
}
fn position(site: &SourcePosition) -> String {
    format!("{}:{}:{}", site.module, site.line, site.column)
}

pub(crate) fn property(program: &Program, key: &PropertyKey) -> Result<String, String> {
    Ok(match key {
        PropertyKey::Name(name) => format!("n:{name}"),
        PropertyKey::Private(name) => format!("p:{name}"),
        PropertyKey::Symbol(ty) => match program.member_origins.symbols.get(ty) {
            Some(SymbolSource::Named(source)) => format!("s:named:{}", binding(source)),
            Some(SymbolSource::WellKnown(symbol)) => format!("s:well-known:{symbol:?}"),
            Some(SymbolSource::Anonymous(Some(site))) => format!("s:site:{}", position(site)),
            Some(SymbolSource::Anonymous(None)) => format!("s:anonymous:{}", ty.0),
            Some(SymbolSource::Unavailable) | None => {
                return Err(format!(
                    "symbol field {} has no available producer-owned source identity",
                    ty.0
                ));
            }
        },
    })
}

fn type_key(identity: &nts_core::hir::TypeIdentity) -> Result<String, String> {
    use nts_core::hir::TypeIdentity as Identity;
    let (tag, parts) = match identity {
        Identity::Intrinsic(name) => ("intrinsic", vec![(*name).to_owned()]),
        Identity::Named(source, args) => {
            let mut parts = vec![binding(source)];
            for arg in args {
                parts.push(type_key(arg)?);
            }
            ("named", parts)
        }
        Identity::Recursive(source) => ("recursive", vec![binding(source)]),
        Identity::Site(source) => ("site", vec![position(source)]),
        Identity::Array(element) => ("array", vec![type_key(element)?]),
        Identity::Tuple(elements) => {
            let mut parts = Vec::new();
            for (kind, element) in elements {
                parts.push(format!("{kind:?}"));
                parts.push(type_key(element)?);
            }
            ("tuple", parts)
        }
        Identity::Union(elements) => {
            let mut parts = elements
                .iter()
                .map(type_key)
                .collect::<Result<Vec<_>, _>>()?;
            parts.sort();
            ("union", parts)
        }
        Identity::Intersection(elements) => {
            let mut parts = elements
                .iter()
                .map(type_key)
                .collect::<Result<Vec<_>, _>>()?;
            parts.sort();
            ("intersection", parts)
        }
        Identity::Literal(value) => ("literal", vec![format!("{value:?}")]),
        Identity::Unavailable(id) => {
            return Err(format!(
                "dispatch instantiation type {} has unavailable source identity",
                id.0
            ));
        }
    };
    let mut key = tag.to_owned();
    for value in parts {
        part(&mut key, &value);
    }
    Ok(key)
}

pub(crate) fn dispatch(program: &Program, slot: usize) -> Result<String, String> {
    if program
        .member_origins
        .generator_resume
        .is_some_and(|resume| resume as usize == slot)
    {
        return Ok(crate::generated_members::RESUME.to_owned());
    }
    let row = u32::try_from(slot)
        .ok()
        .and_then(|slot| program.member_origins.dispatch.get(&slot))
        .ok_or_else(|| format!("dispatch slot {slot} has no producer-owned semantic member row"))?;
    let mut key = match &row.root {
        DispatchRoot::Provided(name) => format!("provided:{name}"),
        DispatchRoot::Named { source, arguments } => {
            let mut key = format!("named:{}", binding(source));
            for argument in arguments {
                part(&mut key, &type_key(argument)?);
            }
            key
        }
        DispatchRoot::Anonymous { id, source } => source.as_ref().map_or_else(
            || format!("anonymous:{}", id.0),
            |source| format!("anonymous-site:{}", position(source)),
        ),
        DispatchRoot::Unavailable(ty) => {
            return Err(format!(
                "dispatch root {} has no available source declaration identity",
                ty.0
            ));
        }
    };
    let kind = match row.accessor {
        MemberAccessor::Method => "method",
        MemberAccessor::Get => "get",
        MemberAccessor::Set => "set",
    };
    part(&mut key, kind);
    part(&mut key, if row.raising { "raising" } else { "ordinary" });
    part(&mut key, &property(program, &row.key)?);
    Ok(crate::generated_members::guarded_dispatch(&key))
}

pub(crate) fn static_value(
    program: &Program,
    id: nts_semantic_schema::TypeId,
) -> Result<String, String> {
    let value = program.member_origins.values.get(&id).ok_or_else(|| {
        format!(
            "static value {} has no producer-owned source identity",
            id.0
        )
    })?;
    let mut key = format!("{:?}:", value.kind);
    part(&mut key, &declaration_key(&value.declaration)?);
    match &value.variant {
        nts_core::hir::StaticValueVariant::Original => {}
        nts_core::hir::StaticValueVariant::Instantiation {
            owner,
            instance,
            arguments,
        } => {
            part(&mut key, &declaration_key(owner)?);
            if let Some(instance) = instance {
                part(&mut key, &type_key(instance)?);
            }
            let mut arguments = arguments
                .iter()
                .map(|(parameter, ty)| Ok((declaration_key(parameter)?, type_key(ty)?)))
                .collect::<Result<Vec<_>, String>>()?;
            arguments.sort();
            for (parameter, ty) in arguments {
                part(&mut key, &parameter);
                part(&mut key, &ty);
            }
        }
        nts_core::hir::StaticValueVariant::Captured => {
            return Err(format!(
                "captured closure {} cannot be published as a source singleton",
                id.0
            ));
        }
    }
    Ok(key)
}

fn declaration_key(declaration: &nts_core::hir::StaticDeclaration) -> Result<String, String> {
    use nts_core::hir::StaticDeclaration;
    Ok(match declaration {
        StaticDeclaration::Named(source) => format!("named:{}", binding(source)),
        StaticDeclaration::Site(source) => format!("site:{}", position(source)),
        StaticDeclaration::Provided(name) => format!("provided:{name}"),
        StaticDeclaration::Unavailable => {
            return Err("static value has unavailable source identity".to_owned());
        }
    })
}

pub(crate) fn template(program: &Program, site: u32) -> Result<String, String> {
    let source = program
        .member_origins
        .templates
        .get(&site)
        .and_then(Option::as_ref)
        .ok_or_else(|| {
            format!("template site {site} has no available producer-owned source position")
        })?;
    Ok(crate::generated_members::template(&position(source)))
}

pub(crate) fn errors(program: &crate::JvmProgram<'_>) -> Vec<String> {
    let mut errors = std::collections::BTreeSet::new();
    if !program.abstract_generators.is_empty() && program.member_origins.generator_resume.is_none()
    {
        errors.insert("generator resume has no producer-owned slot identity".to_owned());
    }
    for layout in &program.layouts {
        for field in &layout.fields {
            if let Err(error) = property(program, &field.name) {
                errors.insert(error);
            }
        }
    }
    for (&slot, row) in &program.member_origins.dispatch {
        if row.raising
            && program
                .raising_members
                .get(&slot)
                .is_none_or(|pair| pair.ordinary_slot != row.ordinary_slot)
        {
            errors.insert(format!("raising dispatch slot {slot} has missing or inconsistent producer-owned pair metadata"));
        }
    }
    for slot in program.protocol_slots().chain(
        program
            .guarded_dispatch
            .values()
            .flat_map(|row| row.slots.iter().map(|&slot| slot as usize)),
    ) {
        if let Err(error) = dispatch(program, slot) {
            errors.insert(error);
        }
    }
    for (id, _) in crate::closure_instances(
        crate::types::DEFAULT_PACKAGE,
        program,
        &rustc_hash::FxHashSet::default(),
    ) {
        if let Err(error) = static_value(program, id) {
            errors.insert(error);
        }
    }
    for object in nts_core::hir::templates::objects(program) {
        if let Err(error) = template(program, object.site) {
            errors.insert(error);
        }
    }
    errors.into_iter().collect()
}

#[cfg(test)]
pub(crate) fn synthetic_rows(program: &mut Program, rows: &[(u32, u32, &str, bool)]) {
    // These owned-HIR fixtures have no semantic snapshot or source declaration.
    // Every caller states the actual root/key relation, independently of bodies.
    for &(slot, root, key, raising) in rows {
        program.member_origins.dispatch.insert(
            slot,
            nts_core::hir::DispatchMember {
                root: DispatchRoot::Anonymous {
                    id: nts_semantic_schema::TypeId(root),
                    source: None,
                },
                key: key.into(),
                accessor: MemberAccessor::Method,
                raising,
                ordinary_slot: program
                    .raising_members
                    .get(&slot)
                    .and_then(|pair| pair.ordinary_slot),
            },
        );
    }
}

#[cfg(test)]
pub(crate) fn remap_rows(program: &mut Program, slots: &[(u32, u32)]) {
    let remap = |slot: u32| {
        slots
            .iter()
            .find(|(from, _)| *from == slot)
            .map_or(slot, |(_, to)| *to)
    };
    program.member_origins.dispatch = std::mem::take(&mut program.member_origins.dispatch)
        .into_iter()
        .map(|(slot, mut row)| {
            row.ordinary_slot = row.ordinary_slot.map(remap);
            (remap(slot), row)
        })
        .collect();
    program.raising_members = std::mem::take(&mut program.raising_members)
        .into_iter()
        .map(|(slot, mut row)| {
            row.ordinary_slot = row.ordinary_slot.map(remap);
            (remap(slot), row)
        })
        .collect();
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use nts_core::hir::{DispatchMember, MemberOrigins};
    use nts_semantic_schema::TypeId;

    fn source(module: &str) -> NamedClassSource {
        NamedClassSource {
            symbol: 7,
            module: module.into(),
            scopes: vec!["registered".into()],
        }
    }

    #[test]
    fn property_kinds_roles_and_escape_lookalikes_have_distinct_definitions() {
        let mut program = Program::default();
        program.member_origins.symbols.insert(
            TypeId(7),
            SymbolSource::Named(source("nts-workspace:///a.ts")),
        );
        program.member_origins.symbols.insert(
            TypeId(8),
            SymbolSource::Named(source("nts-workspace:///b.ts")),
        );
        let keys = [
            PropertyKey::Name("registered".into()),
            PropertyKey::Private("registered".into()),
            PropertyKey::Symbol(TypeId(7)),
            PropertyKey::Symbol(TypeId(8)),
        ];
        let mut identities: Vec<_> = keys
            .iter()
            .map(|key| property(&program, key).unwrap())
            .collect();
        identities.extend(
            [
                "", "a/b", "a$b", "a$2f$b", "\0", "東京", "\u{fffd}", "\\ud800", "\u{200c}",
            ]
            .into_iter()
            .map(|key| property(&program, &PropertyKey::Name(key.into())).unwrap()),
        );
        let mut builder = nts_jvm_emitter::ClassBuilder::new("Fields", "java/lang/Object");
        let mut all = std::collections::BTreeSet::new();
        for key in identities {
            for name in [
                crate::generated_members::storage_field(&key),
                crate::generated_members::defined(&key),
                crate::generated_members::face_field(&key),
            ] {
                assert!(
                    all.insert(name.clone()),
                    "a semantic key or role collided: {key:?}"
                );
                builder.field(nts_jvm_emitter::class::access::PUBLIC, name, "D");
            }
        }
        let emitted = builder.build(nts_jvm_emitter::Pool::new()).unwrap();
        let parsed = nts_jvm_emitter::read::class_file(&emitted.bytes).unwrap();
        assert_eq!(parsed.fields.len(), all.len());
        assert_eq!(
            parsed
                .fields
                .iter()
                .map(|field| field.name.clone())
                .collect::<std::collections::BTreeSet<_>>(),
            all
        );
        assert!(
            property(&program, &PropertyKey::Symbol(TypeId(9))).is_err(),
            "missing symbol provenance must not mint a counter name"
        );
    }

    #[test]
    fn dispatch_and_template_names_follow_owned_identity_when_indices_move() {
        let row = DispatchMember {
            root: DispatchRoot::Named {
                source: source("nts-workspace:///owner.ts"),
                arguments: vec![nts_core::hir::TypeIdentity::Intrinsic("number")],
            },
            key: PropertyKey::Name("read".into()),
            accessor: MemberAccessor::Method,
            raising: false,
            ordinary_slot: None,
        };
        let mut a = Program {
            member_origins: MemberOrigins::default(),
            ..Program::default()
        };
        a.member_origins.dispatch.insert(0, row.clone());
        let mut b = a.clone();
        b.member_origins.dispatch.clear();
        b.member_origins.dispatch.insert(123, row);
        assert_eq!(dispatch(&a, 0), dispatch(&b, 123));
        assert!(dispatch(&b, 0).is_err());
        let at = SourcePosition {
            module: "nts-workspace:///template.ts".into(),
            line: 5,
            column: 9,
        };
        a.member_origins.templates.insert(1, Some(at.clone()));
        b.member_origins.templates.insert(99, Some(at));
        b.member_origins.templates.insert(
            1,
            Some(SourcePosition {
                module: "nts-workspace:///other.ts".into(),
                line: 1,
                column: 1,
            }),
        );
        assert_eq!(template(&a, 1), template(&b, 99));
        assert_ne!(template(&a, 1), template(&b, 1));
        assert!(template(&a, 99).is_err());
    }
}

#[cfg(test)]
#[path = "member_identity_tests.rs"]
mod source_tests;
