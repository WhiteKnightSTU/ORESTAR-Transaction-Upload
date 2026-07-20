// ORESTAR export tool — one-time configuration.
//
// Field GUIDs are resolved automatically at runtime (same way the Bank/Cash
// Account list is) by matching these NAMES against your actual custom field
// definitions via /api4/custom-fields — no GUIDs to find or paste in here.
//
// These only need to change if you rename the fields in Manager, or deploy
// this tool for a different business with differently-named fields.

const ORESTAR_CONFIG = {
  // Number-type field on Business Details holding your ORESTAR committee ID.
  FILER_ID_FIELD_NAME: "PAC ID #",

  // Text-type field name — same name used on both Receipts and Payments,
  // but they're two separate field definitions; matched by name + placement.
  TYPE_SUBTYPE_FIELD_NAME: "Transaction Type",

  // Number-type field (same style as PAC ID #), placed on both Receipts and
  // Payments as a single shared field. Empty/null = not yet exported.
  TRANSACTION_ID_FIELD_NAME: "Transaction ID",

  // Text-type field holding the ORESTAR payment method code (CHK/ACH/EFT/DC/CC).
  PAYMENT_METHOD_FIELD_NAME: "Payment Method",

  // Number-type field holding the check number, when applicable.
  CHECK_NUMBER_FIELD_NAME: "Check #",

  // The following live on the Customer/Supplier/Employee record itself
  // (not on Receipts/Payments) — resolved automatically when a contact is
  // looked up by key, same lookup that resolves the display name.
  OCCUPATION_FIELD_NAME: "Occupation Information: Occupation",
  EMPLOYER_NAME_FIELD_NAME: "Occupational Information: Employer's Name",
  EMPLOYER_CITY_FIELD_NAME: "Occupational Information: Employer's City",
  EMPLOYER_STATE_FIELD_NAME: "Occupational Information: Employer's State", // stores full state name, e.g. "Oregon"
  CONTACT_TYPE_FIELD_NAME: "Type", // stores the entity type (Individual/Business/etc.)

  // Checkbox-type fields, same placement as the fields above.
  NOT_EMPLOYED_FIELD_NAME: "Not Employed",
  SELF_EMPLOYED_FIELD_NAME: "Self-Employed",

  // Text-type field on Customer/Supplier/Employee holding the ID ORESTAR
  // uses to match this contact across filings — confirmed directly with the
  // ORESTAR admin that matching is done by contact/@id, not by data. If this
  // field has a value, that value is always used. If blank, the tool derives
  // one automatically from the Manager record and writes it back here, so
  // the field stays populated and can be manually edited/reconciled in
  // Manager at any time (edits are picked up next time this tool runs).
  CONTACT_ID_FIELD_NAME: "Contact ID",

  // Text-type field, same placement pattern as Payment Method — holds one
  // or more single-letter ORESTAR purpose codes (comma-separated if more
  // than one), e.g. "R" or "G, T". Optional per transaction.
  TRAN_PURPOSE_FIELD_NAME: "Transaction Purpose"
};
