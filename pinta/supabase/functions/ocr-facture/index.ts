import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const API_SECRET = Deno.env.get('EDGE_API_SECRET') || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-secret',
  'Content-Type': 'application/json',
};

function checkSecret(req: Request): boolean {
  if (!API_SECRET) return true;
  return req.headers.get('x-api-secret') === API_SECRET;
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('OK', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!checkSecret(req)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: corsHeaders });

  try {
    const { imageUrl, colisId, factureId } = await req.json();
    if (!imageUrl) return new Response(JSON.stringify({ error: 'imageUrl required' }), { status: 400, headers: corsHeaders });
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers: corsHeaders });

    const { data: dbCats } = await supabase.from('categories').select('id, label');
    const catLabels = (dbCats || []).map((c: any) => c.label).join(', ');
    const catMap: Record<string, string> = {};
    (dbCats || []).forEach((c: any) => { catMap[c.label] = c.id; });

    const isPdf = imageUrl.toLowerCase().includes('.pdf');
    let imageContent: any;
    try {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) return new Response(JSON.stringify({ error: `Cannot fetch: ${imgRes.status}` }), { headers: corsHeaders });
      const imgBuffer = await imgRes.arrayBuffer();
      const base64 = toBase64(imgBuffer);
      const contentType = imgRes.headers.get('content-type') || (isPdf ? 'application/pdf' : 'image/jpeg');
      imageContent = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
        : { type: 'image', source: { type: 'base64', media_type: contentType.startsWith('image/') ? contentType : 'image/jpeg', data: base64 } };
    } catch (e) {
      return new Response(JSON.stringify({ error: `Download failed: ${e}` }), { headers: corsHeaders });
    }

    const prompt = `Analyse cette facture. Extrais les articles et regroupe par catégorie (${catLabels}). Réponds en JSON: {"vendeur":"","total_ht":0,"nb_articles_total":0,"par_categorie":[{"categorie":"","nb_articles":0,"total_ht":0,"detail":""}]}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }] }),
    });
    if (!claudeRes.ok) { const e = await claudeRes.text(); return new Response(JSON.stringify({ error: `Claude: ${claudeRes.status}`, details: e.slice(0, 200) }), { headers: corsHeaders }); }

    const claudeData = await claudeRes.json();
    const textContent = claudeData.content?.[0]?.text || '';
    let extracted: any = null;
    try { extracted = JSON.parse(textContent.trim()); } catch {
      try { const m = textContent.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) extracted = JSON.parse(m[1].trim()); } catch {}
      if (!extracted) { try { const m = textContent.match(/\{[\s\S]*\}/); if (m) extracted = JSON.parse(m[0]); } catch {} }
    }
    if (!extracted) return new Response(JSON.stringify({ error: 'Impossible de lire cette facture.', raw: textContent.slice(0, 300) }), { headers: corsHeaders });
    if (extracted.error) return new Response(JSON.stringify({ error: extracted.error }), { headers: corsHeaders });

    const insertedLignes: any[] = [];
    if (colisId && extracted.par_categorie?.length > 0) {
      for (const grp of extracted.par_categorie) {
        const catId = grp.categorie ? (catMap[grp.categorie] || null) : null;
        const desc = `${grp.detail || grp.categorie} (${grp.nb_articles} article${grp.nb_articles > 1 ? 's' : ''})`;
        const { data: ligne, error } = await supabase.from('lignes').insert({ colis_id: colisId, description: desc, qte: 1, prix_unitaire: grp.total_ht || 0, categorie_id: catId }).select().single();
        if (!error && ligne) insertedLignes.push({ id: ligne.id, desc: ligne.description, qte: ligne.qte, prix: +ligne.prix_unitaire, cat: ligne.categorie_id });
      }
      if (factureId) {
        const u: any = {};
        if (extracted.total_ht) u.montant = extracted.total_ht;
        if (extracted.vendeur) u.vendeur = extracted.vendeur;
        if (Object.keys(u).length) await supabase.from('factures').update(u).eq('id', factureId);
      }
    }

    return new Response(JSON.stringify({ success: true, vendeur: extracted.vendeur, total_ht: extracted.total_ht, total: extracted.total_ht, nb_articles_total: extracted.nb_articles_total, nbArticles: extracted.nb_articles_total, insertedLignes, nbLignes: insertedLignes.length }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
