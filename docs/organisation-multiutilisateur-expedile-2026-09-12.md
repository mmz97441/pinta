# Organisation multiutilisateur proposée — Expedîle

Proposition du 12 septembre 2026, fondée sur le code `da51429`, pour une équipe de 3 à 5 personnes, environ 1 000 clients et 1 000 cartons par mois. Les personnes et tâches de la maquette sont fictives. Il s’agit d’une organisation à mettre en œuvre, pas d’un changement déjà appliqué à l’application.

**Décision centrale : une base de dossiers commune, des espaces de travail adaptés aux missions de chacun et un responsable explicite pour chaque action.** La personnalisation de l’écran ne doit modifier ni les droits, ni les échéances partagées, ni les données du client.

## 1. Ce qui existe et ce qui manque

Le code contient les rôles Direction, Direction adjointe, Logistique et Préparation, des permissions par opération, un responsable de dossier, une prochaine action, une échéance et les filtres Moi/Non attribués. Ce socle est à conserver.

La priorité actuelle est cependant globale : les conversations passent devant les échéances puis la préparation. L’accueil « Ouvrir le prochain dossier » choisit dans cette liste globale. Un seul responsable et une seule prochaine action par dossier ne décrivent pas deux personnes avançant simultanément sur une facture et une préparation.

Sources : `pinta/src/expedile/App.jsx:283`, `domain/workQueues.js:114`, `components/staff/StaffSplitView.jsx:306` et `components/staff/StaffAssignment.jsx:26`, chemins relatifs à `pinta/src/expedile/` sauf le premier. Les contrôles de certaines permissions d’envois doivent aussi être corrigés conformément à l’audit logique ; cacher un bouton ne suffit pas.

## 2. Les missions sont cumulables

Les missions suivantes servent à organiser les écrans. Elles ne supposent pas cinq recrutements, cinq nouveaux rôles techniques ni l’attribution automatique de droits.

| Mission | Ce qui apparaît d’abord | Action principale | Informations prioritaires |
|---|---|---|---|
| Réception | Cartons à enregistrer, mesures manquantes, réception à rapprocher d’un dossier | Réceptionner / rattacher | Client, EXP, cartons déjà présents, fournisseur/suivi, mesures reçues, casier |
| Préparation | Travail commencé, préparations autorisées compatibles avec le prochain départ | Reprendre / préparer | Accord, cartons à prendre, casier, consignes, mesures finales à saisir |
| Relation client | Questions à répondre, messages sans dossier, demandes ayant échoué | Répondre / attribuer le message | Dernier échange, auteur attendu de l’action, pièces manquantes, attente demandée |
| Documents et devis | Factures à vérifier, préparations prêtes à chiffrer, devis à reprendre | Vérifier / établir le devis | Facture et articles, état de la préparation, mesures finales enregistrées, total et blocages |
| Départs | Dossiers prêts pour un départ, exceptions de chargement | Vérifier le chargement / confirmer le départ | Destination, départ, paiement ou condition contractuelle, colis physiques sortants, étiquettes |
| Direction / coordination | Échéances menacées, actions sans responsable, demandes d’arbitrage et charge disponible | Réaffecter / arbitrer | Motif du blocage, responsable, échéance et effet sur le départ |

Exemple avec trois personnes : A réception + départs ; B préparation ; C relation client + devis. La coordination est une responsabilité supplémentaire portée par l’un des trois selon l’organisation réelle. Avec cinq personnes, relation client et devis peuvent être séparés, et la coordination confiée à une personne dédiée. Les remplacements sont possibles dans les limites des permissions.

## 3. Un accueil personnel, une vue équipe commune

Chaque utilisateur arrive sur **Mon travail**. Son choix de mission active, de colonnes et de densité peut être mémorisé. Pour un profil polyvalent, les missions autorisées restent accessibles en un clic ; changer de mission ne change pas ses permissions.

L’en-tête montre la mission active, le nombre d’actions réalisables, les échéances qui le concernent et ses opérations déjà commencées. Les rubriques suivantes utilisent toutes le même périmètre :

