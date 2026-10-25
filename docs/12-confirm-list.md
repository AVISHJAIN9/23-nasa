# Confirmation List for Developer

The following architectural decisions were inferred from code patterns and are marked for developer confirmation:

1. `[CONFIRM WITH DEVELOPER]`: MongoDB Time-Series was chosen to avoid running two separate databases (relational + time-series) on resource-constrained spacecraft hardware.
2. `[CONFIRM WITH DEVELOPER]`: Redis Streams was selected for the delay emulator due to sub-100MB RAM consumption and durable append-only log semantics.
3. `[CONFIRM WITH DEVELOPER]`: Maximum Mars OWLT is configured to 22 minutes (1320 seconds) matching standard orbital aphelion distances.
