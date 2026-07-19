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

// Best-guess default sub-type when your field only captured the top-level
// Type (no cascading subtype is offered for that category in Manager).
const DEFAULT_SUBTYPE = { "C": "CA", "OA": "OR", "OR": "OM", "E": "CE", "OD": "OMD" };

// Maps the human text stored in your Contribution subtype dropdown to its
// ORESTAR code (only Contributions currently cascades in Manager).
const SUBTYPE_TEXT_TO_CODE = {
  "Cash Contribution": "CA",
  "In-Kind Contribution": "IK",
  "In-Kind/Forgiven Personal Expenditures": "IKP",
  "In-Kind/Forgiven Account Payable": "IKA",
  "Loan Received (Non-Exempt)": "NLR"
};

const PAYMENT_METHODS = [["","(none)"],["CHK","Check"],["ACH","Electronic Check"],["EFT","Electronic Funds Transfer"],
                          ["DC","Debit Card"],["CC","Credit Card"]];

const CONTACT_TYPES = [
  ["I","Individual"], ["F","Candidate's Immediate Family"], ["B","Business Entity"],
  ["L","Labor Organization"], ["O","Other"], ["C","Political Committee"], ["P","Political Party Committee"]
];

/* ============================================================ */

let loadedTransactions = []; // { source, key, formPath, date, enteredDate, accountName, amount, contactName, typeCode, subCode, description, paymentMethod, checkNo }
let contactsByName = {};
let availableAccounts = [];  // { key, name, kind: 'bank'|'cash' }

/* ============================================================
   Connection config — persisted in this browser's localStorage
   instead of coming from Manager's injected iframe context. This
   page can now be opened directly (bookmark, new tab) rather than
   depending on the Custom Buttons/Extensions embed mechanism.
   ============================================================ */
const STORAGE_KEY = "orestar_export_config";

function loadStoredConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (e) {
    return {};
  }
}
function saveConfig() {
  const cfg = {
    baseUrl: document.getElementById("baseUrl").value.trim(),
    apiToken: document.getElementById("apiToken").value.trim(),
    businessName: document.getElementById("businessName").value.trim(),
    cfFiler: document.getElementById("cfFiler").value.trim(),
    cfTypeSubtype: document.getElementById("cfTypeSubtype").value.trim(),
    cfDownloaded: document.getElementById("cfDownloaded").value.trim()
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.warn("Could not save config to localStorage:", e.message);
  }
}
(function restoreConfig() {
  const cfg = loadStoredConfig();
  if (cfg.baseUrl) document.getElementById("baseUrl").value = cfg.baseUrl;
  if (cfg.apiToken) document.getElementById("apiToken").value = cfg.apiToken;
  if (cfg.businessName) document.getElementById("businessName").value = cfg.businessName;
  if (cfg.cfFiler) document.getElementById("cfFiler").value = cfg.cfFiler;
  if (cfg.cfTypeSubtype) document.getElementById("cfTypeSubtype").value = cfg.cfTypeSubtype;
  if (cfg.cfDownloaded) document.getElementById("cfDownloaded").value = cfg.cfDownloaded;
})();
["baseUrl", "apiToken", "businessName", "cfFiler", "cfTypeSubtype", "cfDownloaded"].forEach(id => {
  document.getElementById(id).addEventListener("change", saveConfig);
});

function getBusinessName() {
  return document.getElementById("businessName").value.trim();
}

