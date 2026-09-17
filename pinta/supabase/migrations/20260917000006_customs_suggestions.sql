-- Read-only, explainable suggestions. No model-generated code/rate and no
-- classification write: saving remains the separate, explicit quote command.
CREATE FUNCTION customs_positive_label(p_text text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT (regexp_split_to_array(customs_search_text(p_text),'\m(sauf|excl|exclusion)\M|\mautres? qu[e’'']'))[1]
$$;
CREATE FUNCTION customs_suggestion_terms(p_text text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT tsvector_to_array(to_tsvector('french',customs_search_text(p_text)))
$$;
CREATE FUNCTION customs_negated_terms(p_text text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(array_agg(DISTINCT term),'{}') FROM regexp_matches(customs_search_text(p_text),'\m(?:non|sans)[ -]+([[:alpha:]]+)','g') part CROSS JOIN LATERAL unnest(customs_suggestion_terms(part[1])) term
$$;

-- Search data is derived without changing a single reference label or tax.
ALTER TABLE customs_tariffs ADD COLUMN suggestion_text text GENERATED ALWAYS AS (customs_positive_label(label)) STORED;
ALTER TABLE customs_tariffs ADD COLUMN suggestion_vector tsvector GENERATED ALWAYS AS (to_tsvector('french',customs_positive_label(label))) STORED;
CREATE INDEX customs_tariffs_suggestion_vector ON customs_tariffs USING gin(suggestion_vector);

CREATE FUNCTION customs_commercial_terms(p_description text) RETURNS TABLE(name text,terms text,kind text)
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT name,terms,kind FROM (VALUES
  ('gel douche','lavage peau','product','\mgel\M.*\mdouche\M'),
  ('enceinte audio','haut-parleur enceinte','product','\menceintes?\M.*\m(bluetooth|audio|musique|son)\M'),
  ('shampoing','shampooings','product','\mshampoo?ings?\M'),
  ('t-shirt','T-shirts','product','\m(t[ -]?shirts?|tee[ -]?shirts?)\M'),
  ('smartphone','téléphones intelligents','product','\m(smartphones?|iphone[0-9]*|telephones? intelligents?)\M'),
  ('chaussettes','chaussettes','product','\mchaussettes?\M'),
  ('baskets','chaussures sport','product','\m(baskets?|sneakers?)\M'),
  ('jean','pantalons denim','product','\m(jeans?|denim)\M'),
  ('sandales en cuir','chaussures cuir','product','\msandales?\M.*\mcuir\M'),
  ('scelleuse','fermer sacs','product','\m(scelleuses?|thermoscelleuses?)\M'),
  ('scelleuse','emballer marchandises','product','\m(scelleuses?|thermoscelleuses?)\M'),
  ('organiseur d’évier','ménage plastiques','product','\m(organis[ae]urs?|organis[ae]teurs?|egouttoirs?)\M.*\m(evier|cuisine|abs|plastique)\M'),
  ('coque pour téléphone','ouvrages plastiques','product','\m(coques?|housses?|etuis?)\M.*\m(iphone[0-9]*|smartphones?|telephones?)\M'),
  ('coque pour téléphone','étuis poche','product','\m(coques?|housses?|etuis?)\M.*\m(iphone[0-9]*|smartphones?|telephones?)\M'),
  ('chargeur','chargeurs accumulateurs','product','\mchargeurs?\M'),
  ('écouteurs','écouteurs','product','\m(ecouteurs?|earbuds?|airpods?)\M'),
  ('lampe de bureau','lampes bureau','product','\mlampes?\M.*\mbureau\M'),
  ('crème solaire','préparations antisolaires','product','\m(cremes?|laits?|sprays?)\M.*\msolaires?\M'),
  ('crème solaire','crèmes solaires','product','\m(cremes?|laits?|sprays?)\M.*\msolaires?\M'),
  ('crème pour le visage','soins peau','product','\mcremes?\M.*\m(hydratant[es]*|visage)\M'),
  ('boîte alimentaire','articles cuisine plastiques','product','\mboites?\M.*\m(alimentaire|conservation)\M.*\mplastiques?\M'),
  ('gourde isotherme','bouteilles isolantes récipients isothermiques','product','\m(gourdes?|thermos)\M.*\m(isothermes?|inox)\M'),
  ('batterie externe','accumulateurs lithium ion','product','\m(powerbank|power bank|batteries? externes?)\M'),
  ('écran de téléphone','modules affichage écrans','product','\mecrans?\M.*\m(iphone[0-9]*|smartphones?|telephones?)\M'),
  ('polyester','fibres synthétiques','material','\mpolyester\M'),
  ('ABS','matières plastiques','material','\mabs\M'),
  ('silicone','matières plastiques','material','\msilicone\M'),
  ('inox','acier inoxydable','material','\minox\M')
 ) aliases(name,terms,kind,pattern)
 WHERE customs_search_text(p_description) ~ pattern
 AND (name<>'smartphone' OR (regexp_split_to_array(customs_search_text(p_description),'\m(pour|compatible)\M'))[1] ~ pattern)
 AND NOT (name='smartphone' AND customs_search_text(p_description) ~ '\m(coques?|etuis?|housses?|chargeurs?|cables?|protections?|vitres?|ecrans?|pieces?|remplacement)\M')
$$;

-- Match the named object, not equipment/parts merely intended for that object.
CREATE FUNCTION customs_product_label_matches(p_name text,p_label text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT customs_positive_label(p_label) ~ CASE p_name
  WHEN 'chaussettes' THEN '^(chausses|chaussettes|bas|collants)'
  WHEN 'sandales en cuir' THEN '^chaussures'
  WHEN 'baskets' THEN '^chaussures'
  WHEN 'gourde isotherme' THEN '^bouteilles isolantes'
  WHEN 'crème pour le visage' THEN '^produits de beaute'
  WHEN 'écouteurs' THEN '^(casques|ecouteurs)'
  ELSE '' END
$$;

CREATE FUNCTION suggest_customs_tariffs(p_items jsonb,p_destination text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item jsonb; description text; normal text; category_code text; stop_terms text[]; modifier_terms text[];
 material_terms text[]; query_materials text[]; fragment text; fragment_anchor text; product_families text[]; fragment_families text[];
 raw_terms text[]; anchors text[]; all_terms text[]; negative_terms text[]; aliases jsonb; product_queries text[];
 primary_anchor text; lookup tsquery; candidates jsonb; answer jsonb:='[]'; mixed boolean; ambiguous boolean;
BEGIN
 IF NOT is_staff() OR NOT (has_permission('perm_colis_calculer_devis') OR has_permission('perm_factures_voir') OR has_permission('perm_factures_modifier_articles')) THEN RAISE EXCEPTION 'Permission de consultation douanière requise' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR p_destination IS NULL OR NOT EXISTS(SELECT 1 FROM destinations WHERE code=p_destination AND actif) THEN RAISE EXCEPTION 'Destination active et lot de 1 à 50 descriptions requis' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'object' OR jsonb_typeof(v->'lineId') IS DISTINCT FROM 'string' OR length(trim(v->>'lineId')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(v->'description') IS DISTINCT FROM 'string' OR length(v->>'description')>2000)
  OR (SELECT count(DISTINCT v->>'lineId') FROM jsonb_array_elements(p_items) v)<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Identifiants uniques et descriptions de 2000 caractères maximum requis' USING ERRCODE='22023'; END IF;
 stop_terms:=customs_suggestion_terms('article produit accessoire lot pièce pack set kit modèle marque taille couleur noir blanc bleu rouge vert rose gris beige livraison nouveau neuf original premium professionnel universel maison divers cadeau rechargeable portable mini automatique compatible rapide usb bluetooth type total ml cm kg go');
 modifier_terms:=customs_suggestion_terms('matière plastique textile fibre synthétique naturel artificiel coton laine cuir métal acier inoxydable bois caoutchouc polyester silicone abs homme femme enfant garçon fille pointure semelle dessus inférieur supérieur électrique thermique protection litre');
 material_terms:=customs_suggestion_terms('coton laine cuir soie lin plastique caoutchouc synthétique artificiel');
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  description:=trim(item->>'description');normal:=regexp_replace(customs_search_text(description),'([[:alpha:]])([0-9])','\1 \2','g');
  category_code:=regexp_replace(coalesce(item->>'categoryCode',''),'[[:space:]]','','g');
  IF category_code !~ '^([0-9]{2}){1,5}$' THEN category_code:=NULL;END IF;
  -- These observed commercial heads have unrelated regulatory meanings; do
  -- not propose mechanical watches or recording media from the noun alone.
  ambiguous:=normal ~ '^ *supports?\M' OR normal ~ '\mmontres?\M.*\mconnectee?s?\M';
  mixed:=normal ~ '\m(lots?|articles?|produits?)\M[^:]{0,35}\m(divers|mixtes?|assortis|differents)\M';
  SELECT coalesce(array_agg(term),'{}') INTO raw_terms FROM unnest(customs_suggestion_terms(normal)) term WHERE NOT term=ANY(stop_terms);
  SELECT coalesce(array_agg(term),'{}') INTO anchors FROM unnest(raw_terms) term WHERE NOT term=ANY(modifier_terms) AND term ~ '^[[:alpha:]][[:alpha:]-]*$';
  SELECT coalesce(jsonb_agg(jsonb_build_object('name',name,'terms',terms,'kind',kind)),'[]') INTO aliases FROM customs_commercial_terms(normal);
  IF NOT mixed AND normal ~ '\m(et|avec)\M|[;+,]' THEN
   -- Explicitly separated product heads count even outside the curated aliases.
   -- Materials, colours and compatibility text alone are never product heads.
   product_families:='{}';
   FOR fragment IN SELECT value FROM regexp_split_to_table((regexp_split_to_array(normal,'\mcompatible\M'))[1],'\m(et|avec)\M|[;+,]') value LOOP
    SELECT coalesce(array_agg(DISTINCT name),'{}') INTO fragment_families FROM customs_commercial_terms(fragment||CASE WHEN fragment ~ '^ *coques? *$' AND normal ~ '\m(smartphone|iphone|telephone)' THEN ' telephone' ELSE '' END) WHERE kind='product';
    IF cardinality(fragment_families)>0 THEN product_families:=product_families||fragment_families;
    ELSE
     SELECT term INTO fragment_anchor FROM regexp_split_to_table((regexp_split_to_array(fragment,'\mpour\M'))[1],'[^[:alpha:]-]+') WITH ORDINALITY word(value,pos)
      CROSS JOIN LATERAL unnest(customs_suggestion_terms(word.value)) term
      WHERE NOT term=ANY(stop_terms||modifier_terms) ORDER BY word.pos,term LIMIT 1;
     IF fragment_anchor IS NOT NULL AND EXISTS(SELECT 1 FROM customs_tariffs t WHERE t.source_status='reference' AND t.destination_code=p_destination AND t.suggestion_vector @@ to_tsquery('french',quote_literal(fragment_anchor)) AND fragment_anchor=ANY(customs_suggestion_terms(split_part(t.suggestion_text,' ',1)))) THEN product_families:=array_append(product_families,fragment_anchor);END IF;
    END IF;
   END LOOP;
   SELECT count(DISTINCT family)>1 INTO mixed FROM unnest(product_families) family;
  END IF;
  SELECT coalesce(array_agg(plainto_tsquery('french',customs_search_text(v->>'terms'))::text),'{}') INTO product_queries FROM jsonb_array_elements(aliases) v WHERE v->>'kind'='product';
  SELECT coalesce(array_agg(DISTINCT term),'{}') INTO all_terms FROM unnest(raw_terms||coalesce((SELECT array_agg(term) FROM jsonb_array_elements(aliases) v CROSS JOIN LATERAL unnest(customs_suggestion_terms(v->>'terms')) term),'{}')) term;
  negative_terms:=customs_negated_terms(normal);
  SELECT coalesce(array_agg(term),'{}') INTO query_materials FROM unnest(all_terms) term WHERE term=ANY(material_terms);
  candidates:='[]';
  IF NOT mixed AND NOT ambiguous AND (cardinality(anchors)>0 OR cardinality(product_queries)>0) THEN
   IF cardinality(product_queries)>0 THEN primary_anchor:=NULL;lookup:=to_tsquery('french',array_to_string(product_queries,' | '));
   ELSE
    -- The first meaningful product word must match. Adjectives/materials/brand
    -- fragments cannot independently retrieve an unrelated object.
    SELECT term INTO primary_anchor FROM regexp_split_to_table(normal,'[^[:alpha:]-]+') WITH ORDINALITY word(value,pos)
     CROSS JOIN LATERAL unnest(customs_suggestion_terms(word.value)) term
     WHERE term=ANY(anchors) ORDER BY word.pos,term LIMIT 1;
    lookup:=to_tsquery('french',quote_literal(primary_anchor));
   END IF;
   WITH matched AS (
    SELECT t.*,
     (SELECT count(*) FROM unnest(raw_terms) term WHERE t.suggestion_vector @@ to_tsquery('french',quote_literal(term))) raw_hits,
     (SELECT count(*) FROM unnest(all_terms) term WHERE t.suggestion_vector @@ to_tsquery('french',quote_literal(term))) all_hits,
     (SELECT (v->>'name')||' → '||(v->>'terms') FROM jsonb_array_elements(aliases) v WHERE v->>'kind'='product' AND t.suggestion_vector @@ plainto_tsquery('french',customs_search_text(v->>'terms')) AND customs_product_label_matches(v->>'name',t.label) ORDER BY v->>'name',v->>'terms' LIMIT 1) commercial_match
    FROM customs_tariffs t WHERE t.destination_code=p_destination AND t.source_status='reference' AND t.suggestion_vector @@ lookup
     AND (primary_anchor IS NULL OR primary_anchor=ANY(customs_suggestion_terms(split_part(t.suggestion_text,' ',1))))
     AND NOT (cardinality(query_materials)>0
      AND EXISTS(SELECT 1 FROM unnest(material_terms) term WHERE t.suggestion_vector @@ to_tsquery('french',quote_literal(term)))
      AND NOT EXISTS(SELECT 1 FROM unnest(query_materials) term WHERE t.suggestion_vector @@ to_tsquery('french',quote_literal(term))))
     AND NOT EXISTS(SELECT 1 FROM unnest(query_materials) term WHERE term=ANY(customs_suggestion_terms(substring(customs_search_text(t.label) FROM length(t.suggestion_text)+1))) AND NOT t.suggestion_vector @@ to_tsquery('french',quote_literal(term)))
     AND NOT (normal ~ '\msavon\M.*\msolide\M' AND t.suggestion_text ~ '\m(liquides?|pateux)\M')
     AND (cardinality(product_queries)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(aliases) v WHERE v->>'kind'='product' AND t.suggestion_vector @@ plainto_tsquery('french',customs_search_text(v->>'terms')) AND customs_product_label_matches(v->>'name',t.label)))
     -- A positive query never matches its explicit negative counterpart and vice versa.
     AND NOT EXISTS(SELECT 1 FROM unnest(customs_negated_terms(t.suggestion_text)) term WHERE term=ANY(all_terms) AND NOT term=ANY(negative_terms))
     AND NOT EXISTS(SELECT 1 FROM unnest(negative_terms) term WHERE t.suggestion_vector @@ to_tsquery('french',quote_literal(term)) AND NOT term=ANY(customs_negated_terms(t.suggestion_text)))
     -- An EX rate is suggested only when its distinctive printed criteria are present.
     AND (coalesce(t.conditions,'') NOT LIKE 'EX :%' OR NOT EXISTS(
      SELECT 1 FROM unnest(customs_suggestion_terms(regexp_replace(t.suggestion_text,'\([^)]*\)',' ','g'))) term
      WHERE NOT term=ANY(stop_terms) AND NOT term=ANY(all_terms)))
   ), ranked AS (
    SELECT *,raw_hits*4+all_hits*2+CASE WHEN category_code IS NOT NULL AND code LIKE category_code||'%' THEN 1 ELSE 0 END relevance,
     ts_rank_cd(suggestion_vector,lookup,2) lexical_rank FROM matched
   ), chosen AS (
    SELECT * FROM ranked ORDER BY relevance DESC,lexical_rank DESC,source_date DESC,code,id LIMIT 5
   )
   SELECT coalesce(jsonb_agg((to_jsonb(chosen)-ARRAY['suggestion_text','suggestion_vector','raw_hits','all_hits','commercial_match','relevance','lexical_rank'])||jsonb_build_object('matchReason',
    CASE WHEN commercial_match IS NOT NULL THEN 'Vocabulaire du produit rapproché du libellé : '||commercial_match||'.' ELSE 'Mots du produit retrouvés dans le libellé officiel.' END||CASE WHEN category_code IS NOT NULL AND code LIKE category_code||'%' THEN ' Code de catégorie cohérent ('||category_code||').' ELSE '' END) ORDER BY relevance DESC,lexical_rank DESC,source_date DESC,code,id),'[]') INTO candidates FROM chosen;
  END IF;
  answer:=answer||jsonb_build_array(jsonb_build_object('lineId',item->>'lineId','candidates',candidates,'status',CASE WHEN jsonb_array_length(candidates)>0 THEN 'suggestions' ELSE 'no_match' END,'requiresReview',true,
   'notice',CASE WHEN mixed THEN 'Cette ligne semble regrouper plusieurs produits différents. Séparez les articles avant de les classer.' WHEN jsonb_array_length(candidates)=0 THEN 'Aucune correspondance suffisamment précise. Précisez le produit ou recherchez dans le catalogue.' ELSE 'Vérifiez matière, usage et conditions ; aucune classification n’est enregistrée.' END));
 END LOOP;
 RETURN answer;
END; $$;
REVOKE ALL ON FUNCTION customs_positive_label(text),customs_suggestion_terms(text),customs_negated_terms(text),customs_commercial_terms(text),customs_product_label_matches(text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION suggest_customs_tariffs(jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION suggest_customs_tariffs(jsonb,text) TO authenticated;
