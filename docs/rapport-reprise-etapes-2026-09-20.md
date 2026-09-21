# Reprendre une étape sans recommencer tout le dossier

Date : 20 septembre 2026. Application : Expedîle / Pinta.

## Demande

Revenir sur une étape doit permettre de corriger le travail enregistré, puis de poursuivre. La simple consultation d’une étape ne doit ni changer le statut ni envoyer un message. Le parcours doit rester compréhensible par un débutant de 14 ans, côté équipe et côté client.

## Décisions et modifications

| Situation | Fonctionnement retenu | Raison |
| --- | --- | --- |
| Précédent / Suivant / liste des étapes | Consultation, sans écriture. | Relire ne signifie pas recommencer. |
| Mesures à réception déjà enregistrées | Modifier, valeurs préremplies par carton, Enregistrer ou Annuler. Même nombre de cartons et mêmes suivis. | Corriger une mesure ne crée pas une nouvelle expédition ni un nouveau carton. |
| Mesures après optimisation déjà enregistrées et devis établi | Modification indépendante, avec possibilité d’ajuster le nombre de colis préparés. | L’emballage final peut regrouper plusieurs cartons reçus. |
| Mesures modifiées | Retirer le devis dépendant, conserver les factures, l’accord et l’autre série de mesures. | Ne refaire que ce qui dépend de la correction ; les mesures reçues interviennent aussi dans la comparaison avant/après. |
| Aucune valeur réellement modifiée | Aucune écriture ni invalidation. | Éviter les reprises de devis inutiles. |
| Devis envoyé, pas encore payé | Modifier le devis, confirmation de l’impact, puis reprise avec articles, taux, frais et mesures conservés. | Recalculer sans ressaisir le dossier. |
| Accord déjà reçu, refus ou attente demandée par le client | Demander un nouvel accord, puis préparer et envoyer volontairement la demande. | L’équipe garde la main et l’historique reste lisible. |
| Demande sans réponse | Préparer une relance ; ne pas effacer la demande pour la répéter. | Distinguer un rappel d’un nouvel accord. |
| Anciens boutons Telegram | Une nouvelle demande rend les réponses aux demandes précédentes inutilisables. | Empêcher qu’un ancien message autorise la nouvelle procédure. |
| Aperçu de message ouvert chez un collègue | Refus si la demande a été remplacée, même avec les mêmes cartons. | Un aperçu ancien ne doit pas être envoyé au titre d’une nouvelle demande. |
| Modification concurrente | Refus d’écrasement, saisie conservée, rechargement explicite. | Protéger le travail des 3 à 5 personnes de l’équipe. |
| Paiement enregistré, transport commencé, archive ou annulation | Lecture seule pour ces corrections. | Une correction de saisie ne doit pas effacer un encaissement ou un départ réel. |
| Permissions | Droit de correction et droit de réaliser la tâche, vérifiés côté serveur. | Le bouton n’est pas la seule protection. |

## Paiement et notifications

Une correction qui retire un devis doit aussi retirer son ancien lien PayPlug. L’API vérifie et annule le paiement distant avant d’enregistrer la correction. Si PayPlug confirme un paiement déjà réalisé, l’application bloque cette correction ; aucun remboursement automatique n’est effectué. Si l’annulation du lien réussit mais qu’un collègue a modifié le dossier entre-temps, l’erreur doit distinguer le lien retiré de la correction non enregistrée.

L’annulation utilise le contrat officiel PayPlug `PATCH /payments/{id}` avec `aborted: true`, et vérifie la réponse du prestataire. [Documentation PayPlug](https://docs.payplug.com/api/apiref.html#abort-a-payment).

L’environnement PayPlug reste en **test**. La reprise d’une étape n’envoie aucune notification. Telegram et l’espace client nécessitent une action explicite ; un email ouvre un brouillon dont l’envoi reste à confirmer dans la messagerie.

## Organisation et vérifications

Travail réparti entre interface, base et règles métier, communications et paiement. Intégration et contrelecture centrales. Les scénarios couvrent navigation sans écriture, valeurs préremplies, annulation, absence de modification, permissions, conflits, conservation des données utiles et obsolescence des anciennes demandes.

Vérifications locales : **183 tests JavaScript**, **92 tests Edge** et **19 scénarios navigateur dédiés à la reprise** réussis. Les **10 scénarios de messages** confirment notamment le refus des anciens aperçus. **70 contrôles SQL dédiés** couvrent les permissions, les anciennes demandes Telegram, la preuve d’annulation PayPlug, l’historique et deux sessions concurrentes réelles.

Le formulaire de préparation attend aussi le rechargement confirmé après un conflit avant de proposer une comparaison ou une reprise. Un échec de chargement conserve la saisie et permet de réessayer. Une réponse tardive concernant un autre dossier ne remplace pas le dossier ouvert. La comparaison des versions conserve la précision des horodatages de la base.

Le contrôle complet a révélé une concurrence de focus sur mobile : le résumé d’erreur pouvait reprendre le focus au champ invalide. Une seule cible est maintenant choisie après le rendu. La recette vérifie aussi les erreurs successives, les pannes réseau et la reprise de frappe. Les tests douaniers et réception ont été adaptés aux actions explicites et aux détails repliés ; leurs 21 et 4 scénarios passent sans modifier les exigences de calcul ou de conservation des données.

La migration a été répétée avec succès sur la base de préproduction dans une transaction annulée. Les définitions existantes et les fonctions Telegram ont été sauvegardées dans un dossier privé exclu du dépôt public.

Voir [la recette détaillée](verification-reprise-etapes-2026-09-20.md) et [les contrôles messages/paiement](correction-etapes-securite-client-paiement-2026-09-20.md).

État de livraison : **contrôle final et publication en cours**. Ce document sera complété avec les résultats et la version déployée. Aucun test automatique ne remplace une séance d’observation avec des utilisateurs débutants.

Les autres simplifications d’interface de cette livraison sont détaillées dans [le rapport de simplicité](rapport-simplicite-parcours-2026-09-20.md).
