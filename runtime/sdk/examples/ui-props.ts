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
  SelectProps, Style, TabsProps, TextFieldProps, ViewProps,
} from "@nts/sdk/ui";

const containerStyle: Style = {
  flexDirection: "column", gap: 12, padding: 16,
  backgroundColor: "#ffffff", borderRadius: 8, width: "100%",
};

export const screen: ViewProps = { style: containerStyle, testID: "settings" };

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
};

export const birthday: DateFieldProps = {
  value: undefined, onValueChange: () => undefined, mode: "date",
};

export const preview = (stream: MediaStream): CameraViewProps => ({ stream, mirrored: true });
