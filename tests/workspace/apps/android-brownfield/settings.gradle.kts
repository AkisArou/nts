// **The file whose absence made this not a project.**
//
// The first version of this fixture had `app/build.gradle.kts` and no
// `settings.gradle.kts` -- a Gradle *module* sitting in no Gradle *project*,
// which is not a shape that exists. Flattened to a single-module project
// instead, which is the smaller of the two normal answers; the other is a root
// plus `app/` plus our own module beside it, and `runtime/jvm/web-platform/android/`
// is an instance of that one.
rootProject.name = "acme-app"
