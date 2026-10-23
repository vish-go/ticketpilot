# 4. PostgreSQL data

A primary key identifies one row. A foreign key links rows and prevents dangling relationships. An organization ID scopes business records. An index speeds a particular query at the cost of disk and write work. Migrations make schema changes reproducible; editing an already-applied migration breaks that history.

Tickets have a version number. An update compares the version the browser read with the current version, then increments it. If another agent has already changed the ticket, the update must fail rather than overwrite their work. Use a transaction when several tables change together.

Read the migrations as the precise schema. The architecture diagram intentionally omits many columns. Never delete a production volume just to make a migration pass.

Exercise: inspect ticket-list indexes and explain which tenant/filter query they support. Use EXPLAIN on a realistic PostgreSQL dataset before claiming an index improves performance. Practice a backup and restore into a separate empty database.
