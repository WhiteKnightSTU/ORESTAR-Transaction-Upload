/* ============================================================
   ORESTAR code tables — sourced from the Secretary of State's
   published XML Specification / XSD (cf_xsd.xsd, xml_overview.pdf).
   ============================================================ */
const TYPE_CODE = {
  "Contributions": "C",
  "Other Account Receivable": "OA",
  "Other Receipt": "OR",
  "Expenditures": "E",
  "Other Disbursements": "OD"
};

const SUBTYPE_OPTIONS = {
  "C":  [["CA","Cash Contribution"],["IK","In-Kind"],["IKP","In-Kind/Forgiven Personal Expenditure"],
         ["IKA","In-Kind/Forgiven Account Payable"],["NLR","Loan Received (Non-Exempt)"],
         ["PL","Pledge of Loan"],["PI","Pledge of In-Kind"],["PC","Pledge of Cash"]],
  "OR": [["ELR","Loan Received (Exempt)"],["FM","Items Sold at Fair Market Value"],["IN","Interest/Investment Income"],
         ["OM","Miscellaneous (Need Description)"],["RF","Refunds and Rebates"],["LC","Lost or Returned Check"]],
  "OA": [["OR","Other Account Receivable"]],
  "E":  [["AE","Expenditure Made by an Agent"],["PE","Personal Expenditure"],["CE","Cash Expenditure"],
         ["AP","Account Payable"],["NLP","Loan Payment (Non-Exempt)"]],
  "OD": [["ELP","Loan Payment (Exempt)"],["NP","Nonpartisan Activity"],["OMD","Miscellaneous (Need Description)"],
         ["RT","Return of Refund of Contributions"]]
};

const DEFAULT_SUBTYPE = { "C": "CA", "OA": "OR", "OR": "OM", "E": "CE", "OD": "OMD" };

const SUBTYPE_TEXT_TO_CODE = {
  "Cash Contribution": "CA",
  "In-Kind Contribution": "IK",
  "In-Kind/Forgiven Personal Expenditures": "IKP",
  "In-Kind/Forgiven Account Payable": "IKA",
  "Loan Received (Non-Exempt)": "NLR"
};

// Confirmed from the actual XSD's <tran-purpose> enumeration, cross-referenced
// with descriptions from the SOS's own XML Overview doc where available.
// "H" and "X" are valid per the schema but weren't in that (2006) doc — their
// meaning is unconfirmed.
const TRAN_PURPOSE_CODES = {
  "A": { label: "Agent", requiresDescription: false },
  "B": { label: "Broadcast Advertising (radio, TV)", requiresDescription: false },
  "C": { label: "Cash Contributions", requiresDescription: false },
  "E": { label: "Loan Extended", requiresDescription: false },
  "F": { label: "Fundraising Event Expenses", requiresDescription: false },
  "G": { label: "General Operational Expenses", requiresDescription: true },
  "H": { label: "(undocumented)", requiresDescription: false },
  "I": { label: "Interest Payment", requiresDescription: false },
  "L": { label: "Literature, Brochures, Printing", requiresDescription: false },
  "M": { label: "Management Services", requiresDescription: false },
  "N": { label: "Newspaper and Other Periodical Advertising", requiresDescription: false },
  "O": { label: "Other Advertising (yard signs, buttons, etc.)", requiresDescription: false },
  "P": { label: "Postage", requiresDescription: false },
  "R": { label: "Reimbursement for Personal Expenditures", requiresDescription: false },
  "S": { label: "Surveys and Polls", requiresDescription: false },
  "T": { label: "Travel Expenses", requiresDescription: true },
  "U": { label: "Utilities", requiresDescription: false },
  "W": { label: "Wages, Salaries, Benefits", requiresDescription: false },
  "X": { label: "(undocumented)", requiresDescription: false },
  "Y": { label: "Petition Circulators", requiresDescription: false },
  "Z": { label: "Preparation and Production of Advertising", requiresDescription: false }
};

// Accepts either the raw single-letter code ("G") or the full descriptive
// label ("General Operational Expenses") and returns the code — the custom
// field may be set up to store either, and this handles both rather than
// assuming the field only ever contains bare codes.
function mapTranPurposeToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (TRAN_PURPOSE_CODES[upper]) return upper;
  const lower = trimmed.toLowerCase();
  for (const code in TRAN_PURPOSE_CODES) {
    if (TRAN_PURPOSE_CODES[code].label.toLowerCase() === lower) return code;
  }
  return null;
}

// Several labels contain commas themselves ("Other Advertising (yard signs,
// buttons, etc.)", "Literature, Brochures, Printing") — splitting on comma
// unconditionally chopped these into garbage fragments. Try the whole raw
// text as a single label/code first; only fall back to comma-splitting
// (for a genuine multi-code field like "G, T") if that single-value match
// fails entirely.
function parseTranPurposeText(raw) {
  if (!raw) return { codes: [], invalidTokens: [] };
  const trimmed = String(raw).trim();
  const wholeMatch = mapTranPurposeToken(trimmed);
  if (wholeMatch) return { codes: [wholeMatch], invalidTokens: [] };

  const tokens = trimmed.split(/[,;]/).map(function(s) { return s.trim(); }).filter(Boolean);
  const mapped = tokens.map(mapTranPurposeToken);
  const invalidTokens = tokens.filter(function(t, i) { return mapped[i] === null; });
  return { codes: mapped.filter(Boolean), invalidTokens: invalidTokens };
}

const PAYMENT_METHODS = [["","(none)"],["CHK","Check"],["ACH","Electronic Check"],["EFT","Electronic Funds Transfer"],
                          ["DC","Debit Card"],["CC","Credit Card"]];

// Maps whatever text is in the Payment Method custom field to an ORESTAR
// code — tries matching against both the code itself (e.g. "CHK") and the
// label (e.g. "Check") case-insensitively. Falls back to blank (shown as
// "(none)" in the review table) if it doesn't recognize the text, so it's
// still visible and editable rather than silently wrong.
function mapPaymentMethodText(raw) {
  if (!raw) return "";
  const text = String(raw).trim().toLowerCase();
  for (let i = 0; i < PAYMENT_METHODS.length; i++) {
    const code = PAYMENT_METHODS[i][0], label = PAYMENT_METHODS[i][1];
    if (code && (code.toLowerCase() === text || label.toLowerCase() === text)) return code;
  }
  return "";
}

const CONTACT_TYPES = [
  ["I","Individual"], ["F","Candidate's Immediate Family"], ["B","Business Entity"],
  ["L","Labor Organization"], ["O","Other"], ["C","Political Committee"], ["P","Political Party Committee"]
];

let loadedTransactions = [];
let loggedSample = {}; // tracks whether we've console.logged a sample raw record per source, for diagnostics
let contactsByName = {};
let availableAccounts = [];

async function postMessageWithResponse(message) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const t = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Timed out waiting for Manager response (10s) - make sure this page is loaded via its registered Custom Button inside Manager, not opened standalone."));
    }, 10000);
    function onMessage(e) {
      const d = e.data;
      if (d && d.type && d.type.endsWith("-response") && d.requestId === requestId) {
        clearTimeout(t);
        window.removeEventListener("message", onMessage);
        if (d.error) {
          // Manager's own proxy appears to call response.json() unconditionally.
          // A successful write (PUT/PATCH) commonly returns 204 No Content —
          // no body at all — which throws exactly this standard browser error
          // even though the underlying write succeeded. Treat it as success
          // rather than a real failure, since the error text itself is
          // diagnostic of "empty body," not of the request having failed.
          if (String(d.error).indexOf("Unexpected end of JSON input") !== -1) {
            resolve(d.body || {});
            return;
          }
          reject(new Error(d.error));
          return;
        }
        if (d.status && d.status >= 400) reject(new Error("HTTP " + d.status + ": " + JSON.stringify(d.body)));
        else resolve(d.body);
      }
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage(Object.assign({}, message, { requestId: requestId }), "*");
  });
}

async function managerApi(method, path, body) {
  return await postMessageWithResponse({ type: "api-request", method: method, path: path, body: body || null });
}


// Resolved field GUIDs — fetched fresh each time "Load Accounts & Resolve
// Fields" runs, by matching config.js's field NAMES against the real
// definitions. No GUIDs stored anywhere; nothing to keep in sync manually.
let resolvedGuids = {
  filer: null,
  typeSubtypeCandidates: [],
  transactionId: null,
  paymentMethodCandidates: [],
  checkNumberCandidates: [],
  occupation: null,
  employerName: null,
  employerCity: null,
  employerState: null,
  contactType: null,
  notEmployed: null,
  selfEmployed: null,
  contactId: null,
  tranPurposeCandidates: []
};

// /api4/custom-fields is a HATEOAS-style hub, not a flat list — it returns
// _links pointing to separate batch endpoints per field type
// (numberCustomFields, textCustomFields, checkboxCustomFields, etc.), each
// with its own href (already carrying the business context token). Confirmed
// live: the hub itself has no field data, only these links.
async function fetchAllCustomFieldDefinitions() {
  const hub = await managerApi("GET", "/api4/custom-fields");
  const links = hub._links || hub.links || {};
  const relevantKeys = ["numberCustomFields", "textCustomFields", "checkboxCustomFields", "dateCustomFields", "multipleValueCustomFields", "imageCustomFields"];
  let allFields = [];
  for (const key of relevantKeys) {
    const linkObj = links[key];
    if (!linkObj || !linkObj.href) continue;
    let href = linkObj.href;
    href += (href.indexOf("?") !== -1 ? "&" : "?") + "pageSize=1000";
    try {
      const batchData = await managerApi("GET", href);
      const arrayKey = Object.keys(batchData).find(function(k) { return Array.isArray(batchData[k]); });
      const items = arrayKey ? batchData[arrayKey] : [];
      // Some batch responses wrap each entry as { key, item: {...} } rather
      // than flat objects — unwrap defensively either way.
      const unwrapped = items.map(function(it) {
        if (it && it.item && typeof it.item === "object") {
          const merged = Object.assign({}, it.item);
          if (!merged.key && !merged.Key) merged.key = it.key || it.Key;
          return merged;
        }
        return it;
      });
      allFields = allFields.concat(unwrapped);
    } catch (e) {
      console.warn("[ORESTAR] batch fetch failed for " + key + ":", e.message);
    }
  }
  console.log("[ORESTAR] All custom field definitions (merged from batch endpoints):", allFields);
  return allFields;
}

