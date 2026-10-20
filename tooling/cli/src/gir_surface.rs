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

/// The generator's own source, hashed when this compiler is built
/// (`generator_inputs`): the packages change when it does, and only then.
const GENERATOR: &str = env!("NTS_GENERATOR_GIR");

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
    /// `girExtras`, by root: each root's only the namespaces its closure
    /// binds, so one root's request cannot name what another's lacks.
    pub(crate) extras: std::collections::BTreeMap<String, bind_gir::Extras>,
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
    pub(crate) fn for_modules(
        modules: &BTreeSet<String>,
        search: &[Utf8PathBuf],
        extras: &bind_gir::Extras,
    ) -> Self {
        let closures: Vec<(&String, Vec<String>)> = modules
            .iter()
            .map(|module| (module, bind_gir::closure_namespaces(module, search)))
            .collect();
        let roots: BTreeSet<String> = modules
            .iter()
            .filter(|module| {
                !closures
                    .iter()
                    .any(|(other, closure)| other != module && closure.contains(module))
            })
            .cloned()
            .collect();
        let mut by_root = std::collections::BTreeMap::new();
        for (module, closure) in &closures {
            if !roots.contains(*module) {
                continue;
            }
            let own: bind_gir::Extras = extras
                .iter()
                .filter(|(namespace, _)| closure.contains(*namespace))
                .map(|(namespace, extra)| (namespace.clone(), extra.clone()))
                .collect();
            if !own.is_empty() {
                by_root.insert((*module).clone(), own);
            }
        }
        // A namespace no root reaches: the config is the project's, and can
        // name one this program's imports do not -- said, not refused.
        for namespace in extras.keys() {
            if !closures
                .iter()
                .any(|(_, closure)| closure.contains(namespace))
            {
                eprintln!(
                    "note: nts.config.ts's girExtras names {namespace}, which no GIR import of this program reaches"
                );
            }
        }
        Self {
            roots,
            search: search.to_vec(),
            extras: by_root,
        }
    }

    /// Each root's request, as `nts bind-gir` spells it after the root:
    /// empty without extras.
    fn requests(&self) -> String {
        let mut requests = String::new();
        for (root, extras) in &self.extras {
            let _ = write!(requests, " {root}{}", bind_gir::request_of(extras));
        }
        requests
    }

    /// A namespace's package name: `@nts/gir-gtk-4.0`.
    fn package(stem: &str) -> String {
        format!("@nts/gir-{}", stem.to_lowercase())
    }

    /// Its `gi:` surface's (`naming`): `@nts/gi-gtk`, which only a program
    /// importing a `gi:` module is opened with.
    fn gi_package(stem: &str) -> String {
        let namespace = stem
            .split_once('-')
            .map_or(stem, |(namespace, _)| namespace);
        format!("{GI_PACKAGE}{}", namespace.to_lowercase())
    }

    /// Every root's closure, bound: the namespaces once each, and the GIR
    /// files read.
    fn bound(&self) -> Result<(Vec<bind_gir::Generated>, Vec<Utf8PathBuf>)> {
        let mut namespaces: Vec<bind_gir::Generated> = Vec::new();
        let mut files = Vec::new();
        for root in &self.roots {
            let none = bind_gir::Extras::new();
            let extras = self.extras.get(root).unwrap_or(&none);
            let (generated, read, _) = bind_gir::generate(root, &self.search, extras)?;
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
            .map_or_else(
                || "no-gtk".to_owned(),
                |output| String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            );
        let roots: Vec<&str> = self.roots.iter().map(String::as_str).collect();
        // No extras, no change: every store entry made before them is still
        // the one a project without `girExtras` names.
        format!(
            "gtk {gtk} {} {}{}",
            std::env::consts::ARCH,
            roots.join("+"),
            self.requests()
        )
    }

    fn version(&self) -> String {
        GENERATOR.to_owned()
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
            let _ = writeln!(
                references,
                "/// <reference types=\"{name}\" />\n/// <reference types=\"{gi}\" />"
            );
            packages.push(Package {
                name,
                surface: Surface::Gobject,
                declarations: namespace.declarations,
                values: Some((format!("{}.values.ts", namespace.stem), namespace.values)),
            });
            packages.push(Package {
                name: gi,
                surface: Surface::Gobject,
                declarations: namespace.gi,
                values: None,
            });
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
    /// `nts.config.ts`'s `girExtras`.
    extras: bind_gir::Extras,
}

impl GirBindings {
    pub(crate) fn new(
        pins: std::collections::BTreeMap<String, String>,
        extras: bind_gir::Extras,
    ) -> Self {
        Self {
            decided: false,
            pins,
            extras,
        }
    }

    /// The namespace `module` names: a `gi:` one at its pin, if the config
    /// gives one, which must be installed.
    fn namespace(&self, module: &str, search: &[Utf8PathBuf]) -> Result<Option<String>, String> {
        let Some(name) = module.strip_prefix("gi:") else {
            return Ok(bind_gir::namespace_of(module, search));
        };
        let pinned = self.pins.get(name).map(String::as_str);
        match (bind_gir::newest(name, pinned, search), pinned) {
            (None, Some(version)) => Err(format!(
                "nts.config.ts pins `{module}` to {version}, and no GIR file of that version is installed"
            )),
            (found, _) => Ok(found),
        }
    }
}

impl Generated for GirBindings {
    fn import_prefixes(&self) -> Option<&[&str]> {
        Some(&["gi:", "c:"])
    }

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
        // A snapshot names the store entry it was opened with, which the
        // extras choose; none, and the key is what it was before them.
        format!(
            "gir-bindings/3 {GENERATOR} {}{}",
            nts_surfaces::fingerprint(&files),
            bind_gir::request_of(&self.extras)
        )
    }

    fn files(
        &mut self,
        tsconfig: &Utf8Path,
        _roots: &[String],
        complaints: &[Complaint],
    ) -> Result<Option<Vec<Utf8PathBuf>>, String> {
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
        install(
            tsconfig,
            &GirPlatform::for_modules(&modules, &search, &self.extras),
            gi,
        )
        .map(Some)
        .map_err(|error| format!("{error:#}"))
    }
}

