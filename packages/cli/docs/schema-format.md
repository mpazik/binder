# Schema Format for LLM Context

A standardized schema format optimized for LLM comprehension, inspired by RDF principles where **fields** are reusable properties and **types** are entity classes with conditional constraints.

## Core Concepts

- **System Fields** (SYSTEM FIELDS section) - Built-in fields available on all types (id, version, timestamps)
- **Fields** (FIELDS section) - Reusable properties that can be used across multiple types
- **Types** (TYPES section) - Entity classes composed of field references with optional constraints
- **Constraints** - Types refine fields using HTML-style attributes: `{required}`, `{only: User}`, `{min: 1}`
- **Conditional Fields** - Fields declare when they're relevant via `{when: field=value}` constraint
- **Relations** - Directional (RDF-style), inverses not automatically inferred

## Key Design Principles

- **LLM Recognition** - Use patterns LLMs understand from training (bullets, HTML attributes, TypeScript syntax)
- **Token Efficiency** - Minimize token count to preserve context window space
- **User-friendly** - Easily understood by people
- **Consistency and Clarity** - Uniform formatting reduces cognitive load for people and LLMs

## Format Patterns

- **Dedicated syntax for core fields** like key, type, description or fields, to keep it more readable and concise
- **Grouped by type** like "Fields" and "Types" for clarify
- **Bullet points (•)** and **consistent indentation** for hierarchy
- **Colon syntax** (`fieldName: Type`) familiar from TypeScript/YAML/JSON Schema
- **HTML-style attributes** (`{required}`, `{max: 3}`) for constraints
- **TypeScript operators** (`Type[]`, `Type1|Type2`, `(User|Team)[]`) for arrays and unions

## Syntax

### Basic Structure

```
SYSTEM FIELDS (available on all types):
• id: number - Sequential identifier {readonly, computed}
• createdAt: datetime - Creation timestamp {readonly, computed}

FIELDS:
• fieldName: type - Description

TYPES:
• TypeName - Description [field1, field2{constraint}]
```

**Formatting:**

- Single-line for simpler types and fields
- Use multi-line format for types with >3 fields or complex constraints
- Lowercase for fields and enums (`todo|done`), capitalized for entity types (`User|Team`)

### Value Types

```
string, number, date, boolean           // Primitives (lowercase)
EntityType                              // Single relation (capitalized = in TYPES section)
Type1|Type2                             // Union (single value, one of the types)
string[]                                // Array of primitives
EntityType[]                            // Array of relations
(Type1|Type2)[]                         // Array of union (parens required for grouping)
option1|option2                         // Enum (lowercase values)
(option1|option2)[]                     // Multi-select enum (parens required)
```

**Type inference:**
- Lowercase = primitive or enum
- Capitalized = entity relation (must be in TYPES section)
- `|` binds tighter than `[]`, so `(User|Team)[]` = array of (User or Team)

**Relations:**
- Relations are directional (RDF-style triples)
- Inverse relationships must be defined explicitly in both directions
- Example: `User.memberOfTeam → Team` and `Team.members → User[]` are independent

### Constraints

```
{required, unique, readonly, computed, deprecated} // Boolean (presence = true)
{value: X}                    // Fixed constant
{default: X}                  // Default value
{description: "text"}         // Type-specific description (overrides field description)
{min: N, max: N}              // Numeric/count range
{minLength: N, maxLength: N}  // String length
{pattern: "regex"}            // Validation (or named: "email", "url")
{only: Type1|Type2}           // Restrict union/enum to subset
{exclude: value1|value2}      // Remove enum options
{when: field=value}           // Field relevant only when condition met

// Combine multiple
title{required, minLength: 3, description: "Primary identifier"}
completedAt{when: status=done}
range{when: dataType=relation, required}
```

### Conditional Fields

- Fields can declare when they're relevant using `{when: field=value}`
- Conditional fields appear in completions but validate only when condition met
- A conditional `{required}` is only mandatory when the `when` condition is satisfied
- Useful for fields that only make sense in certain contexts (e.g., `range` only for relation fields)

**Examples:**
```
range{when: dataType=relation}     // Only relevant for relation fields
options{when: dataType=option}     // Only relevant for option fields
completedAt{when: status=done}     // Only relevant when task is done
cancelReason{when: status=cancelled, required}  // Required only when cancelled
```

### System Fields

- System fields are automatically available on all types without explicit declaration
- These fields are managed by the system and cannot be modified by users
- All system fields are marked as `{readonly, computed}`

## Example

```
SYSTEM FIELDS (available on all types):
• id: number - Sequential identifier {readonly, computed}
• createdAt: datetime - Creation timestamp {readonly, computed}

FIELDS:
• name: string - Name or label
• title: string - Descriptive label
• description: text - Detailed description
• status: todo|in_progress|done|archived - Current state
• priority: low|medium|high - Importance level
• assignedTo: User|Team - Responsible party
• members: User[] - Team members
• tasks: Task[] - Related tasks
• tags: string[] - Category labels
• dueDate: date - When task is due

TYPES:
• Task - Individual unit of work [
    title{required},
    description,
    status{default: todo, exclude: archived},
    assignedTo{only: User},
    tags,
    dueDate,
    priority,
    completedAt{when: status=done},
  ]
• Project - Container for related tasks [
    title{required},
    description,
    status{required, default: todo},
    assignedTo,
    tags,
    tasks,
  ]
• User - Individual user account [name{required, description: "Full name"}]
• Team - Collaborative group [name{required}, members{min: 1}]
```


