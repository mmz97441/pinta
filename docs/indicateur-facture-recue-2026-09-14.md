# Indicateur de facture reçue — 14 septembre 2026

## Comportement livré

La liste **Colis** affiche **Facture reçue · À vérifier** dans la colonne Action / étape et sur les cartes mobiles. Plusieurs factures donnent un compteur, par exemple **2 factures reçues · À vérifier**.

Le même lien apparaît sur les actions du dossier dans **Mon travail** (l’ancien accueil « À traiter ») et dans les lignes de travail de l’équipe. Les missions, filtres et responsables existants sont conservés ; consulter une facture ne s’attribue pas l’action.

Un clic ouvre directement la première facture restant à vérifier dans son dossier, avec aperçu du document et focus clavier. En préparation, l’onglet Document s’ouvre aussi sur mobile. Le retour conserve les filtres de la liste ou de la file de travail.

## Décisions métier

- L’indicateur est calculé à partir des factures enregistrées, et non du statut lu/non lu du message. Il persiste si un collègue lit ou traite la conversation.
- Seules les factures avec un fichier réellement joint, non validées, non refusées et non remplacées sont comptées. Une simple pièce jointe non encore enregistrée comme facture reste dans « Documents reçus à vérifier ».
- Après validation d’une facture, le compteur diminue et le lien cible la suivante. Après validation de toutes les factures, l’indicateur disparaît. La synchronisation des dossiers existante transmet les changements entre membres de l’équipe.
- Les dossiers payés, archivés ou clos n’affichent pas une invitation à effectuer une vérification indisponible. Leurs documents restent consultables dans les écrans existants.
- L’ouverture du document ne le valide pas. Les actions de validation et de correction gardent leurs permissions et contrôles existants.
- Aucun état supplémentaire, notification sortante ou migration de base n’est créé. Les textes et déclencheurs de messagerie restent inchangés ; leur révision fait l’objet d’une proposition distincte.

## Vérifications

- Lint et compilation réussis ; **114 tests applicatifs réussis**, dont 5 tests des règles de l’indicateur.
- **7 scénarios navigateur** spécifiques : messages déjà lus, aperçu du bon PDF, validation partielle et compteur, Mon travail, file commune sans attribution implicite, accès mobile à la facture en préparation, validation par un collègue.
- **9 scénarios existants de documents reçus** réussis : aperçu, import, doublons, erreurs, droits et dossiers clos.
- **26 contrôles de l’espace de travail** réussis, dont accessibilité des écrans Mon travail, Équipe et Conversations sur ordinateur/mobile en thèmes clair/sombre.
- Deux défauts détectés pendant la vérification ont été corrigés : contraste du badge en thème sombre et défilement effectué avant que l’onglet Document soit visible sur mobile.

Les scénarios navigateur utilisent des données fictives avec interception des API, fichiers et WebSockets externes. Aucun document client, message réel ou paiement n’a été modifié par ces tests. Le nouveau parcours est ajouté aux vérifications GitHub Actions.
