# Décisions UX — devis, documents et parcours client

Chantier du 10 septembre 2026. Mise en œuvre des points 2, 3, 4, 9 et 10 du rapport UX/UI, ainsi que des incohérences découvertes pendant la revue. Les opérations distantes restent centralisées par le chef d’ingénierie.

| Décision | Mise en œuvre et raison |
|---|---|
| Mettre les mesures et les éléments manquants avant les options | `StaffDetailView` présente les mesures finales en premier, des accès directs aux documents/articles/frais et des blocages cliquables. Les consignes et l’affectation sont repliables ; le résumé de l’affectation conserve le responsable et la prochaine action. |
| Garder le total et l’action disponibles pendant la préparation | Barre basse attachée au conteneur de défilement, respect de la zone sûre mobile. Elle distingue calcul non enregistré, modifications et brouillon enregistré. L’envoi exige toujours la sauvegarde puis la vérification. La comparaison des entrées du moteur invalide l’état « vérifié » après changement d’articles, de pièces, de frais ou de mesures. |
| Un espace de vérification du document et des articles | `FacturesPanel workspace` affiche le PDF/image avec les propositions OCR et les articles. Deux colonnes sur desktop ; onglets sur mobile conservant les composants, corrections et sélection. Les liens des blocages activent l’onglet pertinent avant de déplacer le défilement. Le PDF dispose d’un lien d’ouverture si le navigateur ne sait pas l’afficher intégré. |
| Reprendre l’OCR sans relancer une extraction | Nouvelle action serveur `ocr-facture: resume`, sans appel IA ni import d’articles. Une extraction historique sans chemin document est reliée une fois à la version dont l’empreinte a été vérifiée. Elle vérifie la facture, le dossier, la permission OCR ou validation, et l’empreinte du document courant. Un document remplacé ne récupère pas les propositions d’un ancien fichier. Chargement, absence, échec et propositions disponibles sont distingués. |
| Expliciter les montants attendus | Champs de vérification et de saisie d’articles nommés HT ; la facture originale reste consultable. Description, quantité, prix, catégorie et écart au total ont des anomalies visibles. Une incohérence empêche la confirmation. Aucun calcul de TVA inversé ou taux commercial inventé. |
| Rendre le dépôt de facture client effectif | Le portail dispose d’un formulaire de dépôt PDF/JPG/PNG/WebP jusqu’à 20 Mo, dans son dossier non payé. Téléversement privé puis création de facture avec chemin durable, montant à vérifier et validation fausse. Le client n’obtient aucun droit de validation/OCR/modification staff. Une nouvelle version corrigée est un nouveau dépôt ; l’équipe conserve l’ancienne pour vérification. Après échec d’insertion, le fichier déjà téléversé est réutilisé au nouvel essai. Le backend ouvre le travail équipe à réception. |
| Présenter le périmètre réel de l’accord | Le nombre de cartons tient compte de `nbColis`, mesures et références connues, sans confondre tracking et carton. L’action collective montre les dossiers et leurs versions ; les cartons futurs sont exclus. Les boutons Autoriser/Attendre précèdent les explications repliées. Refus et confirmation restent disponibles. Le texte précise que la préparation précède le devis final. |
| Utiliser les dates de demandes réelles | L’accueil ne déduit plus une urgence de la création du dossier. La date de demande effectivement envoyée sert à l’indication d’attente ; une pause volontaire reste distincte. La demande d’arrêt de préparation renvoie à la conversation du dossier. |
| Aligner le sens des étapes | Préparation index 2, douane 5, dépôt 6, livraison 7. Contenu propre pour chaque étape ; refus rattaché à l’accord. La phase actuelle est présentée avant les étapes passées. Aucun « aujourd’hui » déduit du seul statut livraison. |
| Remplacer le pourcentage abstrait | `ProgressBar` montre des repères d’étapes sans pourcentage. Le portail et le suivi public affichent état, personne qui doit agir, prochaine étape et dernier événement métier daté connu. Une date absente reste explicitement absente ; un `updated_at` de modification administrative ne devient pas un événement de livraison. Frise publique repliable et sans défilement horizontal imposé. |
| Reproduire le même devis publié partout | `quotePresentation` est partagé entre le PDF et le détail client : montants, frais `libelle`, taux, modalités pro, version et date proviennent du snapshot. Les données historiques sans snapshot ne reçoivent aucun taux supposé. Les modalités convenues et la référence de règlement sont visibles/copiables ; le lien de paiement existant reste disponible. Sans coordonnées bancaires configurées, aucune coordonnée ni échéance calendaire n’est inventée. |
| Ne transmettre au suivi partagé que des faits utiles | `get-tracking` ajoute les dates métier de demande/accord/devis/paiement/expédition/livraison et les dates de pause, sans motif, montant ni note interne. Les fichiers restent signés. |

