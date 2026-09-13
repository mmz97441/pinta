# Livraison — organisation de l’équipe et corrections logiques

12 septembre 2026 · Pinta / Expedîle · **Livré et déployé sur [expedile.app](https://expedile.app).**

Les huit zones de la proposition UI et les 22 écarts de l’audit logique ont été traités. Ce rapport distingue les comportements livrés, les décisions et les preuves. Il ne promet pas l’absence de tout défaut inconnu.

## Ce qui change dans les écrans

| Zone | Comportement livré |
|---|---|
| **Mon travail** | Missions cumulables par personne, quatre files (à faire, en cours, à prendre, en attente), compteurs cohérents, recherche et action suivante conservant le contexte. Préférences, densité et disponibilité enregistrées côté serveur. |
| **Équipe** | Actions sans responsable, charge par type, attentes, engagements et indisponibilités visibles. Prise en charge atomique ; relais nominatif accepté avant transfert ; réaffectation contrôlée et tracée. |
| **Dossiers d’expédition** | Liste allégée, filtres avancés repliables, filtre du départ réellement appliqué, aperçu rapide et accès aux espaces de préparation et conversation. Référent du dossier distinct du responsable de chaque action. |
| **Conversations** | Échanges et contexte du dossier côte à côte sur ordinateur ; navigation dédiée sur téléphone. Brouillon propre à chaque dossier, lecture distincte du traitement, documents conservés puis importés explicitement comme factures. |
| **Préparation et devis** | Enregistrement des mesures indépendant des documents. Plusieurs colis sortants mesurés séparément. Brouillons conservés dans la session et conflits de version explicites. Accès direct aux documents, mesures et devis selon l’action ouverte. |
| **Fiche client** | Synthèse opérationnelle en premier, coordonnées et administration séparées, expéditions ouvertes, contact réellement disponible, réception préremplie et historique complet comprenant les archives. Adresse commune avec le portail et les étiquettes. |
| **Espace client** | Actions à effectuer, attente volontaire, travail de l’équipe et historique séparés ; EXP stable, vrais cartons physiques, états de paiement cohérents. Notifications anciennes accessibles et compteur global des non-lues. |
| **Navigation et départs** | Rubriques stables sur ordinateur, accès secondaire « Plus » sur mobile et réception toujours identifiable. Écran Départs dédié : planning, clôture facultative, contrôle des colis réellement embarqués, reports motivés et manifestes figés. |

## Décisions métier et techniques

1. **Une EXP par expédition client.** Rattacher un carton conserve cette référence et continue sa numérotation. Un départ transporteur ENV peut réunir plusieurs EXP.
2. **Réception et optimisation restent indépendantes.** Les mesures reçues ne préremplissent pas les mesures finales. Un changement de composition oblige à les reconfirmer, sans effacer leurs valeurs historiques.
3. **Les volumes des colis sortants s’additionnent.** Le devis utilise les dimensions de chaque colis ; il ne multiplie pas des dimensions maximales provenant de colis différents. Le nombre de colis physiques expédiés est distinct du nombre de cartons reçus et de dossiers.
4. **Les missions organisent les priorités sans accorder de droits.** Les opérations restent contrôlées par les permissions serveur. Les mêmes files excluent les actions impossibles ou terminées.
5. **La responsabilité d’une action ne remplace pas le référent.** Lire un dossier n’attribue rien. Le destinataire d’un relais doit l’accepter ; une absence ne redistribue pas silencieusement le travail.
6. **Sauvegarder utilise la version ouverte.** Une modification concurrente conserve le brouillon et produit un conflit explicite, y compris sur le planning. Un rafraîchissement de fond conserve les formulaires ouverts.
7. **Une attente reste une attente.** Son échéance déclenche un réexamen ; elle ne vaut ni accord client ni résolution automatique. Un message lu ne signifie pas que la conversation est traitée.
8. **Un document Telegram n’est pas automatiquement une facture.** Il reste consultable dans la conversation, même après paiement. L’import en facture est explicite, idempotent et interdit lorsque les pièces commerciales sont figées.
9. **La destination payée reste contractuelle.** Les changements affectant un dossier impayé invalident devis et intention de paiement ; les dossiers payés conservent leur destination enregistrée.
10. **Aucun canal inaccessible annoncé comme disponible.** Sans compte lié ni Telegram, la réception signale l’accès à activer et une action de contact existe pour l’équipe. Pas d’intégration WhatsApp.
11. **Le départ est une confirmation collective.** Les EXP embarquées et reportées sont enregistrées ensemble. Les dossiers annulés ou déjà expédiés sont exclus ; les exports utilisent le manifeste conservé, même après archivage.
12. **Les données historiques ne sont pas inventées.** Pour un ancien dossier payé sans compteur sortant, une confirmation explicite d’un seul colis mesuré est possible au chargement et tracée. Une ancienne préparation sans preuve suffisante doit être réenregistrée. Aucun crédit professionnel supplémentaire n’est introduit ; le devis de transport pro reste réalisable sans facture lorsque les règles existantes le permettent.
13. **Les données douanières restent factuelles.** Le poids brut reprend le poids après optimisation. La masse nette de marchandises, non mesurée par l’application, est laissée à renseigner par le déclarant.
14. **Chargements bornés et erreurs visibles.** Les actions terminées sont filtrées côté SQL ; la pagination utilise la vraie clé des préférences (`staff_id`). Le compteur des notifications non lues est indépendant de la page affichée.
15. **Réception mobile utilisable depuis la fiche client.** La modale est rendue au niveau du document pour éviter son découpage par une carte parente ; espaces, en-tête, fermeture et barre d’action restent accessibles.

## Les 22 écarts : correction et preuve

Numéros identiques à [l’audit initial](audit-logique-expedile-2026-09-11.md). Tous sont corrigés dans cette livraison.

| N° | Correction appliquée | Vérification principale |
|---|---|---|
| 1 | Facture remplacée explicitement reliée ; anciennes lignes exclues du prix. | SQL et calcul JS/SQL |
| 2 | Mesures sauvegardées avec version réellement ouverte. | Deux utilisateurs simulés et SQL |
| 3 | Destination modifiée : devis/intention impayée invalidés ; contrat payé conservé. | SQL, paiement ancien refusé |
| 4 | Composition versionnée ; anciennes mesures finales à reconfirmer. | SQL et moteur devis |
| 5 | Adresse staff/portail/étiquette harmonisée ; complément conservé. | SQL et sauvegarde/rechargement navigateur |
| 6 | Suivis et mesures rattachés au même carton physique. | Tests du manifeste et portail |
| 7 | Accès manquant affiché honnêtement et action de contact durable. | Réception navigateur et SQL |
| 8 | Réponse Telegram prioritairement liée au message auquel le client répond. | Handler Edge isolé |
| 9 | Document reçu après paiement conservé dans la conversation. | Edge, SQL et import explicite navigateur |
| 10 | Produits interdits conservés au rattachement. | Réception navigateur |
| 11 | Date, clôture, destination et disponibilité du départ revalidées. | SQL et sélection navigateur |
| 12 | Départ collectif atomique avec sélection réelle et reports motivés. | SQL et navigateur |
| 13 | Export issu du manifeste figé ; annulations exclues, archives conservées. | SQL et lecture du véritable XLSX téléchargé |
| 14 | Droits de modification, réaffectation et expédition vérifiés par opération. | SQL, UI et régression permissions |
| 15 | Mesures finales enregistrables sans devis ni documents complets. | SQL et réouverture navigateur |
| 16 | Devis retiré remis à préparer ; ancien paiement non proposé. | SQL, portail et suivi public |
| 17 | Création d’article renvoie son lien canonique à la facture. | Adaptateur et devis |
| 18 | Ligne vide intérieure signalée avant confirmation ; ligne de scan finale autorisée. | Réception navigateur |
| 19 | Attente volontaire identique dans accueil, liste et détail. | Parcours client et tests métier |
| 20 | Non-lues comptées globalement ; chargement au-delà de 50. | Test avec 72 notifications |
| 21 | Historique de la fiche chargé explicitement, archives incluses. | Réouverture de la fiche client |
| 22 | Dates d’expédition et livraison enregistrées à la transition. | SQL |

## Recette et revue croisée

- ESLint, compilation de production et **109 tests applicatifs réussis**.
- Organisation : **26 contrôles navigateur**, dont 12 combinaisons d’écrans, tailles et thèmes avec Axe ; aucune anomalie grave détectée, aucune exception applicative ni débordement horizontal.
- Préparation/client : **11 contrôles navigateur réussis**, dont cinq contrôles Axe sans violation ; **24 assertions SQL**, **24 parités devis JS/SQL** et **14 parités réception/devis** réussies.
- Intégration réception/client/départs : **7 scénarios réussis** ; quatre contrôles Axe sans violation. Le XLSX de manifeste est téléchargé et son contenu vérifié après archivage et changement des données courantes.
- Régression générale : **11 contrôles réussis** (plus un relevé des champs du devis), comprenant session, réception, devis, paramètres et suivi public.
- Permissions : **12 scénarios réussis**, comprenant sauvegarde réelle dans les fixtures, conflit, faux succès refusé et actualisation d’une session ouverte.
- Backend organisation : **73 assertions SQL réussies**, dont une course réelle entre deux sessions ; **six contrôles indépendants** confirment le refus des contournements de la préparation.
- Edge Telegram : **17 tests réussis**. Suivi public : quatre tests de projection physique et commerciale sans exposition des montants.
- La revue croisée a encore corrigé la clé de pagination des préférences, les saisies directes contournant la préparation, les blocages des devis professionnels, le suivi public et les conflits du planning et les routes directes de l’hébergement.

**Volume testé :** PostgreSQL 17 isolé, 2 CPU / 512 Mio, 1 000 dossiers et 3 000 actions, cinq connexions simultanées. Lecture et matérialisation : 231–396 ms par session ; réexamen simultané de 1 000 attentes : groupe terminé en 1,31 s. Aucun dossier oublié ni attribution inventée. Ces résultats portent sur des données synthétiques sans messages/factures et ne prédisent pas la latence de production.

## Publication et restauration

- Sept migrations `20260912000002` à `20260912000008` appliquées ; **39 versions locales et distantes synchronisées**.
- Fonctions actives : `telegram-webhook` version 27, `telegram-inbox-assign` version 4 et `get-tracking` version 9.
- Frontend Vercel **Ready**, déploiement `dpl_G1oRZ2gghCjX5hoNguK4RBqXSunA`, promu sur les domaines de production après la recette.
- [Version immuable contrôlée](https://pinta-8sdwjydw3-mmz97441s-projects.vercel.app) : **44 vérifications navigateur réussies** (26 organisation, 11 préparation/client, 7 intégration), avec requêtes métier simulées ; **23 contrôles HTTP réussis**.
- [Domaine public après promotion](https://expedile.app) : **23 contrôles HTTP réussis**, écran de connexion sur ordinateur/mobile et aucune exception applicative. Les nouvelles URL `/equipe`, `/conversations`, `/departs`, `/travail` et `/plus` sont accessibles directement.
- À **05:55, heure de La Réunion**, le HTML et les quatre ressources principales du domaine correspondent exactement au déploiement testé. Entrée `index-Deb5nCcy.js`, CSS `index-PRmjf6Pa.css` ; [empreintes comparées](verification-organisation-2026-09-12/deployment/domain-match.json).
- Seuls **115 fichiers frontend** ont été envoyés à Vercel ; aucun fichier d’environnement, sauvegarde, rapport, test ou source Supabase dans ce paquet.

Avant migration, sauvegarde privée du **schéma** effectuée (228 824 octets, empreinte conservée dans les preuves). Sept sauvegardes physiques hébergées Supabase sont indiquées « COMPLETED », la plus récente au 11 septembre 2026 à 03:46 UTC. La restauration à la seconde n’est pas activée. Le contrôle automatique a refusé l’export intégral des données clients vers un fichier local ; cet export n’a pas été effectué. Aucune donnée réelle n’apparaît dans les captures et jeux de test.

Une ancienne version frontend peut être repromue chez Vercel si nécessaire ; les gardes SQL supplémentaires exigent toutefois la nouvelle interface pour certaines écritures. Une restauration globale d’une sauvegarde ancienne pourrait perdre des opérations récentes : elle n’a pas été lancée. Les corrections ultérieures doivent privilégier une migration corrective ciblée.

## Limites et lecture des preuves

Les recettes navigateur utilisent des API fictives, y compris sur le site hébergé. Les garanties serveur sont testées dans PostgreSQL isolé avant application des mêmes migrations en production. Aucun message client, facture réelle ou paiement réel n’a été envoyé pour les tests. SMTP et PayPlug réel ne sont pas reconfigurés par cette livraison.

Les modules de prévisualisation PDF restent chargés à la demande ; l’avertissement de taille de ce module demeure à la compilation. Les gains de temps réels doivent se mesurer dans l’usage de l’équipe ; aucun pourcentage de gain n’est inventé.

- [Décisions UI et travail personnel](decisions-organisation-ui-2026-09-12.md)
- [Décisions backend, relais et départs](organisation-backend-livraison-2026-09-12.md)
- [Décisions préparation, devis et client](organisation-preparation-client-decisions-2026-09-12.md)
- [Recette organisation](verification-organisation-2026-09-12/workspace-browser.json)
- [Recette intégration](verification-organisation-2026-09-12/integration/results.json)
- [Recette préparation/client](verification-organisation-preparation-client-2026-09-12/results.json)
- [Mesure de charge isolée](verification-organisation-backend-2026-09-12/performance.json)
- [Sauvegardes et prépublication](verification-organisation-2026-09-12/deployment/pre-deployment.json)

- [Recette distante organisation](verification-organisation-2026-09-12/deployment/workspace/workspace-browser.json)
- [Recette distante préparation/client](verification-organisation-2026-09-12/deployment/preparation/results.json)
- [Recette distante intégration](verification-organisation-2026-09-12/deployment/integration/results.json)
- [Contrôle du domaine après promotion](verification-organisation-2026-09-12/production/report.json)

## Première utilisation

Rechargez les onglets déjà ouverts. Dans **Mon travail → Mes missions et disponibilité**, chaque collaborateur choisit ses missions et enregistre ses préférences. La file **À prendre** contient les actions communes disponibles ; **Équipe** permet à la coordination de préparer les relais. Les réglages des permissions gardent leur bouton d’enregistrement explicite.
