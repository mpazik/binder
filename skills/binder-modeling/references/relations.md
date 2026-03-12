# Relations

Relations use the `relation` data type with different identifier strategies per namespace:
- **Record namespace**: UIDs (e.g. `"tsk-abc123"`)
- **Config namespace**: keys (e.g. `"title"`, `"Task"`)

## Relationship Patterns

### One-to-Many (1:M)

```yaml
- key: parent
  type: Field
  dataType: relation

- key: children
  type: Field
  dataType: relation
  allowMultiple: true
  inverseOf: parent
```

The `allowMultiple` side declares `inverseOf`. Only the single-value side (`parent`) stores data; the multi-value side (`children`) is virtual (resolved via reverse lookup). This avoids write amplification — changing a task's parent writes one field on one record instead of updating the parent's children array.

### Many-to-Many (M:M)

```yaml
- key: relatesTo
  type: Field
  dataType: relation
  allowMultiple: true
  inverseOf: relatesTo
```

Both sides store data. Can be symmetric (same field) or asymmetric (two different fields, e.g. `linksTo` ↔ `linkedFrom`). Insert/remove mutations are mirrored to the inverse field on the target entity.

### One-to-One (1:1)

```yaml
- key: partner
  type: Field
  dataType: relation
  inverseOf: partner
```

Both sides store data. Setting field A on entity X to Y generates a set of field B on entity Y to X. Displacement is handled — if Y already pointed to Z, Z's inverse is cleared.

## Inverse Validation Rules

1. Target must be an existing relation field
2. A single-value field cannot reference an `allowMultiple` target (place `inverseOf` on the `allowMultiple` side)
3. If the target also declares `inverseOf`, it must point back to this field

## External References

Use the `uri` data type for links to external resources — these are not relations, just typed URLs:

```yaml
- key: githubIssue
  type: Field
  dataType: uri
```

For multiple external links per record, prefer the built-in `references: uri[]` field rather than defining a custom one.
