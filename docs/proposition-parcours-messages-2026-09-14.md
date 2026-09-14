# Proposition de parcours des messages — 14 septembre 2026

**Statut : proposition à discuter. Aucun texte, déclencheur ou automatisme de messagerie n’a été modifié pour ce rapport.** La fusion envisagée concerne bien la confirmation de réception et la demande de feu vert, comme confirmé dans la demande.

## Ce qui justifie la simplification

Le parcours actuel prévoit une notification `reception`, puis une `demande_feu_vert`. Les deux répètent la réception, les cartons, la destination et la facture attendue. Le modèle de réception annonce encore une mesure à venir alors que le formulaire impose déjà les mesures à réception. La demande de feu vert ajoute dimensions, poids réel, poids volumétrique, détail des boutons et explications.

Les modèles utilisés viennent de `message_templates` lorsqu’un texte est enregistré, sinon de `services/messageDefaults.js`. La lecture des modèles concernés en production n’a trouvé aucun remplacement enregistré. Le fichier historique `constants/templates.js` contient aussi des versions plus longues ; toute future modification devra vérifier les textes réellement envoyés et les chemins de repli.

Autre incohérence : la variable `documents_attendus` distingue aujourd’hui facture validée et absence de validation. Une facture reçue mais encore à vérifier peut donc provoquer une nouvelle demande au client. Il faut distinguer absence de fichier, document reçu, facture en vérification et correction demandée.

## Ligne éditoriale proposée

- Une information utile, une question principale, des boutons dont le libellé décrit l’action.
- Référence d’envoi toujours visible ; le nombre de cartons et les fournisseurs suffisent dans le message initial. Détails de chaque carton, mesures avant/après optimisation et calculs restent dans le dossier.
- Bonjour au début d’une nouvelle étape. Un simple merci pour confirmer une réponse. Signature courte « L’équipe Expedîle ».
- Aucun pourcentage d’économie promis sans calcul propre à l’envoi ; aucune date de livraison ni annonce de début de préparation sans événement réel.
- Telegram si le client l’a relié, sinon le canal effectivement disponible. Pas de doublon Telegram + email par défaut, pas de WhatsApp.

## 1. Réception et accord : un seul message

Déclencheur proposé : réception enregistrée et mesures complètes de tous les cartons inclus dans la demande. Le message remplace les deux notifications actuelles. S’il manque un contrôle, le dossier reste à compléter côté équipe ; un simple accusé de réception peut rester nécessaire en cas de retard inhabituel, mais aucun feu vert ne doit être demandé sur des mesures incomplètes.

> Bonjour Camille,
>
> Nous avons reçu vos **2 cartons Amazon et Zara** à Paris pour l’envoi **EXP-EXEMPLE**, vers La Réunion.
>
> Souhaitez-vous que nous les préparions et optimisions ? Vous recevrez ensuite le devis final avant de régler.
>
> L’équipe Expedîle

Boutons principaux : **Préparer ces 2 cartons** et **Attendre d’autres cartons**. Option secondaire : **Ne pas préparer**. Lien discret : **Voir mon envoi**.

Si la facture manque réellement, ajouter seulement : « Merci de joindre la facture d’achat pour que nous puissions établir votre devis. » avec un accès au dépôt dans cet envoi. Si un document a déjà été reçu, remplacer par « Votre document est reçu et attend notre vérification. » Une facture déjà validée ne nécessite aucun rappel.

L’accord autorise la préparation et l’optimisation des cartons listés ; il ne signifie pas acceptation d’un montant encore inconnu. La facture est nécessaire au devis, mais son absence ne doit pas être présentée comme interdisant systématiquement la préparation autorisée.

## 2. Réponse au choix : une confirmation courte

Après « Préparer » :

> Merci, votre accord pour les 2 cartons de **EXP-EXEMPLE** est enregistré. Nous vous préviendrons lorsque le devis sera prêt.

Après « Attendre » :

> C’est noté, nous attendons vos prochains cartons pour **EXP-EXEMPLE**. Vous pouvez demander la préparation à tout moment depuis votre dossier.

Après « Ne pas préparer » :

> Votre choix est enregistré pour **EXP-EXEMPLE**. Notre équipe vous contactera pour organiser la suite.

La confirmation de choix ne doit pas être suivie d’un second message automatique répétant l’accord. « Accord enregistré » n’équivaut pas à « Préparation commencée ».

## 3. Facture : accusé de réception utile, correction précise

Le dépôt depuis l’espace client doit rester rattaché au dossier ouvert. Sur Telegram, une réponse au message de demande doit conserver son contexte. En cas d’ambiguïté entre plusieurs envois, demander un choix lisible, par exemple « EXP-EXEMPLE · Amazon/Zara · 2 cartons », sans attribuer silencieusement le document au dernier envoi.

Confirmation après enregistrement effectif :