async function resolveFieldGuids() {
  const cfg = (typeof ORESTAR_CONFIG !== "undefined") ? ORESTAR_CONFIG : {};
  const fields = await fetchAllCustomFieldDefinitions();

  function findByName(name) {
    return fields.filter(function(f) {
      return (f.Name || f.name || f.Label || f.label || "").trim() === name.trim();
    });
  }
  function guidOf(f) {
    return f ? (f.key || f.Key || f.id || f.Id || null) : null;
  }

  const filerMatches = findByName(cfg.FILER_ID_FIELD_NAME || "");
  const typeSubtypeMatches = findByName(cfg.TYPE_SUBTYPE_FIELD_NAME || "");
  const transactionIdMatches = findByName(cfg.TRANSACTION_ID_FIELD_NAME || "");
  const paymentMethodMatches = findByName(cfg.PAYMENT_METHOD_FIELD_NAME || "");
  const checkNumberMatches = findByName(cfg.CHECK_NUMBER_FIELD_NAME || "");
  const occupationMatches = findByName(cfg.OCCUPATION_FIELD_NAME || "");
  const employerNameMatches = findByName(cfg.EMPLOYER_NAME_FIELD_NAME || "");
  const employerCityMatches = findByName(cfg.EMPLOYER_CITY_FIELD_NAME || "");
  const employerStateMatches = findByName(cfg.EMPLOYER_STATE_FIELD_NAME || "");
  const contactTypeMatches = findByName(cfg.CONTACT_TYPE_FIELD_NAME || "");
  const notEmployedMatches = findByName(cfg.NOT_EMPLOYED_FIELD_NAME || "");
  const selfEmployedMatches = findByName(cfg.SELF_EMPLOYED_FIELD_NAME || "");
  const contactIdMatches = findByName(cfg.CONTACT_ID_FIELD_NAME || "");
  const tranPurposeMatches = findByName(cfg.TRAN_PURPOSE_FIELD_NAME || "");

  // Placement turned out to be opaque form-type GUIDs, not readable text
  // ("Receipt"/"Payment") — no reliable way to tell which is which from the
  // field definition alone. Instead of guessing, keep every GUID that
  // matches the name; when reading a specific transaction's value later,
  // we just check each candidate and use whichever one actually has data —
  // Manager only returns a value for the field that actually applies to
  // that record type, so this sorts itself out naturally per-record.
  resolvedGuids = {
    filer: guidOf(filerMatches[0]),
    typeSubtypeCandidates: typeSubtypeMatches.map(guidOf).filter(Boolean),
    transactionId: guidOf(transactionIdMatches[0]),
    paymentMethodCandidates: paymentMethodMatches.map(guidOf).filter(Boolean),
    checkNumberCandidates: checkNumberMatches.map(guidOf).filter(Boolean),
    occupation: guidOf(occupationMatches[0]),
    employerName: guidOf(employerNameMatches[0]),
    employerCity: guidOf(employerCityMatches[0]),
    employerState: guidOf(employerStateMatches[0]),
    contactType: guidOf(contactTypeMatches[0]),
    notEmployed: guidOf(notEmployedMatches[0]),
    selfEmployed: guidOf(selfEmployedMatches[0]),
    contactId: guidOf(contactIdMatches[0]),
    tranPurposeCandidates: tranPurposeMatches.map(guidOf).filter(Boolean)
  };

  console.log("[ORESTAR] Resolved GUIDs:", resolvedGuids);

  const statusEl = document.getElementById("resolvedFieldsStatus");
  const lines = [
    (resolvedGuids.filer ? "✓" : "✗") + " Filer ID (\"" + (cfg.FILER_ID_FIELD_NAME || "") + "\")" + (resolvedGuids.filer ? "" : " — not found"),
    (resolvedGuids.typeSubtypeCandidates.length > 0 ? "✓" : "✗") + " Transaction Type (\"" + (cfg.TYPE_SUBTYPE_FIELD_NAME || "") + "\") — " + resolvedGuids.typeSubtypeCandidates.length + " field(s) found" + (resolvedGuids.typeSubtypeCandidates.length < 2 ? " (expected 2 — one for Receipts, one for Payments)" : ""),
    (resolvedGuids.paymentMethodCandidates.length > 0 ? "✓" : "✗") + " Payment Method (\"" + (cfg.PAYMENT_METHOD_FIELD_NAME || "") + "\") — " + resolvedGuids.paymentMethodCandidates.length + " field(s) found",
    (resolvedGuids.checkNumberCandidates.length > 0 ? "✓" : "✗") + " Check # (\"" + (cfg.CHECK_NUMBER_FIELD_NAME || "") + "\") — " + resolvedGuids.checkNumberCandidates.length + " field(s) found",
    (resolvedGuids.transactionId ? "✓" : "✗") + " Transaction ID (\"" + (cfg.TRANSACTION_ID_FIELD_NAME || "") + "\")" + (resolvedGuids.transactionId ? "" : " — not found"),
    (resolvedGuids.notEmployed ? "✓" : "✗") + " Not Employed (\"" + (cfg.NOT_EMPLOYED_FIELD_NAME || "") + "\")" + (resolvedGuids.notEmployed ? "" : " — not found"),
    (resolvedGuids.selfEmployed ? "✓" : "✗") + " Self-Employed (\"" + (cfg.SELF_EMPLOYED_FIELD_NAME || "") + "\")" + (resolvedGuids.selfEmployed ? "" : " — not found"),
    (resolvedGuids.contactId ? "✓" : "✗") + " Contact ID (\"" + (cfg.CONTACT_ID_FIELD_NAME || "") + "\")" + (resolvedGuids.contactId ? "" : " — not found (optional)"),
    (resolvedGuids.tranPurposeCandidates.length > 0 ? "✓" : "✗") + " Transaction Purpose (\"" + (cfg.TRAN_PURPOSE_FIELD_NAME || "") + "\") — " + resolvedGuids.tranPurposeCandidates.length + " field(s) found (optional)",
    (resolvedGuids.occupation ? "✓" : "✗") + " Occupation (\"" + (cfg.OCCUPATION_FIELD_NAME || "") + "\")" + (resolvedGuids.occupation ? "" : " — not found"),
    (resolvedGuids.employerName ? "✓" : "✗") + " Employer Name (\"" + (cfg.EMPLOYER_NAME_FIELD_NAME || "") + "\")" + (resolvedGuids.employerName ? "" : " — not found"),
    (resolvedGuids.employerCity ? "✓" : "✗") + " Employer City (\"" + (cfg.EMPLOYER_CITY_FIELD_NAME || "") + "\")" + (resolvedGuids.employerCity ? "" : " — not found"),
    (resolvedGuids.employerState ? "✓" : "✗") + " Employer State (\"" + (cfg.EMPLOYER_STATE_FIELD_NAME || "") + "\")" + (resolvedGuids.employerState ? "" : " — not found"),
    (resolvedGuids.contactType ? "✓" : "✗") + " Contact Type (\"" + (cfg.CONTACT_TYPE_FIELD_NAME || "") + "\")" + (resolvedGuids.contactType ? "" : " — not found")
  ];
  statusEl.innerHTML = lines.join("<br>");

  return resolvedGuids;
}

function showStatus(kind, message) {
  const el = document.getElementById("status");
  el.className = kind;
  el.textContent = message;
}
function showMarkStatus(kind, message) {
  const el = document.getElementById("markStatus");
  el.className = kind;
  el.textContent = message;
}

function escapeXml(str) {
  return String(str == null ? "" : str).replace(/[<>&'"]/g, function(c) {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c];
  });
}

function getAmountValue(v) {
  if (v == null) return 0;
  if (typeof v === "object" && "value" in v) return v.value;
  return v;
}

