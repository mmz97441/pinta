# Compatibilité des liens PayPlug historiques — 10 septembre 2026

La sauvegarde préalable au déploiement contient six dossiers portant un identifiant PayPlug sans version de devis ni registre de tentative moderne : un devis envoyé de 37,98 € et cinq dossiers déjà marqués payés. Cette adaptation préserve leurs références historiques sans créer de paiement pendant la migration.

| Décision | Comportement et raison |
|---|---|
| Registre historique fermé | `legacy_payplug_payments` capture uniquement les liens déjà présents au passage de la migration `20260910000012`. Aucun dossier créé ensuite ne peut rejoindre cette voie ; les insertions ultérieures sont interdites. |
| Références immuables | Identifiant fournisseur exact, dossier, client, référence, montant en centimes, devise EUR, email attendu et hypothèses du devis sont figés. Le navigateur ne peut ni lire ce registre ni appeler sa confirmation. |
| Vérification auprès du fournisseur | Le webhook commence toujours par relire le paiement chez PayPlug avec la clé serveur et vérifie identifiant, environnement test/réel, état payé, montant et devise. Le corps de notification n’apporte aucune preuve de paiement. |
| Métadonnées historiques exactes | La compatibilité exige `colis_id` et `colis_ref` tels qu’enregistrés ; un éventuel `client_id` doit aussi correspondre. Une présence de `quote_version` ou `intent_id` empêche le passage dans la voie historique. |
| Identité de facturation vérifiée | L’email de facturation retourné par PayPlug doit correspondre au client figé. L’ancienne fonction retirait les caractères `+` des emails ; seule cette transformation historique est conservée pour ce rapprochement. Les anciennes adresses postales factices ne constituent pas une preuve d’identité. |
| Aucun contournement d’un devis moderne | Un échec de confirmation moderne n’est jamais réessayé par la compatibilité. Une tentative moderne déjà enregistrée pour le dossier interdit également la confirmation historique. |
| Paiement historique encore attendu | Après tous les contrôles, une commande transactionnelle verrouille client, dossier et référence historique puis utilise le même enregistrement comptable que les paiements modernes. Montant exact, un seul paiement, une seule attribution de points. |
| Paiement déjà constaté avant migration | Une notification vérifiée est acquittée sans créer de ligne comptable supplémentaire, sans ajouter de points et sans modifier la date du paiement historique. Les valeurs existantes doivent toujours correspondre à la capture. |
| Invalidation irréversible | Modifier les montants, mesures, cartons, hypothèses, articles/factures, destination ou type du client invalide le lien historique. Remettre le devis en brouillon, annuler ou revenir en préparation l’invalide également. La compatibilité ne peut pas être réactivée. |
| Appartenance documentaire immuable | Une facture ou un article ne peut plus changer de `colis_id`. Cette garde ferme un contournement où seule la nouvelle association invalidait son devis, laissant l’ancien dossier sans document et son devis encore payable. |
| Remboursement et incohérences | Un paiement remboursé, inconnu, incomplet ou ne correspondant plus au dossier reste un cas de rapprochement explicite. Aucune recette n’est inventée pour faire disparaître l’erreur. |
| Preuve de première vérification | Le registre conserve la première ressource vérifiée, limitée aux informations nécessaires au rapprochement, sans données de carte. Cette preuve et sa date restent immuables. |

Le principe de relire la ressource reçue en notification par une requête GET authentifiée suit la [documentation officielle PayPlug](https://docs.payplug.com/api/apiref.html#notifications).

Les tests supplémentaires sont séparés des scénarios existants : `legacy-payments.edge.test.cjs` pour le webhook et `run-legacy-payments.sh` pour une base PostgreSQL 15 jetable sans réseau, avec fixtures synthétiques avant application de la migration. La suite Edge conserve également les tests des paiements modernes. Aucun appel fournisseur réel et aucune écriture de production n’ont été exécutés par ce sous-travail ; le responsable du déploiement applique et vérifie les migrations et fonctions.

Dernier résultat local après revue indépendante backend : 31 assertions SQL réussies, 7 tests Edge historiques réussis et les 9 tests Edge existants toujours réussis. Le conteneur de test a été supprimé automatiquement après ce passage.

L’ordre de déploiement doit éviter la création de liens par l’ancienne fonction entre la capture du registre et son remplacement : un lien historique produit après la capture ne sera volontairement pas admis. Le responsable du déploiement a reçu ce point de coordination.
