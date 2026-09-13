# Audit logique — devis, documents, paiement et reprise

Audit en lecture seule du commit `da51429`, le 11 septembre 2026. Aucun changement applicatif, migration ou déploiement. Vérification du code actuel, de son mapping et des dernières fonctions SQL, puis reproduction dans Chromium sur `127.0.0.1:4175` avec API fictive et dans PostgreSQL 17 isolé sans réseau. Toutes les migrations du dépôt ont été rejouées ; les transactions de preuve ont été annulées. Aucun appel PayPlug ni donnée de production.

P1 : prix ou données métier susceptibles d’être erronés. P2 : parcours bloqué, ambigu ou travail à recommencer. Les sept constats ci-dessous distinguent les bugs reproduits du garde métier manquant.

1. **P1 — Une facture rejetée peut continuer à augmenter les taxes après son remplacement. Bug reproduit.**

   Scénario : des articles ont été importés depuis une facture ; l’équipe la rejette, puis le client suit la consigne du portail et dépose sa correction. Ce dépôt crée une autre facture. Une fois cette correction validée et ses articles importés, les articles de la facture rejetée restent présents.

   Attendu : identifier explicitement le remplacement et exclure ou réconcilier les anciens articles avant publication. Actuel : le moteur ignore la facture rejetée dans les justificatifs, mais inclut **toutes** les lignes du dossier dans la base taxable. Le SQL fait de même. La divergence entre total des factures et des articles produit seulement un avertissement ; supprimer manuellement les anciennes lignes reste possible.

   **Preuve moteur + PostgreSQL :** facture active 100 €, anciennes lignes 100 € et nouvelles lignes 100 € → marchandises 200 €, devis accepté **68,63 €**, au lieu de **55,06 €** avec le seul article correct. Surcoût : **13,57 €**. Les dimensions, tarifs et catégories sont identiques entre les deux calculs.

   Sources : `FacturesPanel.jsx:152,162,203` ; `domain/quote.js:58,69,118` ; `20260910000019_quote_reception_coverage.sql:21–25`. **Limite vérifiée :** réimporter de l’OCR sur la même facture est déjà protégé par la suppression de ses anciennes lignes OCR (`20260910000003_telegram_ocr_jobs.sql:42`). Le défaut démontré concerne une nouvelle facture de remplacement, avec un autre identifiant.

2. **P1 — Une préparation ouverte peut écraser les nouvelles mesures enregistrées par un collègue. Bug reproduit.**

   Scénario : A ouvre un dossier dont le poids final est 3 kg ; B le corrige à 9 kg. A reçoit bien la mise à jour du dossier, mais son formulaire conserve 3 kg. A enregistre ensuite le devis.

   Attendu : conserver la version sur laquelle A a commencé sa saisie, signaler le conflit et demander une reprise explicite. Actuel : les champs finaux ne sont réinitialisés qu’au changement d’identifiant de dossier. Le provider associe ces anciennes valeurs au **nouvel** `updated_at` du cache. La protection SQL contre les écritures concurrentes reçoit donc une version valide et accepte l’écrasement.

   **Preuve Chromium :** notification Realtime injectée, relecture réelle du provider, champ restant à 3 ; RPC envoyé avec `finP=3` et `p_expected_updated_at=2026-09-11T09:00:00Z`, version du collègue. **Preuve PostgreSQL :** 9 kg deviennent 3 kg avec cet usage du contrat SQL. Aucune erreur n’est affichée. Les frais et modalités locales utilisent la même logique de formulaire.

   Sources : `StaffDetailView.jsx:181,207–223,305–310` ; `AppContext.jsx:813–815,835–843` ; `20260910000019_quote_reception_coverage.sql:9,14,62`.

