import {
  BLOCK_TEMPLATE_KEY,
  createTemplateEntity,
  DOCUMENT_TEMPLATE_KEY,
  PHRASE_TEMPLATE_KEY,
  SECTION_TEMPLATE_KEY,
  type Templates,
} from "./template-entity.ts";

export const mockTaskTemplateKey = "task-template";

export const mockTaskTemplate = createTemplateEntity(
  mockTaskTemplateKey,
  `# {title}

**Status:** {status}

## Description

{description}
`,
);

export const mockPhraseTemplate = createTemplateEntity(
  PHRASE_TEMPLATE_KEY,
  `{title}`,
  { templateFormat: "phrase" },
);

export const mockBlockTemplate = createTemplateEntity(
  BLOCK_TEMPLATE_KEY,
  `**{title}**\n\n{description}`,
  { templateFormat: "block" },
);

export const mockSectionTemplate = createTemplateEntity(
  SECTION_TEMPLATE_KEY,
  `### {title}\n\n{description}`,
  { templateFormat: "section" },
);

export const mockDocumentTemplate = createTemplateEntity(
  DOCUMENT_TEMPLATE_KEY,
  `# {title}

**Type:** {type}
**Key:** {key}

## Description

{description}`,
  { templateFormat: "document" },
);

export const mockPreambleTemplate = createTemplateEntity(
  "task-preamble",
  `# {title}

## Description

{description}
`,
  { preamble: ["status"] },
);

export const mockPreambleStatusInBodyTemplate = createTemplateEntity(
  "task-status-body",
  `# {title}

**Status:** {status}
`,
  { preamble: ["status"] },
);

export const mockDefaultTemplates: Templates = [
  mockPhraseTemplate,
  mockBlockTemplate,
  mockSectionTemplate,
  mockDocumentTemplate,
];

export const mockTemplates: Templates = [
  mockTaskTemplate,
  ...mockDefaultTemplates,
];
