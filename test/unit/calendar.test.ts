// Contract tests for the Google Calendar tools (v1.3.0):
//  - calendar_list_events expands recurring events (singleEvents) and formats
//    timed, all-day and empty results.
//  - calendar_create_event builds correct start/end payloads: dateTime with the
//    default Europe/Madrid timezone (default duration 1h) for timed events, and
//    exclusive end dates for all-day events; maps reminders to overrides and
//    passes recurrence through.
//  - calendar_update_event patches ONLY the provided fields.
//  - calendar_delete_event deletes by id; API errors surface as isError, and an
//    insufficient-scope 403 tells the user to re-run the auth flow.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerCalendarListEventsTool } from "../../src/tools/calendar-list.js";
import { registerCalendarCreateEventTool } from "../../src/tools/calendar-create.js";
import { registerCalendarUpdateEventTool } from "../../src/tools/calendar-update.js";
import { registerCalendarDeleteEventTool } from "../../src/tools/calendar-delete.js";
import { captureToolHandler, textOf, makeApiError } from "./helpers.js";

interface CalendarMockCalls {
  lists: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
  patches: Array<Record<string, unknown>>;
  deletes: Array<Record<string, unknown>>;
}

function makeCalendarMock(opts: {
  listItems?: Array<Record<string, unknown>>;
  insertError?: Error;
  patchError?: Error;
  deleteError?: Error;
} = {}) {
  const calls: CalendarMockCalls = { lists: [], inserts: [], patches: [], deletes: [] };
  const calendar = {
    events: {
      async list(params: Record<string, unknown>) {
        calls.lists.push(params);
        return { data: { items: opts.listItems ?? [] } };
      },
      async insert(params: Record<string, unknown>) {
        calls.inserts.push(params);
        if (opts.insertError) throw opts.insertError;
        const body = params.requestBody as Record<string, unknown>;
        return { data: { id: "evt-new-1", htmlLink: "https://cal/link", ...body } };
      },
      async patch(params: Record<string, unknown>) {
        calls.patches.push(params);
        if (opts.patchError) throw opts.patchError;
        const body = params.requestBody as Record<string, unknown>;
        return { data: { id: params.eventId, ...body } };
      },
      async delete(params: Record<string, unknown>) {
        calls.deletes.push(params);
        if (opts.deleteError) throw opts.deleteError;
        return { data: undefined };
      },
    },
  };
  return { calendar, calls };
}

function handlerFor(register: unknown, calendar: unknown) {
  return captureToolHandler(
    register as (server: never, ...clients: never[]) => void,
    calendar,
  ).handler;
}

describe("calendar_list_events", () => {
  it("expands recurring events and orders by start time", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarListEventsTool, calendar);
    await handler({ timeMin: "2026-10-01T00:00:00Z", timeMax: "2026-10-31T23:59:59Z" });

    assert.equal(calls.lists.length, 1);
    assert.equal(calls.lists[0].calendarId, "primary");
    assert.equal(calls.lists[0].singleEvents, true);
    assert.equal(calls.lists[0].orderBy, "startTime");
    assert.equal(calls.lists[0].timeMin, "2026-10-01T00:00:00Z");
    assert.equal(calls.lists[0].timeMax, "2026-10-31T23:59:59Z");
  });

  it("formats timed and all-day events with their ids", async () => {
    const { calendar } = makeCalendarMock({
      listItems: [
        {
          id: "evt-1",
          summary: "Modelo 303 - 3T",
          start: { date: "2026-10-01" },
          end: { date: "2026-10-21" },
        },
        {
          id: "evt-2",
          summary: "Chequeo CEO M4397713",
          start: { dateTime: "2026-10-05T09:00:00+02:00" },
          end: { dateTime: "2026-10-05T09:15:00+02:00" },
        },
      ],
    });
    const handler = handlerFor(registerCalendarListEventsTool, calendar);
    const result = await handler({});
    const text = textOf(result);

    assert.ok(!result.isError);
    assert.match(text, /evt-1/);
    assert.match(text, /Modelo 303 - 3T/);
    assert.match(text, /2026-10-01/);
    assert.match(text, /evt-2/);
    assert.match(text, /2026-10-05T09:00:00\+02:00/);
  });

  it("reports an empty result clearly", async () => {
    const { calendar } = makeCalendarMock({ listItems: [] });
    const handler = handlerFor(registerCalendarListEventsTool, calendar);
    const text = textOf(await handler({}));
    assert.match(text, /No events found/);
  });
});

