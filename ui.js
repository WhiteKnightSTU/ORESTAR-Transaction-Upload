/* ORESTAR export tool — view layer.
 *
 * Takes plain state (the same `loadedTransactions` / `contactsByName` objects
 * script.js already owns) and writes the DOM. Makes no network calls and knows
 * no filing rules beyond what ORESTAR's schema requires for a row to be
 * generatable. script.js owns state, Manager, and the XML.
 *
 * Public surface:
 *   UI.renderTransactions(transactions, contactsByName)  stage 01 table + drawers
 *   UI.renderTxnIds(transactions)                        stage 03 ID table
 *   UI.setStats(transactions, contactsByName)            stage 02 counts
 *   UI.unlock('transactions' | 'generate' | 'ids')       open a stage forward
 *   UI.goTo(0..3)                                        open a stage
 *   UI.setFilerId(id)                                    header + stage 00 echo
 *   UI.gate()                                            { blocking, unopened, ok }
 */
window.UI = (function () {
  var UI = {};
  var el = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[<>&'"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" }[c];
    });
  };

  var view = { stage: 0, openRow: null, opened: {}, pending: {}, txns: null, contacts: null };

  /* ---------- code tables (script.js globals, read lazily) ---------- */
  function typeCodes() { return typeof TYPE_CODE !== "undefined" ? TYPE_CODE : {}; }
  function subtypes(code) { return (typeof SUBTYPE_OPTIONS !== "undefined" && SUBTYPE_OPTIONS[code]) || []; }
  function methods() { return typeof PAYMENT_METHODS !== "undefined" ? PAYMENT_METHODS : [["", "(none)"]]; }
  function contactTypes() { return typeof CONTACT_TYPES !== "undefined" ? CONTACT_TYPES : []; }
  function purposes() { return typeof TRAN_PURPOSE_CODES !== "undefined" ? TRAN_PURPOSE_CODES : {}; }
  var PERSONAL = { I: 1, F: 1 };

  function money(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return String(v == null ? "" : v);
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* ---------- validation: only what ORESTAR's schema requires ---------- */
  function flagsFor(t, contacts) {
    var c = contacts[t.contactName] || {};
    var out = [];
    var req = function (m) { out.push({ level: "Required", msg: m }); };
    var note = function (m) { out.push({ level: "Note", msg: m }); };

    if (!t.typeCode || !t.subCode) req("Transaction Type is not set on this record in Manager. Pick a type and sub-type here, or set the field and reload.");
    (t.tranPurposeCodes || []).forEach(function (code) {
      var p = purposes()[code];
      if (!p) req('"' + code + '" is not a purpose code in ORESTAR\u2019s schema.');
      else if (p.requiresDescription && !String(t.description || "").trim()) req("Purpose " + code + " (" + p.label.toLowerCase() + ") requires a description.");
    });
    if (!c.type) req("Entity type unresolved — the contact\u2019s Type field is blank, so ORESTAR has nothing to classify this name as.");
    if (!String(c.street1 || "").trim()) req("Street address missing from the contact record.");

    if (PERSONAL[c.type]) {
      if (!String(c.occupation || "").trim()) note("Occupation blank.");
      if (!c.employmentStatus && !String(c.employerName || "").trim()) note("Employer blank for an individual filed as employed.");
    }
    if (t.typeCode === "OR" && t.subCode === "FM") note("Fair-market half of a split record — the contribution half carries the ORESTAR ID.");
    if (t.source === "Payslip (Forgiven Expense Claim)" || t.source === "Payslip") note("Payroll-forgiven expense claim — files as an in-kind contribution, not a deduction.");
    if (!String(c.contactId || "").trim() && c.recordKey) note("No Contact ID on file — one is derived from the Manager record and written back at generation.");
    return out;
  }

  UI.gate = function () {
    var txns = view.txns || [], contacts = view.contacts || {};
    var blocking = 0, unopened = 0;
    txns.forEach(function (t, i) {
      var f = flagsFor(t, contacts);
      if (f.some(function (x) { return x.level === "Required"; })) blocking++;
      if (f.length && !view.opened[i]) unopened++;
    });
    return { blocking: blocking, unopened: unopened, ok: blocking === 0 && unopened === 0 };
  };

  /* ---------- stages ---------- */
  var STAGE_OF = { transactions: 1, generate: 2, ids: 3 };

  UI.unlock = function (name) {
    var i = STAGE_OF[name];
    if (!i) return;
    var s = el("stage" + i);
    s.setAttribute("data-locked", "false");
    s.querySelector(".stage-head").disabled = false;
    UI.goTo(i);
  };

  UI.goTo = function (i) {
    view.stage = i;
    [0, 1, 2, 3].forEach(function (n) {
      var s = el("stage" + n);
      if (!s) return;
      s.setAttribute("data-open", String(n === i));
    });
    syncMeta();
  };

  function syncMeta() {
    var filer = el("resolvedFilerId") ? el("resolvedFilerId").value : "";
    el("hdrMeta").textContent = "Filer " + (filer || "—") + " · Stage " + String(view.stage).padStart(2, "0") + " of 03";
  }

  UI.setFilerId = function (id) {
    if (el("resolvedFilerId")) el("resolvedFilerId").value = id || "";
    syncMeta();
  };

  function setSummary(i, text) { if (el("sum" + i)) el("sum" + i).textContent = text; }

  /* ---------- stage 01: table + row drawers ---------- */
  function optionList(pairs, selected, labelFirst) {
    return pairs.map(function (p) {
      var code = p[0], label = p[1];
      var text = labelFirst ? label + " (" + code + ")" : (code ? code + " — " + label : label);
      return '<option value="' + esc(code) + '"' + (code === (selected || "") ? " selected" : "") + ">" + esc(text) + "</option>";
    }).join("");
  }

  function field(labelText, inner) {
    return "<div><label>" + esc(labelText) + "</label>" + inner + "</div>";
  }

  function txInput(i, name, value, extra) {
    return '<input type="text" class="mono" data-idx="' + i + '" data-field="' + name + '" value="' + esc(value == null ? "" : value) + '"' + (extra || "") + ">";
  }

  function cInput(i, nameKey, fieldName, value, extra) {
    return '<input type="text" data-cname="' + esc(nameKey) + '" data-cfield="' + fieldName + '" data-idx="' + i + '" value="' + esc(value == null ? "" : value) + '"' + (extra || "") + ">";
  }

  function nameFields(i, nameKey, c) {
    if (PERSONAL[c.type]) {
      return field("First", cInput(i, nameKey, "first", c.first)) + field("Last", cInput(i, nameKey, "last", c.last));
    }
    if (c.type === "C" || c.type === "P") return field("Committee name", cInput(i, nameKey, "committeeName", c.committeeName));
    return field("Business / organization name", cInput(i, nameKey, "business", c.business));
  }

  function drawerHtml(i, t, contacts) {
    var nameKey = t.contactName;
    var c = contacts[nameKey] || {};
    var flags = flagsFor(t, contacts);
    var shared = (view.txns || []).filter(function (x) { return x.contactName === nameKey; }).length;
    var typePairs = Object.keys(typeCodes()).map(function (label) { return [typeCodes()[label], label]; });
    var purposeText = (t.tranPurposeCodes || []).join(", ");
    var purposeLabels = (t.tranPurposeCodes || []).map(function (code) {
      return (purposes()[code] || { label: "unrecognized code" }).label;
    }).join(" · ");
    var pendingKey = nameKey + "\u0000";
    var pend = Object.keys(view.pending).filter(function (k) { return k.indexOf(pendingKey) === 0; }).map(function (k) { return view.pending[k]; });

    var html = "";
    flags.forEach(function (f) {
      html += '<div class="flag"><span class="lvl' + (f.level === "Required" ? " req" : "") + '">' + f.level + '</span><span class="msg">' + esc(f.msg) + "</span></div>";
    });

    html += "<h4>Transaction · " + esc(t.source) + " · " + esc(t.accountName) + " · entered " + esc(t.enteredDate || "—") + "</h4>";
    html += '<div class="grid">' +
      field("Type", '<select data-idx="' + i + '" data-field="typeCode"><option value="">— not set —</option>' + optionList(typePairs, t.typeCode, true) + "</select>") +
      field("Sub-type", '<select data-idx="' + i + '" data-field="subCode"><option value="">— not set —</option>' + optionList(subtypes(t.typeCode), t.subCode, true) + "</select>") +
      field("Purpose code(s)", txInput(i, "tranPurpose", purposeText, ' placeholder="G, T"') + '<p class="hint">' + esc(purposeLabels || "No purpose code set.") + "</p>") +
      field("Payment method", '<select data-idx="' + i + '" data-field="paymentMethod">' + optionList(methods(), t.paymentMethod, false) + "</select>") +
      field("Check #", txInput(i, "checkNo", t.checkNo)) +
      "</div>";
    html += '<div style="margin-top:14px"><label>Description</label><textarea rows="2" data-idx="' + i + '" data-field="description">' + esc(t.description || "") + "</textarea></div>";

    html += '<div class="split"><h4 style="margin:0">Contact · ' + esc(nameKey) + '</h4><p class="scope">' +
      (shared > 1 ? "On " + shared + " transactions" : "On this transaction only") + "</p></div>";

    pend.forEach(function (p) {
      html += '<div class="confirm"><p>' + esc(p.label) + " changed for " + esc(nameKey) + ".</p>" +
        '<p class="detail">This contact appears on ' + p.count + " transactions in this batch. New value: " + esc(p.value || "(blank)") + "</p>" +
        '<div class="row"><button type="button" class="btn" data-apply="' + esc(p.key) + '">Apply to all ' + p.count + '</button>' +
        '<button type="button" class="btn-quiet" data-cancel="' + esc(p.key) + '">Cancel</button></div></div>';
    });

    html += '<div class="grid">' +
      field("Entity type", '<select data-cname="' + esc(nameKey) + '" data-cfield="type" data-idx="' + i + '"><option value="">— unresolved —</option>' + optionList(contactTypes(), c.type, true) + "</select>") +
      nameFields(i, nameKey, c) +
      field("Contact ID", cInput(i, nameKey, "contactId", c.contactId, ' class="mono"') + '<p class="hint">' + (String(c.contactId || "").trim() ? "Matches this contact across filings." : "Derived from the Manager record and written back at generation.") + "</p>") +
      field("Street", cInput(i, nameKey, "street1", c.street1)) +
      field("Street 2", cInput(i, nameKey, "street2", c.street2)) +
      field("City", cInput(i, nameKey, "city", c.city)) +
      field("State", cInput(i, nameKey, "state", c.state, ' maxlength="2" class="mono"')) +
      field("ZIP", cInput(i, nameKey, "zip", c.zip, ' maxlength="5" class="mono"')) +
      (PERSONAL[c.type]
        ? field("Occupation", cInput(i, nameKey, "occupation", c.occupation)) +
          field("Employment", '<select data-cname="' + esc(nameKey) + '" data-cfield="employmentStatus" data-idx="' + i + '">' +
            '<option value=""' + (!c.employmentStatus ? " selected" : "") + ">Employed — name employer</option>" +
            '<option value="self-employed"' + (c.employmentStatus === "self-employed" ? " selected" : "") + ">Self-employed</option>" +
            '<option value="not-employed"' + (c.employmentStatus === "not-employed" ? " selected" : "") + ">Not employed</option></select>") +
          (!c.employmentStatus
            ? field("Employer", cInput(i, nameKey, "employerName", c.employerName)) +
              field("Employer city", cInput(i, nameKey, "employerCity", c.employerCity)) +
              field("Employer state", cInput(i, nameKey, "employerState", c.employerState, ' maxlength="2" class="mono"'))
            : "")
        : "") +
      "</div>";

    html += '<div class="actions"><button type="button" class="btn-quiet" data-close="' + i + '">Close row</button></div>';
    return '<div class="drawer">' + html + "</div>";
  }

  UI.renderTransactions = function (transactions, contactsByName) {
    view.txns = transactions;
    view.contacts = contactsByName;
    var body = el("tranBody");
    body.innerHTML = "";

    transactions.forEach(function (t, i) {
      var flags = flagsFor(t, contactsByName);
      var req = flags.filter(function (f) { return f.level === "Required"; }).length;
      var notes = flags.length - req;
      var cls = req ? "req" : (notes ? "note" : "");
      var status = req ? req + " required" : (notes ? notes + (notes === 1 ? " note" : " notes") : "ready");
      var row = document.createElement("div");
      row.className = "trow";
      row.innerHTML =
        '<button type="button" class="trow-head" data-open-row="' + i + '">' +
          '<span class="c-date">' + esc(t.date) + "</span>" +
          '<span class="c-name">' + esc(t.contactName) + "</span>" +
          '<span class="c-amt">' + esc(money(t.amount)) + "</span>" +
          '<span class="c-type">' + esc(t.typeCode ? t.typeCode + " / " + (t.subCode || "—") : "not set") + "</span>" +
          '<span class="c-status ' + cls + '">' + esc(status) + "</span>" +
        "</button>" +
        (view.openRow === i ? drawerHtml(i, t, contactsByName) : "");
      body.appendChild(row);
    });

    wireRows();
    renderGate();
    setSummary(1, UI.gate().ok ? "clear" : UI.gate().blocking + " flagged");
    syncMeta();
  };

  function rerender() { UI.renderTransactions(view.txns, view.contacts); }

  function renderGate() {
    var g = UI.gate();
    var banner = el("gateBanner");
    var gen = el("generateBtn");
    var next = el("toStage2");
    if (g.ok) {
      banner.innerHTML = "";
      if (gen) gen.disabled = false;
      if (next) next.disabled = false;
      var s2 = el("stage2");
      if (s2 && s2.getAttribute("data-locked") === "true") {
        s2.setAttribute("data-locked", "false");
        s2.querySelector(".stage-head").disabled = false;
      }
    } else {
      var msg = g.blocking
        ? g.blocking + (g.blocking === 1 ? " transaction is" : " transactions are") + " missing something ORESTAR\u2019s schema requires." +
          (g.unopened ? " " + g.unopened + " flagged row(s) still need to be opened and reviewed." : "")
        : g.unopened + " flagged row(s) still need to be opened and reviewed once before generating.";
      banner.innerHTML = '<div class="banner"><p class="lvl">Generation blocked</p><p>' + esc(msg) + "</p></div>";
      if (gen) gen.disabled = true;
      if (next) next.disabled = true;
    }
    setSummary(2, g.ok ? (el("downloadBtn") && !el("downloadBtn").disabled ? "generated" : "ready") : "locked");
  }

  function wireRows() {
    var body = el("tranBody");

    body.querySelectorAll("[data-open-row]").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = Number(b.getAttribute("data-open-row"));
        view.openRow = view.openRow === i ? null : i;
        view.opened[i] = true;
        rerender();
      });
    });
    body.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { view.openRow = null; rerender(); });
    });

    /* transaction fields — written straight back onto the loadedTransactions object */
    body.querySelectorAll("[data-field]").forEach(function (input) {
      input.addEventListener("change", function (e) {
        var i = Number(e.target.dataset.idx), f = e.target.dataset.field, t = view.txns[i];
        if (f === "tranPurpose") {
          var parsed = typeof parseTranPurposeText === "function"
            ? parseTranPurposeText(e.target.value)
            : { codes: e.target.value.split(/[,;]/).map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean), invalidTokens: [] };
          t.tranPurposeCodes = parsed.codes.concat(parsed.invalidTokens);
        } else {
          t[f] = e.target.value;
          if (f === "typeCode") {
            var opts = subtypes(t.typeCode);
            if (!opts.some(function (o) { return o[0] === t.subCode; })) t.subCode = opts[0] ? opts[0][0] : "";
          }
        }
        rerender();
      });
    });

    /* contact fields — one contact record, shared by every transaction on that name */
    body.querySelectorAll("[data-cfield]").forEach(function (input) {
      input.addEventListener("change", function (e) {
        var nameKey = e.target.dataset.cname, f = e.target.dataset.cfield, value = e.target.value;
        var count = view.txns.filter(function (x) { return x.contactName === nameKey; }).length;
        if (count > 1) {
          var key = nameKey + "\u0000" + f;
          view.pending[key] = { key: key, name: nameKey, field: f, value: value, count: count, label: labelOf(f) };
        } else {
          view.contacts[nameKey][f] = value;
        }
        rerender();
      });
    });

    body.querySelectorAll("[data-apply]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = view.pending[b.getAttribute("data-apply")];
        if (p) { view.contacts[p.name][p.field] = p.value; delete view.pending[p.key]; }
        rerender();
      });
    });
    body.querySelectorAll("[data-cancel]").forEach(function (b) {
      b.addEventListener("click", function () { delete view.pending[b.getAttribute("data-cancel")]; rerender(); });
    });
  }

  var LABELS = {
    type: "Entity type", first: "First name", last: "Last name", business: "Business name", committeeName: "Committee name",
    contactId: "Contact ID", street1: "Street", street2: "Street 2", city: "City", state: "State", zip: "ZIP",
    occupation: "Occupation", employmentStatus: "Employment", employerName: "Employer", employerCity: "Employer city", employerState: "Employer state"
  };
  function labelOf(f) { return LABELS[f] || f; }

  /* ---------- stage 02: counts ---------- */
  UI.setStats = function (transactions, contactsByName) {
    var contrib = transactions.filter(function (t) { return t.typeCode === "C" || t.typeCode === "OR" || t.typeCode === "OA"; });
    var expend = transactions.filter(function (t) { return t.typeCode === "E" || t.typeCode === "OD"; });
    var sum = function (list) { return list.reduce(function (a, t) { return a + (parseFloat(t.amount) || 0); }, 0); };
    var names = {};
    transactions.forEach(function (t) { names[t.contactName] = 1; if (t.expendContactName) names[t.expendContactName] = 1; });
    var newIds = Object.keys(names).filter(function (n) {
      var c = contactsByName[n] || {};
      return c.recordKey && !String(c.contactId || "").trim();
    }).length;

    var stats = [
      ["Transactions in file", String(transactions.length), "one per ORESTAR transaction"],
      ["Contributions", money(sum(contrib)), contrib.length + " records"],
      ["Expenditures", money(sum(expend)), expend.length + " records"],
      ["Contacts referenced", String(Object.keys(names).length), newIds ? newIds + (newIds === 1 ? " new ID" : " new IDs") + " written back" : "all IDs on file"]
    ];
    var box = el("genStats");
    box.innerHTML = stats.map(function (s) {
      return '<div class="stat"><p class="lbl">' + esc(s[0]) + '</p><p class="val">' + esc(s[1]) + '</p><p class="sub">' + esc(s[2]) + "</p></div>";
    }).join("");
    box.hidden = false;
    setSummary(2, "generated");
  };

  /* ---------- stage 03: one ID per Manager record ---------- */
  UI.renderTxnIds = function (transactions) {
    var body = el("txnIdBody");
    body.innerHTML = "";
    var seen = {};
    transactions.forEach(function (t, i) {
      /* A fair-market split is two entries sharing one Manager record. ORESTAR
         hands back one ID for it — the contribution half — so only that half
         gets an input, and the write goes to the record behind it. */
      var recordKey = (t.formPath || "") + "|" + (t.key || i);
      var isFmvHalf = t.typeCode === "OR" && t.subCode === "FM";
      if (seen[recordKey] && isFmvHalf) return;
      if (isFmvHalf && transactions.some(function (x, xi) {
        return xi !== i && ((x.formPath || "") + "|" + (x.key || xi)) === recordKey;
      })) return;
      seen[recordKey] = true;

      var row = document.createElement("div");
      row.className = "idrow";
      row.innerHTML =
        '<span class="c-date">' + esc(t.date) + "</span>" +
        '<span class="c-name">' + esc(t.contactName) + "</span>" +
        '<span class="c-amt">' + esc(money(t.amount)) + "</span>" +
        '<input type="text" class="mono" data-idx="' + i + '" data-field="orestarTxnId" placeholder="numeric ID" aria-label="ORESTAR transaction ID for ' + esc(t.contactName) + '">';
      body.appendChild(row);
    });
    setSummary(3, "awaiting IDs");
  };

  /* ---------- mount ---------- */
  function mount() {
    el("themeBtn").addEventListener("click", function () {
      var dark = document.body.getAttribute("data-theme") === "dark";
      document.body.setAttribute("data-theme", dark ? "light" : "dark");
      el("themeBtn").textContent = dark ? "Dark" : "Light";
    });

    document.querySelectorAll(".stage-head").forEach(function (h) {
      h.addEventListener("click", function () { UI.goTo(Number(h.getAttribute("data-stage"))); });
    });

    el("toStage2").addEventListener("click", function () { if (UI.gate().ok) UI.goTo(2); });
    el("toStage3").addEventListener("click", function () { UI.goTo(3); });

    el("viewFileBtn").addEventListener("click", function () {
      var wrap = el("xmlWrap");
      wrap.hidden = !wrap.hidden;
      el("viewFileBtn").textContent = wrap.hidden ? "View file" : "Hide file";
    });

    /* script.js enables #downloadBtn and fills #xmlOutput when generation
       succeeds; reveal the file controls off the back of that. */
    var dl = el("downloadBtn");
    var observer = new MutationObserver(function () {
      if (!dl.disabled) {
        el("viewFileBtn").hidden = false;
        el("fileName").textContent = "orestar-export-" + new Date().toISOString().slice(0, 10) + ".xml";
        el("toStage3").hidden = false;
        if (view.txns) UI.setStats(view.txns, view.contacts || {});
      }
    });
    observer.observe(dl, { attributes: true, attributeFilter: ["disabled"] });

    syncMeta();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  return UI;
})();