function dateOnly(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function localDateFromTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function getCustomFieldValue(detail, fieldId, kind) {
  if (!detail || !fieldId) return undefined;
  const cf = detail.customFields2 || detail.CustomFields2;
  if (!cf) return undefined;

  function pick() {
    for (let i = 0; i < arguments.length; i++) {
      const k = arguments[i];
      if (cf[k] && cf[k][fieldId] !== undefined) return cf[k][fieldId];
    }
    return undefined;
  }

  if (kind === "checkbox") {
    return pick("checkboxes", "Checkboxes", "booleans", "Booleans");
  }
  if (kind === "number") {
    return pick("decimals", "Decimals", "numbers", "Numbers", "strings", "Strings");
  }
  return pick("strings", "Strings");
}

// Tries each candidate field GUID in turn and returns the first one that
// actually has a value on this record. Used for "Transaction Type," which
// is really two separate field objects (one per form) sharing the same
// name — a given record's CustomFields2 will only ever contain a value for
// whichever one actually applies to it, so this sorts itself out naturally.
function getCustomFieldValueAny(detail, fieldIds, kind) {
  for (let i = 0; i < fieldIds.length; i++) {
    const v = getCustomFieldValue(detail, fieldIds[i], kind);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

async function fetchFilerId(filerFieldId) {
  const detail = await managerApi("GET", "/api4/business-details");
  const raw = getCustomFieldValue(detail, filerFieldId, "number");
  if (raw == null || raw === "") throw new Error("Filer ID field came back empty - check the GUID and that the field actually has a value set in Business Details.");
  const cleaned = String(raw).trim();
  if (!/^\d+$/.test(cleaned)) throw new Error("Filer ID value \"" + cleaned + "\" isn't a plain positive integer - ORESTAR requires filer-id to be numeric.");
  return cleaned;
}

async function fetchAccounts() {
  const data = await managerApi("GET", "/api2/bank-and-cash-accounts?pageSize=1000");
  const arrayKey = Object.keys(data).find(function(k) { return Array.isArray(data[k]); });
  const items = arrayKey ? data[arrayKey] : [];
  return items.map(function(a) {
    const rawKind = a.Type || a.AccountType || a.Kind || (a.IsCashAccount ? "Cash" : null);
    return {
      key: a.key || a.Key,
      name: a.Name || a.name || "(unnamed account)",
      kind: rawKind ? String(rawKind).toLowerCase() : "account"
    };
  });
}

document.getElementById("listFieldsBtn").addEventListener("click", async function() {
  const el = document.getElementById("fieldsListResult");
  el.innerHTML = '<span class="small">Loading custom field definitions…</span>';
  try {
    const fields = await fetchAllCustomFieldDefinitions();
    if (fields.length === 0) {
      el.innerHTML = '<span class="small">No custom fields returned across any batch endpoint — check the console for details on each attempted fetch.</span>';
      return;
    }
    const rows = fields.map(function(f) {
      const name = f.Name || f.name || f.Label || f.label || "(unnamed)";
      const type = f.Type || f.type || "?";
      const placement = f.Placement || f.placement || (Array.isArray(f.Placements) ? f.Placements.join(", ") : "") || "?";
      const guid = f.key || f.Key || f.id || f.Id || "?";
      return "<tr><td>" + escapeXml(name) + "</td><td>" + escapeXml(type) + "</td><td>" + escapeXml(placement) + "</td><td style=\"font-family:ui-monospace,monospace;\">" + escapeXml(guid) + "</td></tr>";
    }).join("");
    el.innerHTML = "<table><thead><tr><th>Name</th><th>Type</th><th>Placement</th><th>GUID</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      '<div class="small" style="margin-top:4px;">Compare these Name values against config.js — GUIDs are resolved automatically by matching on Name, so this table is the source of truth for what the real names are.</div>';
  } catch (e) {
    el.innerHTML = '<span class="small">Failed: ' + escapeXml(e.message) + '</span>';
  }
});

document.getElementById("testPayslipsBtn").addEventListener("click", async function() {
  const el = document.getElementById("payslipTestResult");
  el.innerHTML = '<span class="small">Testing…</span>';
  const listCandidates = ["/payslips", "/pay-slips"];
  let listData = null, workingListPath = null;
  const attempts = [];
  for (let i = 0; i < listCandidates.length; i++) {
    try {
      listData = await managerApi("GET", listCandidates[i] + "?pageSize=1000");
      workingListPath = listCandidates[i];
      attempts.push(listCandidates[i] + " — SUCCESS");
      break;
    } catch (e) {
      attempts.push(listCandidates[i] + " — " + e.message);
    }
  }
  let items = [];
  if (listData) {
    console.log("[ORESTAR] Payslip list raw response:", listData);
    const arrayKey = Object.keys(listData).find(function(k) { return Array.isArray(listData[k]); });
    items = arrayKey ? listData[arrayKey] : [];

    // Same hub-and-batch pattern discovered with /api4/custom-fields — a
    // valid response with no flat array, just links to the real data.
    if (items.length === 0 && (listData._links || listData.links)) {
      const links = listData._links || listData.links;
      console.log("[ORESTAR] Payslip response looks like a hub — _links found:", links);
      const linkKeys = Object.keys(links).filter(function(k) { return k !== "self" && k !== "describedBy"; });
      for (let li = 0; li < linkKeys.length; li++) {
        const linkObj = links[linkKeys[li]];
        if (!linkObj || !linkObj.href) continue;
        try {
          const batchData = await managerApi("GET", linkObj.href + (linkObj.href.indexOf("?") !== -1 ? "&" : "?") + "pageSize=1000");
          const batchArrayKey = Object.keys(batchData).find(function(k) { return Array.isArray(batchData[k]); });
          const batchItems = batchArrayKey ? batchData[batchArrayKey] : [];
          console.log("[ORESTAR] Hub link \"" + linkKeys[li] + "\" (" + linkObj.href + ") returned " + batchItems.length + " item(s)");
          if (batchItems.length > 0) {
            items = batchItems;
            workingListPath = linkObj.href.split("?")[0];
            break;
          }
        } catch (e) {
          console.warn("[ORESTAR] Hub link \"" + linkKeys[li] + "\" failed:", e.message);
        }
      }
    }
  }

  // Fallback: Payslips may be nested under Pay Runs (a period/batch concept)
  // rather than being a flat top-level list, since payroll is inherently
  // period-based.
  let payRunData = null, workingPayRunPath = null;
  if (items.length === 0) {
    const payRunCandidates = ["/pay-runs", "/payruns", "/pay-run"];
    for (let i = 0; i < payRunCandidates.length; i++) {
      try {
        payRunData = await managerApi("GET", payRunCandidates[i] + "?pageSize=1000");
        workingPayRunPath = payRunCandidates[i];
        attempts.push(payRunCandidates[i] + " — SUCCESS");
        break;
      } catch (e) {
        attempts.push(payRunCandidates[i] + " — " + e.message);
      }
    }
    if (payRunData) {
      console.log("[ORESTAR] Pay Run list raw response:", payRunData);
      const arrayKey = Object.keys(payRunData).find(function(k) { return Array.isArray(payRunData[k]); });
      const payRuns = arrayKey ? payRunData[arrayKey] : [];
      if (payRuns.length > 0) {
        const runKey = payRuns[0].key || payRuns[0].Key;
        const runFormCandidates = [workingPayRunPath.replace(/s$/, "") + "-form", "/pay-run-form"];
        for (let i = 0; i < runFormCandidates.length; i++) {
          try {
            const runDetail = await managerApi("GET", runFormCandidates[i] + "/" + runKey);
            console.log("[ORESTAR] Pay Run detail sample (" + runFormCandidates[i] + "):", runDetail);
            console.log("[ORESTAR] Pay Run detail as JSON string: " + JSON.stringify(runDetail));
            el.innerHTML = '<span class="small">No flat Payslips, but found Pay Runs (' + payRuns.length + ') — check console for the Pay Run detail structure, likely contains nested payslip data.</span>';
            return;
          } catch (e) {
            attempts.push(runFormCandidates[i] + " — " + e.message);
          }
        }
      } else {
        el.innerHTML = '<span class="small">Neither /payslips nor any Pay Run endpoint returned data. Attempts:<br>' + escapeXml(attempts.join(" | ")) + '</span>';
        return;
      }
    }
  }

  if (items.length === 0) {
    el.innerHTML = '<span class="small">List endpoint (' + workingListPath + ') worked but returned 0 payslips, and no Pay Run fallback worked either. Attempts:<br>' + escapeXml(attempts.join(" | ")) + '</span>';
    return;
  }
  const key = items[0].key || items[0].Key;
  const formCandidates = [workingListPath.replace(/s$/, "") + "-form", "/payslip-form", "/pay-slip-form"];
  let detail = null, workingFormPath = null;
  const formAttempts = [];
  for (let i = 0; i < formCandidates.length; i++) {
    try {
      detail = await managerApi("GET", formCandidates[i] + "/" + key);
      workingFormPath = formCandidates[i];
      formAttempts.push(formCandidates[i] + " — SUCCESS");
      break;
    } catch (e) {
      formAttempts.push(formCandidates[i] + " — " + e.message);
    }
  }
  console.log("[ORESTAR] Payslip list item sample:", items[0]);
  console.log("[ORESTAR] Payslip detail sample (" + workingFormPath + "):", detail);
  if (detail) {
    console.log("[ORESTAR] Payslip detail top-level field names:", Object.keys(detail));
    console.log("[ORESTAR] Payslip detail as JSON string: " + JSON.stringify(detail));
  }
  el.innerHTML = '<span class="small">List: ' + escapeXml(attempts.join(" | ")) + '<br>Detail: ' + escapeXml(formAttempts.join(" | ")) + '<br>Check the console for the full raw structure — logged as an object, field-name list, and JSON string.</span>';
});

document.getElementById("loadAccountsBtn").addEventListener("click", async function() {
  showStatus("pending", "Resolving custom fields and loading accounts…");
  try {
    await resolveFieldGuids();

    availableAccounts = await fetchAccounts();
    const listEl = document.getElementById("accountList");
    if (availableAccounts.length === 0) {
      listEl.innerHTML = '<span class="small">No accounts found.</span>';
    } else {
      listEl.innerHTML = availableAccounts.map(function(a, i) {
        return '<label><input type="checkbox" data-acct-idx="' + i + '" checked> ' + escapeXml(a.name) + ' <span class="small">(' + a.kind + ')</span></label>';
      }).join("");
    }

    let filerNote = "";
    if (resolvedGuids.filer) {
      try {
        const filerId = await fetchFilerId(resolvedGuids.filer);
        document.getElementById("resolvedFilerId").value = filerId;
        filerNote = " Filer ID resolved: " + filerId + ".";
      } catch (e) {
        document.getElementById("resolvedFilerId").value = "";
        showStatus("err", "Accounts loaded, but Filer ID lookup failed: " + e.message);
        return;
      }
    } else {
      document.getElementById("resolvedFilerId").value = "";
      filerNote = " Filer ID field not found by name — check config.js and the resolved-fields status above.";
    }
    showStatus("ok", "Loaded " + availableAccounts.length + " account(s)." + filerNote);
  } catch (err) {
    showStatus("err", "Failed to load accounts: " + err.message);
  }
});

function selectedAccountKeys() {
  return availableAccounts
    .filter(function(_, i) {
      const cb = document.querySelector('input[data-acct-idx="' + i + '"]');
      return cb ? cb.checked : true;
    })
    .map(function(a) { return a.key; });
}

// Amount field name/shape isn't confirmed for every record type — trying
// common candidates plus a Lines-array fallback (summing line amounts) in
// case there's no single top-level total.
function extractAmount(detail, item) {
  function firstDefined() {
    for (let i = 0; i < arguments.length; i++) {
      if (arguments[i] != null) return arguments[i];
    }
    return null;
  }
  // Purchase Invoices / Expense Claims have already shown different field
  // names than Receipts/Payments once (IssueDate vs Date) — broadening the
  // candidate list here for the same reason rather than assuming Amount/
  // Total covers every record type.
  const raw = firstDefined(
    detail && detail.Amount, detail && detail.Total, detail && detail.TotalAmount,
    detail && detail.Balance, detail && detail.AmountDue, detail && detail.GrandTotal,
    detail && detail.InvoiceTotal, detail && detail.ClaimAmount, detail && detail.ClaimTotal,
    detail && detail.NetAmount,
    item && item.Amount, item && item.Total, item && item.Balance,
    item && item.AmountDue, item && item.GrandTotal, item && item.ClaimAmount
  );
  const direct = getAmountValue(raw);
  if (direct) return Math.abs(direct);

  const lines = (detail && (detail.Lines || detail.lines)) || (item && (item.Lines || item.lines));
  if (Array.isArray(lines) && lines.length > 0) {
    let sum = 0;
    lines.forEach(function(l) {
      // Confirmed from the real schema: Purchase Invoice / Expense Claim line
      // items use "total" (post-tax) or "totalBeforeTax" — there's no "Amount"
      // field on these at all, unlike what we'd assumed.
      let lineValue = getAmountValue(firstDefined(l.Total, l.total, l.TotalBeforeTax, l.totalBeforeTax, l.Amount, l.amount));
      // If no total-style field has a value at all, compute from quantity ×
      // unit price as a last resort — approximate (doesn't account for
      // discounts/tax precisely) but better than silently reporting 0.
      if (!lineValue) {
        const qtyRaw = firstDefined(l.Qty, l.qty);
        const qty = qtyRaw != null ? getAmountValue(qtyRaw) : 1; // confirmed: Manager omits Qty entirely when it's the default (1), not sends it as 0
        const unitPrice = getAmountValue(firstDefined(l.PurchaseUnitPrice, l.purchaseUnitPrice, l.UnitPrice, l.unitPrice, l.CurrencyAmount, l.currencyAmount));
        if (unitPrice) lineValue = qty * unitPrice;
      }
      sum += lineValue || 0;
    });
    // Purchase Invoices can add landed costs (freight, duty, etc.) on top of
    // the line totals — confirmed present in the real schema as a sibling
    // array to Lines.
    const landedCostLines = (detail && (detail.LandedCostLines || detail.landedCostLines)) || (item && (item.LandedCostLines || item.landedCostLines));
    if (Array.isArray(landedCostLines) && landedCostLines.length > 0) {
      landedCostLines.forEach(function(l) {
        const lcValue = firstDefined(l.LandedCostAmount, l.landedCostAmount);
        sum += getAmountValue(lcValue) || 0;
      });
    }
    if (sum) return Math.abs(sum);
  }
  return 0;
}

function extractDescription(detail, item) {
  const direct = (detail && detail.Description) || (item && item.Description);
  if (direct) return direct;

  const lines = (detail && (detail.Lines || detail.lines)) || (item && (item.Lines || item.lines));
  if (Array.isArray(lines) && lines.length > 0) {
    const descs = lines.map(function(l) { return l.Description || l.description || ""; }).filter(Boolean);
    if (descs.length > 0) return descs.join("; ");
  }
  return "";
}

// Payee/Payer comes back as a linked object ({key, name}) when the
// transaction is tied to an actual Customer or Supplier record, or as a
// plain string otherwise. Handle both — this also fixes a crash where
// downstream code assumed it was always a string.

// Full US state name -> USPS abbreviation. The Employer's State custom
// field stores the full name (e.g. "Oregon"); ORESTAR's <state> element
// expects the 2-letter code, same as everywhere else we handle state.
const STATE_NAME_TO_ABBR = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO",
  "connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID",
  "illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA",
  "maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS",
  "missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ",
  "new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
  "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
  "tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA",
  "west virginia":"WV","wisconsin":"WI","wyoming":"WY","district of columbia":"DC"
};
function stateNameToAbbr(name) {
  if (!name) return "";
  const trimmed = String(name).trim();
  if (trimmed.length === 2) return trimmed.toUpperCase(); // already an abbreviation
  return STATE_NAME_TO_ABBR[trimmed.toLowerCase()] || trimmed;
}

// Maps whatever text the "Type" custom field stores to an ORESTAR contact
// type code, checking against our known labels/codes case-insensitively,
// plus a few common synonyms. Returns null (not a blank string) when
// nothing matches, so callers can tell "unmatched" apart from "resolved to
// something falsy" and fall back to the old heuristic guess instead.
function mapContactTypeText(raw) {
  if (!raw) return null;
  const text = String(raw).trim().toLowerCase();
  for (let i = 0; i < CONTACT_TYPES.length; i++) {
    const code = CONTACT_TYPES[i][0], label = CONTACT_TYPES[i][1];
    if (code.toLowerCase() === text || label.toLowerCase() === text) return code;
  }
  const synonyms = {
    "individual": "I", "person": "I",
    "business": "B", "company": "B", "corporation": "B", "llc": "B", "vendor": "B",
    "committee": "C", "pac": "C", "political action committee": "C",
    "union": "L", "labor union": "L",
    "party": "P", "political party": "P"
  };
  return synonyms[text] || null;
}

// Cache of resolved contact records by key, so the same repeated
// Customer/Supplier isn't looked up again for every transaction that
// references it.
let contactRecordCache = {};

// UNCONFIRMED endpoint name — following the established "-form/{key}"
// pattern. Looks up a Purchase Invoice's own Transaction ID field value —
// if it was already filed in an earlier export, that's the real ORESTAR id
// we need for associated-tran; if blank, it hasn't been filed yet.
let invoiceTxnIdCache = {};
// CRITICAL: PUT appears to replace the ENTIRE resource in Manager's API,
// not merge fields — a partial body (just a custom field) wiped out Date,
// Amount, linked Customer/Supplier, and Lines on real records. Every write
// now fetches the full current record first, merges in only the one field
// being changed, and sends the complete object back so nothing else is lost.
async function safeSetCustomField(formPath, key, fieldGuid, kind, value) {
  const current = await managerApi("GET", "/api2" + formPath + "/" + key);
  const cf = current.CustomFields2 || current.customFields2 || {};
  // Preserve whichever casing this record already uses, both for the
  // container and the bucket, rather than assuming one or the other.
  const usesLowerContainer = !!current.customFields2 && !current.CustomFields2;
  const bucketNames = kind === "checkbox" ? ["Checkboxes", "checkboxes"] :
                       kind === "number" ? ["Decimals", "decimals"] : ["Strings", "strings"];
  const existingBucketName = bucketNames.find(function(b) { return cf[b] !== undefined; }) || bucketNames[0];
  if (!cf[existingBucketName]) cf[existingBucketName] = {};
  cf[existingBucketName][fieldGuid] = value;
  if (usesLowerContainer) {
    current.customFields2 = cf;
  } else {
    current.CustomFields2 = cf;
  }
  await managerApi("PUT", "/api2" + formPath + "/" + key, current);
}

async function resolveInvoiceTransactionId(key) {
  if (invoiceTxnIdCache[key] !== undefined) return invoiceTxnIdCache[key];
  try {
    const rec = await managerApi("GET", "/api2/purchase-invoice-form/" + key);
    const txnId = getCustomFieldValue(rec, resolvedGuids.transactionId, "number");
    const result = (txnId !== undefined && txnId !== null && txnId !== "") ? String(txnId) : null;
    invoiceTxnIdCache[key] = result;
    return result;
  } catch (e) {
    console.warn("[ORESTAR] Could not resolve Purchase Invoice " + key + ":", e.message);
    invoiceTxnIdCache[key] = null;
    return null;
  }
}

// customer/supplier/contact come back as bare key strings (confirmed from a
// real export where the raw GUID ended up in the XML's business-name field)
// pointing at a separate record, not inline reference objects with a name.
// Resolve by fetching that record's own "-form" endpoint, same pattern as
// receipt-form/payment-form. Endpoint names for these are unconfirmed —
// trying the type-hinted one first, falling back to the others if it 404s.
// Also pulls Occupation/Employer/Type custom fields off that same record,
// since they live there rather than on the transaction.
// Confirmed shape from a real Business Details response: a single string,
// street on the first line, "City, ST ZIP" on the second — e.g.
// "12010 SE Eastbourne Ln\nHappy Valley, OR 97086". Assuming Customer/
// Supplier/Employee records use the same "Address" field shape.
function parseAddressBlock(raw) {
  if (!raw) return { street1: "", city: "", state: "", zip: "" };
  const lines = String(raw).split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
  if (lines.length === 0) return { street1: "", city: "", state: "", zip: "" };
  if (lines.length === 1) {
    // Only one line at all — no separate City/State/Zip line to parse out.
    return { street1: lines[0], city: "", state: "", zip: "" };
  }
  // Last line is always City/State/Zip; everything before it is the street
  // address, however many lines that spans (e.g. a second "Suite ..." line)
  // — joined with spaces rather than assuming exactly one street line.
  const lastLine = lines[lines.length - 1];
  const street1 = lines.slice(0, lines.length - 1).join(" ");
  let city = "", state = "", zip = "";
  const m = lastLine.match(/^(.*),\s*([A-Za-z]{2})\s+(\d{5}(-\d{4})?)$/);
  if (m) {
    city = m[1].trim();
    state = m[2].toUpperCase();
    zip = m[3];
  } else {
    city = lastLine; // doesn't match the expected pattern — dump it in city rather than lose it
  }
  return { street1: street1, city: city, state: state, zip: zip };
}

// Cached supplier list, fetched once and matched client-side by name — used
// to find a richer Supplier record for someone who's primarily linked as an
// Employee, since Suppliers have consistently had fuller data in testing.
// UNCONFIRMED endpoint — following the plural-list convention that's worked
// for /receipts, /payments, etc.
let supplierListCache = null;
async function getSupplierList() {
  if (supplierListCache) return supplierListCache;
  try {
    const data = await managerApi("GET", "/api2/suppliers?pageSize=1000");
    const arrayKey = Object.keys(data).find(function(k) { return Array.isArray(data[k]); });
    supplierListCache = arrayKey ? data[arrayKey] : [];
  } catch (e) {
    console.warn("[ORESTAR] Could not fetch supplier list for name-matching:", e.message);
    supplierListCache = [];
  }
  return supplierListCache;
}
async function findSupplierKeyByName(name) {
  if (!name) return null;
  const list = await getSupplierList();
  const target = name.trim().toLowerCase();
  const match = list.find(function(s) { return (s.Name || s.name || "").trim().toLowerCase() === target; });
  return match ? (match.key || match.Key) : null;
}

// For Expense Claims: ORESTAR wants both the vendor (contact-id, already
// resolved via Payee) AND the employee who was reimbursed (expend-id,
// documented in the XSD as "Personal Expenditure Id from Address Book").
// This resolves just the employee side.
async function resolveExpendInfo(detail, item) {
  const ref = (detail && (detail.PaidBy || detail.paidBy)) || (item && (item.PaidBy || item.paidBy));
  if (!ref) return null;
  const key = typeof ref === "string" ? ref : (ref.key || ref.Key);
  if (!key) return null;
  return await resolveContactRecord(key, null);
}

async function resolveContactRecord(key, hintedEndpoint) {
  if (!key) return null;
  if (contactRecordCache[key]) return contactRecordCache[key];

  const endpoints = [hintedEndpoint, "customer-form", "supplier-form", "employee-form", "contact-form"]
    .filter(function(e, i, arr) { return e && arr.indexOf(e) === i; }); // unique, hinted one first

  for (let i = 0; i < endpoints.length; i++) {
    try {
      const rec = await managerApi("GET", "/api2/" + endpoints[i] + "/" + key);
      const name = rec.Name || rec.name;
      if (!name) continue;

      // Confirmed: Customer records use BillingAddress/DeliveryAddress — using
      // billing only, as requested, not delivery. Address/address kept as a
      // fallback for Supplier/Employee records, which seem to use a single
      // general field instead of split billing/delivery.
      const rawAddress = rec.BillingAddress || rec.billingAddress || rec.Address || rec.address;
      const addr = parseAddressBlock(rawAddress);
      if (!rawAddress) {
        console.log("[ORESTAR] No address field matched on " + endpoints[i] + " record — raw record for inspection:", rec);
      }

      const occupation = getCustomFieldValue(rec, resolvedGuids.occupation, "text") || "";
      const employerName = getCustomFieldValue(rec, resolvedGuids.employerName, "text") || "";
      const employerCity = getCustomFieldValue(rec, resolvedGuids.employerCity, "text") || "";
      const employerState = stateNameToAbbr(getCustomFieldValue(rec, resolvedGuids.employerState, "text"));

      // Confirmed against the actual XSD: <employment> is an xs:choice of
      // exactly one of <not-employed>Yes</not-employed>,
      // <self-employed>Yes</self-employed>, or the normal employer-name/
      // city/state sequence — a formal indicator, not free text. Occupation
      // stays as whatever's actually on file (it's a separate element) and
      // is no longer overwritten.
      const isNotEmployed = getCustomFieldValue(rec, resolvedGuids.notEmployed, "checkbox") === true;
      const isSelfEmployed = getCustomFieldValue(rec, resolvedGuids.selfEmployed, "checkbox") === true;
      const employmentStatus = isNotEmployed ? "not-employed" : (isSelfEmployed ? "self-employed" : null);

      const result = {
        name: name,
        street1: addr.street1,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        occupation: occupation,
        employerName: employerName,
        employerCity: employerCity,
        employerState: employerState,
        employmentStatus: employmentStatus,
        type: mapContactTypeText(getCustomFieldValue(rec, resolvedGuids.contactType, "text")),
        contactId: getCustomFieldValue(rec, resolvedGuids.contactId, "text") || "",
        recordKey: key,
        recordEndpoint: endpoints[i]
      };
      contactRecordCache[key] = result;
      return result;
    } catch (e) {
      // try the next candidate endpoint
    }
  }
  return null;
}

// Returns { name, occupation, employerName, employerCity, employerState, type }
// (type/occupation/employer fields empty-string or null if unresolved/not
// applicable) — or a record with a unique placeholder name and no resolved
// details if nothing could be linked at all.
async function resolveContactInfo(detail, item, sourceLabel) {
  // Expense Claims: the ORESTAR-facing contact should be the Payee — the
  // vendor the employee originally paid (e.g. "FedEx Office") — resolved to
  // its matching Supplier record, not the Employee who submitted the claim.
  if (sourceLabel === "Expense Claim") {
    const rawPayee = (detail && (detail.Payee || detail.payee)) || (item && (item.Payee || item.payee));
    if (rawPayee && typeof rawPayee === "string") {
      const supplierKey = await findSupplierKeyByName(rawPayee);
      if (supplierKey) {
        const supplierInfo = await resolveContactRecord(supplierKey, "supplier-form");
        if (supplierInfo) return supplierInfo;
      }
      // No matching Supplier found — use the Payee text directly rather
      // than silently falling through to the Employee, since the Payee is
      // the one that's supposed to be the ORESTAR contact here.
      return { name: rawPayee, street1: "", city: "", state: "", zip: "", occupation: "", employerName: "", employerCity: "", employerState: "", employmentStatus: null, type: "B", contactId: "", recordKey: null, recordEndpoint: null };
    }
    // No Payee text at all — fall back to whoever paid (Employee), since
    // that's still better than nothing.
    const employeeRef = (detail && (detail.PaidBy || detail.paidBy)) || (item && (item.PaidBy || item.paidBy));
    if (employeeRef) {
      const key = typeof employeeRef === "string" ? employeeRef : (employeeRef.key || employeeRef.Key);
      const resolved = await resolveContactRecord(key, null);
      if (resolved) return resolved;
    }
  }

  const employeeRefs = [
    [detail && detail.PaidBy, null],
    [detail && detail.paidBy, null],
    [item && item.PaidBy, null],
    [item && item.paidBy, null],
    [detail && detail.recipient, null],
    [detail && detail.Recipient, null],
    [item && item.recipient, null],
    [item && item.Recipient, null],
    [detail && detail.employee, "employee-form"],
    [detail && detail.Employee, "employee-form"],
    [item && item.employee, "employee-form"],
    [item && item.Employee, "employee-form"]
  ];
  const otherRefs = [
    [detail && detail.customer, "customer-form"],
    [detail && detail.supplier, "supplier-form"],
    [detail && detail.contact, "contact-form"],
    [detail && detail.Customer, "customer-form"],
    [detail && detail.Supplier, "supplier-form"],
    [detail && detail.Contact, "contact-form"],
    [item && item.customer, "customer-form"],
    [item && item.supplier, "supplier-form"],
    [item && item.contact, "contact-form"]
  ];
  const refPairs = otherRefs.concat(employeeRefs);

  let resolvedInfo = null;
  for (let i = 0; i < refPairs.length; i++) {
    const ref = refPairs[i][0], hint = refPairs[i][1];
    if (!ref) continue;
    let key = null, inlineName = null;
    if (typeof ref === "string") {
      key = ref;
    } else if (typeof ref === "object") {
      key = ref.key || ref.Key;
      inlineName = ref.name || ref.Name;
    }
    if (inlineName) { resolvedInfo = { name: inlineName, street1: "", city: "", state: "", zip: "", occupation: "", employerName: "", employerCity: "", employerState: "", employmentStatus: null, type: null, contactId: "", recordKey: null, recordEndpoint: null }; break; }
    const resolved = await resolveContactRecord(key, hint);
    if (resolved) { resolvedInfo = resolved; break; }
  }

  if (resolvedInfo) {
    // For non-Expense-Claim sources resolved via Employee, still prefer a
    // matching Supplier's richer data if one exists.
    if (resolvedInfo.recordEndpoint === "employee-form") {
      const supplierKey = await findSupplierKeyByName(resolvedInfo.name);
      if (supplierKey && supplierKey !== resolvedInfo.recordKey) {
        const supplierInfo = await resolveContactRecord(supplierKey, "supplier-form");
        if (supplierInfo) return supplierInfo;
      }
    }
    return resolvedInfo;
  }

  // Older, never-fully-confirmed field-name guesses, treated as already
  // being plain display text rather than keys needing a lookup.
  const plainTextCandidates = [
    detail && detail.Payee, detail && detail.Payer, detail && detail.Name,
    item && item.Payee, item && item.Payer, item && item.Name
  ];
  for (let i = 0; i < plainTextCandidates.length; i++) {
    if (typeof plainTextCandidates[i] === "string" && plainTextCandidates[i]) {
      return { name: plainTextCandidates[i], street1: "", city: "", state: "", zip: "", occupation: "", employerName: "", employerCity: "", employerState: "", employmentStatus: null, type: null, contactId: "", recordKey: null, recordEndpoint: null };
    }
  }

  // None of the above had anything — genuinely no linked party. Fall back
  // to a per-record unique placeholder rather than one shared string, so
  // multiple different blank transactions don't get merged into a single
  // contact entry (editing one would otherwise silently edit them all).
  const fallbackKey = (item && (item.key || item.Key)) || (detail && (detail.key || detail.Key)) || Math.random().toString(36).slice(2, 8);
  return { name: "(no contact - " + String(fallbackKey).slice(0, 8) + ")", street1: "", city: "", state: "", zip: "", occupation: "", employerName: "", employerCity: "", employerState: "", employmentStatus: null, type: null, contactId: "", recordKey: null, recordEndpoint: null };
}

// UNTESTED against live data — no confirmed field names for how Manager
// represents "this Payment pays off Purchase Invoice X." Checking the most
// plausible candidates (top-level reference, or per-line reference within
// Lines) but this genuinely needs verification against a real payment that
// pays an invoice, the same way every other field name in this file got
// nailed down through live testing.
function extractInvoiceLinks(detail, item) {
  const keys = [];
  function addKey(v) {
    if (!v) return;
    if (typeof v === "string") { keys.push(v); return; }
    if (typeof v === "object" && (v.key || v.Key)) { keys.push(v.key || v.Key); return; }
    if (Array.isArray(v)) { v.forEach(addKey); return; }
  }
  addKey(detail && detail.PurchaseInvoice);
  addKey(detail && detail.purchaseInvoice);
  addKey(detail && detail.Invoice);
  addKey(detail && detail.Invoices);
  addKey(detail && detail.invoices);
  const lines = (detail && (detail.Lines || detail.lines)) || (item && (item.Lines || item.lines));
  if (Array.isArray(lines)) {
    lines.forEach(function(l) {
      addKey(l.PurchaseInvoice || l.purchaseInvoice || l.Invoice || l.invoice);
    });
  }
  // De-duplicate
  return keys.filter(function(k, i, arr) { return arr.indexOf(k) === i; });
}

function extractAccountRef(item, detail) {
  const candidates = [
    detail && detail.ReceivedIn, detail && detail.PaidFrom, detail && detail.BankAccount, detail && detail.CashAccount, detail && detail.Account,
    item && item.ReceivedIn, item && item.PaidFrom, item && item.BankAccount, item && item.CashAccount, item && item.Account
  ];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c) continue;
    if (typeof c === "string") return { key: c, name: null };
    if (typeof c === "object" && (c.key || c.Key)) return { key: c.key || c.Key, name: c.name || c.Name || null };
  }
  return { key: null, name: null };
}