- **À faire maintenant** : actions attribuées à cette personne et réalisables.
- **En cours** : actions commencées par cette personne, avec reprise de saisie.
- **À prendre** : actions disponibles dans ses missions et permissions, sans responsable.
- **En attente** : attente du client ou d’un collègue, avec motif et date de réexamen. Ces actions ne gonflent pas le compteur « À faire ».
- **Équipe** : contexte partagé, accessible selon les droits, avec responsables visibles.

Une ligne montre **action · client/EXP · nombre de cartons utile · responsable · échéance/motif de priorité**. Le bouton **Traiter le suivant** respecte exactement le filtre affiché. Les chiffres doivent nommer leur unité : 6 actions peuvent concerner 4 expéditions et 11 cartons reçus.

## 4. La priorité est liée à la personne et au travail possible

Le calcul procède en deux temps. D’abord, ne retenir que les actions que la personne peut effectuer : permission, mission, responsabilité ou file commune autorisée, prérequis disponibles. Ensuite, ordonner ces actions.

Ordre proposé : incident bloquant demandant une intervention immédiate ou engagement proche réellement menacé ; échéance promise dépassée ; travail déjà commencé ; travail prêt à faire progresser ; ancienneté dans l’action. La place exacte de chaque règle est explicable dans l’écran. La direction peut prioriser une action avec un motif, un auteur et une durée de validité.

Exemples : « À préparer avant la clôture du départ de 14 h », « Réponse promise pour ce matin », « Dernière pièce reçue : devis réalisable », « Préparation commencée par vous ». Un simple message récent ne doit pas faire passer tous les préparateurs sur les conversations. Les dossiers plus anciens doivent remonter progressivement pour éviter qu’ils soient oubliés.

Une échéance logistique nécessite une date de clôture du chargement fiable, distincte de la seule date de départ. Si elle manque, l’application doit dire « horaire à préciser », pas inventer une urgence. Les horaires ouvrés et les promesses de réponse doivent être définis avec l’équipe avant d’automatiser les alertes. Une préférence personnelle ne peut pas masquer une échéance collective à traiter.

## 5. Une expédition, plusieurs actions coordonnées

Le **référent du dossier** conserve la continuité du suivi. Chaque **action** possède un responsable unique, qui peut être différent. Exemple : Sam suit EXP-EXEMPLE, Alex prépare les cartons et Sam vérifie la facture en parallèle. Le dossier garde sa référence ; ses cartons restent numérotés dans ce dossier.

Les actions doivent rester liées aux étapes métier, avec une petite liste de types connus : réception, préparation, document, conversation, devis, départ et correction. Il n’est pas nécessaire de transformer l’application en gestionnaire de projets généraliste.

Une dépendance ne bloque que ce qui en dépend réellement. Après accord valable et hors blocage opérationnel, une facture manquante peut empêcher le devis final tout en laissant les mesures de préparation être enregistrées. À l’inverse, un désaccord client ou un problème déclaré sur le contenu doit apparaître au préparateur comme un blocage à traiter, selon les règles opérationnelles définies.

Quand les mesures finales sont enregistrées et les pièces validées, l’action de devis devient prête pour la bonne personne. Le statut global du dossier, l’état d’une conversation et l’état de chaque action restent distincts.

## 6. Prise en charge et passages de relais

Le bouton **Je m’en occupe** attribue l’action de façon atomique. Si deux personnes cliquent en même temps, une seule obtient l’action ; l’autre voit qui l’a prise. Lire un dossier ne l’attribue pas. Un indicateur de présence éventuel ne remplace ni cette attribution ni la protection des écritures.

**Passer le relais** demande une personne ou une file de mission, une consigne courte, le motif d’éventuel blocage et une échéance si utile. Pour un relais nominatif, le responsable actuel reste affiché jusqu’à l’acceptation ; le destinataire reçoit « Relais à accepter ». Une réaffectation par la coordination peut être immédiate, avec notification et trace. Remettre dans la file commune est une action explicite, pas une conséquence silencieuse d’une déconnexion.

Une absence n’entraîne aucune réaffectation arbitraire. La coordination voit les actions concernées et les redistribue aux personnes disponibles et habilitées. Une action urgente sans repreneur reste visible comme exception.

