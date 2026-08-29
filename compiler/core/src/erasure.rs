//! What a program actually does with an `any` or `unknown` value.
//!
//! `docs/any-unknown.md` specifies a whole-program representation planner and
//! argues for it with a table: 174 `unknown` parameters across thirteen
//! `node:*` modules, sorted by hand into *carried*, *examined* and *tested*.
//! Its own closing caveat is that the table "is one person's reading of one
//! program", and that "when this is built, the compiler should produce that
//! table itself".
//!
//! This is that. It is a measurement and not a representation: nothing here
//! decides how a value is stored, and nothing here refuses a program. The
//! point is to find out whether the distribution the document assumes is the
//! distribution real code has, *before* a representation is committed to.
//!
//! # What the three answers mean
//!
//! - **Carried** — the value is only moved. Stored, passed on, returned.
//!   Nothing on any reachable path reads it. A pointer would do.
//! - **Tested** — a type test narrows it, and what happens afterwards happens
//!   to the narrowed type. A tag and a branch would do.
//! - **Examined** — something reads it as a value: a property, a call,
//!   arithmetic, a coercion, an equality against another erased value. This is
//!   the case that needs general erasure.
//!
//! And a fourth, which is the honest part:
//!
//! - **Unclear** — a use this analysis cannot follow. Most often a call into a
//!   function outside the compiled set, which is exactly the shape the document
//!   says decides `console`'s answer: `log(...args: unknown[])` only moves its
//!   arguments, and `formatWithOptions` in a *different module* is what
//!   examines them. A per-module measurement cannot see across that edge and
//!   must say so rather than call it carried.
//!
//! # How a verdict is reached
//!
//! Each use is classified on its own, and the site takes the strongest:
//! `Examined` beats `Unclear` beats `Tested` beats `Carried`. A use that hands
//! the value to another erased site is a *flow edge* rather than a verdict, and
//! the whole set is then iterated to a fixpoint — so a parameter that only
//! passes its value on inherits whatever the receiver does with it. That
//! inheritance is the entire reason the document argues for whole-program
//! analysis, so an implementation that skipped it would beg the question.

use nts_diagnostics::Location;
use nts_semantic_schema::{NodeId, NodeKind, SemanticSnapshot, SymbolId, TypeId, TypeKind, syntax};
use rustc_hash::{FxHashMap, FxHashSet};

/// What the checker said the type is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Checker {
    /// `any`: the checker has stopped providing safety.
    Any,
    /// `unknown`: safe, and requiring narrowing before any concrete use.
    Unknown,
}

impl Checker {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Any => "any",
            Self::Unknown => "unknown",
        }
    }
}

/// What the program does with the value.
///
/// Ordered so that the strongest answer wins when a site has several uses.
/// `Unclear` sits above `Tested` deliberately: a use this pass cannot follow
/// might be an examination, and rounding it down to the cheaper answer is how
/// a measurement talks itself into the representation it was hoping for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Verdict {
    Carried,
    Tested,
    Unclear,
    Examined,
}

impl Verdict {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Carried => "carried",
            Self::Tested => "tested",
            Self::Unclear => "unclear",
            Self::Examined => "examined",
        }
    }
}

/// What sort of declaration a site is.
///
/// Split out because `docs/any-unknown.md` counts *parameters* -- 174 of them
/// -- and a table that silently folded fields and locals in with them would not
/// be comparable with the one it is meant to check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Declaration {
    Parameter,
    Variable,
    Property,
}

impl Declaration {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Parameter => "parameters",
            Self::Variable => "variables",
            Self::Property => "properties",
        }
    }
}

