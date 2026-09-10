**Audit d’Expedîle — améliorer le travail de l’équipe et l’expérience client**

Analyse du 10 septembre 2026, sur le commit `7938b30` de la branche locale `claude/design-system-comfort`. Contexte fourni par le dirigeant : équipe de 3 à 5 personnes, environ 1 000 clients et 1 000 colis par mois. Les principaux freins sont la communication, l’attente de l’accord de préparation et l’établissement des devis.

**La priorité produit est de raccourcir le parcours « colis reçu → dossier complet → décision client → devis fiable ».** L’application dispose déjà des principales briques. Le travail prioritaire consiste à les relier et à rendre leurs résultats fiables. À ce volume, chaque minute de manipulation supprimée par colis représente environ 16,7 heures par mois. Ce calcul est un potentiel arithmétique, pas une mesure des gains actuels.

**Périmètre et niveau de preuve.** Lecture du frontend, des fonctions serveur et des 11 migrations SQL ; inspection de l’historique ; vérifications navigateur sur le build local, en bureau et en mobile ; exécution isolée de fonctions existantes avec dépendances simulées ; comparaison avec les documentations officielles PayPlug et Supabase. Tous les comptes, colis et documents utilisés pour les scénarios sont fictifs. Les requêtes externes du navigateur ont été interceptées. Aucune donnée de production, aucun envoi client et aucun paiement réel n’ont été utilisés. Les secrets, politiques et cron réellement déployés n’ont pas été inspectés : les conclusions sur leur déploiement restent à vérifier. Les fichiers de l’application n’ont pas été modifiés.

Les preuves sont conservées dans [le dossier de vérification](audit-expedile-2026-09-10/). Les mentions **reproduit** concernent un scénario local ; **code** une observation statique ; **déploiement à vérifier** une propriété dépendant de la configuration distante.

**1. Les constats qui expliquent les frictions actuelles.**

