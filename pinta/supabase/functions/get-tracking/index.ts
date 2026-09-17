import { publicTrackingFacts } from '../_shared/publicTracking.ts';
import { trustedStoragePath, throwDb } from '../_shared/http.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey',
  'Content-Type': 'application/json',
};

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = new URL(req.url);
    let token = url.searchParams.get('token');

    if (!token && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      token = body.token;
    }

    if (!token || token.length < 20) {
      return new Response(JSON.stringify({ ok: false, error: 'Lien invalide' }), { status: 400, headers: cors });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Valider le token
    const { data: link, error: linkErr } = await supabase
      .from('share_links')
      .select('id, client_id, revoked_at, access_count, created_at')
      .eq('token', token)
      .maybeSingle();

    if (linkErr) throw linkErr;
    if (!link) {
      return new Response(JSON.stringify({ ok: false, error: 'Lien introuvable' }), { status: 404, headers: cors });
    }

    if (link.revoked_at) {
      return new Response(JSON.stringify({ ok: false, error: 'Ce lien a été révoqué' }), { status: 410, headers: cors });
    }

    // 2. Client (juste nom + prenom)
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, nom, prenom')
      .eq('id', link.client_id)
      .maybeSingle();

    if (clientError) throw clientError;
    if (!client) {
      return new Response(JSON.stringify({ ok: false, error: 'Client introuvable' }), { status: 404, headers: cors });
    }

    // 3. Colis actifs (ou livrés depuis moins de 10j)
    const { data: allColis, error: colisError } = await supabase
      .from('colis')
      .select('id, ref, desc_contenu, statut, date_reception, casier, fin_l, fin_w, fin_h, fin_p, dim_l, dim_w, dim_h, poids, photo_prep, feu_vert, envoi_id, updated_at, attente_client_date, attente_client_until, feu_vert_date, demande_feu_vert_envoyee_at, devis_envoye_le, paiement_date, date_expedition, date_livraison, nb_colis, dims_par_colis, trackings, trackings_detail, final_packages, outgoing_parcel_count, preparation_composition_version, final_measurements_version, devis_total, devis_brouillon, devis_snapshot')
      .eq('client_id', link.client_id)
      .neq('statut', 'annule')
      .eq('archive', false)
      .order('date_reception', { ascending: false });

    if (colisError) throw colisError;

    // 4. Filtrer : soit pas livré, soit livré depuis < 10j (via updated_at)
    const now = Date.now();
    const colis = (allColis || []).filter((c) => {
      if (c.statut !== 'livre') return true;
      const updatedAt = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      return (now - updatedAt) < TEN_DAYS_MS;
    });

    // 5. Si aucun colis → lien expiré
    if (colis.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Ce lien a expiré' }), { status: 410, headers: cors });
    }

    // 6. Enrichir avec l'envoi (date de départ prévue)
    const envoiIds = [...new Set(colis.map((c) => c.envoi_id).filter(Boolean))];
    const { data: envois } = envoiIds.length > 0
      ? await supabase.from('envois').select('id, date_depart, statut').in('id', envoiIds)
      : { data: [] };

    // 7. Destination du client (via CP)
    const { data: clientFull } = await supabase
      .from('clients')
      .select('cp, ville')
      .eq('id', link.client_id)
      .maybeSingle();

    // Construire l'expéditeur "Prénom N."
    const prenom = client.prenom || (client.nom || '').split(' ')[0] || '';
    const nomParts = (client.nom || '').split(' ');
    const nomFamille = client.prenom ? nomParts.join(' ') : nomParts.slice(-1)[0];
    const initialeNom = (nomFamille || '').charAt(0).toUpperCase();
    const expediteur = `${prenom} ${initialeNom}.`;

    // Mapper vers format public (zéro info sensible)
    const publicColis = await Promise.all(colis.map(async (c) => {
      let photoPrep = null;
      if (c.photo_prep) {
        try {
          const path = trustedStoragePath(c.photo_prep, 'photos-colis', c.id);
          const signed = await supabase.storage.from('photos-colis').createSignedUrl(path, 900);
          throwDb(signed); photoPrep = signed.data?.signedUrl || null;
        } catch { /* Keep tracking available when a historical photo cannot be signed. */ }
      }
      const envoi = envois?.find((e) => e.id === c.envoi_id);
      const physical = publicTrackingFacts(c);
      return {
        ref: c.ref,
        desc: c.desc_contenu,
        statut: c.statut,
        dateReception: c.date_reception,
        attenteClientDate: c.attente_client_date, attenteClientUntil: c.attente_client_until,
        feuVertDate: c.feu_vert_date, demandeFeuVertEnvoyeeAt: c.demande_feu_vert_envoyee_at,
        devisEnvoyeLe: c.devis_envoye_le, paiementDate: c.paiement_date, dateExpedition: c.date_expedition, dateLivraison: c.date_livraison,

        ...physical,
        photoPrep,
        eta: envoi?.date_depart,
        envoiStatut: envoi?.statut,
      };
    }));

    // 8. Incrémenter le compteur
    await supabase
      .from('share_links')
      .update({ access_count: (link.access_count || 0) + 1, last_accessed_at: new Date().toISOString() })
      .eq('id', link.id);

    return new Response(JSON.stringify({
      ok: true,
      expediteur,
      destination: {
        cp: clientFull?.cp,
        ville: clientFull?.ville,
      },
      colis: publicColis,
      generatedAt: new Date().toISOString(),
    }), { headers: cors });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'Le suivi est momentanément indisponible. Réessayez.' }), { status: 500, headers: cors });
  }
});
