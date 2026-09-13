**Pinta / Expedîle — liste priorisée des manques logiques**

Audit du 11 septembre 2026 — version locale da51429. Réception, rattachement, préparation, devis, paiement, communication et départs ont été examinés en parallèle par trois spécialistes puis consolidés.

22 écarts retenus : 14 P1 (fiabilité des données, prix, communications ou départs) et 8 P2 (travail perdu, reprise ou affichage incohérent). 18 constats sont étayés par des reproductions locales ; 4 reposent sur une lecture croisée du code et des commandes SQL. Les preuves utilisent des données fictives. Aucun encaissement ni modification de production n’a été effectué. Il s’agit de corrections recommandées, pas de modifications déjà appliquées.

La visibilité et la numérotation courante des cartons récemment corrigées ne sont pas comptées à nouveau. Le point 18 décrit un autre cas limite. Un dossier client EXP conserve sa référence pour tous ses cartons ; le départ groupé ENV est une entité distincte. Les mesures à réception et après optimisation restent séparées.

1. **[P1] Une facture remplacée peut faire compter deux fois les marchandises.** Après rejet puis dépôt d’une nouvelle facture, les articles de l’ancienne restent taxés. Reproduction : devis de 68,63 € au lieu de 55,06 €, soit 13,57 € en trop.

   **Correction recommandée :** Relier explicitement les factures de remplacement et réconcilier ou exclure leurs anciennes lignes avant validation.

   **Preuve :** Moteur et PostgreSQL isolé. **Référence :** Devis, point 1.

2. **[P1] Un collègue peut écraser des mesures finales plus récentes.** A garde son formulaire à 3 kg pendant que B enregistre 9 kg ; A sauvegarde ensuite et remet 3 kg sans conflit affiché.

   **Correction recommandée :** Contrôler la version réellement ouverte au début de la saisie et proposer une reprise explicite en cas de modification concurrente.

   **Preuve :** Chromium et PostgreSQL isolé. **Référence :** Devis, point 2.

3. **[P1] Un devis reste payable après changement de destination.** Après passage du profil client de La Réunion à Mayotte, l’ancienne intention de paiement reste valide avec son ancien tarif. Le contrat SQL accepte sa confirmation.

   **Correction recommandée :** Figer la destination contractuelle du dossier ; toute modification de cette destination doit invalider le devis et son paiement.

   **Preuve :** PostgreSQL isolé ; aucun encaissement fournisseur. **Référence :** Devis, point 3.

4. **[P1] Un nouveau carton ne force pas à revalider les mesures après optimisation.** Après retour arrière, rattachement et nouvel accord, les anciennes mesures finales restent utilisables. Le test accepte encore 3 kg après ajout d’un carton de 20 kg.

   **Correction recommandée :** Rendre les mesures finales à reconfirmer dès que la composition change, tout en conservant leur historique. Les mesures de réception restent distinctes.

   **Preuve :** Parcours complet dans PostgreSQL isolé. **Référence :** Devis, point 4.

5. **[P1] Une adresse corrigée par l’équipe peut rester ancienne sur les étiquettes.** L’équipe modifie un champ d’adresse différent de celui lu par le portail et prioritaire pour les étiquettes.

   **Correction recommandée :** Unifier les champs d’adresse et vérifier ensemble fiche équipe, profil client et étiquette.

   **Preuve :** Chromium ; lecture du générateur d’étiquettes. **Référence :** Frontend, point 1.

6. **[P1] Le portail associe parfois un suivi aux mesures du mauvais carton.** Si le carton 1 n’a pas de suivi et le carton 2 en a un, ce suivi est affiché avec les dimensions du carton 1.

   **Correction recommandée :** Afficher chaque carton à partir du même enregistrement physique, avec un suivi absent explicitement indiqué.

   **Preuve :** Chromium. **Référence :** Frontend, point 2.

7. **[P1] La notification peut être annoncée alors que le client ne peut pas la consulter.** Une réception pour un nouveau client sans compte lié ni Telegram affiche « notification disponible dans l’espace client », sans lui donner d’accès.

   **Correction recommandée :** Vérifier qu’un canal est accessible ; sinon proposer l’invitation ou créer une tâche de contact visible pour l’équipe.

   **Preuve :** Chromium et lecture de queue_message. **Référence :** Frontend, point 3.

