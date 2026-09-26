// react-gtk: GTK 4 widgets as React host components (see ../DESIGN.md).
//
//   import { Box, Button, createRoot } from "react-gtk";
//   createRoot(window).render(<Box spacing={6}><Button label="Add" onClicked={add} /></Box>);
//
// Each widget is a host component: its props are its GIR properties and
// signals, and its tag is its GTK type name, which is what a renderer's host
// config creates (ReactFiberConfig.ts).

export * from "./widgets.ts";
export { createRoot, Root, type RootOptions } from "./client.ts";
