import { createTemplateEntity, type Templates } from "./navigation.ts";

export const mockTaskTemplateKey = "task-template";

export const mockTaskTemplate = createTemplateEntity(
  mockTaskTemplateKey,
  `# {title}

**Status:** {status}

## Description

{description}
`,
);

export const mockTemplates: Templates = [mockTaskTemplate];
