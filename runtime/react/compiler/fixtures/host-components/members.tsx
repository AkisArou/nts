// Slot and child elements are members of their widget's component: each
// member tag is a host component of its own, as its widget is.
import { Grid, Label, Paned } from "./widgets";

export function Layout(props: { title: string }) {
  return (
    <Paned>
      <Paned.StartChild>
        <Label label={props.title} />
      </Paned.StartChild>
      <Paned.EndChild>
        <Grid>
          <Grid.Child column={1} row={0}>
            <Label label="cell" />
          </Grid.Child>
        </Grid>
      </Paned.EndChild>
    </Paned>
  );
}
