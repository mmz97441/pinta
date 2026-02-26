import React, { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { BRAND } from '../../constants';

// QR code value = the colis ref (scannable to open the colis fiche)
// Format: "EXP:EXP-0001" — the app can parse this to navigate to the colis
function ColisQR({ colisRef, size = 64 }) {
  return (
    <QRCodeSVG
      value={`EXP:${colisRef}`}
      size={size}
      level="M"
      bgColor="transparent"
      fgColor="#1B3A4B"
    />
  );
}

// Format étiquette 10×15 cm — 2 par ligne sur A4
function Label({ colis, client, dest, envoi }) {
  const depDate = envoi
    ? new Date(envoi.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const pf = colis.finP && colis.finL && colis.finW && colis.finH
    ? Math.max(colis.finP, (colis.finL * colis.finW * colis.finH) / 5000).toFixed(1)
    : colis.poids && colis.dimL && colis.dimW && colis.dimH
      ? Math.max(colis.poids, (colis.dimL * colis.dimW * colis.dimH) / 5000).toFixed(1)
      : colis.poids ? colis.poids.toFixed(1) : '—';

  const dims = colis.finL && colis.finW && colis.finH
    ? `${colis.finL}×${colis.finW}×${colis.finH}`
    : colis.dimL && colis.dimW && colis.dimH
      ? `${colis.dimL}×${colis.dimW}×${colis.dimH}`
      : '—';

  return (
    <div className="label-card">
      {/* Header bar */}
      <div className="label-header">
        <span className="label-logo">EXPEDILE</span>
        <span className="label-ref">{colis.ref}</span>
      </div>

      {/* QR + Destination row */}
      <div className="label-qr-row">
        <div className="label-qr">
          <ColisQR colisRef={colis.ref} size={72} />
        </div>
        <div className="label-dest-block">
          <span className="label-dest-flag">{dest?.flag || ''}</span>
          <span className="label-dest-name">{dest?.nom || '—'}</span>
          {colis.casier && (
            <span className="label-casier-tag">{colis.casier}</span>
          )}
        </div>
      </div>

      {/* Client info */}
      <div className="label-client">
        <div className="label-client-name">{client?.nom || '—'}</div>
        <div className="label-client-addr">
          {client?.cp || ''} {client?.ville || ''}
        </div>
        {client?.tel && <div className="label-client-tel">{client.tel}</div>}
      </div>

      {/* Package details */}
      <div className="label-details">
        <div className="label-row">
          <span className="label-lbl">Colis</span>
          <span className="label-val">{colis.desc || '—'}</span>
        </div>
        <div className="label-row">
          <span className="label-lbl">Dims</span>
          <span className="label-val">{dims} cm</span>
        </div>
        <div className="label-row">
          <span className="label-lbl">Poids fact.</span>
          <span className="label-val">{pf} kg</span>
        </div>
      </div>

      {/* Flight info */}
      <div className="label-flight">
        Vol : {depDate}
      </div>
    </div>
  );
}

export default function LabelPrint({ items, onClose }) {
  // items = [{ colis, client, dest, envoi }]

  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    const afterPrint = () => { if (onClose) onClose(); };
    window.addEventListener('afterprint', afterPrint);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [onClose]);

  return (
    <div className="print-overlay" onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className="print-container">
        {/* Screen-only toolbar */}
        <div className="print-toolbar no-print">
          <span style={{ color: BRAND.navy, fontWeight: 700, fontSize: 14 }}>
            {items.length} étiquette{items.length > 1 ? 's' : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => window.print()} className="print-btn print-btn-primary">
              Imprimer
            </button>
            {onClose && (
              <button onClick={onClose} className="print-btn print-btn-secondary">
                Fermer
              </button>
            )}
          </div>
        </div>

        {/* Labels grid */}
        <div className="labels-grid">
          {items.map((item, i) => (
            <Label key={item.colis.id || i} {...item} />
          ))}
        </div>
      </div>
    </div>
  );
}
