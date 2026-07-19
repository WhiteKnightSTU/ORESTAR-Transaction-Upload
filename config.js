// ORESTAR export tool — one-time configuration.
//
// These GUIDs identify your custom FIELD DEFINITIONS (created once in
// Settings > Custom Fields) — not any individual value. They stay the same
// across every account, every transaction, every session. You'll only need
// to change these if you delete and recreate one of the custom fields, or
// if you deploy this tool for a different Manager business (which would
// have its own separately-created fields with different GUIDs).
//
// Find/confirm these via the "List Custom Field Definitions" button in the
// tool itself, or: Settings > Custom Fields > edit the field > copy the ID
// from the browser's address bar.

const ORESTAR_CONFIG = {
  // Number-type field on Business Details holding your ORESTAR committee ID.
  FILER_ID_FIELD_GUID: "f09e9200-6cf1-497b-8a42-cf372600f82e",

  // "Type - Subtype" is actually TWO separate custom fields with the same
  // name — one placed on Receipts, one placed on Payments. Different GUIDs.
  TYPE_SUBTYPE_FIELD_GUID_RECEIPT: "",
  TYPE_SUBTYPE_FIELD_GUID_PAYMENT: "",

  // Number-type field (same style as PAC ID #) storing a Transaction ID.
  // Empty/null = not yet exported (include it). Has any value = already
  // exported (exclude it). Placed on both Receipts and Payments.
  TRANSACTION_ID_FIELD_GUID: ""
};
