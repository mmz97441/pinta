# Matrice de recette indépendante — 21 septembre 2026

Lecture du code, sans validation de compréhension par un novice. Les scénarios ci-dessous doivent vérifier l’action et la requête métier produite, pas seulement un titre.

## Écarts constatés avant correction

1. **Devis prêt au statut autorise, écran bloqué.** `sync_staff_work_actions` (migration 20260916000001, lignes276–277) autorise la tâche quote sous autorise; `workActionUrl` mène à devis. `StaffDetailView:497` impose en_preparation et `dossierTasks:67` renvoie la consultation directe à préparation. Le rôle devis seul ne peut pas débloquer cela en commençant la préparation.
2. **Certificat de préparation défini différemment.** `dossierTasks:40–42`, `StaffDetailView:296` et le SQL sync:260–261 ne contrôlent pas tous compte sortant et validité de chaque colis, alors que `quote.js:76` bloque un compte sortant absent. Une tâche présentée prête peut ouvrir un devis bloqué ou une préparation faussement terminée.
3. **Pas de tâche opérationnelle paiement/livraison dans Mon travail.** WORK_KINDS et la synchronisation SQL possèdent reception, preparation, documents, conversation, quote, departure, correction; departure n’existe que sous paye. Après devis envoyé puis après départ, le suivi ne dispose pas d’une tâche dédiée à prendre. Les huit écrans restent navigables depuis le dossier. Décision de périmètre requise, pas une simple correction de lien.
4. **Retour transport avec commandes livraison.** `StaffDetailView:839–897` dépend de statut sans distinguer les écrans expedition/livraison : sous arrive/livraison, revenir au transport montre encore Lancer/Confirmer livraison. Une tâche consultée doit montrer ses propres faits et conduire explicitement à la tâche suivante.
5. **Anciennes informations client insuffisamment distinguées.** `ClientDetailView:579` montre les finalPackages conservés après reprise comme « Colis préparés pour l’envoi ». `clientJourney:64–69` peut choisir un ancien devis envoyé comme dernier événement pendant une nouvelle demande d’accord non envoyée. L’historique est conservé correctement mais son contexte mérite vérification.
6. **Réception mesurée, texte client contradictoire.** `ClientDetailView:187–189` utilise l’index de phase partagé par receptionne et mesure; sous mesure, le détail dit encore « en train de le mesurer » alors que l’état principal dit mesures enregistrées.
7. **Documents rejetés : route par défaut différente de la tâche quote.** `dossierTasks:45` renvoie vers documents dès qu’une facture actuelle est rejetée, tandis que quote.js et la synchronisation SQL excluent les factures rejetées du calcul. À vérifier avec une facture valide et une autre rejetée, pour conserver le choix métier explicite plutôt qu’un détour permanent.

## Recette équipe : huit écrans

| Écran | État normal et action utile | Retour/reprise | Droits et échec à vérifier |
|---|---|---|---|
| Réception | Saisir chaque carton, enregistrer; conserver EXP, quantité et suivis | Retour simple sans écriture; corriger une mesure après devis retire le devis et préserve factures/accord | Mesurer seul; aucune valeur ajoutée après refus serveur; cartons supplémentaires via réception dédiée |
| Accord | Mesures complètes→aperçu→envoi explicite→réponse client | Nouvelle génération, données anciennes conservées; ancien aperçu et ancien bouton Telegram refusés | Demander accord sans préparer; pause/refus visibles; consultation et échéance dépassée ne donnent jamais accord |
| Préparation | Accord→mesures finales indépendantes des factures | Autorise avec certificat actuel affiche un résultat utilisable; compte/version manquants imposent certification | Préparateur seul peut terminer; ne calcule ni n’envoie devis; saisie conservée après conflit |
| Factures | Valider plusieurs factures séparément, contrôler doublons et totaux | Consultation de factures validées; remplacement puis nouvelle vérification; mesure finale reste indépendante | Vérificateur sans permission devis; avant accord et pendant préparation; facture invalide n’autorise aucun consentement |
| Devis | Factures et certificat prêts→sauvegarde valide→aperçu→envoi | Autorise certifié, anciennes dates de devis, reclassification, devis retiré, recalcul après reprise | Devis seul sans préparer; envoi seul sans calculer; pas de sauvegarde avec compte absent ou certificat périmé |
| Paiement | Devis envoyé→lien actuel ou modalités professionnelles→règlement confirmé | Ancien lien annulé, nouveau devis attendu; conflit après annulation annoncé séparément | Confirmer réception réservé; jamais confirmer par simple navigation; paiement reçu interdit correction destructive |
| Expédition | Paiement→départ compatible→manifeste→confirmation de départ | Consultation après arrivée ne propose pas directement une nouvelle commande livraison; correction transport garde traces | Affecter vs réaffecter; date de départ passée; manifeste verrouillé; nombre physique et poids exacts |
| Livraison | Arrivée→livraison→confirmation complète, date enregistrée | Retour transport/historique sans état modifié; livré reste consultable | Droit logistique requis; pas de livraison avant départ; dossier archivé/annulé ne propose pas d’avancement |

## Recette des entrées et du côté client

