//! GTK's platform packages, as `nts_surfaces` generates and keeps them: one
//! per GIR namespace of the closure a program imports from (`@nts/gir-gtk-4.0`,
//! `@nts/gir-glib-2.0`, ...), and one naming them all (`@nts/platform-gtk`).
//!
//! Generated on the machine, from its GIR files and headers, once per set of
//! roots and GTK version, and shared by every project there: a program that
//! imports `c:Gtk-4.0` finds the module in the store rather than in a
//! `types/gir` of its own. The module names are GIR's, so the program's
//! imports do not change.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use anyhow::Result;
use camino::{Utf8Path, Utf8PathBuf};
use nts_frontend_ts::tsgo::generated::{Complaint, Generated};
use nts_surfaces::{Binder, Package, Surface};

use crate::bind_gir;

/// The generator's own source, hashed when this compiler is built: the
/// packages change when it does, and only then. `every_generator_file_is_hashed`
/// keeps the list whole.
const GENERATOR: u64 = fnv(&[
    include_bytes!("gir_surface.rs"),
    include_bytes!("bind_gir/mod.rs"),
    include_bytes!("bind_gir/check.rs"),
    include_bytes!("bind_gir/emit.rs"),
    include_bytes!("bind_gir/facts.rs"),
    include_bytes!("bind_gir/map.rs"),
    include_bytes!("bind_gir/model.rs"),
    include_bytes!("bind_gir/naming.rs"),
    include_bytes!("bind_gir/parse.rs"),
    include_bytes!("bind_gir/prerequisites.rs"),
    include_bytes!("bind_gir/cairo-1.0.gir"),
]);

/// FNV-1a over `parts` in order, at compile time.
const fn fnv(parts: &[&[u8]]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut part = 0;
    while part < parts.len() {
        let bytes = parts[part];
        let mut at = 0;
        while at < bytes.len() {
            hash = (hash ^ bytes[at] as u64).wrapping_mul(0x0100_0000_01b3);
            at += 1;
        }
        part += 1;
    }
    hash
}

/// The platform package, which names every namespace's.
pub(crate) const PLATFORM_PACKAGE: &str = "@nts/platform-gtk";

/// What a `gi:` surface's package is named by: `@nts/gi-gtk`.
const GI_PACKAGE: &str = "@nts/gi-";

/// GTK's packages for one set of root namespaces on this machine.
#[derive(Debug, Clone)]
pub(crate) struct GirPlatform {
    /// The namespaces bound with their closures: `Gtk-4.0`, `Adw-1`.
    pub(crate) roots: BTreeSet<String>,
    pub(crate) search: Vec<Utf8PathBuf>,
}

impl GirPlatform {
    /// The roots a program's `c:` modules name, and no others: each
    /// namespace's binding names its headers (`@ntsHeader`), which the
    /// program's witness compiles, so a namespace the program does not import
    /// -- libadwaita beside a plain GTK program -- would ask for headers its
    /// dependencies do not provide. The roots are in the identity, so two
    /// sets are two store entries.
    ///
    /// A module another root's closure already binds is not a root of its
    /// own: a program importing `c:Gtk-4.0` and `c:GLib-2.0` has the store
    /// entry of one importing `c:Gtk-4.0` alone, which binds `GLib` with it.
    pub(crate) fn for_modules(modules: &BTreeSet<String>, search: &[Utf8PathBuf]) -> Self {
        let closures: Vec<(&String, Vec<String>)> =
            modules.iter().map(|module| (module, bind_gir::closure_namespaces(module, search))).collect();
        let roots = modules
            .iter()
            .filter(|module| !closures.iter().any(|(other, closure)| other != module && closure.contains(module)))
            .cloned()
            .collect();
        Self { roots, search: search.to_vec() }
    }

    /// A namespace's package name: `@nts/gir-gtk-4.0`.
    fn package(stem: &str) -> String {
        format!("@nts/gir-{}", stem.to_lowercase())
    }

