# Tableau quotidien des expéditions

Demande du 2 octobre 2026 : retrouver la lisibilité d’un tableau pour travailler sur plusieurs dossiers, sans recopier les longs écrans SunApps ni perdre le client et la référence pendant le défilement.

## Décisions et modifications

| Sujet | Résultat |
| --- | --- |
| Une expédition, une ligne | Tous les cartons rattachés restent sous leur même référence EXP. Les tâches parallèles ne créent pas de lignes supplémentaires. |
| Travail quotidien | Référence, client et zone, action à faire, responsable de cette tâche, casier, nombre de cartons reçus et bouton d’action. Les coordonnées et les détails financiers quittent cette vue. |
| Paiements | Montant demandé, règlement enregistré, reste à régler et date d’envoi. Un devis non envoyé ou invalidé n’est pas présenté comme un montant dû. |
| Départs | Départ réellement affecté, destination, nombre de colis après optimisation et contrôle restant. Aucun prochain départ n’est promis automatiquement. |
| Changement de vue | Les trois vues affichent les mêmes dossiers avec leurs filtres conservés. Changer de présentation ne valide rien et ne change aucune attribution. |
| Mes tâches | Le filtre utilise le responsable de la tâche, pas le référent historique du dossier. Il peut montrer ma vérification de facture pendant qu’un collègue optimise la même expédition. |
| À prendre | Seulement les tâches disponibles, autorisées et compatibles avec l’état du dossier. Les attentes client et les tâches prises par un collègue ne sont pas proposées comme travail libre. |
| Missions personnelles | Le tableau commun montre tout le travail autorisé. Les missions favorites restent un réglage de « Mon travail » et ne masquent pas implicitement des dossiers dans le tableau. |
| Prise de tâche | « Je m’en occupe » prend la tâche de façon atomique et ouvre son écran. « Continuer » reprend sa propre tâche ; « Consulter » ouvre sans s’attribuer le travail. |
| Erreurs et indisponibilité | Une panne de chargement des tâches est expliquée avec un bouton de reprise. Elle ne devient pas une fausse liste vide. Les dossiers restent consultables. |
| Travail simultané | Les contrôles existants de version, permission et attribution restent utilisés. Une tâche devenue incohérente avec le dossier ne peut pas être prise depuis une ancienne ligne. |
| Montants | Une valeur inconnue ne devient pas artificiellement 0 €. Un règlement partiel garde un reste à régler. Les incohérences de paiement restent visibles. |
| Optimisation | L’indication dépend des mesures validées pour la version actuelle des cartons. Des mesures anciennes conservées en brouillon ne signifient pas « prêt ». |
| Lecture sur ordinateur | Référence et client restent visibles pendant le défilement horizontal. Les titres du tableau restent visibles pendant le défilement vertical. |
| Lecture sur téléphone | Cartes courtes avec les mêmes actions, sans imposer le grand tableau horizontal. |
| Filtres secondaires | Étape, responsable, destination, regroupement, tri, archives et export sont réunis dans « Filtres et options ». Les filtres actifs restent visibles et retirables. |
| Priorités | Le tri utilise la tâche effectivement affichée, avec ses échéances et priorités actives. Un motif urgent est visible ; une priorité expirée ne reste pas affichée. |
| Export | Le fichier Excel reprend uniquement les colonnes de la vue et les dossiers filtrés ou sélectionnés. Les montants et dates correspondent à l’écran. Les coordonnées masquées ne sont pas ajoutées ; l’export financier exige son droit propre. |
| Recherche | La recherche directe d’une référence interroge toujours les dossiers accessibles, y compris les archives et ceux masqués par les filtres. |
| Retour à la liste | La fiche s’ouvre en pleine page. Le retour conserve les paramètres de recherche, la vue et les positions de défilement. |
| Sélection multiple | Une ligne masquée par un nouveau filtre quitte la sélection avant une action groupée. Le nombre annoncé correspond aux dossiers encore sélectionnés. |

Cette livraison complète le [parcours réception, optimisation et conversation](rapport-parcours-quotidien-2026-10-01.md). Les mesures reçues et les mesures après optimisation restent distinctes. Enregistrer ou consulter ne notifie pas le client. Les montants, formules douanières et clés PayPlug ne sont pas modifiés par ce tableau.

