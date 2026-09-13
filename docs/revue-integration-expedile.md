# Revue indépendante de l’intégration — 10 septembre 2026

Revue effectuée par le spécialiste devis en dehors de son périmètre d’implémentation principal, à la demande du responsable de l’équipe. Les observations ont été transmises aux propriétaires frontend, contexte et backend ; chaque correctif a ensuite été relu. Ce document accompagne les journaux de décisions, sans promettre l’absence de tout défaut ni un déploiement de production déjà effectué.

## Méthode et preuves

- Lecture des différences du contexte de données, des écrans staff/client, des adaptateurs Supabase, des fonctions Edge et des migrations SQL.
- Vérification des contrats complets : formulaire → moteur → snapshot → RPC → rechargement → message → PDF, puis paiement et documents.
- Tests automatisés de la branche : `npm test` donne 27 tests réussis et `npm run lint` réussit lors de cette revue. Les vérifications globales les plus récentes restent consignées dans le journal du responsable.
- Vérification supplémentaire indépendante sur PostgreSQL 15 local : 24 devis JavaScript transmis à la vraie fonction `save_quote`, sous rôle `authenticated` avec un profil direction. Les montants enregistrés correspondent exactement à tous les montants du moteur, y compris poids facturable, avant/après et économie. Données entièrement annulées par `ROLLBACK`.
- Rapport backend relu : 22 migrations rejouées sur une base vide, 45 assertions SQL réussies, 9 tests Edge avec réseau simulé et 10 bundles Edge compilés. Détail dans `pinta/supabase/tests/verification-results.json`.
- Inspection des captures bureau/mobile de préparation ; le rapport navigateur de la branche est `docs/verification-expedile-2026-09-10/browser-results.json`.
- Aucune transaction PayPlug, aucun message Telegram et aucune analyse de document client réel n’ont été déclenchés pour cette revue.

## Défauts relevés et correctifs vérifiés

| Priorité | Défaut concret | Correction relue / preuve |
|---|---|---|
| P1 | Le contexte pouvait recalculer puis confirmer avec un ancien `updatedAt` parce que le nouveau state React n’était pas encore rendu. | Les réponses canoniques alimentent aussi la référence synchrone du contexte ; mises à jour ordinaires sérialisées et contrôle de concurrence SQL. |
| P1 | Une modification d’article, de document ou de mesure pouvait laisser subsister un devis et son lien de paiement. | Invalidation en base ; comparaison des entrées fraîchement chargées avant confirmation ; anciennes versions conservées. |
| P1 | Le serveur acceptait des composantes de devis arbitraires ou un snapshot dont le PDF annonçait un autre total. | Recalcul SQL à partir des lignes, factures, taux, tarif et configuration réels ; montants du snapshot normalisés ; mutations financières directes interdites. Matrice JS/SQL de 24 cas réussie. |
| P1 | Avant/après pro annonçait une économie fiscale sans changement de dimensions. | Calcul pro sans OM/OMR/TVA des deux côtés ; test économie nulle à dimensions identiques. |
| P1 | Les modalités pro étaient demandées avant envoi mais proposées uniquement après envoi. | Choix pendant la préparation, enregistrement avec le devis, PDF versionné. La confirmation du règlement ne réécrit plus la modalité du devis. |
| P1 | Le dossier client exposait des notes internes par l’API et affichait des devis en brouillon. | Vues dédiées sans notes internes ni montants non publiés ; anciennes politiques de lecture brute supprimées ; contrôle d’affichage client commun. |
| P1 | La validation OCR pouvait dupliquer les articles ou afficher les anciennes lignes après remplacement. | Extraction persistée et confirmation idempotente ; remplacement lié à la facture ; rechargement canonique après confirmation. |
| P1 | Un utilisateur pouvant ajouter des factures pouvait insérer directement une facture déjà validée ou conserver la validation en remplaçant son contenu. | Le serveur exige la permission de validation dès l’insertion ; modifier le contenu sans cette permission efface la validation et son auteur/date. Cas ajoutés aux régressions SQL finales. |
| P1 | Une extraction pouvait être confirmée après remplacement de son fichier. | La fonction Edge recalcule le hash du fichier actuel et refuse une extraction attachée à un autre document. |
| P1 | Les écritures directes de paiement ou le double appel pouvaient contourner le parcours comptable. | Commande transactionnelle et contrôle version/montant/devise ; historique de paiement privé ; idempotence et interdiction des changements financiers directs. |
| P1 | Une création de paiement ambiguë pouvait provoquer une seconde demande fournisseur. | Réservation unique par version, réemploi du lien existant ; seules les erreurs fournisseur certaines permettent une nouvelle tentative automatique. Les cas ambigus demandent un rapprochement. |
| P1 | Deux membres de l’équipe pouvaient attribuer simultanément le même message Telegram à deux dossiers. | Réservation SQL de l’attribution avec verrou et dossier figé, puis insertion idempotente du message. |
| P1 | Une ancienne demande de préparation pouvait autoriser de nouveaux cartons. | Snapshot des cartons joint à la demande ; contrôle des callbacks et abandon des demandes devenues obsolètes. |
| P2 | Une pause client expirée créait une fausse date d’envoi et faussait les relances et le délai de réponse. | L’échéance crée une action à renouveler ; la date de demande n’est posée qu’après livraison effective. |
| P2 | Les relances pouvaient ignorer une réponse client, multiplier les rappels d’un même client ou envoyer une demande après son paiement. | Suppression en présence d’un message client non lu récent, limite par client et dernière échéance seulement ; revalidation du statut et de la version avant livraison. |
| P2 | Les mises à jour de messages, notifications et référentiels étaient absentes des abonnements staff. | Abonnements aux modifications utiles, rechargement ciblé du dossier et configuration actualisée. |
| P2 | Les fichiers privés étaient rendus avec d’anciennes URL publiques ou temporaires persistées. | Chemins stockés, URL signées à l’affichage, origine vérifiée ; objets immuables depuis le navigateur. |
| P2 | Le profil client doublait le prénom après sauvegarde. | Nom de famille distinct du nom complet d’affichage ; prénom sauvegardé séparément. |
| P2 | Les corrections de statut de l’interface ne correspondaient pas aux transitions autorisées. | RPC de retour contrôlé, permission spécifique, concurrence vérifiée et trace d’audit. |
| P2 | Les tableaux de bord assimilaient des encaissements à du chiffre d’affaires et mélangeaient pauses et absences de réponse. | Encaissements, transport et taxes séparés ; pauses explicites ; indicateurs limités aux dates réelles et périmètre d’archives clairement indiqué. |

