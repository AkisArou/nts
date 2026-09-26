// react-gtk's counter (DESIGN.md): every tag is a host component, so none of
// them is a component React calls.
import { useState } from "react";
import { Box, Button, Label } from "./widgets";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Box spacing={6}>
      <Label label={`Clicked ${count} times`} />
      <Button label="Add" onClicked={() => setCount((c) => c + 1)} />
      <Label>text children</Label>
    </Box>
  );
}
