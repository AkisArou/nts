//! Semantic dispatch identity, separate from an emitted function's spelling.

use nts_semantic_schema::PropertyKey;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum Accessor {
    Method,
    Get,
    Set,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) struct MemberKey {
    pub key: PropertyKey,
    pub accessor: Accessor,
}

impl MemberKey {
    pub(super) fn method(key: PropertyKey) -> Self {
        Self {
            key,
            accessor: Accessor::Method,
        }
    }
    pub(super) fn named(name: &str) -> Self {
        Self::method(PropertyKey::Name(name.to_owned()))
    }
    pub(super) fn get(key: PropertyKey) -> Self {
        Self {
            key,
            accessor: Accessor::Get,
        }
    }
    pub(super) fn set(key: PropertyKey) -> Self {
        Self {
            key,
            accessor: Accessor::Set,
        }
    }

    /// An emitted function name, never read back as a member identity. Ordinary
    /// public methods retain their spelling; reserved namespaces are escaped on
    /// public keys as well, so every semantic key has a distinct code symbol.
    pub(super) fn emitted_name(&self) -> String {
        let key = match &self.key {
            PropertyKey::Name(name)
                if name.starts_with(['#', '@'])
                    || name.starts_with("get ")
                    || name.starts_with("set ")
                    || name.ends_with("@raises") =>
            {
                format!("@name{}:{name}", name.len())
            }
            PropertyKey::Name(name) => name.clone(),
            PropertyKey::Private(name) => format!("@private{}:{name}", name.len()),
            PropertyKey::Symbol(id) => format!("@symbol{}", id.0),
        };
        match self.accessor {
            Accessor::Method => key,
            Accessor::Get => format!("get {key}"),
            Accessor::Set => format!("set {key}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Accessor, MemberKey, PropertyKey};
    use nts_semantic_schema::TypeId;
    use std::collections::BTreeSet;

    #[test]
    fn code_symbols_do_not_identify_a_different_member_or_raising_entry() {
        let keys = [
            PropertyKey::Name("iterator".to_owned()),
            PropertyKey::Name("#iterator".to_owned()),
            PropertyKey::Private("#iterator".to_owned()),
            PropertyKey::Symbol(TypeId(1)),
            PropertyKey::Symbol(TypeId(10)),
            PropertyKey::Name("@symbol1".to_owned()),
            PropertyKey::Name("@private9:#iterator".to_owned()),
            PropertyKey::Name("get iterator".to_owned()),
            PropertyKey::Name("set iterator".to_owned()),
            PropertyKey::Name("iterator@raises".to_owned()),
            PropertyKey::Name("get iterator@raises".to_owned()),
            PropertyKey::Name("@name0:".to_owned()),
            PropertyKey::Name(String::new()),
        ];
        let mut names = BTreeSet::new();
        for key in keys {
            for accessor in [Accessor::Method, Accessor::Get, Accessor::Set] {
                let member = MemberKey {
                    key: key.clone(),
                    accessor,
                };
                for suffix in ["", "@raises"] {
                    assert!(
                        names.insert(format!("{}{suffix}", member.emitted_name())),
                        "{member:?} collides at {suffix:?}"
                    );
                }
            }
        }
    }
}
