# Field Attributes

Attach structured metadata to field values without creating separate entities.

## Defining Attributes

An attribute is a regular `Field` whose values can annotate another field's values. There is no separate `Attribute` type — the runtime rejects `type: Attribute`.

```yaml
- key: role
  type: Field
  dataType: plaintext

- key: percentage
  type: Field
  dataType: integer
```

If you need to constrain `role` to a fixed set, use `dataType: option`:

```yaml
- key: role
  type: Field
  dataType: option
  options: [lead, reviewer, contributor]
```

## Attaching to Fields

Reference attributes from a field definition:

```yaml
- key: assignedTo
  type: Field
  dataType: relation
  range: [User]
  attributes: [role, percentage]
```

## Usage in Records

```yaml
assignedTo:
  - user-1: { role: lead, percentage: 60 }
  - user-2: { role: reviewer, percentage: 40 }
```

## Storage

Stored flat as `fieldName.attrs` alongside the field value:

```json
{
  "assignedTo": ["user-1", "user-2"],
  "assignedTo.attrs": {
    "user-1": { "role": "lead", "percentage": 60 },
    "user-2": { "role": "reviewer", "percentage": 40 }
  }
}
```

## Best Practices

- Each Attribute defines one property (single responsibility)
- Attributes are reusable across multiple fields
- Use for relationship metadata (role, percentage, priority), not complex structures
- If >5-6 attributes, consider a separate entity type instead
