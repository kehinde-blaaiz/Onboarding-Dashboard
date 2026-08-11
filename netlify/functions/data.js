// Blaaiz Onboarding Dashboard — live data function.
//
// Called by index.html on every page load and every click of the Refresh button.
// Reads the Asana project server-side (token never reaches the browser) and returns
// the same account shape the dashboard used to have hardcoded — but computed fresh,
// every time, straight from Asana.
//
// Required environment variable (set in Netlify → Site configuration → Environment variables):
//   ASANA_TOKEN            Personal access token or Service Account token with read access
//                           to the "Duplicate of Sales Relationship update" project.
//
// Optional overrides (defaults point at the current sheet):
//   ASANA_PROJECT_GID      default 1217359825300808
//   ASANA_STATE_TASK_GID   default 1217362985782724  ([SYSTEM] Stage Tracking State task)

const ASANA_API = "https://app.asana.com/api/1.0";
const DEFAULT_PROJECT_GID = "1217359825300808";
const DEFAULT_STATE_TASK_GID = "1217362985782724";
const FALLBACK_SINCE = "2026-08-11"; // day tracking began; used only if a task is missing from state

const FIELD_NAMES = {
  sector: "Sector",
  needs: "Needs",
  status: "Status",
  tpv: "TPV (Weekly)",
  revenue: "Revenue (Weekly)",
  am: "AM",
};

async function asanaGet(path, token) {
  const res = await fetch(`${ASANA_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message || res.statusText;
    throw new Error(`Asana API error (${res.status}) on ${path}: ${msg}`);
  }
  return body.data;
}

function customFieldValue(task, fieldName) {
  const cf = (task.custom_fields || []).find(f => f.name === fieldName);
  if (!cf) return "";
  return cf.display_value || "";
}

function sectionName(task) {
  const membership = (task.memberships || [])[0];
  return membership?.section?.name || "";
}

// --- Classification rules -------------------------------------------------
// These mirror the manual cleanup rules documented in the dashboard's "Setup log"
// panel: infer track from Needs, infer stage from Status text, flag anything the
// rules can't place confidently instead of guessing silently.

function inferTrack(needsRaw) {
  const needs = (needsRaw || "").toLowerCase();
  if (!needs || needs === "—" || needs === "-") {
    return { track: "Business", flagTrack: true };
  }
  if (needs.includes("blaaizpay") || needs.includes("blaaiz pay")) {
    return { track: "Blaaizpay", flagTrack: false };
  }
  if (needs.includes("platform") || needs.includes("platfrom")) { // "platfrom" typo seen in the sheet
    return { track: "Platform", flagTrack: false };
  }
  return { track: "Business", flagTrack: false };
}

const STAGE_KEYWORDS = [
  { re: /\blive\b|transact|onboarded|active/i, stage: "Live" },
  { re: /viban.*(enable|progress|setup)|enablement/i, stage: "VIBAN Enablement" },
  { re: /integration|testing/i, stage: "Integration & Testing" },
  { re: /whitelist/i, stage: "Ops Whitelisting" },
  { re: /negotiat|awaiting invoice|contract|pricing/i, stage: "Negotiating" },
  { re: /kyb|kyc|compliance|review|onboarding/i, stage: "Compliance Review" },
  { re: /conversion|conversation|lead|prospect|intro/i, stage: "Conversation" },
];

function inferStage(statusRaw, section, track) {
  const status = (statusRaw || "").trim();
  const stages = STAGE_ROUTE[track] || STAGE_ROUTE.Business;
  if (!status) {
    return { stage: section === "Pipeline" ? "Conversation" : "Compliance Review", flagNote: "No Status value recorded on this task — stage defaulted, worth a real look." };
  }
  for (const { re, stage } of STAGE_KEYWORDS) {
    if (re.test(status) && stages.includes(stage)) {
      return { stage, flagNote: null };
    }
  }
  // Nothing matched a known keyword — default by section, and flag it.
  return {
    stage: section === "Pipeline" ? "Conversation" : "Compliance Review",
    flagNote: `Status "${status}" didn't match a known stage keyword — defaulted, worth a real look.`,
  };
}

