// Text outside ASCII before and inside a component: an astral character is two
// UTF-16 units and four UTF-8 bytes, so a span counted in the wrong unit cuts
// the text React Compiler's output is printed from, or misses a tag's type.
import { useState } from "react";
import { Box, Button, Label } from "./widgets";

export const greeting = "Καλημέρα κόσμε 🌍";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Box spacing={6}>
      <Label label={`Μετρητής 🌍 ${count}`} />
      <Button label="Πρόσθεσε" onClicked={() => setCount((c) => c + 1)} />
      <Label>Γειά σου 🌍 κόσμε</Label>
    </Box>
  );
}
