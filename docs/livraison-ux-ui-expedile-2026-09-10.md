# Expedîle — modifications UX/UI et livraison

État : les dix recommandations UX/UI et les corrections de réception demandées lors de la recette utilisateur sont implémentées et déployées sur **https://expedile.app**. Chaque carton est mesuré à réception ; le devis exige de nouvelles mesures après optimisation. Trois spécialistes ont réalisé les corrections, suivies d’une revue d’intégration et d’une seconde recette complète.

## Couverture du rapport

| Point | Résultat à livrer | Responsable | Preuve de validation |
|---|---|---|---|
| 1 — Conversations | Lecture séparée du traitement ; responsable, clôture explicite, nouvelle réponse réouvre ; relances respectent le traitement | Backend | Implémenté — 29 assertions SQL conversation, tests Edge de suspension et reprise ; [décisions backend](decisions-ux-backend.md) |
| 2 — Préparation/devis | Mesures et blocages prioritaires ; espace de préparation large ; total recalculé/sauvegarde/prochaine action accessibles | Devis + intégration | Implémenté — recette bureau/mobile de préparation, recalcul et enregistrement ; [décisions devis](decisions-ux-devis-client.md) |
| 3 — Consentement client | Nombre réel de cartons, références connues et exclusion des futurs cartons ; autoriser/attendre/refuser visibles | Devis/client | Implémenté — tests de cartons sans tracking, consentement collectif et boutons mobiles ; [décisions devis](decisions-ux-devis-client.md) |
| 4 — Facture/OCR/articles | Document et vérification réunis ; HT/TTC explicites ; reprise persistée ; navigation mobile conservée | Devis | Implémenté — reprise OCR, empreinte document et onglets persistants ; lecteur PDF paginé/zoom intégré ; [décisions devis](decisions-ux-devis-client.md) |
| 5 — Files/compteurs/équipe | Mêmes filtres pour compteur et liste ; responsable/échéance ; accueil allégé et contexte conservé | Frontend | Implémenté — filtres partagés, URL persistante, responsable et navigation suivant ; [décisions équipe](decisions-ux-frontend.md) |
| 6 — Urgences | Dates réelles de demande ou de changement d’étape ; pauses respectées ; dates inconnues indiquées | Frontend + backend | Implémenté — dates métier, pauses, conversations et échéances manuelles testées ; [décisions équipe](decisions-ux-frontend.md) |
| 7 — Réception | Client, cartons et mesures à réception obligatoires au premier plan ; compléments repliés ; scan et récapitulatif destinataire | Frontend | Implémenté — réception bureau/mobile, nouveau client et concurrence entre collaborateurs ; [décisions équipe](decisions-ux-frontend.md) |
| 8 — Accessibilité | Labels reliés, dimensions/unités, clavier, focus, cibles tactiles, contraste clair/sombre, états textuels | Frontend + recette | Implémenté — axe sur 32 vues clair/sombre, dialogues et parcours clavier ; [résultats](verification-ux-ui-2026-09-10/accessibility-results.json) |
| 9 — Suivi | Contenu associé au bon état ; dates réelles, aucune fausse promesse de livraison ; prochaine action | Devis/client | Implémenté — tests de chaque état et suivi public mobile ; [décisions devis](decisions-ux-devis-client.md) |
| 10 — Devis publié | Portail et PDF fondés sur la même version : frais, TVA, modalités pro et règlement | Devis/client | Implémenté — tests de snapshot/PDF, frais, taux figés et modalités pro ; [décisions devis](decisions-ux-devis-client.md) |

## Décisions d’intégration et de production

