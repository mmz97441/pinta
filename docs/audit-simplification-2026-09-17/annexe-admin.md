# Audit UX/UI — gestion de l’équipe hors opérations

Date : 17 septembre 2026. **Rapport uniquement : aucun correctif, commit, déploiement, accès à des données de production ou envoi client.**

## Méthode et limites

- Lecture de la cartographie `pinta/src/expedile/App.jsx` et des composants concernés.
- Visite réelle de l’interface locale sur `http://127.0.0.1:4175`, avec Chromium et les fixtures de `tests/browser-regression.cjs`. Toutes les API fournisseur sont interceptées ; les requêtes non prévues sont bloquées. Aucune requête métier réelle.
- 30 vues de base contrôlées à 1440 × 1000 et 390 × 844, puis captures supplémentaires d’import, formulaires, erreurs simulées, permissions et export. Captures, textes, scripts de reproduction et relevés dans `captures-admin/`.
- Tests axe sur les 30 vues de base : aucune erreur JavaScript, aucun `networkDenied`. Des défauts de nom accessible, de contraste et de taille de cible ont néanmoins été détectés. L’absence de défilement horizontal global ne garantit pas la lisibilité : les modèles mobiles se superposent à l’intérieur de leur conteneur.
- Les essais d’enregistrement et suppression ci-dessous observent **le comportement frontend et les requêtes émises vers les mocks**. Ils ne prouvent pas que le serveur production accepterait un email invalide ou une suppression. Les erreurs réseau sont injectées intentionnellement.
- Pas de test de charge à 1 000 clients, de validation juridique/fiscale, de véritable invitation, d’envoi email/Telegram, de paiement ou de création de compte. Mode clair contrôlé dans cette mission ; pas de conclusion globale sur le mode sombre.
- Priorités : **P1** = action ambiguë, risque de perte de saisie ou résultat métier incohérent ; **P2** = friction notable et apprentissage évitable ; **P3** = finition. Aucun incident P0 établi dans ce périmètre.

## Les décisions UX à prendre en premier

1. Rendre l’enregistrement cohérent : brouillon visible, un bouton Enregistrer, confirmation persistante, Annuler qui restaure réellement. Appliquer aussi cette règle aux catégories et modèles.
2. Réparer les sélecteurs mobiles des modèles et du type de client : leurs textes doivent rester intégralement lisibles.
3. Simplifier la création client en identité, destination et moyen de contact ; proposer abonnement et informations complémentaires ensuite.
4. Aligner les récapitulatifs/export avec les sources métier du dossier : factures actives, colis finaux et modalité de règlement unique.
5. Faire dépendre chaque rubrique de son droit effectif, puis présenter aux administrateurs des profils de tâches compréhensibles avant les 53 cases détaillées.

## Constats P1 prouvés et protocoles

### A01 — Tarifs : un échec global peut cacher un enregistrement partiel

**Preuve navigateur + code.** Dans les fixtures, renseigner 40 € pour Guadeloupe puis −1 € pour Martinique, puis « Enregistrer les tarifs ». Une requête PATCH contenant `{base:40, par_kg:5}` part pour Guadeloupe avant le rejet de la seconde valeur. La fixture Guadeloupe passe de 25 à 40 ; Martinique reste à 25. L’erreur présentée ne dit pas que la première destination a déjà changé.

**Cause :** validation et sauvegarde s’enchaînent dans la même boucle, destination par destination. Source : `pinta/src/expedile/components/staff/StaffSettings.jsx:170`. Preuves : `rates-partial-save.png` et `interactions.json`.

**Recommandation :** valider tout le formulaire avant toute écriture ; enregistrer le jeu de tarifs de manière atomique, ou annoncer précisément les destinations effectivement enregistrées et celles à reprendre. Montrer les changements et leur effet sur les futurs devis avant confirmation.

**Recette :** avec une valeur invalide, zéro requête d’écriture ; avec une panne à la deuxième destination, aucune mise à jour partielle silencieuse ; confirmation détaillée après succès. Cela reste une preuve d’orchestration frontend dans les mocks, pas une modification de tarifs réels.

