// Portable UI prop shapes, exercised at the type level until JSX host
// bindings land. The TSX these props are designed for (from docs/ui):
//
//   <View style={{ gap: 12, padding: 16 }}>
//     <Text variant="title">Settings</Text>
//     <TextField value={name} onValueChange={setName} aria-label="Display name" />
//     <Button variant="primary" onPress={save}>Save</Button>
//   </View>
//
// renders a GtkBox+GtkLabel+GtkEntry+GtkButton through react-gtk on
// Linux, and div/span/input/button through React DOM on web.
import type {
  ButtonProps, CameraViewProps, DateFieldProps, DialogProps, ListProps,
  PressableProps, PressState, SelectProps, Style, TabsProps, TextFieldProps, ViewProps,
} from "@nts/sdk/ui";

const containerStyle: Style = {
  flexDirection: "column", rowGap: 12, columnGap: 8, padding: 16,
  paddingStart: 20, marginHorizontal: "auto",
  alignContent: "stretch", flexGrow: 1, flexShrink: 0, flexBasis: "auto",
  position: "relative", boxSizing: "border-box",
  backgroundColor: "#ffffff",
  backgroundImage: "linear-gradient(#ffffff, #f4f4f5)",
  backgroundSize: "cover", backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  borderRadius: 8, width: "100%", maxWidth: 720,
};

export const screen: ViewProps = { style: containerStyle, testID: "settings" };

export const dashboardGrid: Style = {
  display: "grid",
  gridTemplateColumns: [240, "1fr", { min: 180, max: "2fr" }],
  gridTemplateRows: ["auto", "1fr"],
  gridAutoColumns: "minmax(120, 1fr)",
  gridAutoRows: [88],
  justifyItems: "stretch",
  justifySelf: "start",
  alignItems: "start",
  alignSelf: "end",
  width: "max-content",
  minHeight: "fit-content",
};

export const dashboardMainCell: Style = {
  gridColumnStart: 2,
  gridColumnEnd: "span 2",
  gridRowStart: "auto",
  gridRowEnd: -1,
};

export const nameField = (value: string, set: (v: string) => void): TextFieldProps => ({
  value, onValueChange: set, placeholder: "Ada", inputType: "text",
  "aria-label": "Display name", invalid: value.length === 0,
  errorText: value.length === 0 ? "Required" : undefined,
});

export const saveButton = (save: () => void): ButtonProps => ({
  variant: "primary", onPress: save, children: "Save",
});

export const themeSelect: SelectProps<"system" | "light" | "dark"> = {
  value: "system",
  onValueChange: () => undefined,
  options: [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
};

export const tabs: TabsProps<"write" | "read"> = {
  value: "write",
  onValueChange: () => undefined,
  tabs: [
    { value: "write", label: "Write" },
    { value: "read", label: "Read", badge: 3 },
  ],
};

export const confirm: DialogProps = {
  open: true, onClose: () => undefined, title: "Delete entry?",
};

export const entries: ListProps<{ id: string; title: string }> = {
  data: [{ id: "1", title: "First" }],
  keyOf: (e) => e.id,
  renderItem: ({ item }) => item.title,
  refreshing: false,
  onRefresh: () => undefined,
};

export const groupedEntries: ListProps<{ id: string; title: string }> = {
  sections: [
    {
      id: "today",
      title: "Today",
      data: [{ id: "1", title: "First" }],
    },
    {
      id: "earlier",
      title: "Earlier",
      data: [{ id: "2", title: "Second" }],
    },
  ],
  keyOf: (e) => e.id,
  renderItem: ({ item, section }) => `${section?.title}: ${item.title}`,
  stickySectionHeaders: true,
  refreshing: false,
  onRefresh: () => undefined,
};

export const entryPressable = (open: () => void): PressableProps => ({
  onPress: open,
  onLongPress: () => undefined,
  hitSlop: 8,
  "aria-label": "Open entry",
  style: ({ pressed }) => ({
    padding: 12,
    backgroundColor: pressed ? "#e8e8e8" : "#ffffff",
  }),
  children: ({ focused }: PressState) => (focused ? "Open entry (focused)" : "Open entry"),
});

export const birthday: DateFieldProps = {
  value: undefined, onValueChange: () => undefined, mode: "date",
};

export const preview = (stream: MediaStream): CameraViewProps => ({ stream, mirrored: true });
