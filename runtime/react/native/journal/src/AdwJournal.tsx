// The Journal on libadwaita: the same app as Journal.tsx, as a GNOME app
// writes it. A ToolbarView under a header bar whose ToggleGroup switches a
// ViewStack's pages; entries kept in React state, listed as rows that can be
// deleted; an EntryRow whose Enter saves; a toast for each save.

import { useState } from "react";
import { Button } from "react-gtk";
import {
  ActionRow,
  ApplicationWindow,
  ButtonRow,
  EntryRow,
  HeaderBar,
  PreferencesGroup,
  PreferencesPage,
  StatusPage,
  ToastOverlay,
  ToggleGroup,
  ToolbarView,
  ViewStack,
} from "react-gtk/adw";

interface Entry {
  readonly id: number;
  readonly text: string;
}

export function AdwJournal() {
  const [page, setPage] = useState("write");
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [saves, setSaves] = useState(0);
  const save = () => {
    if (draft === "") {
      return;
    }
    setEntries([...entries, { id: saves, text: draft }]);
    setSaves(saves + 1);
    setDraft("");
  };
  return (
    <ApplicationWindow title="Journal" defaultWidth={640} defaultHeight={480}>
      <ApplicationWindow.Content>
        <ToastOverlay>
          <ToolbarView>
            <ToolbarView.Top>
              <HeaderBar>
                <HeaderBar.TitleWidget>
                  <ToggleGroup activeName={page} onNotifyActiveName={(name) => setPage(name ?? "write")}>
                    <ToggleGroup.Toggle name="write" label="Write" />
                    <ToggleGroup.Toggle name="read" label={`Read (${entries.length})`} />
                  </ToggleGroup>
                </HeaderBar.TitleWidget>
              </HeaderBar>
            </ToolbarView.Top>
            <ViewStack visibleChildName={page}>
              <ViewStack.Page name="write" title="Write">
                <PreferencesPage>
                  <PreferencesGroup>
                    <EntryRow title="Today" text={draft} onNotifyText={setDraft} onEntryActivated={save} />
                    <ButtonRow title="Save" onActivated={save} />
                  </PreferencesGroup>
                </PreferencesPage>
              </ViewStack.Page>
              <ViewStack.Page name="read" title="Read">
                {entries.length === 0 ? (
                  <StatusPage title="Nothing yet" description="Saved entries show here." iconName="document-edit-symbolic" />
                ) : (
                  <PreferencesPage>
                    <PreferencesGroup title="Entries">
                      {entries.map((entry) => (
                        <ActionRow key={entry.id} title={entry.text}>
                          <ActionRow.Suffix>
                            <Button
                              iconName="user-trash-symbolic"
                              tooltipText="Delete"
                              cssClasses={["flat"]}
                              onClicked={() => setEntries(entries.filter((other) => other.id !== entry.id))}
                            />
                          </ActionRow.Suffix>
                        </ActionRow>
                      ))}
                    </PreferencesGroup>
                  </PreferencesPage>
                )}
              </ViewStack.Page>
            </ViewStack>
          </ToolbarView>
          {saves > 0 && <ToastOverlay.Toast key={saves} title="Saved" timeout={2} />}
        </ToastOverlay>
      </ApplicationWindow.Content>
    </ApplicationWindow>
  );
}
