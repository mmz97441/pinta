// The outgoing parcel labels: one 100 × 150 mm page per parcel of a prepared dossier,
// with « EXP-2YE537-1-2 » as a QR code and a Code 128 barcode. They are built in
// exportParcelLabels.js; this module keeps the former path working.
export { printParcelLabels, parcelLabels, buildParcelLabelsPdf, skippedLabelLines } from './exportParcelLabels.js';
