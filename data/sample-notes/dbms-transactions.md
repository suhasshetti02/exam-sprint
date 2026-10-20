---
id: dbms-transactions
title: DBMS Transactions (sample notes)
origin: sample
license: Original text written for this project; free to reuse under the repository license.
---

# ACID properties

A transaction is a unit of work that the database treats as indivisible. ACID names four guarantees: atomicity, consistency, isolation and durability.

# Atomicity and durability

Atomicity means all of a transaction's changes are applied or none are. Durability means that once a transaction commits, its changes survive a crash.

# Isolation levels

Isolation levels trade correctness for concurrency. Read uncommitted allows dirty reads. Read committed prevents dirty reads. Repeatable read also prevents non-repeatable reads. Serializable behaves as if transactions ran one after another.