- Conserver Telegram et le portail, conformément au périmètre sans WhatsApp.
- Réutiliser les projets Vercel/Supabase existants et conserver les données et tracer les paiements historiques ; retirer uniquement un ancien lien impayé dont le fournisseur confirme le mode test.
- En préparation, élargir la vue au document et au devis ; replier les informations de réception et éviter un second exemplaire du panneau facture. Le dossier ouvert depuis une file et celui ouvert par URL doivent offrir le même espace.
- Distinguer un accord structuré, exécuté automatiquement, d’une question client qui exige une réponse ; ne pas créer de tâche artificielle pour chaque accord.
- Corriger les URL Auth qui pointaient vers localhost, désactiver les inscriptions publiques et exiger 12 caractères pour les nouveaux mots de passe. Conserver les autres paramètres existants.
- Compléter le dump PostgreSQL par une copie privée des binaires Storage, avec tailles et empreintes vérifiées. Les sauvegardes ne sont jamais publiées.
- Vérifier les fournisseurs via une fonction de recette temporaire, à accès dédié et expiration ; la supprimer après livraison. Aucun paiement client ni campagne de messages de test.
- Corriger les liens de contact du profil de `expedile.com` vers `expedile.fr`, domaine déjà utilisé par les étiquettes et doté de messagerie OVH ; la configuration SMTP reste à raccorder avec les accès de l’entreprise.
- Utiliser Claude Sonnet 5 pour l’OCR après vérification de sa disponibilité dans le compte existant ; l’extraction reste soumise à validation humaine et peut être reprise sans nouvel appel fournisseur.
- Le compte PayPlug connecté est en mode test. Préparer un contrôle strict de production afin qu’un paiement simulé ne puisse pas devenir un encaissement réel ; les accès au mode réel ont été demandés.
- Conserver deux jeux de mesures indépendants : dimensions/poids de chaque carton à réception, puis nouvelles dimensions/poids après optimisation pour le devis final. Aucun préremplissage automatique des mesures finales depuis la réception. La réception mesurée est prioritaire, y compris pour un ajout à un dossier existant.
- Ajouter une vérification automatisée d’accessibilité à la revue visuelle et aux scénarios métier ; ne pas assimiler ces tests à une certification.

Les journaux spécialisés sont reliés dans le tableau ; les contrôles sont détaillés dans la [synthèse finale](verification-ux-ui-2026-09-10/verification-summary.json). Le [rapport d’audit initial](recommandations-ux-ui-expedile-2026-09-10.md) reste la référence du périmètre.

## Corrections découvertes pendant la seconde revue

- Une migration testée sur base vide échouait sur la copie réelle : les fonctions Supabase peuvent appartenir à `supabase_admin`. Les gardes acceptent maintenant les deux rôles SQL administratifs réels, sans ouvrir un droit aux comptes clients. Rejeu intégral des 21 migrations réussi, puis commandes équipe/client testées sous ce propriétaire.
- Une archive historique sans valeur booléenne pouvait être invisible dans les files. Normalisation, réactivation explicite à l’arrivée d’une question et traitement visible ; une conversation non terminée ne peut pas être archivée.
- La confirmation OCR pouvait viser un fichier remplacé pendant la vérification. Verrouillage, empreinte et chemin du document sont contrôlés dans la même commande transactionnelle.
- Le formulaire de rattachement pouvait prendre une version plus récente sans montrer les cartons ajoutés par un collègue. Il transmet maintenant la version réellement choisie ; un conflit laisse les cartons distants intacts.
- La réception d’un nouveau client ne rendait pas son bouton final accessible ; le mode de création, la validation et la reprise après erreur ont été corrigés. Les produits interdits signalés sont réellement enregistrés.
- Les horodatages automatiques étaient confondus avec des engagements d’équipe. L’origine manuelle/automatique est persistée ; une automatisation ne remplace pas une consigne saisie par l’équipe.
- L’intégration PDF native ne garantissait pas l’affichage mobile. Un lecteur chargé à la demande permet pages, zoom et défilement clavier ; le fichier signé original reste disponible.
- Les erreurs des services affichaient parfois seulement « non-2xx ». Les messages utiles du serveur sont conservés pour le devis, l’OCR, les invitations, Telegram et le rattachement. Un compte client déjà existant ne déclenche plus une fausse promesse d’email d’invitation.

