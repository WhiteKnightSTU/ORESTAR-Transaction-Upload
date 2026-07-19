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

  // Text-type field titled "Type - Subtype", placed on both Receipts and Payments.
  TYPE_SUBTYPE_FIELD_GUID: "",

  // Checkbox-type field placed on both Receipts and Payments, tracking what's
  // already been exported.
  DOWNLOADED_FIELD_GUID: ""
};
