# `@nts/sdk` — portable application SDK (interface only)

Standards-first: Web globals do what the Web already covers; this package
defines only the application gaps (media library, document grants,
background tasks/location, scheduling, secure storage, contacts/calendar
libraries, haptics, desktop windows/shell, maps services). Each module
re-exports the standard global types it complements, so one reference page
describes a whole capability. Design and open questions: [DESIGN.md](DESIGN.md).

**There is no implementation yet.** Declarations live in `src/`, typechecked
usage sketches in `examples/`.

```ts
// Standard capture — no SDK involved:
const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
const blob = await new ImageCapture(stream.getVideoTracks()[0]).takePhoto();

// The gaps the SDK fills:
import { photos } from "@nts/sdk/photos";
import { notifications } from "@nts/sdk/notifications";
await photos.save(blob);
await notifications.schedule({ title: "Reminder" }, { type: "date", at: new Date(Date.now() + 60_000) });
```

## The native lib

`lib.native-dom.d.ts` is the globals surface for native app targets:
TypeScript's `lib.dom.d.ts` application subset copied verbatim (no
`Window`/`Document` tree) plus MDN-sourced additions (`BarcodeDetector`,
Generic Sensors, Contact Picker, Battery). It is generated — run
`python3 tools/extract-native-dom.py` after changing the seed list; never
hand-edit it. Temporary until nts generates a lib from WebIDL.

`tsconfig.json` here uses `"lib": ["ESNext"]` only, so this package proves
it typechecks against the native lib alone.

```sh
tsc -p runtime/sdk/tsconfig.json
tsc -p runtime/sdk/examples/tsconfig.json
```

## Status

Branch `sdk/interfaces`; not yet registered in
`tooling/lanes/lanes.json`, not wired into the root solution.
Node.js APIs (`runtime/node`) are a separate layer beside this package and
deliberately not referenced from it for now.