    /// Its `gi:` surface's (`naming`): `@nts/gi-gtk`, which only a program
    /// importing a `gi:` module is opened with.
    fn gi_package(stem: &str) -> String {
        let namespace = stem.split_once('-').map_or(stem, |(namespace, _)| namespace);
        format!("{GI_PACKAGE}{}", namespace.to_lowercase())
    }

    /// Every root's closure, bound: the namespaces once each, and the GIR
    /// files read.
    fn bound(&self) -> Result<(Vec<bind_gir::Generated>, Vec<Utf8PathBuf>)> {
        let mut namespaces: Vec<bind_gir::Generated> = Vec::new();
        let mut files = Vec::new();
        for root in &self.roots {
            let (generated, read, _) = bind_gir::generate(root, &self.search)?;
            for namespace in generated {
                if !namespaces.iter().any(|known| known.stem == namespace.stem) {
                    namespaces.push(namespace);
                }
            }
            files.extend(read);
        }
        files.sort();
        files.dedup();
        Ok((namespaces, files))
    }
}

impl Binder for GirPlatform {
    fn identity(&self) -> String {
        let gtk = std::process::Command::new("pkg-config")
            .args(["--modversion", "gtk4"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map_or_else(|| "no-gtk".to_owned(), |output| String::from_utf8_lossy(&output.stdout).trim().to_owned());
        let roots: Vec<&str> = self.roots.iter().map(String::as_str).collect();
        format!("gtk {gtk} {} {}", std::env::consts::ARCH, roots.join("+"))
    }

    fn version(&self) -> String {
        format!("{GENERATOR:016x}")
    }

    fn inputs(&self) -> Vec<Utf8PathBuf> {
        let mut inputs = Vec::new();
        for root in &self.roots {
            if let Ok(repository) = bind_gir::closure_files(root, &self.search) {
                inputs.extend(repository);
            }
        }
        inputs.sort();
        inputs.dedup();
        inputs
    }

    fn generate(&self) -> Result<Vec<Package>> {
        let (namespaces, _) = self.bound()?;
        let mut packages = Vec::new();
        let mut references = String::new();
        for namespace in namespaces {
            let name = Self::package(&namespace.stem);
            let gi = Self::gi_package(&namespace.stem);
            let _ = writeln!(references, "/// <reference types=\"{name}\" />\n/// <reference types=\"{gi}\" />");
            packages.push(Package {
                name,
                surface: Surface::Gobject,
                declarations: namespace.declarations,
                values: Some((format!("{}.values.ts", namespace.stem), namespace.values)),
            });
            packages.push(Package { name: gi, surface: Surface::Gobject, declarations: namespace.gi, values: None });
        }
        packages.push(Package {
            name: PLATFORM_PACKAGE.to_owned(),
            surface: Surface::Gobject,
            declarations: references,
            values: None,
        });
        Ok(packages)
    }
}

/// The generator `nts build` and `nts check` open a Linux project with: when
/// the checker cannot find a `c:` module this machine has GIR for, GTK's
/// packages are installed from the store, linked into the project, and the
/// program is opened with their files added.
#[derive(Debug, Default)]
pub(crate) struct GirBindings {
    /// Whether the first round has been answered.
    decided: bool,
    /// `nts.config.ts`'s `gi`: the version of each namespace a `gi:` import
    /// names, where it pins one.
    pins: std::collections::BTreeMap<String, String>,
}

impl GirBindings {
    pub(crate) fn new(pins: std::collections::BTreeMap<String, String>) -> Self {
        Self { decided: false, pins }
    }

    /// The namespace `module` names: a `gi:` one at its pin, if the config
    /// gives one, which must be installed.
    fn namespace(&self, module: &str, search: &[Utf8PathBuf]) -> Result<Option<String>, String> {
        let Some(name) = module.strip_prefix("gi:") else { return Ok(bind_gir::namespace_of(module, search)) };
        let pinned = self.pins.get(name).map(String::as_str);
        match (bind_gir::newest(name, pinned, search), pinned) {
            (None, Some(version)) => Err(format!("nts.config.ts pins `{module}` to {version}, and no GIR file of that version is installed")),
            (found, _) => Ok(found),
        }
    }
}

impl Generated for GirBindings {
    /// What keys the snapshot cache: the binder's source and every GIR file
    /// this machine would bind from. A constant let a build after a GIR
    /// update read the cached snapshot -- which names the store entry of the
    /// old GIR -- and never ask this generator at all, so the store never
    /// saw the change. A `stat` of each file costs a millisecond or two.
    fn identity(&self) -> String {
        let mut files: Vec<Utf8PathBuf> = bind_gir::search_path()
            .into_iter()
            .flat_map(|dir| std::fs::read_dir(dir).into_iter().flatten().flatten())
            .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.path()).ok())
            .filter(|path| path.extension() == Some("gir"))
            .collect();
        files.sort();
        format!("gir-bindings/3 {GENERATOR:016x} {}", nts_surfaces::fingerprint(&files))
    }

