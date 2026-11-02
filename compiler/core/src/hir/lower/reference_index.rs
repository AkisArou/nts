//! Shared alias identities in one fixed collector/builder context.
//!
//! Analysis facts only: executable references still materialize their complete
//! ordered binding path and check readiness at the use site. The cached links
//! retain that same order without storing a flattened path for every prefix.

use super::{FuncBuilder, NodeId, SymbolId, construction::ReferenceStep};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug, Clone, Copy)]
pub(super) struct ReferenceIdentity {
    pub(super) symbol: SymbolId,
}

pub(super) struct References<'builder, 'snapshot> {
    probe: &'builder FuncBuilder<'snapshot>,
    steps: FxHashMap<SymbolId, Option<ReferenceStep>>,
    answers: FxHashMap<SymbolId, Option<SymbolId>>,
}

impl<'builder, 'snapshot> References<'builder, 'snapshot> {
    pub(super) fn new(probe: &'builder FuncBuilder<'snapshot>) -> Self {
        Self {
            probe,
            steps: FxHashMap::default(),
            answers: FxHashMap::default(),
        }
    }

    pub(super) fn of(&mut self, at: NodeId) -> Option<ReferenceIdentity> {
        let mut symbol = self.probe.reference_start(at)?;
        let mut path = Vec::new();
        let mut seen = FxHashSet::default();
        let answer = loop {
            if let Some(answer) = self.answers.get(&symbol) {
                break *answer;
            }
            let step = *self
                .steps
                .entry(symbol)
                .or_insert_with(|| self.probe.reference_step(symbol));
            let Some(step) = step else {
                self.answers.insert(symbol, None);
                break None;
            };
            // Count actual traversed links, including cached steps. A cache
            // mutant that re-walks known paths must still trip the guard.
            #[cfg(test)]
            if matches!(step, ReferenceStep::Alias { .. }) {
                super::view_class_tests::note_alias_link();
            }
            let canonical = step.symbol();
            // A checked import alias may normalize to the same const alias
            // another query already authenticated. Keep one indexed link.
            self.steps.entry(canonical).or_insert(Some(step));
            if let Some(answer) = self.answers.get(&canonical).copied() {
                self.answers.insert(symbol, answer);
                break answer;
            }
            if !seen.insert(canonical) {
                break None;
            }
            match step {
                ReferenceStep::Terminal(symbol_at) => {
                    self.answers.insert(canonical, Some(symbol_at));
                    self.answers.insert(symbol, Some(symbol_at));
                    break Some(symbol_at);
                }
                ReferenceStep::Alias {
                    symbol: binding,
                    next,
                } => {
                    path.push((symbol, binding));
                    symbol = next;
                }
            }
        };
        for (source, binding) in path {
            self.answers.insert(binding, answer);
            self.answers.insert(source, answer);
        }
        answer.map(|symbol| ReferenceIdentity { symbol })
    }

    #[cfg(test)]
    pub(super) fn owned_binding_elements(&self) -> usize {
        self.steps
            .values()
            .flatten()
            .filter(|step| matches!(step, ReferenceStep::Alias { .. }))
            .count()
    }

    #[cfg(test)]
    pub(super) fn binding_path(&self, at: NodeId) -> Vec<u32> {
        let mut path = Vec::new();
        let mut next = self.probe.reference_start(at);
        let mut seen = FxHashSet::default();
        while let Some(symbol) = next {
            assert!(seen.insert(symbol), "a qualified binding path cannot cycle");
            match self.steps.get(&symbol).copied().flatten() {
                Some(ReferenceStep::Alias {
                    symbol: binding,
                    next: target,
                }) => {
                    path.push(binding.0);
                    next = Some(target);
                }
                Some(ReferenceStep::Terminal(_)) => break,
                None => panic!("a qualified reference must retain every authenticated link"),
            }
        }
        path
    }
}