## Vérifications

- Lint sans erreur sur les huit fichiers UI/domaine/export modifiés.
- Dix tests Node/SSR/Edge ciblés réussis : comptage de cartons, pauses, dates, snapshot immuable, contenu des phases, paiement attendu, reprise OCR avec permissions et empreinte, sans IA.
- Six scénarios navigateur isolés réussis dans [`verification-ux-devis-client-2026-09-10/results.json`](verification-ux-devis-client-2026-09-10/results.json). Captures mobile 390 × 844 et desktop 1 440 × 1 000 dans le même dossier.
- Vérification réelle du choix client avant le bas de l’écran, de la barre devis au-dessus de la navigation, des onglets conservant une correction OCR, de l’interdiction de confirmer catégorie/total incohérents, du dépôt client privé et de sa reprise après erreur, du suivi public sans débordement horizontal.
- Les scénarios locaux interceptent toutes les requêtes distantes. Ils ne prétendent pas tester un paiement réel, une livraison Telegram réelle ou l’efficacité commerciale auprès de clients réels.

## Revue croisée et limites

Revue du lot backend conversations : transitions versionnées, réouverture après message libre, exclusion des réponses structurées déjà exécutées, blocage des relances et vérification avant livraison. La date de demande d’accord manquante dans la vue client a été signalée et intégrée par le backend. Le dépôt client manquant a été signalé par ce même agent et ajouté dans ce lot. Le frontend corrige les contrastes et la frise supérieure partagée ; la barre de progression a reçu un rôle sémantique après le retour axe du chef d’ingénierie.

Les corrections OCR restent un brouillon tant qu’elles ne sont pas confirmées : elles sont conservées pendant les changements d’onglet et de sélection, mais quitter le dossier avant confirmation ne vaut pas sauvegarde. L’interface le dit explicitement. L’analyse enregistrée initiale est reprise du serveur. Le lecteur PDF.js chargé à la demande affiche les pages dans le canvas ; le lien sécurisé vers l’original reste disponible. Aucun gain de temps chiffré ni certification d’accessibilité n’est annoncé sans mesure dédiée.

La revue backend a également fermé la course entre vérification du fichier OCR et confirmation : la commande `confirm_ocr_extraction_current` verrouille la facture et compare le chemin privé et l’empreinte avant import. Le document associé à l’extraction est durable.

## Recette complémentaire du lecteur PDF

Le lecteur `PDFPreview` a été vérifié sur le serveur local 4183 avec un vrai PDF de deux pages distinctes, livré par la fixture réseau isolée. Quatre scénarios passent dans `tests/pdf-preview.browser.cjs` ; résultats et captures dans [`verification-pdf-2026-09-10`](verification-pdf-2026-09-10/results.json). Le dossier de sortie CI est piloté par `PINTA_PDF_OUT`.

- Les pages 1 et 2 produisent des pixels différents. Le zoom 200 % double la largeur du canvas (566 → 1 132 pixels), avec défilement dans le lecteur sans débordement de la page.
- Sur mobile 390 × 844, les onglets conservent la page 2, le zoom et une description OCR corrigée, sans nouvel appel de reprise/analyse.
- Une erreur de rendu ponctuelle, injectée dans `getContext`, est signalée puis la page suivante peut être rendue normalement.
- Les changements rapides de page et de zoom annulent les rendus devenus obsolètes sans erreur JavaScript.

Deux défauts ont été corrigés : le marqueur de rendu est maintenant lié au document, à la page, à la largeur et au zoom précis (un ancien canvas ne peut plus être annoncé prêt pour la nouvelle page) ; le canvas reste monté après une erreur pour permettre une reprise. Les boutons de pagination ont des cibles d’au moins 44 × 44 pixels. Lint du lecteur réussi ; le build final est centralisé par le chef d’ingénierie.
