# PayPlug en préproduction — 17 septembre 2026

L’utilisateur a précisé que l’environnement actuellement accessible sur expedile.app sert à la **préproduction et aux essais**, sans encaissement réel. La cible technique « production » de l’hébergeur ne détermine pas le mode financier PayPlug.

## Cause du blocage

`PAYPLUG_MODE` était configuré sur `live`, ce qui a été confirmé par comparaison de son empreinte distante. Le message affiché est émis précisément lorsqu’une clé `sk_test_…` rencontre ce mode dans `requirePayplugCreationMode`. L’application bloquait avant toute création de paiement ou notification.

L’API d’administration expose les empreintes des secrets, pas leurs valeurs lisibles. Le mode a été vérifié par empreinte ; le type de clé est déduit de la branche exacte produisant le message signalé. Aucune clé n’a été affichée, exportée ou copiée dans le dépôt.

## Correction appliquée

- Le 17 septembre à 17:44:32 UTC, modification du seul secret **`PAYPLUG_MODE` : `live` → `test`**.
- Nouvelle empreinte comparée à la valeur attendue `test` : concordance confirmée.
- Empreinte de `PAYPLUG_SECRET_KEY` inchangée ; URL de l’application également conservée.
- Aucune intention de paiement existante à convertir lors du contrôle ; aucun devis ni règlement modifié.
- Le code garde son mode réel par défaut pour les environnements non configurés. La préproduction utilise ici une valeur `test` explicite. Aucun contournement des contrôles de clé, montant, devis ou environnement n’a été ajouté.

Le portail PayPlug associe une clé différente à chaque mode. La configuration d’encaissements réels demandera ultérieurement une décision explicite, une clé Live valide et le mode `live`. [Documentation officielle PayPlug](https://support.payplug.com/hc/fr/articles/360021142952-Comment-configurer-mon-site-en-mode-LIVE).

## Vérification

Les **10 tests Edge ciblés réussissent**, dont trois cas ajoutés : création simulée avec mode/clé Test, refus d’une clé Live en mode Test avant toute requête fournisseur, et traitement d’une notification simulée moderne en environnement Test.

Les appels du prestataire sont remplacés par des données fictives dans ces tests. Aucun paiement PayPlug n’a été créé et aucun message client n’a été envoyé pendant l’intervention. La validité du compte auprès du prestataire et un paiement complet avec carte de test ne sont pas déclarés vérifiés par cette intervention.

Pour reprendre les essais, relancer l’envoi du devis depuis le dossier. Il demandera désormais un lien de **paiement simulé**, sous réserve des contrôles habituels du devis et des coordonnées client.
