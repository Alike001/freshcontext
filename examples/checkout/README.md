# Checkout example

FreshContext materializes these two snapshots as a real local Git repository during the default
Compose startup. The baseline is indexed, evidence-bound memories are stored, and the changed commit
is synchronized through HydraDB. The Proof Console labels this repository as `Example data`.

The pricing change replaces a flat service fee with a tiered fee. A memory attached to
`Checkout.total` is affected through the graph path `fee -> calculateTotal -> Checkout.total`, even
though its evidence is in another file.
