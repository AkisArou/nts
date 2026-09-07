# Preserve this explicit FFI surface until the JVM emitter supplies precise keep rules.
-keep class org.nts.web.NetworkPrimitives { public *; }
-keep interface org.nts.web.NetworkPrimitives$* { *; }
-keep class org.nts.web.AndroidNetworking { public *; }

# The production adapter's surface. Reached only from TypeScript through the
# fixed intrinsics, so nothing in Java calls it and R8 has no reason to keep it
# -- including `shutdown`, which exists because the pools it closes otherwise
# hold sockets across a network transition (see docs/records/0187).
-keep class org.nts.web.OkHttpNetworking { public *; }
-keep interface org.nts.web.OkHttpNetworking$* { *; }
