# ORESTAR Transaction Export Tool

A Manager.io Custom Button that exports Receipts, Payments, Expense Claims, Purchase Invoices, and payroll-forgiven Expense Claims into an ORESTAR-compliant XML file for upload to the Oregon Secretary of State's campaign finance system.

\---

## ⚠️ Disclaimer

This tool was built with substantial assistance from an AI system (Anthropic's Claude). Every part of the XML output has been validated directly against Oregon SOS's official campaign finance XSD schema (`cf\_xsd.xsd`), and the tool has been tested against real transaction data from an active campaign committee. Field mappings and business logic (contribution/expenditure subtypes, in-kind forgiveness handling, purpose codes, etc.) were built against the SOS's own XML Overview documentation and confirmed directly with ORESTAR support where documentation was ambiguous.

That said: **this is not a substitute for your own review.** Whoever files still bears full responsibility for the accuracy and legal compliance of what's submitted. Always review the generated XML and the resulting ORESTAR filing before treating it as final — this tool assists with data entry, it does not replace the judgment of the person or treasurer responsible for the filing.

\---

## Scope

**What this tool does:**

* Pulls not-yet-exported transactions from Manager and generates a single ORESTAR-compliant XML file
* Resolves contacts (name, address, occupation, employer, entity type, employment status) automatically from linked Customer/Supplier/Employee records
* Assigns each contact a stable ID that stays the same across every filing, so ORESTAR recognizes repeat contributors/vendors as the same person
* Tracks which transactions have already been exported, so re-running only pulls new activity
* Lets you enter the real Transaction IDs ORESTAR assigns after upload, for your own record-keeping

**What this tool does not do:**

* It does not upload anything to ORESTAR automatically — you download the XML and upload it yourself via ORESTAR's own "Upload File" page
* It does not file or attest to anything in ORESTAR — that's a separate manual step in ORESTAR's own interface
* It does not replace a treasurer's review before filing

\---

## Requirements

* Manager.io Server Edition (tested against `26.7.14.3656`)
* Ability to add Custom Buttons in Manager (Settings → Custom Buttons)
* Somewhere to host three static files (`index.html`, `script.js`, `config.js`) — GitHub Pages, or any static web host, on the same or a different domain (no CORS issues, since the tool communicates with Manager entirely through Manager's own embedded `postMessage` API proxy, not direct cross-origin requests)
* An ORESTAR account with an assigned Filer ID (committee ID)

\---

## Installation

1. Host `index.html`, `script.js`, and `config.js` together in the same folder, wherever you're hosting static files. All three must stay together and be re-uploaded together any time one changes.
2. In Manager: **Settings → Custom Buttons → New**

   * **Source:** URL
   * **URL:** the hosted address of `index.html`
   * **Placement:** wherever you'd like the button to appear (e.g. Reports, Summary)
3. Save, then open the button from inside Manager. It only works launched this way — it will not function if opened as a standalone browser tab, since it depends on being embedded in Manager to communicate with Manager's API.

\---

## Custom Field Setup (required before first use)

The tool auto-detects every custom field it needs **by name** — there are no GUIDs to find or configure. If you rename any of these in Manager, update the matching line in `config.js` to match.

Create these in **Settings → Custom Fields**:

|Field Name|Type|Placement|Required?|
|-|-|-|-|
|`PAC ID #`|Number|Business Details|**Required** — your ORESTAR committee/filer ID|
|`Transaction Type`|Text|Receipts **and** Payments (two separate fields, same name)|**Required** — stores `"<Type> - <Subtype>"`, e.g. `"Contributions - Cash Contribution"`|
|`Transaction ID`|Number|Receipts, Payments, Expense Claims, Purchase Invoices, Payslips|**Required** — tracks what's already been exported|
|`Payment Method`|Text|Receipts, Payments|Optional — check/electronic code|
|`Check #`|Number|Receipts, Payments|Optional|
|`Transaction Purpose`|Text|Receipts, Payments, Expense Claims|Optional — ORESTAR purpose code(s), see below|
|`Occupation Information: Occupation`|Text|Customer, Supplier, Employee|Optional but recommended|
|`Occupational Information: Employer's Name`|Text|Customer, Supplier, Employee|Optional but recommended|
|`Occupational Information: Employer's City`|Text|Customer, Supplier, Employee|Optional but recommended|
|`Occupational Information: Employer's State`|Text|Customer, Supplier, Employee|Optional — store the **full state name** (e.g. "Oregon"), not the abbreviation|
|`Type`|Text/Dropdown|Customer, Supplier, Employee|Optional — entity type (Individual, Business, Committee, etc.)|
|`Not Employed`|Checkbox|Customer, Supplier, Employee|Optional|
|`Self-Employed`|Checkbox|Customer, Supplier, Employee|Optional|
|`Contact ID`|Text|Customer, Supplier, Employee|Optional but recommended — see below|

**Address** is not a custom field — it uses each Customer/Supplier/Employee's normal Manager address (Billing Address for Customers, standard Address for Suppliers/Employees).

**Transaction Purpose codes:** one or more of ORESTAR's single-letter codes, comma-separated (e.g. `"R"` or `"G, T"`). Either the raw code or the full label works (e.g. `"G"` or `"General Operational Expenses"` both work). Codes `G` and `T` require a Description on the transaction — the tool will block generation if one is missing.

**Contact ID:** normally left blank. The tool derives and saves a stable ID automatically the first time each contact is used. Only fill this in manually if a contact already has an existing ORESTAR ID from before this tool was in use, to keep continuity with that prior record.

**For payroll-forgiven Expense Claims:** create a Payroll Deduction Item named exactly `Forgiven Expense Claim` (Settings → Payroll → Deduction Items, or wherever your Manager version places this). Any payslip deduction line referencing this item is filed as an in-kind Contribution from that employee, not a normal payroll deduction.

\---

## Using the Tool

1. Open the Custom Button from inside Manager.
2. **Load Accounts \& Resolve Fields** — resolves every custom field GUID by name, loads your bank/cash accounts, and resolves your Filer ID. Check the status line here for any ✗ marks before proceeding.
3. Uncheck any accounts you don't want included, then **Load Not-Yet-Downloaded Transactions**.
4. Review the transaction table — Type, Sub-type, Purpose, Payment Method, Description, etc. are all editable if something needs correcting.
5. Review the **Confirm Contacts** section — occupation, employer, address, and employment status are pre-filled where available; fill in anything missing for contacts whose yearly total might exceed $100.
6. Click **Generate ORESTAR XML**. Review the output, then **Download XML**.
7. New Contact IDs are saved back to Manager automatically during generation. If any fail to save, retry with **Save Contact IDs to Manager**.

\---

## Filing in ORESTAR

1. Log into ORESTAR and navigate to the **Upload File** page for your committee.
2. Upload the downloaded XML file.
3. ORESTAR will process the file and assign real Transaction IDs to each transaction.
4. **Check ORESTAR's pending/unfiled transactions area** — uploading does not automatically finalize a public filing; transactions typically need to be reviewed and attested to separately inside ORESTAR by the candidate or treasurer.
5. Once you have the real Transaction IDs ORESTAR assigned, return to the tool and enter them in the table under **"Enter ORESTAR Transaction IDs"**, then save — this is what marks those transactions as exported so they aren't pulled again next time.