// Kept as a lookup alongside the dashboard's own stagesByTrack so this file can
// validate a matched stage actually belongs to the account's track.
const STAGE_ROUTE = {
  Business: ["Conversation", "Compliance Review", "Negotiating", "VIBAN Enablement", "Live"],
  Platform: ["Conversation", "Compliance Review", "Negotiating", "Ops Whitelisting", "Integration & Testing", "Live"],
  Blaaizpay: ["Conversation", "Compliance Review", "Negotiating", "Integration & Testing", "Live"],
};

function inferArchiveReason(statusRaw) {
  const status = (statusRaw || "");
  const match = status.match(/^(.*?)\s*\(Archived\)\s*$/i);
  if (match && match[1].trim()) return match[1].trim();
  return "Archived";
}

function parseStateNotes(notes) {
  const start = notes.indexOf("STATE_JSON_START");
  const end = notes.indexOf("STATE_JSON_END");
  if (start === -1 || end === -1 || end < start) return {};
  const jsonText = notes.slice(start + "STATE_JSON_START".length, end).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return {};
  }
}

exports.handler = async () => {
  const token = process.env.ASANA_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ASANA_TOKEN is not set. Add it in Netlify → Site configuration → Environment variables, then redeploy or retry." }),
    };
  }
  const projectGid = process.env.ASANA_PROJECT_GID || DEFAULT_PROJECT_GID;
  const stateTaskGid = process.env.ASANA_STATE_TASK_GID || DEFAULT_STATE_TASK_GID;

  try {
    const [tasks, stateTask] = await Promise.all([
      asanaGet(
        `/projects/${projectGid}/tasks?opt_fields=` +
          encodeURIComponent(
            "name,completed,assignee.name,memberships.section.name,custom_fields.name,custom_fields.display_value"
          ),
        token
      ),
      asanaGet(`/tasks/${stateTaskGid}?opt_fields=notes,modified_at`, token).catch(() => null),
    ]);

    const stateMap = stateTask ? parseStateNotes(stateTask.notes || "") : {};

    const accounts = tasks
      .filter(t => !t.name.startsWith("[SYSTEM]"))
      .map(task => {
        const section = sectionName(task).toUpperCase().includes("PIPELINE") ? "Pipeline" : "Onboarding";
        const sector = customFieldValue(task, FIELD_NAMES.sector) || "—";
        const needsRaw = customFieldValue(task, FIELD_NAMES.needs);
        const statusRaw = customFieldValue(task, FIELD_NAMES.status);
        const tpv = customFieldValue(task, FIELD_NAMES.tpv) || customFieldValue(task, FIELD_NAMES.revenue) || "";
        const amField = customFieldValue(task, FIELD_NAMES.am);
        const am = task.assignee?.name || amField || "";

        const { track, flagTrack } = inferTrack(needsRaw);
        const archived = task.completed === true || /\(archived\)/i.test(statusRaw);
        const reactivating = /reactivat|reestablish/i.test(statusRaw);
        const { stage, flagNote } = inferStage(statusRaw, section, track);
        const since = stateMap[task.gid]?.since || FALLBACK_SINCE;

        const account = {
          name: task.name,
          sector,
          needs: needsRaw || "—",
          section,
          track,
          stage,
          am,
          tpv,
          since,
        };
        if (reactivating) account.reactivating = true;
        if (archived) {
          account.archived = true;
          account.archiveReason = inferArchiveReason(statusRaw);
        }
        if (flagTrack) account.flagTrack = true;
        if (flagNote) account.flagNote = flagNote;
        return account;
      });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        accounts,
        lastUpdated: new Date().toISOString(),
        stateLastUpdated: stateTask?.modified_at || null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || String(err) }),
    };
  }
};
