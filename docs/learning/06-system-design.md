# 6. Why one backend?

A modular monolith has one deployable API with internal modules. It is easier to run and reason about than several network services when a small team owns the product. Separating code by responsibility still permits later extraction when measured workloads justify it.

The API handles immediate requests. PostgreSQL stores durable state. The worker handles scheduled deadlines and delivery retries. Optional AI adapters isolate provider details. A failed model call should not stop manual replies. A worker crash should leave durable work available for retry.

Read `docs/architecture.md` and the ADR. Notice that the browser is outside the security boundary. The database must not trust a workspace ID merely because it came from React.

Exercise: draw the path of a new ticket, an internal note, and an AI draft. For each, mark where a database outage or stale version produces an error. Explain what you would measure before adding a cache or splitting a service.