/// One declaration whose type the checker gave as `any` or `unknown`.
#[derive(Debug, Clone)]
pub struct Site {
    pub name: String,
    pub declaration: Declaration,
    /// The function, method or module the declaration belongs to.
    pub owner: String,
    pub checker: Checker,
    pub verdict: Verdict,
    /// The use that decided the verdict, said in words.
    pub because: String,
    pub location: Location,
    /// The erasure is inside a container — `...args: unknown[]`, `unknown[]`.
    ///
    /// Worth separating because a container's *elements* are what get examined,
    /// and a pass that only followed the parameter would call every variadic
    /// forwarder carried.
    pub in_container: bool,
    /// Uses found for this site. Zero means nothing in the compiled set reads
    /// it, which is a different fact from "carried".
    pub uses: usize,
    /// The verdict came from a use in a *different file*.
    ///
    /// This is the document's central claim made checkable: it says the
    /// cheapest representation for `console`'s `unknown` is decided by
    /// `formatWithOptions` in `node:util`, and that no per-module rule can see
    /// that. Either sites like this exist in real code or they do not.
    pub decided_elsewhere: bool,
}

/// The classification of every erased site in one program.
#[derive(Debug, Clone, Default)]
pub struct Erasure {
    pub sites: Vec<Site>,
}

impl Erasure {
    #[must_use]
    pub fn count(&self, verdict: Verdict) -> usize {
        self.sites
            .iter()
            .filter(|site| site.verdict == verdict)
            .count()
    }

    pub fn of(&self, checker: Checker) -> impl Iterator<Item = &Site> {
        self.sites
            .iter()
            .filter(move |site| site.checker == checker)
    }
}

/// One use, before the fixpoint: either a verdict on its own or an edge.
enum Use {
    Says(Verdict, String),
    /// The value reaches another erased site, and inherits whatever happens
    /// there.
    Reaches(u32, String),
}

/// How far a use is followed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Analysis {
    /// Follow the value into the functions it is passed to, to a fixpoint.
    /// This is what `docs/any-unknown.md` specifies.
    WholeProgram,
    /// Judge each site by its own uses alone, and treat handing the value on
    /// as carrying it. Not a proposal -- it is the control, so that the value
    /// of the whole-program analysis is a measured number rather than an
    /// assumption.
    Local,
}

/// Classify every `any` and `unknown` declaration in a program.
#[must_use]
pub fn classify(snapshot: &SemanticSnapshot) -> Erasure {
    classify_as(snapshot, Analysis::WholeProgram)
}

/// Classify, following uses as far as `analysis` says.
#[must_use]
pub fn classify_as(snapshot: &SemanticSnapshot, analysis: Analysis) -> Erasure {
    let walk = Walk { snapshot };
    let sites = walk.sites();
    if sites.is_empty() {
        return Erasure::default();
    }

    let known: FxHashSet<u32> = sites.keys().copied().collect();
    let uses = walk.uses_by_symbol();

    // Each site's own uses, split into verdicts and edges.
    let mut local: FxHashMap<u32, (Verdict, String, usize)> = FxHashMap::default();
    let mut edges: FxHashMap<u32, Vec<(u32, String)>> = FxHashMap::default();
    for &symbol in &known {
        let mine = uses.get(&symbol).map_or(&[][..], Vec::as_slice);
        let mut verdict = Verdict::Carried;
        let mut because = if mine.is_empty() {
            "nothing in this program reads it".to_owned()
        } else {
            "only moved".to_owned()
        };
        for &id in mine {
            match walk.classify_use(id, &known) {
                Use::Says(said, why) => {
                    if said > verdict {
                        verdict = said;
                        because = why;
                    }
                }
                Use::Reaches(target, why) => {
                    edges.entry(symbol).or_default().push((target, why));
                }
            }
        }
        local.insert(symbol, (verdict, because, mine.len()));
    }

    // Fixpoint. A site that only passes its value on inherits the receiver's
    // answer, which is the case the document exists to make: `console`'s
    // `unknown` is decided by `node:util`.
    let mut decided_by: FxHashMap<u32, u32> = FxHashMap::default();
    if analysis == Analysis::Local {
        edges.clear();
    }
    loop {
        let mut moved = false;
        let snapshot_of: FxHashMap<u32, Verdict> = local
            .iter()
            .map(|(symbol, (verdict, ..))| (*symbol, *verdict))
            .collect();
        for (symbol, outgoing) in &edges {
            for (target, why) in outgoing {
                let Some(&reached) = snapshot_of.get(target) else {
                    continue;
                };
                let Some(entry) = local.get_mut(symbol) else {
                    continue;
                };
                if reached > entry.0 {
                    entry.0 = reached;
                    entry.1 = format!("{why}, which is {}", reached.as_str());
                    decided_by.insert(*symbol, *target);
                    moved = true;
                }
            }
        }
        if !moved {
            break;
        }
    }

    let files: FxHashMap<u32, u32> = sites
        .iter()
        .map(|(symbol, site)| (*symbol, site.location.file.0))
        .collect();
    let mut out = Erasure::default();
    for (symbol, site) in sites {
        let (verdict, because, uses) =
            local
                .remove(&symbol)
                .unwrap_or((Verdict::Carried, "no uses".to_owned(), 0));
        let decided_elsewhere = decided_by
            .get(&symbol)
            .and_then(|target| files.get(target))
            .is_some_and(|elsewhere| *elsewhere != site.location.file.0);
        out.sites.push(Site {
            decided_elsewhere,
            name: site.name,
            declaration: site.declaration,
            owner: site.owner,
            checker: site.checker,
            verdict,
            because,
            location: site.location,
            in_container: site.in_container,
            uses,
        });
    }
    out.sites.sort_by(|a, b| {
        (a.location.file.0, a.location.span.start).cmp(&(b.location.file.0, b.location.span.start))
    });
    out
}

