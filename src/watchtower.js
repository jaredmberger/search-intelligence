// src/watchtower.js

import { reportSystemSuccess } from "./error-bus.js";

const SNAP = "snapshot:";
const LATEST = "watchtower:latest";
const INDEX = "watchtower:index";
const KEEP_DAYS = 210;

const ERROR_BUS_SOURCE = "Search Intelligence";
const ERROR_BUS_COMPONENT = "watchtower-snapshot";
const WATCHTOWER_MAX_AGE_MINUTES = 2160;

/**
 * Capture the current Watchtower Search Console snapshot.
 *
 * This function is intentionally concerned only with capturing/storing
 * Watchtower data. The caller decides whether the successful capture
 * should also emit an Error Bus heartbeat.
 */
export async function captureWatchtowerSnapshot(env) {
  if (!env.SEARCH_INTELLIGENCE_RECORDS) {
    throw new Error(
      "SEARCH_INTELLIGENCE_RECORDS KV binding is not configured."
    );
  }

  const token = await getAccessToken(env);
  const site = env.GSC_SITE_URL || "sc-domain:oceanliners.net";

  // Search Console final data generally trails the present date.
  // Keep the existing three-day offset used throughout Search Intelligence.
  const end = new Date(Date.now() - 3 * 864e5);
  const start = new Date(end.getTime() - 27 * 864e5);

  const body = {
    startDate: ymd(start),
    endDate: ymd(end),
    dimensions: ["query", "page"],
    type: "web",
    rowLimit: 25000,
    dataState: "final"
  };

  const data = await query(token, site, body);
  const rows = data.rows || [];

  const pages = summarizePages(rows).slice(0, 300);
  const queries = summarizeQueries(rows).slice(0, 500);

  const date = ymd(new Date());

  const snapshot = {
    date,
    capturedAt: new Date().toISOString(),
    range: {
      startDate: ymd(start),
      endDate: ymd(end)
    },
    pages,
    queries,
    totals: summarize(rows)
  };

  const previous = await latestSnapshot(env, date);
  const events = previous ? detectChanges(previous, snapshot) : [];

  snapshot.events = events;

  const index = await readIndex(env);

  const nextDates = [
    date,
    ...index.filter((d) => d !== date)
  ]
    .sort()
    .reverse();

  await env.SEARCH_INTELLIGENCE_RECORDS.put(
    SNAP + date,
    JSON.stringify(snapshot)
  );

  await env.SEARCH_INTELLIGENCE_RECORDS.put(
    LATEST,
    JSON.stringify({
      date,
      capturedAt: snapshot.capturedAt
    })
  );

  await env.SEARCH_INTELLIGENCE_RECORDS.put(
    INDEX,
    JSON.stringify(nextDates.slice(0, KEEP_DAYS + 15))
  );

  await pruneFromIndex(env, nextDates);

  return {
    ok: true,
    date,
    previousDate: previous?.date || null,
    eventCount: events.length,
    events,
    snapshot
  };
}

/**
 * HTTP handler for Watchtower.
 *
 * IMPORTANT:
 * A successful manual capture now records the same Error Bus success
 * heartbeat used by /api/ops-health.
 *
 * Previously:
 *   manual snapshot -> Watchtower KV updated
 *   scheduled snapshot -> Watchtower KV + Error Bus heartbeat updated
 *
 * Now:
 *   manual snapshot -> Watchtower KV + Error Bus heartbeat updated
 *   scheduled snapshot -> Watchtower KV + Error Bus heartbeat updated
 *
 * This allows Curator Ops to recover immediately after a successful
 * manual verification following an outage/authentication repair.
 */
