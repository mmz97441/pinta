# Audit UX — écrans de travail de l’équipe

17 septembre 2026. Rapport uniquement : aucune correction, publication ou notification réelle effectuée.

## Conclusion

La séparation entre Mon travail, Dossiers, Conversations et Départs est utile. Le principal problème restant est la quantité de décisions d’interface demandées avant l’action : comprendre plusieurs vocabulaires, choisir entre des boutons proches, retrouver le bon écran, puis recommencer une saisie après navigation. Sur mobile, les outils d’organisation occupent souvent presque tout le premier écran.

Les trois points à traiter en premier sont **la perte du brouillon de réponse**, **le bouton d’aperçu qui ne correspond pas à l’action annoncée**, et **l’absence d’accès au document avant de rattacher un message sans dossier**. Aucun P0 confirmé dans ce périmètre. P1 = gêne quotidienne importante, perte de saisie ou risque de mauvaise interprétation ; P2 = simplification et confort à planifier ensuite.

## Méthode et limites

- Lecture des composants, puis navigation réelle avec Chromium sur `http://127.0.0.1:4175`. Toutes les API métier et l’authentification sont simulées ; aucune donnée client réelle utilisée.
- Parcours direction : 3 membres fictifs, 8 dossiers, tâches attribuées/libres/en attente, relais, messages, facture à vérifier, départs passés et futurs. Parcours préparateur avec seuls droits de préparation, y compris des tâches anciennement attribuées désormais hors permissions.
- Ordinateur 1440 × 1000 et mobile 390 × 844 ; inspection ciblée du mode sombre mobile. État dense porté à 100 dossiers et recherche d’une référence précise. Ce contrôle ne mesure pas les performances de la production.
- 40 captures finales de pages ou états, disponibles dans `captures-equipe/`. Traces complémentaires : [observations](./captures-equipe/observations.json), [100 dossiers et rôle restreint](./captures-equipe/extra-observations.json).
- Aucune erreur console ou requête extérieure non simulée observée pendant les parcours terminés. Aucun appel d’envoi de message, de sauvegarde de devis, d’attribution de tâche ou de confirmation de départ déclenché par l’audit. La lecture des messages exerce le marquage comme lu sur les seules fixtures.
- Les difficultés de débutant sont une évaluation ergonomique, pas les résultats d’entretiens utilisateurs. Pas de test avec lecteur d’écran humain, clavier de téléphone réel, réseau lent, 1 000 comptes connectés, exports réels ou envoi Telegram. Les mesures manquantes de certaines fixtures ne sont pas présentées comme des anomalies de production.
- Périmètre : navigation équipe, Mon travail/préférences, listes et aperçu des dossiers, conversations, attribution, départs. La fiche opérationnelle réception → livraison est auditée séparément.

## 1. Navigation globale

**État observé.** Menu desktop lisible, rubrique active repérée, action Réceptionner explicite. Sur mobile, les quatre entrées sont Mon travail / Dossiers / Clients / Plus. Conversations, Équipe et Départs sont sous Plus. Les permissions retirent correctement les rubriques non accessibles du profil de préparation observé.

**NAV-1 — P1 : l’activité la plus coûteuse, les réponses clients, est cachée sur mobile.** L’utilisateur doit ouvrir Plus puis Conversations. Aucun nombre de conversations à répondre n’est présenté sur cette entrée de navigation. Il faut donc penser à aller vérifier, alors que les réponses client sont un point de friction central de l’équipe.

**Simplification.** Pour les personnes autorisées à répondre, proposer Mon travail / Dossiers / Conversations / Plus ; conserver Clients sous Plus. Afficher un compteur de demandes à répondre fondé sur leur état de traitement, pas uniquement sur le nombre de messages non lus. Ne pas faire apparaître Conversations chez un préparateur qui n’y a pas accès.

