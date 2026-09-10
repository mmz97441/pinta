# Décisions — devis, documents, préparation et pilotage

Date : 10 septembre 2026. Périmètre : moteur métier, écran de préparation, factures/OCR, estimation prospect, PDF et indicateurs opérationnels. Ce fichier décrit les changements implémentés ; les paramètres de production et les gains observés ne sont pas supposés vérifiés.

## Calcul et version des devis

| Décision | Motif et comportement retenu | Implémentation / vérification |
|---|---|---|
| Un seul moteur déterministe | L’estimation, le formulaire et le contexte utilisent les mêmes montants, sans IA dans le calcul financier. | `pinta/src/expedile/domain/quote.js`, tests `quote.test.js`. |
| Conserver les règles commerciales existantes documentées | Transport = forfait + poids facturable × prix/kg. Aucune remise d’abonnement n’est inventée faute de barème correspondant. Les valeurs et taux viennent de la configuration fournie au moteur. | Le moteur exige un tarif explicite ; l’ancienne comparaison Premium fictive a été retirée de l’estimation. |
| Dimensions strictement positives et finies | Le zéro, une saisie vide, une valeur négative, `NaN`, l’infini ou un texte partiellement numérique ne produisent pas un devis. | Tests valeurs invalides et limites de calcul. |
| Diviseur volumétrique configurable | Le diviseur déjà affiché dans les paramètres est utilisé réellement. Valeur historique 5 000 lorsqu’aucune configuration n’a encore été fournie. | `volumetricDivisor`, test 6 000. |
| Poids des cartons regroupés cohérent | Avant optimisation : maximum du poids réel total et du volume total/diviseur. Après : mesures du colis final. Cela conserve la politique du dépôt ; aucune règle de transporteur différente n’est inventée. | `measureShipment`, tests multi-cartons. |
| Catégories et taux propres à la destination obligatoires | Une catégorie inconnue ne signifie plus taxes nulles ; les taux de La Réunion ne sont pas repris silencieusement pour une autre destination. | Tests catégorie absente et taux Mayotte manquants. |
| Factures réelles et vérifiées avant le devis particulier | Au moins une facture non rejetée validée, toutes les factures non rejetées vérifiées, justificatif joint. L’accord de préparation reste indépendant. | Erreurs de formulaire explicites et validations du moteur. |
| Professionnel : mêmes règles avant/après | Le devis professionnel conserve le transport et les frais explicitement renseignés, sans OM/OMR/TVA. L’ancienne économie fictive de TVA disparaît. | Test pro sans document et dimensions identiques : économie 0 €. |
| Arrondir les composantes monétaires au centime | Transport, OM, OMR, TVA et frais se somment exactement au total affiché. La répartition CIF utilise les valeurs marchandise brutes pour répartir tout le transport. | Cas de référence : transport 34 €, OM 13,40 €, OMR 3,35 €, TVA 4,31 €, total 55,06 €. |
| Recalculer entièrement l’avant/après | Les taxes avant optimisation utilisent le transport avant optimisation ; les mêmes frais sont comptés des deux côtés. | Test transport avant 58 €, total avant 84,36 €, économie 29,30 €. |
| Frais comptés une seule fois | L’ancien aperçu ajoutait les frais à un total qui les contenait déjà. Le formulaire lit exclusivement `quote.amounts.total`. | Test frais 7,50 € : total 62,56 €, économie inchangée à dimensions identiques. |
| Écart factures/articles signalé | Un écart HT/TTC ou une répartition entre dossiers appelle une vérification humaine ; le moteur ne corrige pas arbitrairement les factures. | Avertissement dédié ; validation stricte du total lors de la confirmation OCR côté serveur. |
| Snapshot des hypothèses | Le calcul restitue mesures, client, destination, barème, taux, lignes, sources, frais et montants dans un objet détaché des entrées. L’enregistrement serveur apporte date et numéro de version. | Test déterminisme et immutabilité des entrées. |
| Empreinte stable des entrées | L’ordre des lignes/factures retournées par la base ne déclenche pas un faux changement. Un nouveau tarif, une facture ou une ligne modifiée invalide la comparaison avant envoi. | `quoteInputFingerprint`, test ordre des relations et changement de tarif. |
| PDF fidèle à la version enregistrée | Une modification ultérieure du client, des frais ou du colis ne change pas un ancien devis exporté. Les devis historiques sans date documentée ne reçoivent pas une fausse date d’émission. | Test intégration PDF avec données courantes volontairement différentes ; nom de fichier versionné. |

