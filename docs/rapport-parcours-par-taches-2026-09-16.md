# Simplification du parcours Expedîle — 16 septembre 2026

Objectif : permettre à une équipe de 3 à 5 personnes de traiter les dossiers sans relire ni revalider le travail déjà terminé. Chaque opérateur ouvre sa tâche ; le dossier partagé conserve les informations utiles aux autres métiers.

## Décisions et modifications

| Point | Décision appliquée | Résultat concret |
|---|---|---|
| Accueil équipe | Deux vues principales : **À faire** et **En attente**. Les tâches en cours restent dans À faire. | Une liste lisible, personnalisée selon les missions ; tâches à prendre, relais et exceptions restent accessibles. |
| Priorités individuelles | Conserver les permissions et préférences de chaque collaborateur. | La recherche globale retrouve aussi un dossier hors de sa mission ; aucune tâche n’est attribuée automatiquement en la consultant. |
| Navigation | **Liste → tâche dédiée → résultat enregistré**. Le contexte s’ouvre à la demande. | Les filtres de retour sont conservés ; « Retour à ma liste » et « Tâche suivante » évitent de recommencer la recherche. Les anciennes URL restent compatibles. |
| Retour entre tâches | Un bouton explicite « Revenir aux factures », « Revenir à la préparation », etc., en plus du retour à la liste. | Rouvre l’écran précédent du parcours sans annuler une validation ; conserve brouillons et filtres et saute les tâches non accessibles à cet opérateur. |
| Réception | Un seul enregistrement des cartons, avec leurs mesures obligatoires ; notification séparée. | L’équipe voit la confirmation et peut ouvrir le carton reçu. Un carton rattaché garde la référence du dossier et poursuit sa numérotation. |
| Accord client | Regrouper réception, accord de préparation et demande des justificatifs manquants dans le message proposé. | L’opérateur choisit le canal, relit, modifie et confirme. Une attente volontaire n’entraîne pas de relance d’accord proposée. |
| Préparation | Écran autonome après accord, avec dimensions et poids des colis sortants. | Enregistrer les mesures ne crée ni devis ni notification. Après sauvegarde, un résumé remplace le formulaire ; « Modifier les mesures » le rouvre explicitement. |
| Factures | Écran dédié au document et à ses articles, avec sélecteur et navigation entre factures. | Sur ordinateur : lecture et vérification côte à côte. Sur mobile : onglets Document / Articles. La validation passe à la prochaine facture réellement en attente, après confirmation serveur. |
| Factures terminées | Afficher le résultat plutôt que rouvrir les éditeurs. | Les doublons retirés et documents remplacés restent consultables dans l’historique, sans polluer le travail courant ni le devis. Les articles manuels restent identifiés séparément pour éviter un double comptage. |
| Devis | Limiter l’écran aux prérequis, frais, détail du calcul, total et action d’enregistrement/envoi. | Les PDF, éditeurs de factures et anciennes mesures ne sont plus répétés. Un prérequis manquant conduit directement à la tâche correspondante. |
| Expédition et livraison | Afficher l’état utile et l’action suivante, avec un message facultatif à préparer. | Un changement logistique n’envoie plus automatiquement de notification depuis cet écran. Les libellés « Lancer la livraison » et « Confirmer la livraison » correspondent aux états effectivement enregistrés. |
| Contexte partagé | Un panneau commun : réception, documents, messages, équipe, historique. | L’information reste disponible sans occuper chaque écran. Fermer le contexte conserve un message ou une affectation en cours de saisie. Les échanges cachés ne sont pas marqués lus. |
| Espace client | Une étape courante et une action attendue ; documents et échanges accessibles à la demande. | Le client peut déposer plusieurs factures. En cas d’échec partiel, seuls les documents en échec sont repris, sans réimporter ceux déjà enregistrés. |

## Fiabilité et décisions techniques utiles

