// The Journal: write an entry, save it, read the saved ones. A window with a
// header bar, a Stack of two pages, a controlled Entry, a Grid, a DropDown
// over a list model, and an About window opened over it.

import { useState } from "react";
import type { GtkStringList } from "c:Gtk-4.0";
import { ApplicationWindow, Button, DropDown, Entry, Grid, HeaderBar, Stack, Window } from "react-gtk";

const KEY_Escape = 0xff1b;

export function Journal({ entries }: { entries: GtkStringList }) {
  const [page, setPage] = useState("write");
  const [draft, setDraft] = useState("");
  const [about, setAbout] = useState(false);
  return (
    <ApplicationWindow title="Journal" defaultWidth={640} defaultHeight={480}>
      <ApplicationWindow.Titlebar>
        <HeaderBar>
          <HeaderBar.Start>
            <Button label="About" onClicked={() => setAbout(true)} />
          </HeaderBar.Start>
          <HeaderBar.End>
            <Button label={page === "write" ? "Read" : "Write"} onClicked={() => setPage(page === "write" ? "read" : "write")} />
          </HeaderBar.End>
        </HeaderBar>
      </ApplicationWindow.Titlebar>
      <Stack visibleChildName={page} onNotifyVisibleChildName={(name) => setPage(name ?? "write")}>
        <Stack.Page name="write" title="Write">
          <Grid rowSpacing={6}>
            <Grid.Child column={0} row={0}>
              <Entry
                text={draft}
                onNotifyText={setDraft}
                onKeyPressed={(keyval) => {
                  if (keyval !== KEY_Escape) {
                    return false;
                  }
                  setDraft("");
                  return true;
                }}
              />
            </Grid.Child>
            <Grid.Child column={0} row={1}>
              <Button label="Save" cssClasses={["suggested-action"]} onClicked={() => entries.append(draft)} />
            </Grid.Child>
          </Grid>
        </Stack.Page>
        <Stack.Page name="read" title="Read">
          <DropDown model={entries} />
        </Stack.Page>
      </Stack>
      {about && (
        <Window
          title="About"
          onCloseRequest={() => {
            setAbout(false);
            return false;
          }}
        />
      )}
    </ApplicationWindow>
  );
}