| Priorité | Constat vérifié | Effet concret | Correction attendue |
|---|---|---|---|
| P0 | L’éditeur affiche « Sauvegardé », sans requête de sauvegarde ; le texte initial revient après navigation. **Reproduit.** | L’équipe pense avoir modifié ses messages, mais continue à envoyer les modèles codés en dur. | Modèles persistés, versionnés et utilisés par le même moteur d’envoi. |
| P0 | Le webhook PayPlug attend un objet complet et une signature HMAC facultative. Une notification au format officiel est ignorée, ou rejetée si le secret HMAC est configuré. **Reproduit avec une notification synthétique.** | Un paiement peut ne pas faire avancer le colis ; le personnel doit vérifier et corriger. | Relire le paiement chez PayPlug, contrôler montant/devise/environnement/dossier, puis enregistrer une seule fois le règlement. |
| P0 | Plusieurs créations et modifications continuent localement après échec de sauvegarde. **Code.** | Un colis, un document ou un statut peut sembler enregistré puis disparaître au rafraîchissement. | Résultat confirmé par le serveur ; erreur récupérable ; saisie conservée ; aucune notification de réussite avant confirmation. |
| P0 | L’identité des fonctions sensibles repose notamment sur un secret présent dans le frontend et, pour créer le personnel, un identifiant appelant fourni dans un header. **Code ; exposition distante à vérifier.** | Les permissions ne reposent pas toutes sur une identité serveur vérifiée. | Authentification du demandeur et contrôle métier côté serveur, droits limités par action. |
| P1 | Le choix Telegram « j’attends » écrit deux champs qui ne sont ni lus par l’interface ni pris en compte par les relances. **Code.** | Un client qui attend volontairement ressemble à un client qui ne répond pas. | Motif d’attente, prochaine date d’action et conditions de reprise visibles et persistés. |
| P1 | Les paramètres annoncent des relances à J+2/J+5/J+7, mais restent en mémoire ; la fonction automatique traite J+20/J+30/J+60 depuis la première réception. **Code.** | La vraie relance arrive tard et ne correspond pas au paramétrage visible. | Un planificateur unique, piloté par l’événement « demande envoyée » et par l’état du dossier. |
| P1 | Les durées et frais de stockage divergent entre paramètres, modèles et fonction de relance : 14, 20 ou 30 jours selon l’endroit. **Code.** | Messages contradictoires et discussions évitables. | Règles commerciales versionnées par offre et date d’effet, injectées partout. |
| P1 | La fonction de devis accepte un article sans catégorie avec OM/OMR à zéro. Un scénario pro, sans changement de dimensions, affiche 3,40 € d’économie fictive sur 40 € de transport. **Reproduit.** | Le personnel doit contrôler et expliquer des résultats incohérents. | Un seul moteur de calcul, données complètes, comparaison avant/après à règles identiques. |
| P1 | L’OCR insère directement des lignes dans le dossier ; il ne déduplique pas par facture et ne conserve pas de lien de provenance sur ces lignes. **Code.** | Une nouvelle analyse peut ajouter les mêmes articles ; les contrôles sont manuels. | Extraction en brouillon, identification du document, validation puis intégration une seule fois. |
| P1 | Le parcours de connexion retourne l’interface personnel pour un utilisateur de rôle client ; après rafraîchissement, le formulaire de connexion revient. **Reproduit avec authentification simulée.** | Le portail client ne fournit pas un parcours d’accès normal et durable. | Restaurer la session et résoudre le profil côté serveur, puis ouvrir l’espace adapté. Cela ne prouve pas un accès aux données interdites par RLS. |
| P1 | Les notifications client restent initialisées à une liste vide ; les fonctions de chargement et d’abonnement disponibles ne sont pas appelées par le contexte. **Code.** | L’espace client ne reflète pas les événements attendus. | Notifications dérivées des événements métier, chargées et mises à jour. |
| P1 | Les requêtes chargent les colis, factures, lignes et messages sans pagination ; chaque modification temps réel de colis relance le chargement complet. **Code.** | Historique incomplet possible, transferts superflus et compteurs trompeurs avec la croissance des données. | Listes paginées, recherche serveur, détail chargé à l’ouverture et compteurs calculés en base. |
| P1 | Sur un écran de 390 px, le panneau de préparation reste large de 540 px : champs et montants sont coupés. **Reproduit et inspecté visuellement.** | Utilisation difficile au poste de travail mobile. | Détail sur toute la largeur disponible, formulaire adapté et action principale accessible. |

Preuves principales : [modèles](../pinta/src/expedile/components/staff/TemplateEditor.jsx), [contexte et actions métier](../pinta/src/expedile/context/AppContext.jsx), [relances](../pinta/supabase/functions/relances-auto/index.ts), [réponses Telegram](../pinta/supabase/functions/telegram-webhook/index.ts), [paiements](../pinta/supabase/functions/payplug-webhook/index.ts), [extraction OCR](../pinta/supabase/functions/ocr-facture/index.ts), [chargement des données](../pinta/src/expedile/lib/supabaseData.js), [panneau de préparation](../pinta/src/expedile/components/staff/StaffSplitView.jsx).

