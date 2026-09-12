# Préparation, devis et espace client — modifications du 12 septembre 2026

Ce lot implémente les parcours autorisés de la réorganisation. Le chef d’ingénierie consigne séparément la publication et les vérifications globales ; ce document décrit le code, les décisions métier et les preuves locales du lot.

## Ce qui change pour l’équipe

- **Préparation dans un espace complet** : mesures des colis sortants, documents et articles côte à côte sur grand écran, onglets sur mobile, frais et total avec action de vérification accessible. L’expédition conserve son EXP ; les colis sortants sont numérotés dans ce dossier.
- **Sauvegarde physique indépendante** : « Enregistrer les mesures de préparation » fonctionne même sans facture validée. Le devis reste bloqué tant que ses propres prérequis ne sont pas satisfaits. Les opérateurs du devis sans permission de préparation consultent les mesures ; ils ne voient plus des champs qu’ils peuvent modifier sans pouvoir les enregistrer.
- **Préparation autorisée** : les mesures et le devis exigent un feu vert enregistré, un dossier impayé non archivé et sans produit interdit. Les blocages sont expliqués dans l’écran et imposés en base. Une insertion ne peut pas certifier une préparation sortante ; modifier directement les anciennes colonnes de dimensions finales ne contourne pas la permission de préparation.
- **Plusieurs colis après optimisation** : chaque unité sortante possède longueur, largeur, hauteur et poids. Le nombre expédié est dérivé de ces unités confirmées. Le poids facturable reste la règle existante : maximum entre la somme des poids réels et la somme des poids volumétriques. Les maxima L/l/H ne servent jamais à fabriquer le volume d’un ensemble.
- **Conflits explicites** : un brouillon conserve la version réellement ouverte, y compris après une navigation interne et lors du remontage React. Une modification concurrente garde les valeurs saisies, affiche les mesures enregistrées et impose une reprise explicite. Aucun remplacement silencieux par la version plus récente du cache.
- **Nouveau carton = nouvelle validation physique** : les anciennes mesures finales restent consultables, mais leur confirmation et le nombre sortant sont invalidés. Il faut mesurer à nouveau la préparation et enregistrer cette nouvelle version. Aucune dimension reçue n’est copiée dans les mesures après optimisation.
- **Frais et modalités dans le brouillon** : ces choix sont enregistrés avec le devis. La sauvegarde des seules mesures conserve les frais encore à enregistrer dans le brouillon local.
- **Départ compatible** : le sélecteur écarte dates dépassées, chargements clôturés, départs partis/arrivés/archivés et destinations incompatibles avec le devis payé. Une ancienne affectation invalide est signalée. Affecter et réaffecter respectent leurs permissions distinctes. La confirmation se fait depuis le manifeste de départ, avec le parcours collectif prévu pour les unités effectivement chargées.

## Cohérence financière et documentaire

1. Les articles reliés à une facture rejetée sont exclus de la base taxable dans le moteur JavaScript **et** dans PostgreSQL. Les anciennes lignes restent dans l’historique. La correction de 100 € ne peut plus additionner automatiquement 100 € d’anciens articles rejetés.
2. Le dépôt client propose explicitement de corriger une facture rejetée. Le remplacement est relié à la facture d’origine ; le serveur impose le même dossier, interdit les doublons et fige le lien après dépôt. Une correction reçue n’oblige plus le client à renvoyer l’ancienne pièce rejetée.
3. Le retour immédiat d’un article manuel conserve son `factureId` (intégration API par le chef d’ingénierie). Une relecture n’introduit plus ce lien seulement après le premier devis.
4. Une correction documentaire retire le devis devenu invalide et ramène le dossier en préparation. Les anciens dossiers restés « paiement attendu » avec un devis vide ou un brouillon sont également reclassés. L’espace client annonce une révision, sans demander de règlement de l’ancienne version.
5. Changer la destination ou le type client invalide les devis modernes **impayés** concernés et rend leurs intentions de paiement obsolètes. Les devis payés conservent leur contrat figé. Le serveur inscrit la destination et l’identité commerciale canoniques dans le snapshot, même si le JSON fourni contient d’autres valeurs.
6. Le PDF reprend les mesures individuelles des colis après optimisation et le total figé du devis. Aucune nouvelle règle de taxes, de crédit professionnel ou de paiement à échéance n’est introduite.

## Ce qui change pour les clients

