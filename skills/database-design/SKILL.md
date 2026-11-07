---
name: database-design
description: Design and review database schemas, queries, indexes, migrations and data ownership — table boundaries, keys, constraints, nullability, index selection, migration safety and rollback. Use when adding a table or column, writing a non-trivial query, planning a migration, diagnosing slow queries or deciding which module owns a piece of data.
---

# Database Design

The schema outlives the code that wrote it. Optimize for the next reader and the next migration, not the current endpoint.

## Initial Response

Before proposing a change, answer: which module owns this data, what is the access pattern (read-heavy, write-heavy, both), expected row count in a year, and can the existing table carry it. Only then design.

## Table boundaries

One table, one concept. If a row has fields that are only meaningful for some rows, or two fields that always change together for unrelated reasons, the table is holding two concepts.

- Every table needs a stable primary key that is not a business value. Business identifiers change; keys must not.
- Every foreign key gets a constraint and a deliberate `ON DELETE` behaviour. Cascading delete is a business decision, not a default.
- Nullable columns are a statement that "unknown" is meaningful. If empty string or zero would mean the same thing, the column is not nullable.
- Timestamps: one creation time, an update time only where someone will read it. Store UTC; render in the user's zone.

## Indexes

An index exists to serve a specific query. Write the query first, then add the index it needs.

- Composite index column order follows the query's equality predicates first, then range, then sort.
- A column with low cardinality (boolean, status of five values) is rarely worth an index alone; it is useful as the leading column of a covering composite.
- Every index costs write throughput and storage. Before adding one, check whether an existing index already serves the query with a different prefix.
- Measure with the real query plan on representative data volume. An index that helps at 100 rows can be ignored at 10 million.

## Query rules

- No `SELECT *` in application code: it couples the code to column order and fetches columns nobody uses.
- Pagination by offset degrades as the offset grows; prefer keyset pagination on an indexed, stable ordering column.
- Batch reads by id set rather than issuing one query per row — the N+1 pattern is the most common and most expensive mistake.
- Aggregate in the database when the result set is large; aggregate in application code when the logic is business-specific and testable there.
- Any query touched by a request path must have a bounded result. Unbounded reads are an outage waiting for enough data.

## Migrations

A migration is a production change with a rollback story. For each one, state:

1. What it changes and whether it is additive.
2. Whether old code can still run against the new schema (expand → migrate → contract).
3. How long it holds a lock, and on how many rows.
4. How to roll back, and whether rollback loses data.

Rules that prevent most incidents:

- Additive first: add nullable column → backfill in batches → switch reads → make required → drop old column in a later release.
- Never rename in place on a table in active use; add the new column and dual-write.
- Large backfills run in bounded batches with a pause, outside the request path.
- Destructive statements (`DROP`, `TRUNCATE`, unqualified `UPDATE`/`DELETE`) require an explicit backup and a separate confirmation.

## Data ownership

One module writes a table; others read through a defined interface or not at all. If two modules write the same table, one of them is silently enforcing rules the other does not know about.

## Review checklist

- What is the row count this design must handle, and what happens at 10× it?
- Does every foreign key have a constraint and a delete rule?
- Is any query unbounded or offset-paginated on a large table?
- Can the migration run while old code is still serving traffic?
- Is the rollback data-preserving?
