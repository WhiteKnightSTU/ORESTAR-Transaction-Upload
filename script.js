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

const PAYMENT_METHODS = [["","(none)"],["CHK","Check"],["ACH","Electronic Check"],["EFT","Electronic Funds Transfer"],
                          ["DC","Debit Card"],["CC","Credit Card"]];

const CONTACT_TYPES = [
  ["I","Individual"], ["F","Candidate's Immediate Family"], ["B","Business Entity"],
  ["L","Labor Organization"], ["O","Other"], ["C","Political Committee"], ["P","Political Party Committee"]
];

let loadedTransactions = [];
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
        if (d.error) reject(new Error(d.error));
        else if (d.status && d.status >= 400) reject(new Error("HTTP " + d.status + ": " + JSON.stringify(d.body)));
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
  typeSubtypeReceipt: null,
  typeSubtypePayment: null,
  transactionId: null
};

async function resolveFieldGuids() {
  const cfg = (typeof ORESTAR_CONFIG !== "undefined") ? ORESTAR_CONFIG : {};
  const data = await managerApi("GET", "/api4/custom-fields?pageSize=1000");
  const arrayKey = Object.keys(data).find(function(k) { return Array.isArray(data[k]); });
  const fields = arrayKey ? data[arrayKey] : [];

  function placementText(f) {
    const p = f.Placement || f.placement || f.Placements || f.placements || "";
    return Array.isArray(p) ? p.join(",").toLowerCase() : String(p).toLowerCase();
  }
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

  const typeSubtypeReceipt = typeSubtypeMatches.find(function(f) { return placementText(f).indexOf("eceipt") !== -1; });
  const typeSubtypePayment = typeSubtypeMatches.find(function(f) { return placementText(f).indexOf("ayment") !== -1; });

  resolvedGuids = {
    filer: guidOf(filerMatches[0]),
    typeSubtypeReceipt: guidOf(typeSubtypeReceipt),
    typeSubtypePayment: guidOf(typeSubtypePayment),
    transactionId: guidOf(transactionIdMatches[0])
  };

  console.log("[ORESTAR] All custom field definitions:", fields);
  console.log("[ORESTAR] Resolved GUIDs:", resolvedGuids);

  const statusEl = document.getElementById("resolvedFieldsStatus");
  const lines = [
    (resolvedGuids.filer ? "✓" : "✗") + " Filer ID (\"" + (cfg.FILER_ID_FIELD_NAME || "") + "\")" + (resolvedGuids.filer ? "" : " — not found"),
    (resolvedGuids.typeSubtypeReceipt ? "✓" : "✗") + " Type-Subtype / Receipts (\"" + (cfg.TYPE_SUBTYPE_FIELD_NAME || "") + "\")" + (resolvedGuids.typeSubtypeReceipt ? "" : " — not found on a field placed on Receipts"),
    (resolvedGuids.typeSubtypePayment ? "✓" : "✗") + " Type-Subtype / Payments (\"" + (cfg.TYPE_SUBTYPE_FIELD_NAME || "") + "\")" + (resolvedGuids.typeSubtypePayment ? "" : " — not found on a field placed on Payments"),
    (resolvedGuids.transactionId ? "✓" : "✗") + " Transaction ID (\"" + (cfg.TRANSACTION_ID_FIELD_NAME || "") + "\")" + (resolvedGuids.transactionId ? "" : " — not found")
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
    const data = await managerApi("GET", "/api4/custom-fields?pageSize=1000");
    const arrayKey = Object.keys(data).find(function(k) { return Array.isArray(data[k]); });
    const fields = arrayKey ? data[arrayKey] : [];
    if (fields.length === 0) {
      el.innerHTML = '<span class="small">No custom fields returned — check the console for the raw response shape.</span>';
      console.log("[ORESTAR] /api4/custom-fields raw response:", data);
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
      '<div class="small" style="margin-top:4px;">Copy the GUID for your Filer ID / Type-Subtype / Downloaded fields into the boxes below.</div>';
  } catch (e) {
    el.innerHTML = '<span class="small">Failed: ' + escapeXml(e.message) + '</span>';
  }
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

async function loadCollection(listPath, formPath, sourceLabel, typeSubtypeFieldId, downloadedFieldId, selectedKeys) {
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

    const tranDate = dateOnly(detail.Date || item.Date || item.date);
    const enteredDate = localDateFromTimestamp(item.Timestamp || item.timestamp || detail.Timestamp);
    const amount = getAmountValue(detail.Amount != null ? detail.Amount : item.Amount);
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
      key: key,
      formPath: formPath,
      date: tranDate,
      enteredDate: enteredDate,
      accountName: acctRef.name || acctRef.key || "(unknown)",
      amount: amount,
      contactName: contactName,
      typeCode: typeCode,
      subCode: subCode,
      description: description,
      paymentMethod: "",
      checkNo: ""
    });
  }
  return { results: results, possiblyTruncated: possiblyTruncated, totalFetched: items.length };
}

