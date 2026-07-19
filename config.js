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
  CHECK_NUMBER_FIELD_NAME: "Check #"
};