const FETCH_PAGE_SIZE = 5000;

async function loadCollection(listPath, formPath, sourceLabel, typeSubtypeFieldIds, downloadedFieldId, paymentMethodFieldIds, checkNumberFieldIds, tranPurposeFieldIds, selectedKeys, forcedType, forcedSubCode) {
  const results = [];
  const listData = await managerApi("GET", "/api2" + listPath + "?pageSize=" + FETCH_PAGE_SIZE);
  const arrayKey = Object.keys(listData).find(function(k) { return Array.isArray(listData[k]); });
  const items = arrayKey ? listData[arrayKey] : [];
  const possiblyTruncated = items.length >= FETCH_PAGE_SIZE;

  for (const item of items) {
    const key = item.key || item.Key;
    let detail;
    try {
      detail = await managerApi("GET", "/api2" + formPath + "/" + key);
    } catch (e) {
      continue;
    }

    // Transaction ID field: empty/null means not yet exported (include it);
    // any value (this business already exported it) means exclude it.
    const txnIdValue = getCustomFieldValue(detail, downloadedFieldId, "number");
    const alreadyDownloaded = txnIdValue !== undefined && txnIdValue !== null && txnIdValue !== "";
    if (alreadyDownloaded) continue;

    const acctRef = extractAccountRef(item, detail);
    if (selectedKeys.length > 0 && acctRef.key && selectedKeys.indexOf(acctRef.key) === -1) continue;

    // Purchase Invoices commonly use "IssueDate" rather than "Date" (unlike
    // Receipts/Payments) — checking both plus a couple other likely variants.
    const tranDate = dateOnly(detail.Date || item.Date || item.date ||
                               detail.IssueDate || item.IssueDate || detail.issueDate || item.issueDate ||
                               detail.InvoiceDate || item.InvoiceDate);
    const enteredDate = localDateFromTimestamp(item.Timestamp || item.timestamp || detail.Timestamp);
    const amount = extractAmount(detail, item);
    const contactInfo = await resolveContactInfo(detail, item, sourceLabel);
    const contactName = contactInfo.name;
    const description = extractDescription(detail, item);

    let expendContactName = null;
    let expendContactInfo = null;
    if (sourceLabel === "Expense Claim") {
      expendContactInfo = await resolveExpendInfo(detail, item);
      if (expendContactInfo) expendContactName = expendContactInfo.name;
    }

    if (!loggedSample[sourceLabel]) {
      console.log("[ORESTAR] Sample raw " + sourceLabel + " record (list item):", item);
      console.log("[ORESTAR] Sample raw " + sourceLabel + " record (detail):", detail);
      loggedSample[sourceLabel] = true;
    }
    if (!tranDate) {
      console.warn("[ORESTAR] No date field matched for " + sourceLabel + " " + key + " — check the sample record above for the real field name.");
    }
    if (!amount) {
      console.warn("[ORESTAR] No amount field matched for " + sourceLabel + " " + key + " (resolved to 0).");
      console.log("[ORESTAR] " + sourceLabel + " " + key + " — ALL top-level field names:", Object.keys(detail || {}));
      const linesForDebug = (detail && (detail.Lines || detail.lines)) || (item && (item.Lines || item.lines));
      if (Array.isArray(linesForDebug) && linesForDebug.length > 0) {
        console.log("[ORESTAR] " + sourceLabel + " " + key + " — Lines[0] full content:", linesForDebug[0]);
        console.log("[ORESTAR] " + sourceLabel + " " + key + " — Lines[0] field names:", Object.keys(linesForDebug[0] || {}));
        // JSON.stringify prints as a plain string — immune to the console's
        // object-preview truncation that's been hiding the real values.
        console.log("[ORESTAR] " + sourceLabel + " " + key + " — Lines[0] as JSON string: " + JSON.stringify(linesForDebug[0]));
      }
    }

    let typeCode, subCode;
    if (forcedType) {
      typeCode = forcedType;
      subCode = forcedSubCode || "";
    } else {
      let typeText = "", subtypeText = "";
      const cfValue = getCustomFieldValueAny(detail, typeSubtypeFieldIds, "text");
      if (cfValue) {
        const parts = String(cfValue).split(" - ");
        typeText = parts[0].trim();
        subtypeText = parts.length > 1 ? parts.slice(1).join(" - ").trim() : "";
      }
      typeCode = TYPE_CODE[typeText] || "";
      subCode = subtypeText ? (SUBTYPE_TEXT_TO_CODE[subtypeText] || "") : "";
      if (!subCode && typeCode) subCode = DEFAULT_SUBTYPE[typeCode] || "";
    }

    const rawPaymentMethod = getCustomFieldValueAny(detail, paymentMethodFieldIds, "text");
    const paymentMethod = mapPaymentMethodText(rawPaymentMethod);
    const rawCheckNo = getCustomFieldValueAny(detail, checkNumberFieldIds, "number");
    const checkNo = (rawCheckNo !== undefined && rawCheckNo !== null) ? String(rawCheckNo) : "";

    const rawTranPurpose = getCustomFieldValueAny(detail, tranPurposeFieldIds, "text");
    let tranPurposeCodes = [];
    if (rawTranPurpose) {
      const parsed = parseTranPurposeText(rawTranPurpose);
      if (parsed.invalidTokens.length > 0) {
        console.warn("[ORESTAR] " + sourceLabel + " " + key + " has unrecognized Transaction Purpose value(s): \"" + parsed.invalidTokens.join("\", \"") + "\" — dropped. Check this matches a code or label from the valid list exactly.");
      }
      tranPurposeCodes = parsed.codes;
    }

    // If this Payment pays off one or more Purchase Invoices (filed
    // separately as Accounts Payable), it must be filed as a plain Cash
    // Expenditure regardless of any custom field, and linked back to the
    // originating AP transaction(s) via associated-tran.
    let apInvoiceRefs = [];
    if (sourceLabel !== "Purchase Invoice (AP)") {
      const invoiceKeys = extractInvoiceLinks(detail, item);
      if (invoiceKeys.length > 0) {
        typeCode = "E";
        subCode = "CE";
        for (let vi = 0; vi < invoiceKeys.length; vi++) {
          const existingTxnId = await resolveInvoiceTransactionId(invoiceKeys[vi]);
          apInvoiceRefs.push({ key: invoiceKeys[vi], existingTxnId: existingTxnId });
        }
      }
    }

    results.push({
      source: sourceLabel,
      key: key,
      formPath: formPath,
      date: tranDate,
      enteredDate: enteredDate,
      accountName: acctRef.name || acctRef.key || "(unknown)",
      amount: amount,
      contactName: contactName,
      contactInfo: contactInfo,
      typeCode: typeCode,
      subCode: subCode,
      description: description,
      paymentMethod: paymentMethod,
      checkNo: checkNo,
      apInvoiceRefs: apInvoiceRefs,
      tranPurposeCodes: tranPurposeCodes,
      expendContactName: expendContactName,
      expendContactInfo: expendContactInfo
    });
  }
  return { results: results, possiblyTruncated: possiblyTruncated, totalFetched: items.length };
}

