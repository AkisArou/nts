# macos-brownfield

**The `.xcodeproj` is not reproduced**, and a CocoaPods project without one is
not a project -- `pod install` integrates by rewriting an Xcode project into a
workspace, so there is nothing here for it to rewrite.

It is left out because an `.xcodeproj` is a generated directory of plist-encoded
object graphs with UUID cross-references, and reproducing one by hand would add
several hundred lines that say nothing about the build graph this fixture is
for. `App/AppDelegate.swift` and the `Podfile` carry the part that matters: what
the consumer writes, and how the dependency is resolved.

Named here rather than left to be discovered, on the same principle as the rest
of the fixture -- a plausible-looking directory that could not actually build is
worse than an absence that says so.
