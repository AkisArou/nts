//! One ordered authority for source-owned native symbols. Runtime/native
//! declarations never enter this map; their authenticated callees keep their
//! literal boundary names. Public source ABI names remain literal C spellings.

use crate::symbols::{c_global_indexed, c_identifier, c_private_source_spelled};
use nts_core::hir::{Callee, Func, Program};
use nts_diagnostics::Diagnostic;
use nts_semantic_schema::Origin;

/// Frozen to one immutable program. Ordinals come from program order, while
/// hash maps are used only for lookup. Both native backends consume this plan.
pub struct SourceSymbols<'a> {
    source: &'a Program,
    functions: rustc_hash::FxHashMap<&'a str, (String, &'a Func)>,
    public: rustc_hash::FxHashSet<&'a str>,
    globals_names: Vec<String>,
}
impl std::fmt::Debug for SourceSymbols<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SourceSymbols")
            .field("functions", &self.functions.len())
            .field("globals", &self.globals_names.len())
            .finish_non_exhaustive()
    }
}

impl<'a> SourceSymbols<'a> {
    #[must_use]
    pub fn new(source: &'a Program) -> Self {
        let mut public: rustc_hash::FxHashSet<&str> = source
            .public_api
            .iter()
            .map(|(internal, _)| internal.as_str())
            .collect();
        for (_, members) in &source.public_namespaces {
            public.extend(members.iter().map(|(_, internal)| internal.as_str()));
        }
        public.insert(nts_core::hir::lower::MODULE_INIT);
        public.extend(
            source
                .funcs
                .iter()
                .filter(|func| func.exported)
                .map(|func| func.name.as_str()),
        );
        for generator in &source.generators {
            if public.contains(generator.constructor.as_str()) {
                public.insert(generator.resume.as_str());
            }
        }
        let mut original_functions = rustc_hash::FxHashSet::default();
        let functions = source
            .funcs
            .iter()
            .enumerate()
            .map(|(at, func)| {
                let spelled = c_identifier(&func.name);
                original_functions.insert(spelled.clone());
                let name = if func.exported || public.contains(func.name.as_str()) {
                    spelled
                } else {
                    format!(
                        "__nts_fn_{}_{at}",
                        c_private_source_spelled(&func.name, spelled)
                    )
                };
                (func.name.as_str(), (name, func))
            })
            .collect();
        let globals_names = source
            .globals
            .iter()
            .enumerate()
            .map(|(at, global)| {
                if global.exported || public.contains(global.name.as_str()) {
                    c_global_indexed(&global.name, &original_functions)
                } else {
                    format!(
                        "__nts_global_{}_{at}",
                        c_private_source_spelled(&global.name, c_identifier(&global.name))
                    )
                }
            })
            .collect();
        Self {
            source,
            functions,
            public,
            globals_names,
        }
    }
    #[must_use]
    pub fn is_public(&self, name: &str) -> bool {
        self.public.contains(name)
    }
    #[must_use]
    pub fn global(&self, at: usize) -> String {
        self.globals_names[at].clone()
    }
    #[must_use]
    pub fn reserved_public_names(&self) -> Vec<Diagnostic> {
        let diagnostic = |name: &str, origin: &Origin| {
            Diagnostic::error(
                "NTS2007",
                format!(
                    "export `{name}` uses nts's reserved C namespace `__nts_`; rename it or select an explicit ABI name outside `__nts_`"
                ),
                origin.location,
            )
        };
        let mut errors = Vec::new();
        for func in &self.source.funcs {
            if self.public.contains(func.name.as_str())
                && self.function(&func.name).starts_with("__nts_")
            {
                errors.push(diagnostic(&func.name, &func.origin));
            }
        }
        for (at, global) in self.source.globals.iter().enumerate() {
            if (global.exported || self.public.contains(global.name.as_str()))
                && self.globals_names[at].starts_with("__nts_")
            {
                errors.push(diagnostic(&global.name, &global.origin));
            }
        }
        errors
    }

    /// Only a source callee can borrow a source function's signature.
    #[must_use]
    pub fn declaration(&self, callee: &Callee) -> Option<&Func> {
        let name = match callee {
            Callee::Direct(name) | Callee::Virtual { declared: name, .. } => name,
            Callee::External(_) | Callee::Native(_) | Callee::Closure { .. } => return None,
        };
        self.functions.get(name.as_str()).map(|(_, func)| *func)
    }

    #[must_use]
    pub fn function(&self, name: &str) -> String {
        self.functions
            .get(name)
            .map_or_else(|| c_identifier(name), |(name, _)| name.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nts_core::hir::{Global, HirType};
    use nts_diagnostics::{Location, SourceId, Span};

    fn model(n: usize, collision: bool) -> Program {
        let origin = Origin::source(Location {
            file: SourceId(0),
            span: Span::new(0, 1),
        });
        let funcs = (0..n)
            .map(|at| Func {
                name: if at == 0 {
                    "register".to_owned()
                } else {
                    format!("f{at}")
                },
                params: Vec::new(),
                return_type: HirType::Void,
                values: Vec::new(),
                blocks: Vec::new(),
                origin: origin.clone(),
                exported: false,
                initializes_receiver: false,
                abstract_declaration: false,
                async_result: None,
                frame: None,
                obligations: Vec::new(),
                exact: nts_core::hir::ExactArithmetic::default(),
                written_return: None,
                result_absent: nts_core::hir::Absent::Impossible,
                validation: None,
                written_return_elements: Vec::new(),
            })
            .collect();
        let globals = (0..n)
            .map(|at| Global {
                name: if at == 0 && collision {
                    "register_".to_owned()
                } else {
                    format!("g{at}")
                },
                ty: HirType::Float { bits: 64 },
                written: None,
                constant: false,
                initial: 0.0,
                exported: true,
                deferred: false,
                origin: origin.clone(),
            })
            .collect();
        Program {
            funcs,
            globals,
            ..Program::default()
        }
    }

    #[test]
    fn public_global_scope_is_indexed_once_and_lookups_do_not_render() {
        for n in [16, 64, 256] {
            for collision in [false, true] {
                let program = model(n, collision);
                crate::symbols::reset_identifier_renderings();
                let names = SourceSymbols::new(&program);
                let construction = crate::symbols::identifier_renderings();
                assert_eq!(
                    construction,
                    2 * n,
                    "public globals re-rendered function spellings"
                );
                for at in 0..4 * n {
                    let index = at % n;
                    let function = &program.funcs[index].name;
                    let expected_global = if collision && index == 0 {
                        "register__".to_owned()
                    } else {
                        format!("g{index}")
                    };
                    let symbol = names.function(function);
                    assert!(symbol.starts_with("__nts_fn_"));
                    assert!(symbol.ends_with(&format!("_{index}")));
                    assert_eq!(names.global(index), expected_global);
                }
                let after_lookups = crate::symbols::identifier_renderings();
                assert_eq!(
                    construction, after_lookups,
                    "a known lookup re-rendered its name"
                );
                eprintln!(
                    "SOURCE_SYMBOL_WORK n={n} collision={collision} construction={construction} lookups={} lookup_renderings=0",
                    8 * n
                );
                // Same legacy suffix contract, including a keyword's escaped
                // function spelling even though that function is now private.
                for (at, global) in program.globals.iter().enumerate() {
                    assert_eq!(
                        names.global(at),
                        crate::symbols::c_global(
                            &global.name,
                            program.funcs.iter().map(|f| f.name.as_str())
                        )
                    );
                }
            }
        }
    }
}