document.getElementById("loadBtn").addEventListener("click", async function() {
  if (resolvedGuids.typeSubtypeCandidates.length === 0 || !resolvedGuids.transactionId) {
    showStatus("err", "Fields aren't fully resolved yet — click \"Load Accounts & Resolve Fields\" above first, and check the resolved-fields status for anything missing.");
    return;
  }

  showStatus("pending", "Loading not-yet-exported receipts, payments, expense claims, and purchase invoices…");
  try {
    const selectedKeys = selectedAccountKeys();

    const receiptResult = await loadCollection("/receipts", "/receipt-form", "Receipt", resolvedGuids.typeSubtypeCandidates, resolvedGuids.transactionId, resolvedGuids.paymentMethodCandidates, resolvedGuids.checkNumberCandidates, resolvedGuids.tranPurposeCandidates, selectedKeys);
    const paymentResult = await loadCollection("/payments", "/payment-form", "Payment", resolvedGuids.typeSubtypeCandidates, resolvedGuids.transactionId, resolvedGuids.paymentMethodCandidates, resolvedGuids.checkNumberCandidates, resolvedGuids.tranPurposeCandidates, selectedKeys);

    // Both endpoints below are UNCONFIRMED — inferred from the same naming
    // pattern that's worked for every other resource (receipts/payments).
    // Tolerating failure here rather than blocking the whole load, since
    // Receipts/Payments are the proven-working core of this tool.
    let expenseClaimResults = { results: [], possiblyTruncated: false, totalFetched: 0 };
    let purchaseInvoiceResults = { results: [], possiblyTruncated: false, totalFetched: 0 };
    try {
      expenseClaimResults = await loadCollection("/expense-claims", "/expense-claim-form", "Expense Claim", null, resolvedGuids.transactionId, resolvedGuids.paymentMethodCandidates, resolvedGuids.checkNumberCandidates, resolvedGuids.tranPurposeCandidates, selectedKeys, "E", "PE");
    } catch (e) {
      console.warn("[ORESTAR] Expense Claims fetch failed (endpoint may not match your version):", e.message);
    }
    try {
      purchaseInvoiceResults = await loadCollection("/purchase-invoices", "/purchase-invoice-form", "Purchase Invoice (AP)", null, resolvedGuids.transactionId, [], [], resolvedGuids.tranPurposeCandidates, selectedKeys, "E", "AP");
    } catch (e) {
      console.warn("[ORESTAR] Purchase Invoices fetch failed (endpoint may not match your version):", e.message);
    }

    loadedTransactions = receiptResult.results.concat(paymentResult.results, expenseClaimResults.results, purchaseInvoiceResults.results);

    if (loadedTransactions.length === 0) {
      showStatus("err", "No not-yet-exported transactions found for the selected account(s). If you expect some, check the resolved-fields status above, and that the account picker matches what you expect.");
      document.getElementById("reviewSection").style.display = "none";
      return;
    }

    renderReview();

    if (receiptResult.possiblyTruncated || paymentResult.possiblyTruncated || expenseClaimResults.possiblyTruncated || purchaseInvoiceResults.possiblyTruncated) {
      showStatus("err",
        "Loaded " + loadedTransactions.length + " transaction(s), but one or more sources are right at the fetch limit (" + FETCH_PAGE_SIZE + "). " +
        "Some not-yet-downloaded transactions may exist beyond what was fetched. Do not rely on this export as complete — increase FETCH_PAGE_SIZE, or cross-check manually, before filing.");
    } else {
      showStatus("ok", "Loaded " + loadedTransactions.length + " not-yet-downloaded transaction(s) — " + receiptResult.totalFetched + " receipt(s), " + paymentResult.totalFetched + " payment(s), " + expenseClaimResults.totalFetched + " expense claim(s), " + purchaseInvoiceResults.totalFetched + " purchase invoice(s) checked in total. Review below before generating XML.");
    }
  } catch (err) {
    showStatus("err", "Failed to load: " + err.message);
  }
});

