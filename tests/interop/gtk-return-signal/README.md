# A real return-valued GTK signal

The primary connects and emits GtkWidget::keynav-failed (gboolean result); the control connects and emits the void GtkButton::clicked signal. `build.sh` checks the committed expected output on C and LLVM under NoGC and RC using GTK4 itself.