### A02 — Catégories : l’auto-enregistrement laisse une valeur non sauvegardée à l’écran

**Preuve navigateur avec erreur injectée.** Taux OM Réunion enregistré dans la fixture : 10 %. Saisir 17 puis sortir du champ ; la réponse POST est remplacée par une erreur 503. Un toast signale l’échec, mais le champ reste à 17 ; la valeur enregistrée reste 10. Il n’existe pas de statut durable par champ ni de bouton pour reprendre cette sauvegarde. Les noms, codes douaniers et taux sont enregistrés au blur, alors que Tarifs et Règles métier utilisent un bouton.

Source : `StaffSettings.jsx:206`, `:233`, `:259`, garde globale `run` à `:65`. Preuves : `category-failed-save.png`, entrée `destination:974` de `interactions.json` ; reproduction précise dans `category-recheck.cjs`.

**Recommandation :** une catégorie en brouillon avec Enregistrer/Annuler et retour de sauvegarde ; conserver explicitement le brouillon en erreur. Éviter qu’une autre saisie soit simplement ignorée pendant `busy`.

**Recette :** échec visible au niveau de la catégorie jusqu’à résolution ; aucune valeur ne semble enregistrée alors qu’elle ne l’est pas ; saisie rapide OM puis OMR conservée intégralement ; rechargement ne provoque pas de surprise.

### A03 — Messages : navigation mobile illisible et brouillon perdu en changeant de rubrique

**Preuve visuelle.** À 390 px, les 13 boutons des modèles rétrécissent à environ 24–27 px de largeur ; « Réception », « Facture manquante », « Demande feu vert » et les autres textes se superposent. Le contrôle global d’overflow ne détecte pas ce défaut.

**Preuve d’interaction.** Saisir `BROUILLON NON SAUVEGARDE`, ouvrir la rubrique Telegram, revenir à Messages : le texte initial remplace le brouillon sans avertissement. Le composant est démonté et son état n’est pas conservé. L’« Historique » est également un état local de session, pas un historique persistant.

Sources : `TemplateEditor.jsx:98`, `:100`, `:103`, `:157`, `:159`, `:165`, `:199`, `StaffSettings.jsx:303`. Preuves : `settings-templates-mobile.png`, `template-overlap-mobile.png`, `template-tab-loses-draft.png`, `interactions.json`.

**Recommandation :** un sélecteur « Message à modifier » sur mobile, une liste lisible sur ordinateur ; aperçu client à côté ou à la demande ; état « Modifications non enregistrées », sauvegarde explicite, protection d’abandon. Nommer l’historique « Versions de cette session » tant qu’il n’est pas durable. Retirer ou regrouper les anciens modèles de réception/accord devenus ambigus depuis le message fusionné.

**Recette :** chaque modèle sélectionnable au toucher avec son libellé complet ; changement de rubrique protège le brouillon ; rechargement/historique ne fait aucune promesse de restauration fausse ; textarea possède un nom accessible.

### A04 — Fiche client : « Annuler » ne supprime pas les changements

**Preuve navigateur.** Coordonnées → changer le nom en « Brouillon annulé » → Annuler → Coordonnées : le nom modifié est toujours présent, alors qu’aucune requête PATCH n’est partie. Un enregistrement ultérieur peut donc appliquer des modifications que l’opérateur pensait avoir abandonnées.

Source : `StaffClientDetail.jsx:193`, `:595`. Preuve : `client-cancel-keeps-draft.png`, `interactions.json`.

**Recommandation :** Annuler restaure les valeurs enregistrées, avec confirmation si nécessaire ; si l’intention est de conserver un brouillon, nommer l’action « Revenir à la synthèse » et afficher cet état.

**Recette :** modifier puis Annuler puis rouvrir affiche la version enregistrée ; aucune modification d’une autre section cachée ne part par accident.

### A05 — Création client : exigences affichées et validation ne correspondent pas