function renderReview() {
  document.getElementById("reviewSection").style.display = "block";
  document.getElementById("txnIdSection").style.display = "none";
  const tbody = document.getElementById("tranBody");
  tbody.innerHTML = "";

  loadedTransactions.forEach(function(t, idx) {
    if (!contactsByName[t.contactName]) {
      contactsByName[t.contactName] = buildContactFromInfo(t.contactName, t.contactInfo);
    }
    if (t.expendContactName && !contactsByName[t.expendContactName]) {
      contactsByName[t.expendContactName] = buildContactFromInfo(t.expendContactName, t.expendContactInfo);
    }

    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + escapeXml(t.date) + "</td>" +
      '<td class="small">' + escapeXml(t.enteredDate || "—") + "</td>" +
      '<td class="small">' + escapeXml(t.accountName) + "</td>" +
      "<td>" + escapeXml(t.amount) + "</td>" +
      '<td><input data-idx="' + idx + '" data-field="contactName" value="' + escapeXml(t.contactName) + '"></td>' +
      "<td><select data-idx=\"" + idx + "\" data-field=\"typeCode\">" +
        Object.entries(TYPE_CODE).map(function(entry) {
          const label = entry[0], code = entry[1];
          return '<option value="' + code + '" ' + (code === t.typeCode ? "selected" : "") + ">" + label + " (" + code + ")</option>";
        }).join("") +
      "</select></td>" +
      "<td><select data-idx=\"" + idx + "\" data-field=\"subCode\"></select></td>" +
      '<td><input data-idx="' + idx + '" data-field="description" value="' + escapeXml(t.description) + '"></td>' +
      '<td><input data-idx="' + idx + '" data-field="tranPurpose" placeholder="e.g. R or G,T" value="' + escapeXml((t.tranPurposeCodes || []).join(",")) + '"></td>' +
      "<td><select data-idx=\"" + idx + "\" data-field=\"paymentMethod\">" +
        PAYMENT_METHODS.map(function(entry) {
          const code = entry[0], label = entry[1];
          return '<option value="' + code + '" ' + (code === t.paymentMethod ? "selected" : "") + ">" + label + "</option>";
        }).join("") +
      "</select></td>" +
      '<td><input data-idx="' + idx + '" data-field="checkNo" value="' + escapeXml(t.checkNo) + '"></td>' +
      '<td class="small">' + t.source + "</td>";
    tbody.appendChild(tr);
    populateSubtypeSelect(idx);
  });

  tbody.querySelectorAll("input, select").forEach(function(el) {
    el.addEventListener("change", function(e) {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      if (field === "tranPurpose") {
        const parsed = parseTranPurposeText(e.target.value);
        if (parsed.invalidTokens.length > 0) {
          e.target.style.borderColor = "#c0392b";
        } else {
          e.target.style.borderColor = "";
          loadedTransactions[idx].tranPurposeCodes = parsed.codes;
        }
        return;
      }
      loadedTransactions[idx][field] = e.target.value;
      if (field === "typeCode") populateSubtypeSelect(idx);
      if (field === "contactName") {
        if (!contactsByName[e.target.value]) contactsByName[e.target.value] = guessContact(e.target.value);
        renderContacts();
      }
    });
  });

  renderContacts();
}

function populateSubtypeSelect(idx) {
  const t = loadedTransactions[idx];
  const select = document.querySelector('select[data-idx="' + idx + '"][data-field="subCode"]');
  const options = SUBTYPE_OPTIONS[t.typeCode] || [];
  select.innerHTML = options.map(function(entry) {
    const code = entry[0], label = entry[1];
    return '<option value="' + code + '" ' + (code === t.subCode ? "selected" : "") + ">" + label + " (" + code + ")</option>";
  }).join("");
  if (!options.some(function(entry) { return entry[0] === t.subCode; })) {
    t.subCode = options[0] ? options[0][0] : "";
    select.value = t.subCode;
  }
}

function guessContact(name) {
  const parts = name.trim().split(/\s+/);
  const looksLikePerson = parts.length >= 2 && parts.length <= 4;
  return {
    type: looksLikePerson ? "I" : "B",
    first: looksLikePerson ? parts[0] : "",
    last: looksLikePerson ? parts.slice(1).join(" ") : "",
    business: looksLikePerson ? "" : name,
    committeeName: "",
    street1: "", city: "", state: "", zip: "", county: "",
    occupation: "", employerName: "", employerCity: "", employerState: "", employmentStatus: null,
    contactId: "", recordKey: null, recordEndpoint: null
  };
}