function getBaseUrl() {
  return document.getElementById("baseUrl").value.trim().replace(/\/+$/, "");
}
// Manager runs two parallel API generations on the same server — the older
// /api2 (receipts, payments, business-details, etc.) and a newer /api4 that
// some newer resources live under exclusively (confirmed: bank-or-cash-account).
// Derived by swapping the version segment in whatever /api2 URL was configured.
function getBaseUrlV4() {
  return getBaseUrl().replace(/\/api2$/i, "/api4");
}
function getApiToken() {
  return document.getElementById("apiToken").value.trim();
}
function hasConnection() {
  return !!(getBaseUrl() && getApiToken());
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
  return String(str ?? "").replace(/[<>&'"]/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  }[c]));
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

// Manager's "Timestamp" field is when the record was actually created/last
// touched (system clock, stored as UTC). Shown for reference only — filtering
// is now driven by the "Downloaded" checkbox, not by date.
function localDateFromTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function apiGet(path) {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: { "X-Api-Key": getApiToken(), "accept": "application/json" }
  });
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`);
  return res.json();
}

async function apiGetV4(path) {
  const businessName = getBusinessName();
  if (!businessName) throw new Error("Business Name isn't set yet — click \"Detect Business\" above, or it should auto-fill after Test Connection.");
  const separator = path.includes("?") ? "&" : "?";
  const url = `${getBaseUrlV4()}${path}${separator}business=${encodeURIComponent(businessName)}`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": getApiToken(), "accept": "application/json" }
  });
  if (!res.ok) throw new Error(`GET (v4) ${path} failed: HTTP ${res.status}`);
  return res.json();
}

// Auto-detect the business name instead of asking it to be typed (spaces in
// the name caused issues as a raw header value — encodeURIComponent as a
// query param, per the server's own error message, handles that cleanly).
// /api4/businesses lists what this token can access; if there's exactly one,
// we use it directly rather than requiring manual entry at all.
async function detectBusinessName() {
  const res = await fetch(`${getBaseUrlV4()}/businesses`, {
    headers: { "X-Api-Key": getApiToken(), "accept": "application/json" }
  });
  if (!res.ok) throw new Error(`GET /businesses failed: HTTP ${res.status}`);
  const data = await res.json();
  const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
  const businesses = arrayKey ? data[arrayKey] : (Array.isArray(data) ? data : []);
  if (businesses.length === 0) throw new Error("No businesses returned from /api4/businesses.");
  if (businesses.length === 1) {
    return businesses[0].Name || businesses[0].name;
  }
  // Multiple businesses on this server/token — can't guess, list them for manual pick.
  const names = businesses.map(b => b.Name || b.name).join(", ");
  throw new Error(`Multiple businesses found (${names}) — set Business Name manually to the one you want.`);
}

// UNCONFIRMED: Manager's update verb for api2 isn't documented anywhere I could
// find. Guessing PUT (standard REST convention, matches their "-form/{key}"
// pattern for a single record). Falls back to PATCH if PUT is rejected outright.
async function apiUpdate(path, body) {
  let res = await fetch(`${getBaseUrl()}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": getApiToken()
    },
    body: JSON.stringify(body)
  });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(`${getBaseUrl()}${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": getApiToken()
      },
      body: JSON.stringify(body)
    });
  }
  if (!res.ok) throw new Error(`Update ${path} failed: HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

document.getElementById("forgetBtn").addEventListener("click", () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("Could not clear localStorage:", e.message);
  }
  ["baseUrl", "apiToken", "cfFiler", "cfTypeSubtype", "cfDownloaded"].forEach(id => {
    document.getElementById(id).value = "";
  });
  const el = document.getElementById("connStatus");
  el.style.display = "block";
  el.className = "banner";
  el.textContent = "Saved credentials and config cleared from this browser.";
});

document.getElementById("detectBusinessBtn").addEventListener("click", async () => {
  const el = document.getElementById("connStatus");
  el.style.display = "block";
  el.className = "banner";
  if (!getBaseUrl() || !getApiToken()) {
    el.textContent = "Fill in Base URL and Access Token first.";
    return;
  }
  el.textContent = "Detecting business…";
  try {
    const name = await detectBusinessName();
    document.getElementById("businessName").value = name;
    saveConfig();
    el.textContent = `Business detected: ${name}`;
  } catch (e) {
    el.textContent = `Could not auto-detect: ${e.message}`;
  }
});

document.getElementById("testConnBtn").addEventListener("click", async () => {
  const el = document.getElementById("connStatus");
  el.style.display = "block";
  el.className = "banner";
  el.textContent = "Testing connection…";
  if (!hasConnection()) {
    el.textContent = "Fill in both the Base URL and Access Token first.";
    return;
  }
  try {
    // /receipts is well-confirmed from community examples — testing against
    // it keeps this check independent of the still-uncertain Business
    // Details endpoint name, so a wrong guess there doesn't make basic
    // connectivity look broken too.
    await apiGet(`/receipts?pageSize=1`);
    saveConfig();
    el.textContent = "Connected successfully.";
    // Auto-detect business name too, since /api4 calls need it and typing
    // it by hand ran into encoding issues with spaces.
    if (!getBusinessName()) {
      try {
        const name = await detectBusinessName();
        document.getElementById("businessName").value = name;
        saveConfig();
        el.textContent = `Connected successfully. Business detected: ${name}`;
      } catch (e) {
        el.textContent = `Connected successfully. Could not auto-detect business name: ${e.message} (you can set it manually, or click Detect Business separately).`;
      }
    }
  } catch (e) {
    el.textContent = `Connection failed: ${e.message}. Double-check the Base URL (should end in /api2, no trailing slash issues) and that the Access Token is still valid in Settings → Access Tokens.`;
  }
});

