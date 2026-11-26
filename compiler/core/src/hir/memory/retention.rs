//! What holds each allocation, and how its retention frontier was reached.
//! Read from the solved graph and the lifetime proofs; nothing here changes a
//! bound, a home or an obligation.

use std::collections::BTreeSet;

use super::Reason;
use super::graph::{Graph, Node, Object};
use super::lifetime::{self, Exposure, Step};
use super::report::{Edge, Hold, Holder, Reached, Root};

pub(super) struct Facts {
    /// Indexed by representative object.
    holders: Vec<BTreeSet<Hold>>,
    /// Indexed by proof: where the chain of proofs ending there starts.
    roots: Vec<Root>,
}

/// `holder` names a representative object; `context` a lifetime context key.
/// Holders are one pass over the slots, roots one pass over the proofs, whose
/// causes always precede them: both are linear in what the report already
/// charged for detaching.
pub(super) fn of(
    graph: &Graph,
    lifetimes: &lifetime::Result,
    roots: &[(Node, Exposure)],
    context: &dyn Fn(usize) -> String,
    holder: &dyn Fn(Object) -> Holder,
) -> Facts {
    let mut holders = vec![BTreeSet::new(); graph.objects.len()];
    for ((parent, slot), node) in &graph.slots {
        let hold = Hold {
            slot: format!("{slot:?}"),
            holder: holder(graph.representative(*parent)),
        };
        for child in &graph.values[*node].objects {
            holders[graph.representative(*child)].insert(hold.clone());
        }
    }
    let mut origins: Vec<Root> = Vec::with_capacity(lifetimes.proofs.len());
    for (id, step) in lifetimes.steps.iter().enumerate() {
        let root = match step {
            Step::Scope(object) => Root::Scope(holder(graph.representative(*object))),
            Step::Joined(class) => Root::Joined(holder(*class)),
            Step::Exposure(at) => match &roots[*at].1 {
                Exposure::Returned(from) => Root::Returned {
                    context: context(*from),
                },
                Exposure::Outside(label) => Root::Outside(label.clone()),
                // Runtime roots raise no bound (`lifetime::runtime_held`).
                Exposure::Collector => Root::Unknown(Reason::RuntimeRootContract),
                Exposure::Unknown(reason) => Root::Unknown(reason.clone()),
            },
            Step::Stored { .. } => lifetimes.proofs[id]
                .causes
                .last()
                .filter(|cause| **cause < id)
                .map_or(
                    Root::Unknown(Reason::MissingOutcome("unlinked proof".to_owned())),
                    |cause| origins[*cause].clone(),
                ),
        };
        origins.push(root);
    }
    Facts {
        holders,
        roots: origins,
    }
}

/// The slot a weak class member names: its class holds it, and the class's
/// own holders are published once (`Facts::class_holders`), never copied into
/// every member, which would be quadratic in a large class.
pub(super) const MEMBER: &str = "member";

impl Facts {
    /// Every slot that can hold any of `objects` (a site's instances).
    pub(super) fn holders(&self, graph: &Graph, objects: &[Object]) -> Vec<Hold> {
        let mut holds = BTreeSet::new();
        for object in objects {
            let class = graph.representative(*object);
            if graph.is_widened(class) {
                holds.insert(Hold {
                    slot: MEMBER.to_owned(),
                    holder: Holder::Class(graph.label(class)),
                });
            } else {
                holds.extend(self.holders[class].iter().cloned());
            }
        }
        holds.into_iter().collect()
    }

    /// Each weak class's holders, by its label, in object order.
    pub(super) fn class_holders(&self, graph: &Graph) -> Vec<(String, Vec<Hold>)> {
        (0..graph.objects.len())
            .filter(|object| graph.representative(*object) == *object && graph.is_widened(*object))
            .map(|class| {
                (
                    graph.label(class),
                    self.holders[class].iter().cloned().collect(),
                )
            })
            .collect()
    }

    pub(super) fn reached(
        &self,
        graph: &Graph,
        lifetimes: &lifetime::Result,
        object: Object,
        holder: &dyn Fn(Object) -> Holder,
    ) -> Reached {
        let witness = lifetimes.witnesses[object];
        let edge = match &lifetimes.steps[witness] {
            Step::Scope(_) => Edge::Scope,
            Step::Exposure(_) => Edge::Exposure,
            Step::Joined(_) => Edge::Joined,
            Step::Stored { parent, slot } => Edge::Stored(Hold {
                slot: format!("{slot:?}"),
                holder: holder(graph.representative(*parent)),
            }),
        };
        Reached {
            edge,
            root: self.roots[witness].clone(),
        }
    }
}
