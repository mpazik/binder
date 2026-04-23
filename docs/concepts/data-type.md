---
key: data-type
name: Data Type
tags: [ data-model ]
status: active
description: The value format assigned to a field. Defines what values are valid, what operations apply, and how values are stored and indexed.
alternativeNames: [ field type, value type, format ]
sourceFiles:
  - packages/repo/src/model/data-type.ts
  - packages/repo/src/data-type-validators.ts
relatesTo:
  - field
  - reference
  - field-attribute
---

# Data Type

## Details

### Overview

A data type defines the format and behaviour of a field's values. While a Field says _what_ an entity can have like "assignedTo", the Data Type says _how_ that value behaves like "relation", a typed link to another entity with inverse support.

### Core Data Types

#### Identifiers

- **seqId**: sequential integer ID for entities, internal use
- **uid**: unique identifier, e.g. `tsk-abc123`

#### Primitives

- **boolean**: true/false
- **integer**: whole numbers
- **decimal**: decimal numbers
- **string**: short text values
- **text**: single-line text with optional line breaks and inline formatting
- **date**: date only, no time
- **datetime**: date with time

#### Structured

- **option**: single choice from predefined options
- **optionSet**: set of options to choose from
- **object**: complex object data

#### Specialised

- **uri**: reference to external resource, supports `uriPrefix` for template-based URLs like GitHub issue links
- **fileHash**: SHA-256 hash of a file
- **interval**: time period
- **duration**: length of time
- **image**: image URL or reference
- **formula**: computed expression evaluated from other fields, read-only
- **condition**: filter conditions

Core data types are available in all namespaces. Record entities additionally support fileHash, interval, duration, and image.

The `relation` data type turns entities into a graph. See the Reference concept for identifier strategies, inverse relations, and filtered relations. Fields can carry structured metadata via the Field Attribute concept.
