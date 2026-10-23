# Metrics and measurement

Ticket metrics are derived from the selected organization's database records. Check the analytics implementation for exact terminal-status and denominator handling.

- Volume: count of tickets in the workspace.
- Open: tickets whose status is not resolved or closed.
- Closed: resolved or closed tickets.
- First response: elapsed minutes from ticket creation to the first public agent response; internal notes do not count. The average uses only tickets with a recorded first response.
- Resolution: elapsed minutes from creation to recorded resolution; unresolved tickets are excluded from that average.
- SLA compliance: percentage of all tickets whose first-response and resolution deadlines have either been met or have not yet expired. Ongoing tickets before their deadlines count as compliant at query time; this is an operational snapshot, not completed-ticket-only SLA success. Empty datasets return null.
- Category distribution: count grouped by stored category, including human corrections.
- Workload: count of current nonterminal assignments per member.

Averages can hide poor tail behavior. Add percentiles and time-window filtering when enough real data exists. Reopening and retroactive SLA configuration changes require explicit product definitions before comparing teams.

For load testing, record machine/CPU/memory, database variant and version, dataset size, concurrency, duration, warmup, response percentiles, errors, and tested routes. Do not infer PostgreSQL production throughput from an embedded PGlite run. No scale or latency claim is justified without a saved measurement and environment description.
