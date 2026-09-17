# Expedîle — audit de simplicité de l’ensemble de l’application

**17 septembre 2026 · Rapport de propositions uniquement · Version examinée : `19d20352f288eea2b1f33edfa1cd6ddbea54a8e4`**

L’objectif est qu’une personne découvre seule ce qu’elle doit faire, sache si son action a réussi et puisse reprendre son travail sans crainte de se tromper. Il concerne les débutants comme les collaborateurs expérimentés, sur ordinateur et téléphone.

La formule « de 10 à 65 ans » est comprise comme une exigence de clarté : mots courants, actions explicites, lecture confortable et droit à l’erreur. L’âge ne détermine pas la compétence numérique. Les décisions douanières, financières et les permissions restent des responsabilités professionnelles ; une interface simple doit guider ces décisions, pas faire disparaître leurs contrôles.

**Aucun correctif, changement de configuration, déploiement ou modification de donnée réelle n’a été effectué dans cet audit.**

## 1. Diagnostic et direction recommandée

L’application dispose maintenant d’une bonne base : tâches séparées, préparation indépendante du devis, navigation dans les deux sens, récapitulatif après validation, documents conservés et notifications préparées par un membre de l’équipe. Il faut conserver ces acquis.

La difficulté restante vient principalement de trois sources :

1. **L’utilisateur doit encore interpréter l’organisation interne.** Dossier, colis, carton, envoi, départ, mission, action et référent se mélangent. Plusieurs commandes semblables ont des effets différents.
2. **Les exceptions occupent parfois autant de place que le travail normal.** Gestion des doublons, analyse, saisie manuelle, avertissements et historique peuvent repousser le document ou le champ utile sous le premier écran.
3. **La confiance dans les actions n’est pas uniforme.** Un écran enregistre au changement de valeur, un autre exige un bouton ; certains brouillons sont conservés, d’autres disparaissent. Réduire le texte ne résoudrait pas ces incohérences.

La recommandation est une interface commune et prévisible : **une tâche claire, une action principale, un résultat visible et les détails à la demande**. Les utilisateurs expérimentés gardent la recherche, les accès directs, le clavier et les actions groupées. Il n’est pas nécessaire de créer deux applications ou un « mode senior ».

### Priorités

| Niveau | Signification | Décision proposée |
| --- | --- | --- |
| P1 | Risque de mauvaise action, perte de saisie, information contradictoire ou obstacle majeur au travail. | Traiter avant les retouches esthétiques. |
| P2 | Effort de lecture, de compréhension ou de navigation récurrent. | Simplifier dans la première passe ergonomique. |
| P3 | Confort, raccourcis et optimisation pour les utilisateurs réguliers. | Ajouter après validation du parcours de base. |

Il s’agit de priorités d’audit, pas d’une mesure statistique de fréquence. Les contrôles serveur réels n’ont pas été contournés ni testés par des écritures de production.

### Synthèse des priorités à traiter d’abord

| Sujet | Risque concret | Entrées du rapport |
| --- | --- | --- |
| Réponses et modèles de messages | Perdre un brouillon en consultant un autre écran. | E11, C13, A22 |
| Correction d’une facture | Ajouter un document au lieu de remplacer celui qui est demandé. | C10 |
| Navigation et retour de statut | Confondre consultation et modification métier ; confirmation actuelle trop rassurante sur le devis. | O01, O21 |
| Résumés et exports | Afficher un seul colis préparé ou réinclure une ligne de doublon dans un récapitulatif. | O19, A11 |
| Suivi client | Ouvrir le suivi fournisseur au lieu du trajet vers le destinataire. | C16 |
| Fiabilité de l’enregistrement | Tarifs partiellement enregistrés, valeur de catégorie non sauvegardée mais encore affichée. | A16, A17 |
| Fiche client | Annuler conserve un brouillon ; suppression immédiate ; exigences et validation de création divergentes. | A05, A08, A10 |
| Permissions | Cases accordées sans rubrique accessible correspondante. | A19 |
| Recherche et documents courants | Faux zéro avant chargement des archives ; ancienne facture déjà remplacée encore à corriger. | C07, C11 |
| Action attendue | Bouton d’aperçu différent de l’instruction ; notification qui n’ouvre pas son message ; suivi public qui attribue une action privée. | E08, C12, C21 |
| Rattachement de messages | Choisir un dossier sans pouvoir examiner sa pièce jointe. | E12 |
| Utilisation mobile | Modèles illisibles, formulaires serrés et première tâche repoussée sous les commandes d’organisation. | A22, A05, E02 |

Les premiers sujets touchent à la confiance et à la continuité du travail ; les autres simplifications détaillées ci-dessous restent nécessaires pour faciliter la lecture et l’adoption.

## 2. Méthode et limites

- Cartographie des routes actives depuis `App.jsx`, puis des onglets, fenêtres, tiroirs et états conditionnels des composants.
- Lecture du code et visites dans Chromium, avec les mêmes composants que l’application, mais des utilisateurs, dossiers, documents et échanges fictifs. Les appels aux fournisseurs et aux données métier sont interceptés.
- Inspection ordinateur, principalement 1440 × 1000, et mobile 390 × 844 ; examen des boutons, titres, textes, formulaires, états vides, erreurs et transitions.
- Reproductions ciblées des comportements suspects, y compris changements de page, refus de sauvegarde simulé et plusieurs colis après optimisation.
- Répartition indépendante entre quatre périmètres : opérations, travail de l’équipe, client/public/connexion, administration/clients/estimation.

**Lecture des preuves :** « observé » signifie reproduit dans ces conditions ; « code » signifie constat dans l’implémentation ; « proposition » signifie choix de conception à valider. Une réponse simulée ne prouve pas qu’une base réelle accepterait une donnée invalide. Les données manquantes de certains scénarios sont intentionnelles, pour examiner les écrans de blocage.

Ce rapport n’est ni une certification WCAG, ni une étude avec de vrais débutants. Les essais sur appareils physiques, lecteurs d’écran, réseau mobile réel, très grands historiques et prestataires externes restent à réaliser. Les écrans accessibles sont inventoriés ; toutes les combinaisons possibles de permissions, données, états et erreurs ne peuvent pas être présentées comme observées.

## 3. Règles communes à appliquer à tous les écrans

### Comprendre avant d’agir

Au premier regard, chaque écran devrait répondre à quatre questions : **où suis-je, de quel client/dossier s’agit-il, que dois-je faire, qu’est-ce qui manque ?** Une courte phrase suffit. Les causes, historiques et règles détaillées viennent ensuite.

| Aujourd’hui ou risque observé | Organisation proposée | Critère d’acceptation |
| --- | --- | --- |
| Plusieurs boutons semblent être « la suite ». | Réserver l’action principale à l’action métier ; distinguer navigation entre écrans, passage au dossier suivant et annulation d’une validation. | Une personne peut expliquer l’effet des trois commandes avant de cliquer. |
| « Contexte » ne dit pas ce que contient le panneau. | « Détails du dossier » ; accès direct « Messages » quand un message attend une réponse. | Retrouver un document ou le casier sans essayer plusieurs rubriques. |
| Une action n’est pas toujours enregistrée de la même manière. | Pour les formulaires : bouton Enregistrer, état Modifications non enregistrées, puis confirmation persistante. Pour les actions immédiates : libellé qui l’annonce et retour visible. | Aucun succès affiché avant confirmation ; une erreur laisse le brouillon et explique quoi faire. |
| Des textes de 10–12 px portent des informations utiles. | Viser 16 px pour contenu et saisie ordinaires ; 14 px au minimum pour les informations secondaires utiles. Ne pas réduire la police pour faire tenir un bouton. | Lisible à taille normale et utilisable avec texte agrandi ; aucune information essentielle en microtexte. |
| Couleurs nombreuses : action, statut, alerte et décoration. | Une couleur principale d’action, vert pour succès, orange pour attention, rouge pour erreur/action destructive. Toujours ajouter un texte. | Le sens reste compréhensible sans distinguer les couleurs. |
| Listes compactes ou grands tableaux sur téléphone. | Carte courte : référence, client, action attendue, responsable si utile. Les autres champs s’ouvrent au toucher. | Aucun défilement horizontal nécessaire pour l’action courante. |
| Boutons désactivés avec explication éloignée. | Afficher à côté la raison et une action pour résoudre le problème ou joindre le bon collègue. | L’utilisateur sait pourquoi et qui peut débloquer la situation. |
| Confirmation fugitive en haut de page. | Pour les actions importantes : résultat dans la zone de travail, avec date/heure et prochaine action. Garder les notifications temporaires pour les retours secondaires. | La confirmation reste retrouvable après disparition du message temporaire. |

Les recommandations de langage simple et de commandes familières s’appuient sur les guides W3C : [contenu compréhensible](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/) et [but des pages et étapes explicite](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o1-understandable/). Les tailles de texte proposées ci-dessus sont des choix de conception pour Expedîle, pas des minima WCAG universels.

### Vocabulaire commun proposé