**Preuve navigateur dans les mocks.** Nom et CP 97400 remplis, téléphone vide, email `ceci-n-est-pas-un-email` : « Créer le client » émet un POST `/clients` avec cet email et `tel:null`. Le frontend affiche ensuite la réponse de succès du mock. Cela prouve l’absence de validation frontend cohérente, **pas l’acceptation de ces données en production**.

L’email et le téléphone portent tous deux un astérisque, mais le contrôle exige « email OU Telegram », sans contrôler le format de l’email. Le formulaire commence par l’abonnement et propose 18 champs visibles pour un particulier. Sur mobile, le choix Particulier/Professionnel est coupé. Axe relève des champs/selects sans nom accessible ; les libellés visibles ne sont pas reliés aux contrôles.

Sources : `StaffClientDetail.jsx:772`, `:875`, `:961`, `:981`, `:1037` ; sérialisation sans validation supplémentaire `lib/supabaseData.js:866`. Preuves : `client-create-mobile.png`, `client-create-invalid-email.png`, `evidence.json`, `interactions.json`.

**Recommandation :** première étape Nom/Prénom, destination et au moins un contact ; label explicite « Email ou Telegram requis » ; valider avant requête, erreur au champ et focus sur le premier blocage ; abonnement, naissance, téléphone fixe et notes en informations facultatives. Une seule action principale, état Création en cours lisible.

**Recette :** adresse invalide = zéro requête ; requis visibles identiques aux règles ; champs accessibles par leur label ; à 390 px les deux types sont lisibles ; retour vers un formulaire rempli ne perd pas la saisie sans avertissement.

### A06 — Suppression client sans confirmation

**Preuve navigateur dans les mocks.** Sur une fiche sans dossier, « Supprimer ce client » émet immédiatement DELETE `/clients`, sans dialogue de confirmation. La requête a été capturée uniquement dans la fixture ; aucun client réel supprimé.

Source : `StaffClientDetail.jsx:284`, `:738` et `AppContext.jsx:767`. Preuves : `client-deletion-no-confirm.png`, `interactions.json` (`dialogs:[]`, `deleteRequests:1`).

**Recommandation :** zone de danger distincte ; confirmation nommant le client et l’effet sur son accès, ou archivage réversible lorsque pertinent. Garder le blocage serveur des clients possédant un historique.

**Recette :** premier clic = confirmation, Annuler = zéro DELETE, confirmation explicite = une seule requête, échec = fiche conservée avec explication et possibilité de réessayer.

### A07 — Fiche pro et export : informations incompatibles avec le dossier

**Preuve export généré réellement par le navigateur à partir de fixtures.** Un dossier contient une facture active de 100 €, une copie classée en doublon portant une ligne de 14,30 €, 40 € de transport et deux colis finaux de 3 et 4 kg. L’Excel « Coût de revient » exporte la ligne `ARTICLE DOUBLON EXCLU DU DEVIS` et lui attribue 5 € de transport ; le poids facturable du récapitulatif reste à 3 kg, repris du champ historique. Le récapitulatif doit réutiliser les montants et sources retenus par le devis, pas recomposer à partir de toutes les lignes historiques.

Autre incohérence reproduite : le mode de règlement `mode_paiement:'30j'` de la création est présenté comme « Fin de mois » et exporté `fin_de_mois`, car cette vue lit `methodePaiement`. Le résumé Excel du client affiche aussi « Exemple Camille Camille » : `nom` contient déjà le prénom puis celui-ci est ajouté de nouveau.

Sources : `utils/exportRecapPro.js:29`, `:60`, `:99`, `StaffClientDetail.jsx:655`, `lib/supabaseData.js:113`, `:129`, `:138`. Preuves : `export-recap-pro-fictif.xlsx`, `secondary.json`, `client-pro-billing.png`, `export-pro-billing.png`.

**Recommandation :** une source métier commune pour les factures actives, articles retenus, colis finaux, poids facturable et modalités pro ; export basé sur la version du devis pertinente. Dans l’écran, nommer « Récapitulatif mensuel » et expliquer la période (actuellement paiement, sinon réception), plutôt que suggérer une facture à émettre.

