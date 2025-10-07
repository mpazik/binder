---
title: Complex Markdown Example
author: Binder Team
date: 2023-10-02
tags: [markdown, example, complex]
---

# Header 1

## Header 2

### Header 3

**Bold text** and *italic text*. ~~Strikethrough~~.

- Unordered list item 1
- Item 2
  - Nested item
  - Another nested

1. Ordered list
2. Second item
   1. Nested ordered

> Blockquote here.
> Another line.

`Inline code` and

```
Code block
with multiple lines
```

```dataview
TABLE file.ctime, appointment.type, appointment.time, follow-ups
FROM "30 Protocols/32 Management"
WHERE follow-ups
SORT appointment.time
```

| Table Header 1 | Header 2 |
|----------------|----------|
| Cell 1         | Cell 2   |
| Cell 3         | Cell 4   |

[Link](https://example.com) and [nested link [inner](inner.com)](outer.com)

![Image alt](image.png)

---

Footnote[^1]

[^1]: Footnote content.
