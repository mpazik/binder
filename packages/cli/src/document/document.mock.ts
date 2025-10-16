import { newIsoTimestamp } from "@binder/utils";
import type { NodeUid, TransactionInput } from "@binder/db";

export const mockDocumentUid = "BNupvr3JwPl" as NodeUid;
export const mockSection1Uid = "n1G4RYLpqCy" as NodeUid;
export const mockParagraph1Uid = "3sbJjrIXR0h" as NodeUid;
export const mockSection2Uid = "7KNebjPGCil" as NodeUid;
export const mockParagraph2Uid = "DsftL7GkTQ3" as NodeUid;
export const mockListUid = "xGXwraeyMHz" as NodeUid;
export const mockListItem1Uid = "izziT9iRMnm" as NodeUid;
export const mockListItem2Uid = "ZYMH25QeU45" as NodeUid;
export const mockListItem3Uid = "B92AgfCR6aH" as NodeUid;
export const mockDataviewUid = "qVw8YnKpRTz" as NodeUid;
export const mockSection3Uid = "5l8giR3SJl0" as NodeUid;
export const mockParagraph3Uid = "XKQe9TqpFTL" as NodeUid;
export const mockParagraph4Uid = "dh44jbz45rm" as NodeUid;

export const mockDocumentTransactionInput = {
  author: "test",
  createdAt: newIsoTimestamp("2024-01-01"),
  nodes: [
    {
      uid: mockDocumentUid,
      type: "Document",
      path: "simple.md",
      blockContent: [mockSection1Uid, mockSection2Uid, mockSection3Uid],
    },
    {
      uid: mockSection1Uid,
      type: "Section",
      title: "Simple Markdown Document",
      blockContent: [mockParagraph1Uid],
    },
    {
      uid: mockParagraph1Uid,
      type: "Paragraph",
      textContent: "This is a simple markdown document.",
    },
    {
      uid: mockSection2Uid,
      type: "Section",
      title: "Key Features",
      blockContent: [mockParagraph2Uid, mockListUid, mockDataviewUid],
    },
    {
      uid: mockParagraph2Uid,
      type: "Paragraph",
      textContent: "Supports:",
    },
    {
      uid: mockListUid,
      type: "List",
      blockContent: [mockListItem1Uid, mockListItem2Uid, mockListItem3Uid],
    },
    {
      uid: mockListItem1Uid,
      type: "ListItem",
      textContent: "**Bold** text for emphasis",
    },
    {
      uid: mockListItem2Uid,
      type: "ListItem",
      textContent: "_Italic_ text for subtle emphasis",
    },
    {
      uid: mockListItem3Uid,
      type: "ListItem",
      textContent: "`Code snippets` for technical content",
    },
    {
      uid: mockDataviewUid,
      type: "Dataview",
      query: "type=Task",
      template: "**{{title}}**: {{description}}",
    },
    {
      uid: mockSection3Uid,
      type: "Section",
      title: "Paragraphs",
      blockContent: [mockParagraph3Uid, mockParagraph4Uid],
    },
    {
      uid: mockParagraph3Uid,
      type: "Paragraph",
      textContent: "Paragraphs separated by blank lines for readability.",
    },
    {
      uid: mockParagraph4Uid,
      type: "Paragraph",
      textContent: "Inline formatting like bold,\nitalics, code possible.",
    },
  ] as any,
  configurations: [],
} as const satisfies TransactionInput;
