//! Owned declaration locators across native checking sessions.
//!
//! These locate syntax, not an equivalent semantic world. Added roots can
//! merge declarations or select another overload at an unchanged use site.
//! Consumers must reclassify the final suppliers and requirements after lookup.
//! Paths have the same run-local role as `SourceFile::display_path`; a persistent
//! provider record must use its own rooted input identities, never these paths.

use camino::Utf8PathBuf;
use nts_diagnostics::{Digest, Span};
use serde::{Deserialize, Serialize};

use crate::{NodeId, NodeKind, SemanticSnapshot, SnapshotError};

/// Index into `SemanticSnapshot::declaration_sources`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct DeclarationSourceId(pub u32);

/// File content in one requested checked project. Imported files belong to
/// that project, not to a project guessed from their containing directory.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct DeclarationSource {
    pub project: Utf8PathBuf,
    pub path: Utf8PathBuf,
    pub digest: Digest,
    pub utf16_len: u32,
}

/// An interned declaration or use-site locator. `kind` is an nts syntax tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct DeclarationSite {
    pub source: DeclarationSourceId,
    pub span: Span,
    pub kind: u16,
}

/// An owned locator suitable for returning from an inspection callback. No
/// node, type, signature or symbol index from that session survives here.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct DeclarationIdentity {
    pub source: DeclarationSource,
    pub span: Span,
    pub kind: u16,
}

impl SemanticSnapshot {
    pub(crate) fn validate_declarations(&self) -> Result<(), SnapshotError> {
        let mut unique = std::collections::BTreeSet::new();
        for source in &self.declaration_sources {
            if source.project.as_str().is_empty()
                || source.path.as_str().is_empty()
                || !unique.insert(source)
            {
                return Err(SnapshotError::Project(
                    "invalid or duplicate declaration source context".into(),
                ));
            }
        }
        let check = |site: DeclarationSite| {
            let source = self
                .declaration_sources
                .get(site.source.0 as usize)
                .ok_or_else(|| {
                    SnapshotError::Project("declaration site has no source context".into())
                })?;
            if site.span.start > site.span.end
                || site.span.end > source.utf16_len
                || crate::syntax::name_of(site.kind).is_none()
            {
                return Err(SnapshotError::Project(
                    "invalid declaration site span or syntax kind".into(),
                ));
            }
            Ok(())
        };
        for (&id, &context) in &self.source_contexts {
            let source = self.sources.get(id.0 as usize).ok_or_else(|| {
                SnapshotError::Project("declaration context has no captured source".into())
            })?;
            let context = self
                .declaration_sources
                .get(context.0 as usize)
                .ok_or_else(|| {
                    SnapshotError::Project("captured source has no declaration context".into())
                })?;
            if context.path != source.display_path || context.digest != source.digest {
                return Err(SnapshotError::Project(
                    "captured source and declaration context disagree".into(),
                ));
            }
        }
        for symbol in &self.symbols {
            for &site in &symbol.declaration_sites {
                check(site)?;
            }
            for &node in &symbol.declarations {
                let site = self.node_site(node).ok_or_else(|| {
                    SnapshotError::Project(
                        "captured symbol declaration has no source identity".into(),
                    )
                })?;
                check(site)?;
                if !symbol.declaration_sites.contains(&site) {
                    return Err(SnapshotError::Project(
                        "captured symbol declaration and its owned site disagree".into(),
                    ));
                }
            }
        }
        for target in self.call_targets.values() {
            if let Some(site) = target.declaration {
                check(site)?;
            }
            if let Some(node) = target.callee {
                let site = self.node_site(node).ok_or_else(|| {
                    SnapshotError::Project("captured call target has no source identity".into())
                })?;
                check(site)?;
                if target.declaration != Some(site) {
                    return Err(SnapshotError::Project(
                        "captured call target and its selected declaration site disagree".into(),
                    ));
                }
            }
        }
        Ok(())
    }

    /// Materialize an owned identity for an interned site.
    #[must_use]
    pub fn declaration_identity(&self, site: DeclarationSite) -> Option<DeclarationIdentity> {
        Some(DeclarationIdentity {
            source: self
                .declaration_sources
                .get(site.source.0 as usize)?
                .clone(),
            span: site.span,
            kind: site.kind,
        })
    }

    /// The locator of captured syntax, using this snapshot's source context.
    #[must_use]
    pub fn node_identity(&self, node: NodeId) -> Option<DeclarationIdentity> {
        self.declaration_identity(self.node_site(node)?)
    }

    fn node_site(&self, node: NodeId) -> Option<DeclarationSite> {
        let node = self.nodes.get(node.0 as usize)?;
        let NodeKind::Syntax(kind) = node.kind else {
            return None;
        };
        if node.origin.generated.is_some() {
            return None;
        }
        Some(DeclarationSite {
            source: *self.source_contexts.get(&node.origin.location.file)?,
            span: node.origin.location.span,
            kind,
        })
    }

    /// Build once for rebinding an inspection's locators in this fresh capture.
    /// Lookup never reuses a node/type index from the inspection session.
    pub fn declaration_index(&self) -> Result<DeclarationIndex<'_>, SnapshotError> {
        let sources = self
            .declaration_sources
            .iter()
            .enumerate()
            .map(|(i, source)| {
                Ok((
                    source,
                    DeclarationSourceId(u32::try_from(i).map_err(|_| {
                        SnapshotError::Project(
                            "declaration source arena exceeds its index range".into(),
                        )
                    })?),
                ))
            })
            .collect::<Result<_, SnapshotError>>()?;
        let mut nodes = rustc_hash::FxHashMap::default();
        for (i, node) in self.nodes.iter().enumerate() {
            let NodeKind::Syntax(kind) = node.kind else {
                continue;
            };
            if node.origin.generated.is_some() {
                continue;
            }
            let Some(&source) = self.source_contexts.get(&node.origin.location.file) else {
                continue;
            };
            let site = DeclarationSite {
                source,
                span: node.origin.location.span,
                kind,
            };
            let id = NodeId(u32::try_from(i).map_err(|_| {
                SnapshotError::Project("node arena exceeds its index range".into())
            })?);
            // Preserve ambiguity so a lookup fails rather than choosing a node
            // based on traversal order.
            nodes
                .entry(site)
                .and_modify(|entry| *entry = None)
                .or_insert(Some(id));
        }
        Ok(DeclarationIndex { sources, nodes })
    }
}

/// A fresh snapshot's owned-node lookup, built once in linear time. It borrows
/// only owned snapshot data and contains no native checker view.
#[derive(Debug)]
pub struct DeclarationIndex<'a> {
    sources: rustc_hash::FxHashMap<&'a DeclarationSource, DeclarationSourceId>,
    nodes: rustc_hash::FxHashMap<DeclarationSite, Option<NodeId>>,
}

impl DeclarationIndex<'_> {
    /// Finding the same syntax does not prove its overload/suppliers unchanged.
    pub fn find(&self, identity: &DeclarationIdentity) -> Result<Option<NodeId>, SnapshotError> {
        let Some(&source) = self.sources.get(&identity.source) else {
            return Ok(None);
        };
        match self.nodes.get(&DeclarationSite {
            source,
            span: identity.span,
            kind: identity.kind,
        }) {
            Some(Some(node)) => Ok(Some(*node)),
            None => Ok(None),
            Some(None) => Err(SnapshotError::Project(format!(
                "ambiguous declaration locator in {} at {:?}",
                identity.source.path, identity.span
            ))),
        }
    }
}