## Derniers contrôles d’intégration résolus

La dernière lecture a identifié deux conséquences des changements de session et des vues client sûres ; les correctifs du contexte ont été relus après leur intégration :

1. Les clients ne reçoivent plus les changements des tables brutes auxquelles ils n’ont plus accès. Les notifications rechargent désormais le dossier concerné ; les vues sûres sont également actualisées au retour au premier plan et toutes les 60 secondes lorsque l’espace client est visible. Cette cadence est une latence de secours explicite.
2. Les réponses asynchrones commencées avant une déconnexion sont ignorées grâce au numéro de génération de session, y compris archives, boîte de réception, clients, départs et configuration. La déconnexion purge également les références et informations de l’équipe.

La remise à l’état publié d’un devis recalculé est également effectuée lorsque le dossier était déjà « devis envoyé » ou « attente paiement ». Les insertions locales d’articles et de factures retirent une éventuelle copie du même identifiant arrivée entre-temps par actualisation, ce qui évite un doublon visuel lié à l’ordre des réponses.

Le dernier contrôle ciblé a corrigé le statut `attente_paiement` absent du registre frontend et de la phase du détail client. Il dispose maintenant du badge, de la phase de paiement, des transitions, du règlement et du suivi public attendus. Les deux nouveaux tests ciblés réussissent, dont un rendu React réel vérifiant le paiement d’un devis publié et l’absence de bouton pour un brouillon ; ESLint réussit sur tous les fichiers concernés.

Aucun défaut P1 transmis pendant cette revue ne reste sans correctif dans le code relu. Le dernier passage navigateur et le build sont sous la responsabilité du chef d’ingénierie ; leurs résultats ne sont pas déduits de cette conclusion de revue.

## Limites de ce résultat local

La base PostgreSQL de test prouve l’exécution des migrations et des règles SQL, pas l’état des migrations déjà appliquées au projet Supabase de production. Les fournisseurs sont simulés dans les tests Edge et navigateur ; leur configuration de test puis leur contrôle bout en bout restent nécessaires. Les taxes et règles commerciales existantes sont conservées ; leur validité fiscale n’a pas été certifiée. Les performances des écrans et la pagination ont été vérifiées localement, sans simulation de 1 000 clients simultanés ni prétention de gain de temps observé chez les utilisateurs.