function getCustomFieldValue(detail, fieldId, kind) {
  if (!detail || !detail.CustomFields2 || !fieldId) return undefined;
  const cf = detail.CustomFields2;
  if (kind === "checkbox") {
    return (cf.Checkboxes && cf.Checkboxes[fieldId]) ?? (cf.Booleans && cf.Booleans[fieldId]);
  }
  if (kind === "number") {
    return (cf.Decimals && cf.Decimals[fieldId]) ?? (cf.Numbers && cf.Numbers[fieldId]) ?? (cf.Strings && cf.Strings[fieldId]);
  }
  return cf.Strings && cf.Strings[fieldId];
}

// UNCONFIRMED endpoint name — following Manager's "{resource}-form" singleton
// pattern (there's only one Business Details record per business).
// The "-form" suffix apparently requires a trailing GUID key in Manager's
// router (same pattern as receipt-form/{key}) — a bare "business-details-form"
// with nothing after it got misrouted, confirmed by the server's own error
// message. Trying plausible alternates instead of guessing once more blind.
const BUSINESS_DETAILS_CANDIDATES = [
  "/business-details",
  "/businessDetails",
  "/business",
  "/settings/business-details"
];

async function fetchFilerId(filerFieldId) {
  let detail = null;
  let workingPath = null;
  const attempts = [];

  for (const path of BUSINESS_DETAILS_CANDIDATES) {
    try {
      detail = await apiGet(path);
      workingPath = path;
      attempts.push(`${path} — SUCCESS`);
      break;
    } catch (e) {
      attempts.push(`${path} — ${e.message}`);
      console.warn(`[ORESTAR] ${path} failed:`, e.message);
    }
  }

  if (!detail) {
    throw new Error(`Could not find the Business Details endpoint. Results:\n${attempts.join("\n")}\nA 401 means that path exists but auth was rejected for it specifically (worth checking separately from plain 404s) — check the Network tab response body on that one for more detail.`);
  }
  console.log(`[ORESTAR] Business Details found at: ${workingPath}`);

  const raw = getCustomFieldValue(detail, filerFieldId, "number");
  if (raw == null || raw === "") throw new Error(`Filer ID field came back empty from ${workingPath} — check the GUID and that the field actually has a value set in Business Details.`);
  const cleaned = String(raw).trim();
  if (!/^\d+$/.test(cleaned)) throw new Error(`Filer ID value "${cleaned}" isn't a plain positive integer — ORESTAR requires filer-id to be numeric.`);
  return cleaned;
}

// Endpoint confirmed by user: "bank-or-cash-account" is the combined resource
// covering both Bank and Cash accounts (matches the single "Bank and Cash
// Accounts" tab in the UI). Trying the plural form first since every other
// Manager list endpoint we've confirmed (/receipts, /payments, /customers)
// is plural — falling back to the exact singular form given if that 404s.
// Confirmed via live testing: this resource lives under /api4, not /api2 —
// singular "account", unlike most /api2 list endpoints (receipts, payments)
// which are plural.
// Confirmed via live discovery sweep: this resource is /bank-and-cash-accounts
// ("and", not "or") on the regular /api2 base — no /api4 needed after all.
async function fetchAccounts() {
  const data = await apiGet(`/bank-and-cash-accounts?pageSize=1000`);
  const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
  const items = arrayKey ? data[arrayKey] : [];
  return items.map(a => {
    // Field name for bank-vs-cash isn't confirmed — check common candidates,
    // fall back to a generic label rather than guessing wrong silently.
    const rawKind = a.Type || a.AccountType || a.Kind || (a.IsCashAccount ? "Cash" : null);
    return {
      key: a.key || a.Key,
      name: a.Name || a.name || "(unnamed account)",
      kind: rawKind ? String(rawKind).toLowerCase() : "account"
    };
  });
}