8. **[P1] Une réponse Telegram peut arriver dans le mauvais dossier.** Un client répond à un message de son ancien dossier livré ; s’il n’a qu’un autre dossier actif, la réponse est rangée dans ce dernier.

   **Correction recommandée :** Donner priorité au dossier du message auquel le client répond, vérifier son appartenance et conserver les cas ambigus dans la boîte à attribuer.

   **Preuve :** Véritable handler local, base et réseau simulés. **Référence :** Backend, point 1.

9. **[P1] Un document Telegram après paiement peut échouer sans rejoindre la file de travail.** Toute pièce jointe devient une facture ; sur un dossier payé, la garde refuse l’ajout. Le webhook échoue sans conserver de message exploitable par l’équipe.

   **Correction recommandée :** Accueillir d’abord le document dans la conversation ; son utilisation comme facture doit être une action distincte.

   **Preuve :** Véritable handler local ; refus SQL simulé selon la garde actuelle. **Référence :** Backend, point 2.

10. **[P1] Une alerte de produit interdit peut disparaître au rattachement.** Après avoir coché une alerte dans une nouvelle réception puis choisi un rattachement, le résumé affiche encore l’alerte mais la sauvegarde l’omet.

   **Correction recommandée :** Conserver les alertes lors du changement de parcours et enregistrer ce qui est annoncé dans le résumé.

   **Preuve :** Chromium. **Référence :** Frontend, point 4.

11. **[P1] Un départ périmé ou incompatible peut rester affecté.** Après nouvel accord, une ancienne affectation est conservée même si le départ ne convient plus ; la sélection manuelle peut aussi proposer des départs arrivés ou passés.

   **Correction recommandée :** Revalider destination, date et disponibilité lors de l’accord, de l’affectation et de l’expédition.

   **Preuve :** Lecture croisée UI et dernière commande SQL. **Référence :** Backend, point 3.

12. **[P1] Un départ groupé peut être marqué parti avec des dossiers encore à préparer.** Le statut du départ ENV change indépendamment des statuts des dossiers EXP. Il n’existe pas de confirmation commune des dossiers effectivement embarqués.

   **Correction recommandée :** Créer une confirmation de départ avec liste des dossiers embarqués et reportés, puis enregistrer les statuts concernés ensemble.

   **Preuve :** Lecture croisée UI, accès aux données et déclencheurs. **Référence :** Backend, point 4.

13. **[P1] Les exports peuvent inclure des dossiers annulés et perdre des archives.** L’export suit les affectations courantes. Test : dossier payé de 100 € + dossier annulé de 999 € donnent 1 099 €. Un dossier archivé peut ensuite manquer à une réédition.

   **Correction recommandée :** Exporter une liste d’embarquement validée et conservée, indépendante du chargement courant des archives.

   **Preuve :** Export réel local pour l’annulation ; code pour les archives. **Référence :** Backend, point 5.

14. **[P1] Certains droits affichés ne sont pas réellement appliqués.** Retirer « Modifier un envoi » ou « Réaffecter un colis » ne suffit pas à bloquer ces opérations : les contrôles correspondants restent fondés sur le rôle ou absents du champ modifié.

   **Correction recommandée :** Appliquer chaque permission annoncée côté serveur et dans l’interface, avec un contrôle ciblé par opération.

   **Preuve :** Lecture croisée permissions, politiques SQL et commandes. **Référence :** Backend, point 7.

15. **[P2] Les mesures finales sont perdues si les documents ne sont pas encore complets.** Le préparateur saisit les quatre mesures, mais ne peut les enregistrer sans devis valide. Quitter le dossier perd la saisie.

   **Correction recommandée :** Sauvegarder un brouillon de préparation indépendant de la validation et de l’envoi du devis.

   **Preuve :** Chromium : zéro écriture, champs vides à la réouverture. **Référence :** Devis, point 5.

16. **[P2] Un devis invalidé reste affiché comme un paiement attendu.** Après ajout d’un document, le montant et le lien sont retirés, mais l’équipe et le client voient encore l’étape de paiement. Le recalcul passe par un retour arrière peu visible.

   **Correction recommandée :** Afficher « Devis à recalculer » et une action directe de reprise. L’ancien paiement est déjà bloqué par le changement de version.

   **Preuve :** PostgreSQL isolé et vues Chromium équipe/client. **Référence :** Devis, point 6.

