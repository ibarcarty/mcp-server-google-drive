import type { calendar_v3 } from "googleapis";
import type { CalendarClient } from "../types.js";

export const DEFAULT_TIMEZONE = "Europe/Madrid";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export interface ReminderInput {
  method: "popup" | "email";
  minutes: number;
}

/**
 * Build the start/end payload for a timed event point.
 */
export function timedPoint(dateTime: string, timeZone: string): calendar_v3.Schema$EventDateTime {
  if (!DATE_TIME.test(dateTime)) {
    throw new Error(
      `Invalid dateTime '${dateTime}'. Timed events need 'YYYY-MM-DDTHH:mm[:ss]' (e.g. '2026-10-05T09:00:00'). For all-day events pass allDay: true with a 'YYYY-MM-DD' date.`,
    );
  }
  return { dateTime, timeZone };
}

/**
 * Build the start/end payload for an all-day event point.
 */
export function allDayPoint(date: string): calendar_v3.Schema$EventDateTime {
  if (!DATE_ONLY.test(date)) {
    throw new Error(
      `Invalid all-day date '${date}'. All-day events need 'YYYY-MM-DD' (no time part). For timed events omit allDay and pass 'YYYY-MM-DDTHH:mm[:ss]'.`,
    );
  }
  return { date };
}

/**
 * The Calendar API treats all-day end dates as EXCLUSIVE. Users think inclusively
 * ("through the 20th"), so we add one day to the last day of the event.
 */
export function exclusiveEndDate(inclusiveLastDay: string): string {
  if (!DATE_ONLY.test(inclusiveLastDay)) {
    throw new Error(`Invalid all-day date '${inclusiveLastDay}'. Expected 'YYYY-MM-DD'.`);
  }
  const d = new Date(`${inclusiveLastDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Add one hour to a naive dateTime string ('YYYY-MM-DDTHH:mm[:ss]' with an
 * optional trailing offset, which is preserved verbatim).
 */
export function addOneHour(dateTime: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(dateTime);
  if (!m) throw new Error(`Invalid dateTime '${dateTime}'. Expected 'YYYY-MM-DDTHH:mm[:ss]'.`);
  const suffix = dateTime.slice(m[0].length);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0));
  d.setUTCHours(d.getUTCHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const out = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return out + suffix;
}

/**
 * Map the tool-level reminders input to the Calendar API shape. No input means
 * "use the calendar's default reminders".
 */
export function remindersPayload(reminders?: ReminderInput[]): calendar_v3.Schema$Event["reminders"] {
  if (!reminders || reminders.length === 0) return { useDefault: true };
  return { useDefault: false, overrides: reminders };
}

export interface ListEventsOptions {
  calendarId: string;
  timeMin?: string;
  timeMax?: string;
  query?: string;
  maxResults?: number;
}

/**
 * List events, expanding recurring events into instances ordered by start time.
 */
export async function listEvents(
  calendar: CalendarClient,
  opts: ListEventsOptions,
): Promise<calendar_v3.Schema$Event[]> {
  const res = await calendar.events.list({
    calendarId: opts.calendarId,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    q: opts.query,
    maxResults: opts.maxResults ?? 50,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items ?? [];
}

export async function createEvent(
  calendar: CalendarClient,
  calendarId: string,
  event: calendar_v3.Schema$Event,
): Promise<calendar_v3.Schema$Event> {
  const res = await calendar.events.insert({ calendarId, requestBody: event });
  return res.data;
}

export async function updateEvent(
  calendar: CalendarClient,
  calendarId: string,
  eventId: string,
  patch: calendar_v3.Schema$Event,
): Promise<calendar_v3.Schema$Event> {
  const res = await calendar.events.patch({ calendarId, eventId, requestBody: patch });
  return res.data;
}

export async function deleteEvent(
  calendar: CalendarClient,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await calendar.events.delete({ calendarId, eventId });
}

/**
 * Format a Calendar API error for the tool response. A 403 for missing scopes
 * gets an actionable hint: the saved token predates the calendar scope.
 */
export function calendarErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: number }).code;
  const reasons = ((error as { errors?: Array<{ reason?: string }> }).errors ?? [])
    .map((e) => e.reason)
    .filter(Boolean);
  if (code === 403 && (reasons.includes("insufficientPermissions") || /insufficient.*scope/i.test(msg))) {
    return (
      `${msg}\n` +
      `The saved OAuth token does not include the Google Calendar scope. ` +
      `Re-run the auth flow to grant it (node dist/index.js auth, or npx @ibarcarty/mcp-server-google-drive auth) ` +
      `and make sure the Google Calendar API is enabled in your GCP project.`
    );
  }
  return msg;
}