document.getElementById("listFieldsBtn").addEventListener("click", async () => {
  const el = document.getElementById("fieldsListResult");
  if (!hasConnection()) {
    el.innerHTML = `<span class="small">Fill in Base URL and Access Token, and Test Connection first.</span>`;
    return;
  }
  el.innerHTML = `<span class="small">Loading custom field definitions…</span>`;
  try {
    const data = await apiGetV4(`/custom-fields?pageSize=1000`);
    const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
    const fields = arrayKey ? data[arrayKey] : [];
    if (fields.length === 0) {
      el.innerHTML = `<span class="small">No custom fields returned — check the console for the raw response shape.</span>`;
      console.log("[ORESTAR] /api4/custom-fields raw response:", data);
      return;
    }
    const rows = fields.map(f => {
      const name = f.Name || f.name || f.Label || f.label || "(unnamed)";
      const type = f.Type || f.type || "?";
      const placement = f.Placement || f.placement || (Array.isArray(f.Placements) ? f.Placements.join(", ") : "") || "?";
      const guid = f.key || f.Key || f.id || f.Id || "?";
      return `<tr><td>${escapeXml(name)}</td><td>${escapeXml(type)}</td><td>${escapeXml(placement)}</td><td style="font-family:ui-monospace,monospace;">${escapeXml(guid)}</td></tr>`;
    }).join("");
    el.innerHTML = `<table><thead><tr><th>Name</th><th>Type</th><th>Placement</th><th>GUID</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="small" style="margin-top:4px;">Copy the GUID for your Filer ID / Type-Subtype / Downloaded fields into the boxes below.</div>`;
  } catch (e) {
    el.innerHTML = `<span class="small">Failed: ${escapeXml(e.message)}</span>`;
  }
});

document.getElementById("discoverBtn").addEventListener("click", async () => {
  if (!hasConnection()) {
    showStatus("err", "Fill in the Base URL and Access Token above, and Test Connection first.");
    return;
  }
  showStatus("pending", "Testing candidate endpoint names…");

  const candidates = [
    "/bank-or-cash-accounts", "/bank-or-cash-account",
    "/bank-and-cash-accounts", "/bank-and-cash-account",
    "/bankOrCashAccounts", "/bankOrCashAccount",
    "/accounts", "/bank-accounts", "/cash-accounts",
    "/bank-or-cash-account-list", "/chart-of-accounts",
    "/balance-sheet-accounts"
  ];

  const results = [];
  for (const path of candidates) {
    try {
      const data = await apiGet(`${path}?pageSize=1`);
      const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
      const count = arrayKey ? data[arrayKey].length : "?";
      results.push(`✓ ${path} — SUCCESS (found array "${arrayKey}", ${count} item(s) in this page)`);
    } catch (e) {
      results.push(`✗ ${path} — ${e.message}`);
    }
  }

  showStatus(results.some(r => r.startsWith("✓")) ? "ok" : "err", results.join("\n"));
});

document.getElementById("loadAccountsBtn").addEventListener("click", async () => {
  if (!hasConnection()) {
    showStatus("err", "Fill in the Base URL and Access Token above, and click \"Test Connection\" first.");
    return;
  }
  const cfFiler = document.getElementById("cfFiler").value.trim();
  showStatus("pending", "Loading accounts and Filer ID…");
  try {
    availableAccounts = await fetchAccounts();
    const listEl = document.getElementById("accountList");
    if (availableAccounts.length === 0) {
      listEl.innerHTML = `<span class="small">No accounts found — either this business has none, or the account list endpoint names don't match your Manager version (check the browser console for the exact error).</span>`;
    } else {
      listEl.innerHTML = availableAccounts.map((a, i) =>
        `<label><input type="checkbox" data-acct-idx="${i}" checked> ${escapeXml(a.name)} <span class="small">(${a.kind})</span></label>`
      ).join("");
    }

    if (cfFiler) {
      try {
        const filerId = await fetchFilerId(cfFiler);
        document.getElementById("resolvedFilerId").value = filerId;
      } catch (e) {
        document.getElementById("resolvedFilerId").value = "";
        showStatus("err", `Accounts loaded, but Filer ID lookup failed: ${e.message}`);
        return;
      }
    }
    showStatus("ok", `Loaded ${availableAccounts.length} account(s). Uncheck any you want to exclude, then load transactions.`);
  } catch (err) {
    showStatus("err", `Failed to load accounts: ${err.message}`);
  }
});