**Recette :** aucune copie/remplacement historique dans les lignes ou proratas ; poids conforme à la version de devis et aux colis finaux ; modalités identiques à la fiche ; prénom présent une seule fois ; total écran et Excel concordants. La fixture ne prouve pas qu’un export client réel était erroné.

### A08 — Permissions accordées mais rubriques invisibles

**Preuve navigateur.** Un préparateur doté de `perm_admin_parametres`, `perm_admin_utilisateurs`, `perm_finances_modifier_tarifs` et `perm_admin_templates` voit seulement Départs et Telegram dans Paramètres. Les onglets utilisent une condition Directeur/Vice-directeur au lieu de leurs droits métier. L’administrateur peut donc cocher un accès qui ne devient pas utilisable dans l’interface.

Sources : `StaffSettings.jsx:64`, `:105`, `:298`, route `App.jsx:364`. Preuves : `delegated-admin-missing-tabs.png`, `secondary.json` (`buttons:["Départs","Telegram"]`).

**Recommandation :** vérifier les permissions effectives rubrique par rubrique. Si un droit ne doit pas être déléguable, le dire et ne pas proposer une case qui donne cette impression. Ne pas ouvrir des droits d’écriture en même temps qu’un simple accès de consultation.

**Recette :** matrice pour chaque rôle et droit isolé : rubrique visible, action activée uniquement si autorisée, refus expliqué ; aucun privilège ajouté par le correctif de navigation.

## Couverture par écran et recommandations complémentaires

Chaque entrée ci-dessous donne un constat, sa conséquence, une recommandation et un critère de recette. Les constats P1 ci-dessus priment ; les autres priorités ne supposent aucun défaut serveur démontré.

