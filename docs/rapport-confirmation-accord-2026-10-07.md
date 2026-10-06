# Confirmation après l’accord du client et rappel de facture

## Demande (6 octobre 2026)

« Si oui, nous lui demandons sa facture. » Après la réponse du client à la demande de préparation, il reçoit une confirmation claire. Si sa facture d’achat manque encore, cette confirmation la lui demande.

## Ce qui change pour le client

Quand il répond avec les boutons Telegram de la demande de préparation :

- **Accord donné, facture déjà reçue (ou client professionnel)** : « Bonjour Flavie 👋 Merci, votre accord pour EXP-… est bien enregistré ✅ Notre équipe va préparer vos cartons, puis vous recevrez le devis. »
- **Accord donné, facture encore attendue** : le même message, avec « 📄 Il nous manque encore votre facture d’achat, nécessaire pour établir votre devis : envoyez-la en réponse à ce message (photo ou PDF) ou déposez-la dans votre espace client. »
- **« Attendre »** : le message dit que les cartons sont conservés et que le client pourra donner son accord quand il le souhaite.
- **Refus** : le message dit que les cartons ne seront pas préparés et que l’équipe le contactera.
- **Réponse impossible à enregistrer** : un message simple l’invite à réessayer depuis son espace client ou à écrire ici, sans erreur technique.

Si le client envoie sa facture **en réponse** au message qui la demande, elle est enregistrée comme facture du dossier, comme pour la demande de préparation.

Dans son espace client, le bloc « Accord donné » rappelle la facture manquante, avec le bouton « Joindre mes factures ».

## Ce qui change pour l’équipe

- La confirmation est un message enregistré dans la conversation du dossier, envoyé par la file d’envoi habituelle. On voit donc s’il est parti, en attente ou en échec.
- Si la confirmation ne peut pas partir (modèle invalide, panne), la décision du client reste enregistrée. L’historique du dossier l’indique.
- **Paramètres › Modèles** : quatre nouveaux modèles sont modifiables, en Telegram et en email. Les emails restent des brouillons manuels.
  - Accord confirmé.
  - Accord confirmé avec facture manquante.
  - Attente enregistrée.
  - Refus enregistré.
- Un modèle enregistré par la direction remplace toujours le texte par défaut.
- **Tous les textes par défaut** sont signés « L’équipe Expedîle » en texte simple. Les anciens « _Expedîle_ » apparaissaient tels quels chez le client, avec leurs tirets bas.
- Les libellés de l’éditeur de modèles n’ont plus d’emoji et parlent d’« accord ».

## Choix retenus

- **Une seule facture enregistrée automatiquement** : seul le premier document envoyé en réponse devient la facture. Un second document (autre achat, pages supplémentaires) reste dans la conversation et l’équipe l’importe.
- **Réponse explicite nécessaire** : un document envoyé sans répondre au message de confirmation suit les règles habituelles.
- **Aucune date de départ promise** dans ces messages, et jamais « préparation en cours » pour un simple accord.

## Vérifications

- **Recette locale** :
  - lint, tests unitaires et compilation ;
  - 176 tests serveur, dont 10 tests du webhook (choix du modèle, modèle enregistré prioritaire, échec sans renvoi, mise à jour Telegram traitée une seule fois) ;
  - les suites navigateur, dont le rappel dans l’espace client, en clair et en sombre, sur téléphone et ordinateur.
- **Base de données** : 110 contrôles pour la nouvelle règle de facture en réponse (délai de 7 jours, facture déjà reçue, cas existants inchangés). Toutes les suites SQL existantes ont été rejouées.
- **Déploiement** : la migration suit le contrôle préalable, la répétition annulée, l’application et la vérification. Cinq fonctions Edge sont redéployées puis comparées au code livré :
  - telegram-webhook ;
  - relances-auto ;
  - invoice-quote-withdrawal ;
  - client-invoice-deposit ;
  - telegram-inbox-assign.