17. **[P2] Un article manuel peut imposer deux sauvegardes du devis.** Le lien article–facture est bien écrit en base mais absent de la réponse locale. Après rafraîchissement, le devis est considéré modifié et doit être enregistré de nouveau.

   **Correction recommandée :** Conserver le lien facture dans le résultat de création de l’article et stabiliser le premier calcul.

   **Preuve :** Chromium. **Référence :** Devis, point 7.

18. **[P2] Une ligne vide peut encore faire changer le numéro du carton après sauvegarde.** Avec un carton déjà reçu, laisser la ligne « Carton 2 » vide et remplir « Carton 3 » enregistre finalement ce dernier comme carton 2.

   **Correction recommandée :** Autoriser la ligne vide réservée au prochain scan, mais supprimer ou signaler les trous avant confirmation pour garder une numérotation cohérente.

   **Preuve :** Exécution des fonctions réelles : affiché 3, enregistré 2, aucune erreur de validation. **Référence :** Vérification root : ColisModal.jsx:25–33 et domain/reception.js:2–5,55–67.

19. **[P2] L’attente volontaire du client est contredite dans sa liste de colis.** L’accueil indique « En attente à votre demande », tandis que « Mes colis » demande encore son accord pour le même dossier.

   **Correction recommandée :** Afficher le même état d’attente et sa date partout, avec la possibilité explicite de la terminer.

   **Preuve :** Chromium. **Référence :** Frontend, point 5.

20. **[P2] Des notifications non lues deviennent invisibles au-delà des 50 dernières.** Une 51e notification plus ancienne, non lue, ne figure ni dans la liste ni dans le compteur ; aucun chargement supplémentaire n’est proposé.

   **Correction recommandée :** Compter les non-lues indépendamment de la page chargée et permettre l’accès aux notifications plus anciennes.

   **Preuve :** Chromium. **Référence :** Frontend, point 6.

21. **[P2] Le total des dossiers d’un client varie selon les pages déjà visitées.** Une fiche affiche 0 dossier, puis 1 après chargement des archives ailleurs, sans aucune modification métier.

   **Correction recommandée :** Charger explicitement l’historique de la fiche ou distinguer clairement dossiers actifs et archives avec des totaux stables.

   **Preuve :** Chromium. **Référence :** Frontend, point 7.

22. **[P2] Les dates d’expédition et de livraison ne sont pas enregistrées par le parcours de statut.** Le dossier passe à « Livré » mais sa chronologie peut rester au paiement ; les statistiques fondées sur la date de livraison ne disposent pas de cette date.

   **Correction recommandée :** Horodater les événements à leur confirmation et conserver un historique explicite des corrections.

   **Preuve :** Lecture croisée des transitions, déclencheurs et chronologie. **Référence :** Backend, point 6.

L’ordre de traitement recommandé commence par les points 1 à 6 (prix, mesures et adresse), puis 7 à 14 (communication et départs). Le point 15 peut avancer en parallèle : il réduit directement les ressaisies de l’équipe.

Deux règles métier complémentaires doivent être définies avant leur mise en œuvre : le nombre de colis physiques sortants après optimisation (distinct du nombre de dossiers et des cartons reçus) ; les conditions d’expédition à crédit et les échéances pour les clients professionnels. Les configurations SMTP de l’application et PayPlug réel précédemment signalées restent des dépendances distinctes, non revérifiées à distance dans cet audit.

Cette revue identifie des défauts concrets du dépôt actuel ; elle ne prouve pas que chacun s’est produit dans les dossiers réels et ne garantit pas l’absence de tout autre défaut.

**Rapports techniques et scénarios vérifiés**

- [Frontend et parcours client](audit-logique-frontend-2026-09-11.md)
- [Devis, documents et paiement](audit-logique-devis-2026-09-11.md)
- [Backend, Telegram et départs](audit-logique-backend-2026-09-11.md)

Pour le point 18, les chemins sont relatifs à `pinta/src/expedile/`. La reproduction appelle `receptionCartons`, `receptionMeasurementIssues` et `mergeReceptionCartons` avec un carton existant, une première nouvelle ligne entièrement vide et une seconde nouvelle ligne complètement mesurée. Résultat : `displayedCarton=3`, `savedCarton=2`, `validationIssues=[]`, `nbSaved=2`. Aucun fichier applicatif ni test versionné modifié.
