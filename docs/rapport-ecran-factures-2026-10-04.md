# Écran « Vérifier les factures » : où l’on en est, quelle facture, combien de factures

## Retour pris en compte

Sur un dossier payé avec deux factures validées et un doublon, l’écran affichait quatre numérotations contradictoires pour la même facture : « 3. », « 3 / 3 », « Facture 3 validée » et « Facture 2 sur 2 ». Il proposait aussi trois navigations, le libellé « Facture à vérifier » sur une facture validée, un nom de fichier illisible comme identité et deux encadrés verts. Il était impossible de savoir rapidement combien de factures comptaient, laquelle était affichée et ce qu’il restait à faire.

Causes trouvées dans le code :
- les factures étaient chargées dans l’ordre de leur identifiant technique, donc un numéro pouvait changer après une actualisation ;
- deux comptages étaient mélangés : tous les documents, doublons compris, et les seules factures retenues ;
- la liste des factures n’existait plus dans le mode tâche utilisé par l’équipe ;
- consulter un dossier payé relançait la lecture automatique (appels `ocr-facture` inutiles et avertissement « Les propositions n’ont pas pu être reprises ») ;
- sur ordinateur, les onglets « Voir la facture / Vérifier les articles » restaient affichés sans effet, à cause d’un conflit CSS.

## Ce qui change

- **Une seule numérotation, stable.** Les factures sont classées par date de réception. Seules les factures retenues sont numérotées, de 1 à N. Une facture corrigée par le client garde son numéro. Un doublon devient « Copie de la facture n », une ancienne version « Ancienne version de la facture n ». La liste, la barre de la facture affichée, le rappel près du bouton Valider, les messages et le panneau latéral du dossier utilisent tous ce même numéro.
- **Progression en une phrase.**
  - En cours : « 1 sur 4 factures vérifiées · 1 à vérifier · 1 à corriger par le client · 1 document manquant », suivi du total vérifié HT.
  - Terminé : « N factures · toutes vérifiées ».
  - Une barre colorée accompagne la phrase : une case par facture, vert pour vérifiée, ambre pour à vérifier, brique pour à corriger, gris pour document manquant.
  - La vue d’ensemble du dossier affiche exactement la même phrase.
- **Liste des factures toujours visible.** Chaque ligne indique :
  - le numéro ;
  - le fournisseur, marqué « (proposé) » quand il vient de la lecture automatique, ou « Fournisseur à identifier » ;
  - la date de réception, le nombre d’articles, l’état de la lecture automatique et le nom du fichier en petit ;
  - le montant ;
  - une pastille d’état.

  Une correction demandée affiche son motif. La liste remplace le menu déroulant.
- **Une seule navigation.** Une barre « Facture n sur N · fournisseur · montant », avec son état, « Facture précédente » et « Facture suivante ». Le compteur de pages du PDF reste dans le document.
- **Prochaine étape.**
  - Quand la facture à traiter n’est pas celle affichée : « Prochaine étape : vérifier la facture n », avec un bouton.
  - Quand la facture attend le client : « En attente de la correction du client (facture n) ».
  - Le bouton n’apparaît que pour une personne autorisée à faire l’action.
- **Dossier payé, terminé ou archivé.**
  - Titre « Factures du dossier ».
  - Un seul bandeau « Consultation uniquement… » en haut.
  - Pas de « Passer au devis » ni d’invitation à vérifier.
  - Aucune relance de la lecture automatique.
  - Sur téléphone, l’onglet devient « Voir les articles ».
- **Document indisponible.** Un bouton « Réessayer » redemande un lien sécurisé sans recharger le dossier. Si le fichier lui-même est en cause, l’écran demande un nouveau dépôt.
- **Onglets réservés aux écrans étroits.** Sur ordinateur, document et articles restent côte à côte, sans onglets.
- **Clavier et lecteurs d’écran.**
  - Le focus n’est plus perdu après une validation, un « Réessayer » ou en fin de liste.
  - L’anneau de focus est bleu marine ou bleu pâle, contrasté.
  - Les messages ne sont plus annoncés deux fois.

Les décisions antérieures sont conservées : document et articles côte à côte sur ordinateur, une seule validation, doublons consultables et restaurables, rappel du numéro près du bouton Valider, lecture automatique seulement indicative, aucun message envoyé depuis cet écran.

## Limites connues

- Les montants de toute l’application s’affichent au format « 16.64 € » (fonction commune `eur`, utilisée aussi par les devis PDF, les exports et les messages). Le passage au format « 16,64 € » doit être traité dans un lot dédié.
- Un dossier en consultation dont une facture n’a jamais été vérifiée montre encore l’éditeur désactivé de cette facture. Ce comportement existait avant ce lot.

## Vérification

Contrôles locaux :
- analyse statique sans avertissement ;
- tests unitaires, dont l’ordre, la numérotation, les comptages et l’identité des factures ;
- compilation avec la configuration de la CI ;
- les 45 suites navigateur de l’étape « Parcours navigateur sans services externes ».

Nouveaux scénarios navigateur :
- numérotation identique après rechargement quand l’ordre technique diffère de l’ordre d’arrivée ;
- même numéro dans la liste, la barre et le rappel ;
- dossier payé consulté sans aucun appel `ocr-facture` ;
- onglets masqués sur grand écran et utilisables à 390 px ;
- liste utilisable au clavier ;
- « Réessayer » après l’échec d’un lien de document ;
- accessibilité automatisée en clair et en sombre, à 1440 et 390 px ;
- aucun débordement à 320 et 390 px.

Les essais utilisent des données fictives, sans paiement ni message réel. Aucune migration ni fonction serveur n’est concernée : les colonnes `created_at` et `valide_le` existaient déjà et ne sont que lues.
