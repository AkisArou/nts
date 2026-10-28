//! Clang identities for the C helper effect guard.

use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(super) struct Graph {
    pub(super) edges: BTreeMap<String, BTreeSet<String>>,
    pub(super) indirect: BTreeSet<(String, String)>,
}

struct Call {
    owner: String,
    depth: usize,
    child: Option<usize>,
    complete: bool,
    target: Option<String>,
    direct: bool,
}

impl Call {
    fn observe(&mut self, depth: usize, node: &str) {
        let child = *self.child.get_or_insert(depth);
        if depth == child && self.target.is_some() {
            self.complete = true;
        }
        if self.complete || self.target.is_some() {
            return;
        }
        if node.starts_with("DeclRefExpr ") {
            self.direct = node.contains(" Function ");
            self.target = node.split('\'').nth(3).map(str::to_owned);
        } else if node.starts_with("MemberExpr ") {
            self.target = node.split_whitespace().rev().nth(1).map(|member| {
                member
                    .trim_start_matches("->")
                    .trim_start_matches('.')
                    .into()
            });
        } else if ![
            "ImplicitCastExpr ",
            "CStyleCastExpr ",
            "ParenExpr ",
            "ArraySubscriptExpr ",
        ]
        .iter()
        .any(|kind| node.starts_with(kind))
        {
            self.target = Some(format!(
                "unclassified {}",
                node.split_whitespace().next().unwrap_or("node")
            ));
        }
    }

    fn finish(self, graph: &mut Graph) {
        if !self.direct {
            graph.indirect.insert((
                self.owner,
                self.target.unwrap_or_else(|| "missing callee".into()),
            ));
        }
    }
}

impl Graph {
    /// Address-taking also contributes a direct edge. This overapproximates
    /// direct calls, and keeps callbacks' references in the same closure.
    pub(super) fn of(ast: &str) -> Self {
        let mut graph = Self::default();
        let mut owner = None;
        let mut calls = Vec::<Call>::new();
        for line in ast.lines() {
            let Some(depth) = line.find(|c: char| c.is_ascii_alphabetic()) else {
                continue;
            };
            let node = &line[depth..];
            while calls.last().is_some_and(|call| depth <= call.depth) {
                calls
                    .pop()
                    .expect("call being completed")
                    .finish(&mut graph);
            }
            if depth == 2 {
                owner = node
                    .starts_with("FunctionDecl ")
                    .then(|| {
                        node.split(" '")
                            .next()
                            .and_then(|line| line.split_whitespace().last())
                            .map(str::to_owned)
                    })
                    .flatten();
            }
            if let Some(call) = calls.last_mut() {
                call.observe(depth, node);
            }
            let Some(name) = &owner else { continue };
            if node.starts_with("DeclRefExpr ")
                && let Some((_, reference)) = node.split_once(" Function ")
                && let Some(callee) = reference.split('\'').nth(1)
            {
                graph
                    .edges
                    .entry(name.clone())
                    .or_default()
                    .insert(callee.into());
            }
            if node.starts_with("CallExpr ") {
                calls.push(Call {
                    owner: name.clone(),
                    depth,
                    child: None,
                    complete: false,
                    target: None,
                    direct: false,
                });
            }
        }
        for call in calls {
            call.finish(&mut graph);
        }
        graph
    }

    /// One reverse closure, rather than walking the whole graph per helper.
    pub(super) fn reaching<'a>(
        &self,
        roots: impl IntoIterator<Item = &'a str>,
    ) -> BTreeSet<String> {
        let mut reverse = BTreeMap::<&str, Vec<&str>>::new();
        for (caller, callees) in &self.edges {
            for callee in callees {
                reverse.entry(callee).or_default().push(caller);
            }
        }
        let mut seen = BTreeSet::new();
        let mut pending: Vec<_> = roots.into_iter().collect();
        while let Some(name) = pending.pop() {
            if seen.insert(name.to_owned())
                && let Some(callers) = reverse.get(name)
            {
                pending.extend(callers.iter().copied());
            }
        }
        seen
    }
}