describe("calendar_create_event — timed events", () => {
  it("uses dateTime with the default Europe/Madrid timezone and a 1h default duration", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarCreateEventTool, calendar);
    const result = await handler({
      summary: "Chequeo CEO M4397713",
      start: "2026-08-24T09:00:00",
    });

    assert.ok(!result.isError, textOf(result));
    const body = calls.inserts[0].requestBody as Record<string, any>;
    assert.deepEqual(body.start, { dateTime: "2026-08-24T09:00:00", timeZone: "Europe/Madrid" });
    assert.deepEqual(body.end, { dateTime: "2026-08-24T10:00:00", timeZone: "Europe/Madrid" });
    assert.equal(body.reminders.useDefault, true);
    assert.match(textOf(result), /evt-new-1/);
  });

  it("maps reminders to overrides and passes recurrence through", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarCreateEventTool, calendar);
    await handler({
      summary: "Chequeo CEO M4397713",
      start: "2026-08-24T09:00:00",
      end: "2026-08-24T09:15:00",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      reminders: [{ method: "popup", minutes: 30 }],
    });

    const body = calls.inserts[0].requestBody as Record<string, any>;
    assert.deepEqual(body.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
    assert.deepEqual(body.reminders, {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    });
    assert.deepEqual(body.end, { dateTime: "2026-08-24T09:15:00", timeZone: "Europe/Madrid" });
  });
});

describe("calendar_create_event — all-day events", () => {
  it("uses date fields and an exclusive end one day after a single-day event", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarCreateEventTool, calendar);
    await handler({ summary: "Fin prioridad internacional", start: "2027-02-15", allDay: true });

    const body = calls.inserts[0].requestBody as Record<string, any>;
    assert.deepEqual(body.start, { date: "2027-02-15" });
    assert.deepEqual(body.end, { date: "2027-02-16" });
  });

  it("makes a user-supplied inclusive end date exclusive", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarCreateEventTool, calendar);
    await handler({
      summary: "Modelo 303 - 3T (plazo 1-20 oct)",
      start: "2026-10-01",
      end: "2026-10-20",
      allDay: true,
    });

    const body = calls.inserts[0].requestBody as Record<string, any>;
    assert.deepEqual(body.start, { date: "2026-10-01" });
    // Calendar API end dates are exclusive: an event through the 20th ends on the 21st.
    assert.deepEqual(body.end, { date: "2026-10-21" });
  });

  it("rejects a timed start when allDay is set", async () => {
    const { calendar } = makeCalendarMock();
    const handler = handlerFor(registerCalendarCreateEventTool, calendar);
    const result = await handler({ summary: "X", start: "2026-10-01T09:00:00", allDay: true });
    assert.ok(result.isError);
    assert.match(textOf(result), /YYYY-MM-DD/);
  });
});

describe("calendar_update_event", () => {
  it("patches only the provided fields", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarUpdateEventTool, calendar);
    const result = await handler({ eventId: "evt-9", summary: "Nuevo título" });

    assert.ok(!result.isError, textOf(result));
    assert.equal(calls.patches[0].eventId, "evt-9");
    assert.equal(calls.patches[0].calendarId, "primary");
    const body = calls.patches[0].requestBody as Record<string, any>;
    assert.deepEqual(Object.keys(body), ["summary"]);
    assert.equal(body.summary, "Nuevo título");
  });

  it("rebuilds start/end when rescheduling a timed event", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarUpdateEventTool, calendar);
    await handler({ eventId: "evt-9", start: "2026-09-14T10:00:00", end: "2026-09-14T10:30:00" });

    const body = calls.patches[0].requestBody as Record<string, any>;
    assert.deepEqual(body.start, { dateTime: "2026-09-14T10:00:00", timeZone: "Europe/Madrid" });
    assert.deepEqual(body.end, { dateTime: "2026-09-14T10:30:00", timeZone: "Europe/Madrid" });
  });
});

describe("calendar_delete_event", () => {
  it("deletes by calendar and event id", async () => {
    const { calendar, calls } = makeCalendarMock();
    const handler = handlerFor(registerCalendarDeleteEventTool, calendar);
    const result = await handler({ eventId: "evt-9" });

    assert.ok(!result.isError, textOf(result));
    assert.deepEqual(calls.deletes[0], { calendarId: "primary", eventId: "evt-9" });
  });

  it("surfaces API errors as isError", async () => {
    const { calendar } = makeCalendarMock({ deleteError: makeApiError(404, "Not Found") });
    const handler = handlerFor(registerCalendarDeleteEventTool, calendar);
    const result = await handler({ eventId: "evt-missing" });
    assert.ok(result.isError);
    assert.match(textOf(result), /Not Found/);
  });
});

describe("insufficient OAuth scope", () => {
  it("tells the user to re-run the auth flow on a 403 insufficientPermissions", async () => {
    const { calendar } = makeCalendarMock({
      insertError: makeApiError(403, "Request had insufficient authentication scopes.", "insufficientPermissions"),
    });
    const handler = handlerFor(registerCalendarCreateEventTool, calendar);
    const result = await handler({ summary: "X", start: "2026-10-01", allDay: true });

    assert.ok(result.isError);
    assert.match(textOf(result), /auth/i);
    assert.match(textOf(result), /scope/i);
  });
});