3. **P1 — Le changement de destination après publication laisse un devis moderne payable sur son ancienne destination. Bug reproduit.**

   Scénario : un devis Réunion est envoyé, puis le code postal du client devient un code Mayotte. Le client paie son lien déjà reçu.

   Attendu : soit le dossier conserve explicitement sa destination contractuelle, distincte du profil, soit la modification invalide le devis à recalculer. Actuel : les écrans et opérations utilisent le profil client courant, mais le devis moderne et son intention de paiement restent actifs. La confirmation contrôle correctement montant, devise et version ; aucune de ces valeurs n’a changé, malgré la nouvelle destination.

   **Preuve PostgreSQL :** `cp=97400 → 97600`, snapshot destination `974`, devis et intention toujours version 7 ; confirmation du fournisseur correspondant acceptée à **55,06 €**, statut `paye`, une écriture de paiement. Le test appelle uniquement le contrat SQL, sans simuler un encaissement fournisseur réel. Le webhook moderne transmet précisément ces champs après sa vérification PayPlug.

   Sources : `ClientProfil.jsx:31–38,77` ; `20260910000012_legacy_payplug_payments.sql:66–72` (invalidation limitée au registre historique) ; `20260910000002_application_commands.sql:193,208–214` ; `payplug-webhook/index.ts:38–43`. La modification du type client possède la même absence d’invalidation moderne, mais seule la destination a été reproduite jusqu’au paiement.

4. **P1 — Après un retour arrière et l’ajout d’un carton, les anciennes mesures finales restent considérées comme utilisables. Garde métier manquant, scénario reproduit.**

   Scénario : un premier devis est préparé ; le dossier revient à l’accord, reçoit un nouveau carton, obtient un nouvel accord et repart en préparation. Les anciennes dimensions après optimisation remplissent déjà les champs du nouveau passage.

   Attendu : conserver ces mesures dans l’historique tout en exigeant une nouvelle mesure, ou sa confirmation explicite, pour la nouvelle composition du dossier. Actuel : le retour arrière efface le devis mais garde les `fin*` ; le rattachement les préserve ; le calcul ne vérifie aucune fraîcheur de mesure liée à la composition. Il peut donc réutiliser le poids de l’ancien colis sans saisie supplémentaire.

   **Preuve PostgreSQL :** parcours complet autorisé `devis_envoye → en_preparation → autorise → ajout mesuré → mesure → nouvel accord → en_preparation`. Après ajout d’un carton de 20 kg, réception de deux cartons totalisant 23 kg, un nouveau devis pro à **34 €** est accepté avec les anciens `fin*=40×30×20 cm / 3 kg`. Ce test établit l’absence de contrôle de reprise ; il ne propose pas de recopier les dimensions de réception dans les dimensions finales.

   Sources : `20260910000006_permissions_corrections.sql:38–44` ; `20260910000018_reception_measurements.sql:35–44,74–75` ; `StaffDetailView.jsx:212` ; `domain/quote.js:50–56` ; `20260910000019_quote_reception_coverage.sql:14–16`.

5. **P2 — Les mesures finales ne peuvent pas être sauvegardées tant que les pièces du devis sont incomplètes. Bug de parcours reproduit.**

   Scénario : le préparateur a terminé l’optimisation et mesuré le colis, mais attend encore une facture ou une catégorie à valider. Attendu : enregistrer le travail physique indépendamment de la validation commerciale du devis. Actuel : les quatre champs ne sont sauvegardés qu’avec le devis, dont le bouton reste désactivé si les justificatifs/articles ne sont pas complets. Quitter le dossier perd les valeurs.

   **Preuve Chromium :** saisie `45×25×20 cm / 4 kg`, aucune facture/article ; sauvegarde désactivée, **zéro requête d’écriture**, réouverture avec quatre champs vides et `fin_p=null` dans la fixture. Cela oblige l’équipe à attendre les pièces ou à conserver les mesures ailleurs.

   Sources : `StaffDetailView.jsx:305–310,515–518,556` ; `domain/quote.js:58–80`. À traiter séparément de la publication : un brouillon physique incomplet ne doit pas rendre un devis envoyable.