| Cas concret | Résultat à établir |
|---|---|
| Chaque action Mon travail, libre puis attribuée | Un clic de prise de tâche affecte seulement la tâche; le lien ouvre le bon écran avec retour aux filtres conservé |
| Autorise + certificat actuel + factures valides | La tâche quote et consultation directe aboutissent au devis utilisable, même pour rôle devis seul |
| Même état avec ancien devis_envoye_le | L’ancien historique ne masque ni action actuelle ni préparation déjà certifiée |
| Compte sortant absent, incorrect, versions différentes, tableau final vide | Aucun devis sauvable; lien de sortie mène à une préparation réellement utilisable par l’opérateur habilité |
| Parcours séquentiel normal, desktop et mobile | Réception→demande→accord client→préparation et factures→devis→paiement→départ→livraison, uniquement par commandes explicites |
| Flèches et liste de tâches à chaque étape | Aucun changement état/accord/paiement/messages, même après retour arrière puis avant |
| Accueil client, liste et carte | Même prochaine action; bouton facture ouvre factures, bouton répondre ouvre conversation, expédition ouvre suivi |
| Pause volontaire avec échéance passée | Toujours en attente; correction facture et réponse restent possibles sans approbation implicite |
| Refus, puis nouvel accord préparé mais pas envoyé | Aucun bouton d’approbation nouvelle génération tant que demande non envoyée; historique ancien clairement séparé |
| Devis retiré après envoi, avec ancien lien présent dans historique | Aucune demande de paiement de l’ancien montant; aperçu/PDF actuel inaccessible jusqu’à nouvelle publication |
| Paiement pro/test/clé absente | Modalités exactes; aucun changement silencieux de mode ni faux succès d’envoi |
| Suivi expédié→transit→douane→arrivé→livré | Référence sortante visible; anciens suivis fournisseurs secondaires; aucune date future ou promesse inventée |
| Archive/annulation/payé vus côté client et équipe | Consultation conservée, actions interdites réellement absentes ou expliquées; aucune mutation par ouverture |
| Anciennes dates, ancien snapshot, colis préparés historiques | Informations archivées ne deviennent pas des preuves de préparation, accord ou paiement du cycle courant |

## Vérifications transversales

Pour chaque mutation: CAS et rôle vérifiés dans la fixture stricte; seules les commandes autorisées acceptées. Pour chaque navigation: comparaison du dossier, des messages et des factures avant/après. Vérification commune desktop1440 et mobile390, absence de débordement, aucun service externe. Les guards SQL/Edge font l’objet de suites séparées; une fixture navigateur ne les démontre pas.

## Contrat retenu pour ce lot

Le certificat physique exige des versions de composition non nulles et égales, 1 à 100 colis finaux aux mesures positives, et un nombre sortant exactement égal au nombre de colis. Le tableau NULL historique peut utiliser les quatre mesures scalaires et un nombre sortant de 1; un tableau vide explicite reste incomplet. La date de mesure n’est pas une condition supplémentaire.

Les huit écrans restent accessibles par navigation explicite. Le lot ne crée pas de nouveaux types de tâches paiement ou livraison dans Mon travail. Une préparation ancienne peut être recertifiée sans changer artificiellement les mesures, avec le droit de correction si un devis historique existe.

La recette navigateur nouvelle est `pinta/tests/task-readiness.browser.cjs` (20 scénarios exécutés avec succès); les résultats d’exécution seront consignés dans le rapport d’intégration. Cette matrice décrit aussi des vérifications couvertes par les suites existantes : elle ne prétend pas que chaque ligne est un nouveau test exécuté.

## Résultats de ce lot

- 20/20 scénarios navigateur réussis sur le build local central du 21 septembre (desktop 1440 et mobile 390). Réception, vérification de deux nouvelles factures, demande explicite, accord dans un autre contexte client, préparation, sauvegarde/envoi du devis, règlement professionnel, départ avec manifeste, transport et livraison sont réellement parcourus par les boutons.
- Les commandes fictives contrôlent révision attendue, accord, versions de préparation, nombre sortant, factures, montant, permissions, date de départ et contenu du manifeste. La navigation sur les huit tâches ne modifie pas le dossier, les factures ou les messages. Les services externes restent interceptés.
- 14 tests de domaine/rendu client ciblés réussis; la validation globale de l’intégration est suivie dans le rapport principal.
- Captures des huit écrans desktop/mobile et de l’accord/livraison client dans `/tmp/pinta-task-readiness/`; résultats dans `results.json`, journal `/tmp/pinta-task-readiness-final.log`. Inspection visuelle effectuée, aucun débordement horizontal observé. Les captures client peuvent saisir une animation d’entrée; le runner désactive désormais les animations lors de la capture pour la prochaine recette.

Deux formulations repérées pendant cette inspection ont été remontées à l’intégrateur : ne pas annoncer une composition « changée » à la toute première préparation; ne pas annoncer une notification transmise quand seul un brouillon email manuel a été ouvert. La recette automatisée ne démontre pas la compréhension par un novice; un essai accompagné avec de vrais opérateurs reste nécessaire pour mesurer celle-ci.
