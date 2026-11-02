//! Bounded parametric leaf summaries preserve relationships between actuals.
//! In particular a constructor's receiver and stored arguments are substituted
//! together; merging each formal independently invents a Cartesian product.

use std::collections::BTreeMap;

use super::super::contents::{Tags, Unknown, ValueFact};
use super::super::{Func, HirType, OpKind, Terminator, ValueId};
use super::graph::{Graph, Node, Slot};

#[derive(Debug, Clone)]
pub(super) enum Step {
    Parameter(u32),
    Copy(ValueId),
    Payload(ValueFact),
    Load {
        base: ValueId,
        slot: Slot,
    },
    Store {
        base: ValueId,
        slot: Slot,
        value: ValueId,
    },
}

#[derive(Debug, Clone, Default)]
pub(super) struct Summary {
    pub steps: Vec<(ValueId, Step)>,
    pub returned: Option<ValueId>,
    pub stores: Vec<String>,
    pub result: Vec<String>,
    pub writes: Vec<String>,
    pub parameters: Vec<u32>,
}

impl Summary {
    pub(super) fn of(
        function: &Func,
        field: impl Fn(&HirType, u32) -> Option<Slot>,
    ) -> Option<Self> {
        // Substitution must stay bounded per call rather than inline an
        // arbitrarily large body at each call site. Other bodies use the
        // bounded context/SCC graph, including its weak-union widening.
        if function.abstract_declaration
            || function.blocks.len() != 1
            || function.blocks[0].ops.len() > 32
            || !function.blocks[0].params.is_empty()
        {
            return None;
        }
        let Terminator::Return(returned) = function.blocks[0].terminator else {
            return None;
        };
        let mut names = BTreeMap::new();
        let known = |tags| ValueFact::Known {
            tags,
            numbers: super::super::facts::Facts::BOTTOM,
        };
        let mut summary = Self {
            returned,
            ..Self::default()
        };
        for &id in &function.blocks[0].ops {
            let op = function.value(id);
            let name = |value: ValueId| names.get(&value).cloned();
            let step = match &op.kind {
                OpKind::Param(slot) => {
                    summary.parameters.push(*slot);
                    names.insert(id, format!("parameter {slot}"));
                    Step::Parameter(*slot)
                }
                OpKind::Erase { value, .. }
                | OpKind::Unerase { value, .. }
                | OpKind::FieldView { value, .. }
                | OpKind::OptionalPayload(value) => {
                    names.insert(id, name(*value)?);
                    Step::Copy(*value)
                }
                OpKind::Convert(value)
                    if op.ty.may_hold_a_reference()
                        && function.value(*value).ty.may_hold_a_reference() =>
                {
                    names.insert(id, name(*value)?);
                    Step::Copy(*value)
                }
                OpKind::FieldGet {
                    object,
                    field: index,
                } => {
                    let slot = field(&function.value(*object).ty, *index)?;
                    names.insert(id, format!("{}.{slot:?}", name(*object)?));
                    Step::Load {
                        base: *object,
                        slot,
                    }
                }
                OpKind::FieldSet {
                    object,
                    field: index,
                    value,
                } => {
                    let slot = field(&function.value(*object).ty, *index)?;
                    summary.stores.push(format!(
                        "{}.{slot:?} <- {}",
                        name(*object)?,
                        name(*value)?
                    ));
                    summary.writes.push(format!("{slot:?}"));
                    Step::Store {
                        base: *object,
                        slot,
                        value: *value,
                    }
                }
                OpKind::ConstNull => Step::Payload(known(Tags::NULL)),
                OpKind::ConstUndefined => Step::Payload(ValueFact::undefined()),
                OpKind::ConstBool(_) => Step::Payload(known(Tags::BOOLEAN)),
                OpKind::Convert(value)
                    if !op.ty.may_hold_a_reference()
                        && !function.value(*value).ty.may_hold_a_reference() =>
                {
                    Step::Payload(ValueFact::Unknown(Unknown::NotAnalysed))
                }
                OpKind::ConstInt(_) | OpKind::ConstFloat(_) if !op.ty.may_hold_a_reference() => {
                    Step::Payload(ValueFact::Unknown(Unknown::NotAnalysed))
                }
                _ => return None,
            };
            names.entry(id).or_insert_with(|| format!("%{}", id.0));
            summary.steps.push((id, step));
        }
        if let Some(value) = returned {
            summary.result.push(names.get(&value)?.clone());
        }
        summary.writes.sort();
        summary.writes.dedup();
        Some(summary)
    }

    pub(super) fn instantiate(&self, graph: &mut Graph, args: &[Node], into: Node) {
        let mut values = BTreeMap::new();
        for (value, step) in &self.steps {
            graph.charge();
            let node = match step {
                Step::Parameter(slot) => args[*slot as usize],
                Step::Copy(value) => values[value],
                Step::Payload(payload) => {
                    let node = graph.node();
                    graph.payload(node, *payload);
                    node
                }
                Step::Load { base, slot } => {
                    let node = graph.node();
                    graph.load(values[base], slot.clone(), node);
                    node
                }
                Step::Store { base, slot, value } => {
                    graph.store(values[base], slot.clone(), values[value]);
                    graph.node()
                }
            };
            values.insert(*value, node);
        }
        if let Some(value) = self.returned {
            graph.copy(values[&value], into);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::memory::graph::{Instance, ObjectInfo};

    #[test]
    fn store_summary_substitutes_correlated_actuals_together() {
        let mut graph = Graph::new(10_000, 1_000);
        let mut values = Vec::new();
        for at in 0..4 {
            let node = graph.node();
            let object = graph.object(
                ObjectInfo {
                    label: format!("object-{at}"),
                    site: None,
                    context: 0,
                    instance: Instance::Recent,
                    open: false,
                },
                node,
            );
            values.push((node, object));
        }
        let slot = Slot::Elements;
        let summary = Summary {
            steps: vec![
                (ValueId(0), Step::Parameter(0)),
                (ValueId(1), Step::Parameter(1)),
                (
                    ValueId(2),
                    Step::Store {
                        base: ValueId(0),
                        slot: slot.clone(),
                        value: ValueId(1),
                    },
                ),
            ],
            returned: Some(ValueId(0)),
            stores: Vec::new(),
            result: Vec::new(),
            writes: Vec::new(),
            parameters: vec![0, 1],
        };
        for pair in values.as_chunks::<2>().0 {
            let into = graph.node();
            summary.instantiate(&mut graph, &[pair[0].0, pair[1].0], into);
        }
        let first = graph.node();
        let second = graph.node();
        graph.load(values[0].0, slot.clone(), first);
        graph.load(values[2].0, slot, second);
        graph.solve();
        assert_eq!(
            graph.values[first].objects,
            std::collections::BTreeSet::from([values[1].1])
        );
        assert_eq!(
            graph.values[second].objects,
            std::collections::BTreeSet::from([values[3].1])
        );
    }
}