| Écran / onglet | Constat factuel et difficulté | Recommandation et priorité | Critère de recette / preuve |
|---|---|---|---|
| Clients — liste | Recherche unique, modes Liste/Cartes, compteurs Total/Telegram/Pro. Tableau de 11 colonnes ; à 390 px téléphone, email et état Telegram sont hors du premier cadre. Les compteurs ne sont pas des filtres. | **P2** : carte mobile par défaut avec nom, contact utilisable et dossier actif ; filtres simples « À contacter », « Sans accès », Particulier/Pro ; conserver recherche/tri au retour de fiche. | Trouver un client et son contact sans balayage horizontal ; retour retrouve recherche/position. `clients-mobile.png`, `StaffClients.jsx:446`, `:470`, `:515`. Pas de benchmark des 1 000 lignes effectué. |
| Clients — cartes | Alternative existante, mais pas sélectionnée automatiquement sur mobile. | **P3** : adapter le mode initial à l’écran et conserver le choix de l’utilisateur. | Pas besoin de découvrir le bouton Cartes pour une consultation mobile confortable. `StaffClients.jsx:32`, `:605`. Mode cartes lu dans le code, non capturé séparément. |
| Import — sélection fichier | CSV/Excel, 18 exemples de colonnes, pas de modèle téléchargeable ni correction des associations. | **P2** : exemple CSV, explication de trois colonnes minimales, étape « Vérifier les colonnes » avec réaffectation des colonnes ignorées. | Une colonne non reconnue peut être associée sans modifier/recharger le fichier. `import-upload-desktop.png`, `StaffClients.jsx:175`, `:219`. |
| Import — aperçu / doublons | Aperçu des dix premières lignes seulement ; choix global Ignorer les doublons ; jargon « Mapping », tableau large. En mobile le haut de la boîte est partiellement masqué par l’en-tête de l’app. | **P2** : « Correspondance des colonnes », liste des erreurs téléchargeable, choix par doublon ; dialogue au-dessus du shell mobile, titre et fermeture visibles. | Contrôler une ligne au-delà de la dixième et corriger un cas isolé ; titre/fermeture visibles à 390 × 844. `import-preview-mobile.png`, `StaffClients.jsx:219`, `:308`. Aucun import réel exécuté. |
| Import — progression / fin | Boucle séquentielle ; pendant l’import « Annuler » reste affiché mais le handler ne fait rien. Fin avec pictogramme vert, même en présence d’erreurs ; pas de reprise des seules erreurs. | **P2** : distinguer progression non annulable ou arrêt après ligne courante ; bilan réussites/échecs, action reprendre/exporter les échecs. | Le libellé Annuler ne promet pas une action sans effet ; 1 échec/10 donne un bilan partiel explicite. Lecture `StaffClients.jsx:85`, `:126`, `:317`, `:335`, `:372` ; erreurs de fin non déclenchées. |
| Création client — particulier / pro | Voir A05. Informations commerciales avant l’identité ; champs pro à la création non repris dans l’édition standard (raison sociale, SIRET, interlocuteur). | **P1** validation/accessibilité ; **P2** ordre des informations et édition pro complète. | Création courte ; raison sociale et contact retrouvables/modifiables ensuite. `client-create-desktop.png`, `StaffClientDetail.jsx:910`, `:401`, `:515`. |
| Après création — invitations | Trois parcours proches : invitation espace client, liaison Telegram, lien « Inviter par email » ouvrant la messagerie et demandant de contacter l’équipe. | **P2** : une décision « Comment le client suivra son dossier ? », accès espace avec état, Telegram facultatif ; supprimer la fausse équivalence entre email de bienvenue et invitation d’accès. | L’opérateur sait si un accès a été créé/envoyé ou si un email est seulement préparé. `client-create-invalid-email.png` (réponse mock), `StaffClientDetail.jsx:799`. Aucun email envoyé. |
| Fiche — Synthèse | Contact, invitations, expéditions ouvertes et historique sont bien regroupés. Client inexistant redirigé silencieusement vers la liste. | **P3** : conserver l’organisation ; pour une référence périmée afficher « Client introuvable » et Retour à la liste. | Ouvrir un ancien lien explique l’absence ; pas de retour silencieux. `client-summary-desktop.png`, `StaffClientDetail.jsx:139`, `:373`. |
| Fiche — Coordonnées | Champs correctement labellisés et validation locale pendant la saisie, mais Annuler conserve le brouillon ; boutons d’invitation mélangés avec l’édition. | **P1** A04 ; **P2** séparer Modifier les coordonnées et Gérer les accès ; indicateur de modifications. | Sauvegarder ou annuler a un résultat unique et visible. `client-contact-desktop.png`, `client-cancel-keeps-draft.png`. |
| Fiche — Abonnement et administration | Abonnement, notes, liste de colis, facturation pro, partage et suppression réunis dans une longue section ; champs abonnement selon permissions mais bouton Enregistrer exige aussi modification client. | **P2** : sections courtes « Offre », « Facturation pro », « Accès et partage », danger séparé ; revoir les dépendances exactes de permissions. | Un droit d’abonnement ne conduit pas à un formulaire sans sauvegarde possible ; contrôle spécifique à vérifier en matrice. `client-admin-desktop.png`, `StaffClientDetail.jsx:515`, `:587`, `:655`. |
| Fiche pro — récapitulatif mensuel / Excel | Voir A07 ; choix mois/année sans label accessible, libellé générique Excel, période de rattachement implicite. | **P1** alignement des données ; **P2** « Exporter le récapitulatif de septembre — N dossiers » avec règle de période. | Même périmètre et mêmes montants entre écran et fichier, mois/année accessibles au clavier/lecteur d’écran. `export-pro-billing.png`, `StaffClientDetail.jsx:671`. |
| Fiche — lien de suivi partagé | Création, copie et révocation existent ; l’aide parle de famille et de suivi sans compte. Ce n’est pas l’accès privé client, mais la différence demande d’être comprise. | **P2** : nommer « Partager le suivi avec un proche » et préciser les informations visibles ; conserver confirmation de révocation. | Aperçu du contenu partagé avant création et révocation explicite. `client-pro-billing.png`, `ShareLinkPanel.jsx:58`, `:112`, `:172`. Création/révocation/envoi non exécutés. |
| Estimation — particulier | Calcul dynamique cohérent et bien séparé du devis final ; résultat sous les coordonnées sur mobile ; erreurs d’un formulaire encore vide affichées dès l’arrivée ; un seul carton et une seule catégorie. | **P2** : saisie progressive, résultat compact près des mesures, partage seulement après résultat ; expliciter « estimation d’un carton » ou ajout de plusieurs cartons ; proposer continuité vers création d’un dossier sans ressaisie. | Débutant obtient une estimation sans parcourir le bloc contact ; aucune confusion réception/optimisation ; limites un carton/une catégorie annoncées. `estimate-empty-mobile.png`, `estimate-filled-mobile.png`, `DevisProspect.jsx:13`, `:20`, `:40`. |
| Estimation — professionnel / partage | Même écran en mode pro ; Copier/PDF/Préparer l’email. Le succès d’envoi n’est pas prétendu : notice précise que l’email n’est pas suivi. Aucun historique d’estimation ni rattachement prospect. | **P2** : conserver cette honnêteté ; aperçu de partage puis action principale adaptée, option enregistrer/réutiliser si usage fréquent. **P3** format français des montants (73.38 € observé). | Copie/PDF/mail portent mêmes hypothèses et total ; retour n’efface pas une estimation utile sans prévenir. `DevisProspect.jsx:22`, `:25`, `:47`. Envoi mail non essayé. |
| Paramètres — navigation | Huit rubriques locales, ouverture systématique sur Départs ; aucune URL par onglet. Aller à une autre route/recharger revient au début. Départs est aussi un menu principal. | **P2** : « Organisation », « Tarifs et règles », « Communications », « Équipe et accès » ; lien partageable par rubrique, Retours et brouillons conservés. | Lien vers les catégories ouvre directement les catégories ; rechargement garde la rubrique ; aucune saisie perdue sans choix. `StaffSettings.jsx:28`, `:58`, `:109`. |
| Paramètres — Départs | Le même composant opérationnel est embarqué en premier dans Configuration partagée. | **P2** : un lien vers Départs, garder uniquement ses véritables réglages dans Paramètres. | Un novice distingue gérer un départ de configurer l’application. `settings-departures.png`, `StaffSettings.jsx:128`. Fonctions métier des départs hors mission. |
| Paramètres — Tarifs / destinations | Quatre destinations fixes, deux montants chacune, avertissement utile sur les anciens devis. Pas d’écran Destinations, d’état d’activation, d’aperçu de calcul ou de date d’effet. | **P1** A01 ; **P2** afficher les destinations prises en charge avec état et aperçu de l’effet d’un tarif. | Changement expliqué avant validation ; aucune destination vide oubliée ; valeurs invalides localisées. `settings-rates.png`, `constants/index.js:92`. Aucun audit de conformité fiscale. |
| Paramètres — Catégories et taxes | Carte par catégorie, tous taux de toutes destinations visibles ; OM/OMR abrégés, code douanier intitulé « vérifié » même vide. Auto-enregistrement non annoncé. | **P1** A02 ; **P2** recherche, statut À compléter/Vérifié, explication des taxes et édition par destination. | Identifier immédiatement catégories bloquant un devis ; validation seulement après informations nécessaires ; pas de promesse « vérifié » issue du seul libellé. `settings-categories.png`, `StaffSettings.jsx:193`. |
| Paramètres — Équipe et accès | Bouton Enregistrer et compteur d’écarts présents ; brouillons par utilisateur conservés, gestion de conflit/échec, directeur expliqué. Mais 53 cases affichées, toutes sections ouvertes par défaut ; pas de profils guidés. | **P2** : modèles Réception/Préparation/Documents/Administration, résumé des actions permises et détails repliés ; conserver l’enregistrement explicite existant. | Un responsable configure un profil usuel sans lire 53 cases ; chaque dérogation reste visible ; tests actuels de persistance/conflit conservés. `settings-permissions-preparer.png`, `StaffPermissions.jsx:41`, `:95`, `:182`. |
| Équipe — créer / supprimer un utilisateur | Création avec mot de passe initial à transmettre, quatre rôles ; suppression native confirmée. Pas de commande de suspension/réactivation ou changement de rôle dans la fiche examinée. | **P2** : invitation sécurisée et statut d’activation, expliquer les accès initiaux ; proposer suspendre avant supprimer avec transfert des tâches si nécessaire. | Une création ne nécessite pas de communiquer un secret dans un canal improvisé ; départ d’un collègue conserve historique et responsabilité explicites. `settings-user-create.png`, `StaffPermissions.jsx:126`, `:148`. Aucune création/suppression réelle ni fictive de staff déclenchée. |
| Paramètres — Telegram / canaux | Page d’explication statique, aucun statut du bot/dernière réception/erreur, pas de lien direct client ; mention « Messages clients » au lieu de l’actuel menu Conversations. Pas de rubrique email/configuration santé équivalente. | **P2** : « Canaux de communication » avec état et dernier événement, lien Conversations et aide de liaison ; distinguer accessible à l’équipe et réglages techniques. | Un responsable sait si un canal fonctionne ou où diagnostiquer un échec sans accéder au fournisseur. `settings-telegram.png`, `StaffSettings.jsx:405`. État réel des fournisseurs non contrôlé. |
| Paramètres — Messages | Voir A03. Éditeur commence sur ancien modèle Réception malgré message réception+accord désormais fusionné ; 32 variables techniques environ au même niveau. | **P1** mobile/perte de saisie ; **P2** scénarios métier actuels, variables pertinentes repliées, aperçu avant/après et statut du modèle. | Modifier le message fusionné en moins de trois choix ; impossible d’enregistrer une variable inconnue ; aperçu exact du scénario courant. `settings-templates.png`, `TemplateEditor.jsx:71`, `:127`, `:210`. |
| Paramètres — Règles métier | Sauvegarde explicite ; cinq champs texte, dont paramètres numériques et séquences « J+2, J+5 ». Erreurs numériques affichent le nom technique (ex. diviseurVolumetrique). Texte dit relances calculées sans indiquer ici qui décide/envoie. | **P2** : nombres avec unité/aide, éditeur de jours, exemple de prochaine échéance, rappeler proposition à l’opérateur et exceptions ; erreurs en français au champ. | Un réglage erroné indique le champ à corriger ; l’opérateur comprend si le client recevra automatiquement un message ou non. `settings-business-mobile.png`, `StaffSettings.jsx:76`, `:316`. Le moteur de relance n’a pas été réaudité ici. |
| Paramètres — Produits interdits | Liste + Ajouter + suppression confirmée, sans classement ni recherche ni distinction restriction/interdiction. | **P3** : recherche et motifs/conditions si le référentiel grandit ; texte clair sur l’effet d’une modification pour l’équipe/client. | Un produit se retrouve rapidement ; retrait confirmé avec son nom ; aucune croyance qu’une saisie constitue une vérification réglementaire. `settings-forbidden.png`, `StaffSettings.jsx:354`. |
| Statistiques / KPI | `KPIDashboard` existe, monté dans `StaffDashboard` ancien ; aucun montage de ce dernier trouvé dans les routes actives. Import seul dans StaffSplitView, pas de rendu. Pas de route statistiques repérée. | **P2** : décider explicitement si la direction doit disposer d’un écran « Pilotage » ; si oui accès visible, période et définitions des chiffres, pas de retour à un gros tableau sur l’accueil opérationnel. | La direction trouve ses indicateurs sans URL cachée ; un nombre affiche période et périmètre. `App.jsx:328`, `StaffDashboard.jsx:754`, `StaffSplitView.jsx:16`. **Analyse de code, aucun écran KPI actuel accessible à capturer.** |
| Export dossiers depuis liste | Bouton « Export » non descriptif ; export des lignes visibles et autre action de sélection. Pas de période/colonnes dans le premier bouton. | **P2** : « Exporter N dossiers filtrés » et aperçu du périmètre/colonnes ; distinguer export de sélection. | Filtres et quantité du fichier correspondent à ce qu’annonce le bouton ; export en erreur produit un retour explicite. `StaffSplitView.jsx:650`, `:805`. Export général lu dans le code, pas téléchargé ici ; export pro testé séparément. |
| /plus — Votre espace | Hub mobile lisible pour Conversations, Équipe, Départs, Estimation, Paramètres ; aucune entrée changement de mot de passe. | **P2** : Compte et sécurité accessible dans ce hub ou profil. | Un opérateur mobile atteint Changer le mot de passe sans saisir `/password`. `more-mobile.png`, `App.jsx:202`, `:290`, `:333`. |
| /password — mot de passe | Écran dédié fonctionnellement accessible en URL, exigences affichées, boutons afficher/masquer de 18 px environ ; axe signale deux cibles trop petites sur desktop. | **P3** : cible tactile 44 px sans changer l’icône ; retour contextualisé et message clair après succès. | Accessible par menu mobile ; lecteur d’écran et tactile utilisables ; pas de test de changement réel du mot de passe. `password-desktop.png`, `ForceChangePassword.jsx:88`, `evidence.json`. |

