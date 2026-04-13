import type { SlidesClient } from "../types.js";

interface SlideContent {
  slideId: string;
  index: number;
  elements: { elementId: string; type: string; text: string }[];
}

interface PresentationContent {
  title: string;
  slidesCount: number;
  slides: SlideContent[];
}

/**
 * Extract text from a page element recursively.
 */
function extractText(element: Record<string, unknown>): string {
  const shape = element.shape as Record<string, unknown> | undefined;
  const table = element.table as Record<string, unknown> | undefined;

  if (shape?.text) {
    const textContent = shape.text as { textElements?: Array<{ textRun?: { content?: string } }> };
    return (textContent.textElements ?? [])
      .map((te) => te.textRun?.content ?? "")
      .join("");
  }

  if (table) {
    const tableRows = (table.tableRows ?? []) as Array<{
      tableCells?: Array<{ text?: { textElements?: Array<{ textRun?: { content?: string } }> } }>;
    }>;
    return tableRows
      .flatMap((row) =>
        (row.tableCells ?? []).map((cell) =>
          (cell.text?.textElements ?? []).map((te) => te.textRun?.content ?? "").join("")
        )
      )
      .join(" | ");
  }

  return "";
}

/**
 * Read a Google Slides presentation and return structured text content.
 */
export async function getPresentation(
  slides: SlidesClient,
  presentationId: string,
): Promise<PresentationContent> {
  const res = await slides.presentations.get({ presentationId });
  const pres = res.data;

  const slideContents: SlideContent[] = (pres.slides ?? []).map((slide, idx) => {
    const elements = (slide.pageElements ?? []).map((el) => {
      const elementId = el.objectId ?? "unknown";
      let type = "unknown";
      if (el.shape) type = "shape";
      else if (el.table) type = "table";
      else if (el.image) type = "image";
      else if (el.video) type = "video";

      const text = extractText(el as Record<string, unknown>);
      return { elementId, type, text };
    });

    return {
      slideId: slide.objectId ?? `slide_${idx}`,
      index: idx,
      elements,
    };
  });

  return {
    title: pres.title ?? "Untitled",
    slidesCount: pres.slides?.length ?? 0,
    slides: slideContents,
  };
}

/**
 * Add a new blank slide to a presentation.
 */
export async function addSlide(
  slides: SlidesClient,
  presentationId: string,
  insertionIndex?: number,
  layoutId?: string,
): Promise<string> {
  const request: Record<string, unknown> = {};
  if (insertionIndex !== undefined) request.insertionIndex = insertionIndex;
  if (layoutId) {
    request.slideLayoutReference = { layoutId };
  }

  const res = await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [{ createSlide: request }],
    },
  });

  const reply = res.data.replies?.[0]?.createSlide;
  return reply?.objectId ?? "unknown";
}

/**
 * Insert text into an existing shape/placeholder on a slide.
 */
export async function addTextToSlide(
  slides: SlidesClient,
  presentationId: string,
  elementId: string,
  text: string,
  insertionIndex?: number,
): Promise<void> {
  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [
        {
          insertText: {
            objectId: elementId,
            text,
            insertionIndex: insertionIndex ?? 0,
          },
        },
      ],
    },
  });
}

/**
 * Find and replace text across all slides in a presentation.
 * Returns the number of occurrences replaced.
 */
export async function replaceAllText(
  slides: SlidesClient,
  presentationId: string,
  findText: string,
  replaceText: string,
  matchCase: boolean = true,
): Promise<number> {
  const res = await slides.presentations.batchUpdate({
    presentationId,
    requestBody: {
      requests: [
        {
          replaceAllText: {
            containsText: { text: findText, matchCase },
            replaceText,
          },
        },
      ],
    },
  });

  const reply = res.data.replies?.[0]?.replaceAllText;
  return reply?.occurrencesChanged ?? 0;
}
