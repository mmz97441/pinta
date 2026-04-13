import * as XLSX from 'xlsx';

// ══════════ Mapping colonnes fichier → champs app ══════════

const COL_MAP = {
  // Référence
  'reference': 'ref', 'référence': 'ref', 'ref': 'ref', 'ref client': 'ref',
  // N° Commande
  'n° commande': 'numCommande', 'n°commande': 'numCommande', 'numero commande': 'numCommande', 'no commande': 'numCommande',
  // Type
  'type de client': 'type', 'type client': 'type', 'type': 'type',
  // Raison sociale
  'raison sociale': 'raisonSociale', 'societe': 'raisonSociale', 'société': 'raisonSociale', 'entreprise': 'raisonSociale',
  // Civilité
  'civilite': 'genre', 'civilité': 'genre', 'genre': 'genre', 'sexe': 'genre',
  // Nom / Prénom
  'nom de famille': 'nom', 'nom': 'nom', 'nom contact': 'nom', 'nom client': 'nom',
  'prenom': 'prenom', 'prénom': 'prenom',
  // Forfait
  'forfait': 'abonnement', 'abonnement': 'abonnement', 'formule': 'abonnement',
  // Dates abonnement
  'date fin abonnement': 'abonnementFin', 'date fin': 'abonnementFin', 'fin abonnement': 'abonnementFin',
  'date debut abonnement': 'abonnementDebut', 'date début abonnement': 'abonnementDebut', 'debut abonnement': 'abonnementDebut',
  // Paiements
  'paiements': 'modePaiement', 'paiement': 'modePaiement', 'mode paiement': 'modePaiement', 'mode de paiement': 'modePaiement',
  // Téléphone
  'telephone mobile': 'tel', 'téléphone mobile': 'tel', 'tel mobile': 'tel', 'tel': 'tel', 'telephone': 'tel', 'téléphone': 'tel', 'mobile': 'tel',
  'telephone fixe': 'telFixe', 'téléphone fixe': 'telFixe', 'tel fixe': 'telFixe', 'fixe': 'telFixe',
  // Email
  'email': 'email', 'e-mail': 'email', 'mail': 'email', 'adresse email': 'email',
  // Adresse
  'commune': 'commune', 'ville': 'ville',
  'code postal': 'cp', 'cp': 'cp',
  'adresse': 'adresseLigne1', 'adresse ligne 1': 'adresseLigne1', 'adresse 1': 'adresseLigne1', 'adresse ligne 2': 'adresseLigne2', 'adresse 2': 'adresseLigne2',
  // Département
  'departement': 'departement', 'département': 'departement', 'dept': 'departement',
  // SIRET
  'siret': 'siret', 'siren': 'siret',
  // Telegram
  'telegram': 'telegramUsername', 'telegram username': 'telegramUsername',
  // Notes
  'notes': 'notes', 'commentaire': 'notes', 'commentaires': 'notes',
  // Date naissance
  'date naissance': 'dateNaissance', 'date de naissance': 'dateNaissance', 'naissance': 'dateNaissance',
  // Infos livraison
  'infos livraison': 'infosLivraison', 'informations livraison': 'infosLivraison',
  // Interlocuteur
  'interlocuteur': 'interlocuteur', 'contact': 'interlocuteur',
};

