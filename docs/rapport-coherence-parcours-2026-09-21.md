# Cohérence du parcours après l’accord du client

Date : 21 septembre 2026. Périmètre : les huit écrans d’un dossier, leurs commandes serveur, la reprise du travail et les indications côté client.

## Problème confirmé

Après une nouvelle demande d’accord, le dossier revient à « Autorisation reçue ». Ses mesures après optimisation et ses factures peuvent rester valides. La liste proposait alors d’établir le devis, mais l’écran et la commande de sauvegarde exigeaient encore l’état « En cours de préparation ». L’utilisateur arrivait sur une explication sans action utile.

Le défaut a été reproduit à partir des faits enregistrés, sans modifier le dossier du client pour contourner le problème. Le correctif porte sur la logique commune du parcours.

## Décisions

1. **Réutiliser le travail valide.** Un nouvel accord ne demande pas de refaire des mesures ou de vérifier une nouvelle fois des factures qui restent valides pour les mêmes cartons.
2. **Ouvrir n’est pas valider.** Les flèches, la liste des étapes et les liens de reprise consultent le dossier. Seule une commande explicite enregistre un changement ou envoie une notification.
3. **Vérifier la préparation complète.** Une préparation disponible pour le devis exige une composition à jour, des dimensions et un poids positifs pour chaque colis sortant, et un nombre de colis correspondant exactement à la liste. Les anciens dossiers à un seul colis restent compatibles ; une liste explicitement vide reste incomplète.
4. **Séparer les métiers.** Le préparateur peut enregistrer les mesures sans établir le devis. La personne chargée du devis peut réutiliser ces mesures sans droit de préparation, mais ne peut pas modifier le poids dans le calcul pour contourner ce droit.
5. **Donner une sortie à chaque attente.** Un écran bloqué indique le prérequis réel et un accès à l’étape concernée. Si le rôle ne peut pas réaliser cette opération, le message explique qui doit intervenir.
6. **Confirmer des mesures conservées.** Si leur certification est incomplète, la correction permet de confirmer les valeurs existantes sans devoir inventer une modification du poids. Un devis antérieur reste soumis à la procédure explicite de correction et aux protections des liens de paiement.
7. **Conserver les protections.** Les contrôles de droits, concurrence, consentement, contenu interdit, paiement et départ restent applicables. Aucun contournement par changement automatique d’état à l’ouverture.
8. **Préserver l’organisation.** La mise à jour des tâches concerne uniquement les dossiers ouverts autorisés ou en préparation. Les attributions, attentes volontaires et échéances manuelles sont conservées.
9. **Rendre les droits cohérents jusqu’au dernier champ.** Les frais et modalités du devis restent consultables sans droit de calcul, sans saisie impossible à enregistrer. Après correction, le préparateur reçoit une sortie accessible à son rôle. Un produit interdit verrouille la correction de préparation dès l’écran.
10. **Aligner les tâches associées.** Le classement douanier peut être corrigé dès l’accord reçu. Une facture rejetée ne renvoie pas systématiquement aux factures si les documents actifs sont déjà valides ; elle reste exclue du calcul.

## Revue écran par écran

| Écran | Comportement après correction |
| --- | --- |
| Réception | Mesures initiales conservées et distinctes de l’optimisation. Les champs sont désactivés sans droit de mesure, avec une explication. Après enregistrement, accès à la suite utile du dossier. |
| Accord client | L’accord reçu est reconnu. Le bouton proposé ouvre la préparation, les factures ou le devis selon ce qui reste réellement à faire. Une nouvelle demande d’accord reste une action explicite. |
| Préparation | Enregistrement indépendant du devis dès l’accord. Les mesures conservées peuvent être corrigées ou confirmées selon les droits. Les valeurs ne sont pas considérées prêtes sur la seule présence d’un ancien poids. |
| Factures | Vérification indépendante de la préparation, documents conservés au retour. Un devis incomplet renvoie vers les factures, avec une explication adaptée aux droits du lecteur. Les règles existantes de doublon, remplacement et validation sont conservées. |
| Devis | Accessible dès l’accord lorsque la préparation est certifiée. Sauvegarde serveur autorisée au même stade. Les blocages pointent vers leur vraie origine : préparation, factures, nomenclature, client ou paramètres tarifaires. |
| Paiement | Un devis retiré n’apparaît pas comme un règlement attendu. Absence de lien expliquée ; pas de relance proposée sans lien. Les droits de confirmation du paiement restent séparés. |
| Expédition | Prérequis manquant expliqué avant le départ. Le manifeste reste obligatoire. Après arrivée, la consultation du transport propose d’ouvrir la livraison sans présenter sous ce titre une action d’une autre étape. |
| Livraison | Avant l’arrivée, accès au suivi du transport. Après arrivée, actions de livraison selon les droits. Consultation sans modification implicite de l’état. |

Les dossiers annulés ou archivés sont traités avant les messages de prérequis : ils ne sont plus présentés comme attendant encore un accord ou une préparation.

## Côté client

- Un colis déjà mesuré n’est plus présenté comme étant encore en cours de mesure dans le détail de réception.
- Après une reprise, les anciennes mesures sont identifiées comme des mesures précédentes conservées.
- Une ancienne date d’envoi de devis ne sert plus à annoncer un devis courant ; l’information historique reste accessible dans les détails.
- Aucun message supplémentaire, paiement réel ou changement de mode PayPlug n’est déclenché par ces corrections.

## Organisation et vérifications

Le travail a été réparti entre une revue serveur, la correction des écrans équipe et une recette du parcours avec vérification côté client. L’intégration, la relecture croisée, la répétition SQL sur le schéma réel avec annulation complète et la publication sont centralisées.

Les contrôles portent notamment sur : accord renouvelé avec préparation conservée, nombre de colis manquant, anciennes versions de mesures, factures manquantes, rôles préparation et devis séparés, confirmation de mesures inchangées, retours dans les huit étapes, dossiers clos et concurrence entre collègues.

Contrôles locaux déjà réussis : 186 tests JavaScript, 92 tests de fonctions serveur, 36 nouveaux contrôles PostgreSQL de reprise et droits, ainsi que les régressions SQL de correction, préparation, réception et nomenclature. Lint et construction de l’application réussis. La migration a été répétée sur le schéma distant avec annulation complète ; une sauvegarde privée des commandes et des tâches concernées a été conservée.

Les résultats navigateur finaux et les références de publication seront consignés après la recette et le déploiement. Les essais automatisés utilisent des données fictives ; ils ne constituent ni un paiement réel ni une étude de compréhension auprès d’utilisateurs débutants.

La [matrice de recette](matrice-parcours-taches-client-2026-09-21.md) détaille les cas vérifiés. Le suivi des paiements et des livraisons reste accessible dans le dossier ; la création de nouveaux types de missions dans « Mon travail » ne fait pas partie de ce correctif.