- **Mesures distinctes conservées** : cartons à réception d’une part, colis après optimisation d’autre part. Aucune recopie implicite vers les mesures finales.
- **Saisies manuelles** : un article commencé dans Factures reste disponible après un aller-retour vers une autre tâche, isolé par collaborateur et dossier. Il n’est ajouté au devis qu’après enregistrement explicite.
- **Travail parallèle** : factures et préparation sont deux tâches indépendantes. Les factures peuvent être vérifiées avant l’accord ; la préparation physique reste soumise à cet accord.
- **Protection des modifications concurrentes** : un brouillon reste visible lorsqu’un collègue change le dossier. L’écran Devis explique aussi ce conflit et propose une reprise explicite, au lieu de laisser un bouton désactivé sans explication.
- **Permissions Factures** : l’opérateur habilité à ajouter, refuser ou analyser une facture peut consulter son contexte de vérification. Les droits d’écriture et de validation restent contrôlés séparément ; aucun droit supplémentaire de modification n’est accordé.
- **Validation des factures** : après sauvegarde, la prochaine facture est choisie dans la version fraîche du dossier. Si un collègue a terminé la dernière facture entre-temps, le résumé reste affiché.
- **Tâche stable** : terminer une action, recevoir une mise à jour ou fermer une facture ouverte par lien direct ne change pas silencieusement l’écran en cours.
- **Notifications maîtrisées** : aperçu et envoi distincts, contrôle des permissions par canal, blocage d’un aperçu devenu obsolète, même clé lors de la reprise d’un envoi incertain. Pour l’email, le retour annonce l’ouverture d’un brouillon ; l’envoi doit être confirmé dans la messagerie.
- **Justificatifs Telegram** : la demande regroupée conserve explicitement le fait qu’elle demande des factures. Plusieurs réponses directes à cette demande peuvent alimenter les factures du dossier. Un document sans réponse explicite conserve les contrôles prudents existants ; les pièces non classées restent accessibles pour un rattachement manuel.
- **Migration ciblée** : ajout du contrat de rattachement des justificatifs ; aucun nettoyage de dossiers, aucune modification de mesure, aucun classement de facture réelle, aucun message client envoyé lors du déploiement.

## Vérification

Recettes exécutées avec des dossiers fictifs et interception des API métier : aucun essai ne crée de commande ou de notification réelle.

- Tests unitaires et domaine : **143 réussis** ; tests Edge : **53 réussis**.
- Base isolée : **76 assertions** sur le rattachement des justificatifs ; **172 contrôles** dans la suite factures/préparation, dont 26 sur les permissions de consultation. Courses concurrentes vérifiées sur les enregistrements.
- Factures : **52 scénarios navigateur** couvrant validation, avancement, brouillons, doublons, liens directs, erreurs, permissions, PDF et import depuis les échanges.
- Parcours par tâches : **5 scénarios**, préparation autonome : **7 scénarios**, notifications manuelles : **8 scénarios**, portail simplifié : **8 scénarios** ; conflits de devis et brouillons manuels : **4 scénarios**.
- Recettes complémentaires : recherche de référence, synchronisation entre collègues, réception, mesures, numérotation, organisation, devis et préparation/client.
- Accessibilité : **32 variantes globales sans violation détectée**, plus les contrôles des nouveaux écrans en clair/sombre et ordinateur/mobile. Correction du contraste du casier en thème sombre.
- Compilation de production, analyse statique et contrôle des différences : réussis.

Les tests automatiques vérifient les comportements décrits ; ils ne remplacent pas l’observation de l’équipe en situation réelle et ne démontrent pas un gain de temps chiffré. Aucun service WhatsApp ajouté.

## Publication

- Branche de livraison : `main`, dépôt `mmz97441/pinta`.
- Application : [expedile.app](https://expedile.app).
- Migrations `20260916000003` et `20260916000004` appliquées après répétition annulée et vérification des contrats en lecture seule.
- Fonctions `telegram-webhook` et `telegram-inbox-assign` publiées avec leur authentification existante conservée. La vérification JWT interne, le rôle actif et les permissions métier restent exigés pour le rattachement manuel.
- Aucun modèle personnalisé ne remplace la demande d’accord dans la base : les nouveaux textes par défaut prennent effet avec cette interface.
- Les nouvelles recettes sont intégrées au [contrôle GitHub de livraison](https://github.com/mmz97441/pinta/actions/workflows/verify-expedile.yml). La recette après publication utilise également des données fictives interceptées.

La version principale `590911c` a passé le [contrôle GitHub complet](https://github.com/mmz97441/pinta/actions/runs/35130341510) et **57 scénarios après publication**. Le complément de retour entre tâches est vérifié par **6 scénarios ordinateur/mobile** : navigation au clavier, conservation des brouillons d’articles et de mesures, respect des permissions, aucun changement de statut et retour exact à la liste. Ces scénarios sont également intégrés aux recettes de livraison.
