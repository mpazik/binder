---
description: Generate concise test cases for a function or functionality
agent: plan
subtask: false
---

Generate a list of test cases for the function or functionality we discussed.

$ARGUMENTS

Create test cases that are:
- **Concise**: Brief, clear test descriptions without unnecessary detail
- **Distinctive**: Each test covers a unique scenario or behavior
- **Focused**: Test the success case and only the most prominent edge and error cases

ALWAYS focus on minimal number of tests tact have largest coverage  

Avoid testing:
- Trivial variations that don't add meaningful coverage
- Obvious implementation details

Format the output as a tree structure:

```
- functionName
  - success case description
  - edge case description
  - error case description
- anotherFunction
  - success case description
  - edge case description
```

Example:
```
- parseUserInput
  - parses valid email and returns normalized format
  - handles missing @ symbol and returns error
  - handles empty string and returns error
- validatePassword
  - accepts password with 8+ characters, letters and numbers
  - rejects password shorter than 8 characters
```
