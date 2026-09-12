# Audit logique backend — 11 septembre 2026

Revue du code courant et des migrations jusqu’à `20260910000019`, limitée aux parcours équipe, Telegram et départs. **Aucune modification de l’application, des migrations ou de la production.** Les cas Telegram et export ci-dessous ont été reproduits avec le code réel exécuté localement, une base et des fournisseurs simulés. Les autres constats résultent de la lecture croisée des écrans, accès aux données, commandes et déclencheurs SQL ; ils ne constituent pas une observation des dossiers réels.

Pour une équipe de 3 à 5 personnes, les priorités sont les rattachements fiables, une seule validation du départ et des documents correspondant au chargement effectif. P1 signifie à corriger avant de s’appuyer sur le parcours à grande échelle ; P2 signifie une incohérence de suivi à planifier ensuite.

## 1. P1 — Une réponse Telegram peut être enregistrée dans le mauvais dossier

**Scénario :** un client a un dossier A livré et un dossier B encore actif. Dans Telegram, il répond à un ancien message concernant A, sans retaper la référence.

**Actuel :** le webhook choisit immédiatement B, parce qu’il n’existe qu’un dossier actif. Il ne cherche le message auquel le client répond que si aucun dossier n’a déjà été choisi. Le message apparaît dans B et y rouvre le travail de l’équipe ; la confirmation au client mentionne aussi B.

**Attendu :** donner priorité à la référence du message auquel le client répond, avec vérification d’appartenance, y compris pour un dossier livré. Si le rattachement n’est pas possible, conserver une demande à attribuer.

