//! Lifetime propagation uses a scope lattice, not a set of every path by
//! which each root reaches each object. A bound moves toward an ancestor or
//! outside; selective contexts bound the height. Proofs form a shared DAG.

use std::collections::VecDeque;

use super::Reason;
use super::graph::{Graph, Object, Slot};
use super::report::Proof;

pub(super) struct Context<'a> {
    pub parent: Option<usize>,
    pub ancestors: &'a [usize],
    pub key: &'a str,
    pub fallback: bool,
}

#[derive(Debug, Clone)]
pub(super) enum Exposure {
    Returned(usize),
    Outside(String),
    Collector,
    Unknown(Reason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Bound {
    Frame(usize),
    Outside(Reason),
}

pub(super) struct Result {
    pub bounds: Vec<Bound>,
    pub witnesses: Vec<usize>,
    pub proofs: Vec<Proof>,
}

fn joined(old: &Bound, incoming: &Bound, contexts: &[Context<'_>]) -> Option<Bound> {
    match (old, incoming) {
        // The first deterministic witness suffices. Improving a diagnostic
        // must not add another lattice dimension or requeue an outside node.
        (Bound::Outside(_), _) => None,
        (_, Bound::Outside(_)) => Some(incoming.clone()),
        (Bound::Frame(a), Bound::Frame(b)) if a == b => None,
        (Bound::Frame(a), Bound::Frame(b)) => {
            let common = contexts[*a]
                .ancestors
                .iter()
                .chain(std::iter::once(a))
                .rev()
                .find(|at| **at == *b || contexts[*b].ancestors.contains(at));
            match common {
                Some(at) if at == a => None,
                Some(at) => Some(Bound::Frame(*at)),
                None => Some(Bound::Outside(Reason::ContextBudget)),
            }
        }
    }
}

fn spelling(bound: &Bound, contexts: &[Context<'_>]) -> String {
    match bound {
        Bound::Frame(at) => format!("frame {}", contexts[*at].key),
        Bound::Outside(why) => format!("outside {why:?}"),
    }
}

struct State<'a> {
    contexts: &'a [Context<'a>],
    result: Result,
    pending: VecDeque<Object>,
    queued: Vec<bool>,
}

impl State<'_> {
    fn raise(
        &mut self,
        object: Object,
        incoming: &Bound,
        cause: Option<usize>,
        edge: String,
        graph: &Graph,
    ) {
        let Some(bound) = joined(&self.result.bounds[object], incoming, self.contexts) else {
            return;
        };
        let mut causes = vec![self.result.witnesses[object]];
        causes.extend(cause);
        let id = self.result.proofs.len();
        self.result.proofs.push(Proof {
            id,
            object: graph.label(object),
            bound: spelling(&bound, self.contexts),
            causes,
            edge,
        });
        self.result.bounds[object] = bound;
        self.result.witnesses[object] = id;
        if !self.queued[object] {
            self.queued[object] = true;
            self.pending.push_back(object);
        }
    }
}

pub(super) fn analyze(
    graph: &mut Graph,
    contexts: &[Context<'_>],
    roots: &[(usize, Exposure)],
) -> Result {
    if contexts.is_empty() {
        return Result {
            bounds: Vec::new(),
            witnesses: Vec::new(),
            proofs: Vec::new(),
        };
    }
    let bounds: Vec<_> = graph
        .objects
        .iter()
        .enumerate()
        .map(|(index, object)| {
            if graph.is_widened(index) {
                Bound::Outside(Reason::WeakUnionBudget)
            } else if object.site.is_some() {
                Bound::Frame(object.context)
            } else {
                Bound::Outside(Reason::Outside("external or immortal storage".to_owned()))
            }
        })
        .collect();
    let proofs: Vec<_> = graph
        .objects
        .iter()
        .zip(&bounds)
        .enumerate()
        .map(|(id, (_, bound))| Proof {
            id,
            object: graph.label(id),
            bound: spelling(bound, contexts),
            causes: Vec::new(),
            edge: "allocation scope or external storage contract".to_owned(),
        })
        .collect();
    let mut state = State {
        contexts,
        result: Result {
            bounds,
            witnesses: (0..graph.objects.len()).collect(),
            proofs,
        },
        pending: (0..graph.objects.len())
            .filter(|object| graph.representative(*object) == *object)
            .collect(),
        queued: vec![true; graph.objects.len()],
    };
    'roots: for (node, exposure) in roots {
        let bound = match exposure {
            Exposure::Outside(why) => Bound::Outside(Reason::Outside(why.clone())),
            Exposure::Collector => Bound::Outside(Reason::RuntimeRootContract),
            Exposure::Unknown(why) => Bound::Outside(why.clone()),
            Exposure::Returned(at) if contexts[*at].fallback => {
                Bound::Outside(Reason::ContextBudget)
            }
            Exposure::Returned(at) => contexts[*at].parent.map_or_else(
                || Bound::Outside(Reason::Returned(contexts[*at].key.to_owned())),
                Bound::Frame,
            ),
        };
        let objects: Vec<_> = graph.values[*node].objects.iter().copied().collect();
        for object in objects {
            if !graph.charge() {
                break 'roots;
            }
            state.raise(object, &bound, None, format!("{exposure:?}"), graph);
        }
    }
    'work: while let Some(object) = state.pending.pop_front() {
        state.queued[object] = false;
        if !graph.charge() {
            break;
        }
        let bound = state.result.bounds[object].clone();
        let cause = state.result.witnesses[object];
        let children: Vec<_> = graph
            .slots
            .range((object, Slot::Field(String::new()))..(object + 1, Slot::Field(String::new())))
            .flat_map(|((_, slot), node)| {
                graph.values[*node]
                    .objects
                    .iter()
                    .map(move |child| (*child, slot.clone()))
            })
            .collect();
        for (child, slot) in children {
            if !graph.charge() {
                break 'work;
            }
            state.raise(
                child,
                &bound,
                Some(cause),
                format!("stored in {slot:?}"),
                graph,
            );
        }
    }
    state.result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::memory::graph::{Instance, ObjectInfo};

