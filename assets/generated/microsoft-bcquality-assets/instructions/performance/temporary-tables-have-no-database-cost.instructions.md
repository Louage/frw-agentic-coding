---
applyTo: '**/*.al'
description: Imported BCQuality rule from microsoft/knowledge/performance/temporary-tables-have-no-database-cost.md
---

# Temporary tables avoid SQL I/O, not in-memory work

Source: microsoft/knowledge/performance/temporary-tables-have-no-database-cost.md

# Temporary tables avoid SQL I/O, not in-memory work

## Description

A temporary table stores its rows in Business Central Server memory instead of a physical SQL table. Its reads and writes therefore do not incur SQL round-trips, locking, or SIFT maintenance. They still allocate memory and execute record filtering, key lookup, sorting, insertion, and iteration in the service tier; those costs grow with the temporary dataset and access pattern.

## Best Practice

Do not apply SQL-specific findings such as missing `SetLoadFields`, lock contention, or N+1 database round-trips to a temporary record. Still assess memory volume and repeated scans or lookups. For a pure key-to-value collection, consider an AL `Dictionary`; keep a temporary table when record fields, keys, filtering, or ordered iteration are required.

## Anti Pattern

Claiming that every temporary-table access pattern is free because no SQL is involved. A nested scan over a large in-memory buffer can still dominate service-tier CPU, while adding `SetLoadFields` to that buffer addresses a database cost that does not exist.