**Recette.** Depuis chaque écran mobile, une seule pression ouvre les conversations. Une demande lue mais non traitée reste comptée. Les personnes sans permission ne voient ni accès ni contenu. Éviter de changer les onglets au gré de la mission filtrée pendant une session.

Preuves : [navigation Plus mobile](./captures-equipe/18-navigation-plus-mobile.png), [préparateur restreint](./captures-equipe/25-preparateur-debutant-mobile.png). Code : [App.jsx:186](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/App.jsx#L186), [App.jsx:202](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/App.jsx#L202), [App.jsx:296](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/App.jsx#L296).

## 2. Mon travail

**État observé.** Les deux vues À faire / En attente sont compréhensibles ; les tâches en cours restent dans À faire. À prendre est distinct. La raison des urgences, les relais à accepter et les tâches hors permissions sont visibles. La recherche globale reste accessible indépendamment des missions : ces garanties sont à préserver.

**TRAV-1 — P1 : le premier écran mobile organise le travail sans montrer entièrement une tâche.** À 390 × 844, titre, disponibilité, Équipe, préférences, mission, recherche, recherche globale, onglets, relais, totaux et Traiter le suivant repoussent le premier titre de tâche vers 720 px. Les commandes de cette première tâche sont sous la navigation basse.

**Simplification.** En tête : titre, résumé de disponibilité discret, À faire / En attente, première tâche. Regrouper mission et recherche sous un bouton Filtrer avec filtres actifs résumés. Garder À prendre et relais accessibles par de courts liens chiffrés. Déplacer les préférences hors du flux quotidien. Ne pas masquer les urgences hors filtre.

**Recette.** À 390 × 844 et texte à 100 %, voir sans défilement une tâche entière : action, client, EXP, raison de priorité et commande principale. Un relais ou une urgence demeure détectable sans ouvrir les préférences. Vérifier aussi un écran avec aucune tâche.

**TRAV-2 — P1 : Commencer, Consulter, titre cliquable et Traiter le suivant semblent faire la même chose.** Commencer change l’état de l’action ; Consulter, le titre et Traiter le suivant ouvrent un écran sans la démarrer. Cette différence est saine au niveau métier mais peu expliquée. Une facture à vérifier se répète en gros bouton sur toutes les tâches du même dossier, y compris Préparer les cartons.

**Simplification.** Choisir une commande principale par contexte : Commencer cette tâche, Reprendre ou Prendre cette tâche. Garder Consulter sans prise en charge comme option secondaire explicite. Renommer Traiter le suivant en Ouvrir ma prochaine tâche si son effet reste une simple navigation. Garder l’indicateur documentaire compact sur les tâches qui n’y sont pas consacrées ; ne pas supprimer son accès utile.

**Recette.** Un débutant distingue l’ouverture du démarrage avant de cliquer. Consulter ne modifie jamais attribution/état ; Commencer a un retour visible. Un préparateur repère son action sans confondre le bouton facture avec un prérequis au mesurage autonome.

Preuves : [Mon travail desktop](./captures-equipe/01-mon-travail-desktop.png), [mobile](./captures-equipe/01-mon-travail-mobile.png), [À prendre mobile](./captures-equipe/03-a-prendre-mobile.png), [mode sombre](./captures-equipe/21-mon-travail-mobile-sombre.png). Code : [PersonalWorkView.jsx:29](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/PersonalWorkView.jsx#L29), [PersonalWorkView.jsx:48](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/PersonalWorkView.jsx#L48), [WorkActionRow.jsx:53](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/WorkActionRow.jsx#L53), [WorkActionRow.jsx:96](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/WorkActionRow.jsx#L96).

## 3. Préférences et disponibilité

**État observé.** Les préférences proposent uniquement les missions autorisées, un véritable bouton Enregistrer et Annuler. Les textes précisent que les missions organisent l’écran et qu’une absence ne transfère pas les tâches. Ces indications évitent une confusion permissions/préférences.

**PREF-1 — P2 : le formulaire déforme l’écran et mélange des choix de fréquence très différente.** Sur ordinateur, ouvrir les préférences étire le bouton Équipe sur toute la hauteur du formulaire, environ 500 px. Sur mobile, le formulaire remplace pratiquement toute la zone de travail. Disponibilité immédiate, missions habituelles, mission à l’ouverture et densité sont au même niveau.

**Simplification.** Un panneau dédié avec titre, fermeture et pied Enregistrer/Annuler stable. Première partie : Disponibilité et absence. Deuxième partie : Mes missions. Apparence et mission par défaut dans Personnaliser l’affichage replié. Équipe reste un bouton de hauteur normale. Le changement de disponibilité conserve les tâches déjà attribuées.

**Recette.** Aucun bouton voisin ne s’étire à l’ouverture. Le focus arrive dans le panneau et revient au déclencheur à la fermeture. À 390 px, Enregistrer et Annuler sont atteignables. La fermeture d’un formulaire modifié a un comportement clair ; le message de sauvegarde confirme les changements.

Preuves : [préférences desktop](./captures-equipe/02-preferences-desktop.png), [mobile](./captures-equipe/02-preferences-mobile.png), [missions d’un préparateur](./captures-equipe/26-preferences-permission-preparation-mobile.png). Code : [PersonalWorkView.jsx:32](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/PersonalWorkView.jsx#L32), [WorkPreferences.jsx:28](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/WorkPreferences.jsx#L28).

## 4. Dossiers : liste, filtres, regroupements et cartes

**État observé.** La liste desktop met en avant action/étape, client, EXP, cartons reçus, référent et date utile ; les autres colonnes sont facultatives. Les en-têtes restent fixés au défilement. Filtres avancés replie bien les options. Les états vides offrent de retirer les filtres. La recherche a trouvé EXP-VOLUME-099 parmi 100 dossiers fictifs. L’affichage de ces 100 dossiers correspond à 101 lignes DOM avec groupe et environ 7 054 px de tableau : aucun défaut de performance n’en est déduit.

**LIST-1 — P1 : les termes et axes de classement se superposent.** File de travail, Référent, Étape, Ordre de traitement, Par statut, Par envoi, Tri : Priorité et Date utile demandent d’apprendre plusieurs modèles. Par envoi désigne le départ groupé, alors que l’équipe parle aussi d’une expédition client. Les filtres conservent encore Att. feu vert / Feu vert OK quand la fiche parle d’accord client. La page générale n’a pas de titre visible Dossiers.

**Simplification.** Un titre Dossiers, recherche centrale, puis un contrôle Regrouper : Aucun / Étape / Départ. Utiliser Accord client partout. Remplacer File de travail par À traiter, avec options formulées comme des actions. Garder le tri dans un seul menu clairement distinct du regroupement. Employer Départ groupé pour ENV et Dossier d’expédition pour EXP. Expliquer Date utile par une date et son événement, sans généraliser toutes les dates en « étape actuelle ».

**Recette.** Avec 100 dossiers, retrouver une EXP, filtrer les factures à vérifier et retrouver le départ de vendredi sans devoir ouvrir trois menus concurrents. Le groupe Par départ affiche le même identifiant ENV que Départs. Les filtres actifs et leur remise à zéro restent visibles, et le retour depuis une tâche les conserve.

**LIST-2 — P1 : la carte mobile perd l’étape explicite et le nombre de cartons.** Elle affiche une pastille colorée, l’action suivante et le nom du référent, mais pas le badge de statut visible sur ordinateur ni le nombre de cartons. « Répondre au client » peut ainsi masquer visuellement le fait que le dossier est payé ou en préparation.

**Simplification.** Carte stable : client + EXP, action principale, badge d’étape textuel, cartons reçus + casier, référent en information secondaire. Les alertes s’ajoutent sans remplacer l’étape. Éviter de faire dépendre l’information de la couleur.

**Recette.** Identifier sur mobile le dossier payé, celui qui attend l’accord et le nombre de cartons sans ouvrir chacun. Même sens des étapes sur desktop et mobile ; cartes utilisables en nuances de gris.

**LIST-3 — P2 : conserver la lisibilité à 100 dossiers sans tout charger visuellement au même niveau.** Les groupes ne se replient pas ; la liste desktop est longue, et les cartes mobiles allongent encore le parcours. Ce n’est pas un diagnostic de lenteur.

**Simplification.** Permettre de replier les groupes et mémoriser ce choix ; afficher un total clair et un accès rapide à la recherche. Préserver le tri et le retour à la position consultée. N’ajouter pagination ou virtualisation que sur mesure de performance, pas automatiquement pour ce volume.

**Recette.** Après ouverture du 70e dossier et retour, conserver filtre, regroupement, position et sélection. Un filtre qui ne trouve rien explique comment repartir. Vérifier la sélection de groupe sans inclure des dossiers invisibles à l’utilisateur.

Preuves : [liste desktop](./captures-equipe/06-dossiers-desktop.png), [filtres](./captures-equipe/07-filtres-dossiers-desktop.png), [par statut](./captures-equipe/08-dossiers-par-statut-desktop.png), [par envoi](./captures-equipe/09-dossiers-par-envoi-desktop.png), [cartes mobiles](./captures-equipe/06-dossiers-mobile.png), [100 dossiers](./captures-equipe/23-dossiers-cent-desktop.png), [recherche](./captures-equipe/24-recherche-cent-desktop.png). Code : [StaffSplitView.jsx:35](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffSplitView.jsx#L35), [StaffSplitView.jsx:572](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffSplitView.jsx#L572), [StaffSplitView.jsx:660](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffSplitView.jsx#L660), [StaffSplitView.jsx:848](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffSplitView.jsx#L848).

## 5. Aperçu d’un dossier depuis la liste

**État observé.** L’aperçu est maintenant court : résumé, action, cartons reçus repliés. Précédent / Dossier suivant est explicitement une navigation entre dossiers. Sur mobile, il occupe tout l’écran.

**APER-1 — P1 : l’instruction et le bouton principal peuvent se contredire.** Dans la fixture avec message client à traiter et facture non vérifiée, le résumé dit Répondre au client, puis le bouton principal dit Vérifier les factures. Répondre nécessite de comprendre que la petite bulle en haut est l’accès conversation. Les deux libellés proviennent de `nextAction` et `resolveDossierTask`, calculés séparément.

**Simplification.** Une même source doit fournir libellé et destination de l’action principale. Si plusieurs tâches indépendantes sont nécessaires, proposer Répondre au client en principal et Vérifier 1 facture en secondaire, avec destinataire/responsable si utile. Ne pas changer l’action présentée silencieusement selon le composant.

**Recette.** Pour message + facture, message seul, facture seule et accord reçu, le bouton accomplit exactement l’action annoncée. La consultation ne prend pas la tâche et n’envoie rien. Un préparateur voit sa tâche autorisée même si les factures restent à traiter ailleurs.

**APER-2 — P2 : ouvrir le panneau réduit trop la table desktop.** À 1440 px, le panneau de 500 px compresse fortement Action / étape ; « Facture reçue · À vérifier » passe sur plusieurs lignes et les dernières colonnes sortent de la zone visible.

**Simplification.** En mode aperçu, passer volontairement la liste à trois informations : client/EXP, action, alerte. Offrir Ouvrir en pleine page. À largeur intermédiaire, utiliser une page d’aperçu avec retour explicite à la liste au lieu de comprimer six colonnes. Sur mobile, ajouter un libellé Retour aux dossiers à la fermeture actuellement représentée par X.

**Recette.** À 1280/1440 px avec aperçu ouvert, EXP, client et action restent lisibles sans défilement horizontal. En fermant, retrouver la ligne et la position initiales.

Preuves : [aperçu desktop](./captures-equipe/10-apercu-dossier-desktop.png), [aperçu mobile](./captures-equipe/10-apercu-dossier-mobile.png). Code : [StaffSplitView.jsx:958](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffSplitView.jsx#L958), [StaffSplitView.jsx:1032](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffSplitView.jsx#L1032).

## 6. Conversations et messages sans dossier

**État observé.** La liste distingue client, EXP et traitement ; lecture et clôture sont séparées. Le canal d’envoi est écrit près de la saisie. Sur mobile, basculer Voir le dossier / Revenir aux messages garde la conversation montée. Ces principes sont à conserver.

**MSG-1 — P1, confirmé : quitter la rubrique efface le brouillon sans avertissement.** Reproduction : taper une réponse, ouvrir Mon travail, puis Plus → Conversations et rouvrir EXP-TEST-001. Le champ est vide. Le brouillon vit dans `useState` de ChatPanel ; il survit au changement de dossier dans cette vue, mais pas au démontage du composant. Ce constat ne concerne pas la simple fermeture du contexte latéral.

**Simplification.** Conserver les brouillons par utilisateur et dossier au niveau de la session applicative, avec indicateur Brouillon et effacement explicite. Préserver aussi le contenu après erreur d’envoi ; supprimer seulement la version effectivement envoyée. Décider séparément si la conservation après fermeture du navigateur est nécessaire et comment elle est sécurisée.

**Recette.** Saisir sur A, consulter B, ouvrir une facture, revenir sur A : texte inchangé. Aucun envoi n’est déclenché par la navigation. Un autre compte ne retrouve jamais le brouillon précédent. Un échec d’envoi le conserve ; une réussite ne supprime pas une nouvelle saisie faite entre-temps.

**MSG-2 — P1 : l’espace conversation mobile est dominé par le pilotage.** Titre et compteurs, identité, Je m’en occupe / Consulter / Suivi, état de traitement, explication repliée et trois boutons consomment environ les 530 premiers pixels. Dans la conversation déjà ouverte, Consulter ramène à cette même conversation. Le champ de réponse n’a qu’une ligne ; Entrée déclenche l’envoi.

**Simplification.** Un en-tête compact client + EXP + responsable. Une action de prise en charge si nécessaire ; les autres options dans Gérer. Statut de traitement compact, sans répéter le bouton de l’état courant. Retirer Consulter lorsqu’on consulte déjà. Zone de réponse multiligne, bouton Envoyer avec canal, retour à la ligne sur Entrée et raccourci d’envoi explicite sur ordinateur. Après une réponse, laisser la personne choisir le suivi ; ne pas clore automatiquement.

**Recette.** Sur mobile, voir plusieurs messages et la réponse sans faire défiler les commandes de gestion. Composer un texte sur trois lignes sans l’envoyer. Le statut ne change qu’à la demande de l’agent. Clavier ouvert à tester sur appareil réel.

**MSG-3 — P1 : le message sans dossier demande de vérifier le contenu, mais ne donne pas accès à la pièce jointe.** L’écran restitue le texte et un menu Dossier du client. Avec une pièce jointe dans l’élément d’inbox simulé, il ne présente ni nom de fichier, ni aperçu, ni ouverture. Une facture peut ainsi être rattachée à partir de « Voici ma facture, merci » seulement.

**Simplification.** Afficher le document, son nom, sa date et un accès sécurisé à l’aperçu avant toute affectation. La sélection de dossier montre EXP, contenu, date de réception et cartons ; dossiers actifs d’abord, dossiers clos dans un groupe distinct. Montrer le dossier choisi dans une confirmation explicite, sans import/validation de facture automatique.

**Recette.** Un message ne contenant qu’un PDF reste identifiable avant rattachement. Une erreur d’ouverture ne conduit pas à un rattachement implicite. Une copie déjà rattachée l’indique. Choisir un dossier puis annuler ne modifie rien.

Preuves : [conversation desktop](./captures-equipe/12-conversation-desktop.png), [mobile](./captures-equipe/12-conversation-mobile.png), [brouillon avant](./captures-equipe/19-brouillon-avant-navigation.png), [après navigation](./captures-equipe/20-brouillon-apres-navigation.png), [message sans dossier](./captures-equipe/14-message-sans-dossier-desktop.png), [mode sombre](./captures-equipe/22-conversation-mobile-sombre.png). Code : [ChatPanel.jsx:114](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/detail/ChatPanel.jsx#L114), [ChatPanel.jsx:251](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/detail/ChatPanel.jsx#L251), [ChatPanel.jsx:264](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/detail/ChatPanel.jsx#L264), [ConversationsView.jsx:69](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/ConversationsView.jsx#L69).

## 7. Équipe, charge et attribution

**État observé.** Disponibilité, charge, actions en attente et relais sont réunis. Le relais conserve le propriétaire jusqu’à acceptation ; les candidats sont filtrés par disponibilité et droits. Les tâches restées attribuées après retrait d’une permission sont visibles comme exceptions.

**EQ-1 — P1 : la supervision mobile exige plusieurs écrans de défilement avant une action.** Avec seulement trois membres, les cartes et quatre filtres occupent toute la première hauteur de 844 px. Les actions utilisent ensuite la présentation verticale détaillée, même sur ordinateur : beaucoup d’espace par tâche, sans recherche client/EXP dédiée ni remise à zéro globale des filtres sur cet écran.

**Simplification.** Une ligne compacte par membre, puis une liste de tâches avec client/EXP, responsable, prochaine action et raison de blocage. Rendre les détails de charge dépliables. Ajouter une recherche client/EXP et un bouton Effacer les filtres quand nécessaire. Mettre en avant les files Sans responsable, Relais à accepter et Bloqués, sans multiplier de gros compteurs.

**Recette.** Avec cinq membres et 50 tâches, repérer la charge, une tâche sans responsable et un blocage depuis la première vue ; retrouver une EXP sans parcourir toutes les tâches. Retour d’une tâche conserve filtres et position.

**EQ-2 — P2 : référent, responsable d’action, relais et réaffectation demandent une explication au moment du choix.** Les lignes affichent « Action : vous » et « Référent : Alex ». Le menu Suivi peut proposer simultanément Passer le relais, Remettre à prendre et Réaffecter. L’explication précise du référent est surtout dans les formulaires et non dans la décision de l’utilisateur.

**Simplification.** Libeller Responsable de cette tâche et Référent du dossier. Dans Gérer la tâche : « Proposer un relais — le collègue doit accepter » et, pour la direction, « Réaffecter immédiatement ». La confirmation annonce personne cible, tâche concernée et effet sur le référent. Si aucun candidat n’est disponible/habilité, l’expliquer près du sélecteur.

**Recette.** Un débutant explique qui reste responsable après un relais proposé. Réaffecter une tâche ne prétend jamais modifier le référent. L’absence de candidat n’a pas l’apparence d’une liste cassée. Aucun changement de permission ne transforme une préférence de mission en droit d’accès.

Preuves : [Équipe desktop](./captures-equipe/04-equipe-desktop.png), [mobile](./captures-equipe/04-equipe-mobile.png), [réaffectation](./captures-equipe/05-reaffecter-desktop.png), [exceptions de permission](./captures-equipe/25-preparateur-debutant-mobile.png). Code : [TeamWorkView.jsx:29](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/TeamWorkView.jsx#L29), [TeamWorkView.jsx:35](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/TeamWorkView.jsx#L35), [WorkActionRow.jsx:60](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/workspace/WorkActionRow.jsx#L60), [StaffAssignment.jsx:1](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffAssignment.jsx#L1).

## 8. Départs et chargement

**État observé.** Planification, vérification du chargement, manifeste et exports sont réunis. La confirmation demande explicitement de cocher les expéditions embarquées ; dossiers non payés/non mesurés restent bloqués. Le report est décrit. Aucune confirmation ou export n’a été exécuté pendant l’audit.

**DEP-1 — P1 : prochaine opération et historique se mélangent.** La liste active est triée par date croissante : un ancien départ encore planifié et un départ déjà parti passent avant le prochain départ. Les statuts sont affichés bruts, par exemple planifie ; date ISO et longue date de clôture cohabitent. Les actions d’export et de confirmation ont un poids visuel proche.

**Simplification.** Sections À préparer / Partis / Archivés, prochain départ d’abord, ancien planning non traité signalé À reprogrammer. Afficher « Ven. 18 sept. — Réunion » puis la référence ENV en secondaire. Sur chaque ligne : Prêts / Bloqués / Colis physiques ; actions d’export dans Documents. Garder les confirmations métier distinctes et explicites.

**Recette.** Sur mobile, identifier le prochain chargement, son heure limite et les dossiers bloqués sans passer devant tous les départs partis. Un départ passé non confirmé reste visible comme anomalie de planning. Les manifestes déjà confirmés restent accessibles.

**DEP-2 — P1 : les raisons de blocage ne conduisent pas au correctif.** Un dossier non éligible affiche « Paiement et mesures finales confirmées requis avant embarquement », même si un seul de ces éléments manque. Sa référence est du texte, pas un accès à la tâche nécessaire. Au chargement, il faut quitter ce contexte pour rechercher quoi corriger.

**Simplification.** Deux groupes : Prêts à charger et À débloquer, avec raison précise « Paiement manquant » ou « Mesures à actualiser » et bouton vers la tâche autorisée. Ajouter recherche/scan EXP et compteur colis physiques sélectionnés pour les chargements plus longs. Montrer le motif de report comme requis seulement quand des dossiers restent non cochés ; conserver une confirmation manuelle des expéditions effectivement chargées.

**Recette.** À 30 dossiers dont trois bloqués, retrouver une EXP et comprendre chaque blocage sans ouvrir 30 fiches. Un dossier bloqué ne peut pas être embarqué. Le retour du paiement ou de la préparation restitue le chargement et sa sélection, après vérification des données courantes. La confirmation énonce dossiers embarqués et reportés avant tout changement effectif.

Preuves : [Départs desktop](./captures-equipe/15-departs-desktop.png), [mobile](./captures-equipe/15-departs-mobile.png), [planification](./captures-equipe/16-planifier-desktop.png), [chargement mobile](./captures-equipe/17-chargement-mobile.png). Code : [StaffDepartures.jsx:72](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffDepartures.jsx#L72), [StaffDepartures.jsx:78](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffDepartures.jsx#L78), [StaffDepartures.jsx:80](https://github.com/mmz97441/pinta/blob/19d20352f288eea2b1f33edfa1cd6ddbea54a8e4/pinta/src/expedile/components/staff/StaffDepartures.jsx#L80).

## Ordre de mise en œuvre proposé

1. **Fiabilité ressentie** : MSG-1 brouillons, APER-1 cohérence action/bouton, MSG-3 document avant rattachement.
2. **Journée de travail mobile** : TRAV-1/TRAV-2, MSG-2 et NAV-1, en conservant permissions et contrôle manuel des envois.
3. **Coordination et départs** : EQ-1, DEP-1/DEP-2, avec raisons précises et accès au correctif.
4. **Uniformité et confort** : vocabulaire LIST-1, cartes LIST-2, puis PREF-1, APER-2, EQ-2 et regroupements LIST-3.

La recette finale devrait faire accomplir à une personne peu habituée au logiciel quatre missions : trouver un dossier d’un collègue, prendre une tâche libre, préparer une réponse puis consulter une facture sans la perdre, et identifier pourquoi un dossier ne peut pas partir. Observer les hésitations et erreurs avant de mesurer le temps. L’objectif n’est pas de supprimer les garde-fous métier mais de rendre chaque choix et son effet immédiatement compréhensibles.