## Cartographie : écrans souvent oubliés

- `/clients/new` a son propre formulaire et son propre écran de succès ; ne pas le considérer couvert par l’édition de fiche.
- Import possède quatre états : fichier, aperçu, progression, terminé. Les deux derniers ont été lus dans le code, pas exécutés avec un lot importé.
- Fiche pro : facturation mensuelle et trois feuilles Excel ; lien de suivi partagé et sa révocation ; distinction invitation au portail / liaison Telegram / mail de bienvenue.
- `/settings` ne reflète pas ses huit rubriques dans l’URL. Absence d’écran séparé Destinations, Email ou Santé des canaux. Ce sont des manques de navigation/visibilité, pas des routes existantes oubliées.
- `/password` est pris en charge avant les Routes (App.jsx:156), donc ne ressort pas d’une simple recherche `<Route path>`.
- `/plus` est un vrai écran mobile ; `/travail` est seulement un alias redirigé vers `/`.
- `/suivi/:token` existe en public, mais son parcours destinataire relève de l’audit client, pas de ce rapport ; seule sa gestion depuis la fiche est couverte ici.
- `/equipe`, `/conversations`, `/departs` et tâches dossier relèvent de l’audit opérationnel des autres agents. Ici, seuls l’embarquement Départs dans Paramètres et les accès vers ces pages ont été examinés.
- `StaffDashboard`/`KPIDashboard` semblent hors parcours actif : à confirmer comme choix produit ou fonctionnalité à réexposer ; ne pas leur attribuer une couverture visuelle de l’app actuelle.