**Preuve :** [telegram-webhook/index.ts, lignes 45–59](../pinta/supabase/functions/telegram-webhook/index.ts#L45). Reproduction du véritable handler : HTTP 200, message inséré dans B, **aucune recherche du message original** et aucune entrée dans la boîte à attribuer.

## 2. P1 — Un document Telegram envoyé après paiement échoue sans parvenir à la file de travail

**Scénario :** après paiement, le client transmet un justificatif complémentaire ou une photo pendant le suivi de son dossier.

**Actuel :** toute photo ou pièce jointe est traitée comme une nouvelle facture. Le fichier est téléversé, puis la création de facture est refusée par la protection des dossiers payés. Le webhook renvoie HTTP 500 et marque l’événement en échec ; aucun message ni entrée à attribuer n’est créé et le client ne reçoit pas d’explication métier. Une nouvelle livraison du même événement peut rencontrer exactement le même refus.

**Attendu :** conserver la pièce comme document de conversation à traiter, sans modifier le devis payé. La décision de l’utiliser comme facture doit rester distincte et autorisée. Une erreur métier définitive doit être présentée au client et à l’équipe, sans dépendre des répétitions du webhook.

**Preuve :** [telegramIncoming.ts, lignes 7–25](../pinta/supabase/functions/_shared/telegramIncoming.ts#L7), [garde des documents payés, ligne 20](../pinta/supabase/migrations/20260910000004_quote_integrity.sql#L20), [gestion d’échec du webhook, lignes 82–84](../pinta/supabase/functions/telegram-webhook/index.ts#L82). Reproduction avec le véritable handler et le refus SQL simulé : téléversement effectué, HTTP 500, événement `failed`, aucun message/inbox enregistré. L’immuabilité du devis payé est correcte ; le manque porte sur l’accueil du document.

## 3. P1 — Un ancien départ peut rester affecté après un nouvel accord

**Scénario :** un dossier déjà affecté revient en attente après ajout d’un carton. Entre-temps, son départ est passé, archivé ou sa destination ne correspond plus à celle du client. Le client donne son nouvel accord.

**Actuel :** la commande cherche correctement un prochain départ compatible, puis utilise `coalesce(envoi_id, departure)` : toute affectation existante l’emporte, sans revalidation. Le sélecteur au stade payé accepte également les départs `arrive` et les dates passées, puisqu’il exclut seulement `parti` et `archive`. Le bouton « Expédier » vérifie surtout la présence d’un identifiant.

**Attendu :** revalider destination, date et disponibilité du départ à chaque accord, affectation et expédition ; demander une réaffectation explicite lorsque l’ancien départ ne convient plus.

**Preuve :** [commande d’accord courante, lignes 61–65](../pinta/supabase/migrations/20260910000017_work_action_origin.sql#L61), [départs proposés et bouton d’expédition, lignes 623–674](../pinta/src/expedile/components/staff/StaffDetailView.jsx#L623). Le filtre de date de l’affectation automatique fonctionne pour un dossier **sans** envoi ; le défaut concerne la conservation d’un envoi existant et la sélection manuelle.

## 4. P1 — Le départ ENV et ses dossiers EXP n’ont pas de commande de départ commune

**Scénario :** le logisticien passe un départ de « Planifié » à « Parti », alors que certains dossiers sont payés, d’autres en préparation et un autre en attente de paiement.

**Actuel :** le menu autorise ce changement directement. `updateDeparture` modifie uniquement la ligne `envois`, sans contrôle de préparation de ses dossiers ni changement de leur statut. L’équipe peut donc voir un ENV parti et des EXP encore à préparer ; elle doit ensuite faire avancer chaque dossier séparément. Le statut ENV peut aussi être remis librement en arrière.

**Attendu :** une commande « Confirmer le départ » présentant les dossiers effectivement embarqués et ceux à reporter, puis enregistrant ensemble le départ et les changements de statut concernés. Les exceptions doivent rester explicites, sans imposer l’expédition automatique d’un dossier non prêt.

**Preuve :** [StaffSettings, lignes 106–109 et 269–291](../pinta/src/expedile/components/staff/StaffSettings.jsx#L106), [updateEnvoi, lignes 809–824](../pinta/src/expedile/lib/supabaseData.js#L809). Les déclencheurs sur `envois` génèrent la référence et mettent à jour `updated_at` ; le déclencheur d’agrégats fonctionne dans l’autre sens, des dossiers vers l’envoi. Aucune commande de confirmation groupée du départ n’a été trouvée.

## 5. P1 — Les exports d’un départ suivent les affectations, pas un chargement validé

**Scénario :** un dossier est annulé ou reporté tout en conservant son `envoi_id`. L’équipe exporte ensuite la liste, la facture commerciale ou les données douanières du départ.

**Actuel :** les trois exports reçoivent tous les dossiers affectés, sans filtre de statut. Un dossier annulé non archivé reste chargé dans les données et ses articles peuvent figurer dans les totaux. Après archivage d’un dossier, le même export historique peut au contraire perdre ce dossier, car le jeu de données courant exclut les archives. Il n’existe pas de photographie du chargement exporté.

**Attendu :** baser les documents de départ sur une liste d’embarquement validée, consultable indépendamment de l’archivage des dossiers, et signaler les dossiers exclus ou reportés.

**Preuve :** [sélection des exports, lignes 111–124](../pinta/src/expedile/components/staff/StaffSettings.jsx#L111), [chargement hors archives, lignes 258–260](../pinta/src/expedile/lib/supabaseData.js#L258), [exportDAU, lignes 23–65](../pinta/src/expedile/utils/exportDAU.js#L23). Reproduction de l’export réel : un dossier payé de 100 € et un dossier annulé de 999 € produisent une valeur totale de **1 099 €**.

**Unité à clarifier dans le même parcours :** `envois.nb_colis` est un `COUNT(*)` de dossiers et « Nb colis total » dans l’export est `colis.length` ([agrégats, lignes 106 et 119](../pinta/supabase/migrations/20260326173055_004_functions_triggers.sql#L106)). Ce n’est pas le nombre de cartons reçus ni un nombre de cartons sortants explicitement enregistré. Après optimisation, ces quantités peuvent différer : il faut définir le colis physique expédié, pas remplacer aveuglément ce compteur par la somme des cartons reçus.

## 6. P2 — Les transitions d’expédition et de livraison n’enregistrent pas leurs dates métier

**Scénario :** l’équipe clique successivement sur « Expédier », puis sur les étapes jusqu’à « Livré ».

**Actuel :** `changerStatut` écrit seulement `statut`. Le déclencheur opérationnel actualise `statut_updated_at`, mais aucun chemin de ce parcours ne renseigne `date_expedition` ou `date_livraison`. La chronologie client, qui utilise précisément ces dates, peut garder « Paiement reçu » comme dernier événement daté malgré un état livré. Le calcul historique du délai réception→livraison exclut ces dossiers sans date de livraison.

**Attendu :** horodater les événements métier au moment de leur confirmation et définir le comportement d’une correction de statut. Conserver les dates précédentes dans l’historique ; ne pas les inventer à partir de la dernière modification générale du dossier.

**Preuve :** [changerStatut, lignes 710–715](../pinta/src/expedile/context/AppContext.jsx#L710), [guard_operational_state, lignes 35–55](../pinta/supabase/migrations/20260910000014_conversation_workflow.sql#L35), [chronologie client, lignes 58–64](../pinta/src/expedile/domain/clientJourney.js#L58), [métrique SQL historique, lignes 70–73](../pinta/supabase/migrations/20260326173320_005_vues_metier.sql#L70). Recherche dans toutes les migrations et fonctions : aucune affectation de ces deux dates. Le KPI actuel du délai **d’accord client** est distinct et n’est pas concerné par ce constat.

## 7. P1 — Les permissions fines de gestion des envois ne correspondent pas aux opérations disponibles

**Scénario :** le directeur retire à un logisticien « Modifier un envoi » ou « Réaffecter un colis à un autre envoi », afin de réserver ces décisions à une autre personne.

**Actuel :** les droits existent et sont présentés comme configurables, mais la politique CRUD des envois vérifie seulement le rôle directeur/vice-directeur/logisticien. Le menu de statut des départs reste disponible. Pour l’affectation d’un dossier, le sélecteur modifie directement `envoi_id` ; la garde des mises à jour du dossier vérifie les changements de statut et de finances, sans vérifier la permission d’affectation pour ce champ.

**Attendu :** appliquer les permissions annoncées à la commande serveur et à son interface. Une permission retirée doit avoir un effet visible et réel ; il n’est pas nécessaire de retirer tout le rôle de logisticien pour empêcher une seule opération.

**Preuve :** [libellés de permissions, lignes 16 et 56–58](../pinta/src/expedile/constants/permissions.js#L16), [politique envois, lignes 126–129](../pinta/supabase/migrations/20260326173420_006_rls_policies.sql#L126), [sélecteur d’affectation, lignes 640–646](../pinta/src/expedile/components/staff/StaffDetailView.jsx#L640), [garde des modifications de dossier, lignes 26–38](../pinta/supabase/migrations/20260910000004_quote_integrity.sql#L26). Constat par lecture des politiques et des commandes actuelles, sans tentative sur des comptes réels.

## Vérification et limites

Les trois reproductions locales exécutent le véritable webhook Telegram et le véritable export DAU, avec des adaptateurs simulés et aucun accès réseau. Le script temporaire est `/private/tmp/pinta-audit-logique-backend.cjs` ; il n’est pas ajouté au code de l’application. Résultats : mauvais rattachement confirmé, pièce d’un dossier payé rejetée sans mise en file confirmée, dossier annulé inclus dans l’export confirmé. Pour le deuxième cas, le retour d’erreur de la base est simulé conformément à la garde SQL citée ; il ne s’agit pas d’un rejeu PostgreSQL effectué pendant cet audit.

Le cas envisagé d’une relance de paiement envoyée après invalidation d’une facture a été **écarté** : `version_quote` incrémente bien la version du devis et le dispatcher refuse l’ancienne version. Les cartons sans suivi sont désormais correctement listés dans le message de secours ; lecture et traitement des conversations sont déjà distincts. Ces points corrigés ne sont pas proposés à nouveau.

Le changement de destination/type après publication d’un devis, les factures corrigées et le calcul financier sont examinés dans la revue du responsable devis ; ils ne sont pas dupliqués ici. Les propositions de ce document sont des éléments de décision, pas des modifications appliquées.