    fn config(&mut self, tsconfig: &Utf8Path, _roots: &[String], complaints: &[Complaint]) -> Result<Option<Utf8PathBuf>, String> {
        if std::mem::replace(&mut self.decided, true) {
            return Ok(None);
        }
        let search = bind_gir::search_path();
        let missing: Vec<&str> = complaints.iter().filter_map(missing_module).collect();
        let mut modules = BTreeSet::new();
        for module in &missing {
            modules.extend(self.namespace(module, &search)?);
        }
        if modules.is_empty() {
            return Ok(None);
        }
        let gi = missing.iter().any(|module| module.starts_with("gi:"));
        install(tsconfig, &GirPlatform::for_modules(&modules, &search), gi).map(Some).map_err(|error| format!("{error:#}"))
    }
}

/// The platform's packages, from the store and linked into the project, and
/// the config opening the project with their files -- the `gi:` surface's only
/// where the program imports it (`gi`), so a `c:` program typechecks what it
/// did.
fn install(tsconfig: &Utf8Path, platform: &GirPlatform, gi: bool) -> Result<Utf8PathBuf> {
    let project = tsconfig.parent().unwrap_or(Utf8Path::new("."));
    let installed = nts_surfaces::Store::new(nts_surfaces::Store::default_root()).ensure(platform)?;
    let linked = nts_surfaces::link(&installed, project)?;
    // Once, when the platform first arrives: the build sees it through the
    // config it opens, and an editor only through `types`.
    if linked.iter().any(|name| name == PLATFORM_PACKAGE) {
        eprintln!(
            "note: linked {PLATFORM_PACKAGE} into {project}/node_modules; for an editor to see it, add \"types\": [\"{PLATFORM_PACKAGE}\"] to tsconfig.json's compilerOptions"
        );
    }
    let files: Vec<Utf8PathBuf> = installed
        .packages
        .iter()
        .filter(|(name, _)| gi || !name.starts_with(GI_PACKAGE))
        .map(|(_, dir)| dir.join("index.d.ts"))
        .chain(installed.values.iter().cloned())
        .collect();
    nts_surfaces::wrapper(tsconfig, "gir", &files)
}