Les brouillons de mesures et de devis sont sauvegardables ; une écriture concurrente doit être signalée sans écraser la saisie d’un collègue. L’audit a déjà démontré un défaut de conflit sur les mesures finales : cette correction est nécessaire avant d’utiliser le nouveau modèle de collaboration.

## 7. Une communication adressée aux bonnes personnes

Une réponse client crée ou réouvre une action pour le responsable de la conversation, ou la file Relation client si personne n’est désigné. Désigner une permanence communication permet de répondre sans interrompre toute l’équipe ; une autre personne habilitée peut prendre le relais. Le préparateur reçoit une notification uniquement si le contenu entraîne une consigne ou un blocage opérationnel explicite ; une question ne doit pas annuler automatiquement un accord structuré.

Les attentes volontaires restent enregistrées et visibles sans relance insistante. À leur échéance, une action de réexamen apparaît ; cela ne vaut pas accord automatique. Une nouvelle question du client pendant sa pause peut être traitée sans mettre fin à cette pause.

Regrouper les notifications par dossier, distinguer lecture et résolution, montrer les échecs d’envoi et les accès clients manquants. Aucun envoi annoncé comme réussi sans canal accessible. L’historique précise qui a envoyé quoi, quand et à propos de quelle EXP.

## 8. La direction pilote les exceptions et la disponibilité

La vue direction présente les engagements à risque, les actions sans responsable, les relais non repris, les dossiers bloqués et les départs à confirmer. Une vue de charge distingue à faire, en cours et attente externe. Le nombre brut de dossiers ne représente pas la charge : une réception courte et un devis avec plusieurs factures ne sont pas comparables.

Éviter un classement de performance entre collaborateurs. Commencer par les volumes d’actions par type, l’ancienneté, les blocages et la disponibilité déclarée. Des estimations de durée ne doivent être introduites qu’après observation des tâches réelles.

## 9. Côté client : un seul dossier compréhensible

Le client voit son EXP, les cartons concernés, l’étape en cours, ce qu’il doit faire et ce que l’équipe prend en charge. Les mouvements internes de responsabilité ne doivent pas multiplier les interlocuteurs affichés ni modifier les références. Une action client commune (accord, facture, paiement) reste raccordée au bon dossier.

## Mise en œuvre proposée

1. Corriger les incohérences logiques qui affectent collaboration, mesures, paiement, contact et départs. Réutiliser les rôles et permissions existants en corrigeant leur application réelle.
2. Introduire des actions métier assignables avec état, version, échéance, responsable et dépendances ; conserver un référent de dossier. Transformer les suivis existants sans perdre les consignes manuelles.
3. Construire Mon travail et la vue Équipe sur ces mêmes actions ; personnaliser les vues par mission et conserver filtres/compteurs cohérents.
4. Ajouter relais, absences et alertes pertinentes ; tester réception simultanée, modifications concurrentes, préparation/document en parallèle et reprise après attente client.

La maquette associée illustre uniquement les vues et les règles de sélection. Elle n’est pas branchée à Supabase, ne valide pas les droits serveur et ne constitue pas une preuve de charge ou de temps gagné. Avant livraison, vérifier les parcours avec deux collaborateurs et des dossiers fictifs représentatifs, puis mesurer les reprises et interruptions dans l’usage réel.

## Vérification de la maquette

Vérification locale dans Chromium, le 12 septembre : quatre profils, files personnelles, compteurs d’attente et d’actions disponibles, priorité du devis promis pour Sam, priorité de chargement pour Camille, consultation du même dossier par Alex et Sam, prise en charge simulée sans changement de référent. Sur mobile, ouverture du détail puis retour à la ligne sélectionnée testés. Aucun débordement horizontal à 1 440 px et 390 px, aucune erreur JavaScript relevée. Ces vérifications portent uniquement sur le prototype local, sans appel à la production ; elles ne valident pas encore le futur mécanisme d’attribution concurrente.

Voir aussi : [proposition UI générale](proposition-organisation-ui-expedile-2026-09-11.md), [audit logique](audit-logique-expedile-2026-09-11.md), [maquette interactive](maquette-organisation-equipe-2026-09-12.html).