| Mot ou libellé | Proposition visible | Précision à préserver |
| --- | --- | --- |
| Carton reçu | Carton reçu | Objet reçu du fournisseur ; ses mesures restent conservées. |
| Colis sortant | Colis préparé — après optimisation | Emballage après regroupement/optimisation ; nouvelles mesures obligatoires. |
| Dossier / expédition EXP-… | Expédition EXP-… | Une référence commune à ses cartons, factures et échanges. |
| Envoi logistique | Départ du 24 septembre | Regroupement de plusieurs expéditions ; ne pas le confondre avec la référence client. |
| Feu vert | Accord du client | Expliquer « autoriser la préparation », sans laisser entendre que cela accepte déjà un devis final. |
| Mission / action / file | Travail à faire / tâche | Garder le vocabulaire technique dans l’administration seulement. |
| Référent | Personne qui suit le dossier | Distinct de la personne qui réalise une tâche ponctuelle. |
| Manifeste | Liste des colis du départ | Conserver « manifeste » en second niveau pour l’équipe qui l’utilise. |
| Canal | Envoyer par | Telegram, email ou espace client. |
| OCR / analyse | Lecture automatique de la facture | Propositions à vérifier, jamais promesse de justesse. |
| HT / TTC / poids volumétrique | Garder le terme avec une aide courte | Ne pas cacher les unités ou règles nécessaires au calcul. |

### Accessibilité et confort : critères transversaux