Les taux fiscaux préexistants sont conservés, pas certifiés juridiquement par ce travail. Leur validation métier et leur configuration restent nécessaires avant une exploitation facturante.

## Poste de préparation et documents

| Décision | Motif et comportement retenu | Implémentation / vérification |
|---|---|---|
| Mesures finales enregistrées avec le devis | Suppression des écritures sur chaque `blur` et des `setTimeout` destinés à attendre React. La commande reçoit les valeurs explicites du formulaire. | `StaffDetailView.jsx`, scénario navigateur poids final changé avant calcul. |
| Sauvegardes attendues | Articles, catégories, mesures, frais, statut et paiement attendent le résultat durable. Le verrou d’action évite les doubles clics ; erreurs affichées dans le panneau. | Suppression des fallbacks locaux et timers métier dans les fichiers du périmètre. |
| Parcours pro cohérent | Le bouton de devis pro n’exige plus les justificatifs servant uniquement au calcul des taxes du particulier. | Même moteur dans l’écran et dans le contexte. |
| Préparation lisible sur petit écran | Champs en deux colonnes, ajout d’article vertical, largeur minimale contrôlée, actions tactiles ≥44 px et montants regroupés. | Captures bureau/mobile de `docs/verification-expedile-2026-09-10/` inspectées. |
| Articles reliables à une facture | La saisie manuelle propose la facture source. Suppression du raccourci qui transformait automatiquement toute une facture en un article à catégoriser arbitrairement. | `StaffDetailView.jsx`, mapping `factureId` intégré par le responsable du contexte. |
| Upload privé, chemins persistés | Les documents utilisent le stockage privé et des liens temporaires. Remplacer le document annule sa validation ; aucune URL temporaire n’est sauvegardée. | `FacturesPanel.jsx`, `uploadDocument` et composants `SecureFile` partagés. |
| OCR proposé dès l’upload staff | L’analyse est lancée après enregistrement du document. Son indisponibilité laisse le document enregistré et propose la saisie manuelle. | Appel authentifié `ocr-facture`, sans URL arbitraire ni secret frontend. |
| Extraction OCR en brouillon | Vendeur, total, quantités, prix et catégories sont corrigeables avant confirmation explicite. L’IA ne valide pas ses propres propositions. | `FacturesPanel.jsx`, staging et confirmation serveur. |
| Pas de doublons après réanalyse | Après confirmation, rechargement du dossier canonique ; les anciennes lignes remplacées par le serveur ne restent pas affichées localement. | Confirmation idempotente et remplacement lié à la facture côté backend. |
| Pas de doublon entre réponse et actualisation | L’ajout manuel d’une facture ou d’un article retire une éventuelle copie du même identifiant déjà reçue par actualisation. | L’ordre des réponses réseau ne multiplie plus visuellement le document ou sa valeur. |
| Notification de correction honnête | Le refus est enregistré avant la demande client. Si la notification échoue, le refus reste conservé et l’erreur explique précisément l’échec d’envoi. | `FacturesPanel.jsx`, canal commun `sendMsg`. |
| Aperçu de facture accessible | Fermeture par fond, bouton nommé et Échap, focus retenu dans l’aperçu et rendu contraint au viewport. | `Lightbox` du panneau factures ; contrôle visuel final coordonné par le responsable de la branche. |
| Envoi final centralisé | Suppression du PayPlug et de l’envoi Telegram directs dans le formulaire ; le contexte gère la version et le canal. Les modes pro conservés sont virement, espèces, 30 jours et fin de mois. | `confirmerDevis`/`payer` intégrés par le responsable frontend/backend. |
| Modalités pro définies avant le devis | La modalité est choisie pendant la préparation, incluse dans le snapshot et le PDF. La réception du règlement ne modifie plus ces hypothèses ; changer de modalité exige une nouvelle version. | Corrige le blocage circulaire avant envoi et l’invalidation involontaire du montant au moment de confirmer le paiement. |
| Statut d’attente de paiement reconnu partout | Le statut backend `attente_paiement` dispose du même parcours de paiement que `devis_envoye` : badge, phase, détail client, action de règlement, suivi public et couleurs staff. Les filtres et compteurs actifs le prenaient déjà en compte. | Deux tests ciblés vérifient les transitions et le rendu réel du détail client ; un brouillon ne montre toujours aucune action de paiement. |
| Actions documentaires adaptées au rôle | Ajout, OCR, validation et refus utilisent leurs permissions respectives ; un dossier payé montre les justificatifs en lecture seule. | L’interface anticipe les interdictions contrôlées en base. |
| Aperçu imbriqué sans fermeture du dossier | Échap et Tab sont interceptés dans l’aperçu de la facture avant les raccourcis du dossier parent. | Évite de fermer simultanément le document et le détail mobile. |
| Estimation partageable honnêtement | PDF indicatif, copie du texte et préparation d’un email. Le bouton n’annonce jamais qu’un `mailto:` a envoyé un message. | `DevisProspect.jsx`. |