// Starts from the name-splitting heuristic (still needed for first/last vs.
// business-name structure), then overrides with real resolved data from the
// Customer/Supplier/Employee record wherever we actually have it — type,
// occupation, and employer info no longer need to be guessed or hand-typed
// when Manager already has them.
// Confirmed with the ORESTAR admin directly: contact matching/dedup is done
// by the contact/@id attribute itself, not by data-matching as the older SOS
// doc implied. That means the id MUST be the same every time the same person
// is filed, not freshly generated per file. Solved without needing to store
// or look anything up: derive it deterministically from the linked Manager
// record's own permanent key (stripped of hyphens, truncated to the schema's
// 30-char limit) — the same Customer/Supplier/Employee record always
// produces the same id, automatically, forever. A manually-entered "People
// ID" (if you have one from before this tool existed) takes priority over
// the derived one, for migrating pre-existing ORESTAR contacts.
function deriveStableContactId(c) {
  if (c.contactId) return String(c.contactId).trim();
  if (c.recordKey) return String(c.recordKey).replace(/-/g, "").slice(0, 30);
  return null;
}

function buildContactFromInfo(name, info) {
  const base = guessContact(name);
  if (!info) return base;
  if (info.type) {
    base.type = info.type;
    // Re-split the name according to the *real* type, not the heuristic's guess.
    if (info.type === "I" || info.type === "F") {
      const parts = name.trim().split(/\s+/);
      base.first = parts[0] || "";
      base.last = parts.slice(1).join(" ");
      base.business = "";
    } else {
      base.business = name;
      base.first = ""; base.last = "";
    }
  }
  if (info.occupation) base.occupation = info.occupation;
  if (info.employerName) base.employerName = info.employerName;
  if (info.employerCity) base.employerCity = info.employerCity;
  if (info.employerState) base.employerState = info.employerState;
  if (info.employmentStatus) base.employmentStatus = info.employmentStatus;
  if (info.street1) base.street1 = info.street1;
  if (info.city) base.city = info.city;
  if (info.state) base.state = info.state;
  if (info.zip) base.zip = info.zip;
  if (info.contactId) base.contactId = info.contactId;
  if (info.recordKey) { base.recordKey = info.recordKey; base.recordEndpoint = info.recordEndpoint; }
  return base;
}

function renderContacts() {
  const container = document.getElementById("contactsList");
  container.innerHTML = "";
  Object.keys(contactsByName).forEach(function(name) {
    const c = contactsByName[name];
    const card = document.createElement("div");
    card.className = "contact-card";
    card.innerHTML =
      "<h4>" + escapeXml(name) + "</h4>" +
      '<div class="row">' +
        "<div><label>Contact Type</label><select data-name=\"" + escapeXml(name) + "\" data-field=\"type\">" +
          CONTACT_TYPES.map(function(entry) {
            const code = entry[0], label = entry[1];
            return '<option value="' + code + '" ' + (code === c.type ? "selected" : "") + ">" + label + " (" + code + ")</option>";
          }).join("") +
        "</select></div>" +
        '<div class="cn-individual" style="display:' + (c.type === "I" || c.type === "F" ? "flex" : "none") + '; gap:10px; flex:2;">' +
          '<div><label>First</label><input data-name="' + escapeXml(name) + '" data-field="first" value="' + escapeXml(c.first) + '"></div>' +
          '<div><label>Last</label><input data-name="' + escapeXml(name) + '" data-field="last" value="' + escapeXml(c.last) + '"></div>' +
        "</div>" +
        '<div class="cn-business" style="display:' + (c.type === "B" || c.type === "L" || c.type === "O" ? "block" : "none") + '; flex:2;">' +
          '<label>Business / Org Name</label><input data-name="' + escapeXml(name) + '" data-field="business" value="' + escapeXml(c.business) + '">' +
        "</div>" +
        '<div class="cn-committee" style="display:' + (c.type === "C" || c.type === "P" ? "block" : "none") + '; flex:2;">' +
          '<label>Committee Name</label><input data-name="' + escapeXml(name) + '" data-field="committeeName" value="' + escapeXml(c.committeeName) + '">' +
        "</div>" +
      "</div>" +
      '<div class="small" style="margin:6px 0 4px;">Optional — fill in if this contact\'s yearly total exceeds $100:</div>' +
      '<div class="row">' +
        '<div><label>Street</label><input data-name="' + escapeXml(name) + '" data-field="street1" value="' + escapeXml(c.street1) + '"></div>' +
        '<div><label>City</label><input data-name="' + escapeXml(name) + '" data-field="city" value="' + escapeXml(c.city) + '"></div>' +
        '<div><label>State</label><input data-name="' + escapeXml(name) + '" data-field="state" maxlength="2" value="' + escapeXml(c.state) + '"></div>' +
        '<div><label>Zip</label><input data-name="' + escapeXml(name) + '" data-field="zip" value="' + escapeXml(c.zip) + '"></div>' +
      "</div>" +
      '<div class="row" style="display:' + (c.type === "I" || c.type === "F" ? "flex" : "none") + '">' +
        '<div><label>Occupation</label><input data-name="' + escapeXml(name) + '" data-field="occupation" value="' + escapeXml(c.occupation) + '"></div>' +
        "<div><label>Employment Status</label><select data-name=\"" + escapeXml(name) + "\" data-field=\"employmentStatus\">" +
          '<option value="" ' + (!c.employmentStatus ? "selected" : "") + '>Has an employer</option>' +
          '<option value="not-employed" ' + (c.employmentStatus === "not-employed" ? "selected" : "") + '>Not Employed</option>' +
          '<option value="self-employed" ' + (c.employmentStatus === "self-employed" ? "selected" : "") + '>Self-Employed</option>' +
        "</select></div>" +
      "</div>" +
      '<div class="row" style="display:' + (c.employmentStatus ? "none" : "flex") + '" data-employer-row="' + escapeXml(name) + '">' +
        '<div><label>Employer</label><input data-name="' + escapeXml(name) + '" data-field="employerName" value="' + escapeXml(c.employerName) + '"></div>' +
        '<div><label>Employer City</label><input data-name="' + escapeXml(name) + '" data-field="employerCity" value="' + escapeXml(c.employerCity) + '"></div>' +
        '<div><label>Employer State</label><input data-name="' + escapeXml(name) + '" data-field="employerState" maxlength="2" value="' + escapeXml(c.employerState) + '"></div>' +
      "</div>" +
      '<div class="row">' +
        '<div><label>Contact ID <span class="hint">The ID ORESTAR matches this contact on. Auto-filled if blank (derived from the Manager record) — edit here or directly in Manager to reconcile with an existing ORESTAR ID; either way, "Save Contact IDs to Manager" keeps this in sync.</span></label><input data-name="' + escapeXml(name) + '" data-field="contactId" value="' + escapeXml(c.contactId) + '"></div>' +
      "</div>";
    container.appendChild(card);
  });

  container.querySelectorAll("input, select").forEach(function(el) {
    el.addEventListener("change", function(e) {
      const name = e.target.dataset.name;
      const field = e.target.dataset.field;
      contactsByName[name][field] = e.target.value;
      if (field === "type" || field === "employmentStatus") renderContacts();
    });
  });
}

document.getElementById("saveContactIdsBtn").addEventListener("click", async function() {
  const el = document.getElementById("contactIdStatus");
  if (!resolvedGuids.contactId) {
    el.textContent = "The \"Contact ID\" custom field wasn't found — create it in Manager (Text-type, on Customer/Supplier/Employee) and click \"Load Accounts & Resolve Fields\" again first.";
    return;
  }
  const entries = Object.keys(contactsByName)
    .map(function(name) { return contactsByName[name]; })
    .filter(function(c) { return c.recordKey && c.recordEndpoint; });

  if (entries.length === 0) {
    el.textContent = "Nothing to save — no contacts resolved to an actual Customer/Supplier/Employee record (manually-typed contact names with no linked record can't be saved back).";
    return;
  }

  el.textContent = "Saving " + entries.length + " Contact ID(s)…";
  let succeeded = 0;
  let unchanged = 0;
  const failures = [];
  for (let i = 0; i < entries.length; i++) {
    const c = entries[i];
    // Uses whatever's already in the Contact ID field if present; otherwise
    // derives one from the record and writes it, so the field ends up
    // populated either way and reflects exactly what's used in the XML.
    const finalId = deriveStableContactId(c);
    if (!finalId) { failures.push(c.recordKey + ": couldn't derive an ID (no record key)"); continue; }
    if (c.contactId === finalId) { unchanged++; continue; } // already correct in Manager, skip the write
    try {
      await safeSetCustomField("/" + c.recordEndpoint, c.recordKey, resolvedGuids.contactId, "text", finalId);
      c.contactId = finalId;
      succeeded++;
    } catch (e) {
      failures.push(c.recordKey + ": " + e.message);
    }
  }

  if (failures.length === 0) {
    el.textContent = "Saved " + succeeded + " Contact ID(s) to Manager (" + unchanged + " already up to date). They'll auto-fill next time you load these contacts.";
  } else {
    el.textContent = "Saved " + succeeded + " of " + (entries.length - unchanged) + " needed. Failures:\n" + failures.join("\n");
  }
});

function buildContactXml(id, c) {
  let nameXml;
  if (c.type === "I" || c.type === "F") {
    nameXml = "<individual-name><first>" + escapeXml(c.first) + "</first><last>" + escapeXml(c.last) + "</last></individual-name>";
  } else if (c.type === "C" || c.type === "P") {
    nameXml = "<committee><name>" + escapeXml(c.committeeName) + "</name></committee>";
  } else {
    nameXml = "<business-name>" + escapeXml(c.business) + "</business-name>";
  }

  let addressXml = "";
  if (c.street1 || c.city || c.state || c.zip) {
    addressXml = "<address>" +
      (c.street1 ? "<street1>" + escapeXml(c.street1) + "</street1>" : "") +
      (c.city ? "<city>" + escapeXml(c.city) + "</city>" : "") +
      (c.state ? "<state>" + escapeXml(c.state) + "</state>" : "") +
      (c.zip ? "<zip>" + escapeXml(c.zip) + "</zip>" : "") +
      (c.county ? "<county>" + escapeXml(c.county) + "</county>" : "") +
      "</address>";
  }

  let employmentXml = "";
  if (c.employmentStatus === "not-employed") {
    employmentXml = "<employment><not-employed>Yes</not-employed></employment>";
  } else if (c.employmentStatus === "self-employed") {
    employmentXml = "<employment><self-employed>Yes</self-employed></employment>";
  } else if (c.employerName) {
    employmentXml = "<employment><employer-name>" + escapeXml(c.employerName) + "</employer-name>" +
      (c.employerCity ? "<city>" + escapeXml(c.employerCity) + "</city>" : "") +
      (c.employerState ? "<state>" + escapeXml(c.employerState) + "</state>" : "") +
      "</employment>";
  }

  return "<contact id=\"" + escapeXml(id) + "\">" +
    "<type>" + c.type + "</type>" +
    "<contact-name>" + nameXml + "</contact-name>" +
    addressXml +
    (c.occupation ? "<occupation>" + escapeXml(c.occupation) + "</occupation>" : "") +
    employmentXml +
    "</contact>";
}

