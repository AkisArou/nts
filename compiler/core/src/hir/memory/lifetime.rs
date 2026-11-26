//! Lifetime propagation uses a scope lattice, not a set of every path by
//! which each root reaches each object. A bound moves toward an ancestor or
//! outside; selective contexts bound the height. Proofs form a shared DAG.
//!
//! A weak alias class has one lifetime. Its representative starts at the join
//! of every member's allocation scope, every edge into any member reaches the
//! representative, and each member publishes the representative's bound.
//! Widening costs precision, never the lifetime proof.
//!
//! The runtime's own roots (`Exposure::Collector`) are a separate column: an
//! object the cycle collector may hold, and everything it reaches, carries an
//! unsealed runtime-root obligation, while its bound stays what the program's
//! own edges prove. The obligation alone keeps such a site on the heap.

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

/// The typed step behind each proof, parallel to `Result::proofs`. Readers
/// follow these, never a proof's printed edge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Step {
    /// The object's own allocation scope, or the external storage contract.
    Scope(Object),
    /// A root exposure, by its index in the roots handed to `analyze`.
    Exposure(usize),
    /// Stored into `slot` of `parent`, whose own witness is the next cause.
    Stored { parent: Object, slot: Slot },
    /// A weak class joined its members' scopes.
    Joined(Object),
}

pub(super) struct Result {
    pub bounds: Vec<Bound>,
    pub witnesses: Vec<usize>,
    pub proofs: Vec<Proof>,
    pub steps: Vec<Step>,
    /// Reached from a runtime root: the collector may hold it.
    pub runtime_held: Vec<bool>,
}