/// The platform's packages, from the store and linked into the project, and
/// their files, which the project is opened with -- the `gi:` surface's only
/// where the program imports it (`gi`), so a `c:` program typechecks what it
/// did.
fn install(tsconfig: &Utf8Path, platform: &GirPlatform, gi: bool) -> Result<Vec<Utf8PathBuf>> {
    let project = tsconfig.parent().unwrap_or(Utf8Path::new("."));
    let installed =
        nts_surfaces::Store::new(nts_surfaces::Store::default_root()).ensure(platform)?;
    let linked = nts_surfaces::link(&installed, project)?;
    // Once, when the platform first arrives: the build opens the project with
    // its files, and an editor sees it only through `types`.
    if linked.iter().any(|name| name == PLATFORM_PACKAGE) {
        eprintln!(
            "note: linked {PLATFORM_PACKAGE} into {project}/node_modules; for an editor to see it, add \"types\": [\"{PLATFORM_PACKAGE}\"] to tsconfig.json's compilerOptions"
        );
    }
    Ok(installed
        .packages
        .iter()
        .filter(|(name, _)| gi || !name.starts_with(GI_PACKAGE))
        .map(|(_, dir)| dir.join("index.d.ts"))
        .chain(installed.values.iter().cloned())
        .collect())
}

