import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { calendar_v3 } from "googleapis";
import type { CalendarClient } from "../types.js";
import {
  DEFAULT_TIMEZONE,
  allDayPoint,
  calendarErrorMessage,
  exclusiveEndDate,
  remindersPayload,
  timedPoint,
  updateEvent,
} from "../drive/calendar.js";

const inputSchema = {
  calendarId: z.string().optional().describe("Calendar ID. Defaults to 'primary'."),
  eventId: z.string().describe("ID of the event to update (from calendar_list_events)."),
  summary: z.string().optional().describe("New title."),
  description: z.string().optional().describe("New description."),
  location: z.string().optional().describe("New location."),
  start: z.string().optional().describe("New start: 'YYYY-MM-DDTHH:mm[:ss]' (timed) or 'YYYY-MM-DD' with allDay: true."),
  end: z.string().optional().describe("New end, same format as start. All-day end dates are INCLUSIVE."),
  allDay: z.boolean().optional().describe("Set true when start/end are all-day dates ('YYYY-MM-DD')."),
  timeZone: z.string().optional().describe(`IANA timezone for timed events. Default: ${DEFAULT_TIMEZONE}.`),
  recurrence: z.array(z.string()).optional().describe("New RRULE lines (replaces existing recurrence)."),
  reminders: z
    .array(z.object({ method: z.enum(["popup", "email"]), minutes: z.number() }))
    .optional()
    .describe("New reminder overrides. Omit to leave reminders unchanged."),
};

export function registerCalendarUpdateEventTool(server: McpServer, calendar: CalendarClient): void {
  server.tool(
    "calendar_update_event",
    "Update fields of an existing Google Calendar event (patch semantics: only the provided fields change).",
    inputSchema,
    async (args) => {
      try {
        const timeZone = args.timeZone ?? DEFAULT_TIMEZONE;
        const patch: calendar_v3.Schema$Event = {};
        if (args.summary !== undefined) patch.summary = args.summary;
        if (args.description !== undefined) patch.description = args.description;
        if (args.location !== undefined) patch.location = args.location;
        if (args.start !== undefined) {
          patch.start = args.allDay ? allDayPoint(args.start) : timedPoint(args.start, timeZone);
        }
        if (args.end !== undefined) {
          patch.end = args.allDay ? { date: exclusiveEndDate(args.end) } : timedPoint(args.end, timeZone);
        }
        if (args.recurrence !== undefined) patch.recurrence = args.recurrence;
        if (args.reminders !== undefined) patch.reminders = remindersPayload(args.reminders);
        if (Object.keys(patch).length === 0) {
          return {
            content: [{ type: "text" as const, text: "Nothing to update: provide at least one field to change." }],
            isError: true,
          };
        }
        const updated = await updateEvent(calendar, args.calendarId ?? "primary", args.eventId, patch);
        return {
          content: [{ type: "text" as const, text: `Event updated.\nID: ${updated.id}\nTitle: ${updated.summary ?? "(unchanged)"}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating event: ${calendarErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
