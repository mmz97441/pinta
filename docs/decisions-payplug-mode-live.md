# PayPlug — distinguer les encaissements réels des simulations

**Mise à jour du 17 septembre 2026 :** l’utilisateur a confirmé le fonctionnement actuel en préproduction. `PAYPLUG_MODE=test` a été explicitement configuré ; voir le [compte rendu de configuration](configuration-preproduction-payplug-2026-09-17.md). Les règles ci-dessous décrivent les protections conservées et la décision historique du 10 septembre.

Décision du 10 septembre 2026, après constat par le chef d’ingénierie d’une clé PayPlug de test dans la configuration distante. Ce lot prépare le code et les migrations ; son auteur n’a effectué aucun appel PayPlug réel ni écriture de production.

## Règles appliquées

1. `PAYPLUG_MODE` vaut `live` par défaut. Le fonctionnement de test exige la valeur explicite `test`. Une valeur inconnue bloque le paiement.
2. En mode réel, une clé de test bloque `payplug-create` avant toute réservation ou requête fournisseur. L’erreur explique en français que la clé de production manque et qu’aucun lien de test ne sera envoyé.
3. Chaque nouvelle intention mémorise `provider_is_live`. Un ancien lien dont le mode est inconnu ou différent n’est jamais réutilisé silencieusement. Une nouvelle version du devis ou un rapprochement est nécessaire.
4. Avant de transmettre un nouveau lien, la réponse PayPlug doit correspondre au mode, au montant, à la devise, au dossier, à la version et à l’intention demandés. Un résultat incohérent reste à vérifier ; aucun lien n’est attaché au dossier.
5. Le webhook utilise la ressource obtenue auprès du fournisseur, jamais les montants du corps de notification. Un paiement moderne de test ne peut pas appeler la commande d’encaissement lorsque l’environnement est en mode réel. Un paiement déjà remboursé ne peut pas produire un premier encaissement complet.
6. Une ressource historique de test utilise une commande distincte, `ack_legacy_test_payplug_payment`. Elle peut seulement reconnaître un paiement déjà enregistré. Elle conserve les références, montants et contrôles du registre historique ; elle ne crée ni paiement ni points. Sa réponse expose `paymentMode: test` et `financialConfirmation: false`.
7. La commande SQL historique refuse elle-même tout **nouveau** règlement de test, même appelée avec le rôle de service. Un historique encore impayé reste impayé. Un paiement historique réel et vérifié reste traitable une fois.
8. Les anciens statuts payés ne sont pas réécrits à partir d’une supposition sur leur mode. Le registre conserve les observations historiques et la réponse vérifiée du fournisseur ; reconnaître une ancienne ligne n’équivaut pas à certifier un encaissement réel.

La commande d’accusé de réception des tests a un nom distinct : si une fonction Edge est déployée avant la migration, l’absence de cette commande provoque un échec, sans retomber sur l’ancien chemin d’encaissement.

## Parcours lorsque la clé réelle manque

La préparation et le calcul/sauvegarde du brouillon restent disponibles. Pour un particulier, publier le nouveau devis avec son lien de paiement est bloqué tant que la clé réelle manque : le statut et le message client ne sont modifiés qu’après réussite de la création du paiement. Le brouillon est conservé, sans faux « devis envoyé ». Les modalités professionnelles enregistrées restent un parcours distinct ; elles ne marquent jamais un paiement reçu à elles seules.

`services/functionErrors.js` lit le corps JSON conservé dans `FunctionsHttpError.context` pour rendre l’erreur métier française visible, au lieu du message générique non-2xx. Deux tests prouvent ce comportement et la conservation d’un repli explicite en cas de panne réseau.

Le chef d’ingénierie retire uniquement l’URL du dossier historique impayé dont le mode de test a été vérifié à distance. Ce retrait ne réécrit pas les anciens paiements ; le présent lot ne réalise pas cette opération. La mise en service effective des paiements réels dépend toujours d’une clé réelle valide et des vérifications du compte fournisseur.

## Preuves

- 7 tests Edge dédiés au mode, au rapprochement, à la réponse de création et aux remboursements : réussis dans `pinta/supabase/tests/payplug-mode.edge.test.cjs`.
- Revue indépendante backend ; 44 assertions SQL de mode et historiques réussies au total sous PostgreSQL 17, via `run-legacy-payments.sh` avec les migrations suivantes présentes.
- Les tests historiques d’encaissement utilisent désormais une ressource réelle fictive dans les fixtures (`is_live: true`). Les tests de simulations sont séparés : ils prouvent explicitement l’interdiction d’encaisser.
- Revue complémentaire OCR : chemin du document lié à l’extraction, vérification de l’empreinte et de la version sous verrou transactionnel ; ancien accès direct à la commande d’import révoqué. Le test Edge confirme la transmission des valeurs vérifiées au nouveau wrapper SQL.

Aucune preuve locale ne prétend démontrer un encaissement fournisseur réel ou remplacer les prérequis de configuration de production.