/// The `c:` or `gi:` module a complaint says cannot be found -- TypeScript's
/// `Cannot find module 'c:Gtk-4.0' or its corresponding type declarations.`
/// (2307), or the same words for a side-effect import with no names,
/// `import "gi:gtk"` (2882): GJS programs set versions that way, and the
/// packages are no more installed for it until it is recognised here.
fn missing_module(complaint: &Complaint) -> Option<&str> {
    if complaint.code != 2307 && complaint.code != 2882 {
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
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn the_gir_packages_typecheck() {
        let Some(tsgo) = nts_frontend_ts::tsgo::locate() else {
            eprintln!("skipped: no tsgo");
            return;
        };
        let search = bind_gir::search_path();
        let roots: BTreeSet<String> = ["Gtk-4.0", "Adw-1"]
            .iter()
            .filter(|root| bind_gir::namespace_of(&format!("c:{root}"), &search).is_some())
            .map(|root| (*root).to_owned())
            .collect();
        if roots.is_empty() {
            eprintln!("skipped: no Gtk-4.0 GIR on this machine");
            return;
        }
        let platform = GirPlatform::for_modules(&roots, &search, &bind_gir::Extras::new());
        let packages = platform.generate().unwrap();
        // Each type is declared once, by its namespace's package, and
        // imported by the rest: two declarations of one class would be two
        // unrelated types to the checker, and two layouts to lowering.
        // On each surface: `gi:gobject` exports `GObject` as `c:GObject-2.0`
        // does, and the checker sees two modules.
        let mut owners: std::collections::BTreeMap<&str, &str> = std::collections::BTreeMap::new();
        for package in packages.iter().filter(|p| !p.name.starts_with(GI_PACKAGE)) {
            for line in package.declarations.lines() {
                let Some(name) = line
                    .strip_prefix("  export type ")
                    .and_then(|rest| rest.split([' ', '<']).next())
                else {
                    continue;
                };
                if let Some(first) = owners.insert(name, &package.name) {
                    panic!("`{name}` is declared by both {first} and {}", package.name);
                }
            }
        }
        assert!(
            owners.len() > 1000,
            "{} declarations: the scan does not match the packages",
            owners.len()
        );
        // A property whose setter GIR names only by an `org.gtk.Property.set`
        // annotation is written through that method, which takes `NULL`, and
        // not through a by-name thunk typed from the property, which does not.
        let gtk = packages
            .iter()
            .find(|p| p.name == "@nts/gir-gtk-4.0")
            .unwrap();
        assert!(
            gtk.declarations
                .contains("     * @ntsSet set_from_file\n     */\n    file: string | null;"),
            "GtkImage:file is not written through gtk_image_set_from_file"
        );
        // A signal handler's first parameter is the receiver the program
        // connected on, `this`, as GJS hands it over -- not the class that
        // declares the signal: a `GSimpleAction`'s `notify::state` handler
        // reads the action's `state`.
        let gobject = packages
            .iter()
            .find(|p| p.name == "@nts/gir-gobject-2.0")
            .unwrap();
        assert!(
            gobject
                .declarations
                .contains("handler: ErasedClosure<(self: this, pspec: GParamSpec) => void"),
            "a signal handler's self is not the receiver"
        );
        // A member is named as GIR names it, a word TypeScript reserves
        // included: GJS writes `buffer.delete(start, end)`.
        assert!(
            gtk.declarations.contains(
                "    delete(this: GtkTextBuffer, start: GtkTextIter, end: GtkTextIter): void;"
            ),
            "GtkTextBuffer's delete is not named delete"
        );
        pinned_constructions(&packages);
        pinned_vfunc_tuples(gtk);
        pinned_constants(&packages, gobject);
        pinned_gi(&packages);
        let root = Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize_utf8()
            .unwrap();
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("nts-gir-packages-{}", std::process::id()));
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
        // A program on the `gi:` surface, beside them: what a class the program
        // writes over a `gi:` class can say, and what it cannot -- each
        // `@ts-expect-error` is unused, and so an error, the day its line
        // typechecks.
        std::fs::write(dir.join("gi-program.ts"), GI_PROGRAM).unwrap();
        files.push(dir.join("gi-program.ts"));
        let listed: Vec<String> = files.iter().map(|file| format!("{file:?}")).collect();
        std::fs::write(
            dir.join("tsconfig.json"),
            format!(
                r#"{{ "extends": "{root}/tsconfig.fixtures.json", "compilerOptions": {{ "types": [{PLATFORM_PACKAGE:?}] }}, "files": [{}] }}"#,
                listed.join(", ")
            ),
        )
        .unwrap();
        let snapshot = nts_frontend_ts::TsgoApi::new(tsgo)
            .snapshot(&dir.join("tsconfig.json"))
            .unwrap();
        let errors: Vec<String> = snapshot
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == nts_diagnostics::Severity::Error)
            .take(10)
            .map(|diagnostic| format!("{} {}", diagnostic.code, diagnostic.message))
            .collect();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            errors.is_empty(),
            "GTK's packages do not typecheck: {errors:#?}"
        );
        eprintln!(
            "{} packages, {} declarations, {} sources checked",
            packages.len(),
            owners.len(),
            snapshot.sources.len()
        );
    }

    /// What the binder declares for a construct-only property, where a
    /// class made by its `GType` has one: GJS's `new Gio.ThemedIcon({ name })`.
    fn pinned_constructions(packages: &[Package]) {
        // A construct-only property no constructor takes is offered by the
        // props and given to `g_object_new` (`with`), GJS's
        // `new Gio.ThemedIcon({ name })`, by the calls the lowering makes.
        let gio = packages
            .iter()
            .find(|p| p.name == "@nts/gir-gio-2.0")
            .unwrap();
        for present in [
            "@ntsConstruct GThemedIcon_construct g_themed_icon_get_type with name use_default_fallbacks\n",
            "export function GThemedIcon_builder(object_type: c_size_t): Ptr<void>;",
            "export function GThemedIcon_with_name(builder: Ptr<void>, value: string): void;",
            "export function GThemedIcon_with_use_default_fallbacks(builder: Ptr<void>, value: CBool<c_int>): void;",
            "export function GThemedIcon_build(builder: Ptr<void>): Owned<Declared<GThemedIcon, GObject>>;",
        ] {
            assert!(gio.declarations.contains(present), "missing: {present}");
        }
        let themed = gio
            .declarations
            .split("export interface GThemedIconProps")
            .nth(1)
            .and_then(|rest| rest.split("  }").next())
            .unwrap();
        assert!(
            themed.contains("    name?: string;"),
            "GThemedIconProps does not offer name: {themed}"
        );
    }

    /// GIR's constants and the fundamental types, as the binder declares them.
    /// An override answering its trailing scalar outs as GJS's does, a
    /// tuple, with the tag naming the slot's out pointers.
    /// A program on the `gi:` surface, typechecked against the packages
    /// (`the_gir_packages_typecheck`): a class names itself in its heritage
    /// clause and is constructed by its properties with no constructor; a
    /// signal is a field, `emit` and `connect` typed by it.
    const GI_PROGRAM: &str = r#"import { Button, Orientation } from "gi:gtk";
