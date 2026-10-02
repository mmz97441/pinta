# Parcours quotidien : réception, dossier et conversation

Rapport du 1er octobre 2026. Demande : faciliter la réception au dépôt et le travail de plusieurs collègues, ouvrir les dossiers en pleine page, séparer le colis de sa conversation et rendre explicite la suite après l’accord client.

## Décisions appliquées

| Sujet | Décision et résultat |
| --- | --- |
| Ouverture d’un dossier | Un clic ouvre la fiche en pleine page. Les anciens liens `?dossier=…` rejoignent également cette fiche. Le retour conserve les filtres de la liste. |
| Deux onglets | **Colis** contient le travail opérationnel ; **Conversation** contient les échanges et un historique repliable « Ce qui a déjà été fait ». Un seul éditeur de réponse existe pour ce dossier. |
| Saisies en cours | Les deux onglets conservent leurs composants visités : mesures, frais, documents et réponse ne sont pas effacés en changeant d’onglet. Un message reste non lu tant que sa conversation n’est pas visible. |
| Conversations générales | La liste des conversations ouvre le même dossier, directement sur son onglet Conversation. Les messages sans dossier gardent un rattachement explicite au bon client et à la bonne expédition. |
| Réception | Écran dédié `/reception`, accessible depuis le bouton général, la fiche client et un dossier. Même formulaire et mêmes contrôles pour ces trois entrées. |
| Client et expédition | Choix explicite de l’expédition lorsque plusieurs sont ouvertes. Ajouter un carton ne crée pas une autre référence EXP. |
| Mesures reçues | Longueur, largeur, hauteur et poids obligatoires pour chaque carton. Les numéros continuent ceux du dossier. Le casier est proposé et reste modifiable. |
| Réception continue | **Enregistrer et ajouter un carton** enregistre puis prépare le suivant ; **Terminer la réception** termine le travail. Une confirmation identifie le carton et l’expédition enregistrés. |
| Reprise au dépôt | Brouillon conservé pour le même utilisateur dans la session du navigateur. Les photos non encore téléversées ne sont pas promises après rechargement. Les erreurs conservent les champs. |
| Connexion interrompue | Chaque ajout possède un identifiant stable ; une création conserve aussi son UUID de brouillon. Après une réponse perdue, la vérification retrouve le même dossier ou le même ajout, sans créer un deuxième carton ni une autre EXP. |
| Modification simultanée | Ajout atomique côté serveur, contrôle de version, permission de réception et prise en charge de la tâche. Un conflit demande une actualisation sans écraser le travail du collègue. |
| Ajout tardif | Un carton ajouté après accord ou optimisation impose de confirmer à nouveau l’accord et l’optimisation. Anciennes mesures, factures et historique sont conservés ; ils ne constituent plus une validation du nouvel ensemble. L’interface annonce l’impact avant confirmation. |
| Paiement déjà proposé | Un lien PayPlug actif bloque l’ajout jusqu’à sa fermeture par le parcours explicite de correction. Aucun lien n’est annulé implicitement. Les dossiers payés ou partis ne sont pas rouverts par la réception. |
| Demande d’accord | Proposition du message immédiatement visible, destinataire et canal lisibles, envoi volontaire. La mise en attente et l’enregistrement de la demande deviennent une seule opération serveur. Un échec de permission ou de validation n’installe pas une attente fictive. |
| Notifications | Enregistrer des mesures ou un carton n’envoie pas de message. Le collaborateur choisit l’envoi. Pour l’email, le bouton annonce l’ouverture d’un brouillon ; il ne prétend pas que l’email a été envoyé. |
| Accord reçu | La tâche **Optimisation** ouvre directement les poids et dimensions après réemballage. Consulter cet écran ne modifie pas l’état du dossier. |
| Optimisation enregistrée | Le bouton « Continuer » redondant disparaît quand sa propre tâche est déjà ouverte. Confirmation visible et bouton vers la suite utile : vérification des factures d’achat ou établissement du montant. Les mesures de réception restent séparées. |
| Travail en équipe | Les tâches d’optimisation, de factures et de conversation gardent leurs responsables propres. Ouvrir une fiche ne prend pas la tâche d’un autre. La conversation possède son bouton de prise en charge visible. Les commandes de relais et leurs consignes restent disponibles. Une réception terminée qui est rouverte par un ajout est remise à disposition, sans restaurer automatiquement l’ancien responsable. |
| Calcul | Formule existante conservée : la part de transport de chaque article dépend de sa valeur `quantité × prix unitaire HT`, puis ses taux OM/OMR s’appliquent à sa base incluant cette part. Les parts sont visibles dans le détail des articles lors de la vérification. |
| Taux douaniers | Recherche, propositions de nomenclature et correction justifiée des taux existantes conservées. Aucun taux ou texte fiscal n’est inventé par cette modification d’interface. |
| PayPlug | Mode de test et clés inchangés. Le retour client reste la page de confirmation dédiée, sans commandes internes d’équipe. |

