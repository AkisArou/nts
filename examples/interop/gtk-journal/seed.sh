#!/bin/sh
# The journal the workload loads: N entries, an entry a line, tab-separated,
# the same bytes every run, for both the nts app and its GJS twin.
awk -v n="${1:-5000}" 'BEGIN {
  split("river lamp orbit cedar quill ember harbor mosaic tundra violet", w, " ");
  for (i = 0; i < n; i++) {
    body = "";
    for (k = 0; k < 12; k++) body = body (k ? " " : "") w[(i * 7 + k * 13) % 10 + 1];
    printf "%s %d\t%s\t%d\ttag%d tag%d\t%d\n", w[i % 10 + 1], i, body, (i * 37) % 365, i % 7, (i * 3) % 7, (i % 5 == 0);
  }
}'