6. **P2 — Une correction documentaire invalide correctement le paiement, mais laisse les écrans à l’étape « paiement attendu ». Bug de reprise reproduit.**

   Scénario : après publication, le client dépose un nouveau justificatif, opération autorisée par le portail. Attendu : afficher « devis à recalculer » et une action de reprise pour l’équipe ; ne plus demander au client de payer le devis retiré. Actuel : total et lien sont supprimés, mais le statut reste `devis_envoye` ou `attente_paiement`. L’équipe voit toujours « En attente de paiement », le client « Devis reçu — en attente de paiement », sans devis payable ni bouton direct de recalcul.

   **Preuves PostgreSQL et Chromium :** document ajouté à un devis publié → `devis_total=null`, `devis_brouillon=true`, lien nul, statut `devis_envoye`. Les deux interfaces gardent l’intitulé de paiement ; aucun bouton de recalcul dans ce bloc. L’équipe peut passer par « Corrections » et un retour arrière si elle détient la permission correspondante : la récupération existe, mais le parcours ne l’indique pas.

   Sources : `FacturesPanel.jsx:109,152` ; `20260910000004_quote_integrity.sql:15–25` ; `StaffDetailView.jsx:332,563–616,839` ; `domain/clientJourney.js:41–42`. **Protection vérifiée :** `version_quote()` incrémente bien la version lors de cette invalidation et rend l’ancienne intention obsolète ; aucun défaut de confirmation d’un ancien montant n’est allégué ici.

7. **P2 — Un article manuel lié à sa facture peut nécessiter deux sauvegardes successives du devis. Bug de mapping reproduit.**

   Scénario : saisir un article, choisir sa facture source et calculer avant le prochain rafraîchissement temps réel. Attendu : le record retourné immédiatement conserve son lien à la facture. Actuel : `insertLigne` écrit bien `facture_id`, mais omet `factureId` dans l’objet retourné. Le premier snapshot contient donc un article sans facture. La relecture après sauvegarde rétablit le lien, change l’empreinte du devis et retire l’action d’envoi. Une deuxième sauvegarde remet les objets en cohérence.

   **Preuve Chromium :** facture liée dans la base fictive, `factureId=null` dans le premier RPC ; bouton « Envoyer » absent après ce premier succès ; deuxième RPC avec le bon identifiant, bouton présent. Aucun échec réseau ou erreur console. Ce cas dépend du rafraîchissement et explique un besoin de recalcul sans modification visible.

   Sources : `lib/supabaseData.js:189–197,674–694` ; `StaffDetailView.jsx:310–311,322–328,556` ; `AppContext.jsx:847,868–875`.

Les chemins JSX/domain/context/lib sont relatifs à `pinta/src/expedile/`, les migrations à `pinta/supabase/migrations/`, le webhook à `pinta/supabase/functions/`.

Les configurations SMTP et PayPlug réel déjà signalées sont des dépendances externes distinctes, non rediagnostiquées à distance durant cet audit. Le paiement pro à 30 jours/fin de mois mérite une décision métier sur l’expédition à crédit et le suivi d’échéance ; aucune nouvelle anomalie de rappel pro n’est affirmée, puisque l’automate exclut explicitement ces relances. L’OCR confirmé pour un même document, le verrou de version documentaire, les remboursements PayPlug et l’idempotence des paiements ne sont pas remis en cause par ces constats.

Preuves temporaires conservées pour la revue du chef d’ingénierie : `/tmp/pinta-audit-browser.json` (3 scénarios), `/tmp/pinta-audit-invalidation-browser.json` (2 vues), `/tmp/pinta-audit-sql.log` (7 observations, référence de calcul comprise), `/tmp/pinta-audit-devis.sql` et les scripts temporaires Chromium/SQL. Aucune de ces fixtures n’a été écrite dans les tables distantes.