function selectedAccountKeys() {
  return availableAccounts
    .filter((_, i) => {
      const cb = document.querySelector(`input[data-acct-idx="${i}"]`);
      return cb ? cb.checked : true;
    })
    .map(a => a.key);
}

// Manager's list/detail responses don't document a single confirmed field
// name for "which bank/cash account this transaction belongs to" — trying
// the candidates that match the UI language ("Received in" / "Paid from")
// plus generic fallbacks. Displayed in the review table so you can verify.
function extractAccountRef(item, detail) {
  const candidates = [
    detail?.ReceivedIn, detail?.PaidFrom, detail?.BankAccount, detail?.CashAccount, detail?.Account,
    item?.ReceivedIn, item?.PaidFrom, item?.BankAccount, item?.CashAccount, item?.Account
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") return { key: c, name: null };
    if (typeof c === "object" && (c.key || c.Key)) return { key: c.key || c.Key, name: c.name || c.Name || null };
  }
  return { key: null, name: null };
}

const FETCH_PAGE_SIZE = 5000; // see note in loadCollection about pagination limits

async function loadCollection(listPath, formPath, sourceLabel, typeSubtypeFieldId, downloadedFieldId, selectedKeys) {
  const results = [];
  const listData = await apiGet(`${listPath}?pageSize=${FETCH_PAGE_SIZE}`);
  const arrayKey = Object.keys(listData).find(k => Array.isArray(listData[k]));
  const items = arrayKey ? listData[arrayKey] : [];
  const possiblyTruncated = items.length >= FETCH_PAGE_SIZE;

  for (const item of items) {
    const key = item.key || item.Key;
    let detail;
    try {
      detail = await apiGet(`${formPath}/${key}`);
    } catch (e) {
      continue;
    }

    // Skip anything already marked Downloaded.
    const alreadyDownloaded = getCustomFieldValue(detail, downloadedFieldId, "checkbox") === true;
    if (alreadyDownloaded) continue;

    // Skip anything not in the selected account set (if any accounts are known).
    const acctRef = extractAccountRef(item, detail);
    if (selectedKeys.length > 0 && acctRef.key && !selectedKeys.includes(acctRef.key)) continue;

    const tranDate = dateOnly(detail.Date || item.Date || item.date);
    const enteredDate = localDateFromTimestamp(item.Timestamp || item.timestamp || detail.Timestamp);
    const amount = getAmountValue(detail.Amount ?? item.Amount);
    const contactName = detail.Payee || detail.Payer || detail.Name || item.Payee || item.Payer || item.Name || "(unnamed)";
    const description = detail.Description || item.Description || "";

    let typeText = "", subtypeText = "";
    const cfValue = getCustomFieldValue(detail, typeSubtypeFieldId, "text");
    if (cfValue) {
      const parts = String(cfValue).split(" - ");
      typeText = parts[0].trim();
      subtypeText = parts.length > 1 ? parts.slice(1).join(" - ").trim() : "";
    }

    const typeCode = TYPE_CODE[typeText] || "";
    let subCode = subtypeText ? (SUBTYPE_TEXT_TO_CODE[subtypeText] || "") : "";
    if (!subCode && typeCode) subCode = DEFAULT_SUBTYPE[typeCode] || "";

    results.push({
      source: sourceLabel,
      key,
      formPath,
      date: tranDate,
      enteredDate,
      accountName: acctRef.name || acctRef.key || "(unknown)",
      amount,
      contactName,
      typeCode,
      subCode,
      description,
      paymentMethod: "",
      checkNo: ""
    });
  }
  return { results, possiblyTruncated, totalFetched: items.length };
}