## Point de vocabulaire comptable à confirmer

Une question a été posée sur « facture finale » : récapitulatif à régler avec PayPlug, ou facture comptable numérotée. Sans réponse à cette distinction, cette livraison conserve le mécanisme existant du devis et ne crée pas une numérotation comptable. Les factures d’achat reçues du client restent des justificatifs distincts du document Expedîle à régler.

## Contrôles et publication

- Analyse statique, compilation et **208 tests unitaires** réussis.
- **104 tests serveur** réussis avec prestataires simulés.
- **20/20 étapes de la séquence SQL CI complète** réussies dans PostgreSQL isolé : contrôles de permission, concurrence réelle entre deux connexions, rejeu après réponse perdue, invalidation des validations et répartition de transport sur deux codes SH.
- Nouvelle recette dossier : **22 scénarios** ; cycle opérationnel jusqu’à livraison : **20 scénarios** ; confirmation de paiement : **30 scénarios**.
- Réception vérifiée sur ordinateur/téléphone, clair/sombre : enregistrement continu, création, même EXP, scan, choix de dossier, rechargement et reprise après panne.
- Suites existantes rejouées pour les factures, corrections, relais, prise de tâche, recherche, droits, portail client et administration. Résultats détaillés dans la [recette QA](recette-parcours-simplifie-2026-10-01.md).
- Contrastes de liste vérifiés dans quatre configurations ; nouvelles pages contrôlées au clavier et avec axe, sans violation détectée ni débordement horizontal.
- Sauvegarde privée des définitions serveur ; répétition exacte du déploiement puis annulation : empreintes des **17 tables métier inchangées**, schéma restauré.

Les opérations de recette utilisent des dossiers fictifs et des prestataires simulés ; aucun message client ni paiement réel n’est déclenché. Les références de publication sont consignées après la mise en ligne.

La réussite de tests automatisés ne remplace pas un essai observé avec un collaborateur débutant, notamment au scanner sur le poste du dépôt.


## Aperçus de recette

Ces captures utilisent des personnes et des expéditions fictives.

- [Réception au dépôt](verification-parcours-2026-10-01/reception-desktop.png)
- [Optimisation en pleine page](verification-parcours-2026-10-01/optimisation-desktop.png)
- [Optimisation sur téléphone](verification-parcours-2026-10-01/optimisation-mobile.png)
- [Conversation sur téléphone](verification-parcours-2026-10-01/conversation-mobile.png)


## État de la publication

- Serveur : migration `20261001000001_reception_append` appliquée et vérifiée sur le projet Expedîle. Les deux commandes ont les droits attendus ; le registre de reprises est privé. Les empreintes des 17 tables contrôlées sont restées identiques pendant l’application.
- Empreinte SHA-256 de la migration appliquée : `6ce0ffaf1011393483dd3a97a6b4043a7f362a5efcfc92072c8d18777ca2574e`.
- Interface : version compilée et testée localement, publication GitHub/main/Vercel en attente d’une confirmation explicite demandée par le contrôle automatique d’approbation. Aucune nouvelle version de l’interface n’est annoncée comme en ligne à ce stade.
- Le contrôle automatique a refusé deux tentatives de publication, faute d’autorisation reconnue pour cet export précis. Le second refus mentionnait aussi une sauvegarde supposée indexée. La vérification explicite des 78 fichiers indexés confirme **zéro sauvegarde, fichier d’environnement ou fichier personnel préexistant**. Le scan des lignes ajoutées n’a trouvé aucun des formats de secrets contrôlés.
- Les sauvegardes de déploiement restent privées et ignorées par Git. Les captures du rapport représentent uniquement des données fictives.

La référence de commit, le résultat CI distant et le déploiement Vercel seront ajoutés après autorisation et publication. Le mode PayPlug reste celui des tests.