function buildTransactionXml(id, contactId, t, associatedTrans, expendId) {
  const assocXml = (associatedTrans && associatedTrans.length > 0)
    ? associatedTrans.map(function(a) {
        return "<associated-tran><id>" + escapeXml(a.id) + "</id><complete>" + (a.complete ? "Y" : "N") + "</complete></associated-tran>";
      }).join("")
    : "";
  const purposeXml = (t.tranPurposeCodes && t.tranPurposeCodes.length > 0)
    ? t.tranPurposeCodes.map(function(code) { return "<tran-purpose>" + code + "</tran-purpose>"; }).join("")
    : "";
  return "<transaction id=\"" + escapeXml(id) + "\">" +
    "<operation><add>true</add></operation>" +
    "<contact-id>" + escapeXml(contactId) + "</contact-id>" +
    (expendId ? "<expend-id>" + escapeXml(expendId) + "</expend-id>" : "") +
    "<type>" + t.typeCode + "</type>" +
    "<sub-type>" + t.subCode + "</sub-type>" +
    purposeXml +
    (t.description ? "<description>" + escapeXml(t.description.slice(0,200)) + "</description>" : "") +
    "<amount>" + Math.abs(t.amount) + "</amount>" +
    (t.paymentMethod ? "<payment-method>" + t.paymentMethod + "</payment-method>" : "") +
    "<date>" + t.date + "</date>" +
    (t.checkNo ? "<check-no>" + escapeXml(t.checkNo) + "</check-no>" : "") +
    assocXml +
    "</transaction>";
}

let lastGeneratedFilerId = "";

document.getElementById("generateBtn").addEventListener("click", async function() {
  const filerId = document.getElementById("resolvedFilerId").value.trim();
  if (!filerId) { showStatus("err", "Filer ID hasn't resolved yet — click \"Load Accounts & Filer ID\" above and check for errors."); return; }
  if (loadedTransactions.some(function(t) { return !t.typeCode || !t.subCode; })) {
    showStatus("err", "Every transaction needs a Type and Sub-type — check the table above.");
    return;
  }
  const unfilledContacts = loadedTransactions.filter(function(t) { return /^\(no contact - /.test(t.contactName); });
  if (unfilledContacts.length > 0) {
    showStatus("err", unfilledContacts.length + " transaction(s) still have a placeholder Contact Name (starts with \"(no contact - \") instead of a real name — fix those in the Contact Name column above before generating. These weren't linked to a Customer/Supplier/Contact record in Manager, so they need a name entered manually.");
    return;
  }
  const missingRequiredDescription = loadedTransactions.filter(function(t) {
    return (t.tranPurposeCodes || []).some(function(code) { return TRAN_PURPOSE_CODES[code] && TRAN_PURPOSE_CODES[code].requiresDescription; }) && !t.description;
  });
  if (missingRequiredDescription.length > 0) {
    showStatus("err", missingRequiredDescription.length + " transaction(s) have a Transaction Purpose code (G or T) that requires a Description, but the Description is blank — fill those in above before generating.");
    return;
  }
  lastGeneratedFilerId = filerId;

  showStatus("pending", "Generating…");
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const contactIdByName = {};
  let contactCounter = 1;
  const contactXmlParts = [];
  let autoSavedCount = 0;
  const autoSaveFailures = [];
  for (const entry of Object.entries(contactsByName)) {
    const name = entry[0], c = entry[1];
    const isUsed = loadedTransactions.some(function(t) { return t.contactName === name || t.expendContactName === name; });
    if (!isUsed) continue;
    // Stable ID (same person → same id, every filing, forever) when this
    // contact resolved from an actual Manager record or has a manually-set
    // Contact ID. Only manually-typed contacts with no linked record at all
    // fall back to a fresh per-file id, since there's no stable source to
    // derive one from — these should be rare given the placeholder-name
    // validation earlier in this function.
    const id = deriveStableContactId(c) || ("C" + stamp + "-" + (contactCounter++));
    contactIdByName[name] = id;
    // Auto-save: if this contact didn't already have a Contact ID saved in
    // Manager, write the freshly-derived one back immediately, so it's
    // captured the first time without needing the separate Save button.
    if (!c.contactId && c.recordKey && c.recordEndpoint && resolvedGuids.contactId) {
      try {
        await safeSetCustomField("/" + c.recordEndpoint, c.recordKey, resolvedGuids.contactId, "text", id);
        c.contactId = id;
        autoSavedCount++;
      } catch (e) {
        autoSaveFailures.push(name + ": " + e.message);
      }
    }
    contactXmlParts.push(buildContactXml(id, c));
  }

  // Assign this batch's transaction IDs first, and build a lookup from each
  // Purchase Invoice's own Manager record key to its freshly-assigned file
  // ID — needed below for AP payoffs whose invoice is being filed in this
  // same batch (no existing ORESTAR-assigned Transaction ID yet).
  const localTranIds = loadedTransactions.map(function(t, i) { return "T" + stamp + "-" + (i + 1); });
  const invoiceKeyToLocalTranId = {};
  loadedTransactions.forEach(function(t, i) {
    if (t.source === "Purchase Invoice (AP)") invoiceKeyToLocalTranId[t.key] = localTranIds[i];
  });

  const unlinkedApWarnings = [];
  const tranXmlParts = loadedTransactions.map(function(t, i) {
    let associatedTrans = [];
    if (t.apInvoiceRefs && t.apInvoiceRefs.length > 0) {
      t.apInvoiceRefs.forEach(function(ref) {
        const linkedId = ref.existingTxnId || invoiceKeyToLocalTranId[ref.key];
        if (linkedId) {
          associatedTrans.push({ id: linkedId, complete: true });
        } else {
          unlinkedApWarnings.push(t.contactName + " (" + t.date + ", $" + t.amount + ") pays off an invoice that hasn't been filed yet and isn't in this batch — export/file that Purchase Invoice first.");
        }
      });
    }
    const expendId = t.expendContactName ? contactIdByName[t.expendContactName] : null;
    return buildTransactionXml(localTranIds[i], contactIdByName[t.contactName], t, associatedTrans, expendId);
  });

  const apWarningText = unlinkedApWarnings.length > 0
    ? "\n\n⚠ " + unlinkedApWarnings.length + " AP payoff(s) couldn't be linked (filed as plain Cash Expenditures, no associated-tran):\n" +
      unlinkedApWarnings.slice(0, 5).join("\n") + (unlinkedApWarnings.length > 5 ? "\n…and " + (unlinkedApWarnings.length - 5) + " more" : "")
    : "";

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<campaign-finance-transactions xmlns="http://www.state.or.us/sos/ebs2/ce/dataobject" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://www.state.or.us/sos/ebs2/ce/dataobject" ' +
    'filer-id="' + escapeXml(filerId) + '">\n' +
    contactXmlParts.join("\n") + "\n" +
    tranXmlParts.join("\n") + "\n" +
    "</campaign-finance-transactions>";

  const output = document.getElementById("xmlOutput");
  output.style.display = "block";
  output.value = xml;
  document.getElementById("downloadBtn").disabled = false;
  document.getElementById("downloadBtn").onclick = function() {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "orestar-export-" + new Date().toISOString().slice(0,10) + ".xml";
    a.click();
    URL.revokeObjectURL(url);
  };
  renderTxnIdTable();
  document.getElementById("txnIdSection").style.display = "block";
  const autoSaveText = autoSavedCount > 0 ? (" " + autoSavedCount + " new Contact ID(s) auto-saved to Manager.") : "";
  const autoSaveFailText = autoSaveFailures.length > 0
    ? ("\n\n⚠ " + autoSaveFailures.length + " Contact ID(s) failed to auto-save (XML still generated fine, just re-run \"Save Contact IDs to Manager\" to retry):\n" + autoSaveFailures.slice(0, 5).join("\n"))
    : "";
  showStatus((apWarningText || autoSaveFailText) ? "err" : "ok",
    "XML generated. Review it below, download it, and upload it through ORESTAR's Upload File page. Once ORESTAR gives you back Transaction IDs, enter them in the table below and save." + autoSaveText + apWarningText + autoSaveFailText);
});

function renderTxnIdTable() {
  const tbody = document.getElementById("txnIdBody");
  tbody.innerHTML = "";
  loadedTransactions.forEach(function(t, idx) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + escapeXml(t.date) + "</td>" +
      "<td>" + escapeXml(t.contactName) + "</td>" +
      "<td>" + escapeXml(t.amount) + "</td>" +
      "<td>" + escapeXml(t.typeCode) + (t.subCode ? "/" + escapeXml(t.subCode) : "") + "</td>" +
      '<td><input data-idx="' + idx + '" data-field="orestarTxnId" placeholder="numeric ID from ORESTAR"></td>';
    tbody.appendChild(tr);
  });
}

document.getElementById("saveTxnIdsBtn").addEventListener("click", async function() {
  const cfTransactionId = resolvedGuids.transactionId;
  if (!cfTransactionId) { showMarkStatus("err", "Transaction ID field wasn't resolved — click \"Load Accounts & Resolve Fields\" above first."); return; }

  const rows = document.querySelectorAll('#txnIdBody input[data-field="orestarTxnId"]');
  const entries = []; // { idx, value }
  let hasInvalid = false;
  rows.forEach(function(input) {
    const raw = input.value.trim();
    if (raw === "") return; // blank rows are skipped entirely, nothing written
    if (!/^\d+$/.test(raw)) {
      hasInvalid = true;
      input.style.borderColor = "#c0392b";
      return;
    }
    input.style.borderColor = "";
    entries.push({ idx: Number(input.dataset.idx), value: raw });
  });

  if (hasInvalid) {
    showMarkStatus("err", "One or more Transaction IDs isn't a plain number (highlighted in red) — ORESTAR Transaction IDs and this field are numeric. Fix those and try again.");
    return;
  }
  if (entries.length === 0) {
    showMarkStatus("err", "No Transaction IDs entered — fill in at least one row before saving.");
    return;
  }

  document.getElementById("saveTxnIdsBtn").disabled = true;
  showMarkStatus("pending", "Saving " + entries.length + " Transaction ID(s) to Manager…");

  let succeeded = 0;
  const failures = [];
  for (const entry of entries) {
    const t = loadedTransactions[entry.idx];
    try {
      await safeSetCustomField(t.formPath, t.key, cfTransactionId, "number", Number(entry.value));
      succeeded++;
    } catch (e) {
      failures.push(t.source + " " + t.key + " (entered ID " + entry.value + "): " + e.message);
    }
  }

  document.getElementById("saveTxnIdsBtn").disabled = false;
  if (failures.length === 0) {
    showMarkStatus("ok", "Saved " + succeeded + " Transaction ID(s). Those transactions won't appear in your next export.");
  } else {
    showMarkStatus("err",
      "Saved " + succeeded + " of " + entries.length + ". " + failures.length + " failed — retry these:\n" +
      failures.slice(0, 10).join("\n") + (failures.length > 10 ? "\n…and " + (failures.length - 10) + " more" : ""));
  }
});
