# Recette de la vue d’ensemble du dossier — 2 octobre 2026

Recette locale sur dossiers fictifs et transports simulés. Aucun client réel n’est notifié ; aucun paiement ni donnée de production ne sont modifiés.

## Logique et ergonomie contrôlées

- Une expédition conserve sa référence, son casier et les suivis de ses cartons. Les deux premiers suivis sont lisibles ; le lien des suivis supplémentaires ouvre le manifeste complet.
- Les mesures à réception et après optimisation restent distinctes : la recette utilise deux cartons reçus de 3 kg au total, puis un colis optimisé de 2,5 kg.
- Les factures sont comptées selon les documents actifs : deux factures et une copie retirée donnent bien deux factures retenues.
- Un statut payé ne transforme pas des mesures anciennes ou des documents manquants en étapes terminées.
- Les huit étapes sont consultables sans validation, notification ni attribution implicite. L’étape ouverte est distincte de l’avancement réel.
- Les détails financiers et documentaires respectent les permissions. Une étape réservée ne comporte pas de bouton de contournement.
- Le casier s’édite directement, y compris après paiement lorsque les droits le permettent. Sa sauvegarde ne rouvre pas les mesures ou le devis. Le clavier garde un focus utile à l’ouverture, après sauvegarde et au retour.
- Une erreur de sauvegarde conserve le casier saisi. La reprise enregistre une seule entrée d’historique.
- Clair et sombre sont vérifiés à 320, 390, 768 et 1440 px. Les configurations 320 et 768 utilisent un nom long et un suivi de plus de 120 caractères, puis parcourent les huit étapes. Aucun débordement horizontal global ni violation axe n’a été relevé.

Recette définitive : **16/16 scénarios réussis**, y compris accès direct à l’historique et retour du focus au bouton qui l’a ouvert. Résultats complets : `/tmp/pinta-dossier-overview-release/results.json`. Aucun échec restant dans cette suite.

Captures fictives : [ordinateur clair](verification-vue-ensemble-2026-10-02/ordinateur-clair.png), [ordinateur sombre](verification-vue-ensemble-2026-10-02/ordinateur-sombre.png), [téléphone clair](verification-vue-ensemble-2026-10-02/telephone-clair.png), [téléphone sombre](verification-vue-ensemble-2026-10-02/telephone-sombre.png). Les captures de stress 320/768 px restent dans `/tmp/pinta-dossier-overview-release`.

## Corrections issues de la CI du tableau

La CI Linux a révélé deux problèmes distincts dans la livraison précédente :

1. Le texte de sélection a été harmonisé en « dossier », mais un test cherchait encore « colis ». Le test est corrigé et vérifie aussi la case réellement cochée et l’état sélectionné de la ligne.
2. Les différences de polices faisaient dépasser le premier bouton mobile sous la navigation inférieure. Les faits de la carte quotidienne occupent maintenant moins de hauteur : responsable sur toute la largeur, casier et nombre de cartons côte à côte. Aucun libellé ni champ utile n’est supprimé et les cibles gardent 44 px. L’assertion de visibilité du bouton est conservée. Un contrôle supplémentaire avec Arial et Verdana impose une marge d’au moins 12 px avant la navigation.

Le tableau a été rejoué sur la dernière compilation : **26/26 scénarios réussis**, y compris le contrôle de polices supplémentaire. Résultats : `/tmp/pinta-dossier-table-ci-final/results.json`.

Le parcours de réception a également été remis en phase avec la reprise idempotente : après une réponse 503 indéterminée, il faut utiliser « Vérifier l’enregistrement ». Le test vérifie que « Terminer » reste bloqué, que le double clic réutilise le même identifiant et qu’une seule expédition est créée. **4/4 scénarios réussis**.

## Portée des résultats

Les trois suites de ce complément totalisent **46 scénarios réussis** : vue d’ensemble 16, tableau 26, réception 4. Le responsable de l’intégration signale séparément 274 tests unitaires réussis et conduit la régression générale.

Le RPC `get_invoice_review_context` utilise POST mais lit seulement les données de vérification (fonction SQL `STABLE`). Il est explicitement distingué des mutations dans la recette ; les dossiers, factures et lignes restent comparés avant/après navigation.

Ces essais ne remplacent ni les tests SQL de droits et de concurrence, ni une séance observée avec une personne débutante. Les résultats locaux ne constituent pas à eux seuls une confirmation de réussite de la nouvelle CI Linux ou de publication.
