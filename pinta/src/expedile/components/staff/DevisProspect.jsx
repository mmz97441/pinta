import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BRAND, ABONNEMENTS, getDestByCP, DESTINATIONS } from '../../constants';
import { eur, calcTransport, getCatTaux } from '../../utils';

export default function DevisProspect() {
  const { tarifs, categories, flash } = useApp();

  const [form, setForm] = useState({
    nom: '', prenom: '', email: '', type: 'particulier',
    dimL: '', dimW: '', dimH: '', poids: '',
    valeurMarchandise: '', categorie: '',
    destination: '974',
    abonnement: 'freemium',
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const isPro = form.type === 'pro';
  const dest = DESTINATIONS[form.destination] || DESTINATIONS['974'];
  const t = tarifs[form.destination] || tarifs['974'];

  // Calcul
  const L = parseFloat(form.dimL) || 0;
  const W = parseFloat(form.dimW) || 0;
  const H = parseFloat(form.dimH) || 0;
  const P = parseFloat(form.poids) || 0;
  const pv = L && W && H ? (L * W * H) / 5000 : 0;
  const pf = Math.max(P, pv);
  const tr = pf > 0 ? calcTransport(pf, t) : 0;

  const valeur = parseFloat(form.valeurMarchandise) || 0;
  let om = 0, omr = 0, tva = 0;

  if (!isPro && valeur > 0 && form.categorie) {
    const cat = categories.find((c) => c.id === form.categorie);
    if (cat) {
      const ct = getCatTaux(cat, form.destination);
      const cif = valeur + tr;
      om = cif * ct.om / 100;
      omr = cif * ct.omr / 100;
    }
    const ht = tr + om + omr;
    tva = ht * (dest.tva / 100);
  }

  const total = Math.round((tr + om + omr + tva) * 100) / 100;

  // Calcul premium pour comparaison
  const tPremium = tarifs[form.destination + '_premium'] || t; // fallback
  const trPremium = pf > 0 ? calcTransport(pf, tPremium) : tr; // simplified
  const totalPremiumEstimate = Math.round((trPremium + om + omr + tva) * 100) / 100;

  const canSend = form.email && form.nom && pf > 0 && total > 0;

  const handleSendEmail = () => {
    if (!canSend) { flash({ msg: 'Remplissez tous les champs obligatoires', type: 'warning' }); return; }

    const prenom = form.prenom || form.nom.split(' ')[0];
    const subject = `Devis estimatif Expedîle — ${dest.flag} ${dest.nom}`;
    const body = `Bonjour ${prenom},

Suite à votre demande, voici votre devis estimatif pour une expédition vers ${dest.nom} :

Dimensions : ${L}×${W}×${H} cm
Poids : ${P} kg
Poids facturable : ${pf.toFixed(2)} kg

Transport : ${eur(tr)}${!isPro ? `
Taxes douanières (OM+OMR) : ${eur(om + omr)}
TVA (${dest.tva}%) : ${eur(tva)}` : ''}
━━━━━━━━━━━━━━━━
TOTAL ESTIMATIF : ${eur(total)}
━━━━━━━━━━━━━━━━

⚠️ Ce devis est fourni à titre indicatif, sous réserve d'exactitude des données fournies. Le montant définitif sera établi après réception et mesure du colis dans notre entrepôt.

Pour toute question, n'hésitez pas à nous contacter.

Cordialement,
L'équipe Expedîle — Paris → ${dest.nom}`;

    window.open(`mailto:${form.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
    flash({ msg: `Email devis ouvert pour ${prenom}`, type: 'success' });
  };

  const LBL = 'text-[11px] font-bold text-gray-500 block mb-1 uppercase tracking-wide';
  const INP = 'w-full px-3 py-2 rounded-xl border-2 border-gray-200 text-sm outline-none focus:border-blue-300 transition-colors';

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-black" style={{ color: BRAND.navy }}>Devis rapide (prospect)</h1>
          <p className="text-xs text-gray-400 mt-0.5">Estimation sans création de colis ni de client</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
          {/* Type */}
          <div className="flex gap-2">
            <button onClick={() => set('type', 'particulier')}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${!isPro ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
              Particulier
            </button>
            <button onClick={() => set('type', 'pro')}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${isPro ? 'text-white' : 'bg-gray-100 text-gray-500'}`}
              style={isPro ? { background: BRAND.goldD } : {}}>
              Professionnel
            </button>
          </div>

          {/* Client info */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LBL}>Nom *</label>
              <input value={form.nom} onChange={(e) => set('nom', e.target.value)} placeholder="NOM" className={INP} />
            </div>
            <div>
              <label className={LBL}>Prénom</label>
              <input value={form.prenom} onChange={(e) => set('prenom', e.target.value)} placeholder="Prénom" className={INP} />
            </div>
            <div>
              <label className={LBL}>Email *</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="adresse@email.com" className={INP} />
            </div>
          </div>

          {/* Destination */}
          <div>
            <label className={LBL}>Destination *</label>
            <select value={form.destination} onChange={(e) => set('destination', e.target.value)} className={INP}>
              {Object.entries(DESTINATIONS).map(([code, d]) => (
                <option key={code} value={code}>{d.flag} {d.nom} ({code})</option>
              ))}
            </select>
          </div>

          {/* Dimensions */}
          <div>
            <label className={LBL}>Dimensions et poids *</label>
            <div className="grid grid-cols-4 gap-2">
              <input type="number" value={form.dimL} onChange={(e) => set('dimL', e.target.value)} placeholder="Long. cm" className={INP} />
              <input type="number" value={form.dimW} onChange={(e) => set('dimW', e.target.value)} placeholder="Larg. cm" className={INP} />
              <input type="number" value={form.dimH} onChange={(e) => set('dimH', e.target.value)} placeholder="Haut. cm" className={INP} />
              <input type="number" value={form.poids} onChange={(e) => set('poids', e.target.value)} placeholder="Poids kg" className={INP} />
            </div>
          </div>

          {/* Marchandise (particuliers uniquement) */}
          {!isPro && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LBL}>Valeur marchandise (€)</label>
                <input type="number" value={form.valeurMarchandise} onChange={(e) => set('valeurMarchandise', e.target.value)} placeholder="0.00" className={INP} />
              </div>
              <div>
                <label className={LBL}>Catégorie</label>
                <select value={form.categorie} onChange={(e) => set('categorie', e.target.value)} className={INP}>
                  <option value="">— Choisir —</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Résultat */}
          {pf > 0 && (
            <div className="p-4 rounded-xl border-2" style={{ borderColor: BRAND.navy + '30', background: BRAND.navy + '06' }}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Estimation</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Poids facturable</span>
                  <span className="font-bold">{pf.toFixed(2)} kg</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Transport</span>
                  <span className="font-semibold">{eur(tr)}</span>
                </div>
                {!isPro && (om + omr) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Taxes (OM+OMR)</span>
                    <span className="font-semibold">{eur(om + omr)}</span>
                  </div>
                )}
                {!isPro && tva > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">TVA ({dest.tva}%)</span>
                    <span className="font-semibold">{eur(tva)}</span>
                  </div>
                )}
                <div className="border-t border-gray-200 pt-1 mt-1 flex justify-between">
                  <span className="font-bold" style={{ color: BRAND.navy }}>TOTAL ESTIMATIF</span>
                  <span className="text-lg font-black" style={{ color: BRAND.navy }}>{eur(total)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Bouton envoi */}
          <button
            onClick={handleSendEmail}
            disabled={!canSend}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${BRAND.navy}, ${BRAND.navyL})` }}
          >
            Envoyer le devis par email
          </button>
          <p className="text-[9px] text-gray-400 text-center">
            Mention "sous réserve d'exactitude des données fournies" incluse automatiquement
          </p>
        </div>
      </div>
    </div>
  );
}
