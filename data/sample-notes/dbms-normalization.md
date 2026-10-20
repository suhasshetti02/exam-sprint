---
id: dbms-normalization
title: DBMS Normalization (sample notes)
origin: sample
license: Original text written for this project; free to reuse under the repository license.
---

# Why normalize

Normalization organizes a relational schema so that each fact is stored once. Storing a fact in several rows invites update, insertion and deletion anomalies.

# Functional dependencies

A functional dependency X -> Y holds when every pair of rows that agree on X also agree on Y. The closure of an attribute set X is every attribute that X determines, directly or through other dependencies.

# First normal form

A table is in first normal form when every column holds a single atomic value and there are no repeating groups of columns.

# Second normal form

A table is in second normal form when it is in first normal form and no non-key attribute depends on only part of a composite candidate key. Partial dependencies are the problem this form removes.

# Third normal form

A table is in third normal form when it is in second normal form and no non-key attribute depends on another non-key attribute. This is called a transitive dependency.

# Boyce-Codd normal form

A table is in Boyce-Codd normal form (BCNF) when, for every non-trivial functional dependency X -> Y, X is a superkey. BCNF is stricter than third normal form because third normal form tolerates a dependency whose right side is part of a candidate key.
