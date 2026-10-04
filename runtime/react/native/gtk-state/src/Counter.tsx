import { useState } from "react";
import { Orientation } from "c:Gtk-4.0";
import { Box, Button, Label } from "react-gtk";

export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Box orientation={Orientation.VERTICAL} spacing={6}>
      <Label label={`Clicked ${count} times`} />
      <Button label="Add" onClicked={() => setCount((c) => c + 1)} />
    </Box>
  );
}