document.getElementById("loadBtn").addEventListener("click", async () => {
  if (!hasConnection()) {
    showStatus("err", "Fill in the Base URL and Access Token above, and click \"Test Connection\" first.");
    return;
  }
  const cfTypeSubtype = document.getElementById("cfTypeSubtype").value.trim();
  const cfDownloaded = document.getElementById("cfDownloaded").value.trim();
  if (!cfTypeSubtype || !cfDownloaded) {
    showStatus("err", "Fill in the Type-Subtype and Downloaded field GUIDs first."); return;
  }

  showStatus("pending", "Loading not-yet-downloaded receipts and payments…");
  try {
    const selectedKeys = selectedAccountKeys();

    const receiptResult = await loadCollection("/receipts", "/receipt-form", "Receipt", cfTypeSubtype, cfDownloaded, selectedKeys);
    const paymentResult = await loadCollection("/payments", "/payment-form", "Payment", cfTypeSubtype, cfDownloaded, selectedKeys);
    loadedTransactions = [...receiptResult.results, ...paymentResult.results];

    if (loadedTransactions.length === 0) {
      showStatus("err", `No not-yet-downloaded transactions found for the selected account(s). If you expect some, check: the Downloaded field GUID is right, the account picker matches what you expect, and (see console) whether account-matching found a field name it recognizes.`);
      document.getElementById("reviewSection").style.display = "none";
      return;
    }

    renderReview();

    if (receiptResult.possiblyTruncated || paymentResult.possiblyTruncated) {
      showStatus("err",
        `Loaded ${loadedTransactions.length} transaction(s), but this business has ${receiptResult.totalFetched} receipt(s) and/or ${paymentResult.totalFetched} payment(s) total — right at the fetch limit (${FETCH_PAGE_SIZE}). ` +
        `Some not-yet-downloaded transactions may exist beyond what was fetched. Do not rely on this export as complete — increase FETCH_PAGE_SIZE, or cross-check manually, before filing.`);
    } else {
      showStatus("ok", `Loaded ${loadedTransactions.length} not-yet-downloaded transaction(s) out of ${receiptResult.totalFetched} receipt(s) and ${paymentResult.totalFetched} payment(s) checked in total. Review below before generating XML.`);
    }
  } catch (err) {
    showStatus("err", `Failed to load: ${err.message}`);
  }
});