export async function handleWatchtower(request, env) {
  if (!env.SEARCH_INTELLIGENCE_RECORDS) {
    return json(
      {
        ok: false,
        error: "SEARCH_INTELLIGENCE_RECORDS KV binding is not configured."
      },
      503
    );
  }

  const url = new URL(request.url);

  if (
    request.method === "POST" &&
    url.searchParams.get("action") === "capture"
  ) {
    try {
      const result = await captureWatchtowerSnapshot(env);

      // NEW:
      // A successful manual snapshot is now considered current proof
      // that the Watchtower capture pipeline is functioning.
      await reportSystemSuccess(env, {
        source: ERROR_BUS_SOURCE,
        component: ERROR_BUS_COMPONENT,
        message: "Watchtower snapshot completed successfully.",
        maxAgeMinutes: WATCHTOWER_MAX_AGE_MINUTES,
        context: {
          trigger: "manual",
          snapshotDate: result.date,
          previousDate: result.previousDate || "",
          eventCount: result.eventCount
        }
      });

      return json(result);
    } catch (error) {
      return json(
        {
          ok: false,
          error: error?.message || String(error)
        },
        502
      );
    }
  }

  if (url.searchParams.get("history") === "1") {
    return handleHistory(url, env);
  }

  const dates = await readIndex(env);
  const snapshots = [];

  for (const date of dates.slice(0, 35)) {
    const snapshot = await env.SEARCH_INTELLIGENCE_RECORDS.get(
      SNAP + date,
      "json"
    );

    if (snapshot) snapshots.push(snapshot);
  }

  let latest = snapshots[0] || null;

  if (!latest) {
    const pointer = await env.SEARCH_INTELLIGENCE_RECORDS.get(
      LATEST,
      "json"
    );

    if (pointer?.date) {
      latest = await env.SEARCH_INTELLIGENCE_RECORDS.get(
        SNAP + pointer.date,
        "json"
      );
    }
  }

  const events = [];

  for (const snapshot of snapshots.slice(0, 14)) {
    for (const event of snapshot.events || []) {
      events.push({
        ...event,
        snapshotDate: snapshot.date
      });
    }
  }

  if (
    latest &&
    !snapshots.some((snapshot) => snapshot.date === latest.date)
  ) {
    for (const event of latest.events || []) {
      events.push({
        ...event,
        snapshotDate: latest.date
      });
    }
  }

  events.sort(
    (a, b) =>
      (b.score || 0) - (a.score || 0) ||
      String(b.snapshotDate).localeCompare(String(a.snapshotDate))
  );

  return json({
    ok: true,
    snapshotCount: dates.length || (latest ? 1 : 0),
    latestDate: latest?.date || null,
    latestRange: latest?.range || null,
    latestTotals: latest?.totals || null,
    events: events.slice(0, 80),
    history: snapshots.map((snapshot) => ({
      date: snapshot.date,
      totals: snapshot.totals,
      eventCount: (snapshot.events || []).length
    }))
  });
}

async function handleHistory(url, env) {
  const page = normalizePath(url.searchParams.get("page") || "");
  const queryText = String(
    url.searchParams.get("query") || ""
  ).trim();

  const requested = Math.max(
    30,
    Math.min(
      210,
      Number(url.searchParams.get("days") || 90)
    )
  );

  if (!page && !queryText) {
    return json(
      {
        ok: false,
        error: "page or query is required."
      },
      400
    );
  }

  const cutoff = ymd(
    new Date(Date.now() - requested * 864e5)
  );

  const dates = (await readIndex(env))
    .filter((date) => date >= cutoff)
    .sort();

  const points = [];

  for (const date of dates) {
    const snapshot =
      await env.SEARCH_INTELLIGENCE_RECORDS.get(
        SNAP + date,
        "json"
      );

    if (!snapshot) continue;

    let item = null;

    if (queryText) {
      const matches = (snapshot.queries || []).filter(
        (query) =>
          query.query === queryText &&
          (!page || query.page === page)
      );

      if (matches.length) {
        const impressions = matches.reduce(
          (total, query) =>
            total + (query.impressions || 0),
          0
        );

        const clicks = matches.reduce(
          (total, query) =>
            total + (query.clicks || 0),
          0
        );

        const weightedPosition = matches.reduce(
          (total, query) =>
            total +
            (query.position || 0) *
              (query.impressions || 0),
          0
        );

        item = {
          clicks,
          impressions,
          ctr: impressions
            ? (clicks / impressions) * 100
            : 0,
          position: impressions
            ? weightedPosition / impressions
            : 0
        };
      }
    } else {
      item =
        (snapshot.pages || []).find(
          (candidate) => candidate.path === page
        ) || null;
    }

    if (item) {
      points.push({
        date: snapshot.date,
        capturedAt: snapshot.capturedAt,
        clicks: item.clicks || 0,
        impressions: item.impressions || 0,
        ctr: item.ctr || 0,
        position: item.position || 0
      });
    }
  }

  const milestones = [];

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];

    if (
      previous.position > 20 &&
      current.position <= 20
    ) {
      milestones.push({
        date: current.date,
        type: "top20",
        label: "Entered Top 20"
      });
    }

    if (
      previous.position > 10 &&
      current.position <= 10
    ) {
      milestones.push({
        date: current.date,
        type: "top10",
        label: "Entered Top 10"
      });
    }

    if (
      previous.position > 3 &&
      current.position <= 3
    ) {
      milestones.push({
        date: current.date,
        type: "top3",
        label: "Entered Top 3"
      });
    }

    if (
      previous.position <= 10 &&
      current.position > 10
    ) {
      milestones.push({
        date: current.date,
        type: "left10",
        label: "Left Top 10"
      });
    }
  }

  return json({
    ok: true,
    kind: queryText ? "query" : "page",
    page: page || null,
    query: queryText || null,
    days: requested,
    pointCount: points.length,
    points,
    milestones
  });
}