document.getElementById("loadBtn").addEventListener("click", async function() {
  if (!resolvedGuids.typeSubtypeReceipt || !resolvedGuids.typeSubtypePayment || !resolvedGuids.transactionId) {
    showStatus("err", "Fields aren't fully resolved yet — click \"Load Accounts & Resolve Fields\" above first, and check the resolved-fields status for anything missing.");
    return;
  }

  showStatus("pending", "Loading not-yet-exported receipts and payments…");
  try {
    const selectedKeys = selectedAccountKeys();

    const receiptResult = await loadCollection("/receipts", "/receipt-form", "Receipt", resolvedGuids.typeSubtypeReceipt, resolvedGuids.transactionId, selectedKeys);
    const paymentResult = await loadCollection("/payments", "/payment-form", "Payment", resolvedGuids.typeSubtypePayment, resolvedGuids.transactionId, selectedKeys);
    loadedTransactions = receiptResult.results.concat(paymentResult.results);

    if (loadedTransactions.length === 0) {
      showStatus("err", "No not-yet-exported transactions found for the selected account(s). If you expect some, check the resolved-fields status above, and that the account picker matches what you expect.");
      document.getElementById("reviewSection").style.display = "none";
      return;
    }

    renderReview();

    if (receiptResult.possiblyTruncated || paymentResult.possiblyTruncated) {
      showStatus("err",
        "Loaded " + loadedTransactions.length + " transaction(s), but this business has " + receiptResult.totalFetched + " receipt(s) and/or " + paymentResult.totalFetched + " payment(s) total — right at the fetch limit (" + FETCH_PAGE_SIZE + "). " +
        "Some not-yet-downloaded transactions may exist beyond what was fetched. Do not rely on this export as complete — increase FETCH_PAGE_SIZE, or cross-check manually, before filing.");
    } else {
      showStatus("ok", "Loaded " + loadedTransactions.length + " not-yet-downloaded transaction(s) out of " + receiptResult.totalFetched + " receipt(s) and " + paymentResult.totalFetched + " payment(s) checked in total. Review below before generating XML.");
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
      contactsByName[t.contactName] = guessContact(t.contactName);
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
    occupation: "", employerName: "", employerCity: "", employerState: ""
  };
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
        '<div><label>Employer</label><input data-name="' + escapeXml(name) + '" data-field="employerName" value="' + escapeXml(c.employerName) + '"></div>' +
        '<div><label>Employer City</label><input data-name="' + escapeXml(name) + '" data-field="employerCity" value="' + escapeXml(c.employerCity) + '"></div>' +
        '<div><label>Employer State</label><input data-name="' + escapeXml(name) + '" data-field="employerState" maxlength="2" value="' + escapeXml(c.employerState) + '"></div>' +
      "</div>";
    container.appendChild(card);
  });

  container.querySelectorAll("input, select").forEach(function(el) {
    el.addEventListener("change", function(e) {
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
  if (c.employerName) {
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

function buildTransactionXml(id, contactId, t) {
  return "<transaction id=\"" + escapeXml(id) + "\">" +
    "<operation><add>true</add></operation>" +
    "<contact-id>" + escapeXml(contactId) + "</contact-id>" +
    "<type>" + t.typeCode + "</type>" +
    "<sub-type>" + t.subCode + "</sub-type>" +
    (t.description ? "<description>" + escapeXml(t.description.slice(0,200)) + "</description>" : "") +
    "<amount>" + t.amount + "</amount>" +
    (t.paymentMethod ? "<payment-method>" + t.paymentMethod + "</payment-method>" : "") +
    "<date>" + t.date + "</date>" +
    (t.checkNo ? "<check-no>" + escapeXml(t.checkNo) + "</check-no>" : "") +
    "</transaction>";
}

let lastGeneratedFilerId = "";

document.getElementById("generateBtn").addEventListener("click", function() {
  const filerId = document.getElementById("resolvedFilerId").value.trim();
  if (!filerId) { showStatus("err", "Filer ID hasn't resolved yet — click \"Load Accounts & Filer ID\" above and check for errors."); return; }
  if (loadedTransactions.some(function(t) { return !t.typeCode || !t.subCode; })) {
    showStatus("err", "Every transaction needs a Type and Sub-type — check the table above.");
    return;
  }
  lastGeneratedFilerId = filerId;

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const contactIdByName = {};
  let contactCounter = 1;
  const contactXmlParts = [];
  Object.entries(contactsByName).forEach(function(entry) {
    const name = entry[0], c = entry[1];
    const isUsed = loadedTransactions.some(function(t) { return t.contactName === name; });
    if (!isUsed) return;
    const id = "C" + stamp + "-" + (contactCounter++);
    contactIdByName[name] = id;
    contactXmlParts.push(buildContactXml(id, c));
  });

  const tranXmlParts = loadedTransactions.map(function(t, i) {
    return buildTransactionXml("T" + stamp + "-" + (i + 1), contactIdByName[t.contactName], t);
  });

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
  showStatus("ok", "XML generated. Review it below, download it, and upload it through ORESTAR's Upload File page. Once ORESTAR gives you back Transaction IDs, enter them in the table below and save.");
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
      const body = { CustomFields2: { Decimals: {} } };
      body.CustomFields2.Decimals[cfTransactionId] = Number(entry.value);
      await managerApi("PUT", "/api2" + t.formPath + "/" + t.key, body);
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