    fn object(graph: &mut Graph, context: usize, index: usize) -> (usize, usize) {
        let node = graph.node();
        let object = graph.object(
            ObjectInfo {
                label: format!("object-{index}"),
                site: Some(index),
                context,
                instance: Instance::Recent,
                open: false,
            },
            node,
        );
        (node, object)
    }

    #[test]
    fn returning_a_callers_reference_does_not_extend_that_callers_frame() {
        let contexts = [
            Context {
                parent: None,
                ancestors: &[],
                key: "caller",
                fallback: false,
            },
            Context {
                parent: Some(0),
                ancestors: &[0],
                key: "callee",
                fallback: false,
            },
        ];
        let mut graph = Graph::new(10_000, 1_000);
        let (inherited_value, inherited) = object(&mut graph, 0, 0);
        let (fresh_value, fresh) = object(&mut graph, 1, 1);
        graph.solve();
        let result = analyze(
            &mut graph,
            &contexts,
            &[
                (inherited_value, Exposure::Returned(1)),
                (fresh_value, Exposure::Returned(1)),
            ],
        );
        assert_eq!(result.bounds[inherited], Bound::Frame(0));
        assert_eq!(result.bounds[fresh], Bound::Frame(0));
        assert!(
            result
                .proofs
                .iter()
                .all(|proof| proof.causes.iter().all(|cause| *cause < proof.id))
        );
    }

    #[test]
    fn many_roots_of_a_long_graph_take_linear_work_and_shared_proofs() {
        let contexts = [Context {
            parent: None,
            ancestors: &[],
            key: "entry",
            fallback: false,
        }];
        for n in [64, 128, 256] {
            let mut graph = Graph::new(100_000, 10_000);
            let objects: Vec<_> = (0..n).map(|at| object(&mut graph, 0, at)).collect();
            for pair in objects.windows(2) {
                graph.store(pair[0].0, Slot::Elements, pair[1].0);
            }
            graph.solve();
            let roots: Vec<_> = (0..n)
                .map(|at| (objects[0].0, Exposure::Outside(format!("root-{at}"))))
                .collect();
            let start = graph.work;
            let result = analyze(&mut graph, &contexts, &roots);
            assert!(graph.failure.is_none());
            assert!(
                graph.work - start <= 4 * n + 6,
                "n={n}, work={}",
                graph.work - start
            );
            assert!(result.proofs.len() <= 3 * n + 1);
            assert!(
                objects
                    .iter()
                    .all(|(_, at)| matches!(result.bounds[*at], Bound::Outside(_)))
            );
        }
    }
}