## Pilotage de l’équipe

`KPIDashboard.jsx` devient un bloc repliable de l’accueil pour compléter la file de travail, sans la dupliquer visuellement. Les compteurs distinguent dossiers et cartons.

- Les pauses volontaires restent séparées des accords sans réponse, y compris lorsqu’une échéance de pause doit être revue.
- Les messages à lire sont comptés par client et par dossier. « Non lu » ne prétend pas mesurer une réponse non traitée.
- « Prêt à chiffrer » appelle le vrai moteur avec les prérequis du dossier.
- Le délai médian demande → accord ne comprend que les dossiers disposant des deux dates. C’est un délai calendaire, les pauses historiques n’étant pas soustraites faute de journal de durée exploité.
- Les objectifs fictifs de 50 colis et 5 000 € sont retirés. Aucun gain de temps ou objectif atteint n’est inventé.
- Les paiements sont appelés encaissements, avec transport et taxes séparés. L’interface précise le périmètre non archivé et permet à la direction de charger les archives.

## Vérifications du périmètre

- 11 tests de calcul, validation, version et empreinte.
- 3 tests de métriques opérationnelles.
- 4 tests d’intégration avec dépendances externes simulées : échec durable, concurrence de version, complétude de 1 001 dossiers et génération PDF fidèle.
- 2 tests de cohérence du statut d’attente de paiement, dont rendu React du détail client avec devis publié puis brouillon (`pinta/tests/payment-status.test.mjs`).
- 24 cas de comparaison entre le moteur JavaScript réel et `save_quote` dans PostgreSQL 15 local : particuliers/professionnels, diviseurs 5 000/6 000, poids réel/volumétrique, plusieurs catégories, frais, arrondis, total avant/après et économie. Résultats exactement identiques ; toutes les données de test sont annulées par `ROLLBACK`. Script `pinta/supabase/tests/quote-parity.mjs`.
- ESLint ciblé : règles React/hooks, variables inconnues et inutilisées sans erreur ni avertissement sur les écrans modifiés.
- Captures de préparation bureau/mobile inspectées : contenu à largeur disponible, formulaire lisible. Le rapport navigateur global est conservé séparément et reste la référence pour le dernier passage de la branche.

Les tests n’envoient aucun message réel et n’encaisseront aucun paiement. L’OCR et les webhooks ont une configuration serveur et des vérifications complémentaires décrites par le spécialiste backend. Le déploiement et le rapprochement avec les données réellement présentes en production ne sont pas inclus implicitement dans ces résultats locaux.
