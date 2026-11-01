//! Runtime scope ancestry, constructed once from the immutable snapshot.

use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, VariableKind, syntax};

#[derive(Clone, Copy)]
struct Scope {
    module_level: bool,
    in_loop: bool,
}

#[derive(Clone, Copy, Default)]
struct Owner {
    scope: usize,
    lexical_declaration: bool,
}

pub(super) struct Index {
    owners: Vec<Owner>,
    scopes: Vec<Scope>,
}

impl Index {
    pub(super) fn new(snapshot: &SemanticSnapshot) -> Self {
        let mut children = vec![Vec::new(); snapshot.nodes.len()];
        let mut pending = Vec::new();
        for (id, node) in snapshot.nodes.iter().enumerate() {
            if let Some(parent) = node.parent {
                let Some(children) = children.get_mut(parent.0 as usize) else {
                    panic!("scope index: semantic node has an invalid parent");
                };
                children.push(id);
            } else {
                pending.push((id, 0, None));
            }
        }
        let mut index = Self {
            owners: vec![Owner::default(); snapshot.nodes.len()],
            scopes: vec![Scope {
                module_level: true,
                in_loop: false,
            }],
        };
        let mut next = 0;
        while next < pending.len() {
            let (id, owner, declaration_kind) = pending[next];
            next += 1;
            index.owners[id] = Owner {
                scope: owner,
                lexical_declaration: matches!(
                    declaration_kind,
                    Some(VariableKind::Let | VariableKind::Const)
                ),
            };
            let node = &snapshot.nodes[id];
            let parent = index.scopes[owner];
            let kind = match node.kind {
                NodeKind::Syntax(kind) => Some(kind),
                NodeKind::List => None,
            };
            let function = kind.is_some_and(function_boundary);
            let in_loop = kind.is_some_and(loop_boundary);
            let scope =
                if function || in_loop || matches!(kind, Some(syntax::SOURCE_FILE | syntax::BLOCK))
                {
                    let at = index.scopes.len();
                    index.scopes.push(Scope {
                        module_level: !function && parent.module_level,
                        in_loop: !function && (in_loop || parent.in_loop),
                    });
                    at
                } else {
                    owner
                };
            let declaration_kind = if kind == Some(syntax::VARIABLE_DECLARATION_LIST) {
                Some(VariableKind::from_flags(node.flags))
            } else if function {
                None
            } else {
                declaration_kind
            };
            pending.extend(
                children[id]
                    .iter()
                    .map(|child| (*child, scope, declaration_kind)),
            );
        }
        // A valid snapshot is a forest. Every parent is processed before its
        // children, so there is no depth limit or repeated ancestry search.
        // A malformed cycle cannot publish a partial scope classification.
        assert_eq!(
            next,
            snapshot.nodes.len(),
            "scope index: semantic parents contain a cycle"
        );
        index
    }

    pub(super) fn is_module_scope(&self, declaration: NodeId) -> bool {
        let owner = self.owners[declaration.0 as usize];
        let scope = self.scopes[owner.scope];
        scope.module_level && !(owner.lexical_declaration && scope.in_loop)
    }

    pub(super) fn is_within_a_function(&self, id: NodeId) -> bool {
        !self.scopes[self.owners[id.0 as usize].scope].module_level
    }
}

fn function_boundary(kind: u16) -> bool {
    matches!(
        kind,
        syntax::FUNCTION_DECLARATION
            | syntax::FUNCTION_EXPRESSION
            | syntax::ARROW_FUNCTION
            | syntax::METHOD_DECLARATION
            | syntax::CONSTRUCTOR
            | syntax::GET_ACCESSOR
            | syntax::SET_ACCESSOR
    )
}