## Vérifications

La recette emploie exclusivement des dossiers fictifs et des prestataires simulés.

- **246 tests unitaires réussis**, analyse statique et compilation réussies.
- **42 scénarios navigateur** pour le tableau, ses droits, les vrais téléchargements Excel, la recherche, les contrastes et le parcours équipe : [recette détaillée](recette-tableau-quotidien-2026-10-02.md).
- Régression complémentaire : **8** scénarios d’indicateur de facture, **22** de parcours dossier et **15** de travail personnel réussis. La recette générale existante passe également ses **11** scénarios.
- **12 configurations d’affichage** vérifiées : ordinateur portable 1366 px, écran large 1920 px, largeur 1093 px correspondant à un affichage agrandi, téléphone 390 px, thèmes clair et sombre. Les trois tableaux tiennent sur l’ordinateur de 1366 px sans défilement horizontal ; référence et client restent fixes lorsque le défilement est nécessaire.
- Deux défauts détectés puis corrigés : filtres mobiles qui occupaient toute la hauteur, et lien de facture devenu absent lorsque la tâche affichée concernait déjà les documents. Les vérifications correspondantes passent après correction.

Captures : [travail quotidien](verification-tableau-2026-10-02/travail-desktop-clair.png), [paiements](verification-tableau-2026-10-02/paiements-desktop-clair.png), [téléphone](verification-tableau-2026-10-02/travail-mobile-clair.png).

Les contrôles serveur du parcours précédent restent décrits dans le rapport du 1er octobre : 104 tests serveur et 20 étapes SQL, dont permissions, concurrence et idempotence. Le tableau n’ajoute aucune migration. Un essai observé avec un collaborateur débutant reste nécessaire pour confirmer la compréhension réelle au dépôt.

## Publication vérifiée le 2 octobre 2026

- Autorisation explicite de publication reçue ; push du commit applicatif **[`2580b8d`](https://github.com/mmz97441/pinta/commit/2580b8df4994446a6fdec1058786ceb41e30e00a)** sur **`main`** effectué sans forcer l’historique. Il regroupe le parcours du 1er octobre et le tableau du 2 octobre : 96 fichiers de code, tests, rapports et captures fictives.
- Les fichiers personnels préexistants et sauvegardes privées sont exclus. Le contrôle des formats de secrets n’a rien détecté dans les ajouts.
- **Interface en ligne sur [expedile.app](https://expedile.app/colis)**. Déploiement Vercel **`dpl_ATNW4gyXD5QN9VrTTeFvVCUBW6Hc`**, état **READY**, associé au commit publié. Les fichiers servis contiennent bien les vues « Travail quotidien », « Paiements » et la colonne « Qui s’en occupe ».
- Vérification HTTP : `/`, `/colis`, `/reception`, `/conversations` et `/paiement/retour` répondent avec le document de l’application. Entrée servie : `/assets/index-DPItcyLQ.js` ; tableau : `/assets/StaffSplitView-C-2NiNUO.js`.
- Navigateur neuf sur le domaine réel : connexion affichée, aucune erreur JavaScript ni débordement horizontal, aucune requête de modification. Les essais métier détaillés restent ceux de la recette avec données fictives ; aucun dossier client réel n’a été modifié pour cette vérification en ligne.
- Serveur : migration de réception `20261001000001` revérifiée, deux commandes présentes avec leurs contrôles de propriétaire de tâche et leurs droits attendus, registre de reprises privé. Aucune nouvelle migration pour le tableau.
- PayPlug reste en mode test ; aucune clé ni configuration de paiement n’a été modifiée.
- [Contrôles GitHub du commit publié](https://github.com/mmz97441/pinta/actions/runs/37036775512) : compilation, tests unitaires, tests serveur et contrôles SQL réussis. La recette navigateur distante a détecté un ancien libellé dans le test de sélection (« colis » au lieu de « dossier ») et une marge verticale insuffisante sur téléphone avec les polices Linux. La correction et la nouvelle vérification sont consignées dans le [rapport de la vue d’ensemble](rapport-vue-ensemble-dossier-2026-10-02.md).
