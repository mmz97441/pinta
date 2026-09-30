# Retour de paiement client et lisibilité des dossiers

Rapport du 30 septembre 2026. Demande : après le règlement, le client doit voir une confirmation simple et la suite de son envoi ; aucune commande de prise de tâche ou d’affectation à un départ. La capture signalait aussi une ligne presque illisible dans la liste sombre.

## Causes constatées

- `payplug-create` renvoyait vers `/colis/:id?payment=returned`. Cette route choisissait l’écran selon la session du navigateur : un compte d’équipe ouvert conduisait donc à la fiche de travail interne. Le problème constaté ne prouve pas qu’un compte client avait reçu des permissions d’équipe.
- En thème sombre, la couleur du texte était adaptée mais la classe de survol `hover:bg-gray-50` conservait un fond presque blanc. Le texte clair devenait illisible.

## Décisions appliquées

| Sujet | Comportement |
| --- | --- |
| Retour de paiement | Page dédiée `/paiement/retour`, indépendante des écrans et du chargement des données d’équipe. Même présentation pour un visiteur, un client connecté ou un salarié connecté. |
| Confirmation | « Paiement reçu » uniquement après rapprochement enregistré du paiement, du montant et de la version du devis. Une URL de retour ne valide jamais le règlement. |
| Paiement de test | « Paiement de test confirmé », avec mention explicite de l’absence d’encaissement réel. Un mode inconnu ne produit pas de confirmation de paiement réel. Aucun changement de clé ou de mode PayPlug. |
| Retard de confirmation | Message d’attente, vérifications automatiques limitées, puis bouton de vérification. Une réponse absente expire après 15 secondes ; l’utilisateur peut réessayer. Aucun bouton invitant à payer une seconde fois. |
| Annulation | Le paramètre de retour « cancelled » n’est pas une preuve d’échec. Un paiement déjà confirmé reste confirmé. |
| Prochain départ | Date affichée seulement si le dossier est réellement affecté à un départ pertinent. Sans affectation, la page explique que l’équipe prépare la suite pour le prochain départ disponible et que la date reste à confirmer. |
| Clôture du chargement | La clôture des ajouts ne retire pas la date prévue d’un colis déjà affecté. Un départ annulé ou une ancienne date dépassée ne sont pas présentés comme une nouvelle promesse. |
| Envoi déjà parti ou livré | L’événement enregistré remplace le message « prochain départ ». La date de départ n’est pas présentée comme une date de livraison. |
| Nouveaux liens | Jeton aléatoire de 256 bits limité à une intention de paiement, valable 90 jours. Seule son empreinte est enregistrée. Informations retournées limitées au paiement et au suivi de cet envoi. |
| Anciens liens | Interception du retour historique avant l’interface générale. Une session propriétaire ou un salarié habilité est nécessaire ; sinon une connexion est proposée sur la page de confirmation. Aucun lien de paiement existant n’est recréé. |
| Ancien devis | Un lien remplacé ne récupère pas la confirmation ou la promesse de départ d’un devis plus récent. |
| Confidentialité | Le retour ne charge ni tâches, ni noms de collaborateurs, ni coordonnées client, ni autre dossier. Réponses non mises en cache et politique de référent restrictive. |
| Liste des dossiers | Fonds de repos, survol, sélection et focus adaptés au thème. Sélection conservée au survol ; focus clavier visible. Correction limitée à cette liste et à ses contrôles. |

Le retour PayPlug est distinct de la notification de confirmation serveur ; cette séparation correspond au [guide officiel de confirmation PayPlug](https://docs.payplug.com/api/guide-payment-fr.html). Le retour créé ici reste une lecture : il ne valide pas un paiement, ne modifie pas le dossier et ne contacte pas le prestataire pour créer un règlement.

## Vérifications réalisées

- Analyse statique, 200 tests unitaires et compilation réussis.
- 104 tests des fonctions serveur réussis, avec PayPlug et les services externes simulés.
- 37 contrôles PostgreSQL réussis : droits, liens expirés, identité, montants, ancien devis, confirmation retardée et dates de départ. La transaction exacte de déploiement a aussi été répétée puis annulée ; les empreintes de 17 tables métier et de notification sont restées identiques.
- 30 scénarios navigateur du retour de paiement réussis : visiteurs, clients, équipe, anciens liens, erreurs, annulation, confirmation tardive, réponses périmées, double clic, modes test/réel et absence de commandes internes.
- Contrôles d’accessibilité du nouvel écran sur téléphone, en thèmes clair et sombre : aucune violation axe détectée, aucun débordement horizontal.
- Contraste de la liste : quatre configurations ordinateur/téléphone et clair/sombre, 26 états mesurés. Texte au moins 4,71:1 ; focus au moins 8,58:1. Aucune modification métier lors de ces essais.

Les écritures de recette sont effectuées sur des données fictives ou PostgreSQL isolé. Aucun paiement réel ni message client n’est déclenché. La migration distante a été sauvegardée, répétée avec annulation, appliquée et vérifiée : deux colonnes ajoutées, une fonction de lecture réservée au serveur, données métier préservées. La preuve de publication complète est ajoutée après la vérification finale.

## Aperçus

- [Confirmation sur ordinateur](verification-retour-paiement-2026-09-30/receipt-desktop.png)
- [Confirmation sur téléphone en mode sombre](verification-retour-paiement-2026-09-30/receipt-mobile-dark.png)
- [Dossiers en mode sombre](verification-retour-paiement-2026-09-30/dossiers-dark.png)

## Limites explicites

- Une confirmation bancaire encore absente du serveur reste affichée en attente : la page ne transforme pas un retour navigateur en preuve de règlement. Un paiement nécessitant un rapprochement manuel reste à vérifier avec l’équipe.
- Les anciens liens sans jeton requièrent une connexion autorisée. Après expiration d’un nouveau lien, l’équipe peut renseigner le client ; aucun accès permanent à ses données n’est créé.
- Le message de départ décrit les données enregistrées. Il ne réserve pas de place et ne remplace pas la confirmation opérationnelle du chargement.
- Les contrôles automatiques vérifient les comportements et les contrastes. Ils ne remplacent pas un essai observé avec des clients et collaborateurs débutants.