fn loop_boundary(kind: u16) -> bool {
    matches!(
        kind,
        syntax::FOR_STATEMENT
            | syntax::FOR_IN_STATEMENT
            | syntax::FOR_OF_STATEMENT
            | syntax::WHILE_STATEMENT
            | syntax::DO_STATEMENT
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_diagnostics::{Location, SourceId, Span};
    use nts_semantic_schema::{DeclarationModifiers, NodeData, NodeRecord, Origin};

    fn add(snapshot: &mut SemanticSnapshot, kind: u16, parent: Option<NodeId>) -> NodeId {
        let id = NodeId(u32::try_from(snapshot.nodes.len()).expect("small test snapshot"));
        snapshot.nodes.push(NodeRecord {
            kind: NodeKind::Syntax(kind),
            parent,
            children: Vec::new(),
            symbol: None,
            flags: 0,
            origin: Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 0),
            }),
            modifiers: DeclarationModifiers::default(),
            native: None,
            data: NodeData::Flags { small: 0 },
            text: None,
        });
        id
    }

    fn binding(
        depth: usize,
        boundary: Option<u16>,
        kind: VariableKind,
    ) -> (SemanticSnapshot, NodeId) {
        let mut snapshot = SemanticSnapshot::default();
        let mut parent = add(&mut snapshot, syntax::SOURCE_FILE, None);
        for _ in 0..depth {
            parent = add(&mut snapshot, syntax::BLOCK, Some(parent));
        }
        if let Some(boundary) = boundary {
            parent = add(&mut snapshot, boundary, Some(parent));
            parent = add(&mut snapshot, syntax::BLOCK, Some(parent));
        }
        let list = add(
            &mut snapshot,
            syntax::VARIABLE_DECLARATION_LIST,
            Some(parent),
        );
        snapshot.nodes[list.0 as usize].flags = kind.node_flags();
        let declaration = add(&mut snapshot, syntax::VARIABLE_DECLARATION, Some(list));
        (snapshot, declaration)
    }

    #[test]
    fn deep_module_blocks_keep_the_module_owner_for_every_variable_kind() {
        for depth in [1, 63, 64, 65, 70, 4096] {
            for kind in [VariableKind::Var, VariableKind::Let, VariableKind::Const] {
                let (snapshot, declaration) = binding(depth, None, kind);
                let scopes = Index::new(&snapshot);
                assert!(
                    scopes.is_module_scope(declaration),
                    "depth {depth}, {kind:?}"
                );
                assert!(!scopes.is_within_a_function(declaration));
            }
        }
    }

    #[test]
    fn loop_bodies_keep_var_global_and_lexicals_per_iteration() {
        for boundary in [
            syntax::FOR_STATEMENT,
            syntax::FOR_IN_STATEMENT,
            syntax::FOR_OF_STATEMENT,
            syntax::WHILE_STATEMENT,
            syntax::DO_STATEMENT,
        ] {
            for kind in [VariableKind::Var, VariableKind::Let, VariableKind::Const] {
                let (snapshot, declaration) = binding(70, Some(boundary), kind);
                let scopes = Index::new(&snapshot);
                assert_eq!(
                    scopes.is_module_scope(declaration),
                    kind == VariableKind::Var
                );
                assert!(!scopes.is_within_a_function(declaration));
            }
        }
    }

    #[test]
    fn every_function_boundary_owns_its_deep_locals() {
        for boundary in [
            syntax::FUNCTION_DECLARATION,
            syntax::FUNCTION_EXPRESSION,
            syntax::ARROW_FUNCTION,
            syntax::METHOD_DECLARATION,
            syntax::CONSTRUCTOR,
            syntax::GET_ACCESSOR,
            syntax::SET_ACCESSOR,
        ] {
            let (mut snapshot, declaration) = binding(70, Some(boundary), VariableKind::Var);
            let scopes = Index::new(&snapshot);
            assert!(!scopes.is_module_scope(declaration));
            assert!(scopes.is_within_a_function(declaration));
            // Parent-first construction must not assume parent ids precede children.
            let len = u32::try_from(snapshot.nodes.len()).expect("small snapshot");
            snapshot.nodes.reverse();
            for node in &mut snapshot.nodes {
                node.parent = node.parent.map(|parent| NodeId(len - 1 - parent.0));
            }
            let scopes = Index::new(&snapshot);
            let declaration = NodeId(len - 1 - declaration.0);
            assert!(!scopes.is_module_scope(declaration));
            assert!(scopes.is_within_a_function(declaration));
        }
    }

    #[test]
    #[should_panic(expected = "scope index: semantic parents contain a cycle")]
    fn a_parent_cycle_cannot_publish_partial_facts() {
        let mut snapshot = SemanticSnapshot::default();
        let first = add(&mut snapshot, syntax::BLOCK, None);
        let second = add(&mut snapshot, syntax::BLOCK, Some(first));
        snapshot.nodes[first.0 as usize].parent = Some(second);
        Index::new(&snapshot);
    }
}
