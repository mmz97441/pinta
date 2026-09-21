# Expedîle — simplicité pour un débutant de 14 ans

## Objectif et constat

Objectif rappelé par Guillaume le 20 septembre 2026 : une personne débutante
doit pouvoir utiliser l’application sans connaître son organisation interne,
côté équipe comme côté client. Une interface sobre et des tests qui passent ne
suffisent pas à démontrer cet objectif.

Les [85 points de septembre](implementation-simplicite-2026-09-17.md) ont apporté
des améliorations réelles. La nouvelle lecture croisée constate néanmoins des
ruptures entre écrans : actions masquées par une attente, boutons qui demandent
un second clic identique, états vides trop génériques et formulaires déjà
traités toujours présents à la vérification finale. La prise de tâche en un clic
ne répondait qu’à une partie du problème.

Ce document est le critère commun des prochaines modifications ; il ne certifie
pas que tous les écrans ont déjà réussi une étude auprès de débutants.

## Règle commune

Chaque écran doit permettre de répondre sans aide à :

1. **Que se passe-t-il ?** Une situation concrète, pour le bon client et la bonne expédition.
2. **Que dois-je faire ?** Une action principale explicite, ou qui doit agir si je dois attendre.
3. **Est-ce enregistré ?** Une confirmation visible ; en cas d’échec, la saisie et une façon de continuer.

Le titre et le bouton emploient un verbe courant. Le bouton ouvre le travail
annoncé. Les détails se consultent volontairement ; les alertes nécessaires
restent visibles. On retire les répétitions avant d’ajouter des explications.

## Parcours attendu

| Écran / famille | Ce que la personne doit comprendre et faire |
| --- | --- |
| Connexion, invitation, récupération | Quel compte est utilisé ; entrer ou retrouver son accès ; savoir où le lien a été demandé. |
| Équipe — Mon travail | Voir sa tâche ou en prendre une ; comprendre une attente ; sortir d’une liste vide sans deviner un réglage. |
| Équipe — Recherche et dossier | Trouver une expédition par client/référence ; identifier les cartons ; revenir à sa liste sans perdre sa place. |
| Réception | Choisir le client et l’expédition ; mesurer chaque carton ; enregistrer. Même référence d’expédition, numéros de cartons successifs. |
| Accord client | Voir si la demande est partie, si le client a répondu ou demandé d’attendre ; envoyer volontairement une demande courte. |
| Préparation | Regrouper/réemballer puis mesurer les colis prêts à partir ; enregistrer sans devoir établir le devis. |
| Factures équipe | Voir la facture à vérifier ; corriger les articles ; valider ou retirer une copie ; savoir ce qu’il reste à faire. |
| Devis | Compléter ce qui manque ; enregistrer ; relire montant et destinataire ; envoyer. Revenir à la modification reste explicite. |
| Paiement, départ, livraison | Voir ce qui bloque réellement ; effectuer l’action autorisée ; distinguer paiement reçu et livraison confirmée. |
| Conversations | Lire la demande et répondre ; conserver son texte en consultant un document ; connaître le résultat de l’envoi. |
| Équipe et réglages | Organiser les personnes et les droits au second niveau ; enregistrer explicitement ; distinguer suivi du dossier et réalisation d’une tâche. |
| Clients et estimation | Retrouver ou compléter un client ; savoir qu’une estimation n’est pas un devis envoyé. |
| Client — Accueil et expéditions | Comprendre ce qu’il doit faire maintenant et accéder directement au bon endroit. |
| Client — Accord | Autoriser les cartons présents ou attendre d’autres achats ; comprendre que le devis suivra la préparation. |
| Client — Factures | Déposer ou remplacer le bon fichier ; reconnaître les factures actuelles et les anciennes copies ; savoir si le dépôt a réussi. |
| Client — Devis et paiement | Voir le montant et les modalités ; payer uniquement un devis actif ; obtenir les détails s’il le souhaite. |
| Client — Suivi | Voir la dernière nouvelle et le suivi du trajet vers son adresse, distinct du suivi fournisseur. |
| Client — Profil et aide | Modifier ses coordonnées, retrouver ses documents et joindre l’équipe sans connaître l’organisation interne. |

L’inventaire complet des routes, fenêtres et cas secondaires reste celui de
[l’audit du 17 septembre](audit-simplification-expedile-2026-09-17.md).

## Décisions transversales

- **Une interface commune, sans mode “débutant” à découvrir.** Les actions fréquentes sont directes ; les fonctions avancées restent accessibles à la demande.
- **Une pause ne masque pas une autre demande.** Attendre des achats ne dispense pas de corriger une facture ou répondre à un message.
- **Chaque bouton annonce sa destination.** “Corriger une facture” ouvre les factures ; “Répondre” ouvre les échanges.
- **Pas de fausse absence de travail.** Distinguer chargement échoué, filtre actif, disponibilité, tâches attribuées ailleurs et absence de tâche.
- **Une seule référence pour l’expédition.** Les cartons, factures, devis et échanges restent liés à cette référence.
- **Mesurer et facturer sont deux travaux.** Le préparateur n’a pas à comprendre la formule de transport pour saisir longueur, largeur, hauteur et poids.
- **Consulter ne valide rien.** Conserver Précédent, liste et Suivant ; les corrections de statut restent distinctes.
- **La vérification finale permet de relire.** Les formulaires de classement et de frais reviennent seulement si la personne choisit de modifier ; leurs valeurs restent consultables.
- **Les collègues peuvent travailler en parallèle.** Un parcours lisible ne doit pas imposer que la même personne réalise préparation, factures et devis.
- **L’envoi reste volontaire.** Un enregistrement, une consultation ou une prise de tâche ne déclenche pas de nouvelle notification client.

Ces règles sont également inscrites dans [AGENTS.md](../AGENTS.md) pour les
prochains intervenants sur le dépôt.

## Recette de compréhension à réaliser

Faire essayer des données fictives à des personnes qui ne connaissent pas
l’application, dont un adolescent d’environ 14 ans et des adultes peu à l’aise
avec le numérique. L’observateur donne le résultat à obtenir, sans indiquer les
boutons. Aucun paiement réel, compte réel ou choix douanier réel n’est nécessaire.

| Personne | Exercice |
| --- | --- |
| Équipe | Prendre une tâche disponible et dire qui s’en occupe ensuite. |
| Équipe | Enregistrer deux cartons pour la même expédition et retrouver le second. |
| Équipe | Enregistrer les mesures après réemballage sans toucher au devis. |
| Équipe | Vérifier deux factures, retirer une copie et expliquer combien restent à vérifier. |
| Équipe | Relire un devis préparé, revenir à la modification, puis expliquer si le client a été averti. |
| Équipe | Expliquer pourquoi un départ attend et trouver la personne/action qui peut le débloquer. |
| Client | Trouver et remplacer la facture demandée, y compris pendant une pause de préparation. |
| Client | Donner son accord ou demander d’attendre, puis expliquer la portée de son choix. |
| Client | Lire une demande et répondre sans perdre son texte en ouvrant une facture. |
| Client | Trouver le montant à payer et le suivi du colis après son départ. |

Noter : réussite sans indication du bouton, hésitations, retours involontaires,
erreurs, besoin d’aide et compréhension du résultat. Si un exercice nécessite
d’expliquer l’interface, revoir cet écran et refaire l’essai. Les compétences
métier se testent séparément de la compréhension de l’interface.

**État : ces essais humains n’ont pas été réalisés dans cette session.** Les
recettes automatiques vérifient les comportements, les permissions, la
conservation des données et certains critères d’accessibilité ; elles ne
remplacent pas cette observation.