- L’ancien ajout de suivi dans le dossier contournait les mesures et pouvait effacer les coordonnées initiales. Il ouvre désormais la même réception mesurée ; les cartons sans tracking sont comptés.
- Certains affichages et messages calculaient le volume de plusieurs cartons avec les dimensions maximales ou un diviseur fixe. Ils utilisent maintenant la somme des volumes individuels et le paramètre métier ; les données inconnues restent indiquées comme incomplètes.
- Le pied fixe mobile pouvait couper le champ Poids focalisé. Le champ est recentré dans la zone défilante et sa visibilité complète est vérifiée en réception et en rattachement.

## Mesures : décision métier explicite

| Étape | Données saisies | Utilisation |
|---|---|---|
| Réception de chaque carton | Longueur, largeur, hauteur en cm et poids en kg, tous obligatoires | Identification et conservation de l’état reçu ; comparaison avant optimisation lorsque tous les cartons sont mesurés |
| Préparation après optimisation | Nouvelles longueur, largeur, hauteur et poids du conditionnement final | Calcul du devis final ; saisie indépendante, jamais préremplie depuis la réception |

L’ajout d’un carton conserve les mesures déjà connues et les éventuelles valeurs finales historiques ; il invalide l’ancien accord client. Les anciennes mesures manquantes doivent être complétées pour déclarer le dossier mesuré. Le devis final d’un ancien dossier peut utiliser ses nouvelles mesures finales ; l’économie avant/après reste indisponible tant que l’origine est incomplète.

Décisions détaillées : [interface et conservation](decisions-mesures-reception-devis.md), [règles serveur](decisions-reception-backend.md), [réception et affichages](decisions-ux-frontend.md).

## Résultats de la recette finale

- Lint et build de production réussis ; 69 tests applicatifs et 41 tests Edge réussis.
- 21 migrations rejouées sur la copie réelle isolée, données conservées ; 17 assertions réception sur cette copie, 112 assertions sous propriétaire SQL Supabase et 14 comparaisons calcul JavaScript/PostgreSQL réussies.
- Parcours équipe/client, réception/rattachement, concurrence, devis et PDF réussis sur ordinateur et mobile. [Bilan navigateur](verification-ux-ui-2026-09-10/browser-final-summary.json).
- Accessibilité automatisée : 32 vues, aucun débordement ni violation détectés ; les dialogues de réception sont également contrôlés. La visibilité complète du champ Poids au-dessus du pied fixe mobile est vérifiée.
- Recettes réelles : connexion, droits équipe/client, stockage privé, extraction OCR sur PDF fictif et reprise automatique, réception mesurée et nettoyage des fixtures. [Journal de production](mise-en-production-expedile-2026-09-10.md).

Le lecteur PDF reste chargé à la demande. Son chunk dépasse le seuil indicatif de 500 Ko ; le build réussit et ce chargement reste séparé de l’entrée de l’application. La mesure en exploitation du temps de chargement et des devis reste le prochain indicateur utile.

## Lecture des preuves et limites

Les tests navigateur utilisent des dossiers fictifs et interceptent les services externes. La répétition PostgreSQL utilise une copie privée, isolée et sans réseau de la base réelle ; ses données ne figurent pas dans le dépôt public. Les vérifications des fournisseurs et du domaine sont décrites séparément dans le [journal de production](mise-en-production-expedile-2026-09-10.md).

Le serveur SMTP de l’entreprise et la clé PayPlug réelle ne sont pas encore disponibles dans les accès fournis. Aucun encaissement réel ni invitation email de bout en bout ne peut être déclaré opérationnel sans eux. Les devis restent enregistrables et les paiements simulés sont bloqués avant publication. Les accès manquants ont été demandés, sans demander de partager les secrets dans le chat.

Pour la suite, mesurer en exploitation la durée médiane d’un devis, le délai demande→accord, les conversations encore ouvertes et les reprises après erreur avec deux collaborateurs et quelques clients. Ce suivi permettra de prioriser de nouvelles améliorations sur des usages observés. Aucun gain chiffré ni certification d’accessibilité n’est présumé.
