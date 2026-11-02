# Memory stage 2 diagnostic costs

Measured commit: `713b0f63fe000980d9ae457ff4e80ee08f858b03`.
Generating command: `["/usr/bin/python3", "/home/akisarou/.cache/nts-handover/compiler3/stage2-current/publish-stage2-v6.py", "713b0f63fe000980d9ae457ff4e80ee08f858b03"]`.

Legacy home comparisons in this dataset are provisional source-variant unions; they do not establish a same-context placement disagreement or an unsafe main allocation. Per-context clone matching is the next change; no placement consumer is enabled.

Ordinary preparation invokes no stage-2 solver. Explicit `regions` demand is measured separately. Byte figures are Rust requested payload allocated on the executing thread, measured with a separately instrumented allocator-only CLI; borrowed inputs, allocator bookkeeping and epoch header/padding are excluded. The raw brackets record header/padding overhead and its simultaneous combined peak. Ordinary instruction and CPU arms use the untouched formal CLI. Retention to a runtime frontier is still Unknown.

| Row | Provider | Size | Normal instructions before | Normal instructions after | Ratio | Diagnostic instructions | Analysis work | Complete | Peak requested bytes | Live requested bytes on return | Peak live entries | Analysis CPU share of diagnostic command |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| calls-16 | rc | 16 | 279477125 | 279188509 | 0.998967 | 285248545 | 10460 | True | 393541 | 101370 | 2401 | 1.809% |
| calls-32 | rc | 32 | 416525600 | 415947574 | 0.998612 | 428099592 | 20028 | True | 766715 | 197919 | 4547 | 1.420% |
| calls-64 | rc | 64 | 736882686 | 735514752 | 0.998144 | 758234778 | 39164 | True | 1512231 | 391530 | 8844 | 2.227% |
| stores-16 | rc | 16 | 179918595 | 179518528 | 0.997776 | 189496610 | 15591 | True | 608546 | 223352 | 3859 | 2.785% |
| stores-32 | rc | 32 | 204206982 | 203318593 | 0.995650 | 222737447 | 29543 | True | 1133005 | 379123 | 7279 | 4.974% |
| stores-64 | rc | 64 | 259545231 | 257793241 | 0.993250 | 296326430 | 57447 | True | 2237836 | 748018 | 14111 | 6.098% |
| recursive-16 | rc | 16 | 242172016 | 241783004 | 0.998394 | 267093422 | 37514 | True | 1614576 | 417461 | 9483 | 7.157% |
| recursive-32 | rc | 32 | 438467500 | 437696755 | 0.998242 | 498359211 | 86281 | True | 4441613 | 955737 | 22334 | 9.916% |
| recursive-64 | rc | 64 | 857011188 | 854808591 | 0.997430 | 977426407 | 171881 | True | 8871597 | 1913750 | 44450 | 13.732% |
| distributed-16 | rc | 16 | 191308505 | 191172642 | 0.999290 | 209025063 | 27138 | True | 1316736 | 344794 | 6488 | 4.498% |
| distributed-32 | rc | 32 | 256439036 | 256246293 | 0.999248 | 291626764 | 53131 | True | 2520748 | 641919 | 12635 | 6.210% |
| distributed-64 | rc | 64 | 479806039 | 479428552 | 0.999213 | 555385806 | 105867 | True | 5168702 | 1284251 | 25126 | 10.915% |
| runtime_web-platform-nogc | nogc |  | 245352020220 | 245605651958 | 1.001034 | 252007322608 | 8040869 | True | 372301283 | 150304883 | 2657325 | 1.417% |
| runtime_web-platform-rc | rc |  | 260693863636 | 260952832749 | 1.000993 | 267652836927 | 8036894 | True | 372728472 | 150519164 | 2661640 | 1.901% |
| runtime_node_fs-nogc | nogc |  | 445912871317 | 446985575786 | 1.002406 | 471194796674 | 21600011 | True | 1354309204 | 554205740 | 10199876 | 2.027% |
| runtime_node_fs-rc | rc |  | 477302120634 | 478384578665 | 1.002268 | 502217480294 | 21672589 | True | 1358537594 | 556536388 | 10242047 | 3.426% |
| runtime_node_http-nogc | nogc |  | 435914283910 | 436876897387 | 1.002208 | 457620260858 | 20334469 | True | 1128809634 | 476270942 | 8411869 | 2.394% |
| runtime_node_http-rc | rc |  | 462962748022 | 463949801412 | 1.002132 | 485172647739 | 20408115 | True | 1133176768 | 478684905 | 8454797 | 1.984% |
| runtime_node_process-nogc | nogc |  | 444386750220 | 445421401156 | 1.002328 | 470598742027 | 23183928 | True | 1437121320 | 562672504 | 10493305 | 3.674% |
| runtime_node_process-rc | rc |  | 471908649039 | 472904806076 | 1.002111 | 498333154523 | 23255659 | True | 1441375391 | 565030780 | 10535623 | 1.903% |
| runtime_node_zlib-nogc | nogc |  | 321473421665 | 321951392620 | 1.001487 | 332838390801 | 11434792 | True | 607581790 | 255259291 | 4651250 | 2.756% |
| runtime_node_zlib-rc | rc |  | 344193354934 | 344693877691 | 1.001454 | 355962775896 | 11515211 | True | 611569488 | 257463857 | 4691210 | 2.453% |

Incomplete analysis rows publish Unknown; no partial confinement proof or failed counter peak is accepted. Every first-slice legacy-home pair remains a provisional comparison pending exact context/clone matching; it cannot justify a placement consumer. No retention quota was selected.

Counter overhead on runtime_web-platform-nogc: median phase-thread CPU ratio 1.222x, full diagnostic-command CPU ratio 1.047x, over three actual pairs. Epoch header/padding overhead is excluded from the requested-payload peak and recorded separately. The allocation-pattern reference uses the same-source formal compiler with a transparent non-header observer; clean CPU arms carry no allocator observer.

The eight allocation-pattern columns match the no-header reference: True. The process peak RSS ratio is 1.043x, reported separately from requested analysis payload; allocator headers/padding remain excluded from payload and visible in the raw rows.