import { GObject, property } from "gi:gobject";
import type { Signal } from "c:types";

class Book extends GObject<Book> {
  title = property("");
  pageCount = property(0);
  orientation = property<Orientation>(Orientation.VERTICAL);
  readonly isbn = property<string>();
  cache = new Map<string, number>();
}

class Tally extends Button<Tally> {
  declare readonly incremented: Signal<[by: number]>;
  count = 0;
  bump(): void {
    this.emit("incremented", 1);
  }
}

export function made(): number {
  const book = new Book({ title: "Dune", pageCount: 412, isbn: "978" });
  const tally = new Tally({ label: "count" });
  tally.connect("incremented", (_self, by) => {
    tally.count += by;
  });
  tally.connectAfter("incremented", () => {});
  new Button({ label: "plain" });
  // @ts-expect-error `isbn` has no default, so a construction must give it
  new Book({ title: "x" });
  // @ts-expect-error `cache` is a field, not a property
  new Book({ isbn: "x", cache: new Map() });
  // @ts-expect-error `incremented` takes a number
  tally.emit("incremented", "x");
  // @ts-expect-error no signal of that name
  tally.emit("decremented");
  // @ts-expect-error a signal is connected by its name; its field is only its declaration
  tally.incremented.connect(() => {});
  // @ts-expect-error `title` is a string
  new Book({ isbn: "x", title: 1 });
  return book.pageCount;
}
"#;

    /// The `gi:` surface (`bind_gir::naming`): short names, camelCase members
    /// and parameters, another namespace's types qualified, GIR's names for a
    /// constant and a namespace function, and a class named like a JavaScript
    /// global keeping its C name.
    fn pinned_gi(packages: &[Package]) {
        let text = |name: &str| {
            &packages
                .iter()
                .find(|p| p.name == name)
                .unwrap()
                .declarations
        };
        let pins = [
            ("@nts/gi-gtk", "declare module \"gi:gtk\" {"),
            ("@nts/gi-gtk", "  import type * as Gio from \"gi:gio\";"),
            ("@nts/gi-gtk", "    append(this: Box, child: Widget): void;"),
            (
                "@nts/gi-gtk",
                "     * @ntsVfuncOut minimum? natural? minimumBaseline? naturalBaseline?\n     */\n    vfuncMeasure(this: Widget, orientation: CEnum<Orientation, c_uint>, forSize: c_int): [c_int, c_int, c_int, c_int];",
            ),
            (
                "@nts/gi-gtk",
                "  export interface AnyFilterProps extends MultiFilterProps, Gio.ListModelProps, BuildableProps {",
            ),
            (
                "@nts/gi-gtk",
                "   * @ntsSymbol gtk_init\n   */\n  export function init(): void;",
            ),
            ("@nts/gi-glib", "  export const PRIORITY_DEFAULT: c_int;"),
            (
                "@nts/gi-glib",
                "  export type GError = Class<\"_GError\"> & GErrorMethods;",
            ),
            (
                "@nts/gi-gobject",
                "  export type GObject = GObjectClass<\"_GObject\", TypeInstance> & GObjectMethods;",
            ),
            ("@nts/gi-gobject", "  export const TYPE_STRING: c_size_t;"),
            (
                "@nts/gi-gobject",
                "  export { property, signal } from \"c:types\";",
            ),
        ];
        for (package, present) in pins {
            assert!(
                text(package).contains(present),
                "{package} is missing: {present}"
            );
        }
        // A method is a method only there, as GJS has it: no free function.
        assert!(
            !text("@nts/gi-gtk").contains("export function gtk_box_append("),
            "gi:gtk exports a method as a function"
        );
    }

    fn pinned_vfunc_tuples(gtk: &Package) {
        for present in [
            "     * @ntsVfuncOut minimum? natural? minimum_baseline? natural_baseline?\n     */\n    vfunc_measure(this: GtkWidget, orientation: CEnum<GtkOrientation, c_uint>, for_size: c_int): [c_int, c_int, c_int, c_int];",
            "vfunc_get_section?(this: GtkSectionModel, position: c_uint): [c_uint, c_uint];",
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
        let glib = packages
            .iter()
            .find(|p| p.name == "@nts/gir-glib-2.0")
            .unwrap();
        for present in [
            "/** @ntsConstant 0 */\n  export const G_PRIORITY_DEFAULT: c_int;",
            "/** @ntsConstant -2147483648 */\n  export const G_MININT32: Int32;",
        ] {
            assert!(glib.declarations.contains(present), "missing: {present}");
        }
        for absent in [
            "export const G_E:",
            "export const G_MAXINT64:",
            "export const G_CSET_DIGITS",
        ] {
            assert!(
                !glib.declarations.contains(absent),
                "a constant the fold cannot hold: {absent}"
            );
        }
        // A fundamental type, which GIR does not list, valued by the headers
        // and declared a `GType`; one the headers define as a call is none.
        let gobject_constants = &gobject.declarations;
        assert!(
            gobject_constants
                .contains("/** @ntsConstant 64 */\n  export const G_TYPE_STRING: c_size_t;"),
            "G_TYPE_STRING is not the headers' 64"
        );
        assert!(
            !gobject_constants.contains("export const G_TYPE_GTYPE"),
            "a type defined as a call was declared a constant"
        );
    }

    /// A missing GIR module is recognised in both spellings TypeScript
    /// gives it: named (2307) and side-effect (2882). The side-effect form
    /// is how GJS sets a version, and unrecognised it installed nothing:
    /// measured against a pin of main, `import "gi:gtk"` alone failed
    /// TS2882 while the named form built.
    #[test]
    fn a_missing_gir_module_is_recognised_named_and_side_effect() {
        let named = Complaint {
            code: 2307,
            text: "Cannot find module 'gi:gtk' or its corresponding type declarations.".into(),
        };
        let side_effect = Complaint {
            code: 2882,
            text: "Cannot find module or type declarations for side-effect import of 'gi:gtk'."
                .into(),
        };
        let other = Complaint {
            code: 2307,
            text: "Cannot find module 'fs'".into(),
        };
        let wrong_code = Complaint {
            code: 1005,
            text: "Cannot find module 'gi:gtk' or its corresponding type declarations.".into(),
        };
        assert_eq!(missing_module(&named), Some("gi:gtk"));
        assert_eq!(missing_module(&side_effect), Some("gi:gtk"));
        assert_eq!(missing_module(&other), None);
        assert_eq!(missing_module(&wrong_code), None);
    }

    /// Two projects asking different `girExtras` never share a store entry:
    /// the identity names the request -- namespaces in order whatever order
    /// the config gives them, each one's values in the order given, which is
    /// the order they are included in -- and with none it is the string a
    /// store entry was named by before extras existed.
    #[test]
    fn the_store_identity_names_the_request_and_nothing_without_one() {
        let platform = |extras: Vec<(&str, Vec<&str>)>| {
            let extras: bind_gir::Extras = extras
                .into_iter()
                .map(|(namespace, headers)| {
                    (
                        namespace.to_owned(),
                        bind_gir::Extra {
                            headers: headers.into_iter().map(str::to_owned).collect(),
                            ..bind_gir::Extra::default()
                        },
                    )
                })
                .collect();
            GirPlatform {
                roots: ["Gtk-4.0".to_owned()].into(),
                search: Vec::new(),
                extras: if extras.is_empty() {
                    std::collections::BTreeMap::new()
                } else {
                    [("Gtk-4.0".to_owned(), extras)].into()
                },
            }
            .identity()
        };
        let none = platform(vec![]);
        let gtk = std::process::Command::new("pkg-config")
            .args(["--modversion", "gtk4"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map_or_else(
                || "no-gtk".to_owned(),
                |output| String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            );
        assert_eq!(
            none,
            format!("gtk {gtk} {} Gtk-4.0", std::env::consts::ARCH)
        );
        let a = platform(vec![("GLib-2.0", vec!["glib/gstdio.h"])]);
        let b = platform(vec![("HarfBuzz-0.0", vec!["hb-ot.h"])]);
        assert!(none != a && none != b && a != b, "{none}\n{a}\n{b}");
        assert_eq!(
            platform(vec![
                ("GLib-2.0", vec!["glib/gstdio.h"]),
                ("HarfBuzz-0.0", vec!["hb-ot.h"])
            ]),
            platform(vec![
                ("HarfBuzz-0.0", vec!["hb-ot.h"]),
                ("GLib-2.0", vec!["glib/gstdio.h"])
            ])
        );
        assert_ne!(
            platform(vec![("HarfBuzz-0.0", vec!["hb-ot.h", "hb-aat.h"])]),
            platform(vec![("HarfBuzz-0.0", vec!["hb-aat.h", "hb-ot.h"])])
        );
    }

    /// Each root gets the extras its closure binds, and only those: a
    /// namespace no root reaches is left out, not an error.
    #[test]
    fn each_root_gets_only_the_extras_its_closure_binds() {
        let search = bind_gir::search_path();
        if bind_gir::namespace_of("c:GLib-2.0", &search).is_none() {
            eprintln!("skipping: no GLib-2.0 GIR");
            return;
        }
        let extras: bind_gir::Extras = [
            ("GLib-2.0".to_owned(), bind_gir::Extra::default()),
            ("Nowhere-1.0".to_owned(), bind_gir::Extra::default()),
        ]
        .into();
        let platform = GirPlatform::for_modules(&["GLib-2.0".to_owned()].into(), &search, &extras);
        assert_eq!(
            platform.extras["GLib-2.0"].keys().collect::<Vec<_>>(),
            ["GLib-2.0"]
        );
    }
}