fn joined(old: &Bound, incoming: &Bound, contexts: &[Context<'_>]) -> Option<Bound> {
    match (old, incoming) {
        // The first deterministic witness suffices. Improving a diagnostic
        // must not add another lattice dimension or requeue an outside node.
        // Missing outcome is a separate, sticky lack of proof. Preserve it
        // even when an earlier known outside root already forbids a home.
        // This adds one promotion, not one dimension per call-site witness.
        (Bound::Outside(old), Bound::Outside(Reason::MissingOutcome(_)))
            if !matches!(old, Reason::MissingOutcome(_)) =>
        {
            Some(incoming.clone())
        }
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
                // A merged context without a common caller chain lost its
                // lineage to the budget; otherwise the two entries are unrelated.
                None if contexts[*a].fallback || contexts[*b].fallback => {
                    Some(Bound::Outside(Reason::ContextBudget))
                }
                None => Some(Bound::Outside(Reason::Outside(format!(
                    "no activation holds both {} and {}",
                    contexts[*a].key, contexts[*b].key
                )))),
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
        (edge, step): (String, Step),
        graph: &Graph,
    ) {
        let object = graph.representative(object);
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
        self.result.steps.push(step);
        self.result.bounds[object] = bound;
        self.result.witnesses[object] = id;
        if !self.queued[object] {
            self.queued[object] = true;
            self.pending.push_back(object);
        }
    }
}

/// One failure authority for every published lifetime column. A partial
/// positive lattice seed cannot serve as a final witness after invalidation.
pub(super) fn failed(graph: &Graph, reason: &Reason) -> Result {
    let proofs = graph
        .objects
        .iter()
        .enumerate()
        .map(|(id, _)| Proof {
            id,
            object: graph.label(id),
            bound: format!("outside {reason:?}"),
            causes: Vec::new(),
            edge: "Unknown: a required memory dependency failed".to_owned(),
        })
        .collect();
    Result {
        bounds: vec![Bound::Outside(reason.clone()); graph.objects.len()],
        witnesses: (0..graph.objects.len()).collect(),
        proofs,
        steps: (0..graph.objects.len()).map(Step::Scope).collect(),
        runtime_held: vec![true; graph.objects.len()],
    }
}

impl<'a> State<'a> {
    fn of(graph: &mut Graph, contexts: &'a [Context<'a>]) -> Self {
        let bounds: Vec<_> = graph
            .objects
            .iter()
            .map(|object| {
                if object.site.is_some() {
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
        let mut state = Self {
            contexts,
            result: Result {
                bounds,
                witnesses: (0..graph.objects.len()).collect(),
                proofs,
                steps: (0..graph.objects.len()).map(Step::Scope).collect(),
                runtime_held: vec![false; graph.objects.len()],
            },
            pending: (0..graph.objects.len())
                .filter(|object| graph.representative(*object) == *object)
                .collect(),
            queued: vec![true; graph.objects.len()],
        };
        state.join_classes(graph);
        state
    }

    /// A weak class starts where its widest member does. Escapes need no
    /// join: every edge into a member already names the representative.
    fn join_classes(&mut self, graph: &mut Graph) {
        for class in 0..graph.objects.len() {
            if graph.representative(class) != class || !graph.is_widened(class) {
                continue;
            }
            let members = graph.class_members(class).to_vec();
            let mut bound = self.result.bounds[class].clone();
            let mut causes = vec![self.result.witnesses[class]];
            for member in members.into_iter().filter(|member| *member != class) {
                if !graph.charge() {
                    return;
                }
                if let Some(wider) = joined(&bound, &self.result.bounds[member], self.contexts) {
                    bound = wider;
                }
                causes.push(self.result.witnesses[member]);
            }
            let id = self.result.proofs.len();
            self.result.proofs.push(Proof {
                id,
                object: graph.label(class),
                bound: spelling(&bound, self.contexts),
                causes,
                edge: "weak alias class: the join of its members' scopes".to_owned(),
            });
            self.result.steps.push(Step::Joined(class));
            self.result.bounds[class] = bound;
            self.result.witnesses[class] = id;
        }
    }

    /// Each member publishes its class's bound and witness.
    fn publish_members(mut self, graph: &Graph) -> Result {
        for object in 0..graph.objects.len() {
            let class = graph.representative(object);
            if class != object {
                self.result.bounds[object] = self.result.bounds[class].clone();
                self.result.witnesses[object] = self.result.witnesses[class];
                self.result.runtime_held[object] = self.result.runtime_held[class];
            }
        }
        self.result
    }
}

pub(super) fn analyze(
    graph: &mut Graph,
    contexts: &[Context<'_>],
    roots: &[(usize, Exposure)],
) -> Result {
    if let Some(reason) = &graph.failure {
        return failed(graph, reason);
    }
    if contexts.is_empty() {
        return Result {
            bounds: Vec::new(),
            witnesses: Vec::new(),
            proofs: Vec::new(),
            steps: Vec::new(),
            runtime_held: Vec::new(),
        };
    }
    let mut state = State::of(graph, contexts);
    if !runtime_held(graph, roots, &mut state.result.runtime_held) {
        let reason = graph.failure.clone().unwrap_or(Reason::WorkBudget);
        return failed(graph, &reason);
    }
    'roots: for (root, (node, exposure)) in roots.iter().enumerate() {
        let bound = match exposure {
            Exposure::Collector => continue,
            Exposure::Outside(why) => Bound::Outside(Reason::Outside(why.clone())),
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
            state.raise(
                object,
                &bound,
                None,
                (format!("{exposure:?}"), Step::Exposure(root)),
                graph,
            );
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
        let parent = object;
        for (child, slot) in children {
            if !graph.charge() {
                break 'work;
            }
            state.raise(
                child,
                &bound,
                Some(cause),
                (
                    format!("stored in {slot:?}"),
                    Step::Stored {
                        parent,
                        slot: slot.clone(),
                    },
                ),
                graph,
            );
        }
    }
    if let Some(reason) = &graph.failure {
        failed(graph, reason)
    } else {
        state.publish_members(graph)
    }
}

/// Everything reachable through slots from the runtime's roots, by class.
fn runtime_held(graph: &mut Graph, roots: &[(usize, Exposure)], held: &mut [bool]) -> bool {
    let mut pending = VecDeque::new();
    for (node, exposure) in roots {
        if matches!(exposure, Exposure::Collector) {
            for object in graph.values[*node].objects.clone() {
                let object = graph.representative(object);
                if !held[object] {
                    held[object] = true;
                    pending.push_back(object);
                }
            }
        }
    }
    while let Some(object) = pending.pop_front() {
        if !graph.charge() {
            return false;
        }
        let children: Vec<_> = graph
            .slots
            .range((object, Slot::Field(String::new()))..(object + 1, Slot::Field(String::new())))
            .flat_map(|(_, node)| graph.values[*node].objects.iter().copied())
            .collect();
        for child in children {
            let child = graph.representative(child);
            if !graph.charge() {
                return false;
            }
            if !held[child] {
                held[child] = true;
                pending.push_back(child);
            }
        }
    }
    true
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

    /// Joining the members' allocation scopes alone would leave `kept` in its
    /// frame: a member must reach every escape of its class.
    #[test]
    fn a_weak_class_member_reaches_every_escape_of_its_class() {
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
        let module = Bound::Outside(Reason::Outside("module slot 0".to_owned()));
        for (kept_context, escape, expected) in [
            (1, None, Bound::Frame(1)),
            (0, None, Bound::Frame(0)),
            (1, Some(Exposure::Returned(1)), Bound::Frame(0)),
            (
                1,
                Some(Exposure::Outside("module slot 0".to_owned())),
                module.clone(),
            ),
        ] {
            let mut graph = Graph::new(10_000, 1_000);
            graph.alias_limit = 1;
            let (kept_value, kept) = object(&mut graph, kept_context, 0);
            let (escaping_value, escaping) = object(&mut graph, 1, 1);
            let either = graph.node();
            graph.copy(kept_value, either);
            graph.copy(escaping_value, either);
            graph.solve();
            assert!(graph.is_widened(kept) && graph.is_widened(escaping));
            let roots: Vec<_> = escape
                .iter()
                .map(|exposure| (escaping_value, exposure.clone()))
                .collect();
            let result = analyze(&mut graph, &contexts, &roots);
            assert!(graph.failure.is_none());
            assert_eq!(result.bounds[kept], expected, "{escape:?}");
            assert_eq!(result.bounds[escaping], expected, "{escape:?}");
            assert_eq!(result.witnesses[kept], result.witnesses[escaping]);
        }
    }

    /// A runtime root reaches through elements and fields, and through a
    /// weak class to every member; the bound stays the program's own, and an
    /// object nothing reaches stays free of the obligation.
    #[test]
    fn a_runtime_root_holds_what_it_reaches_and_nothing_else() {
        let contexts = [Context {
            parent: None,
            ancestors: &[],
            key: "entry",
            fallback: false,
        }];
        let mut graph = Graph::new(10_000, 1_000);
        graph.alias_limit = 1;
        let (array_value, array) = object(&mut graph, 0, 0);
        let (element_value, element) = object(&mut graph, 0, 1);
        let (child_value, child) = object(&mut graph, 0, 2);
        let (member_value, member) = object(&mut graph, 0, 3);
        let (_, free) = object(&mut graph, 0, 4);
        graph.store(array_value, Slot::Elements, element_value);
        graph.store(element_value, Slot::Field("child".to_owned()), child_value);
        let either = graph.node();
        graph.copy(child_value, either);
        graph.copy(member_value, either);
        graph.solve();
        assert!(graph.is_widened(member) && graph.is_widened(child));
        let result = analyze(&mut graph, &contexts, &[(array_value, Exposure::Collector)]);
        assert!(graph.failure.is_none());
        for held in [array, element, child, member] {
            assert!(result.runtime_held[held], "object {held}");
            assert_eq!(result.bounds[held], Bound::Frame(0), "object {held}");
        }
        assert!(!result.runtime_held[free]);
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
