import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CalendarClient } from "../types.js";
import { deleteEvent, calendarErrorMessage } from "../drive/calendar.js";

const inputSchema = {
  calendarId: z.string().optional().describe("Calendar ID. Defaults to 'primary'."),
  eventId: z.string().describe("ID of the event to delete (from calendar_list_events). Deleting a recurring event's parent removes ALL its instances."),
};

export function registerCalendarDeleteEventTool(server: McpServer, calendar: CalendarClient): void {
  server.tool(
    "calendar_delete_event",
    "Delete a Google Calendar event by ID. Deleting a recurring event removes all its instances.",
    inputSchema,
    async (args) => {
      try {
        await deleteEvent(calendar, args.calendarId ?? "primary", args.eventId);
        return {
          content: [{ type: "text" as const, text: `Event ${args.eventId} deleted.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting event: ${calendarErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
