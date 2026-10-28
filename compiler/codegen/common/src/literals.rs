//! Intern string data only where emitted code requests it.

use std::{cell::RefCell, collections::BTreeSet, rc::Rc};

use nts_semantic_schema::JsText;
use rustc_hash::FxHashMap;

#[derive(Debug, Default)]
struct Uses {
    body: Option<String>,
    strings: BTreeSet<usize>,
    templates: BTreeSet<u32>,
}

#[derive(Debug, Default)]
struct Store {
    strings: Vec<JsText>,
    indices: FxHashMap<JsText, usize>,
    uses: Vec<Uses>,
}

/// Each body has a request scope. Discarding its emitted body also discards
/// its requests; root requests come from descriptors and kept templates.
#[derive(Debug)]
pub struct Pool {
    store: Rc<RefCell<Store>>,
    scope: usize,
}

impl Default for Pool {
    fn default() -> Self {
        Self {
            store: Rc::new(RefCell::new(Store {
                uses: vec![Uses::default()],
                ..Store::default()
            })),
            scope: 0,
        }
    }
}

impl Pool {
    /// Record requests in a body-local scope of this interner.
    #[must_use]
    pub fn for_body(&self, body: &str) -> Self {
        let mut store = self.store.borrow_mut();
        let scope = store.uses.len();
        store.uses.push(Uses {
            body: Some(body.to_owned()),
            ..Uses::default()
        });
        Self {
            store: Rc::clone(&self.store),
            scope,
        }
    }

    /// Request one string and return its stable first-use index.
    #[must_use]
    pub fn string(&self, text: &JsText) -> usize {
        let mut store = self.store.borrow_mut();
        let index = if let Some(&index) = store.indices.get(text) {
            index
        } else {
            let index = store.strings.len();
            store.strings.push(text.clone());
            store.indices.insert(text.clone(), index);
            index
        };
        store.uses[self.scope].strings.insert(index);
        index
    }

    /// Record a template site in this emission scope.
    pub fn template(&self, site: u32) {
        self.store.borrow_mut().uses[self.scope]
            .templates
            .insert(site);
    }

    /// Template sites referenced by root data or retained bodies.
    #[must_use]
    pub fn templates(&self, kept: &BTreeSet<&str>) -> BTreeSet<u32> {
        self.store
            .borrow()
            .uses
            .iter()
            .filter(|uses| uses.body.as_deref().is_none_or(|body| kept.contains(body)))
            .flat_map(|uses| uses.templates.iter().copied())
            .collect()
    }

    /// Referenced string definitions, in stable index order.
    #[must_use]
    pub fn definitions(&self, kept: &BTreeSet<&str>) -> Vec<(usize, JsText)> {
        let store = self.store.borrow();
        let used: BTreeSet<_> = store
            .uses
            .iter()
            .filter(|uses| uses.body.as_deref().is_none_or(|body| kept.contains(body)))
            .flat_map(|uses| uses.strings.iter().copied())
            .collect();
        used.into_iter()
            .map(|index| (index, store.strings[index].clone()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Pool;
    use nts_semantic_schema::JsText;
    use std::collections::BTreeSet;

    #[test]
    fn dropped_requests_do_not_publish_data_and_shared_requests_stay_interned() {
        let literals = Pool::default();
        let dropped = literals.for_body("dropped");
        let kept = literals.for_body("kept");
        let shared = JsText::from("shared");
        let _ = dropped.string(&JsText::from("unread"));
        assert_eq!(dropped.string(&shared), kept.string(&shared));
        dropped.template(1);
        kept.template(2);
        let live = BTreeSet::from_iter(["kept"]);
        assert_eq!(literals.definitions(&live), vec![(1, shared)]);
        assert_eq!(literals.templates(&live), BTreeSet::from_iter([2]));
        let _ = literals.string(&JsText::from("descriptor"));
        assert_eq!(literals.definitions(&live).len(), 2);
    }
}
