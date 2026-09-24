# Build profiles

Profiles are semantic build inputs. They select upstream entry points and
forks, assign compile-time constants and declare HostConfig capabilities.

- `client-mutation-production` removes development and profiling paths.
- `client-mutation-development` retains upstream development validation and
  warnings against the same recording mutation host.

Both profiles select upstream's client `ReactSharedInternals` fork. They keep
the default `ReactFeatureFlags` module deliberately: upstream selects
`ReactFeatureFlags.native-oss` for the React Native Fabric entry, while this
experiment supplies a new mutation renderer rather than compiling Fabric.
Platform-native UI alone is not evidence that Fabric's renderer-specific
semantic switches apply. A future profile may select that fork, but it must do
so explicitly and pass the same differential suite.

DOM, server components, Flight, hydration, persistence, resources and
singletons are outside these first profiles. Enabling one requires a new
profile, a complete HostConfig capability set and conformance evidence; it is
not an informal flag edit.