/// A site before its verdict is known.
struct Declared {
    name: String,
    declaration: Declaration,
    owner: String,
    checker: Checker,
    location: Location,
    in_container: bool,
}

struct Walk<'a> {
    snapshot: &'a SemanticSnapshot,
}

impl Walk<'_> {
    fn kind_of(&self, id: NodeId) -> Option<u16> {
        match self.snapshot.nodes.get(id.0 as usize)?.kind {
            NodeKind::Syntax(kind) => Some(kind),
            NodeKind::List => None,
        }
    }

    fn text_of(&self, id: NodeId) -> Option<&str> {
        self.snapshot.nodes.get(id.0 as usize)?.text.as_deref()
    }

    /// Children with list nodes flattened away, the way lowering sees them.
    fn children(&self, id: NodeId) -> Vec<NodeId> {
        let mut out = Vec::new();
        let Some(node) = self.snapshot.nodes.get(id.0 as usize) else {
            return out;
        };
        for child in &node.children {
            match self.snapshot.nodes.get(child.0 as usize).map(|n| &n.kind) {
                Some(NodeKind::List) => out.extend(self.children(*child)),
                _ => out.push(*child),
            }
        }
        out
    }

    /// The nearest enclosing *syntax* node.
    ///
    /// A `NodeList` is an encoding artifact rather than a construct -- an
    /// argument list, a statement list -- and stopping at one reported the use
    /// as unrecognised. It was the single largest bucket in the first run of
    /// this pass: 80 of `console`'s 140 unclear sites.
    fn parent(&self, id: NodeId) -> Option<NodeId> {
        let mut at = self.snapshot.nodes.get(id.0 as usize)?.parent;
        while let Some(node) = at {
            if self.snapshot.nodes.get(node.0 as usize)?.kind != NodeKind::List {
                return Some(node);
            }
            at = self.snapshot.nodes.get(node.0 as usize)?.parent;
        }
        None
    }

    /// The symbol a name denotes, following an import alias.
    fn denoted(&self, symbol: SymbolId) -> SymbolId {
        let mut at = symbol;
        for _ in 0..8 {
            match self
                .snapshot
                .symbols
                .get(at.0 as usize)
                .and_then(|r| r.aliased)
            {
                Some(next) => at = next,
                None => return at,
            }
        }
        at
    }

    /// Erased-ness of a type, and whether the erasure is inside a container.
    fn erased(&self, ty: TypeId) -> Option<(Checker, bool)> {
        match self.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Any => Some((Checker::Any, false)),
            TypeKind::Unknown => Some((Checker::Unknown, false)),
            TypeKind::Array(element) => {
                let (checker, _) = self.erased(element)?;
                Some((checker, true))
            }
            _ => None,
        }
    }

    /// Every declaration whose type is erased, by the symbol it declares.
    fn sites(&self) -> FxHashMap<u32, Declared> {
        let mut out = FxHashMap::default();
        for index in 0..self.snapshot.nodes.len() {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            let Some(kind) = self.kind_of(id) else {
                continue;
            };
            if !matches!(
                kind,
                syntax::PARAMETER
                    | syntax::VARIABLE_DECLARATION
                    | syntax::PROPERTY_DECLARATION
                    | syntax::PROPERTY_SIGNATURE
            ) {
                continue;
            }
            let Some(name) = self
                .children(id)
                .into_iter()
                .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
            else {
                continue;
            };
            let Some(symbol) = self.snapshot.nodes[name.0 as usize].symbol else {
                continue;
            };
            let Some(&ty) = self.snapshot.node_types.get(&name) else {
                continue;
            };
            let Some((checker, in_container)) = self.erased(ty) else {
                continue;
            };
            out.insert(
                symbol.0,
                Declared {
                    name: self.text_of(name).unwrap_or("?").to_owned(),
                    declaration: match kind {
                        syntax::PARAMETER => Declaration::Parameter,
                        syntax::VARIABLE_DECLARATION => Declaration::Variable,
                        _ => Declaration::Property,
                    },
                    owner: self.owner_of(id),
                    checker,
                    location: self.snapshot.nodes[name.0 as usize].origin.location,
                    in_container,
                },
            );
        }
        out
    }

    /// The named thing a declaration belongs to, for reading the report.
    fn owner_of(&self, id: NodeId) -> String {
        let mut at = self.parent(id);
        while let Some(node) = at {
            if matches!(
                self.kind_of(node),
                Some(
                    syntax::FUNCTION_DECLARATION
                        | syntax::METHOD_DECLARATION
                        | syntax::CLASS_DECLARATION
                        | syntax::CONSTRUCTOR
                        | syntax::GET_ACCESSOR
                        | syntax::SET_ACCESSOR
                )
            ) {
                if let Some(name) = self
                    .children(node)
                    .into_iter()
                    .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                    && let Some(text) = self.text_of(name)
                {
                    return text.to_owned();
                }
                return "<anonymous>".to_owned();
            }
            if self.kind_of(node) == Some(syntax::ARROW_FUNCTION) {
                return "<arrow>".to_owned();
            }
            at = self.parent(node);
        }
        "<module>".to_owned()
    }

    /// Every identifier that reads a symbol, indexed by the symbol it denotes.
    fn uses_by_symbol(&self) -> FxHashMap<u32, Vec<NodeId>> {
        let mut out: FxHashMap<u32, Vec<NodeId>> = FxHashMap::default();
        for (index, node) in self.snapshot.nodes.iter().enumerate() {
            if node.kind != NodeKind::Syntax(syntax::IDENTIFIER) {
                continue;
            }
            let Some(symbol) = node.symbol else { continue };
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            // The declaration's own name is not a use of it. Compared against
            // the first *identifier* child rather than against child zero: a
            // parameter's children begin with modifiers or `...` often enough
            // that child zero is not the name, and every such declaration was
            // counting itself as a use.
            if let Some(parent) = self.parent(id)
                && matches!(
                    self.kind_of(parent),
                    Some(
                        syntax::PARAMETER
                            | syntax::VARIABLE_DECLARATION
                            | syntax::PROPERTY_DECLARATION
                            | syntax::PROPERTY_SIGNATURE
                    )
                )
                && self
                    .children(parent)
                    .into_iter()
                    .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
                    == Some(id)
            {
                continue;
            }
            out.entry(self.denoted(symbol).0).or_default().push(id);
        }
        out
    }

    /// What one use of an erased value does to it.
    fn classify_use(&self, id: NodeId, known: &FxHashSet<u32>) -> Use {
        self.classify_value_at(id, known, 0)
    }

    /// What happens to the value currently held by `id`.
    ///
    /// Recursive because several constructs *are* the value rather than a use
    /// of it: a parenthesis, an `as`, a `!`, and -- the one that matters -- a
    /// property access in member position. `record.payload` where `payload` is
    /// the erased field is not a read of `record`; it is where the field's
    /// value now lives, and what happens to it is whatever happens to the
    /// access expression. Reporting that as unclassifiable made
    /// `PropertyAccessExpression` the second-largest unclear bucket.
    fn classify_value_at(&self, id: NodeId, known: &FxHashSet<u32>, depth: u32) -> Use {
        if depth > 16 {
            return Use::Says(
                Verdict::Unclear,
                "an expression nested past the walk's depth".to_owned(),
            );
        }
        // A use whose own type is no longer erased is a use of the *narrowed*
        // value, not of this one. `if (typeof value === "number") value + 1`
        // reads a `number`, and counting the addition as an examination of the
        // `unknown` would collapse the document's `tested` category into
        // `examined` -- which is precisely the distinction the representation
        // planner needs, since a tag and a branch is all a tested site costs.
        if depth == 0
            && let Some(&ty) = self.snapshot.node_types.get(&id)
            && self.erased(ty).is_none()
        {
            return Use::Says(Verdict::Tested, "read after narrowing".to_owned());
        }
        let Some(parent) = self.parent(id) else {
            return Use::Says(Verdict::Carried, "no enclosing expression".to_owned());
        };
        let Some(kind) = self.kind_of(parent) else {
            return Use::Says(Verdict::Unclear, "an unrecognised parent node".to_owned());
        };
        let siblings = self.children(parent);
        let first = siblings.first().copied();

        match kind {
            // `typeof value`, which is a test wherever it appears: the only
            // thing it reads is the tag a tagged representation would carry.
            syntax::TYPE_OF_EXPRESSION => {
                Use::Says(Verdict::Tested, "`typeof` on the value".to_owned())
            }
            syntax::PROPERTY_ACCESS_EXPRESSION if first == Some(id) => {
                let member = siblings
                    .get(1)
                    .and_then(|m| self.text_of(*m))
                    .unwrap_or("?");
                Use::Says(Verdict::Examined, format!("a read of `.{member}`"))
            }
            syntax::ELEMENT_ACCESS_EXPRESSION if first == Some(id) => {
                Use::Says(Verdict::Examined, "an indexed read".to_owned())
            }
            syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION if first == Some(id) => {
                Use::Says(Verdict::Examined, "called as a function".to_owned())
            }
            syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION => self.argument(parent, id, known),
            syntax::BINARY_EXPRESSION => self.binary(id, &siblings, known),
            // Interpolated into a string, which is a coercion and so a read.
            syntax::TEMPLATE_SPAN | syntax::TEMPLATE_EXPRESSION => {
                Use::Says(Verdict::Examined, "interpolated into a string".to_owned())
            }
            syntax::PREFIX_UNARY_EXPRESSION | syntax::POSTFIX_UNARY_EXPRESSION => {
                Use::Says(Verdict::Examined, "a unary operator".to_owned())
            }
            // Moved, and where it moves to decides.
            syntax::VARIABLE_DECLARATION => self.lands_in_declaration(parent, known),
            syntax::RETURN_STATEMENT => Use::Says(
                Verdict::Unclear,
                "returned, and callers are not followed".to_owned(),
            ),
            // The value passes through unchanged, so the question is what
            // happens to the expression that now holds it.
            syntax::PARENTHESIZED_EXPRESSION
            | syntax::AS_EXPRESSION
            | syntax::NON_NULL_EXPRESSION
            | syntax::SATISFIES_EXPRESSION => self.classify_value_at(parent, known, depth + 1),
            // A member read: the *field* is the erased thing, and this is
            // where its value now lives.
            syntax::PROPERTY_ACCESS_EXPRESSION | syntax::ELEMENT_ACCESS_EXPRESSION => {
                self.classify_value_at(parent, known, depth + 1)
            }
            // Position in a container or an argument list under construction:
            // neither reads the value.
            syntax::ARRAY_LITERAL_EXPRESSION
            | syntax::PROPERTY_ASSIGNMENT
            | syntax::SHORTHAND_PROPERTY_ASSIGNMENT => {
                Use::Says(Verdict::Carried, "stored, not read".to_owned())
            }
            // `...values` forwarding into a call. This is the document's
            // flagship shape -- `log(...args: unknown[])` moves its arguments
            // and something else reads them -- so the spread is followed into
            // the callee's rest parameter rather than given up on.
            syntax::SPREAD_ELEMENT => {
                match self.parent(parent).map(|call| (call, self.kind_of(call))) {
                    Some((call, Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION))) => {
                        self.argument(call, parent, known)
                    }
                    _ => Use::Says(Verdict::Carried, "spread into an array literal".to_owned()),
                }
            }
            // `value is string`: the subject of a type guard, which is a
            // mention in a type position rather than a read. That the function
            // is a guard at all is evidence the parameter gets tested, and the
            // tests themselves are separate uses.
            syntax::TYPE_PREDICATE => Use::Says(
                Verdict::Carried,
                "named as the subject of a type predicate".to_owned(),
            ),
            // Thrown, which moves the value without reading it.
            syntax::THROW_STATEMENT => Use::Says(Verdict::Carried, "thrown".to_owned()),
            // `for (const x of value)`: iterating needs an iterator protocol
            // on it, which is a read.
            syntax::FOR_OF_STATEMENT => Use::Says(Verdict::Examined, "iterated".to_owned()),
            syntax::IF_STATEMENT | syntax::CONDITIONAL_EXPRESSION | syntax::WHILE_STATEMENT => {
                Use::Says(Verdict::Examined, "used for its truthiness".to_owned())
            }
            other => Use::Says(Verdict::Unclear, format!("a use of kind {other}")),
        }
    }

    /// The value is an argument. It reaches the callee's parameter, if the
    /// callee is in the compiled set.
    fn argument(&self, call: NodeId, id: NodeId, known: &FxHashSet<u32>) -> Use {
        let Some(target) = self.snapshot.call_targets.get(&call) else {
            return Use::Says(
                Verdict::Unclear,
                "an argument to a call the frontend did not resolve".to_owned(),
            );
        };
        let Some(callee) = target.callee else {
            return Use::Says(
                Verdict::Unclear,
                "an argument to a function outside this program".to_owned(),
            );
        };
        // Argument position, counting from the first child that is not the
        // callee expression.
        let arguments: Vec<NodeId> = self.children(call).into_iter().skip(1).collect();
        let Some(at) = arguments.iter().position(|arg| *arg == id) else {
            return Use::Says(Verdict::Unclear, "an argument in no position".to_owned());
        };
        let parameters: Vec<NodeId> = self
            .children(callee)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .collect();
        // A rest parameter takes every argument from its position on.
        let landing = parameters.get(at).or_else(|| parameters.last());
        let Some(parameter) = landing else {
            return Use::Says(Verdict::Unclear, "a call with no parameter here".to_owned());
        };
        let Some(name) = self
            .children(*parameter)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
        else {
            return Use::Says(Verdict::Unclear, "a parameter with no name".to_owned());
        };
        let Some(symbol) = self.snapshot.nodes[name.0 as usize].symbol else {
            return Use::Says(Verdict::Unclear, "a parameter with no symbol".to_owned());
        };
        let symbol = self.denoted(symbol).0;
        if !known.contains(&symbol) {
            // Accepted at a concrete type, so the erasure stops here.
            return Use::Says(
                Verdict::Carried,
                "passed to a parameter with a concrete type".to_owned(),
            );
        }
        let callee_name = self.owner_of(name);
        Use::Reaches(symbol, format!("passed to `{callee_name}`"))
    }

    /// The value is on one side of a binary expression.
    fn binary(&self, id: NodeId, siblings: &[NodeId], known: &FxHashSet<u32>) -> Use {
        let Some(operator) = siblings.get(1).and_then(|op| self.kind_of(*op)) else {
            return Use::Says(Verdict::Unclear, "a binary expression".to_owned());
        };
        let other = if siblings.first().copied() == Some(id) {
            siblings.get(2).copied()
        } else {
            siblings.first().copied()
        };
        match operator {
            syntax::EQUALS_EQUALS_EQUALS_TOKEN
            | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
            | syntax::EQUALS_EQUALS_TOKEN
            | syntax::EXCLAMATION_EQUALS_TOKEN => {
                // Against a literal, `null` or `undefined`, this is a test. The
                // document's point about `validateOneOf` is the other case:
                // `oneOf.includes(value)` is `===` between two erased values,
                // and *that* needs a general comparison.
                match other.and_then(|node| self.kind_of(node)) {
                    Some(
                        syntax::STRING_LITERAL
                        | syntax::NUMERIC_LITERAL
                        | syntax::NULL_KEYWORD
                        | syntax::TRUE_KEYWORD
                        | syntax::FALSE_KEYWORD,
                    ) => Use::Says(Verdict::Tested, "compared against a literal".to_owned()),
                    Some(syntax::IDENTIFIER)
                        if other.and_then(|node| self.text_of(node)) == Some("undefined") =>
                    {
                        Use::Says(Verdict::Tested, "compared against `undefined`".to_owned())
                    }
                    _ => Use::Says(
                        Verdict::Examined,
                        "equality against another value".to_owned(),
                    ),
                }
            }
            syntax::INSTANCEOF_KEYWORD => {
                Use::Says(Verdict::Tested, "an `instanceof` test".to_owned())
            }
            // `target = value`. Where the value goes decides, exactly as for a
            // variable declaration -- and a module-scope `let` assigned from a
            // parameter is how a value most often leaves the function that
            // received it.
            syntax::EQUALS_TOKEN if siblings.first().copied() != Some(id) => {
                match siblings.first().copied() {
                    Some(target) if self.kind_of(target) == Some(syntax::IDENTIFIER) => {
                        self.lands_in_binding(target, known)
                    }
                    _ => Use::Says(
                        Verdict::Unclear,
                        "assigned into a target this pass does not follow".to_owned(),
                    ),
                }
            }
            // The target of an assignment is written, not read. A compound
            // assignment is both, and falls through to the operator arm below.
            syntax::EQUALS_TOKEN => Use::Says(Verdict::Carried, "assigned to, not read".to_owned()),
            syntax::AMPERSAND_AMPERSAND_TOKEN | syntax::BAR_BAR_TOKEN => {
                Use::Says(Verdict::Examined, "used for its truthiness".to_owned())
            }
            _ => Use::Says(Verdict::Examined, "an operand of an operator".to_owned()),
        }
    }

    /// The value initialises a variable, and reaches that variable's uses.
    fn lands_in_declaration(&self, declaration: NodeId, known: &FxHashSet<u32>) -> Use {
        let Some(name) = self
            .children(declaration)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))
        else {
            return Use::Says(Verdict::Unclear, "a binding pattern".to_owned());
        };
        self.lands_in_binding(name, known)
    }

    /// The value lands in the binding `name` denotes.
    fn lands_in_binding(&self, name: NodeId, known: &FxHashSet<u32>) -> Use {
        let Some(symbol) = self.snapshot.nodes[name.0 as usize].symbol else {
            return Use::Says(Verdict::Unclear, "a binding with no symbol".to_owned());
        };
        let symbol = self.denoted(symbol).0;
        if known.contains(&symbol) {
            let text = self.text_of(name).unwrap_or("?");
            return Use::Reaches(symbol, format!("assigned to `{text}`"));
        }
        Use::Says(
            Verdict::Carried,
            "assigned to a binding with a concrete type".to_owned(),
        )
    }
}
