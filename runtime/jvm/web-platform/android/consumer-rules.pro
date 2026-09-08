# Preserve this explicit FFI surface until the JVM emitter supplies precise keep rules.
-keep class org.nts.web.NetworkPrimitives { public *; }
-keep interface org.nts.web.NetworkPrimitives$* { *; }
-keep class org.nts.web.AndroidNetworking { public *; }

