import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { calendar_v3 } from "googleapis";
import type { CalendarClient } from "../types.js";
import {
  DEFAULT_TIMEZONE,
  addOneHour,
  allDayPoint,
  calendarErrorMessage,
  createEvent,
  exclusiveEndDate,
  remindersPayload,
  timedPoint,
} from "../drive/calendar.js";

const inputSchema = {
  calendarId: z.string().optional().describe("Calendar ID. Defaults to 'primary'."),
  summary: z.string().describe("Event title."),
  description: z.string().optional().describe("Event description (plain text)."),
  location: z.string().optional().describe("Event location."),
  start: z.string().describe("Start: 'YYYY-MM-DDTHH:mm[:ss]' for timed events, 'YYYY-MM-DD' with allDay: true for all-day events."),
  end: z.string().optional().describe("End, same format as start. Timed events default to 1 hour after start. All-day end dates are INCLUSIVE (the event's last day)."),
  allDay: z.boolean().optional().describe("Set true for all-day events (start/end must then be 'YYYY-MM-DD')."),
  timeZone: z.string().optional().describe(`IANA timezone for timed events. Default: ${DEFAULT_TIMEZONE}.`),
  recurrence: z.array(z.string()).optional().describe("RRULE lines for recurring events, e.g. ['RRULE:FREQ=WEEKLY;BYDAY=MO']."),
  reminders: z
    .array(z.object({ method: z.enum(["popup", "email"]), minutes: z.number() }))
    .optional()
    .describe("Reminder overrides (minutes before start). Omit to use the calendar's defaults."),
};

export function registerCalendarCreateEventTool(server: McpServer, calendar: CalendarClient): void {
  server.tool(
    "calendar_create_event",
    "Create a Google Calendar event: timed or all-day, with optional recurrence (RRULE) and reminders. All-day end dates are inclusive (the tool converts to the API's exclusive convention).",
    inputSchema,
    async (args) => {
      try {
        const timeZone = args.timeZone ?? DEFAULT_TIMEZONE;
        let start: calendar_v3.Schema$EventDateTime;
        let end: calendar_v3.Schema$EventDateTime;
        if (args.allDay) {
          start = allDayPoint(args.start);
          end = { date: exclusiveEndDate(args.end ?? args.start) };
        } else {
          start = timedPoint(args.start, timeZone);
          end = timedPoint(args.end ?? addOneHour(args.start), timeZone);
        }
        const event: calendar_v3.Schema$Event = {
          summary: args.summary,
          ...(args.description !== undefined && { description: args.description }),
          ...(args.location !== undefined && { location: args.location }),
          start,
          end,
          ...(args.recurrence !== undefined && { recurrence: args.recurrence }),
          reminders: remindersPayload(args.reminders),
        };
        const created = await createEvent(calendar, args.calendarId ?? "primary", event);
        return {
          content: [{
            type: "text" as const,
            text: `Event created.\nID: ${created.id}\nTitle: ${created.summary}\n${created.htmlLink ?? ""}`.trimEnd(),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating event: ${calendarErrorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}