> Merci, votre document est bien reçu pour **EXP-EXEMPLE**. Nous le vérifions ; inutile de le renvoyer.

Si le document est déjà identifié comme facture, utiliser « votre facture ». Un PDF quelconque ne doit pas être annoncé comme facture validée.

En cas de problème :

> Pour **EXP-EXEMPLE**, il manque la page avec les articles et les prix. Pouvez-vous joindre la facture complète ? Merci.

La demande doit nommer le défaut réel : page manquante, photo floue, document d’un autre achat. Éviter « facture non conforme » sans explication. Dès réception d’une pièce, suspendre les relances « facture manquante » pendant sa vérification. Si plusieurs achats restent sans justificatif, citer seulement ceux qui manquent.

## 4. Devis et règlement : montant, périmètre, action

> Bonjour Camille,
>
> Le devis de **EXP-EXEMPLE** est prêt : **84,60 € au total**, pour vos 2 cartons reçus, regroupés en 1 colis sortant.
>
> Consultez le détail et réglez pour permettre l’expédition.
>
> L’équipe Expedîle

Bouton : **Voir et régler mon devis**. Le total et les nombres sont des exemples ; les valeurs envoyées doivent provenir du devis effectivement publié. Pour les professionnels, afficher les modalités convenues plutôt qu’exiger un paiement immédiat si ce n’est pas leur contrat.

Le détail des mesures optimisées, frais, taxes et articles reste accessible avant le paiement dans le devis. L’ancienne valeur de réception ne doit jamais être présentée comme le poids ou les dimensions finaux.

Confirmation uniquement après paiement confirmé :

> Merci, votre paiement pour **EXP-EXEMPLE** est confirmé. Nous vous informerons du départ.

La consultation d’un lien de paiement ne vaut pas paiement. Éviter un doublon si le même événement génère déjà un reçu clair sur le canal utilisé.

## 5. Départ et livraison : informer seulement lorsqu’il y a du nouveau

Au départ effectif :

> Bonjour Camille, **EXP-EXEMPLE** a quitté Paris pour La Réunion. Vous pouvez suivre son acheminement ici.

Bouton : **Suivre mon envoi**.

À l’organisation effective de la remise :

> Bonjour Camille, la livraison de **EXP-EXEMPLE** est prévue le **[date et créneau confirmés]**. Merci de vérifier votre disponibilité.

Une arrivée sur le territoire sans action client reste visible dans le suivi. Envoyer un message supplémentaire seulement si une prise de rendez-vous, un retrait, un retard ou un autre changement utile le justifie. Ne jamais annoncer « en livraison aujourd’hui » à partir d’une simple arrivée.

## Relances proposées

- Première relance après deux jours sans réponse, seconde après cinq jours, puis prise en charge humaine si le dossier reste bloqué. Cadence proposée à confirmer, pas appliquée.
- Une relance traite seulement l’action encore attendue. Ne pas redemander un accord obtenu ou un paiement confirmé.
- Aucune relance de feu vert pendant une attente volontaire active. Ne pas relancer un justificatif déjà reçu et en vérification.
- Un message client non traité doit être examiné avant une relance automatique ; cette protection existe déjà et doit être conservée.
- À chaque envoi, réexaminer la situation réelle et les notifications déjà livrées pour éviter les doublons entre les membres de l’équipe.

## Réception de cartons supplémentaires

Conserver la référence de l’envoi et annoncer le changement :

> Bonjour Camille, un nouveau carton Zara est arrivé pour **EXP-EXEMPLE**. Votre envoi compte maintenant **3 cartons**. Souhaitez-vous les faire préparer ou attendre encore ?

Regrouper les réceptions d’une même opération pour éviter un message par carton scanné. Un accord précédent couvre une composition précise : aucun nouveau carton ne doit être ajouté silencieusement à l’accord déjà donné. Une nouvelle demande doit identifier la composition mise à jour ; les boutons d’une ancienne demande ne doivent pas autoriser une autre composition.

## Points à préserver lors d’une éventuelle mise en œuvre

1. Une seule notification initiale par réception et composition ; envoi idempotent même si deux agents interviennent.
2. Mesures complètes avant demande, consentement lié aux cartons présentés et refus/attente toujours disponibles.
3. Intention de demande de facture conservée malgré la fusion : le mécanisme actuel reconnaît explicitement `facture_manquante`. Modifier uniquement le texte casserait le rattachement automatique après une demande combinée.
4. Confirmation de réception du document uniquement après stockage et rattachement réussis.
5. Relances arrêtées par le bon événement métier, indépendamment de la lecture des messages.
6. Choix de canal et traitement des erreurs de livraison visibles pour l’équipe.

Le parcours standard compterait ainsi **quatre notifications principales** : réception avec choix, devis, départ, organisation de la livraison. Les confirmations courtes, réceptions supplémentaires et demandes de correction s’ajoutent uniquement lorsqu’un événement les justifie.
