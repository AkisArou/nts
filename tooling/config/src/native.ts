/**
 * Native sources a package contributes, and what it contributes besides code.
 *
 * **Two fields are deliberately absent**, and `examples/workspace` is where both
 * were argued out.
 *
 * `language` is derivable from the extension -- `.java`, `.kt`, `.swift`, `.cs`,
 * `.c`, `.m` -- and a directory may legitimately hold two, since `.java` beside
 * `.kt` is ordinary and both become class files. Declaring it makes the config a
 * second derivation of a fact the filesystem already carries.
 *
 * `direction` was the wrong shape. The fixture that proposed it had to declare
 * one Android directory **twice**, because its `Scheduler.java` is called by
 * TypeScript *and* calls back into it. A directory that must appear twice is not
 * described by that field: direction is a property of edges, not of roots. It is
 * inferred the way mutual recursion always is -- declarations before bodies:
 * bind native declarations, typecheck and emit, then compile native bodies
 * against both. That resolves whenever the native signature takes an opaque
 * handle; where it *names* a generated type the cycle is real, detectable at the
 * first step, and the honest answers are a two-phase compile or a refusal naming
 * the signature.
 */
import type { TargetId } from "./target.ts";

export interface NativeSources {
  readonly dir: string;
  /** Targets this root is compiled for. Absent means every target the consumer builds. */
  readonly targets?: readonly TargetId[];
  /** The C header to bind, where the surface is C rather than class files or metadata. */
  readonly header?: string;
}

export const sources = (spec: NativeSources): NativeSources => spec;

/**
 * A fragment merged into the consuming application's platform manifest.
 *
 * Precedent: `runtime/jvm/web-platform/android/` ships an `AndroidManifest.xml`
 * contributing a permission and a `consumer-rules.pro`, and **AGP merges them**.
 * So we emit what each platform's own merger understands rather than
 * reimplementing merging -- and where a platform has no merger, which is
 * everywhere except Android, the fragment is something a consumer copies.
 *
 * The costs of omission differ in a way worth encoding: a missing
 * `POST_NOTIFICATIONS` is a silent no-op at run time, while a missing iOS
 * background mode fails App Review rather than the build.
 */
export interface Manifest {
  /** One target id, or several. `"android-29"`, not a constructed `Target`. */
  readonly target?: TargetId;
  readonly targets?: readonly TargetId[];
  readonly path: string;
  /**
   * Keys the fragment declares and cannot fill.
   *
   * `NSFaceIDUsageDescription` is mandatory on iOS -- an app calling Face ID
   * without it is terminated by the system -- and its *value* is the consumer's
   * to write. A package can supply the key and not the string. Whether the build
   * should refuse rather than ship the placeholder is open.
   */
  readonly requiresValue?: readonly string[];
}

export const manifest = (spec: Manifest): Manifest => spec;

/**
 * External artefacts, taken from an ecosystem's *resolved output* and pinned.
 *
 * `runtime/jvm/web-platform/android/dependencies.tsv` states the rule better
 * than this comment can: "a version range or a `+` would make the artifact that
 * ships differ from the artifact that was reviewed, which is the whole of a
 * supply-chain problem in one line."
 *
 * So a lockfile is read and never a build script. `build.gradle` is a
 * Turing-complete program, and so is a Makefile.
 */
export type Resolver = "gradle" | "maven" | "swiftpm" | "cocoapods" | "pkg-config" | "vcpkg" | "npm";

export interface Dependencies {
  readonly from: Resolver;
  /** The resolver's own output, copied in rather than re-resolved. */
  readonly lockfile?: string;
  /** For resolvers with no lockfile, such as `pkg-config`. */
  readonly packages?: readonly string[];
}