- Viser des commandes tactiles de **44 × 44 px** pour le confort. Le critère WCAG 2.2 AA porte sur **24 × 24 px avec des exceptions d’espacement**, ce qui n’est pas la même exigence : [taille des cibles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Vérifier le contraste du texte courant à **4,5:1**, avec les règles propres au grand texte ; contrôler thèmes clair/sombre, placeholders et messages d’erreur : [contraste](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Tester l’agrandissement du texte à **200 %** et la redistribution du contenu à **320 px CSS**, hors exceptions pertinentes : [texte agrandi](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [redistribution](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- Parcours complet au clavier : ordre logique, focus visible, retour du focus après fermeture, aucun champ masqué par une barre fixe. Une icône seule doit avoir un nom accessible, mais les actions importantes méritent aussi un libellé visible.
- Accepter copier/coller et les gestionnaires de mots de passe ; renseigner clairement les erreurs de connexion. Ne pas demander une donnée déjà fournie dans le même processus sans raison : [saisie redondante](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html).
- Formats français cohérents : `16,64 €`, `3,5 kg`, date complète quand l’année est ambiguë ; accepter les formats de saisie usuels sans changer silencieusement leur valeur.

## 4. Parcours opérationnel : réception jusqu’à livraison

### O01 — Navigation dans une expédition · P1 · observé et code

**Constat.** Le bandeau Précédent / liste / Suivant fonctionne maintenant. Mais le bas d’un écran peut proposer « Tâche suivante » pour une autre action de la file, et Corrections contient « Étape précédente », qui modifie le statut. La similitude est dangereuse pour un débutant.

**Proposition.** Conserver les boutons de navigation demandés. Sur ordinateur, conserver la destination explicite ; sur mobile, expliquer brièvement qu’ils servent à consulter les étapes. Renommer la continuation « Ouvrir la prochaine tâche » avec client, référence et tâche visés. Renommer la correction « Corriger l’étape vers [étape cible]… » avec son effet exact dans la confirmation. Afficher discrètement l’état réel du dossier quand l’utilisateur consulte une autre étape.

**Recette.** Revenir aux factures ne révoque rien ; consulter Paiement ne valide aucun devis ; la correction annonce les données/actions affectées avant exécution. Les brouillons restent conservés.

### O02 — Réception : choisir le client et l’expédition · P1/P2 · observé

**Constat.** La recherche du client est claire. Ensuite, il faut comprendre s’il s’agit d’un nouveau dossier ou d’un ajout à un existant. Le nom, la référence, le contenu et le casier sont dispersés. « Rattacher » est un terme interne.

**Proposition.** Après le client : deux choix explicites, « Ajouter à une expédition existante » et « Créer une nouvelle expédition ». Pour chaque choix existant : référence, contenu, nombre de cartons déjà reçus et casier. Bouton final « Enregistrer le carton dans EXP-… ». Montrer le nom complet du client dans le résumé.

**Recette.** Deux dossiers ouverts pour le même client restent distinguables. Un ajout ne crée pas de nouvelle référence. La numérotation continue est conservée : le scénario avec deux cartons affiche bien Carton 3 aujourd’hui.

### O03 — Réception : mesures du carton · P1/P2 · observé

**Constat.** Sur mobile, fournisseur et suivi sont placés avant les quatre mesures obligatoires. Le pied fixe avec plusieurs lignes de texte et deux boutons occupe une part importante de la fenêtre. Au départ, le résumé indique `0 / 0 carton(s)` alors qu’un formulaire Carton 1 ou Carton 3 est visible.

**Proposition.** Mettre en premier « Mesurer et peser ce carton » : longueur, largeur, hauteur, poids, avec cm/kg permanents et un schéma très simple. Fournisseur et suivi regroupés dans « Identifier le carton », scanner conservé pour les habitués. Pied court : « 1 carton à enregistrer · mesures à compléter » et une action principale. Les consignes de clavier deviennent une aide à la demande sur mobile.

**Recette.** Aucune valeur de mesure n’est inventée ou reprise d’un autre carton. Le compteur décrit les formulaires visibles ; l’erreur conduit au champ manquant. Avec cinq cartons et le clavier ouvert, l’utilisateur atteint toujours le champ et le bouton utiles.

### O04 — Réception : casier, observations, contrôle, photo · P2 · observé et code

**Constat.** « Laisser vide pour garder… » demande de comprendre une convention de saisie. Les compléments de réception sont déjà repliés, ce qui est utile ; ils mélangent toutefois observations facultatives et contrôles potentiellement bloquants.

**Proposition.** Montrer « Casier actuel A-03 » avec Modifier ; nouveau dossier : champ obligatoire explicite. Séparer « Incident ou produit à signaler » de « Ajouter une note/photo ». Un signalement bloquant reste visible même une fois le volet fermé. Photo : Prendre une photo / Choisir une photo, puis miniature et Remplacer.

**Recette.** L’ajout conserve clairement le casier ou annonce le déplacement. Une alerte de contenu n’est jamais masquée au moment d’enregistrer. Les erreurs appareil photo/autorisation laissent l’import de fichier disponible.

### O05 — Mesures à réception déjà enregistrées · P2 · observé

**Constat.** Le récapitulatif détaille chaque fournisseur, suivi, dimensions, poids, poids volumétrique et totaux. L’explication « diviseur valide » est technique. Ces informations n’ont pas toutes la même importance pour retrouver un carton.

**Proposition.** Afficher d’abord « 3 cartons reçus · casier A-03 » et trois cartes numérotées. Dimensions et poids visibles au besoin ; formule volumétrique dans « Détail du calcul ». Si une mesure manque : nom du carton et bouton Compléter, sans parler d’un diviseur à l’opérateur ordinaire.

**Recette.** Trouver un carton précis en moins de dix secondes dans un essai utilisateur. Un résumé incomplet ne doit jamais faire croire que tout est mesuré.

### O06 — Demander l’accord et les factures · P1/P2 · observé

**Constat.** L’étape est courte, et l’aperçu manuel est un acquis. Le choix « Canal », les détails des cartons et le texte complet peuvent encore être lourds sur téléphone. L’email ouvre une messagerie extérieure : ce n’est pas une preuve d’envoi au client.

**Proposition.** « Envoyer par » avec moyen disponible présélectionné. Message court : réception confirmée, action attendue, dépôt des factures des articles concernés. Montrer destinataire et aperçu avant confirmation. Après action, distinguer « Message envoyé » de « Brouillon email ouvert — envoi à confirmer dans votre messagerie ».

**Recette.** Aucun envoi lors d’une simple réception ou consultation. Le responsable peut modifier l’aperçu et décider quand envoyer ; aucune relance automatique ajoutée par cette simplification.

### O07 — Attente, demande d’attendre et refus du client · P2 · observé et code

**Constat.** Les états sont séparés et les échanges accessibles. Il manque au premier regard la date de la dernière demande/réponse et une échéance compréhensible. Un collaborateur peut se demander s’il faut relancer aujourd’hui.

**Proposition.** « Accord demandé le 17 septembre — pas encore de réponse » ; si attente demandée, afficher la raison reçue et la prochaine vérification prévue. Relance secondaire, avec dernier message visible avant nouvel envoi. Refus : nommer la suite à organiser et son responsable.

**Recette.** L’opérateur distingue attente volontaire du client et absence de réponse, sans fouiller l’historique ni envoyer un message pour se rassurer.

### O08 — Démarrer la préparation · P2 · observé et code

**Constat.** L’accord précède correctement la préparation. Les consignes et alertes doivent être vues avant l’action physique, même si la personne qui prépare n’est pas celle qui établit le devis.

**Proposition.** Afficher client, référence, casier, nombre de cartons, accord reçu et seule alerte utile. Bouton « Commencer la préparation ». Une fiche de travail courte accompagne le préparateur ; les choix de facturation restent ailleurs.

**Recette.** Un opérateur de préparation peut accomplir sa tâche avec ses seuls droits, sans accéder au devis, et retrouve les consignes avant de fermer l’emballage.

### O09 — Mesures après optimisation · P1/P2 · observé

**Constat.** L’écran est indépendant et la sauvegarde fonctionne. Mais « Colis sortant », les répétitions du numéro dans chaque libellé en majuscules et le paragraphe sur le manifeste alourdissent la saisie mobile. La sauvegarde des mesures, des tags et du commentaire suit des mécanismes différents.

**Proposition.** Titre « Mesurer les colis préparés après optimisation ». Une carte par colis, champs courts avec unités, « Ajouter un colis préparé ». Résumé distinct « Vous avez reçu 3 cartons ; vous expédiez 2 colis ». Consignes et photo dans un second bloc avec état d’enregistrement clair.

**Recette.** Les mesures à réception restent intactes. Le devis utilise uniquement les nouvelles mesures enregistrées. Revenir à l’écran ou changer de tâche ne perd pas le brouillon.

### O10 — Fin de préparation et passage à un collègue · P2 · observé

**Constat.** Le résumé enregistré est beaucoup plus lisible qu’un formulaire laissé ouvert. Le nom de la prochaine tâche et son attribution peuvent être présents, mais le relais n’est pas toujours évident.

**Proposition.** « Préparation enregistrée à 14 h 32 par Camille · 2 colis · 8 kg ». Puis « Factures à vérifier par … » ou « Devis à établir par … ». Une action vers la tâche permise, ou Retour à mon travail. Modifier les mesures reste secondaire.

**Travail parallèle à préserver.** La vérification des factures peut avancer indépendamment de la préparation. Après accord du client, les mesures se sauvegardent sans attendre la validation des factures ni exiger les droits Devis ; seul le devis attend les prérequis nécessaires.

**Recette.** Préparateur et personne chargée du devis voient la même version sans échanger un message pour demander si le travail est fini.

### O11 — Factures : sélection et document à vérifier · P1/P2 · observé

**Constat.** Le sélecteur, les compteurs, les flèches de facture, le retrait de doublon, la demande de facture, l’alerte d’articles manuels et les commandes de lecture occupent un grand espace avant le document. « Suivant » de l’étape, facture suivante et page PDF suivante coexistent.

**Proposition.** En-tête compact : « Facture 2 sur 3 · 2 à vérifier », vendeur, date et montant si fiables ; sélection directe conservée. Actions fréquentes près du document. Retirer un doublon / Remplacer / Demander une correction dans un menu explicite « Autres actions sur cette facture », avec mise en évidence uniquement si un problème est détecté. Toujours nommer l’objet : Page suivante, Facture suivante, Aller au devis.

**Recette.** Identifier sans ambiguïté la facture affichée et l’action attendue. L’ajout ou le retrait d’une facture actualise immédiatement la liste et les compteurs.

### O12 — Factures : lire et vérifier les articles · P1/P2 · observé

**Constat.** Les deux colonnes sur ordinateur et les onglets sur mobile sont utiles. Les propositions d’analyse, la reprise d’analyse, la saisie manuelle, le vendeur, le total et chaque article composent cependant une longue page. Le nom du fichier n’aide pas toujours à reconnaître l’achat.

**Proposition.** Document visible à gauche et éléments réellement à vérifier à droite ; résumé des articles déjà corrects, ouverture des détails à la demande. Si la catégorie manque, pointer directement l’article concerné. Conserver la possibilité de revoir tous les champs ; ne pas masquer une incertitude de l’analyse. Sur mobile, boutons explicites « Voir la facture » / « Vérifier les articles », position et zoom conservés.

**Recette.** Valider une facture à un article sans parcourir des commandes d’exception. Une facture de vingt articles reste navigable avec repères et progression ; toutes les lignes nécessitant une décision sont atteignables.

### O13 — Factures : validation, brouillon, erreur et conflit · P1 · observé et code

**Constat.** La validation passe déjà à la prochaine facture en attente, et le résumé de fin est présent. En bas, validation, brouillon, correction, navigation et articles manuels restent proches. Une personne novice peut confondre sauvegarder et valider.

**Proposition.** Action principale « Valider cette facture », avec mention « puis ouvrir la suivante ». Secondaire « Garder en brouillon ». Après succès : « Facture enregistrée · il reste 1 facture ». Une erreur reste attachée à cette action et propose une reprise sans doublon. En conflit : qui a enregistré, quand, ce qui diffère et ce qui sera conservé.

**Recette.** Ne jamais annoncer « validée » avant confirmation. Une coupure conserve la saisie et ne fait pas avancer comme si l’action avait réussi. Factures terminées : résumé, Consulter, Aller au devis ; pas de réouverture automatique des éditeurs.

### O14 — Factures : doublons, corrections et articles manuels · P1/P2 · observé et code

**Constat.** Le retrait est réversible et les documents retirés sont séparés, acquis à conserver. L’original à garder peut être difficile à reconnaître avec des noms de fichiers. Les articles saisis sans facture ajoutent un second ensemble de montants à comprendre.

**Proposition.** Comparaison « Garder cette facture / Retirer cette copie », avec vendeur, date, montant et aperçu. Pour un article manuel, indiquer « Achat supplémentaire sans facture reliée » et proposer une revue explicite lorsqu’une facture correspondante arrive. Le motif d’une correction doit être directement lisible par le client, avec une seule demande regroupée quand c’est pertinent.

**Recette.** Un doublon retiré n’est pas compté dans le devis. Sa restauration le remet à vérifier, si le dossier est modifiable et les droits suffisants ; sa reprise dans le devis exige la validation prévue. Aucun rapprochement ou retrait silencieux d’article ; conserver la décision et l’historique.

### O15 — Devis : compléter, vérifier et envoyer · P1/P2 · observé

**Constat.** Les PDF et éditeurs ont bien disparu du devis. Reste une succession de prérequis, frais, avertissements, estimation, total et état de brouillon. Un avertissement non bloquant sur les anciennes mesures peut attirer autant l’attention qu’une erreur qui empêche l’envoi.

**Proposition.** D’abord « Total client » et état explicite : À compléter / Prêt à vérifier / Brouillon enregistré / Envoyé. Présenter Transport, Taxes, Frais ; détail des taxes disponible. Montrer les blocages seuls en priorité, avec liens directs ; les informations secondaires deviennent une note. Récapitulatif final destinataire, montant, conditions et moyen d’envoi avant Envoyer.

**Recette.** Comprendre en dix secondes si le devis peut être envoyé et, sinon, pourquoi. Distinguer estimation non enregistrée et dernier devis enregistré ; seul le devis vérifié courant peut être envoyé. Une modification après vérification oblige à vérifier de nouveau.

### O16 — Paiement particulier et professionnel · P1/P2 · observé et code

**Constat.** Le montant et l’attente sont clairs. Le lien de paiement peut être une URL brute. Pour les professionnels, la confirmation du paiement est une action sensible ; le texte de modification des modalités renvoie encore à la préparation, alors qu’un écran Devis existe.

**Proposition.** « Paiement attendu : 62,39 € » et « Devis envoyé le… ». Boutons Copier le lien / Ouvrir le paiement, sans longue URL. Professionnel : conditions convenues, échéance et confirmation explicite « J’ai reçu le paiement », avec montant et mode. Corriger les renvois pour viser la véritable action autorisée.

**Recette.** Ouverture du prestataire et paiement confirmé sont deux états différents. Les échecs, retours et notifications asynchrones ne produisent pas de faux succès. Un paiement manuel exige la bonne permission.

### O17 — Affecter une expédition à un départ · P1/P2 · observé

**Constat.** L’écran dit « Affecter à un envoi », le champ accessible parle de départ, puis l’action de manifeste. La sélection enregistre immédiatement. Sans départ compatible, l’écran explique le problème, mais n’offre pas de lien direct pour le résoudre.

**Proposition.** « Choisir le départ » ; cartes ou options date complète, destination et heure limite. Sélection puis confirmation « Affecter à ce départ », ou sauvegarde immédiate annoncée avec résultat visible. Si aucun départ : Créer un départ pour les personnes autorisées, ou Demander à [responsable].

**Recette.** Pas de confusion entre EXP-… et départ collectif. La destination et le verrouillage restent contrôlés ; une sélection ratée revient à la valeur réellement enregistrée.

### O18 — Transport, douane, arrivée et livraison · P1/P2 · observé

**Constat.** Les actions suivent le statut réel. Mais choisir l’écran Livraison alors que le dossier est En vol affiche le bloc « Suivi d’expédition » avec des actions de douane. Deux boutons de transition très colorés ont parfois le même poids visuel.

**Proposition.** L’écran Livraison doit afficher soit le travail de livraison, soit « La livraison n’a pas commencé : l’expédition est en vol » avec Voir le transport. Une action principale par situation, exception « Arrivée sans dédouanement » dans une action secondaire autorisée. Date, preuve ou commentaire utile au bon endroit ; notification toujours distincte et volontaire.

**Recette.** Le titre de l’écran correspond à son contenu. Une consultation anticipée ne change pas le statut. La livraison finale confirme précisément le dossier, puis affiche le résultat et son horodatage.

### O19 — Contexte : identité, cartons et mesures · P1 · observé et code

**Constat reproduit.** Avec deux colis préparés de 3 kg et 5 kg, Préparation affiche bien **2 colis · 8 kg**, mais le panneau Réception affiche « Après optimisation » pour un seul colis de **3 kg**. `ReceivedCartons` construit encore ce résumé depuis les champs simples `finL/finW/finH/finP`, sans parcourir `finalPackages`. Il s’agit d’une incohérence d’affichage, pas d’une preuve que le calcul du devis utilise cette mauvaise synthèse.

**Proposition.** Résumé commun fondé sur tous les colis préparés : « 2 colis préparés après optimisation · 8 kg », puis chaque colis. Bien séparer Avant préparation / Après préparation. Masquer abonnement et invitation Telegram de cette section quand ils n’aident pas à retrouver le colis ; les rendre accessibles dans Client.

**Recette.** Tous les écrans donnent le même nombre et le même total pour un, deux ou cinq colis. L’ancien modèle de données reste lisible mais ne remplace pas un manifeste multiple.

### O20 — Contexte : documents, messages, équipe et historique · P2 · observé

**Constat.** Le tiroir partagé évite d’encombrer le devis et conserve les saisies lorsqu’on le ferme. Les Documents proposent plusieurs verbes proches : Lire, Consulter, Ouvrir la vérification. Équipe distingue référent et responsable d’action sans explication courte. L’historique technique peut être peu parlant.

**Proposition.** Documents : « Voir » et « Vérifier » seulement si nécessaire. Messages : destinataire et moyen d’envoi visibles ; réponse et suivi interne séparés. Équipe : « Suit le dossier » puis « Réalise cette tâche ». Historique : phrases « Camille a enregistré les mesures à 14 h 32 », détails techniques à la demande.

**Recette.** Fermer et rouvrir le panneau conserve le brouillon ; lire un document ne le modifie pas ; un événement identifie personne, action et date.

### O21 — Corrections, archivage et annulation · P1 · observé et code

**Constat.** Les commandes sont discrètes, mais petites, et « Annuler le colis » peut signifier abandonner une saisie ou annuler un dossier. Les effets de l’archivage et du retour de statut méritent d’être distingués. **Contradiction dans le code :** la confirmation promet que les devis sont conservés, alors que `revert_colis` peut effacer le total et la version calculée du devis et remettre l’accord en attente, selon la transition. Ce n’est pas une annulation générique du dernier événement. Aucune correction de statut réelle n’a été exécutée pour cet audit.

**Proposition.** Menu « Corriger le dossier » avec trois actions nommées : Corriger l’étape vers [étape cible]…, Annuler cette expédition…, Archiver ce dossier…. Confirmation décrivant l’impact exact, y compris devis ou paiement déjà existant, et les possibilités réelles de récupération. Garder Annuler pour fermer la fenêtre de confirmation sans agir.

**Recette.** Pas de modification sensible déclenchée par un simple bouton de navigation ; confirmation lisible, clavier utilisable, permissions et historique conservés.

Sources principales de cette partie : [StaffDetailView](../pinta/src/expedile/components/staff/StaffDetailView.jsx), [ColisModal](../pinta/src/expedile/components/ColisModal.jsx), [InvoiceWorkspace](../pinta/src/expedile/components/detail/InvoiceWorkspace.jsx), [DossierDocumentsTask](../pinta/src/expedile/components/staff/DossierDocumentsTask.jsx), [ReceivedCartons](../pinta/src/expedile/components/detail/ReceivedCartons.jsx), [DetailHeader](../pinta/src/expedile/components/detail/DetailHeader.jsx), [TaskContinuation](../pinta/src/expedile/components/workspace/TaskContinuation.jsx), [DossierContextPanel](../pinta/src/expedile/components/detail/DossierContextPanel.jsx), [TaskMessage](../pinta/src/expedile/components/staff/TaskMessage.jsx).

## 5. Écrans de travail et coordination de l’équipe

Ces écrans ont été visités sur ordinateur et mobile, avec trois collaborateurs fictifs, puis un rôle limité à la préparation et une liste de cent dossiers. Les reproductions et références précises figurent dans l’[annexe Équipe](audit-simplification-2026-09-17/annexe-equipe.md).

| Écran ou vue | Ce qui gêne aujourd’hui | Simplification précise | Priorité et recette |
| --- | --- | --- | --- |
| E01 — Menu équipe et Plus sur mobile | Conversations est derrière Plus, alors que les échanges sont une activité centrale. | Pour les collaborateurs habilités : Mon travail, Dossiers, Conversations, Plus. Accès Clients conservé dans Plus ; compteur des demandes à traiter. | **P1.** Une pression pour ouvrir les conversations ; les droits restent respectés. |
| E02 — Mon travail : À faire | Sur 390 × 844, les contrôles d’organisation repoussent la première tâche vers 720 px. | Montrer une tâche complète dès le premier écran. Regrouper recherche, mission et préférences ; résumer les filtres actifs. | **P1.** Voir client, EXP, action et bouton sans défiler à taille normale. |
| E03 — À prendre, En attente, relais | Les états sont utiles, mais les commandes Commencer, Consulter, titre cliquable et Traiter le suivant sont proches. | Une action principale : Prendre, Commencer ou Reprendre selon l’état. « Consulter sans commencer » en secondaire ; raison d’attente et responsable explicites. | **P1.** Une consultation n’attribue rien ; un relais n’est transféré qu’après acceptation. |
| E04 — Mes missions et disponibilité | Le formulaire occupe l’écran ; sur ordinateur, le bouton Équipe s’étire avec sa hauteur. | Panneau dédié : disponibilité, missions, puis options d’affichage repliées. Boutons Enregistrer/Annuler stables. | **P2.** Aucun voisin étiré ; changement de mission ne change pas les permissions. |
| E05 — Dossiers : liste et recherche | File, étape, statut, ordre, tri et envoi multiplient les axes. « Feu vert » reste ailleurs « Accord client ». | Titre Dossiers, recherche, filtres courts ; une commande Regrouper : Aucun / Étape / Départ. Vocabulaire identique au dossier. | **P1/P2.** Retrouver EXP, accord manquant ou prochain départ sans essayer plusieurs classements. |
| E06 — Dossiers : cartes mobiles | L’action suivante est visible, mais l’étape textuelle et le nombre de cartons sont moins explicites qu’en tableau. | Client + EXP ; action ; étape écrite ; nombre de cartons + casier. Responsable en secondaire. | **P1.** Distinguer Payé, En préparation et Accord attendu sans interpréter une pastille de couleur. |
| E07 — Groupes, filtres, liste dense | Cent dossiers fonctionnent dans le scénario ; le tableau dépasse 7 000 px de hauteur. Aucun diagnostic de lenteur n’en découle. | Groupes repliables, filtres actifs visibles, retour à la position consultée. Mesurer avant d’imposer pagination/virtualisation. | **P2/P3.** Ouvrir le 70e dossier puis revenir sans perdre tri, filtres ou position. |
| E08 — Aperçu d’un dossier | Dans un cas message + facture, l’instruction est « Répondre au client », le bouton principal « Vérifier les factures ». | Une même décision fournit le libellé et la destination. Si deux tâches sont nécessaires, les nommer séparément avec une priorité claire. | **P1.** Le bouton fait exactement ce qu’annonce l’instruction pour chaque combinaison. |
| E09 — Aperçu et tableau côte à côte | Le panneau de 500 px comprime fortement les colonnes ; sur mobile, X est le seul repère de fermeture. | Réduire volontairement la liste à client/EXP/action en présence du panneau. « Retour aux dossiers » sur mobile et accès pleine page. | **P2.** Référence, nom et action lisibles sans défilement horizontal ; position conservée au retour. |
| E10 — Conversations : liste et réponse | Beaucoup de pilotage avant les messages ; champ d’une ligne et Entrée envoi. | En-tête court, responsabilité compacte, réponse multiligne, bouton Envoyer qui précise le canal ; gestion dans une action secondaire. | **P1/P2.** Voir les échanges et rédiger trois lignes sans envoi accidentel. |
| E11 — Conversations : brouillon | **Reproduit :** saisir une réponse, aller à Mon travail puis revenir efface le texte sans avertissement. | Brouillon isolé par utilisateur et dossier, indicateur Brouillon, abandon explicite ; conserver après échec d’envoi. | **P1.** Consulter une facture ou un autre dossier puis revenir conserve le message, sans l’envoyer. |
| E12 — Message reçu sans dossier | Le contenu texte est présenté, mais la pièce jointe de l’inbox n’est pas consultable avant affectation dans le scénario. | Nom et aperçu sécurisé du fichier ; sélection d’expédition avec client, contenu, date, cartons ; confirmation du dossier cible. | **P1.** Rattacher une facture en sachant de quel document il s’agit ; aucun classement implicite. |
| E13 — Équipe : charge et tâches | Trois cartes de membres puis quatre filtres occupent déjà tout le premier écran mobile. | Charge résumée par membre ; mettre les tâches sans responsable, bloquées et relais à accepter à portée. Recherche EXP/client. | **P1/P2.** Avec cinq personnes et cinquante tâches, retrouver rapidement une tâche ou une personne disponible. |
| E14 — Attribution, référent et relais | Responsable de tâche, référent, réaffectation et relais sont voisins mais différents. | « Suit le dossier » et « Réalise cette tâche ». « Proposer un relais — acceptation requise » distinct de « Réaffecter immédiatement ». | **P2.** Savoir qui reste responsable après chaque action ; expliquer l’absence de candidat autorisé. |
| E15 — Départs : liste et planification | Anciens départs et départs futurs se mélangent ; dates et statuts techniques se côtoient. | À préparer / Partis / Archivés ; prochain départ d’abord, ancien planning à reprogrammer signalé ; dates françaises. | **P1/P2.** Identifier le prochain chargement, sa destination et son heure limite au premier regard. |
| E16 — Chargement, reports et documents de départ | Blocage générique paiement + mesures, sans accès direct au correctif ; exports concurrencent l’action de chargement. | Prêts à charger / À débloquer ; raison exacte et bouton vers la tâche ; recherche/scan EXP ; exports dans Documents du départ. | **P1.** À trente dossiers, repérer les trois bloqués ; confirmation finale annonce chargés et reportés, sans perte de sélection au retour. |

La recherche de cent dossiers était concluante dans la fixture. La priorité n’est donc pas de changer l’infrastructure au nom du volume annoncé de 1 000 colis par mois : il faut d’abord réduire les hésitations, les déplacements d’écran et les reprises de saisie. Une mesure réelle du temps de chargement reste distincte de cet audit de lecture.

## 6. Écrans client, accès et suivi public

Ces vues ont été parcourues sur ordinateur et téléphone, avec un contrôle complémentaire à 320 px et en thème sombre pour l’accord. Les preuves, scénarios exacts et limites se trouvent dans l’[annexe Client et accès](audit-simplification-2026-09-17/annexe-client.md).

| Écran ou vue | Ce qui gêne aujourd’hui | Simplification précise | Priorité et recette |
| --- | --- | --- | --- |
| C01 — Connexion / première utilisation | Formulaire court, mais un nouveau client sans identifiants n’a pas d’instruction de première connexion. | « Première connexion ? » vers le vrai parcours d’invitation et une aide joignable. Ne pas inventer une inscription libre. | **P2.** Savoir comment obtenir son accès depuis cet écran. |
| C02 — Mot de passe oublié / lien expiré | Le lien de récupération expiré testé revient à Connexion sans explication. Après demande de lien, le formulaire reste presque identique. | « Ce lien n’est plus valable » puis Recevoir un nouveau lien ; après demande, état Vérifiez votre messagerie, adresse conservée. | **P1/P2.** Récupération possible sans connaître l’ancien mot de passe ; succès et échec clairement annoncés. |
| C03 — Changement de mot de passe / session active | Activation, récupération et changement volontaire partagent un discours proche. Le compte actif n’est pas toujours identifiable par son email de connexion. | Titres adaptés ; identité du compte ; Changer de compte via déconnexion ; accès Compte et sécurité facile sur mobile. | **P2.** Reconnaître le mode en cours et quitter le bon compte sans conserver le brouillon d’un autre utilisateur. |
| C04 — Présentation de première connexion | Explique le service en trois étapes mais peu les gestes : facture, réception et attente d’autres achats. | Terminer par une première action concrète et les consignes de réception vérifiées. Aide consultable de nouveau. | **P2.** Le client sait où envoyer ses achats, où joindre ses factures et comment attendre d’autres cartons. |
| C05 — Accueil client / aucun dossier | Les groupes sont utiles ; certaines cartes décrivent une action équipe alors que le client doit envoyer une facture. « Vous êtes à jour » aide peu un nouveau client sans dossier. | Faire primer « Envoyer une facture » ou « Donner mon accord ». État vide avec premier pas réel et aide. | **P2.** Le client comprend immédiatement ce qui dépend de lui et ce qui est en cours côté équipe. |
| C06 — Liste des expéditions | Six filtres sur plusieurs lignes précèdent les premières cartes. | Trois choix principaux : À faire, En cours, Historique ; filtres plus fins à la demande, recherche visible. | **P2.** Première expédition et filtre actif repérables sans interpréter « Pris en charge » versus « En cours ». |
| C07 — Historique et recherche | **Reproduit :** une EXP archivée est annoncée absente jusqu’au clic séparé « Charger mes anciens dossiers archivés ». | Charger l’historique à son ouverture ou rechercher sur tous les dossiers autorisés ; dire quand des données restent à charger. | **P1.** Une référence exacte archivée se retrouve avec une recherche ; pas de faux zéro définitif. |
| C08 — Accord, attente d’autres cartons, refus | Les trois choix existent et l’accord précise son périmètre. Motif et date d’attente sont moins visibles après décision. | Garder la confirmation du nombre de cartons ; après pause, afficher raison, date et Reprendre. Alléger les répétitions de statut. | **P2.** Attendre ne signifie ni refuser ni autoriser ; aucune préparation de cartons ajoutés sans le contrôle d’accord prévu. |
| C09 — Déposer des factures | Plusieurs titres successifs, vendeur facultatif avant le fichier. Dépôt multiple et résultat par fichier déjà présents. | « Mes factures », fichier d’abord, « Toutes les pages, lisibles » ; vendeur en option. | **P2.** Un dépôt réussi est reconnu ; après échec partiel, seuls les fichiers en échec sont repris. |
| C10 — Corriger une facture | **Reproduit :** l’action Corriger ouvre un dépôt encore réglé sur Nouvelle facture. | Cibler la facture rejetée, montrer son motif au-dessus du fichier ; choisir si plusieurs corrections ; autre facture en option distincte. | **P1.** La correction remplace la bonne version via sa relation de remplacement, sans effacer l’original ni créer une nouvelle facture par erreur. |
| C11 — Documents dans le profil | **Reproduit :** une ancienne facture rejetée reste « À corriger » alors que sa remplaçante est validée. | États identiques dans profil et dossier : Courante, Remplacée, Copie retirée ; historique replié, lien vers l’expédition. | **P1.** Aucune demande de correction obsolète dans un autre écran. |
| C12 — Notification reçue | **Reproduit :** une notification de message ouvre le dossier, mais laisse la conversation fermée. La notification devient lue avant consultation du message. | Ouvrir directement le message, la facture ou l’action concernés, avec focus au bon endroit. | **P1.** Une pression montre le contenu demandé ; lire ne valide aucune action. |
| C13 — Messages et brouillon | **Reproduit :** quitter le dossier vers la liste et revenir efface une réponse non envoyée. Historique court et saisie d’une ligne. | Brouillon par compte/dossier, champ multiligne et historique plus généreux à l’ouverture. | **P1/P2.** Aller lire une facture ou un autre dossier ne fait pas perdre l’adresse ou la réponse en cours. |
| C14 — Devis et paiement particulier | Total et action arrivent après plusieurs explications ; référence comprimée par un long badge. | Montant total et action immédiatement visibles ; détail transport/taxes à la demande, PDF conservé ; badge court. | **P2.** Le montant payable est celui de la version publiée ; aucun paiement d’un devis retiré ou déjà réglé. |
| C15 — Règlement professionnel | Le virement est nommé, mais ses instructions peuvent nécessiter de consulter les échanges. | Instructions validées selon la modalité, échéance et référence ; bouton Copier les informations. Aide si donnée manquante. | **P2.** Comprendre comment payer sans demander les mêmes informations ; aucun IBAN ni délai inventé. |
| C16 — Transport et suivi sortant | **Reproduit avec références distinctes :** le lien de suivi ouvre le premier numéro fournisseur reçu, malgré un suivi sortant sur le départ. | Séparer Suivi vers l’entrepôt et Suivi vers votre adresse. Si aucun suivi sortant fiable, afficher le statut interne sans détourner le suivi fournisseur. | **P1.** Avec deux suivis fournisseurs et un suivi sortant, chaque lien ouvre le bon objet. Le constat ne dit pas que tous les dossiers réels sont affectés. |
| C17 — Livraison et fin de parcours | La dernière date disponible peut être celle du paiement ; elle ne dit pas quand le transport a été mis à jour. | Dernier événement logistique nommé et daté ; créneau seulement s’il est confirmé ; sinon le dire. | **P2.** Aucune date estimée présentée comme engagement confirmé ; savoir si une action client est attendue. |
| C18 — Profil, aide et coordonnées | Longue page réunissant coordonnées, Telegram, documents, sécurité, export et suppression. | Trois groupes : Coordonnées, Notifications, Compte ; aide accessible ; email de contact distinct de l’identifiant. | **P2.** Retrouver aide et déconnexion facilement ; Enregistrer/Annuler clairs sur l’édition. |
| C19 — Liaison Telegram / compte déjà connecté | Deux gestes pour lier Telegram ; une association existante indique « Votre compte est connecté » sans beaucoup d’aide. | Montrer étapes Ouvrir Telegram → Démarrer → Confirmation ; identité disponible et aide pour changer de compte. | **P2.** Comprendre si le lien est créé ou si le compte est réellement lié ; invitation expirée renouvelable. |
| C20 — Notifications et navigation | Un compteur non lu peut être interprété comme un nombre de tâches. Les quatre destinations stables sont utiles. | Nommer « non lues », garder les actions attendues sur l’accueil ; conserver la navigation existante sans ajouter d’onglets. | **P2.** Lire un message ne signifie pas avoir envoyé la facture ou payé. |
| C21 — Suivi public partagé | **Reproduit :** « À vous · Consulter le devis… » s’adresse à un visiteur anonyme qui n’a pas cette action. | Narration neutre : « Règlement attendu du client ». Accès au compte réservé au titulaire si proposé. | **P1.** Le proche qui suit un envoi ne croit pas devoir payer ; aucune donnée privée supplémentaire exposée. |
| C22 — Lien public expiré / erreur réseau | Un problème temporaire n’offre pas clairement Réessayer. | Distinguer lien invalide/expiré et service momentanément indisponible ; action de récupération adaptée. | **P2.** Une panne n’oblige pas à demander un nouveau lien ; aucune information supplémentaire dévoilée par une erreur. |

L’espace client devrait toujours distinguer **ce que le client doit faire**, **ce que l’équipe fait** et **ce qui est simplement informatif**. C’est cette séparation, plus qu’un tableau de bord plus riche, qui réduira les demandes « Où en est mon colis ? » et les retours incomplets.

## 7. Clients, estimation, administration et exports

L’[annexe Administration](audit-simplification-2026-09-17/annexe-admin.md) contient les reproductions détaillées, les observations d’accessibilité et la lecture du fichier Excel fictif généré. Les défauts d’enregistrement décrits ci-dessous concernent le comportement frontend observé avec réponses simulées ; ils ne prétendent pas démontrer ce que la base de production accepterait.

| Écran ou vue | Ce qui gêne aujourd’hui | Simplification précise | Priorité et recette |
| --- | --- | --- | --- |
| A01 — Clients : liste et cartes | Onze colonnes en tableau ; contacts hors du premier cadre mobile. Les cartes existent mais ne sont pas le choix initial adaptatif. | Carte mobile nom/contact/dossiers actifs ; filtres simples et recherche ; mémoriser le choix d’affichage. | **P2.** Retrouver client et moyen de contact sans balayage horizontal ; retour conserve recherche/position. |
| A02 — Import : fichier | Beaucoup d’exemples de colonnes, pas de modèle téléchargeable ni réaffectation simple. | Fichier exemple, minimum requis explicite, étape Correspondance des colonnes modifiable. | **P2.** Corriger une colonne ignorée sans refaire son fichier. |
| A03 — Import : aperçu et doublons | Dix premières lignes visibles, choix global de doublons, boîte mobile partiellement sous l’en-tête. | Consultation des erreurs et lignes suivantes, décision par doublon ; titre/fermeture toujours visibles. | **P2.** Contrôler la onzième ligne et traiter un doublon particulier. |
| A04 — Import : progression et bilan | Dans le code, Annuler reste affiché alors que l’action est neutralisée pendant import ; fin partielle peu différenciée. | Arrêter après la ligne courante si réellement possible, sinon expliquer ; bilan importés/échecs et reprise ciblée. | **P2.** Un bouton ne promet pas un arrêt inexistant ; un échec partiel n’affiche pas un succès complet. États lus dans le code, non exécutés en lot. |
| A05 — Création particulier/pro | Dix-huit champs visibles dans le cas particulier ; abonnement avant identité ; types tronqués sur mobile. Une requête avec email invalide et téléphone vide a été émise dans la fixture malgré les astérisques. | Identité, destination, contact en premier ; options après. Exigences identiques aux validations ; erreurs au champ ; labels reliés aux contrôles. | **P1/P2.** Email invalide : aucune requête ; type de client et champs lisibles au toucher. Pas de conclusion sur acceptation serveur réelle. |
| A06 — Après création : invitations | Portail, Telegram et email de bienvenue peuvent paraître équivalents. | État du compte clair puis « Comment le client suivra son expédition ? » ; distinguer invitation d’accès, association et brouillon email. | **P2.** Savoir ce qui a été créé, envoyé ou seulement préparé. |
| A07 — Fiche client : Synthèse | Bonne séparation de la synthèse ; ancien lien client peut renvoyer silencieusement à la liste. | Conserver les blocs utiles ; message Client introuvable avec retour contextualisé. | **P3.** Une absence n’a pas l’apparence d’un clic sans effet. |
| A08 — Fiche client : Coordonnées | **Reproduit :** Annuler conserve le nom modifié dans le formulaire rouvert, sans écriture. | Annuler restaure vraiment la version enregistrée, ou renommer l’action si le brouillon doit rester. Invitations séparées de l’édition. | **P1.** Aucun changement supposé abandonné ne part lors d’une sauvegarde ultérieure. |
| A09 — Abonnement et administration | Offre, notes, pro, partage et suppression réunis ; dépendances de permissions à clarifier pour sauvegarder l’offre. | Sections courtes Offre / Facturation / Accès ; zone de danger distincte ; champs pro éditables après création. | **P2.** Un utilisateur habilité à modifier l’offre peut terminer et enregistrer cette action. |
| A10 — Supprimer un client | **Reproduit :** le premier clic sur un client sans dossier émet immédiatement DELETE dans le mock, sans confirmation. | Confirmation nommant client et effets ; archivage réversible si compatible avec le besoin métier. | **P1.** Premier clic ouvre une confirmation ; Annuler n’émet aucune suppression ; erreur garde la fiche. |
| A11 — Pro : récapitulatif et Excel | **Reproduit dans un export fictif :** article d’un doublon retiré inclus, transport réparti dessus et poids simple de 3 kg retenu malgré deux colis de 3 + 4 kg. Modalité « 30j » restituée Fin de mois dans le cas testé. | Même source que le devis : factures courantes, colis finaux, version de calcul, modalité unifiée. Nommer période et dossiers exportés. | **P1.** Écran/fichier/devis concordent ; aucune copie retirée dans les montants ; poids facturable cohérent, sans confondre somme des poids réels et règle tarifaire. |
| A12 — Partage du suivi | Gestion du lien public et invitation à l’espace privé proches dans la fiche. | « Partager le suivi avec un proche », aperçu du contenu visible, révocation confirmée. | **P2.** Le responsable sait que ce lien ne crée pas un compte client et quelles informations il partage. |
| A13 — Estimation particulier / pro | Erreurs dès le formulaire vide ; résultat sous les coordonnées sur mobile ; un carton et une catégorie seulement. | Saisie mesures/contenu puis résultat, contact seulement pour partager ; limites visibles ou plusieurs colis si retenu. Passage vers dossier sans ressaisie inutile. | **P2.** Obtenir une estimation rapidement sans la confondre avec les mesures finales ni le devis validé. |
| A14 — Estimation : copie, PDF, email | Plusieurs moyens de partage ; email correctement présenté comme préparé, pas confirmé envoyé. | Aperçu puis moyen choisi, hypothèses et validité de l’estimation lisibles ; possibilité de réutiliser une estimation utile. | **P2/P3.** Même total et mêmes hypothèses dans écran, PDF et copie. Conserver l’honnêteté sur l’email. |
| A15 — Paramètres : navigation | Huit onglets sans URL propre, retour à Départs après rechargement ; travail opérationnel mélangé aux réglages. | Regrouper Organisation, Tarifs et règles, Communications, Équipe et accès ; lien direct par rubrique. Départs opérationnel reste dans son menu. | **P2.** Retrouver la rubrique après retour/rechargement et protéger les brouillons. |
| A16 — Tarifs par destination | **Reproduit :** première destination envoyée en sauvegarde avant découverte d’une valeur invalide sur la suivante ; message global peu précis. | Valider tout avant écriture ; sauvegarde atomique ou bilan précis des écritures réussies/échouées. Aperçu de l’effet sur futurs devis. | **P1.** Une erreur locale n’écrit rien ; une panne ne produit jamais de succès partiel silencieux. |
| A17 — Catégories, taxes et code douanier | **Reproduit :** après erreur 503 simulée, champ à 17 alors que valeur enregistrée reste 10 ; notification seulement temporaire. Tous les taux visibles, jargon OM/OMR. | Brouillon explicite par catégorie, Enregistrer/Annuler, erreur persistante ; recherche, état À compléter et édition par destination. | **P1/P2.** Distinguer enregistré et non enregistré ; pas de perte de saisie rapide ; aucune mention « vérifié » trompeuse. |
| A18 — Équipe et accès : permissions | Sauvegarde explicite et gestion des brouillons déjà présentes ; 53 cases ouvertes difficiles à comprendre. | Profils de tâches préconfigurés, résumé des possibilités et exceptions, réglages détaillés repliés. | **P2.** Configurer Réception ou Préparation sans interpréter toutes les cases ; sauvegarde et conflit restent gérés. |
| A19 — Droits délégués / visibilité des paramètres | **Reproduit :** un préparateur doté de droits admin ciblés ne voit pas les onglets correspondants, filtrés aussi par rôle Direction. | Alignement rubrique/droit effectif, ou règle de non-délégation explicite. Consultation et écriture distinctes. | **P1.** Chaque droit isolé donne exactement l’accès annoncé, sans élévation de privilège. |
| A20 — Créer, suspendre ou retirer un équipier | Mot de passe initial à transmettre ; pas de suspension/réactivation clairement exposée dans la fiche examinée. | Invitation et état d’activation ; suspension avant suppression quand pertinent ; responsabilités restantes visibles. | **P2.** Arrivée/départ d’un collègue sans secret transmis improvisément ni tâche abandonnée. Parcours d’envoi réel non testé. |
| A21 — Telegram et canaux | Explications statiques, sans état de fonctionnement ni dernière réception ; pas de rubrique email équivalente. | État des canaux, dernier événement et lien Conversations ; aide liaison ; réglages techniques réservés aux personnes concernées. | **P2.** Comprendre un échec de communication sans ouvrir le fournisseur. L’audit ne conclut pas à une panne réelle. |
| A22 — Modèles de messages | **Reproduit :** treize modèles comprimés à 24–27 px sur mobile, textes superposés ; quitter l’onglet perd le brouillon. | Sélecteur mobile lisible, brouillon protégé, aperçu client ; modèles regroupés selon le flow actuel et variables pertinentes à la demande. | **P1/P2.** Sélectionner un modèle au toucher et quitter/revenir sans perte ; historique nommé selon sa vraie portée. |
| A23 — Règles métier | Champs texte, erreurs avec noms techniques et séquences J+2 peu explicites. | Nombres + unités, choix de jours et exemple d’échéance ; annoncer si la règle propose une relance ou l’envoie réellement. | **P2.** Une règle est compréhensible avant sauvegarde ; préserver le contrôle manuel voulu pour les notifications. |
| A24 — Produits interdits | Liste simple ; peu d’explication de l’effet d’une modification. | Garder simple, ajouter recherche/motifs si volume utile et expliquer l’impact opérationnel. | **P3.** Retrait confirmé avec nom ; ne pas laisser croire que la liste remplace un contrôle réglementaire. |
| A25 — Exports de dossiers | Bouton Export peu descriptif, périmètre filtres/sélection implicite. | « Exporter 23 dossiers filtrés » ou « Exporter les 4 sélectionnés », avec format et colonnes. | **P2.** Le nombre et le périmètre du fichier correspondent à la promesse. Export général lu dans le code ; export pro téléchargé et relu. |
| A26 — Statistiques / pilotage | Composants KPI présents dans le code mais sans parcours actif repéré ; aucun écran statistique accessible constaté. | Décision produit explicite : pilotage direction séparé de Mon travail, avec période et définition des chiffres, si nécessaire. | **P2.** Aucun indicateur orphelin ou nombre sans périmètre. Ne pas présenter cet écran comme déjà disponible. |

Source complémentaire O21 : [règles de retour de statut](../pinta/supabase/migrations/20260910000006_permissions_corrections.sql), confrontées au texte de confirmation de `StaffDetailView`.

## 8. États transversaux et angles morts à inclure dans la refonte

| État ou fonction | Examen effectué | Recommandation / recette |
| --- | --- | --- |
| Chargement initial et erreur de données | Code des écrans de chargement et bannières de `App.jsx` ; états transitoires rencontrés pendant les visites. | Ne jamais remplacer un échec par zéro dossier. Dire quoi est indisponible, garder Réessayer et les saisies. Mesurer le réseau réel séparément. |
| Dossier/client introuvable ou accès limité | Code des routes, garde de permissions et redirections ; rôle limité visité côté équipe. | Explication adaptée et retour utile ; distinguer absence de droit et absence de donnée sans exposer d’informations privées. |
| Action en cours, réussite, échec, conflit entre collègues | Lecture des gestionnaires ; essais ciblés d’erreurs de tarifs/catégories et de perte de brouillons. | État visible jusqu’à résolution, une seule action en cours, reprise sans double effet. Préserver les protections de version des factures/mesures. |
| Confirmation sensible | Lecture de `ConfirmDialog`, appels de correction et suppression ; suppression client testée sur mock. | Nom, objet et conséquences exactes ; Annuler ne fait rien ; aucune promesse de conservation incompatible avec les règles serveur. |
| Caméra, fichier et PDF | Lecteur PDF réellement rendu sur document fictif ; choix/gestion caméra et fichier lus dans le code. | Alternatives Prendre une photo / Choisir un fichier, reprise après permission refusée, fichier lisible ou explication. Tester HEIC, appareil réel, rotation, gros PDF et lecteur d’écran avant livraison future. |
| Archivage, doublons, documents remplacés, fin de dossier | États de dossiers et documents examinés ; historique client recherché et export pro relu. | Même définition de document courant partout. Consultation de l’historique distincte d’une action à réaliser aujourd’hui. |
| Déconnexion, changement d’utilisateur, perte de session | Authentification/session observées, conservation des brouillons examinée dans les composants. | Ne jamais afficher le brouillon d’un autre compte ; annoncer une session expirée sans perdre silencieusement une saisie récupérable. |
| Notifications Telegram/email et prestataire de paiement | Écrans et destinations de liens observés ; services externes non sollicités réellement. | Tester ensuite les parcours réels dans un cadre d’essai : invitation, refus/expiration, ouverture email, retour paiement et absence de double envoi. |
| Exports et pièces imprimées | Excel pro généré et relu ; exports généraux/PDF/liste de départ examinés par leurs points d’accès et code. | Nom de fichier explicite, période/version/périmètre visibles, mêmes données que l’écran. Une vérification complète des impressions reste à programmer. |
| Clavier, zoom, thèmes et technologies d’assistance | Contrôles automatisés ciblés et inspection mobile ; thème sombre échantillonné. | Recette globale au clavier et zoom, puis VoiceOver/TalkBack et appareils réels. Les défauts détectés dans des formulaires admin ne sont pas annulés par la réussite d’autres parcours automatisés. |

### Couverture des routes

| Route / point d’entrée | Vues couvertes dans le rapport |
| --- | --- |
| Connexion hors session, mot de passe oublié | C01–C03 et annexe Client. |
| `/password`, activation et récupération | C02–C03 ; lien expiré et changement volontaire ; cibles tactiles détaillées dans l’annexe Administration. |
| `/` côté équipe, alias `/travail` | E02–E04 ; tâches, attente, relais, préférences et permissions restreintes. |
| `/colis` côté équipe | E05–E09 ; liste, cartes, regroupements, filtre, recherche et aperçu. |
| `/colis/:id` côté équipe | O01–O21 ; huit tâches du dossier, tiroir partagé, messages, factures et corrections. |
| Réception depuis le menu ou le dossier | O02–O05 ; nouveau dossier et carton rattaché ; création client intégrée lue dans `ColisModal`, formulaire client dédié observé en A05. |
| `/conversations` | E10–E12 ; échanges, gestion, brouillon et messages sans dossier. |
| `/equipe` | E13–E14 ; charge, attribution, relais et rôle limité. |
| `/departs` | E15–E16 ; planification, chargement, blocages, report et accès aux documents. |
| `/clients`, `/clients/new`, `/clients/:id` | A01–A12 ; liste, création, import, édition, abonnement, pro, export, partage et suppression. |
| `/devis` | A13–A14 ; estimation, particulier/pro et partage. |
| `/settings` | A15–A24 ; huit rubriques actuelles, création utilisateur, droits et états de sauvegarde. |
| `/plus` côté équipe | E01 ; accès secondaires et manque d’accès évident à la sécurité du compte. |
| `/` côté client et présentation initiale | C04–C05 ; nouvel utilisateur, dossiers actifs et état vide. |
| `/colis`, `/colis/:id` côté client | C06–C17 ; listes, archives, accord, documents, conversation, paiement et livraison. |
| `/notifications`, `/profil` | C11–C13 et C18–C20 ; messages ciblés, documents, données de contact, accès et Telegram. |
| `/suivi/:token` | C21–C22 ; visite anonyme, erreurs et accès en lecture seule. |
| Route inconnue et écrans d’erreur communs | Code de redirection et composants de repli examinés, sans prétendre avoir provoqué toute erreur possible. |

Il n’existe pas de rubrique Destinations ou Santé des canaux dédiée dans le parcours actuel. Le composant de statistiques ancien ne constitue pas un écran accessible constaté. Ces absences sont signalées comme décisions produit à prendre, pas comme écrans visités.

## 9. Organisation cible du travail

### Un même dossier, des tâches indépendantes quand c’est possible

| Moment | Ce que voit la personne de l’équipe | Ce que voit le client | Condition pour la suite |
| --- | --- | --- | --- |
| Réception | Client, expédition, carton numéroté, casier et quatre mesures. | Réception confirmée lorsque le responsable décide de l’informer. | Réception enregistrée ; aucune copie des mesures vers la préparation. |
| Accord | Dernière demande, réponse reçue, action de contact utile. | Donner mon accord / Attendre d’autres cartons ; factures des articles demandées clairement. | Accord explicite sur les cartons concernés avant préparation. |
| Préparation et factures | Deux tâches parallèles, chacune avec sa personne responsable et son résultat. | Équipe au travail ; seule la pièce manquante ou correction utile demande une action. | Mesures finales enregistrées et documents nécessaires vérifiés avant devis. |
| Devis | Total, blocages éventuels, vérifier puis envoyer la version courante. | Montant, modalités, document et action appropriée. | Envoi explicite de la bonne version. |
| Paiement | Attendu / Reçu, moyen et preuve appropriés. | Payer ou suivre les instructions convenues ; confirmation de réception. | Règlement confirmé selon les règles métier. |
| Départ | Colis préparés, affectation, contrôle physique du chargement. | Date/suivi confirmés ; information préparée manuellement par l’équipe. | Chargement et départ réellement confirmés. |
| Livraison | Prochaine action logistique exacte, résultat daté. | Où en est la livraison, modalités connues, rien à faire le cas échéant. | Confirmation réelle de livraison, puis consultation simple de l’historique. |

La navigation doit rester libre entre les écrans autorisés. **Consulter l’étape suivante ne signifie pas effectuer la prochaine action métier.** La personne qui a fini de mesurer doit pouvoir retourner à son travail pendant qu’une autre termine les factures. L’interface ne doit pas forcer une séquence artificielle entre ces deux métiers.

### Gabarit d’écran proposé

1. **Repère court :** nom du client, EXP, tâche consultée et état utile du dossier.
2. **Une phrase d’objectif :** « Mesurez chaque colis après préparation » ou « Vérifiez cette facture ».
3. **Zone de travail :** uniquement les informations nécessaires à cette tâche ; erreur au champ concerné.
4. **Une action principale :** verbe + objet, puis retour enregistré/échec visible.
5. **Détails du dossier :** documents, cartons, échanges et historique à la demande ; accès direct en présence d’une alerte.
6. **Navigation :** Précédent / liste / Suivant conservés, et sortie distincte vers la prochaine tâche de sa file.

Un écran « simple » n’est pas un écran vide : le total, le destinataire, les unités, un conflit de modification ou une interdiction restent visibles lorsqu’ils conditionnent la décision. Seuls les détails qui n’aident pas l’action courante sont repliés.

## 10. Plan de mise en œuvre proposé — à autoriser séparément

| Lot | Travail proposé | Pourquoi cet ordre | Fin du lot mesurable |
| --- | --- | --- | --- |
| 1 — Confiance et continuité | Brouillons équipe/client/modèles ; correction de facture ciblée ; états de documents cohérents ; suivi sortant ; confirmation de retour de statut ; annulation/suppression client ; écritures partielles/taux ; export pro ; droits délégués. | Une interface plus jolie qui perd une réponse ou affiche une donnée contradictoire reste difficile à adopter. | Tous les cas P1 fonctionnels reproduits dans ce rapport ont une recette qui passe, incluant les refus serveur et droits isolés. |
| 2 — Journée de travail | Mon travail, Conversations, aperçu, vocabulaire, actions principales, carte mobile et navigation cohérente. | Réduit les recherches, retours et interprétations répétées pour une équipe de 3–5 personnes. | Une tâche entière au premier écran mobile ; action annoncée = destination ; brouillon conservé sur tous les allers-retours requis. |
| 3 — Réception, préparation et factures | Formulaires plus courts, mesures prioritaires, récapitulatifs cohérents, exceptions de facture regroupées, passage de relais explicite. | Cible les opérations fréquentes et la préparation du devis sans fusionner les métiers. | Un nouveau collaborateur réalise la tâche guidée sans aller sur un écran sans rapport ; données avant/après distinctes. |
| 4 — Autonomie client | Première connexion, récupération, archives, correction/document, notification ciblée, paiement, aide et suivi public. | Diminue les demandes d’explication et accélère les retours attendus. | Le client retrouve son dossier, transmet la bonne pièce et répond sans intervention de l’équipe. |
| 5 — Administration et confort | Création client courte, import, paramètres organisés, profils de droits, statistiques si retenues, cohérence des exports et accessibilité restante. | Simplifie les fonctions moins fréquentes mais sensibles. | Enregistrer/Annuler uniformes, modèle mobile lisible, matrice de droits vérifiée, recette d’accessibilité complète. |

Les critères prioritaires d’un lot peuvent dépendre d’un composant d’un autre lot : par exemple la validation de création client ou les modèles mobiles illisibles doivent être remontés dans le lot 1 si utilisés quotidiennement. Ce découpage n’est ni un devis de développement ni un calendrier promis.

### Protéger ce qui fonctionne déjà

- Une référence EXP commune aux cartons rattachés ; pas de numérotation recommençant à 1.
- Mesures à réception distinctes des mesures après optimisation.
- Préparation et factures indépendantes ; devis conditionné par les prérequis réels.
- Documents retirés/remplacés conservés dans l’historique, exclus des calculs lorsqu’ils doivent l’être.
- Permissions et contrôle des modifications concurrentes appliqués côté serveur.
- Confirmation du client, paiement, départ et livraison jamais inférés d’une navigation.
- Aperçu et envoi manuel des notifications ; pas d’ajout de WhatsApp ni de relances automatiques dans ces propositions.
- Recherche transversale et visibilité partagée du dossier entre collègues autorisés.

## 11. Vérifier que l’application devient réellement facile

Le code et les captures permettent de repérer des problèmes ; seuls des essais d’usage permettent de confirmer que les propositions réduisent l’effort. Organiser deux courtes vagues de tests, puis corriger ce qui fait encore hésiter, avant de généraliser.

### Participants et protocole

- Toute l’équipe de 3–5 personnes, avec rôles différents ; si possible une personne découvrant la réception.
- Un petit groupe de clients peu habitués au numérique et un groupe plus à l’aise, avec âges et appareils variés. Une première vague de 5–8 clients permet de dégrossir les principaux obstacles ; elle ne constitue pas une preuve statistique d’adoption.
- Dossiers fictifs, consignes courtes, aucune explication de l’interface pendant la première tentative. Observer les hésitations et les erreurs avant de commenter.
- Refaire les tâches après une pause ou le lendemain : une interface facile se retrouve sans réapprendre les écrans.

| Mission d’essai | Réussite attendue |
| --- | --- |
| Trouver l’EXP créée par un collègue puis revenir à sa liste | Bon dossier et filtres conservés, sans demander quel écran ouvrir. |
| Ajouter le troisième carton à une expédition | Même EXP, numéro 3, bonnes mesures et bon casier ; aucun message involontaire. |
| Mesurer après préparation pendant qu’un collègue vérifie les factures | Travail indépendant, confirmation sauvegardée et relais compréhensible. |
| Vérifier deux factures dont une copie | Comprendre laquelle est active, retirer la copie sans l’effacer définitivement, total non doublé. |
| Commencer une réponse puis consulter une facture | Brouillon retrouvé, pas d’envoi accidentel. |
| Corriger une facture depuis une notification client | Bonne facture ciblée, motif compris, résultat de dépôt clair. |
| Retrouver une expédition ancienne | Une recherche exacte aboutit sans connaître la notion technique d’archives chargées. |
| Comprendre le total et régler selon la modalité prévue | Bon montant, bonne version, confirmation distincte de l’ouverture du paiement. |
| Comprendre pourquoi un dossier ne peut pas partir | Cause précise, personne ou action pour débloquer, aucune transition interdite. |
| Modifier un tarif puis annuler / rencontrer une panne | État enregistré identifiable, aucune écriture partielle silencieuse. |
| Consulter un suivi partagé en tant que proche | Comprendre la progression sans se croire responsable d’une action privée. |

### Mesures proposées

Définir la situation de départ avant de fixer un engagement. Les cibles suivantes sont des **objectifs de recette**, pas des performances actuellement mesurées :

- Au moins **90 % des tâches principales réussies sans assistance** lors de la vague de validation ; analyser séparément novices, habitués et appareils.
- **Aucune perte de brouillon** sur les allers-retours prévus, aucun envoi ou changement de statut involontaire.
- En quelques secondes, la personne sait dire ce qu’elle doit faire, sur quel dossier et comment reconnaître la réussite.
- Suivre le temps actif de traitement d’un dossier, le nombre de changements d’écran, les tentatives d’enregistrement répétées et les demandes d’aide.
- Côté client : délai entre demande et réponse complète, proportion de dépôts corrigés correctement, contacts nécessaires pour obtenir toutes les factures.
- Côté équipe : temps pour obtenir un devis prêt à envoyer une fois les prérequis réunis ; distinguer temps de manipulation et attente du client.
- Ne pas promettre de gain chiffré avant mesure. Les erreurs techniques et besoins d’aide sont utiles à suivre ; le contenu privé des messages n’a pas à être collecté pour mesurer l’adoption.

## 12. Dossier de preuves et lecture conseillée

Le rapport contient **85 entrées d’audit par écran, vue ou état** : 21 opérationnelles, 16 pour l’organisation d’équipe, 22 côté client/accès et 26 pour l’administration. Ce ne sont pas 85 routes distinctes ni 85 bugs : plusieurs entrées décrivent un état ou une simplification d’un même écran.

**190 captures** ont été conservées, avec textes/relevés de scénarios et un export Excel exclusivement fictif. Les captures initiales de chargement ne sont pas utilisées pour prétendre qu’un PDF ne fonctionne pas ; le lecteur a aussi été observé après rendu complet.

- [Annexe Équipe : constats et reproductions](audit-simplification-2026-09-17/annexe-equipe.md).
- [Annexe Client et accès : constats et reproductions](audit-simplification-2026-09-17/annexe-client.md).
- [Annexe Administration : constats et reproductions](audit-simplification-2026-09-17/annexe-admin.md).
- [Index des captures et preuves](audit-simplification-2026-09-17/index-preuves.html).

Pour une décision rapide, lire le diagnostic, la synthèse des priorités et le plan de mise en œuvre. Pour préparer le travail, utiliser les entrées O/E/C/A et leurs critères. Pour vérifier un constat, ouvrir l’annexe et la capture correspondantes.

**Statut à la livraison de ce rapport : toutes les recommandations restent proposées. Aucun point de ce rapport n’a été implémenté pendant l’audit.**
