import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalendarClient } from "../types.js";
import { listEvents, calendarErrorMessage } from "../drive/calendar.js";

const inputSchema = {
  calendarId: z.string().optional().describe("Calendar ID. Defaults to 'primary' (the authenticated user's main calendar)."),
  timeMin: z.string().optional().describe("Only events starting at or after this time. RFC3339, e.g. '2026-10-01T00:00:00Z' or '2026-10-01T00:00:00+02:00'."),
  timeMax: z.string().optional().describe("Only events starting before this time. RFC3339."),
  query: z.string().optional().describe("Free-text search over summary, description, location and attendees."),
  maxResults: z.number().optional().describe("Maximum number of events to return (default 50, max 2500)."),
};

export function registerCalendarListEventsTool(server: McpServer, calendar: CalendarClient): void {
  server.tool(
    "calendar_list_events",
    "List Google Calendar events in a time window, with recurring events expanded into individual instances ordered by start time. Returns event IDs needed by the update/delete tools.",
    inputSchema,
    async (args) => {
      try {
        const events = await listEvents(calendar, {
          calendarId: args.calendarId ?? "primary",
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          query: args.query,
          maxResults: args.maxResults,
        });
        if (events.length === 0) {
          return { content: [{ type: "text" as const, text: "No events found in the given window." }] };
        }
        const lines = events.map((e) => {
          const start = e.start?.dateTime ?? e.start?.date ?? "?";
          const end = e.end?.dateTime ?? e.end?.date ?? "?";
          const allDay = e.start?.date ? " (all-day)" : "";
          const location = e.location ? ` · ${e.location}` : "";
          return `- [${e.id}] ${start} → ${end}${allDay} · ${e.summary ?? "(no title)"}${location}`;
        });
        return {
          content: [{ type: "text" as const, text: `${events.length} event(s):\n${lines.join("\n")}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing events: ${calendarErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
