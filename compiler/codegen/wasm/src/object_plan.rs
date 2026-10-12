//! Nominal descriptors share physical layouts without sharing class identity.

use crate::error::Failure;
use nts_core::hir::{ClassId, Field, HirType, ManagedType, Program, tags};
use rustc_hash::FxHashMap;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Identity {
    Class(u32),
    Record(usize),
}

#[derive(Debug)]
pub(crate) struct Object {
    pub(crate) physical: u32,
    pub(crate) descriptor: u32,
    pub(crate) fields: Arc<[Field]>,
    pub(crate) name: String,
    pub(crate) field_base: u32,
    pub(crate) callable: Option<usize>,
    pub(crate) virtual_: Option<usize>,
    identity: u32,
    nominal: bool,
}
#[derive(Debug)]
pub(crate) struct Descriptor {
    pub(crate) identity: u32,
    pub(crate) kind: u32,
    pub(crate) ancestry: Vec<u32>,
}
#[derive(Debug, Default)]
pub(crate) struct Plan {
    objects: FxHashMap<ClassId, Object>,
    pub(crate) descriptors: Vec<Descriptor>,
    parents: FxHashMap<u32, u32>,
}
fn identity(program: &Program, at: usize, ty: ClassId) -> Result<Identity, String> {
    let classes = program
        .classes
        .iter()
        .filter(|class| class.types.contains(&ty))
        .map(|class| class.symbol)
        .collect::<BTreeSet<_>>();
    match classes.len() {
        0 => Ok(Identity::Record(at)),
        1 => classes
            .first()
            .copied()
            .map(Identity::Class)
            .ok_or_else(|| "missing semantic identity".into()),
        _ => Err(format!("class type {ty:?} has ambiguous semantic identity")),
    }
}
impl Plan {
    pub(crate) fn build(program: &Program, layouts: &BTreeMap<usize, u32>) -> Result<Self, String> {
        let mut keys = BTreeMap::new();
        let fields = layouts
            .keys()
            .map(|&at| (at, Arc::<[Field]>::from(program.layouts[at].fields.clone())))
            .collect::<BTreeMap<_, _>>();
        for &at in layouts.keys() {
            for &ty in &program.layouts[at].types {
                if keys.insert(ty, (at, identity(program, at, ty)?)).is_some() {
                    return Err(format!(
                        "class type {ty:?} names more than one physical layout"
                    ));
                }
            }
        }
        let identities = keys
            .values()
            .map(|(_, key)| *key)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .enumerate()
            .map(|(id, key)| {
                Ok((
                    key,
                    u32::try_from(id).map_err(|_| "too many semantic class identities")?,
                ))
            })
            .collect::<Result<BTreeMap<_, _>, String>>()?;
        let mut plan = Self::default();
        let mut descriptors = BTreeMap::new();
        for (&ty, &(at, key)) in &keys {
            let kind = tags::of_reference(&ManagedType::Object(ty));
            let descriptor = if let Some(&(index, expected)) = descriptors.get(&(at, key)) {
                if expected != kind {
                    return Err(format!(
                        "layout `{}` merges different runtime kinds",
                        program.layouts[at].name
                    ));
                }
                index
            } else {
                let index = u32::try_from(plan.descriptors.len())
                    .map_err(|_| "too many object descriptors")?;
                let ancestry = ancestry(program, at, key, &keys, &identities)?;
                plan.descriptors.push(Descriptor {
                    identity: identities[&key],
                    kind,
                    ancestry,
                });
                descriptors.insert((at, key), (index, kind));
                index
            };
            let layout = &program.layouts[at];
            plan.objects.insert(
                ty,
                Object {
                    physical: layouts[&at],
                    descriptor,
                    fields: Arc::clone(&fields[&at]),
                    name: layout.name.clone(),
                    field_base: 1,
                    callable: None,
                    virtual_: None,
                    identity: identities[&key],
                    nominal: matches!(key, Identity::Class(_)),
                },
            );
            if let Some(base) = layout.base {
                let (parent, _) = keys
                    .get(&base)
                    .ok_or_else(|| format!("unplanned base of `{}`", layout.name))?;
                plan.parents.insert(layouts[&at], layouts[parent]);
            }
        }
        Ok(plan)
    }
    pub(crate) fn object(&self, ty: &HirType) -> Result<&Object, Failure> {
        let HirType::Managed(ManagedType::Object(id)) = ty else {
            return Err(format!("object storage for {ty:?}").into());
        };
        self.objects
            .get(id)
            .ok_or_else(|| Failure::Invariant(format!("unplanned object {id:?}")))
    }
    pub(crate) fn class(&self, id: ClassId) -> Result<u32, Failure> {
        let object = self.object(&HirType::Managed(ManagedType::Object(id)))?;
        if !object.nominal {
            return Err(
                format!("class `{}` has no declared semantic identity", object.name).into(),
            );
        }
        Ok(object.identity)
    }
    pub(crate) fn attach_callable(
        &mut self,
        ty: ClassId,
        root: usize,
        fields: u32,
    ) -> Result<(), String> {
        let object = self
            .objects
            .get_mut(&ty)
            .ok_or_else(|| format!("unplanned callable {ty:?}"))?;
        object.callable = Some(root);
        object.field_base = fields;
        Ok(())
    }
    pub(crate) fn subtype(&self, mut from: u32, to: u32) -> bool {
        loop {
            if from == to {
                return true;
            }
            let Some(parent) = self.parents.get(&from) else {
                return false;
            };
            from = *parent;
        }
    }
    pub(crate) fn attach_virtual(&mut self, ty: ClassId, root: usize) -> Result<(), String> {
        let object = self
            .objects
            .get_mut(&ty)
            .ok_or_else(|| format!("unplanned dispatch object {ty:?}"))?;
        object.virtual_ = Some(root);
        Ok(())
    }
}
fn ancestry(
    program: &Program,
    mut at: usize,
    key: Identity,
    keys: &BTreeMap<ClassId, (usize, Identity)>,
    identities: &BTreeMap<Identity, u32>,
) -> Result<Vec<u32>, String> {
    let mut result = BTreeSet::from([identities[&key]]);
    let mut seen = BTreeSet::new();
    loop {
        if !seen.insert(at) {
            return Err(format!("cyclic ancestry of `{}`", program.layouts[at].name));
        }
        let Some(base) = program.layouts[at].base else {
            break;
        };
        let &(parent, key) = keys
            .get(&base)
            .ok_or_else(|| format!("unplanned ancestor {base:?}"))?;
        result.insert(identities[&key]);
        at = parent;
    }
    Ok(result.into_iter().collect())
}
