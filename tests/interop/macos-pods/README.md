# CocoaPods fixture inputs

The fixture consumes the committed `Podfile.lock` and `Pods/` snapshot.
Neither its build script nor the CocoaPods resolver runs `pod install`.
Keep this input committed; it is not a disposable build directory.

Full regeneration is owed on the next available Mac. Run `pod install`
beside this fixture's `Podfile`, review the resolved inputs, and commit the
complete `Pods/` tree, including the umbrella headers and module maps under
`Target Support Files`. The current snapshot contains links to those files
without their targets. Run the fixture's build and oracle controls on that
Mac before committing the regenerated snapshot.

The Linux `unrouted.mjs` scan reports only those exact missing links as named
exceptions. After committing the complete snapshot, remove those exceptions
and this outstanding-work note. Other missing inputs remain errors.
