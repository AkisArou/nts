//! Sparse inclusion solver. Events carry one new object, or a changed payload;
//! loads/stores materialize only the slots they actually touch. No all-pairs
//! closure and no iteration over hash tables determines a published answer.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::super::contents::{Tags, Unknown, ValueFact};
use super::Reason;

pub(super) type Node = usize;
pub(super) type Object = usize;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Slot {
    Field(String),
    Elements,
    Keys,
    Values,
    Backing,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hir::{contents::Tags, facts::Facts};

    fn allocated(graph: &mut Graph, label: &str) -> (Node, Object) {
        let node = graph.node();
        let object = graph.object(
            ObjectInfo {
                label: label.to_owned(),
                site: None,
                context: 0,
                instance: Instance::Recent,
                open: false,
            },
            node,
        );
        (node, object)
    }

    #[test]
    fn inclusions_do_not_unify_their_sources() {
        let mut graph = Graph::new(10_000, 1_000);
        let (left, a) = allocated(&mut graph, "left");
        let (right, b) = allocated(&mut graph, "right");
        let join = graph.node();
        graph.copy(left, join);
        graph.copy(right, join);
        graph.solve();
        assert_eq!(graph.values[left].objects, BTreeSet::from([a]));
        assert_eq!(graph.values[right].objects, BTreeSet::from([b]));
        assert_eq!(graph.values[join].objects, BTreeSet::from([a, b]));
    }

    #[test]
    fn loads_discover_late_stores_and_an_unseen_writer_poisons_old_facts() {
        let mut graph = Graph::new(10_000, 1_000);
        let (owner, _) = allocated(&mut graph, "owner");
        let scalar = graph.node();
        graph.payload(scalar, ValueFact::number(Facts::constant(3.0)));
        let read = graph.node();
        graph.load(owner, Slot::Values, read);
        graph.store(owner, Slot::Values, scalar);
        graph.solve();
        assert!(
            graph.values[read]
                .payload
                .is_some_and(|fact| fact.has_only(Tags::NUMBER))
        );
        graph.open(owner);
        graph.solve();
        assert_eq!(
            graph.values[read].payload,
            Some(ValueFact::Unknown(Unknown::OpenWriterSet))
        );
    }

    #[test]
    fn recent_and_older_slots_are_both_visible_without_strong_updates() {
        let mut graph = Graph::new(10_000, 1_000);
        let (recent, a) = allocated(&mut graph, "recent");
        let (older, b) = allocated(&mut graph, "older");
        graph.join_instances(a, b);
        let (old_value, old_object) = allocated(&mut graph, "old-value");
        let (new_value, new_object) = allocated(&mut graph, "new-value");
        graph.store(older, Slot::Elements, old_value);
        graph.store(recent, Slot::Elements, new_value);
        let read = graph.node();
        graph.load(recent, Slot::Elements, read);
        graph.solve();
        assert_eq!(
            graph.values[read].objects,
            BTreeSet::from([old_object, new_object])
        );
    }

    #[test]
    fn widening_preserves_old_loads_future_stores_and_every_origin() {
        let mut graph = Graph::new(100_000, 10_000);
        graph.alias_limit = 2;
        let owners: Vec<_> = (0..3)
            .map(|at| allocated(&mut graph, &format!("owner-{at}")))
            .collect();
        let (first, a) = allocated(&mut graph, "first");
        let (last, b) = allocated(&mut graph, "last");
        let read = graph.node();
        graph.store(owners[0].0, Slot::Elements, first);
        graph.load(owners[0].0, Slot::Elements, read);
        graph.solve();
        let merged = graph.node();
        for &(value, _) in &owners {
            graph.copy(value, merged);
        }
        graph.solve();
        graph.store(owners[2].0, Slot::Elements, last);
        graph.solve();
        assert!(graph.failure.is_none());
        let class = graph.representative(owners[0].1);
        assert!(
            owners
                .iter()
                .all(|(_, object)| graph.representative(*object) == class)
        );
        assert_eq!(graph.values[read].objects, BTreeSet::from([a, b]));
        assert_eq!(graph.members[class].len(), 3);
        graph.open(owners[1].0);
        graph.solve();
        assert_eq!(
            graph.values[read].payload,
            Some(ValueFact::Unknown(Unknown::OpenWriterSet))
        );
    }

    #[test]
    fn dense_weak_field_unions_have_bounded_sets_and_linear_work() {
        for n in [16, 32, 64] {
            let mut graph = Graph::new(1_000_000, 100_000);
            let owners = graph.node();
            let children = graph.node();
            for at in 0..n {
                let (owner, _) = allocated(&mut graph, &format!("owner-{at}"));
                let (child, _) = allocated(&mut graph, &format!("child-{at}"));
                graph.copy(owner, owners);
                graph.copy(child, children);
            }
            graph.store(owners, Slot::Elements, children);
            let read = graph.node();
            graph.load(owners, Slot::Elements, read);
            graph.solve();
            assert!(graph.failure.is_none(), "n={n}: {:?}", graph.failure);
            assert!(
                graph
                    .values
                    .iter()
                    .all(|value| value.objects.len() <= graph.alias_limit)
            );
            assert!(graph.work <= 160 * n, "n={n}: {} work", graph.work);
            assert!(
                graph
                    .classes()
                    .iter()
                    .map(|(_, members)| members.len())
                    .sum::<usize>()
                    >= 2 * n - 14
            );
        }
    }

    #[test]
    fn cyclic_stores_cannot_reenter_a_class_migration() {
        let mut graph = Graph::new(100_000, 10_000);
        graph.alias_limit = 2;
        let values: Vec<_> = (0..16)
            .map(|at| allocated(&mut graph, &format!("cyclic-{at}")))
            .collect();
        for at in 0..values.len() {
            graph.store(
                values[at].0,
                Slot::Elements,
                values[(at + 1) % values.len()].0,
            );
            graph.store(
                values[at].0,
                Slot::Elements,
                values[(at + 3) % values.len()].0,
            );
        }
        graph.solve();
        let joined = graph.node();
        for &(value, _) in &values {
            graph.copy(value, joined);
        }
        graph.solve();
        assert!(graph.failure.is_none());
        assert!(
            graph
                .slots
                .keys()
                .all(|(owner, _)| graph.representative(*owner) == *owner)
        );
        for (node, value) in graph.values.iter().enumerate() {
            assert!(value.objects.len() <= graph.alias_limit);
            assert!(
                value
                    .objects
                    .iter()
                    .all(|object| graph.representative(*object) == *object
                        && graph.users[*object].contains(&node))
            );
        }
    }

    #[test]
    fn distributed_cycles_widen_once_and_never_refill_precise_sets() {
        for n in [16, 32, 64] {
            let mut graph = Graph::new(100_000, 10_000);
            let nodes: Vec<_> = (0..n)
                .map(|at| allocated(&mut graph, &format!("cycle-{at}")).0)
                .collect();
            for at in 0..n {
                graph.copy(nodes[at], nodes[(at + 1) % n]);
            }
            graph.solve();
            assert!(graph.failure.is_none());
            assert!(
                graph
                    .values
                    .iter()
                    .all(|value| value.changes <= graph.alias_limit + 1)
            );
            assert!(
                graph
                    .values
                    .iter()
                    .all(|value| value.weak.is_some() && value.objects.len() == 1)
            );
            assert!(graph.work <= 120 * n, "n={n}: {} work", graph.work);
            let maximum = graph
                .values
                .iter()
                .map(|value| value.changes)
                .max()
                .unwrap_or(0);
            for (at, node) in nodes.iter().copied().enumerate() {
                let (new_value, _) = allocated(&mut graph, &format!("later-{at}"));
                graph.copy(new_value, node);
            }
            graph.solve();
            assert!(graph.failure.is_none());
            assert_eq!(
                graph
                    .values
                    .iter()
                    .map(|value| value.changes)
                    .max()
                    .unwrap_or(0),
                maximum
            );
            assert!(graph.work <= 200 * n, "n={n}: {} work", graph.work);
        }
    }

    #[test]
    fn numeric_cycles_widen_without_losing_their_tags() {
        for n in [16, 32, 64] {
            let mut graph = Graph::new(100_000, 10_000);
            let nodes: Vec<_> = (0..n)
                .map(|at| {
                    let node = graph.node();
                    graph.payload(node, ValueFact::number(Facts::constant(f64::from(at))));
                    node
                })
                .collect();
            for (at, &node) in nodes.iter().enumerate() {
                graph.copy(node, nodes[(at + 1) % nodes.len()]);
            }
            graph.solve();
            assert!(graph.failure.is_none());
            assert!(graph.values.iter().all(|value| {
                value
                    .payload
                    .is_some_and(|fact| fact.has_only(Tags::NUMBER))
            }));
            assert!(
                graph
                    .values
                    .iter()
                    .all(|value| value.payload_changes <= graph.alias_limit + 4)
            );
            assert!(
                graph.work <= 100 * nodes.len(),
                "n={n}: {} work",
                graph.work
            );
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Instance {
    Recent,
    Summary,
}

#[derive(Debug, Clone)]
pub(super) struct ObjectInfo {
    pub label: String,
    pub site: Option<usize>,
    pub context: usize,
    pub instance: Instance,
    pub open: bool,
}

#[derive(Debug, Clone, Default)]
pub(super) struct Value {
    pub objects: BTreeSet<Object>,
    pub payload: Option<ValueFact>,
    pub changes: usize,
    weak: Option<Object>,
    payload_changes: usize,
}

#[derive(Debug, Clone)]
enum Watch {
    Load { slot: Slot, into: Node },
    Store { slot: Slot, from: Node },
}

#[derive(Debug, Clone, Copy)]
enum Event {
    Object(Node, Object),
    Payload(Node),
    Open(Object),
}

#[derive(Debug)]
pub(super) struct Graph {
    pub values: Vec<Value>,
    pub objects: Vec<ObjectInfo>,
    twins: Vec<Option<Object>>,
    parents: Vec<Object>,
    members: Vec<Vec<Object>>,
    users: Vec<BTreeSet<Node>>,
    seen: Vec<BTreeSet<Object>>,
    merging: bool,
    unions: Vec<(Object, Object)>,
    pub slots: BTreeMap<(Object, Slot), Node>,
    copies: Vec<BTreeSet<Node>>,
    watches: Vec<Vec<Watch>>,
    opened: Vec<bool>,
    payload_queued: Vec<bool>,
    pending: VecDeque<Event>,
    pub work: usize,
    pub work_limit: usize,
    pub edges: usize,
    pub edge_limit: usize,
    pub failure: Option<Reason>,
    pub alias_limit: usize,
}

impl Graph {
    pub(super) fn new(work_limit: usize, edge_limit: usize) -> Self {
        Self {
            values: Vec::new(),
            objects: vec![ObjectInfo {
                label: "outside:any-reference".to_owned(),
                site: None,
                context: 0,
                instance: Instance::Summary,
                open: true,
            }],
            twins: vec![None],
            parents: vec![0],
            members: vec![vec![0]],
            users: vec![BTreeSet::new()],
            seen: Vec::new(),
            merging: false,
            unions: Vec::new(),
            slots: BTreeMap::new(),
            copies: Vec::new(),
            watches: Vec::new(),
            opened: Vec::new(),
            payload_queued: Vec::new(),
            pending: VecDeque::new(),
            work: 0,
            work_limit,
            edges: 0,
            edge_limit,
            failure: None,
            alias_limit: 8,
        }
    }

    pub(super) fn charge(&mut self) -> bool {
        if self.failure.is_some() {
            return false;
        }
        if self.work >= self.work_limit {
            self.failure = Some(Reason::WorkBudget);
            return false;
        }
        self.work += 1;
        true
    }

    pub(super) fn node(&mut self) -> Node {
        let id = self.values.len();
        self.values.push(Value::default());
        self.copies.push(BTreeSet::new());
        self.watches.push(Vec::new());
        self.opened.push(false);
        self.payload_queued.push(false);
        self.seen.push(BTreeSet::new());
        id
    }

    pub(super) fn object(&mut self, info: ObjectInfo, value: Node) -> Object {
        let id = self.objects.len();
        self.objects.push(info);
        self.twins.push(None);
        self.parents.push(id);
        self.members.push(vec![id]);
        self.users.push(BTreeSet::new());
        self.insert(value, id);
        id
    }

    pub(super) fn insert(&mut self, value: Node, object: Object) {
        let object = self.representative(object);
        if !self.charge() {
            return;
        }
        if let Some(class) = self.values[value].weak {
            self.unify(class, object);
            return;
        }
        if self.values[value].objects.contains(&object) {
            return;
        }
        let weak =
            self.is_widened(object) || self.values[value].objects.len() >= self.alias_limit.max(1);
        self.values[value].objects.insert(object);
        if self.opened[value] {
            self.pending.push_back(Event::Open(object));
        }
        if weak {
            self.users[object].insert(value);
            self.pending.push_back(Event::Object(value, object));
            self.make_weak(value, object);
            self.unify(object, object);
        } else {
            self.changed(value);
            self.users[object].insert(value);
            self.pending.push_back(Event::Object(value, object));
        }
    }

    fn changed(&mut self, value: Node) {
        self.values[value].changes += 1;
        debug_assert!(
            self.values[value].changes <= self.alias_limit.max(1).saturating_add(1),
            "points-to node {value} changed {} times at limit {}",
            self.values[value].changes,
            self.alias_limit
        );
    }

    /// Weak is terminal. A canonical-ID migration is bookkeeping in this same
    /// state, charged separately by union migration; it never refills a precise
    /// set. Class membership retains provenance, not another node-state axis.
    fn make_weak(&mut self, value: Node, class: Object) {
        if let Some(previous) = self.values[value].weak {
            self.unions.push((previous, class));
        } else {
            self.values[value].weak = Some(class);
            self.changed(value);
        }
        for &other in &self.values[value].objects {
            if other != class {
                self.unions.push((class, other));
            }
        }
    }

    fn migrate_users(&mut self, from: Object, into: Object) -> bool {
        for value in std::mem::take(&mut self.users[from]) {
            if !self.charge() {
                return false;
            }
            self.values[value].objects.remove(&from);
            self.values[value].objects.insert(into);
            self.users[into].insert(value);
            if self.seen[value].remove(&from) {
                self.seen[value].insert(into);
            }
            if self.opened[value] {
                self.objects[into].open = true;
            }
            self.make_weak(value, into);
        }
        true
    }

    pub(super) fn representative(&self, mut object: Object) -> Object {
        while self.parents[object] != object {
            object = self.parents[object];
        }
        object
    }

    pub(super) fn is_widened(&self, object: Object) -> bool {
        self.members[self.representative(object)].len() > 1
    }

    pub(super) fn label(&self, object: Object) -> String {
        let object = self.representative(object);
        if self.is_widened(object) {
            format!("weak-alias-class {object}")
        } else {
            self.objects[object].label.clone()
        }
    }

    pub(super) fn classes(&self) -> Vec<(String, Vec<String>)> {
        self.members
            .iter()
            .enumerate()
            .filter(|(_, members)| members.len() > 1)
            .map(|(object, members)| {
                let mut names: Vec<_> = members
                    .iter()
                    .map(|member| self.objects[*member].label.clone())
                    .collect();
                names.sort();
                (self.label(object), names)
            })
            .collect()
    }

    /// Widen an oversized may-alias set, never SSA equality. Union by member
    /// count bounds migrations; existing/future fields and users share the
    /// same weak class. Member sites remain individually inventoried and lose
    /// singleton/lifetime permissions. No allocation origin is discarded.
    fn unify(&mut self, left: Object, right: Object) {
        self.unions.push((left, right));
        if self.merging {
            return;
        }
        self.merging = true;
        self.merge_pending();
        self.merging = false;
    }

    // A migrated field may itself overflow a weak set. Queue that union until
    // this migration finishes: reentering it would invalidate its current root.
    fn merge_pending(&mut self) {
        while let Some((left, right)) = self.unions.pop() {
            let mut into = self.representative(left);
            let mut from = self.representative(right);
            if into == from || !self.charge() {
                continue;
            }
            if (self.members[into].len(), std::cmp::Reverse(into))
                < (self.members[from].len(), std::cmp::Reverse(from))
            {
                std::mem::swap(&mut into, &mut from);
            }
            let first_users: Vec<_> = if self.members[into].len() == 1 {
                self.users[into].iter().copied().collect()
            } else {
                Vec::new()
            };
            if self.members[into].len() == 1
                && let Some(twin) = self.twins[into]
            {
                self.unions.push((into, twin));
            }
            self.parents[from] = into;
            let members = std::mem::take(&mut self.members[from]);
            for member in members {
                if !self.charge() {
                    return;
                }
                if let Some(twin) = self.twins[member] {
                    self.unions.push((into, twin));
                }
                self.members[into].push(member);
            }
            let previously_open = self.objects[into].open;
            self.objects[into].open |= self.objects[from].open;
            if !self.migrate_users(from, into) {
                return;
            }
            for value in first_users {
                if !self.charge() {
                    return;
                }
                self.make_weak(value, into);
            }
            let slots: Vec<_> = self
                .slots
                .range((from, Slot::Field(String::new()))..(from + 1, Slot::Field(String::new())))
                .map(|((_, slot), node)| (slot.clone(), *node))
                .collect();
            for (slot, node) in slots {
                if !self.charge() {
                    return;
                }
                self.slots.remove(&(from, slot.clone()));
                if let Some(other) = self.slots.get(&(into, slot.clone())).copied() {
                    self.copy(node, other);
                    self.copy(other, node);
                } else {
                    self.slots.insert((into, slot), node);
                }
                if previously_open {
                    self.open(node);
                    self.insert(node, 0);
                    self.payload(node, ValueFact::Unknown(Unknown::OpenWriterSet));
                }
            }
            if !previously_open && self.objects[into].open {
                // Force the open event to poison all slots after migration,
                // including slots newly inherited from a closed member.
                self.objects[into].open = false;
                self.pending.push_back(Event::Open(into));
            }
        }
    }

    pub(super) fn open(&mut self, value: Node) {
        if !self.charge() || self.opened[value] {
            return;
        }
        self.opened[value] = true;
        for &object in &self.values[value].objects {
            self.pending.push_back(Event::Open(object));
        }
    }

    /// An opaque writer can replace a module slot, as well as mutate objects
    /// already in it. This is distinct from changing an SSA reference itself.
    pub(super) fn replaceable(&mut self, value: Node) {
        self.open(value);
        self.insert(value, 0);
        self.payload(value, ValueFact::Unknown(Unknown::OpenWriterSet));
    }

    pub(super) fn payload(&mut self, value: Node, payload: ValueFact) {
        if !self.charge() {
            return;
        }
        let old = self.values[value].payload;
        let mut joined = old.map_or(payload, |old| old.join(payload));
        // Numeric hulls otherwise have input-sized height on a scalar cycle.
        // Widen numbers independently; retain tags and their presence facts.
        if self.values[value].payload_changes >= self.alias_limit.max(1)
            && let ValueFact::Known { tags, numbers } = &mut joined
            && tags.intersects(Tags::NUMBER)
        {
            *numbers = super::super::facts::Facts::TOP;
        }
        if old != Some(joined) {
            self.values[value].payload = Some(joined);
            self.values[value].payload_changes += 1;
            if !self.payload_queued[value] {
                self.payload_queued[value] = true;
                self.pending.push_back(Event::Payload(value));
            }
        }
    }

    fn edge(&mut self) -> bool {
        if !self.charge() {
            return false;
        }
        if self.edges >= self.edge_limit {
            self.failure = Some(Reason::EdgeBudget);
            return false;
        }
        self.edges += 1;
        true
    }

    pub(super) fn copy(&mut self, from: Node, into: Node) {
        if from == into || self.copies[from].contains(&into) || !self.edge() {
            return;
        }
        self.copies[from].insert(into);
        let objects: Vec<_> = self.values[from].objects.iter().copied().collect();
        for object in objects {
            self.insert(into, object);
        }
        if let Some(payload) = self.values[from].payload {
            self.payload(into, payload);
        }
    }

    pub(super) fn load(&mut self, base: Node, slot: Slot, into: Node) {
        self.watch(base, &Watch::Load { slot, into });
    }

    pub(super) fn store(&mut self, base: Node, slot: Slot, from: Node) {
        self.watch(base, &Watch::Store { slot, from });
    }

    fn watch(&mut self, base: Node, watch: &Watch) {
        if !self.edge() {
            return;
        }
        self.watches[base].push(watch.clone());
        let objects: Vec<_> = self.values[base].objects.iter().copied().collect();
        for object in objects {
            self.apply(object, watch);
        }
    }

    fn apply(&mut self, object: Object, watch: &Watch) {
        let object = self.representative(object);
        if !self.charge() {
            return;
        }
        let slot = match watch {
            Watch::Load { slot, .. } | Watch::Store { slot, .. } => slot,
        };
        let key = (object, slot.clone());
        let field = if let Some(field) = self.slots.get(&key) {
            *field
        } else {
            let field = self.node();
            self.slots.insert(key, field);
            if matches!(slot, Slot::Field(_)) {
                // Heap fields are weak summaries until a singleton memory
                // version proves initialization. A later store cannot erase
                // an earlier uninitialized read from that summary.
                self.payload(field, ValueFact::Unknown(Unknown::NotAnalysed));
            }
            if let Some(twin) = self.twins[object]
                .map(|twin| self.representative(twin))
                .filter(|twin| *twin != object)
            {
                let key = (twin, slot.clone());
                let other = if let Some(other) = self.slots.get(&key) {
                    *other
                } else {
                    let other = self.node();
                    self.slots.insert(key, other);
                    other
                };
                self.copy(field, other);
                self.copy(other, field);
            }
            if self.objects[object].open {
                // An outside object's unseen writers can return any value.
                self.insert(field, 0);
                self.payload(field, ValueFact::Unknown(Unknown::OpenWriterSet));
                self.open(field);
            }
            field
        };
        match *watch {
            Watch::Load { into, .. } => self.copy(field, into),
            Watch::Store { from, .. } => self.copy(from, field),
        }
    }

    pub(super) fn solve(&mut self) {
        while let Some(event) = self.pending.pop_front() {
            if !self.charge() {
                self.pending.clear();
                return;
            }
            match event {
                Event::Object(value, object) => {
                    let object = self.representative(object);
                    if !self.seen[value].insert(object) {
                        continue;
                    }
                    let copies: Vec<_> = self.copies[value].iter().copied().collect();
                    for into in copies {
                        self.insert(into, object);
                    }
                    for watch in self.watches[value].clone() {
                        self.apply(object, &watch);
                    }
                }
                Event::Payload(value) => {
                    self.payload_queued[value] = false;
                    if let Some(payload) = self.values[value].payload {
                        let copies: Vec<_> = self.copies[value].iter().copied().collect();
                        for into in copies {
                            self.payload(into, payload);
                        }
                    }
                }
                Event::Open(object) => {
                    let object = self.representative(object);
                    if self.objects[object].open {
                        continue;
                    }
                    self.objects[object].open = true;
                    let fields: Vec<_> = self
                        .slots
                        .range(
                            (object, Slot::Field(String::new()))
                                ..(object + 1, Slot::Field(String::new())),
                        )
                        .map(|(_, node)| *node)
                        .collect();
                    for field in fields {
                        self.open(field);
                        self.insert(field, 0);
                        self.payload(field, ValueFact::Unknown(Unknown::OpenWriterSet));
                    }
                }
            }
        }
    }

    /// A recent and an older abstract instance may share a weak field summary.
    /// This loses precision; it does not license a strong update or slot reuse.
    pub(super) fn join_instances(&mut self, recent: Object, older: Object) {
        // Called before constraints are built, so every later field creation
        // connects the pair in O(log slots), without rescanning other sites.
        debug_assert!(
            self.slots
                .range(
                    (recent, Slot::Field(String::new()))..(older + 1, Slot::Field(String::new()))
                )
                .next()
                .is_none()
        );
        self.twins[recent] = Some(older);
        self.twins[older] = Some(recent);
        if self.is_widened(recent) {
            self.unify(recent, older);
        }
    }
}