function renderReview() {
  document.getElementById("reviewSection").style.display = "block";
  document.getElementById("markDownloadedBtn").disabled = true;
  const tbody = document.getElementById("tranBody");
  tbody.innerHTML = "";

  loadedTransactions.forEach((t, idx) => {
    if (!contactsByName[t.contactName]) {
      contactsByName[t.contactName] = guessContact(t.contactName);
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeXml(t.date)}</td>
      <td class="small">${escapeXml(t.enteredDate || "—")}</td>
      <td class="small">${escapeXml(t.accountName)}</td>
      <td>${escapeXml(t.amount)}</td>
      <td><input data-idx="${idx}" data-field="contactName" value="${escapeXml(t.contactName)}"></td>
      <td>
        <select data-idx="${idx}" data-field="typeCode">
          ${Object.entries(TYPE_CODE).map(([label, code]) =>
            `<option value="${code}" ${code === t.typeCode ? "selected" : ""}>${label} (${code})</option>`).join("")}
        </select>
      </td>
      <td>
        <select data-idx="${idx}" data-field="subCode"></select>
      </td>
      <td><input data-idx="${idx}" data-field="description" value="${escapeXml(t.description)}"></td>
      <td>
        <select data-idx="${idx}" data-field="paymentMethod">
          ${PAYMENT_METHODS.map(([code,label]) =>
            `<option value="${code}" ${code === t.paymentMethod ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </td>
      <td><input data-idx="${idx}" data-field="checkNo" value="${escapeXml(t.checkNo)}"></td>
      <td class="small">${t.source}</td>
    `;
    tbody.appendChild(tr);
    populateSubtypeSelect(idx);
  });

  tbody.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
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
  const select = document.querySelector(`select[data-idx="${idx}"][data-field="subCode"]`);
  const options = SUBTYPE_OPTIONS[t.typeCode] || [];
  select.innerHTML = options.map(([code, label]) =>
    `<option value="${code}" ${code === t.subCode ? "selected" : ""}>${label} (${code})</option>`).join("");
  if (!options.some(([code]) => code === t.subCode)) {
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
    occupation: "", employerName: "", employerCity: "", employerState: ""
  };
}

function renderContacts() {
  const container = document.getElementById("contactsList");
  container.innerHTML = "";
  Object.keys(contactsByName).forEach(name => {
    const c = contactsByName[name];
    const card = document.createElement("div");
    card.className = "contact-card";
    card.innerHTML = `
      <h4>${escapeXml(name)}</h4>
      <div class="row">
        <div>
          <label>Contact Type</label>
          <select data-name="${escapeXml(name)}" data-field="type">
            ${CONTACT_TYPES.map(([code,label]) => `<option value="${code}" ${code===c.type?"selected":""}>${label} (${code})</option>`).join("")}
          </select>
        </div>
        <div class="cn-individual" style="display:${c.type==='I'||c.type==='F' ? 'flex':'none'}; gap:10px; flex:2;">
          <div><label>First</label><input data-name="${escapeXml(name)}" data-field="first" value="${escapeXml(c.first)}"></div>
          <div><label>Last</label><input data-name="${escapeXml(name)}" data-field="last" value="${escapeXml(c.last)}"></div>
        </div>
        <div class="cn-business" style="display:${c.type==='B'||c.type==='L'||c.type==='O' ? 'block':'none'}; flex:2;">
          <label>Business / Org Name</label><input data-name="${escapeXml(name)}" data-field="business" value="${escapeXml(c.business)}">
        </div>
        <div class="cn-committee" style="display:${c.type==='C'||c.type==='P' ? 'block':'none'}; flex:2;">
          <label>Committee Name</label><input data-name="${escapeXml(name)}" data-field="committeeName" value="${escapeXml(c.committeeName)}">
        </div>
      </div>
      <div class="small" style="margin:6px 0 4px;">Optional — fill in if this contact's yearly total exceeds $100:</div>
      <div class="row">
        <div><label>Street</label><input data-name="${escapeXml(name)}" data-field="street1" value="${escapeXml(c.street1)}"></div>
        <div><label>City</label><input data-name="${escapeXml(name)}" data-field="city" value="${escapeXml(c.city)}"></div>
        <div><label>State</label><input data-name="${escapeXml(name)}" data-field="state" maxlength="2" value="${escapeXml(c.state)}"></div>
        <div><label>Zip</label><input data-name="${escapeXml(name)}" data-field="zip" value="${escapeXml(c.zip)}"></div>
      </div>
      <div class="row" style="display:${c.type==='I'||c.type==='F' ? 'flex':'none'}">
        <div><label>Occupation</label><input data-name="${escapeXml(name)}" data-field="occupation" value="${escapeXml(c.occupation)}"></div>
        <div><label>Employer</label><input data-name="${escapeXml(name)}" data-field="employerName" value="${escapeXml(c.employerName)}"></div>
        <div><label>Employer City</label><input data-name="${escapeXml(name)}" data-field="employerCity" value="${escapeXml(c.employerCity)}"></div>
        <div><label>Employer State</label><input data-name="${escapeXml(name)}" data-field="employerState" maxlength="2" value="${escapeXml(c.employerState)}"></div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("change", (e) => {
      const name = e.target.dataset.name;
      const field = e.target.dataset.field;
      contactsByName[name][field] = e.target.value;
      if (field === "type") renderContacts();
    });
  });
}

function buildContactXml(id, c) {
  let nameXml;
  if (c.type === "I" || c.type === "F") {
    nameXml = `<individual-name><first>${escapeXml(c.first)}</first><last>${escapeXml(c.last)}</last></individual-name>`;
  } else if (c.type === "C" || c.type === "P") {
    nameXml = `<committee><name>${escapeXml(c.committeeName)}</name></committee>`;
  } else {
    nameXml = `<business-name>${escapeXml(c.business)}</business-name>`;
  }

  let addressXml = "";
  if (c.street1 || c.city || c.state || c.zip) {
    addressXml = `<address>` +
      (c.street1 ? `<street1>${escapeXml(c.street1)}</street1>` : "") +
      (c.city ? `<city>${escapeXml(c.city)}</city>` : "") +
      (c.state ? `<state>${escapeXml(c.state)}</state>` : "") +
      (c.zip ? `<zip>${escapeXml(c.zip)}</zip>` : "") +
      (c.county ? `<county>${escapeXml(c.county)}</county>` : "") +
      `</address>`;
  }

  let employmentXml = "";
  if (c.employerName) {
    employmentXml = `<employment><employer-name>${escapeXml(c.employerName)}</employer-name>` +
      (c.employerCity ? `<city>${escapeXml(c.employerCity)}</city>` : "") +
      (c.employerState ? `<state>${escapeXml(c.employerState)}</state>` : "") +
      `</employment>`;
  }

  return `<contact id="${escapeXml(id)}">` +
    `<type>${c.type}</type>` +
    `<contact-name>${nameXml}</contact-name>` +
    addressXml +
    (c.occupation ? `<occupation>${escapeXml(c.occupation)}</occupation>` : "") +
    employmentXml +
    `</contact>`;
}

function buildTransactionXml(id, contactId, t) {
  return `<transaction id="${escapeXml(id)}">` +
    `<operation><add>true</add></operation>` +
    `<contact-id>${escapeXml(contactId)}</contact-id>` +
    `<type>${t.typeCode}</type>` +
    `<sub-type>${t.subCode}</sub-type>` +
    (t.description ? `<description>${escapeXml(t.description.slice(0,200))}</description>` : "") +
    `<amount>${t.amount}</amount>` +
    (t.paymentMethod ? `<payment-method>${t.paymentMethod}</payment-method>` : "") +
    `<date>${t.date}</date>` +
    (t.checkNo ? `<check-no>${escapeXml(t.checkNo)}</check-no>` : "") +
    `</transaction>`;
}

let lastGeneratedFilerId = "";

document.getElementById("generateBtn").addEventListener("click", () => {
  const filerId = document.getElementById("resolvedFilerId").value.trim();
  if (!filerId) { showStatus("err", "Filer ID hasn't resolved yet — click \"Load Accounts & Filer ID\" above and check for errors."); return; }
  if (loadedTransactions.some(t => !t.typeCode || !t.subCode)) {
    showStatus("err", "Every transaction needs a Type and Sub-type — check the table above."); return;
  }
  lastGeneratedFilerId = filerId;

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const contactIdByName = {};
  let contactCounter = 1;
  const contactXmlParts = [];
  Object.entries(contactsByName).forEach(([name, c]) => {
    const isUsed = loadedTransactions.some(t => t.contactName === name);
    if (!isUsed) return;
    const id = `C${stamp}-${contactCounter++}`;
    contactIdByName[name] = id;
    contactXmlParts.push(buildContactXml(id, c));
  });

  const tranXmlParts = loadedTransactions.map((t, i) =>
    buildTransactionXml(`T${stamp}-${i+1}`, contactIdByName[t.contactName], t));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<campaign-finance-transactions xmlns="http://www.state.or.us/sos/ebs2/ce/dataobject" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.state.or.us/sos/ebs2/ce/dataobject" ` +
    `filer-id="${escapeXml(filerId)}">\n` +
    contactXmlParts.join("\n") + "\n" +
    tranXmlParts.join("\n") + "\n" +
    `</campaign-finance-transactions>`;

  const output = document.getElementById("xmlOutput");
  output.style.display = "block";
  output.value = xml;
  document.getElementById("downloadBtn").disabled = false;
  document.getElementById("downloadBtn").onclick = () => {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orestar-export-${new Date().toISOString().slice(0,10)}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };
  document.getElementById("markDownloadedBtn").disabled = false;
  showMarkStatus("", "");
  showStatus("ok", "XML generated. Review it below, download it, and upload it through ORESTAR's Upload File page. Once you've confirmed the upload, click \"Mark These as Downloaded\" so they're excluded from your next export.");
});

document.getElementById("markDownloadedBtn").addEventListener("click", async () => {
  const cfDownloaded = document.getElementById("cfDownloaded").value.trim();
  if (!cfDownloaded) { showMarkStatus("err", "Downloaded field GUID is missing."); return; }

  document.getElementById("markDownloadedBtn").disabled = true;
  showMarkStatus("pending", `Marking ${loadedTransactions.length} transaction(s) as downloaded…`);

  let succeeded = 0;
  const failures = [];
  for (const t of loadedTransactions) {
    try {
      await apiUpdate(`${t.formPath}/${t.key}`, {
        CustomFields2: { Checkboxes: { [cfDownloaded]: true } }
      });
      succeeded++;
    } catch (e) {
      failures.push(`${t.source} ${t.key}: ${e.message}`);
    }
  }

  if (failures.length === 0) {
    showMarkStatus("ok", `Marked all ${succeeded} transaction(s) as downloaded. They won't appear in your next export.`);
  } else {
    showMarkStatus("err",
      `Marked ${succeeded} of ${loadedTransactions.length}. ${failures.length} failed — these will show up again next time and need to be marked manually or retried:\n` +
      failures.slice(0, 10).join("\n") + (failures.length > 10 ? `\n…and ${failures.length - 10} more` : ""));
    document.getElementById("markDownloadedBtn").disabled = false;
  }
});