- Accueil organisé en **À faire par vous**, **Nous nous en occupons**, **En attente à votre demande**, **Historique**.
- Une carte par EXP : contenu, nombre de cartons réellement reçus, état compréhensible, prochaine étape et action utile. Les compteurs nomment les expéditions ; ils ne les confondent pas avec les cartons.
- La liste « Mes expéditions » réutilise exactement ces règles, avec recherche par référence/achat/suivi, filtres et chargement explicite des archives.
- Une attente arrivée à échéance reste une attente demandée, avec date de réexamen. Elle ne se transforme pas en accord ni en urgence de paiement. L’accueil, la liste, le détail et le badge de navigation utilisent la même règle.
- Les mesures de réception utilisent l’ordre des cartons physiques, y compris les cartons sans suivi. Un tableau de suivis filtré ne décale plus la correspondance entre cartons et mesures.
- Le lien de suivi public présente également les cartons reçus et chaque unité préparée séparément. Un indicateur calculé par le serveur distingue un devis valide d’un devis retiré, sans exposer les montants ni le snapshot privé. L’absence volontaire de montant dans ce lien ne devient plus un faux statut de révision.
- Les notifications permettent le chargement des pages précédentes, utilisent le compteur global fourni par le contexte et affichent les erreurs avec reprise. Pagination et compteur serveur sont intégrés par le chef d’ingénierie.

## Décisions sur l’historique et les données

Les préparations anciennes dont la fraîcheur n’est pas démontrée demandent une confirmation des mesures avant un **nouveau** devis. Une preuve acceptable est un devis payé ou un snapshot dont les cartons d’origine correspondent aux cartons actuels. Les mesures historiques restent conservées. Aucun nombre sortant n’est inventé lors de la migration ; une sauvegarde explicite de préparation le confirme.

Pour un ancien dossier déjà payé qui ne contient qu’un jeu de mesures finales, le manifeste de départ permet la confirmation physique explicite d’un seul colis, avec trace d’audit. Il ne déduit jamais plusieurs unités de ces mesures. Les actions d’équipe sont resynchronisées après l’ajout des règles de fraîcheur afin de ne pas conserver une ancienne préparation faussement terminée.

Les brouillons non sauvegardés sont conservés en mémoire par utilisateur et dossier pendant la navigation interne, avec avertissement à la fermeture de la page. La sauvegarde serveur des mesures est le mécanisme durable à utiliser avant de fermer le navigateur. Ce fonctionnement n’est pas présenté comme un mode hors ligne.

## Vérifications

- Tests métier JavaScript : exclusion des articles rejetés, somme des volumes individuels, fraîcheur après changement de composition, attente échue, devis retiré et facture remplacée. Les tests d’intégration de réception, de mapping de plus de 1 000 dossiers et d’export PDF sont conservés.
- **24 assertions SQL réussies** dans PostgreSQL 17, conteneur local sans réseau : replay de toutes les migrations sous le rôle réel de migration `supabase_admin`, puis assertions sur les droits, conflits, préparation sans documents, regroupement volumétrique, révisions documentaires, remplacement unique, destination et intentions obsolètes, revalidation et vue client sûre. Elles couvrent aussi le refus de préparation sans accord, l’accord retiré après préparation, les dossiers archivés/interdits, la certification forgée à l’insertion et la modification directe des anciennes dimensions par un logisticien sans permission. Le même scénario vérifie la synchronisation d’adresse canonique/historique demandée par le chef d’ingénierie. Fixtures annulées en fin de transaction ; aucun appel PayPlug ni donnée distante.
- **38 comparaisons JavaScript/PostgreSQL réussies** : 24 cas de tarifs, taxes, frais et économies ; 14 cas de couverture des mesures de réception et de séparation avant/après optimisation.
- **109 tests JavaScript et lint réussis** sur l’arbre partagé au contrôle final de ce lot. Quatre tests dédiés vérifient le suivi public, son état de devis et l’absence de divulgation financière dans sa projection.
- **11 vérifications navigateur réussies**, dont cinq contrôles automatiques d’accessibilité (préparation clair/sombre à 1 440/390 px et accueil client mobile), avec Chromium et API fictive : sauvegarde sans facture persistante après rechargement ; brouillon 5 kg conservé face aux 9 kg d’un collègue ; deux unités sortantes calculées ensemble et devis prêt à publier ; parcours client cohérent ; absence de débordement à 1 440 et 390 px. Les essais ont détecté puis éliminé une restauration incorrecte de brouillon sous StrictMode.
- Contrôles automatiques d’accessibilité et captures : voir les résultats détaillés. Ils complètent les parcours manuels ; ils ne constituent pas à eux seuls une certification d’accessibilité.

Preuves : [résultats navigateur](verification-organisation-preparation-client-2026-09-12/results.json), [scénario navigateur](../pinta/tests/browser-preparation-client.cjs), [résultats SQL et parités](verification-organisation-preparation-client-2026-09-12/sql-results.txt), [assertions SQL](../pinta/supabase/tests/preparation-workspace.sql), [replay SQL](../pinta/supabase/tests/run-preparation-workspace.sh).

Migrations : `20260912000005_preparation_workspace.sql`, `20260912000006_quote_workspace_integrity.sql`, `20260912000007_document_destination_revisions.sql`. Elles complètent les actions d’équipe, les départs et les mappings réalisés dans les autres lots.