/** Normalise un header de colonne pour le mapping */
function normalizeHeader(h) {
  return (h || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents for matching
    .replace(/[_\-]/g, ' ')
    .trim();
}

// ══════════ Conversion des valeurs ══════════

/** Convertit une date DD/MM/YYYY ou serial Excel en YYYY-MM-DD */
function parseDate(val) {
  if (!val) return '';
  // Excel serial number
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

/** Convertit la civilité en genre */
function parseGenre(val) {
  const v = (val || '').toLowerCase().trim();
  if (v === 'mme' || v === 'madame' || v === 'f' || v === 'femme' || v === 'mlle') return 'Femme';
  if (v === 'm.' || v === 'm' || v === 'monsieur' || v === 'homme' || v === 'mr') return 'Homme';
  return '';
}

/** Convertit le type de client */
function parseType(val) {
  const v = (val || '').toLowerCase().trim();
  if (v.includes('physique') || v.includes('particulier') || v === 'pp') return 'particulier';
  if (v.includes('morale') || v.includes('pro') || v.includes('entreprise') || v === 'pm') return 'pro';
  return 'particulier';
}

/** Convertit le forfait */
function parseForfait(val) {
  const v = (val || '').toLowerCase().trim();
  if (v.includes('vip')) return 'vip';
  if (v.includes('premium') && v.includes('annuel')) return 'premium_annuel';
  if (v.includes('premium') && v.includes('mensuel')) return 'premium_mensuel';
  if (v.includes('premium')) return 'premium_annuel'; // default premium = annuel
  return 'freemium';
}

/** Convertit le mode de paiement */
function parsePaiement(val) {
  const v = (val || '').toLowerCase().trim();
  if (v.includes('virement')) return 'virement';
  if (v.includes('30') || v.includes('trente')) return '30j';
  if (v.includes('fin de mois') || v.includes('fin du mois')) return 'fin_mois';
  return 'colis';
}

/** Parse la commune composite "97436 - SAINT-LEU (Centre-ville)" */
function parseCommune(val) {
  if (!val) return { cp: '', ville: '', commune: '' };
  const s = String(val).trim();
  // Format: "97436 - SAINT-LEU (Centre-ville)"
  const m = s.match(/^(\d{5})\s*[-–]\s*([^(]+?)(?:\s*\((.+)\))?$/);
  if (m) {
    return {
      cp: m[1],
      ville: m[2].trim(),
      commune: m[3] ? `${m[2].trim()} (${m[3].trim()})` : m[2].trim(),
    };
  }
  // Just a postal code
  if (/^\d{5}$/.test(s)) return { cp: s, ville: '', commune: '' };
  // Just a name
  return { cp: '', ville: s, commune: s };
}

/** Nettoie un numéro de téléphone */
function cleanTel(val) {
  if (!val) return '';
  return String(val).trim().replace(/\s+/g, ' ');
}

// ══════════ Parse fichier ══════════

/** Parse un fichier Excel ou CSV et retourne les clients mappés */
export async function parseClientFile(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (rows.length === 0) return { clients: [], headers: [], errors: ['Fichier vide'] };

  // Map headers
  const rawHeaders = Object.keys(rows[0]);
  const headerMap = {};
  const unmapped = [];
  for (const rh of rawHeaders) {
    const normalized = normalizeHeader(rh);
    // Try exact match first, then try normalized without accents
    const mapped = COL_MAP[normalized] || COL_MAP[normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
    if (mapped) {
      headerMap[rh] = mapped;
    } else {
      unmapped.push(rh);
    }
  }

  // Parse each row
  const clients = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cl = {
      nom: '', prenom: '', genre: '', dateNaissance: '',
      tel: '', telFixe: '', email: '',
      ville: '', cp: '', adresseLigne1: '', adresseLigne2: '', commune: '', infosLivraison: '',
      telegramUsername: '', canal: 'telegram',
      type: 'particulier', modePaiement: 'colis',
      abonnement: 'freemium', abonnementDebut: '', abonnementFin: '',
      notes: '', raisonSociale: '', siret: '', interlocuteur: '',
      // Extra fields from import
      _ref: '', _numCommande: '',
    };

    for (const [rawCol, fieldKey] of Object.entries(headerMap)) {
      const val = row[rawCol];
      if (val === '' || val === null || val === undefined) continue;

      switch (fieldKey) {
        case 'ref': cl._ref = String(val).trim(); break;
        case 'numCommande': cl._numCommande = String(val).trim(); break;
        case 'type': cl.type = parseType(val); break;
        case 'genre': cl.genre = parseGenre(val); break;
        case 'abonnement': cl.abonnement = parseForfait(val); break;
        case 'modePaiement': cl.modePaiement = parsePaiement(val); break;
        case 'abonnementFin': cl.abonnementFin = parseDate(val); break;
        case 'abonnementDebut': cl.abonnementDebut = parseDate(val); break;
        case 'dateNaissance': cl.dateNaissance = parseDate(val); break;
        case 'tel': cl.tel = cleanTel(val); break;
        case 'telFixe': cl.telFixe = cleanTel(val); break;
        case 'commune': {
          const parsed = parseCommune(val);
          if (parsed.cp && !cl.cp) cl.cp = parsed.cp;
          if (parsed.ville && !cl.ville) cl.ville = parsed.ville;
          cl.commune = parsed.commune;
          break;
        }
        case 'departement': break; // Info dérivable du CP, on ignore
        default:
          cl[fieldKey] = String(val).trim();
      }
    }

    // Validation minimale
    if (!cl.nom.trim()) {
      errors.push(`Ligne ${i + 2} : nom manquant`);
      continue;
    }

    // Si pro et pas de raison sociale, mettre le nom
    if (cl.type === 'pro' && !cl.raisonSociale) {
      cl.raisonSociale = cl.nom;
    }

    // Canal: email par défaut si pas de telegram
    if (!cl.telegramUsername) {
      cl.canal = 'email';
    }

    // Notes: stocker la ref d'origine et le n° commande
    const importNotes = [];
    if (cl._ref) importNotes.push(`Réf. import: ${cl._ref}`);
    if (cl._numCommande) importNotes.push(`N° cmd: ${cl._numCommande}`);
    if (importNotes.length > 0) {
      cl.notes = (cl.notes ? cl.notes + '\n' : '') + importNotes.join(' | ');
    }

    clients.push(cl);
  }

  return {
    clients,
    headers: rawHeaders.map((h) => ({ raw: h, mapped: headerMap[h] || null })),
    unmapped,
    errors,
    total: rows.length,
  };
}

/** Détecte les doublons entre les clients importés et les clients existants */
export function detectDuplicates(importedClients, existingClients) {
  return importedClients.map((ic) => {
    const dup = existingClients.find((ec) => {
      // Match par email
      if (ic.email && ec.email && ic.email.toLowerCase() === ec.email.toLowerCase()) return true;
      // Match par téléphone (derniers 8 chiffres)
      const icTel = (ic.tel || '').replace(/[\s\-+]/g, '');
      const ecTel = (ec.tel || '').replace(/[\s\-+]/g, '');
      if (icTel.length >= 8 && ecTel.length >= 8 && icTel.slice(-8) === ecTel.slice(-8)) return true;
      // Match par nom exact + CP
      if (ic.nom && ec.nom && ic.cp && ec.cp) {
        const iNom = (ic.nom || '').toLowerCase().trim();
        const eNom = ((ec.nomFamille || ec.nom || '')).toLowerCase().trim();
        if (iNom === eNom && ic.cp === ec.cp) return true;
      }
      return false;
    });
    return { client: ic, duplicate: dup || null };
  });
}