## Preuves et suites de recette

- `captures-admin/evidence.json` : 30 écrans, URL, contrôles, cibles, violations axe ; `errors:[]`, `networkDenied:[]`.
- `captures-admin/interactions.json` : imports inspectés, abandon de brouillon, requêtes invalides/suppression interceptées, tarifs partiels, taux en erreur, modèles. L’entrée provisoire de rôles en chargement est remplacée comme preuve par `secondary.json`.
- `captures-admin/secondary.json` : permissions déléguées réellement chargées et contenu du fichier pro. Les requêtes figurant dans ce relevé sont toutes prises en charge par les mocks, y compris les RPC de rafraîchissement automatique.
- `captures-admin/export-recap-pro-fictif.xlsx` : fichier généré et relu, exclusivement fictif.
- Scripts de reproduction : `inspect.cjs`, `interactions.cjs`, `category-recheck.cjs`, `secondary.cjs`. Les erreurs de sélection rencontrées pendant la préparation du script ont été corrigées dans ces scripts temporaires ; aucun fichier de l’application changé.

**Ordre de recette recommandé après corrections futures :** 1) absence d’écriture partielle et abandon réel, 2) données des exports et modalités pro, 3) droits isolés, 4) formulaires débutants et erreurs, 5) mobile 390 px/clavier/labels, 6) profils usuels d’équipe, puis 7) volume réel de 1 000 clients sur données anonymisées. Ce rapport n’applique aucune de ces corrections.
