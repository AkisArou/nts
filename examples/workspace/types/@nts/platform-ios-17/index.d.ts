// iOS 17.
//
// **A placeholder, and the reason it exists is that nothing provided one.**
// Every package in this fixture names a surface in `types: [...]` and no such
// package existed anywhere in the tree, so `tsc -b tsconfig.solution.json`
// failed on all five with TS2688 -- which nothing had run, because the audits
// before this one checked the config files and never the program sources.
//
// UIKit and the Objective-C frameworks, via a generated header.
//
// Empty rather than sketched: a surface with three invented declarations in it
// would be a claim about an API nobody has read. The declarations arrive from
// `nts bind` over the platform's own metadata.
export {};
