# Décisions backend — mesures obligatoires à la réception

La migration `20260910000018_reception_measurements.sql` applique la consigne de mesurer chaque nouveau carton reçu, y compris lors d’un rattachement. Elle complète le [journal maître](decisions-finalisation-expedile.md) et la modification de couverture des devis `00019` réalisée par le responsable devis.

- La garde concerne les créations physiques de l’équipe, les augmentations du nombre de cartons et les déclarations de dossier mesuré. Elle ne pose pas de contrainte globale sur les dossiers historiques ; notes, casier, paiement et échanges restent utilisables sans mesure rétroactive obligatoire.
- Chaque nouveau carton possède sa propre longueur, largeur, hauteur et son poids positifs. Les valeurs absentes, nulles, non numériques ou infinies sont refusées. Le nombre déclaré, le tableau de cartons et les positions de mesure doivent correspondre. Un numéro de suivi vide ne représente pas à lui seul un carton.
- Le rattachement conserve toutes les coordonnées historiques connues, même lorsqu’une ancienne mesure est partielle. Les positions inconnues restent explicites. Les maxima d’un ancien dossier contenant plusieurs cartons ne deviennent jamais des mesures individuelles inventées.
- Le statut `mesure` exige une couverture complète. Un rattachement entièrement mesuré peut revenir directement à cette étape depuis une attente ou un accord ; si une ancienne mesure manque, le dossier reste à la réception. Le consentement et l’ancienne date de demande sont réinitialisés pour le nouveau contenu.
- Les scalaires de réception sont dérivés des mesures individuelles : maxima des dimensions et somme des poids, arrondie à deux décimales. Ils restent nuls lorsque la couverture est incomplète. Le moteur de devis utilise les volumes individuels pour la comparaison avant optimisation.
- La réception ne renseigne aucun champ `fin_*`, ne remplace pas les mesures de préparation existantes et ne crée aucun devis. Les quatre mesures après optimisation restent une saisie distincte.
- Les rôles SQL de migration et les tâches de service conservent leur capacité de restauration ; les protections s’appliquent à la saisie authentifiée de l’équipe. Le contrôle de concurrence du rattachement conserve la version du dossier sélectionné.

Vérification locale finale : `run-migration-owners.sh` rejoue toutes les migrations sous `supabase_admin` sur PostgreSQL 17 sans réseau, exécute **112 assertions SQL**, dont **17 dédiées à la réception**, puis **12 comparaisons JavaScript/PostgreSQL** sur la couverture et les volumes de réception. Les fixtures sont annulées et le conteneur supprimé. Les migrations déjà publiées `00000` à `00017` n’ont pas été modifiées pour ce lot ; le responsable principal coordonne la répétition sur la copie réelle et le déploiement.

## Relance après rattachement — 11 septembre 2026

Le texte de secours de la relance de préparation utilise maintenant le même moteur de modèles que les messages configurés, avec `nb_cartons` et `liste_cartons`. Chaque carton apparaît dans une ligne numérotée, avec son fournisseur lorsqu’il est connu et « Sans numéro de suivi » lorsque le suivi manque. Cela évite d’annoncer trois cartons puis de n’en détailler qu’un. La planification, les règles d’attente et le contrôle du consentement sont conservés.

Le véritable handler `relances-auto` est exécuté en test avec une base simulée, sans réseau : trois cartons, deux fournisseurs et deux suivis absents produisent trois lignes correctes dans le message mis en file. Le test vérifie aussi le dossier associé et le bouton d’accord. Commande : `node --test pinta/supabase/tests/edge.test.cjs` — **12 tests réussis**. Aucun déploiement effectué dans ce correctif ; il est coordonné par le responsable principal.