/// The `c:` or `gi:` module a complaint says cannot be found -- TypeScript's
/// `Cannot find module 'c:Gtk-4.0' or its corresponding type declarations.`
/// (2307).
fn missing_module(complaint: &Complaint) -> Option<&str> {
    if complaint.code != 2307 {
        return None;
    }
    let module = complaint.text.split_once('\'')?.1.split('\'').next()?;
    (module.starts_with("c:") || module.starts_with("gi:")).then_some(module)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use nts_frontend_ts::SemanticSource;

    /// **GTK's packages typecheck**, whole and together, with their values
    /// files and nothing else: the check a package's `// @ts-nocheck` spares
    /// every program that uses it, made here once. Needs tsgo and GTK's GIR,
    /// and says nothing on a machine without them.
    #[test]
    fn the_gir_packages_typecheck() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            eprintln!("skipped: no tsgo");
            return;
        };
        let search = bind_gir::search_path();
        let roots: BTreeSet<String> =
            ["Gtk-4.0", "Adw-1"].iter().filter(|root| bind_gir::namespace_of(&format!("c:{root}"), &search).is_some()).map(|root| (*root).to_owned()).collect();
        if roots.is_empty() {
            eprintln!("skipped: no Gtk-4.0 GIR on this machine");
            return;
        }
        let platform = GirPlatform::for_modules(&roots, &search);
        let packages = platform.generate().unwrap();
        // Each type is declared once, by its namespace's package, and
        // imported by the rest: two declarations of one class would be two
        // unrelated types to the checker, and two layouts to lowering.
        // On each surface: `gi:gobject` exports `GObject` as `c:GObject-2.0`
        // does, and the checker sees two modules.
        let mut owners: std::collections::BTreeMap<&str, &str> = std::collections::BTreeMap::new();
        for package in packages.iter().filter(|p| !p.name.starts_with(GI_PACKAGE)) {
            for line in package.declarations.lines() {
                let Some(name) = line.strip_prefix("  export type ").and_then(|rest| rest.split([' ', '<']).next()) else { continue };
                if let Some(first) = owners.insert(name, &package.name) {
                    panic!("`{name}` is declared by both {first} and {}", package.name);
                }
            }
        }
        assert!(owners.len() > 1000, "{} declarations: the scan does not match the packages", owners.len());
        // A property whose setter GIR names only by an `org.gtk.Property.set`
        // annotation is written through that method, which takes `NULL`, and
        // not through a by-name thunk typed from the property, which does not.
        let gtk = packages.iter().find(|p| p.name == "@nts/gir-gtk-4.0").unwrap();
        assert!(
            gtk.declarations.contains("     * @ntsSet set_from_file\n     */\n    file: string | null;"),
            "GtkImage:file is not written through gtk_image_set_from_file"
        );
        // A signal handler's first parameter is the receiver the program
        // connected on, `this`, as GJS hands it over -- not the class that
        // declares the signal: a `GSimpleAction`'s `notify::state` handler
        // reads the action's `state`.
        let gobject = packages.iter().find(|p| p.name == "@nts/gir-gobject-2.0").unwrap();
        assert!(
            gobject.declarations.contains("handler: ErasedClosure<(self: this, pspec: GParamSpec) => void"),
            "a signal handler's self is not the receiver"
        );
        // A member is named as GIR names it, a word TypeScript reserves
        // included: GJS writes `buffer.delete(start, end)`.
        assert!(
            gtk.declarations.contains("    delete(this: GtkTextBuffer, start: GtkTextIter, end: GtkTextIter): void;"),
            "GtkTextBuffer's delete is not named delete"
        );
        pinned_constructions(&packages);
        pinned_vfunc_tuples(gtk);
        pinned_constants(&packages, gobject);
        pinned_gi(&packages);
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize_utf8().unwrap();
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir()).unwrap().join(format!("nts-gir-packages-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // As a project has them, through `types`, but as the binder wrote
        // them: without the store's `// @ts-nocheck`.
        let mut files = vec![root.join("runtime/native/libc.d.ts")];
        for package in &packages {
            let at = dir.join("node_modules").join(&package.name);
            std::fs::create_dir_all(&at).unwrap();
            // With its surface, as the store writes it: the frontend keeps a
            // `.d.ts` under `node_modules` among the program's sources only
            // then, and one it skips is one whose errors nothing reports.
            std::fs::write(
                at.join("package.json"),
                format!(r#"{{ "name": {:?}, "types": "index.d.ts", "nts": {{ "surface": "gobject" }} }}"#, package.name),
            )
            .unwrap();
            std::fs::write(at.join("index.d.ts"), &package.declarations).unwrap();
            if let Some((name, text)) = &package.values {
                std::fs::write(dir.join(name), text).unwrap();
                files.push(dir.join(name));
            }
        }
        let listed: Vec<String> = files.iter().map(|file| format!("{file:?}")).collect();
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(
                r#"{{ "extends": "{root}/tsconfig.fixtures.json", "compilerOptions": {{ "types": [{PLATFORM_PACKAGE:?}] }}, "files": [{}] }}"#,
                listed.join(", ")
            ),
        )
        .unwrap();
        let snapshot = nts_frontend_ts::TsgoApi::new(tsgo).snapshot(&dir.join("tsconfig.json")).unwrap();
        let errors: Vec<String> = snapshot
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == nts_diagnostics::Severity::Error)
            .take(10)
            .map(|diagnostic| format!("{} {}", diagnostic.code, diagnostic.message))
            .collect();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(errors.is_empty(), "GTK's packages do not typecheck: {errors:#?}");
        eprintln!("{} packages, {} declarations, {} sources checked", packages.len(), owners.len(), snapshot.sources.len());
    }

    /// What the binder declares for a construct-only property, where a
    /// class made by its `GType` has one: GJS's `new Gio.ThemedIcon({ name })`.
    fn pinned_constructions(packages: &[Package]) {
        // A construct-only property no constructor takes is offered by the
        // props and given to `g_object_new` (`with`), GJS's
        // `new Gio.ThemedIcon({ name })`, by the calls the lowering makes.
        let gio = packages.iter().find(|p| p.name == "@nts/gir-gio-2.0").unwrap();
        for present in [
            "@ntsConstruct GThemedIcon_construct g_themed_icon_get_type with name use_default_fallbacks\n",
            "export function GThemedIcon_builder(object_type: c_size_t): Ptr<unknown>;",
            "export function GThemedIcon_with_name(builder: Ptr<unknown>, value: string): void;",
            "export function GThemedIcon_with_use_default_fallbacks(builder: Ptr<unknown>, value: CBool<c_int>): void;",
            "export function GThemedIcon_build(builder: Ptr<unknown>): Owned<Declared<GThemedIcon, GObject>>;",
        ] {
            assert!(gio.declarations.contains(present), "missing: {present}");
    }
    let themed = gio.declarations.split("export interface GThemedIconProps").nth(1).and_then(|rest| rest.split("  }").next()).unwrap();
    assert!(themed.contains("    name?: string;"), "GThemedIconProps does not offer name: {themed}");
    }

    /// GIR's constants and the fundamental types, as the binder declares them.
    /// An override answering its trailing scalar outs as GJS's does, a
    /// tuple, with the tag naming the slot's out pointers.
    /// The `gi:` surface (`bind_gir::naming`): short names, camelCase members
    /// and parameters, another namespace's types qualified, GIR's names for a
    /// constant and a namespace function, and a class named like a JavaScript
    /// global keeping its C name.
    fn pinned_gi(packages: &[Package]) {
        let text = |name: &str| &packages.iter().find(|p| p.name == name).unwrap().declarations;
        let pins = [
            ("@nts/gi-gtk", "declare module \"gi:gtk\" {"),
            ("@nts/gi-gtk", "  import type * as Gio from \"gi:gio\";"),
            ("@nts/gi-gtk", "    append(this: Box, child: Widget): void;"),
            ("@nts/gi-gtk", "     * @ntsVfuncOut minimum? natural? minimumBaseline? naturalBaseline?\n     */\n    vfuncMeasure(this: Widget, orientation: CEnum<Orientation, c_uint>, forSize: CNumber<\"int\">): [CNumber<\"int\">, CNumber<\"int\">, CNumber<\"int\">, CNumber<\"int\">];"),
            ("@nts/gi-gtk", "  export interface AnyFilterProps extends MultiFilterProps, Gio.ListModelProps, BuildableProps {"),
            ("@nts/gi-gtk", "   * @ntsSymbol gtk_init\n   */\n  export function init(): void;"),
            ("@nts/gi-glib", "  export const PRIORITY_DEFAULT: CNumber<\"int\">;"),
            ("@nts/gi-glib", "  export type GError = Class<\"_GError\"> & GErrorMethods;"),
            ("@nts/gi-gobject", "  export type GObject = GObjectClass<\"_GObject\", TypeInstance> & GObjectMethods;"),
            ("@nts/gi-gobject", "  export const TYPE_STRING: c_size_t;"),
        ];
        for (package, present) in pins {
            assert!(text(package).contains(present), "{package} is missing: {present}");
        }
        // A method is a method only there, as GJS has it: no free function.
        assert!(!text("@nts/gi-gtk").contains("export function gtk_box_append("), "gi:gtk exports a method as a function");
    }

    fn pinned_vfunc_tuples(gtk: &Package) {
        for present in [
            "     * @ntsVfuncOut minimum? natural? minimum_baseline? natural_baseline?\n     */\n    vfunc_measure(this: GtkWidget, orientation: CEnum<GtkOrientation, c_uint>, for_size: CNumber<\"int\">): [CNumber<\"int\">, CNumber<\"int\">, CNumber<\"int\">, CNumber<\"int\">];",
            "vfunc_get_section?(this: GtkSectionModel, position: CNumber<\"uint\">): [CNumber<\"uint\">, CNumber<\"uint\">];",
        ] {
            assert!(gtk.declarations.contains(present), "missing: {present}");
        }
    }

    fn pinned_constants(packages: &[Package], gobject: &Package) {
        // A constant is declared with its type and its value in a tag, where
        // GIR states the value exactly, a negative one included; absent where
        // the fold would carry a different number -- GIR writes a double to
        // six digits, and a double cannot hold an integer beyond 2^53 -- and
        // for a string, which the tag does not carry.
        let glib = packages.iter().find(|p| p.name == "@nts/gir-glib-2.0").unwrap();
        for present in [
            "/** @ntsConstant 0 */\n  export const G_PRIORITY_DEFAULT: CNumber<\"int\">;",
            "/** @ntsConstant -2147483648 */\n  export const G_MININT32: CNumber<\"int32\">;",
        ] {
            assert!(glib.declarations.contains(present), "missing: {present}");
    }
    for absent in ["export const G_E:", "export const G_MAXINT64:", "export const G_CSET_DIGITS"] {
        assert!(!glib.declarations.contains(absent), "a constant the fold cannot hold: {absent}");
    }
    // A fundamental type, which GIR does not list, valued by the headers
    // and declared a `GType`; one the headers define as a call is none.
    let gobject_constants = &gobject.declarations;
    assert!(
        gobject_constants.contains("/** @ntsConstant 64 */\n  export const G_TYPE_STRING: c_size_t;"),
        "G_TYPE_STRING is not the headers' 64"
    );
    assert!(!gobject_constants.contains("export const G_TYPE_GTYPE"), "a type defined as a call was declared a constant");
    }

    /// Every source file the generator is made of is in `GENERATOR`: one left
    /// out would keep stale packages when it changes.
    #[test]
    fn every_generator_file_is_hashed() {
        let this = include_str!("gir_surface.rs");
        let dir = Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("src/bind_gir");
        for entry in std::fs::read_dir(&dir).expect("bind_gir") {
            let name = entry.expect("entry").file_name().into_string().expect("utf-8");
            assert!(this.contains(&format!("include_bytes!(\"bind_gir/{name}\")")), "bind_gir/{name} is not hashed into GENERATOR");
        }
    }
}
