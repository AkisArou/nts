#ifndef NTS_WEB_COMPRESSION_H
#define NTS_WEB_COMPRESSION_H
#include "nts_runtime.h"

NtsHeader *nts_web_compression_open(double format, bool decompress,
                                    double window_bits);
NtsArray *nts_web_compression_process(NtsHeader *context, NtsView *input,
                                      double flush, double maximum);
double nts_web_compression_status(NtsHeader *context);
double nts_web_compression_consumed(NtsHeader *context);
bool nts_web_compression_reset(NtsHeader *context);
void nts_web_compression_close(NtsHeader *context);
#endif