function detectChanges(previous, current) {
  const events = [];

  const previousPages = new Map(
    (previous.pages || []).map((item) => [
      item.path,
      item
    ])
  );

  const previousQueries = new Map(
    (previous.queries || []).map((item) => [
      item.query + "\n" + item.page,
      item
    ])
  );

  for (const item of current.pages || []) {
    const prior = previousPages.get(item.path);

    if (!prior) continue;

    const rankChange =
      prior.position - item.position;

    const impressionChangePercent =
      prior.impressions
        ? ((item.impressions - prior.impressions) /
            prior.impressions) *
          100
        : 0;

    if (
      prior.position > 10 &&
      item.position <= 10 &&
      item.impressions >= 20
    ) {
      events.push(
        createEvent(
          "top10-enter",
          "high",
          92,
          item.path,
          "Entered Google Top 10",
          `Average position improved from #${prior.position.toFixed(
            1
          )} to #${item.position.toFixed(1)}.`,
          item.path
        )
      );
    } else if (
      prior.position <= 10 &&
      item.position > 10 &&
      prior.impressions >= 20
    ) {
      events.push(
        createEvent(
          "top10-exit",
          "high",
          96,
          item.path,
          "Dropped out of Google Top 10",
          `Average position moved from #${prior.position.toFixed(
            1
          )} to #${item.position.toFixed(1)}.`,
          item.path
        )
      );
    } else if (
      rankChange >= 5 &&
      item.impressions >= 30
    ) {
      events.push(
        createEvent(
          "rank-rise",
          "medium",
          72 + Math.min(15, rankChange),
          item.path,
          "Meaningful ranking gain",
          `Average position improved ${rankChange.toFixed(
            1
          )} places to #${item.position.toFixed(1)}.`,
          item.path
        )
      );
    } else if (
      rankChange <= -5 &&
      prior.impressions >= 30
    ) {
      events.push(
        createEvent(
          "rank-drop",
          "high",
          82 + Math.min(14, Math.abs(rankChange)),
          item.path,
          "Meaningful ranking decline",
          `Average position fell ${Math.abs(
            rankChange
          ).toFixed(1)} places to #${item.position.toFixed(
            1
          )}.`,
          item.path
        )
      );
    }

    if (
      impressionChangePercent >= 60 &&
      item.impressions >= 75 &&
      item.clicks <= prior.clicks * 1.15
    ) {
      events.push(
        createEvent(
          "impression-surge",
          "medium",
          78,
          item.path,
          "Impressions surged without comparable click growth",
          `Impressions rose ${Math.round(
            impressionChangePercent
          )}% while clicks changed from ${prior.clicks} to ${
            item.clicks
          }.`,
          item.path
        )
      );
    }
  }

  for (const item of current.queries || []) {
    const prior = previousQueries.get(
      item.query + "\n" + item.page
    );

    if (
      !prior &&
      item.impressions >= 30 &&
      item.position <= 30
    ) {
      events.push(
        createEvent(
          "new-query",
          "medium",
          68,
          item.query,
          "New search visibility gaining traction",
          `${item.impressions} impressions at average position #${item.position.toFixed(
            1
          )} for ${item.page}.`,
          item.page,
          item.query
        )
      );
    } else if (
      prior &&
      prior.position > 10 &&
      item.position <= 10 &&
      item.impressions >= 15
    ) {
      events.push(
        createEvent(
          "query-top10",
          "high",
          88,
          item.query,
          "Query entered the Top 10",
          `Moved from #${prior.position.toFixed(
            1
          )} to #${item.position.toFixed(1)} for ${
            item.page
          }.`,
          item.page,
          item.query
        )
      );
    }
  }

  const deduplicated = new Map();

  for (const event of events) {
    const key =
      event.type +
      "|" +
      event.page +
      "|" +
      (event.query || "");

    if (
      !deduplicated.has(key) ||
      deduplicated.get(key).score < event.score
    ) {
      deduplicated.set(key, event);
    }
  }

  return [...deduplicated.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
}

function createEvent(
  type,
  severity,
  score,
  subject,
  title,
  detail,
  page,
  query = ""
) {
  return {
    type,
    severity,
    score,
    subject,
    title,
    detail,
    page,
    query
  };
}

function summarize(rows) {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;

  for (const row of rows) {
    clicks += row.clicks || 0;
    impressions += row.impressions || 0;

    weightedPosition +=
      (row.position || 0) *
      (row.impressions || 0);
  }

  return {
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
    ctr: impressions
      ? (clicks / impressions) * 100
      : 0,
    position: impressions
      ? weightedPosition / impressions
      : 0
  };
}

function summarizePages(rows) {
  const map = new Map();

  for (const row of rows) {
    const page = pathOf(row.keys?.[1] || "");

    if (!page) continue;

    const current =
      map.get(page) || {
        path: page,
        clicks: 0,
        impressions: 0,
        pos: 0
      };

    current.clicks += row.clicks || 0;
    current.impressions += row.impressions || 0;

    current.pos +=
      (row.position || 0) *
      (row.impressions || 0);

    map.set(page, current);
  }

  return [...map.values()]
    .map((item) => ({
      path: item.path,
      clicks: Math.round(item.clicks),
      impressions: Math.round(item.impressions),
      ctr: item.impressions
        ? (item.clicks / item.impressions) * 100
        : 0,
      position: item.impressions
        ? item.pos / item.impressions
        : 0
    }))
    .sort(
      (a, b) =>
        b.impressions - a.impressions
    );
}

function summarizeQueries(rows) {
  return rows
    .map((row) => ({
      query: String(row.keys?.[0] || ""),
      page: pathOf(row.keys?.[1] || ""),
      clicks: Math.round(row.clicks || 0),
      impressions: Math.round(
        row.impressions || 0
      ),
      ctr: (row.ctr || 0) * 100,
      position: row.position || 0
    }))
    .filter(
      (item) => item.query && item.page
    )
    .sort(
      (a, b) =>
        b.impressions - a.impressions
    );
}

async function readIndex(env) {
  const dates =
    await env.SEARCH_INTELLIGENCE_RECORDS.get(
      INDEX,
      "json"
    );

  if (
    Array.isArray(dates) &&
    dates.length
  ) {
    return dates
      .filter(Boolean)
      .sort()
      .reverse();
  }

  const list =
    await env.SEARCH_INTELLIGENCE_RECORDS.list({
      prefix: SNAP,
      limit: 1000
    });

  const recovered = list.keys
    .map((key) =>
      key.name.slice(SNAP.length)
    )
    .filter(Boolean)
    .sort()
    .reverse();

  if (recovered.length) {
    await env.SEARCH_INTELLIGENCE_RECORDS.put(
      INDEX,
      JSON.stringify(recovered)
    );
  }

  return recovered;
}

async function latestSnapshot(
  env,
  before
) {
  const dates = (await readIndex(env))
    .filter((date) => date < before)
    .sort()
    .reverse();

  if (dates[0]) {
    return env.SEARCH_INTELLIGENCE_RECORDS.get(
      SNAP + dates[0],
      "json"
    );
  }

  const pointer =
    await env.SEARCH_INTELLIGENCE_RECORDS.get(
      LATEST,
      "json"
    );

  if (
    pointer?.date &&
    pointer.date < before
  ) {
    return env.SEARCH_INTELLIGENCE_RECORDS.get(
      SNAP + pointer.date,
      "json"
    );
  }

  return null;
}

async function pruneFromIndex(
  env,
  dates
) {
  const cutoff = ymd(
    new Date(
      Date.now() -
        KEEP_DAYS * 864e5
    )
  );

  const keep = [];

  for (const date of dates) {
    if (date < cutoff) {
      await env.SEARCH_INTELLIGENCE_RECORDS.delete(
        SNAP + date
      );
    } else {
      keep.push(date);
    }
  }

  await env.SEARCH_INTELLIGENCE_RECORDS.put(
    INDEX,
    JSON.stringify(keep)
  );
}

async function getAccessToken(env) {
  if (
    !(
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REFRESH_TOKEN
    )
  ) {
    throw new Error(
      "Google credentials are not configured."
    );
  }

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token"
  });

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "content-type":
          "application/x-www-form-urlencoded"
      },
      body
    }
  );

  const data = await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      data.error_description ||
        data.error ||
        "Unable to refresh Google access token."
    );
  }

  return data.access_token;
}

async function query(
  token,
  site,
  body
) {
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
      site
    )}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        "Search Console API request failed."
    );
  }

  return data;
}

function normalizePath(value) {
  if (!value) return "";
  return pathOf(value);
}

function pathOf(value) {
  try {
    let path =
      new URL(
        value,
        "https://oceanliners.net"
      ).pathname || "/";

    path = path
      .replace(
        /\/index\.html?$/i,
        "/"
      )
      .replace(/\.html?$/i, "");

    return path.length > 1
      ? path.replace(/\/$/, "")
      : path;
  } catch {
    return String(value || "");
  }
}

function ymd(date) {
  return date
    .toISOString()
    .slice(0, 10);
}

function json(value, status = 200) {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}
