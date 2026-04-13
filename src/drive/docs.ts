import type { DocsClient } from "../types.js";

interface DocumentContent {
  title: string;
  body: string;
  endIndex: number;
}

/**
 * Read a Google Doc and return its content as structured text.
 * Headings are prefixed with # markers, and each paragraph includes its index.
 */
export async function getDocument(docs: DocsClient, documentId: string): Promise<DocumentContent> {
  const res = await docs.documents.get({ documentId });
  const doc = res.data;
  const title = doc.title ?? "Untitled";
  const body = doc.body;

  if (!body?.content) {
    return { title, body: "", endIndex: 1 };
  }

  let text = "";
  let lastIndex = 1;

  for (const element of body.content) {
    if (element.paragraph) {
      const para = element.paragraph;
      const namedStyle = para.paragraphStyle?.namedStyleType;
      let prefix = "";

      if (namedStyle === "HEADING_1") prefix = "# ";
      else if (namedStyle === "HEADING_2") prefix = "## ";
      else if (namedStyle === "HEADING_3") prefix = "### ";
      else if (namedStyle === "HEADING_4") prefix = "#### ";
      else if (namedStyle === "HEADING_5") prefix = "##### ";
      else if (namedStyle === "HEADING_6") prefix = "###### ";

      let paraText = "";
      if (para.elements) {
        for (const el of para.elements) {
          if (el.textRun?.content) {
            paraText += el.textRun.content;
          }
        }
      }

      if (paraText.trim()) {
        text += `[index:${element.startIndex}] ${prefix}${paraText}`;
      } else if (paraText === "\n") {
        text += "\n";
      }
    } else if (element.table) {
      text += `[index:${element.startIndex}] [TABLE: ${element.table.rows} rows x ${element.table.columns} columns]\n`;
    }

    if (element.endIndex) {
      lastIndex = element.endIndex;
    }
  }

  return { title, body: text, endIndex: lastIndex };
}

/**
 * Append text at the end of a Google Doc.
 */
export async function appendText(
  docs: DocsClient,
  documentId: string,
  text: string,
): Promise<void> {
  // Get the document to find the end index
  const res = await docs.documents.get({ documentId });
  const endIndex = res.data.body?.content?.at(-1)?.endIndex ?? 1;

  // Insert before the last newline (endIndex - 1)
  const insertIndex = Math.max(1, endIndex - 1);

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            text: "\n" + text,
            location: { index: insertIndex },
          },
        },
      ],
    },
  });
}

/**
 * Insert text at a specific index in a Google Doc.
 */
export async function insertText(
  docs: DocsClient,
  documentId: string,
  text: string,
  index: number,
): Promise<void> {
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            text,
            location: { index },
          },
        },
      ],
    },
  });
}

/**
 * Find and replace all occurrences of text in a Google Doc.
 * Returns the number of replacements made.
 */
export async function replaceAllText(
  docs: DocsClient,
  documentId: string,
  findText: string,
  replaceText: string,
  matchCase: boolean = true,
): Promise<number> {
  const res = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          replaceAllText: {
            containsText: {
              text: findText,
              matchCase,
            },
            replaceText,
          },
        },
      ],
    },
  });

  const reply = res.data.replies?.[0]?.replaceAllText;
  return reply?.occurrencesChanged ?? 0;
}