PayPlug documente une notification identifiant la ressource à relire par HTTPS ; le serveur doit récupérer cette ressource pour en vérifier l’authenticité. Le handler actuel utilise directement des champs du POST à la place de cette relecture. [Documentation officielle](https://docs.payplug.com/api/apiref.html#notifications).

Supabase documente un plafond de retour de 1 000 lignes par défaut, configurable. La limite réelle du projet n’est pas connue. Avec 1 000 colis mensuels, la pagination doit être vérifiée immédiatement, même si peu de clients se connectent simultanément. Les messages, triés du plus ancien au plus récent, sont particulièrement concernés. [Documentation Supabase](https://supabase.com/docs/reference/javascript/v1/select).

**2. La première transformation : une demande client complète et facile à traiter.**

À réception, regrouper l’information au niveau du client et du dossier de préparation : quels cartons sont arrivés, quels achats sont encore attendus, quelles factures manquent, quelle décision est demandée et ce qu’elle déclenche. Le client doit pouvoir répondre depuis un lien adapté au téléphone, accessible depuis Telegram ou email, sans reconstituer l’histoire dans plusieurs messages.

Proposition de message, à alimenter uniquement avec des données confirmées : « Bonjour Camille, vos 3 cartons sont arrivés. Il manque la facture du vendeur X. Vous pouvez la joindre ici et choisir : préparer ces cartons, attendre d’autres achats, ou poser une question. » Afficher une estimation seulement si les données permettent une estimation honnête, avec ses hypothèses. Le devis final reste établi après préparation et mesures finales.

| Décision ou situation | Ce que voit le client | Ce que fait le système | Ce que voit l’équipe |
|---|---|---|---|
| Préparer maintenant | Liste exacte des cartons concernés et portée de l’autorisation | Enregistre l’accord et sa version ; ouvre la tâche lorsque les prérequis sont remplis | Dossier prêt à préparer, avec casier et documents |
| Attendre d’autres achats | Date de réception prévue ou date de rappel choisie | Suspend les relances d’accord ; rappelle au bon événement | Attente volontaire, motif et échéance |
| Facture manquante | Nom du vendeur, document attendu et bouton d’ajout | Accuse réception du fichier ; analyse en arrière-plan | Document à valider ou anomalie à traiter |
| Question du client | Confirmation de prise en charge | Affecte une conversation à un membre de l’équipe | Réponse humaine attendue, contexte complet |
| Aucun retour | Rappel bref de l’action à faire | Relance selon une cadence bornée, puis crée une tâche humaine | Client sans réponse, dernière tentative et prochaine action |

Une arrivée supplémentaire ne doit pas être implicitement couverte par un ancien accord. L’accord doit porter sur un ensemble de cartons identifiable. Le silence ne vaut pas autorisation. Une autorisation permanente facultative pourra être étudiée ensuite pour les habitués : destination et périmètre précis, règles de regroupement, plafond explicite, possibilité de retrait avant engagement et nouvelle demande hors conditions.

Pour le pilote, tester une première relance après 24 heures ouvrées, puis une seconde après 72 heures, en heures convenues avec le client. Ces délais sont une hypothèse de départ, à ajuster sur les réponses mesurées. Arrêter les relances dès qu’une décision, une pause ou une conversation humaine active les rend inutiles. Regrouper les demandes par client pour éviter plusieurs rappels concurrents. Le créneau de départ sert à expliquer une vraie échéance, sans promettre une place non confirmée.

**3. La deuxième transformation : produire le devis à partir d’un dossier déjà préparé.**

L’IA doit retirer de la saisie et aider à repérer les anomalies. Le calcul financier doit rester déterministe, explicable et reproductible. La facture se traite dès sa réception, pendant que le client décide ou que l’équipe organise la préparation.

Le parcours cible est : document reçu → extraction en arrière-plan → contrôle du vendeur, des montants, des articles et des catégories → correction des seules anomalies → mesures finales → devis prérempli → validation et envoi.

L’écran de devis doit réunir les mesures, les articles, les justificatifs et le détail du prix. À gauche, les données physiques et les documents ; à droite, le total et les éléments à corriger. Sur mobile, ces blocs deviennent successifs. Les champs déjà connus ne sont pas ressaisis. Le bouton principal indique la prochaine tâche : « Joindre la facture », « Vérifier 2 articles », « Valider le devis ».

Les contrôles indispensables sont les suivants :

- Identifier chaque document et chaque version d’extraction ; relancer l’OCR ne doit pas doubler les articles.
- Conserver les lignes de facture et leur allocation aux dossiers/cartons. Une facture peut couvrir plusieurs colis ; un colis peut correspondre à plusieurs factures.
- Vérifier totaux, quantités, devise, taxes déjà présentes et cohérence entre document et articles. Une catégorie inconnue reste à vérifier ; elle n’est pas assimilée à une catégorie exonérée.
- Relier les catégories internes aux règles du transitaire et aux nomenclatures nécessaires. Faire valider les barèmes et leur application par le référent métier ; l’audit ne certifie pas les taux fiscaux du dépôt.
- Utiliser le même calcul pour le devis prospect, l’aperçu, le devis final, le PDF, le paiement et le message envoyé.
- Prendre explicitement en compte destination, transporteur, type de client, offre commerciale, frais applicables et date d’effet. Le calcul actuel du contexte sélectionne son tarif par destination ; l’abonnement du client n’intervient pas dans cette sélection.
- Versionner le devis et figer montants et hypothèses lors de l’envoi. Un paiement correspond à une version précise. Un changement de prix appelle une nouvelle version et un traitement explicite de l’ancien lien.

L’interface exige actuellement facture et articles pour activer l’aperçu, alors que le moteur prévoit une exception pro. Il faut décider la règle pro avec l’équipe, puis l’appliquer uniformément. Le calcul avant/après, le stockage et les frais doivent également utiliser la même règle ; ils ne doivent pas se contredire entre écrans.

Objectif initial à mesurer : moins de deux minutes d’intervention humaine pour un devis standard dont les documents et mesures sont complets. Il s’agit d’un objectif de pilote, pas d’une performance démontrée. Les dossiers atypiques restent traités explicitement par une personne.

**4. Organiser les 3 à 5 personnes autour des dossiers à faire avancer.**

L’accueil de l’équipe doit répondre à « que dois-je faire maintenant ? ». Garder les vues actuelles par étape et par départ, mais ajouter des files actionnables : réponses client à traiter, documents à vérifier, prêts à préparer, devis prêts à valider, règlements à rapprocher et départs à clôturer.

Chaque dossier présente son responsable, son blocage réel, son ancienneté dans cet état, la prochaine action et son échéance. Le tri tient compte d’abord des engagements et départs à risque, puis de l’âge du blocage ; le statut VIP ne doit pas masquer une urgence opérationnelle. Ajouter « prendre en charge » et « dossier suivant » pour enchaîner le travail. Une boîte de réception partagée par client, reliée aux dossiers concernés, évite de chercher les messages dans chaque colis.

Séparer l’état logistique et les blocages : un colis peut être physiquement reçu, autorisé, mais encore sans facture ; un autre peut avoir tous ses documents et attendre volontairement un achat supplémentaire. Un statut unique ne représente pas correctement toutes ces combinaisons.

Le verrou actuel est surtout un signal de présence : son `upsert` peut remplacer l’occupant. Pour empêcher les écrasements, utiliser une version du dossier contrôlée lors de la sauvegarde, avec message explicite si un collègue a modifié les données. Les opérations groupées doivent retourner un résultat par dossier, avec succès et échec réels. Aujourd’hui leur compteur peut être incrémenté même si l’action est refusée ou si la sauvegarde échoue.

La réception par scan et l’impression d’une étiquette interne sont une amélioration utile après les parcours communication/devis. Mesurer d’abord le gain avec une douchette existante ou un appareil disponible. L’identification des cartons, la photo et le casier doivent rester accessibles sans ressaisie.

**5. Ce que le client doit comprendre en quelques secondes.**

L’écran principal doit afficher : « vos achats reçus », « ce que nous faisons », « ce que vous devez faire », « le prix connu ou encore à confirmer » et « la prochaine date fiable ». Une seule action principale par situation. Montrer la dernière mise à jour et expliquer un retard lorsqu’il existe. Le suivi public actuel permet déjà une consultation par lien : en faire une porte d’entrée vers les actions autorisées, avec un mécanisme distinct et sécurisé pour les décisions.

Conserver Telegram pour les personnes qui l’utilisent ; rendre le même parcours disponible par email et sur le web. Mettre en place un envoi email serveur avec retour d’échec. Un `mailto:` prépare un message dans une messagerie : il ne prouve pas qu’il est parti. Distinguer demande mise en file, acceptée par le prestataire, échec et réponse reçue. Ne pas afficher « lu » sans signal réellement disponible.

Pour réduire l’hésitation, expliquer clairement le feu vert : il autorise la préparation de cartons identifiés ; préciser quand le prix final arrive et comment il sera réglé. Permettre au client de retrouver sa décision et de demander une modification tant que le traitement le permet. L’actuel bouton « contacter le support » pour révoquer l’accord ne fait qu’afficher un toast : il faut créer une demande ou ouvrir réellement le canal de contact.

**6. Les fondations techniques nécessaires sont compatibles avec la stack existante.**

React et Supabase peuvent rester le socle. Déplacer les actions métier critiques vers des commandes serveur qui vérifient identité, droits, état courant et version des données. Une transaction enregistre la décision, la transition, l’historique et le message à envoyer. Un traitement séparé exécute ensuite l’envoi ou l’OCR, avec reprise sur erreur et déduplication.

Supabase propose une file durable basée sur Postgres. Elle peut accueillir les travaux d’envoi et d’extraction ; la déduplication des effets externes reste à concevoir au niveau de l’application. [Documentation Supabase Queues](https://supabase.com/docs/guides/queues).

Un modèle cible minimal pourrait ajouter, progressivement : `client_requests` pour les décisions et attentes ; `document_extractions` pour les résultats à vérifier ; `quote_versions` pour les devis figés ; `outbound_messages` pour les envois et tentatives ; `tasks` pour le travail affecté. Conserver des clés de déduplication pour décisions, documents et événements de paiement. Ces noms sont des propositions d’implémentation, pas des tables existantes.

Avant migration, rapprocher le schéma déployé et les migrations : `staff_users`, `staff_permissions`, `audit_actions` et `colis_locks` sont utilisés, mais leur création n’apparaît pas dans les migrations du dépôt. Le trigger de transition SQL impose `devis_envoye → attente_paiement → paye`, alors que le frontend et le webhook passent directement de `devis_envoye` à `paye`. Le schéma versionné et les parcours ne sont donc pas cohérents sur ce point. Cela ne permet pas de conclure que la base distante utilise encore ce trigger.

Les contrôles d’accès demandent une vérification spécifique : les rôles sont lus depuis `user_metadata` dans l’interface ; les migrations autorisent la modification de son propre profil sans restriction de colonnes visible ; la création de personnel fait confiance à `x-caller-auth-id`. Centraliser les rôles dans une source administrée et vérifier les droits en base/fonctions. Supabase déconseille l’usage des métadonnées modifiables par l’utilisateur pour l’autorisation. [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [authentification des fonctions](https://supabase.com/docs/guides/functions/auth).

Les callbacks Telegram doivent vérifier que la personne qui répond est liée au client du dossier. Le lien d’association ne devrait pas être un simple identifiant de client réutilisable : préférer une invitation dédiée, limitée dans le temps et à usage unique. Les fonctions privilégiées doivent refuser de fonctionner si leur authentification requise manque. L’audit n’a pas tenté d’exploiter ces chemins en production.

Les factures doivent être privées. La migration de durcissement retire des politiques de listing, mais indique que les buckets restent publics ; une URL connue continue alors de permettre le téléchargement. Préférer accès contrôlé et URL temporaire lorsque nécessaire. [Fonctionnement officiel du stockage](https://supabase.com/docs/guides/storage/buckets/fundamentals).

À votre volume, l’optimisation immédiate est la sélection des données : charger une page de dossiers, puis ses documents et échanges à l’ouverture ; filtrer et rechercher en base ; actualiser le dossier modifié. Séparer les états React de session, données, conversation et interface pour limiter les rafraîchissements inutiles. Charger les exports PDF/Excel à la demande. Le build observé contient un bundle principal d’environ 1,76 Mo minifié, soit 520 Ko compressé ; ce n’est pas une mesure de latence sur le réseau de l’entrepôt.

**7. L’ordre de réalisation recommandé.**

| Lot | Livrable utilisable | Dépendances et critère de sortie |
|---|---|---|
| A — Fiabiliser les actions et mesurer | Authentification correcte, sauvegardes confirmées, rapprochement paiement, schéma cohérent, contrôle de complétude des listes | Tester erreurs réseau, accès entre clients, double clic, rejeu de paiement et recherche au-delà de 1 000 dossiers. Instrumenter les temps dès ce lot. |
| B — Accélérer les décisions | Demande client complète, attente volontaire, pièces jointes, relances pilotées, boîte de réception partagée | Modèles persistés et moteur d’envoi fiable ; réponse identique par web ou Telegram ; arrêt des relances après décision. |
| C — Accélérer les devis | OCR en brouillon, anomalies ciblées, calcul unique, validation, devis versionné et lien de règlement | Document et mesures complets ; calculs validés sur cas de référence ; relance OCR sans doublon ; prix identique dans tous les canaux. |
| D — Fluidifier le poste de travail | Files par rôle, responsable, dossier suivant, mobile utilisable, scan et départs contrôlés | Observer deux opérateurs en situation réelle ; vérifier concurrence et capacité à terminer les tâches sur tablette. |

Les lots peuvent se recouvrir sur le travail de conception et de mesure. Les dates et charges ne sont pas chiffrées ici : la capacité de développement et l’écart avec la base déployée ne sont pas connus. Ne pas différer les contrôles d’accès ou le paiement pour lancer des automatisations de grande ampleur. Livrer chaque lot sur un périmètre limité, avec possibilité de désactivation et retour à un traitement humain tracé.

Le premier pilote peut couvrir 100 dossiers et 20 à 30 clients, sélectionnés avec différents canaux et cas de regroupement. Prévoir une période d’observation avant changement, puis comparer des cas de complexité semblable. Avec une petite équipe, faire participer un préparateur et la personne qui gère les échanges et devis, plutôt que multiplier les validations hiérarchiques.

**8. Mesurer la valeur obtenue.**

Le succès principal est le temps de travail humain par dossier expédié, à qualité de service constante. Distinguer un carton physique, un dossier de préparation, un client et un départ dans les mesures : « 1 000 colis » ne correspond pas nécessairement à 1 000 devis. Cette distinction doit être confirmée lors de l’instrumentation.

| Indicateur | Définition | Usage |
|---|---|---|
| Intervention humaine | Temps actif de communication et devis par dossier | Mesurer le gain de capacité réel |
| Délai de réponse | Demande acceptée par le canal → décision explicite | Identifier les messages ou canaux qui bloquent |
| Délai évitable | Attente sans décision ; séparer les pauses demandées et attentes de documents | Ne pas traiter une attente volontaire comme un échec |
| Temps de devis | Documents et mesures complets → devis validé ; mesurer séparément le temps actif | Vérifier si l’automatisation enlève de la saisie |
| Complétude à réception | Dossiers avec justificatifs exploitables au moment de réception | Déplacer le travail documentaire en amont |
| Contacts manuels | Interventions humaines par dossier et demandes « où est mon colis ? » | Mesurer la clarté du parcours |
| Fiabilité | Devis corrigés après envoi, messages en échec, paiements non rapprochés, doubles traitements | Empêcher qu’un gain de vitesse dégrade le service |
| Départ à l’heure | Dossiers prêts et embarqués sur le départ confirmé | Relier le logiciel à la promesse de livraison |

Objectifs provisoires pour le pilote : réduire de 30 % les interventions manuelles de communication et viser moins de deux minutes de travail actif sur un devis standard complet. Mesurer médiane et cas lents, puis ajuster ces objectifs. Aucun résultat de ce type n’a encore été observé dans l’audit.

Si chaque dossier bénéficiait de 3 à 5 minutes économisées, 1 000 dossiers représenteraient 50 à 83 heures mensuelles. Si plusieurs cartons partagent un devis, calculer le gain devis sur le nombre réel de dossiers. Ne pas additionner deux fois les mêmes minutes de communication et de traitement.

Les tableaux de bord financiers additionnent aujourd’hui les montants encaissés sous des intitulés de chiffre d’affaires. Les encaissements, les taxes, le revenu de service et la marge de transport doivent être distingués selon votre modèle comptable. Pour piloter l’amélioration, les délais de décision et de devis auront d’abord plus de valeur que des compteurs supplémentaires de colis.

**9. Résultats de vérification et limites.**

- Le build de production du commit analysé compile ; avertissement de taille du bundle principal.
- `npm run lint` échoue parce que la configuration ESLint manque. Une vérification ciblée des règles de hooks trouve une violation dans `ClientDetailView.jsx:132`. Aucun écran blanc correspondant n’a été reproduit dans les parcours navigateur testés.
- Le navigateur confirme l’interface personnel avec un rôle client simulé, le retour à la connexion après rechargement et la perte du modèle après changement d’écran.
- Ouvrir les paramètres provoque huit demandes de création de départs dans le scénario sans départ existant. Ces écritures ont été simulées ; une navigation devrait charger les données, la génération étant un traitement explicite ou planifié.
- Le scénario de modification du poids de 3 à 5 kg produit correctement 50 € de transport avec le barème fictif utilisé. L’hypothèse d’un devis utilisant systématiquement l’ancienne mesure n’est donc pas retenue comme bug reproduit.
- Les fonctions isolées reproduisent une économie pro de 3,40 € malgré des mesures identiques, l’acceptation d’un article non catégorisé et l’incompatibilité de notification PayPlug décrite plus haut.
- L’affectation automatique ignore la destination. Le test du mercredi après 17 h produit le vendredi proche alors que le commentaire métier annonce celui de la semaine suivante : faire confirmer la règle de coupure, puis l’implémenter dans le fuseau de l’entrepôt. L’accord Telegram ne passe pas par la même fonction d’affectation que l’accord dans l’application.
- L’inspection de la [capture bureau](audit-expedile-2026-09-10/colis-detail-desktop.png) et de la [capture mobile](audit-expedile-2026-09-10/colis-detail-mobile.png) confirme une coupure du contenu à droite sur mobile. Le `scrollWidth` global vaut pourtant 390 px : une mesure de débordement seule n’aurait pas détecté ce problème.

Les scripts [navigateur](audit-expedile-2026-09-10/verify-browser.cjs) et [logique métier](audit-expedile-2026-09-10/verify-logic.cjs), ainsi que leurs résultats JSON, accompagnent ce rapport. Le script navigateur nécessite Playwright, un navigateur installé et le serveur local lancé ; `PINTA_PLAYWRIGHT_MODULE` permet d’indiquer un module Playwright déjà disponible. Le script métier utilise l’esbuild installé dans `pinta/node_modules` et doit être lancé avec `TZ=Europe/Paris`. Les deux utilisent des dépendances simulées pour les services externes. Ils constituent des reproductions d’audit, pas une validation de la production.

Les décisions métier à formaliser pendant le premier lot sont la portée exacte du feu vert, les modalités de regroupement, les tarifs pro et abonnements, les règles de stockage et le calendrier des départs. Elles devront ensuite provenir d’une même configuration appliquée aux écrans, aux devis, aux messages et aux traitements automatiques.
