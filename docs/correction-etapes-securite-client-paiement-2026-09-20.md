# Reprise d’étape : accord client et paiement

Lot technique du 20 septembre 2026. Ces contrôles sont locaux et isolés ; ce document ne certifie ni le déploiement, ni un essai réel chez PayPlug.

## Accord client

- Chaque demande d’accord porte la génération `consent_request_version`. Le worker refuse une ancienne génération avant l’envoi, même si les cartons sont revenus à une composition identique.
- La demande de facture jointe au message ne change pas la composition soumise à l’accord : `invoice_requested` n’invalide plus artificiellement la demande.
- Si l’équipe prépare un nouvel accord pendant l’envoi fournisseur, l’ancien envoi reste dans l’historique. Il ne date pas la nouvelle demande et le résultat précise que celle-ci reste à envoyer.
- Un nouvel essai après cet ancien envoi ne le renvoie pas. Une relance conserve la date du premier envoi.

Fichiers : `pinta/supabase/functions/_shared/telegram.ts`, `pinta/supabase/tests/conversation-outbox.test.cjs`. La migration et l’interface associées sont réalisées par les autres lots.

## Retirer un ancien paiement avant de corriger

Le nouvel endpoint `correct-colis-task` exige le droit de revenir sur une étape et celui d’effectuer la tâche choisie. La correction métier conserve le JWT de l’opérateur ; seul l’enregistrement de la preuve fournisseur utilise le service.

1. Vérifier le dossier, sa révision à la microseconde, les mesures, les règlements et le départ. Une saisie invalide ou une mesure identique ne retire pas inutilement un lien.
2. Identifier les liens PayPlug enregistrés, y compris les anciennes versions encore payables. Un lien inconnu ou en cours de création bloque l’opération.
3. Vérifier chez PayPlug l’identité du paiement, le dossier, la version du devis, le montant, la devise et le mode test/réel. Un règlement reçu ou remboursé bloque la correction.
4. Demander l’annulation avec `PATCH` et `{"aborted":true}`. Seule une réponse non payée portant `failure.code = aborted` permet de continuer. Ce contrat suit la [documentation officielle PayPlug](https://docs.payplug.com/api/apiref.html#abort-a-payment).
5. Enregistrer la preuve par `record_payplug_cancellation`, puis exécuter `correct_colis_task` avec les permissions et la révision de l’opérateur.

Une réponse fournisseur perdue n’est pas présentée comme un succès : le nouvel essai vérifie l’état réel avant de continuer. Une preuve déjà enregistrée évite une deuxième annulation.

Si le fournisseur a annulé le lien mais qu’un collègue a changé le dossier entre-temps, la réponse indique séparément le lien retiré et la correction non enregistrée (`409`, code `40001`). Seule l’URL portant encore l’identifiant annulé est effacée ; une nouvelle URL et les modifications du collègue restent intactes. L’interface doit conserver le brouillon et afficher cette réponse.

Les anciens paiements sans version de devis restent soumis à leur registre historique. Les liens historiques test, les références inconnues et les paiements déjà en échec sans preuve `aborted` demandent un rapprochement manuel ; aucun mode n’est changé automatiquement et aucun remboursement n’est exécuté.

Fichiers : `pinta/supabase/functions/correct-colis-task/index.ts`, `pinta/supabase/config.toml`, `pinta/supabase/tests/correct-colis-task.edge.test.cjs`.

## Vérifications

Commande :

```sh
cd pinta
node --test supabase/tests/correct-colis-task.edge.test.cjs supabase/tests/conversation-outbox.test.cjs supabase/tests/telegram-organisation.test.cjs
```

Résultat : **41 tests réussis**, dont 19 pour la correction avec paiement. Ils couvrent les droits, les anciennes demandes, le mode test, les identités/montants incompatibles, les délais fournisseur, le paiement concurrent, les doublons d’essai, les anciennes versions encore payables et les conflits après annulation. Une préparation n’est considérée inchangée que si ses mesures, son nombre de colis sortants et sa certification sont complets ; les données d’un devis enregistré imposent aussi son retrait même si le total affiché est vide.

Recette navigateur des messages : **10 scénarios réussis** avec `PINTA_TEST_URL=http://127.0.0.1:4187 node tests/task-message.browser.cjs`. Elle vérifie notamment qu’une génération d’accord différente bloque un ancien aperçu malgré un texte et des cartons identiques, que l’actualisation envoie la nouvelle génération, et qu’un changement concurrent avant mise en file refuse la génération capturée sans créer de notification. Résultats : `/tmp/pinta-task-message/results.json`. Le premier essai a révélé une fixture sans révision de date ; elle a été corrigée pour respecter le trigger SQL et la recette complète a été rejouée.

Les fournisseurs et la base sont simulés dans cette recette Edge. Les migrations SQL, le parcours navigateur et l’ordre de déploiement doivent être vérifiés dans le lot d’intégration : migration avant mise en service des endpoints qui utilisent ses nouveaux champs et RPC. Ces résultats ne constituent pas une validation de compréhension par un débutant.
