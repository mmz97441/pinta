# Facturation des clients d'Expedîle France — référentiel de conformité

Droit vérifié au **10 octobre 2026**. Ce document sert de référence pour construire la facturation dans l'application et pour répondre à toute question d'un contrôleur des impôts ou des douanes sur cette facturation.

## Mode d'emploi

**Ce que la direction a décidé.** Expedîle France émet une facture à chaque client, particulier ou professionnel, à la confirmation du départ, en PDF/Factur-X, avec avoirs, portail client, outils pour l'équipe et export comptable. Ce référentiel dit quelles règles encadrent ces factures et comment l'application doit les appliquer.

**D'où viennent les règles.** Chaque règle provient de recherches vérifiées le 10 octobre 2026 sur les sites officiels : Légifrance (versions en vigueur et versions à venir), BOFiP, impots.gouv.fr, douane.gouv.fr, entreprendre.service-public.gouv.fr, senat.fr, assemblee-nationale.fr et EUR-Lex. Les citations ont été comparées mot à mot avec la page officielle. Lorsqu'un outil de lecture n'a restitué qu'une paraphrase, la règle le signale. Ce qui n'a pas de source officielle n'est jamais présenté comme une règle : c'est une proposition (section 4) ou un point à confirmer (sections 3 et 5).

**Format d'une règle.** Chaque règle porte un numéro (F = facture, T = TVA, D = douane et débours, E = facturation électronique, C = contrôle) et six rubriques : la règle ; son application chez Expedîle ; la base légale ; la source officielle ; une citation courte ; la fiabilité.

**Fiabilité.**

- *Élevée* : texte clair, en vigueur au 10 octobre 2026, vérifié.
- *Moyenne* : texte vérifié, mais son application à Expedîle dépend de faits à confirmer ou d'une interprétation.
- *Faible* : aucune source ne tranche ; la position doit être sécurisée (rescrit fiscal, position formelle de la douane).

**Le droit change pendant le projet.** Au 10 octobre 2026, la TVA figure encore dans le code général des impôts (CGI). Elle passe dans le code des impositions sur les biens et services (CIBS) le 1er janvier 2027, sans changement de fond ; les factures peuvent citer le CGI jusqu'au 30 juin 2028 (règle C20). Chaque règle indique la version applicable et, quand elle est connue, la version à venir.

### Abréviations

| Sigle | Sens |
|---|---|
| CGI, ann. II, III, IV | Code général des impôts et ses annexes réglementaires |
| CIBS | Code des impositions sur les biens et services (reçoit la TVA le 1er janvier 2027) |
| LPF | Livre des procédures fiscales |
| C. com. | Code de commerce |
| C. douanes | Code des douanes (nouvelle rédaction en vigueur depuis le 1er mai 2026) |
| CDU | Code des douanes de l'Union (règlement (UE) n° 952/2013) |
| BOFiP, BOI | Bulletin officiel des finances publiques ; doctrine opposable à l'administration (LPF art. L80 A) |
| PA | Plateforme agréée de facturation électronique |
| PPF | Portail public de facturation (annuaire et concentrateur des données) |
| DSE | Dossier de spécifications externes de la facturation électronique (DGFiP) |
| OM, OMR | Octroi de mer, octroi de mer régional |
| DAU | Déclaration en douane (document administratif unique) |
| RDE | Représentant en douane enregistré |
| PAF | Piste d'audit fiable |
| FEC | Fichier des écritures comptables |
| SIE | Service des impôts des entreprises |
| DROM | Départements et régions d'outre-mer |

## Synthèse

### Ce qui s'impose dès aujourd'hui (10 octobre 2026)

1. **Recevoir les factures des fournisseurs par une plateforme agréée.** Obligatoire pour toutes les entreprises depuis le 1er septembre 2026 (E3). À défaut : mise en demeure, puis 500 € et 1 000 € d'amende par période de trois mois (E13). Garder des preuves datées : contrat, accord formel, inscription à l'annuaire.
2. **Vérifier la catégorie de taille d'Expedîle France au 1er janvier 2025** (E2). PME ou micro-entreprise : émission électronique et e-reporting au 1er septembre 2027. Entreprise de taille intermédiaire (ETI) ou grande entreprise : ces obligations s'appliquent déjà depuis le 1er septembre 2026.
3. **Facturer chaque client professionnel**, même pour une prestation exonérée (F1, F2), avec toutes les mentions (tableau du 2.1), une numérotation continue (F11), une facture d'acompte pour chaque paiement reçu avant la prestation (F14) et des délais de paiement dans les plafonds légaux (F24).
4. **Ne jamais écrire « TVA » sur une facture d'Expedîle France pour un montant qui n'est pas la TVA due par Expedîle France** (T16). La ligne « TVA » du devis, 8,5 % × (transport + OM + OMR), est une estimation de la TVA à l'importation dans le DOM. Écrite comme TVA sur une facture d'Expedîle France, elle serait due par Expedîle France.
5. **Le transport et les services liés à l'exportation sont exonérés de TVA** pour les quatre destinations, à condition de prouver le départ des marchandises (T4, T7) ; la position est moins sûre pour les achats propres des particuliers expédiés à Mayotte (T8). La facture doit citer l'exonération (T15).
6. **Sécuriser l'enregistrement des paiements des particuliers** (C12 à C16). Le module qui enregistre les paiements PayPlug et manuels est très probablement un « logiciel de caisse ». Développé en interne, il ne se justifie que par le certificat d'un organisme accrédité ; à défaut, amende de 7 500 € par logiciel. Le délai qui reportait la certification a pris fin le 1er septembre 2026.
7. **Revoir la « facture commerciale » de départ (Expedîle France → Expedîle Réunion)** avec le déclarant en douane (D17). Présentée comme une vente, elle peut faire d'Expedîle Réunion le redevable de la TVA à l'importation et de l'octroi de mer, et exposer Expedîle France à l'amende de 50 % pour facture sans opération réelle.
8. **Tout conserver dix ans, sous la forme d'origine, sans modification** (F18, F22, F23). La durée fiscale passe de six à dix ans le 1er janvier 2027 pour toutes les pièces encore en cours de conservation.

### Calendrier des textes

| Date | Changement | Effet pour Expedîle | Règles |
|---|---|---|---|
| 21/02/2026 | Loi de finances pour 2026 (loi n° 2026-103) | Plateforme agréée seule autorisée ; amendes de facturation électronique relevées ; attestation d'éditeur rétablie pour les logiciels de caisse ; exonération étendue aux transports aériens à l'intérieur de chaque DOM | E5, E13, C15, T5 |
| 01/05/2026 | Nouvelle rédaction du code des douanes | Représentation en douane : art. L221-4 et suivants, R221-11 et suivants | D12 |
| 27/06/2026 | Loi n° 2026-534 contre les fraudes sociales et fiscales | Contrôles inopinés des logiciels de caisse et des terminaux de paiement ; archives restituées au format de l'administration ; conservation portée à dix ans au 1er janvier 2027 | C14, C16, F22 |
| 01/07/2026 | Règlements (UE) 2026/382 et 2026/1022 ; loi de finances 2026 art. 99 ; arrêté du 29 juin 2026 | Déclaration H7 réservée aux ventes à distance de biens importés ; plafonds d'OM majorés de moitié à Mayotte ; liste des produits exonérés de TVA à l'importation modifiée | D16, D5, D15 |
| 29/07/2026 | Décret n° 2026-677 et arrêté du 27 juillet 2026 | Règles des plateformes, données, fréquences et formats de la facturation électronique | E5, E9, E10 |
| 01/09/2026 | Facturation électronique, première étape | Réception obligatoire pour tous ; émission et e-reporting pour les ETI et grandes entreprises ; fin du délai de certification des logiciels de caisse | E1, E3, C15 |
| 01/01/2027 | Transfert de la TVA au CIBS ; loi n° 2026-534 art. 36 ; loi de finances 2025 art. 38 | Nouvelles références légales ; conservation fiscale de dix ans ; fin du régime simplifié de TVA ; nouvel art. L102 B bis du LPF | C20, F22, F23, E9 |
| 01/09/2027 | Facturation électronique, seconde étape | PME et micro-entreprises : émission électronique, e-reporting, données de paiement, quatre nouvelles mentions | E1, F8 |
| 31/12/2027 | Fin de la décision (UE) 2021/991 et de la liste territoriale d'exonération de TVA à l'importation | Le régime de l'octroi de mer peut être réformé | D1, D15 |
| 30/06/2028 | Fin des renvois au CGI sur les factures | Citer le CIBS ou la directive dans les mentions d'exonération | T15, C20 |

## 1. Objet et périmètre

### 1.1 Qui facture qui, quoi et quand

- **Émetteur** : Expedîle France, société établie en France métropolitaine (région parisienne), assujettie à la TVA. Elle reçoit les colis achetés en ligne par ses clients, les mesure, les reconditionne, établit un devis et les expédie par départs groupés.
- **Clients** : des particuliers, qui paient en ligne par carte (PayPlug) ou manuellement ; des professionnels titulaires d'un SIRET, qui paient par envoi ou à terme.
- **Destinations** : La Réunion (974), Mayotte (976), Guadeloupe (971), Martinique (972).
- **Moment** : la direction a retenu l'émission de la facture à la confirmation du départ, pour tous les clients. Les textes y ajoutent une facture d'acompte pour le professionnel qui paie avant le départ (F14), la date de réalisation de la prestation lorsqu'elle est connue et différente de la date de la facture (F12), et la note due au consommateur (F5).
- **Documents** : facture, facture d'acompte, avoir, facture rectificative ; PDF et Factur-X ; mise à disposition sur le portail client ; outils de l'équipe ; export comptable.
- **Entité à destination** : Expedîle Réunion figure comme destinataire des départs sur la « facture commerciale » douanière. Son statut (société distincte ou établissement d'Expedîle France) reste à confirmer (Q1).

### 1.2 Ce que l'application calcule aujourd'hui

Constat du code au 10 octobre 2026 (`domain/quote.js`, recalculé au serveur par `save_quote`) :

- **Transport** = base + prix au kilo × poids taxable ; le poids taxable est le plus élevé du poids réel et du poids volumétrique des colis sortants.
- **Octroi de mer et OMR** (particuliers) : par article, sur la valeur de l'article augmentée d'une part du transport répartie au prorata de la valeur, aux taux de la catégorie et de la destination.
- **« TVA »** (particuliers) = (transport + OM + OMR) × taux de TVA de la destination (8,5 % pour 974, 971 et 972 ; 0 pour 976).
- **Frais divers** ajoutés au total (frais de stockage, etc.).
- **Professionnels** : transport et frais explicites seulement, sans aucune taxe.
- **Modes de paiement prévus** (`PAYMENT_TERMS`) : carte bancaire (PayPlug), virement, espèces ; pour les professionnels, « Paiement à 30 jours » et « Paiement en fin de mois ». Le paiement manuel (`mark_manual_payment`) enregistre un libellé de méthode libre, « manuel » par défaut.
- Le **devis PDF** imprime une ligne « TVA (8,5 %) » ; il ne porte ni SIREN, ni mention RCS, ni forme juridique.
- La **« facture commerciale » de départ** (PDF et Excel), intitulée « FACTURE COMMERCIALE » avec le pied « usage douanier uniquement », va de l'expéditeur Expedîle au destinataire réglé par destination. Elle liste les articles de chaque dossier avec code SH, valeur et part de transport.

Ces calculs restent en l'état. Le référentiel signale leurs écarts avec les textes (D5, D6, T16) ; toute correction relève d'une décision de la direction (section 4).

### 1.3 Hors périmètre

- Impôt sur les sociétés et prix de transfert entre Expedîle France et Expedîle Réunion (signalés en section 5).
- Classement tarifaire (codes SH) et taux d'octroi de mer par produit : module douane existant.
- Ce document ne modifie aucun calcul ni aucun écran en production.

## 2. Règles retenues

### 2.1 La facture : obligation, mentions, numérotation, émission, acomptes, avoirs, intégrité, langue, devise, conservation

#### Tableau des mentions obligatoires

« Pro » désigne un client professionnel (assujetti, ou personne morale même non assujettie). Les règles citées sont détaillées ci-dessous.

| Mention | Particulier | Pro | Base légale |
|---|---|---|---|
| Nom complet et adresse d'Expedîle France | Oui | Oui | CGI ann. II art. 242 nonies A, I-1° ; C. com. L441-9 I ; arrêté 83-50/A art. 3 |
| SIREN d'Expedîle France | Oui | Oui | 242 nonies A, I-1° ; C. com. R123-237 1° |
| « RCS » suivi de la ville du greffe ; adresse du siège social | Oui | Oui | C. com. R123-237 2° et 3° |
| Forme juridique (SAS, SARL…) et montant du capital social | Oui | Oui | C. com. R123-238 |
| Numéro de TVA intracommunautaire d'Expedîle France | Oui (dispense possible si total ≤ 150 € HT ou facture rectificative) | Oui (même dispense) | 242 nonies A, I-2° et II |
| Nom complet et adresse du client | Oui, sauf opposition du particulier | Oui, avec l'adresse de facturation si elle diffère | 242 nonies A, I-1° ; L441-9 I ; arrêté 83-50/A art. 3 ; fiche DILA F31808 |
| SIREN du client | Sans objet | Oui pour les factures émises à partir du 01/09/2027 si Expedîle France est une PME ou une micro-entreprise (01/09/2026 si ETI ou grande entreprise) ; possible dès maintenant | 242 nonies A, I-1° et notes d'application |
| Date d'émission | Oui | Oui | 242 nonies A, I-6° ; arrêté 83-50/A art. 3 (date de rédaction) |
| Numéro unique, séquence chronologique et continue | Oui | Oui | 242 nonies A, I-7° |
| Date de réalisation ou d'achèvement de la prestation, ou date de versement de l'acompte, si elle est déterminée et différente de la date d'émission | Oui, avec le lieu d'exécution | Oui | 242 nonies A, I-10° ; L441-9 I ; arrêté 83-50/A art. 3 |
| Pour chaque prestation : quantité, dénomination précise, prix unitaire HT, taux de TVA ou mention de l'exonération | Oui (décompte détaillé facultatif si un devis descriptif et détaillé a été accepté et correspond à la prestation) | Oui | 242 nonies A, I-8° ; L441-9 I ; arrêté 83-50/A art. 3 |
| Rabais, remises, ristournes et escomptes acquis et chiffrables (remises de fidélité ou d'abonnement comprises) | Oui | Oui | 242 nonies A, I-9° ; L441-9 I |
| Total HT et taxe par taux, montant de taxe à payer ; total TTC | Oui | Oui | 242 nonies A, I-11° ; arrêté 83-50/A art. 3 |
| Référence de l'exonération (article du CGI, article de la directive 2006/112/CE ou mention en clair) | Oui (même dispense que le numéro de TVA) | Oui (même dispense) | 242 nonies A, I-12° et II |
| « Autoliquidation » | Jamais entre la métropole et les DOM | Seulement si le client est redevable de la taxe (ex. client établi dans un autre État de l'Union : à confirmer) | 242 nonies A, I-13° ; BOI-TVA-GEO-20-40 § 30 |
| Nature des opérations (« prestations de services ») | Oui pour les factures émises à partir du 01/09/2027 (PME) ; possible dès maintenant | Idem | 242 nonies A, I-8° bis |
| Adresse de livraison des biens si elle diffère de celle du client | Non concerné (services) | À confirmer (le texte vise les livraisons de biens) | 242 nonies A, I-7° bis |
| « Option pour le paiement de la taxe d'après les débits » | Seulement si l'option est exercée (obligatoire au 01/09/2027 pour une PME, conseillée avant) | Idem | 242 nonies A, I-11° bis ; BOI-TVA-DECLA-30-20-20-30 §§ 310-320 |
| Date à laquelle le règlement doit intervenir | Recommandé (« payée le … ») | Oui | L441-9 I |
| Conditions d'escompte ; à défaut « Escompte pour paiement anticipé : néant » | Recommandé | Oui | L441-9 I ; fiche DILA F31808 |
| Taux des pénalités de retard | Non requis (règle entre professionnels) | Oui | L441-9 I ; L441-10 II |
| Indemnité forfaitaire pour frais de recouvrement : 40 € | Non (réservée aux professionnels) | Oui | L441-9 I ; L441-10 II ; D441-5 |
| Numéro du bon de commande du client, s'il en a émis un | Non requis | Oui | L441-9 I |
| Sur la facture finale : références des factures d'acompte | Non requis (pas de facture d'acompte obligatoire pour un particulier) | Oui | BOI-TVA-DECLA-30-20-20-10 § 60 |
| Sur un avoir ou une facture rectificative : numéro et date de la facture initiale, montant HT et TVA de la réduction | Oui | Oui | CGI art. 289, I-5 ; BOI-TVA-DECLA-30-20-20-20 §§ 220, 260 |
| Rédaction en français, montants en euros | Oui | Oui | Loi n° 94-665 art. 2 ; CGI art. 289, IV ; C. com. L123-22 |

**Factures des particuliers.** Elles sont volontaires (F4). Aucun texte ne dit expressément si l'amende de 15 € par mention manquante s'applique à une facture volontaire (F25 et point A20). Le référentiel retient la prudence : toutes les mentions de l'article 242 nonies A figurent aussi sur les factures des particuliers. La mention de garantie légale de conformité ne concerne que certaines catégories de biens (fiche DILA F31808) ; elle ne s'applique pas aux services d'Expedîle.

#### F1 — Facturer tout client professionnel

- **Règle.** Toute prestation rendue à un autre assujetti, ou à une personne morale même non assujettie, donne lieu à une facture. Si un tiers (plateforme, client) l'émet matériellement, c'est par mandat, au nom et pour le compte d'Expedîle France, qui reste tenue de l'obligation.
- **Chez Expedîle.** Chaque dossier d'un client professionnel (société, entrepreneur individuel, association, collectivité) reçoit une facture d'Expedîle France.
- **Base légale.** CGI art. 289, I-1-a et I-2 (version en vigueur depuis le 31/12/2023, loi n° 2023-1322 art. 91). L'article est abrogé le 01/01/2027 et repris au CIBS (art. L. 216-30 pour cette obligation), sauf ses I-3, IV et VII, maintenus jusqu'à leur reprise réglementaire.
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413
- **Citation.** « Tout assujetti est tenu de s'assurer qu'une facture est émise, par lui-même, ou en son nom et pour son compte, par son client ou par un tiers : a. Pour les livraisons de biens ou les prestations de services qu'il effectue pour un autre assujetti, ou pour une personne morale non assujettie, et qui ne sont pas exonérées en application des articles 261 à 261 E ; »
- **Fiabilité.** Élevée.

#### F2 — Une exonération ne dispense pas de facturer

- **Règle.** Seules les exonérations des articles 261 à 261 E dispensent de facture. Les opérations exonérées sur un autre fondement, notamment l'article 262 (exportations et transports liés) ou 263, se facturent avec toutes les mentions, dont la référence de l'exonération.
- **Chez Expedîle.** Le transport exonéré vers les DOM (T4) se facture aux professionnels comme n'importe quelle prestation, avec la mention de l'exonération.
- **Base légale.** BOI-TVA-DECLA-30-20-10-10 § 10, remarque 1 (version en vigueur depuis le 22/12/2021).
- **Source.** https://bofip.impots.gouv.fr/bofip/13242-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-10-20211222
- **Citation.** « les opérations situées sur le territoire français et exonérées de TVA sur un autre fondement, en particulier sur celui de l'article 262 du CGI, de l'article 262 bis du CGI, de l'article 262 ter du CGI et de l'article 263 du CGI ; »
- **Fiabilité.** Élevée.

#### F3 — Obligation commerciale : facture délivrée dès la prestation

- **Règle.** Toute prestation achetée pour une activité professionnelle est facturée. Le vendeur délivre la facture dès la réalisation de la prestation ; l'acheteur doit la réclamer. Tout manquement : amende administrative jusqu'à 75 000 € (personne physique) ou 375 000 € (personne morale), doublée en cas de réitération dans les deux ans.
- **Chez Expedîle.** S'ajoute à F1 pour les professionnels et fixe le moment de la facture (F12).
- **Base légale.** C. com. art. L441-9, I al. 1-2 et II (version du 26/04/2019 au 01/01/2027). La version au 01/01/2027 (ordonnance n° 2026-671 art. 2) garde les mêmes obligations et renvoie au CIBS (lu à travers une paraphrase de l'outil pour ce dernier point).
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414397
- **Citation.** « Le vendeur est tenu de délivrer la facture dès la réalisation de la livraison ou de la prestation de services au sens du 3 du I de l'article 289 du code général des impôts. L'acheteur est tenu de la réclamer. »
- **Fiabilité.** Élevée.

#### F4 — Particuliers : facture volontaire, mais c'est une vraie facture

- **Règle.** La loi fiscale n'impose pas de facture aux particuliers pour ces prestations ; l'administration conseille d'en remettre une en cas de doute sur le statut du client. Tout document délivré dans les conditions de l'article 289 est une facture, quel que soit son nom (note, quittance, relevé, compte rendu).
- **Chez Expedîle.** La facture remise à chaque particulier est volontaire, mais doit être exacte, numérotée et conservée comme toute facture. Un reçu, un relevé ou un avoir qui porte les mentions d'une facture est traité comme une facture.
- **Base légale.** BOI-TVA-DECLA-30-20-10-10 § 20 (22/12/2021) ; BOI-TVA-DECLA-30-20-10, introduction (version en vigueur depuis le 13/08/2021).
- **Sources.** https://bofip.impots.gouv.fr/bofip/13242-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-10-20211222 ; https://bofip.impots.gouv.fr/bofip/1525-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-20210813
- **Citation.** « Constitue une facture tout document délivré dans les conditions prévues par l'article 289 du code général des impôts (CGI), notamment au regard des mentions obligatoires, quelle que soit la qualification donnée à ce document par les parties (quittance, note, relevé, compte-rendu, etc.). »
- **Fiabilité.** Élevée.

#### F5 — Note due au particulier (droit de la consommation)

- **Règle.** Toute prestation d'au moins 25 € TTC donne lieu à une note remise dès que la prestation est rendue et, en tout cas, avant le paiement du prix ; en dessous de 25 €, sur demande. La note mentionne : la date de rédaction ; le nom et l'adresse du prestataire ; le nom du client, sauf opposition ; la date et le lieu d'exécution ; le décompte détaillé (dénomination, prix unitaire, unité, quantité) ; le total HT et TTC. Le décompte détaillé devient facultatif si un devis descriptif et détaillé a été accepté avant l'exécution et correspond à la prestation exécutée. La note est établie en double ; le double est conservé deux ans, classé par date.
- **Chez Expedîle.** La facture du particulier peut tenir lieu de note si elle porte ces mentions. Le particulier payant avant le départ, le moment de remise de la note pose question (A2) : le devis enregistré, s'il est descriptif, détaillé et conforme à la facture, dispense du décompte détaillé, pas du moment de remise.
- **Base légale.** Arrêté n° 83-50/A du 3 octobre 1983 : art. 1 (version en vigueur depuis le 09/09/2010), art. 3 et art. 4 (versions en vigueur depuis le 04/10/1983).
- **Sources.** https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032459001 ; https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032459003 ; https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032459004
- **Citation.** « Toute prestation de service doit faire l'objet, dès qu'elle a été rendue et en tout état de cause avant paiement du prix, de la délivrance d'une note lorsque le prix de la prestation est supérieur ou égal à 25 € (TVA comprise). »
- **Fiabilité.** Élevée pour le texte ; application aux prestations payées d'avance à confirmer (A2).

#### F6 — Mentions fiscales de toute facture

- **Règle.** L'article 242 nonies A fixe les mentions : identité, SIREN et adresse des deux parties ; numéro de TVA du vendeur ; date d'émission ; numéro ; par prestation, quantité, dénomination précise, prix unitaire HT et taux ou exonération ; rabais acquis ; date de l'opération si elle diffère ; totaux par taux ; référence de l'exonération ; « Autoliquidation » si le client est redevable. La dénomination doit identifier la prestation : des termes génériques sans référence ne suffisent pas.
- **Chez Expedîle.** Une ligne par prestation : transport (base, poids taxable, prix au kilo), stockage, reconditionnement, chaque frais, avec son taux ou son exonération. La désignation cite le dossier et la destination, par exemple « Transport Paris – La Réunion, dossier EXP-…, 12,4 kg taxables ».
- **Base légale.** CGI ann. II art. 242 nonies A, I (version en vigueur depuis le 01/01/2025, décret n° 2024-1195) ; BOI-TVA-DECLA-30-20-20-10 §§ 140, 160, 190 (version en vigueur depuis le 18/10/2013).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276 ; https://bofip.impots.gouv.fr/bofip/140-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-10-20131018
- **Citation.** « Pour chacun des biens livrés ou des services rendus, la quantité, la dénomination précise, le prix unitaire hors taxes et le taux de taxe sur la valeur ajoutée légalement applicable ou, le cas échéant, le bénéfice d'une exonération » ; « ce qui exclut l'emploi de termes génériques non suivis de références ».
- **Fiabilité.** Élevée.

#### F7 — Facture simplifiée : deux dispenses seulement

- **Règle.** Une facture de 150 € HT ou moins, et toute facture rectificative quel que soit son montant, peut omettre seulement le numéro de TVA du vendeur (2°) et la référence de l'exonération (12°). Toutes les autres mentions restent obligatoires.
- **Chez Expedîle.** Proposition : ne pas utiliser cette dispense, pour que la mention d'exonération figure sur toutes les factures et avoirs ; un contrôleur voit ainsi le fondement de chaque ligne sans TVA.
- **Base légale.** CGI ann. II art. 242 nonies A, II ; BOI-TVA-DECLA-30-20-20-20 §§ 20 et 180 (version en vigueur depuis le 19/01/2022).
- **Source.** https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20220119
- **Citation.** « les factures dont le montant total hors taxes est inférieur ou égal à 150 euros peuvent ne pas comporter les mentions suivantes : »
- **Fiabilité.** Élevée.

#### F8 — Quatre nouvelles mentions de la réforme et leurs dates

- **Règle.** La réforme ajoute : le SIREN du client lorsqu'il s'agit d'une entreprise ; l'adresse de livraison des biens si elle diffère de celle du client ; la nature des opérations (biens, services ou les deux) ; la mention « Option pour le paiement de la taxe d'après les débits » si le prestataire a opté. Elles s'appliquent aux factures émises à partir du 01/09/2026, ou du 01/09/2027 pour les PME et micro-entreprises non membres d'un assujetti unique, tant pour les opérations facturées électroniquement que pour celles qui relèvent de l'e-reporting. La date dépend de la taille de l'émetteur, Expedîle France, et non du client.
- **Chez Expedîle.** Si Expedîle France est une PME : obligatoires au 01/09/2027. Le modèle de facture peut déjà imprimer « Prestations de services » et le SIREN des clients professionnels. La mention des débits dépend de l'option (Q3). L'adresse de livraison des biens ne paraît pas viser un transport (A21).
- **Base légale.** CGI ann. II art. 242 nonies A, I-1°, 7° bis, 8° bis, 11° bis (décret n° 2022-1299) ; notes d'application sous l'article (décret n° 2022-1299 art. 3, modifié par le décret n° 2024-266 art. 2) ; fiche DILA « Mentions obligatoires sur une facture » (vérifiée le 11/08/2026).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276 ; https://entreprendre.service-public.gouv.fr/vosdroits/F31808
- **Citation.** « Pour les opérations mentionnées à l'article 289 bis du code général des impôts, les dispositions du présent article dans sa rédaction issue de l'article 1er du décret précité s'appliquent aux factures émises à compter du 1er septembre 2026. » ; « Toutefois, cette date est portée au 1er septembre 2027 pour les assujettis relevant des catégories d'entreprises mentionnées au second alinéa du I. »
- **Fiabilité.** Élevée.

#### F9 — Mentions commerciales des factures aux professionnels

- **Règle.** La facture à un professionnel mentionne : le nom et l'adresse des parties et l'adresse de facturation si elle diffère ; la date de la prestation ; quantité, dénomination précise et prix unitaire HT ; toute réduction de prix acquise ; le numéro du bon de commande si l'acheteur en a établi un ; la date de règlement ; les conditions d'escompte ; le taux des pénalités de retard ; l'indemnité forfaitaire pour frais de recouvrement, fixée à 40 €. Sauf accord, le taux des pénalités est celui de la dernière opération de refinancement de la Banque centrale européenne majoré de 10 points ; un taux convenu ne peut être inférieur à trois fois le taux d'intérêt légal ; les pénalités sont dues sans rappel. Faute d'escompte, la fiche officielle conseille « Escompte pour paiement anticipé : néant ».
- **Chez Expedîle.** Les factures professionnelles portent l'échéance, l'escompte (ou « néant »), le taux des pénalités prévu aux conditions générales, l'indemnité de 40 € et le bon de commande du client si celui-ci en fournit un.
- **Base légale.** C. com. art. L441-9, I (version du 26/04/2019 au 01/01/2027) ; L441-10, II (même période) ; D441-5 (version en vigueur depuis le 27/02/2021) ; fiche DILA F31808.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414397 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414392 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043197457 ; https://entreprendre.service-public.gouv.fr/vosdroits/F31808
- **Citation.** « La facture mentionne la date à laquelle le règlement doit intervenir. » ; « Le montant de l'indemnité forfaitaire pour frais de recouvrement prévue au II de l'article L. 441-10 est fixé à 40 euros. »
- **Fiabilité.** Élevée.

#### F10 — Identité de la société sur les factures, devis et reçus

- **Règle.** Toute personne immatriculée indique sur ses factures, notes de commande, tarifs, documents publicitaires, correspondances et récépissés : son numéro unique d'identification (SIREN), la mention « RCS » suivie de la ville du greffe, et le lieu de son siège social. Une société commerciale indique en outre sa forme juridique et le montant de son capital. Une omission est une contravention de 4e classe.
- **Chez Expedîle.** Ces mentions figurent sur les factures, et aussi sur les devis PDF, les reçus et les courriers du portail. Le devis PDF actuel ne les porte pas.
- **Base légale.** C. com. art. R123-237 (version en vigueur depuis le 15/05/2022, décret n° 2022-725) ; art. R123-238 (en vigueur depuis le 27/03/2007).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045710304 ; https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000005634379/LEGISCTA000006178891/
- **Citation.** « Toute personne immatriculée indique sur ses factures, notes de commande, tarifs et documents publicitaires ainsi que sur toutes correspondances et tous récépissés concernant son activité et signés par elle ou en son nom : 1° Le numéro unique d'identification de l'entreprise délivré conformément à l'article D. 123-235 ; 2° La mention RCS suivie du nom de la ville où se trouve le greffe où elle est immatriculée ; 3° Le lieu de son siège social ; »
- **Fiabilité.** Élevée.

#### F11 — Numérotation unique, chronologique et continue

- **Règle.** Chaque facture, factures d'acompte et avoirs compris, porte un numéro unique fondé sur une séquence chronologique et continue. Plusieurs séries sont permises lorsque l'activité le justifie, et chaque série doit être utilisée conformément à sa justification. Selon la doctrine : numéros attribués dans l'ordre d'émission, sans rupture, et deux factures émises la même année ne peuvent jamais porter le même numéro ; un préfixe par série est conseillé. Des catégories de clients aux règles différentes (assujettis et particuliers) ou des modes d'émission différents (électronique, papier) justifient des séries distinctes ; des clients établis dans plusieurs territoires ne justifient pas, à eux seuls, une série par destination. Un numéro n'est jamais réutilisé : une facture refusée par l'acheteur et réémise prend un nouveau numéro.
- **Chez Expedîle.** Deux séries proposées, particuliers et professionnels, avec préfixe et année dans le numéro (section 4, I3). Numéro attribué au serveur à l'émission, jamais à un brouillon ; jamais supprimé ni réutilisé. Le document douanier de départ n'utilise pas ces séries.
- **Base légale.** CGI ann. II art. 242 nonies A, I-7° ; BOI-TVA-DECLA-30-20-20-10 §§ 70 à 110 ; DGFiP, « Facturation électronique : guide pratique de démarrage au 1er septembre 2026 » (juillet 2026), question 12.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276 ; https://bofip.impots.gouv.fr/bofip/140-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-10-20131018 ; https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/guide_pratique_facturation_electronique.pdf
- **Citation.** « 7° Un numéro unique basé sur une séquence chronologique et continue ; la numérotation peut être établie dans ces conditions par séries distinctes lorsque les conditions d'exercice de l'activité de l'assujetti le justifient ; l'assujetti doit faire des séries distinctes un usage conforme à leur justification initiale » ; « que le dispositif retenu au sein de l'entreprise garantisse que deux factures émises la même année ne puissent pas porter le même numéro ».
- **Fiabilité.** Élevée. Moyenne pour la remise à zéro annuelle du compteur : elle se déduit de « la même année », aucun texte ne la prévoit expressément ; mettre l'année dans le numéro supprime le doute.

#### F12 — Moment d'émission et date de réalisation

- **Règle.** La facture est en principe émise dès la réalisation de la prestation ; aucun délai n'est prévu, sauf les quelques jours que justifie la gestion administrative. La date de la facture est sa date de délivrance ou, pour une facture électronique, d'émission. La date de réalisation ou d'achèvement de la prestation (ou de versement de l'acompte) figure sur la facture lorsqu'elle est déterminée et différente de la date d'émission.
- **Chez Expedîle.** L'émission à la confirmation du départ suppose de définir dans les conditions générales ce qu'est la prestation et quand elle est achevée : départ, arrivée ou livraison (Q15, A1). Si elle s'achève à l'arrivée ou à la livraison, la facture émise au départ précède l'achèvement ; la date d'achèvement est alors imprimée dès qu'elle est déterminée.
- **Base légale.** CGI art. 289, I-3 ; BOI-TVA-DECLA-30-20-10-40 §§ 1 et 10 (version en vigueur depuis le 13/08/2021) ; CGI ann. II art. 242 nonies A, I-6° et I-10° ; BOI-TVA-DECLA-30-20-20-10 §§ 140 et 160 ; C. com. L441-9, I.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://bofip.impots.gouv.fr/bofip/13245-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-40-20210813
- **Citation.** « La facture est, en principe, émise dès la réalisation de la livraison ou de la prestation de services. » ; « Un différé de la facturation est admis à titre général s'il ne dépasse pas les quelques jours que peuvent justifier les nécessités de la gestion administrative des entreprises. »
- **Fiabilité.** Élevée pour la règle ; moyenne pour la date d'achèvement chez Expedîle.

#### F13 — Facture périodique des professionnels

- **Règle.** Une facture unique peut couvrir plusieurs prestations distinctes rendues au même client lorsque la taxe devient exigible au cours d'un même mois civil ; elle est établie au plus tard à la fin de ce mois, avec une tolérance de quelques jours. Chaque opération y figure ligne par ligne avec sa date. Le délai de paiement convenu ne peut alors dépasser 45 jours après la date de la facture.
- **Chez Expedîle.** Possible pour les professionnels à terme : une facture par mois, une ligne par dossier datée. Pour des services, la taxe est exigible à l'encaissement sauf option pour les débits (F15) ; appliquer le critère du « même mois » est donc délicat (A23). Pratique prudente : facture à la fin du mois des prestations réalisées. Si Expedîle est commissionnaire de transport, le plafond de 30 jours de F24 prime.
- **Base légale.** CGI art. 289, I-3, al. 3 ; BOI-TVA-DECLA-30-20-10-40 §§ 100-110 ; C. com. L441-10, I al. 4.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://bofip.impots.gouv.fr/bofip/13245-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-40-20210813 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414392
- **Citation.** « Elle peut être établie de manière périodique pour plusieurs livraisons de biens ou prestations de services distinctes réalisées au profit d'un même acquéreur ou preneur pour lesquelles la taxe devient exigible au cours d'un même mois civil. Cette facture est établie au plus tard à la fin de ce même mois. »
- **Fiabilité.** Élevée pour la règle ; moyenne pour son application à des services exigibles à l'encaissement.

#### F14 — Acomptes des professionnels

- **Règle.** Une facture est due pour chaque acompte qu'un client professionnel verse avant la prestation, que cet acompte rende ou non la TVA exigible. Elle est numérotée et datée ; elle peut omettre les mentions encore inconnues (date exacte, quantité ou prix variables) ; la facture définitive renvoie aux factures d'acompte. Il n'existe pas d'obligation fiscale de facturer les acomptes des particuliers. Les factures d'acompte entrent dans la facturation électronique (E4).
- **Chez Expedîle.** Un professionnel qui paie son devis avant le départ (PayPlug, virement) reçoit une facture d'acompte à l'encaissement, puis la facture finale à la confirmation du départ, qui renvoie à l'acompte et affiche un solde nul.
- **Base légale.** CGI art. 289, I-1-c ; BOI-TVA-DECLA-30-20-10-10 § 120 ; BOI-TVA-DECLA-30-20-20-10 § 60 ; BOI-TVA-DECLA-30-20-20-20 §§ 160-170.
- **Sources.** https://bofip.impots.gouv.fr/bofip/13242-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-10-20211222 ; https://bofip.impots.gouv.fr/bofip/140-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-10-20131018 ; https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20220119
- **Citation.** « Une facture doit donc être délivrée pour tous les versements d’acomptes effectués dans le cadre des opérations visées au a et au b du 1 du I de l'article 289 du CGI, et non pas pour les seules opérations pour lesquelles ces versements entraînent l’exigibilité de la TVA. » ; « la facture définitive doit faire référence aux différentes factures d'acomptes. »
- **Fiabilité.** Élevée.

#### F15 — Exigibilité de la TVA sur les prestations

- **Règle.** Le fait générateur est l'exécution de la prestation, mais la TVA devient exigible à l'encaissement des acomptes, du prix ou de la rémunération, sauf option pour le paiement d'après les débits.
- **Chez Expedîle.** Un paiement PayPlug reçu d'un particulier avant le départ rend exigible la TVA des lignes taxables au jour du paiement, alors que la facture vient plus tard. La plupart des lignes sont exonérées (2.2) ; la règle compte pour les lignes taxables (marchandises qui ne partent pas, T13).
- **Base légale.** CGI art. 269, 1-a et 2-c (version en vigueur depuis le 01/01/2023, loi n° 2021-1900 art. 30). Abrogé au 01/01/2027 sauf les premier et dernier alinéas du 2-c, maintenus ; repris au CIBS.
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006309449
- **Citation.** « c) Pour les prestations de services autres que celles visées au b bis, lors de l'encaissement des acomptes, du prix, de la rémunération ou, sur option du redevable, d'après les débits. »
- **Fiabilité.** Élevée pour la règle ; moyenne pour la conséquence, qui suppose une ligne taxable en France.

#### F16 — Avoirs et factures rectificatives

- **Règle.** Tout document qui modifie une facture et y renvoie de façon spécifique et non équivoque est une facture : il porte toutes les mentions et son propre numéro. Une facture émise ne se corrige jamais : soit une nouvelle facture l'annule et la remplace (référence exacte et mention expresse de l'annulation), soit un avoir cite le numéro et la date de la facture initiale, le montant HT de la réduction et la TVA correspondante. Seules les mentions 2° et 12° peuvent manquer. La TVA d'une opération annulée, résiliée ou impayée définitivement n'est imputée ou restituée qu'après rectification préalable de la facture.
- **Chez Expedîle.** Toute annulation, réduction de prix ou remboursement (PayPlug ou manuel) passe par un avoir numéroté, émis avant le remboursement et avant toute régularisation de TVA dans la déclaration.
- **Base légale.** CGI art. 289, I-5 ; BOI-TVA-DECLA-30-20-20-20 §§ 210 à 260 ; CGI art. 272, 1 (version en vigueur depuis le 01/01/2016 ; repris au CIBS au 01/01/2027 à droit constant).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20220119 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031817248
- **Citation.** « Tout document ou message qui modifie la facture initiale, émise en application de cet article, et qui fait référence à la facture initiale de façon spécifique et non équivoque est assimilé à une facture. » ; « L'imputation ou la restitution est subordonnée à la justification, auprès de l'administration, de la rectification préalable de la facture initiale. »
- **Fiabilité.** Élevée.

#### F17 — Facture impayée : elle ne se modifie pas

- **Règle.** La dette du client défaillant subsiste ; la facture initiale ne doit pas être modifiée. La récupération de la TVA déjà versée passe par un duplicata portant la mention réglementaire de facture impayée, ou par un état récapitulatif des factures impayées.
- **Chez Expedîle.** Une facture professionnelle impayée reste telle quelle ; l'application produit le duplicata ou l'état récapitulatif, jamais une facture modifiée.
- **Base légale.** BOI-TVA-DECLA-30-20-20-20 §§ 300 à 330.
- **Source.** https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20220119
- **Citation.** « En effet, la dette du client défaillant subsiste et la facture initiale produite par le fournisseur créancier ne doit pas être modifiée. »
- **Fiabilité.** Élevée.

#### F18 — Authenticité, intégrité, lisibilité : interdiction de modifier

- **Règle.** L'authenticité de l'origine, l'intégrité du contenu et la lisibilité de la facture sont assurées de l'émission à la fin de la conservation. L'intégrité signifie qu'aucune mention, obligatoire ou non, de la facture d'origine n'a été modifiée. Une facture électronique se conserve dans le format où elle a été émise et transmise (par exemple le Factur-X tel qu'envoyé) ; une copie convertie n'est admise, pour la gestion, qu'à côté de l'original. Ni les factures ni les éléments des contrôles ne changent pendant toute la conservation. Les documents comptables sont tenus « sans blanc ni altération ».
- **Chez Expedîle.** Une facture émise (données et fichier) est immuable : fichier enregistré une seule fois sous un nouveau chemin, empreinte SHA-256 conservée, jamais régénéré ni écrasé. Tout nouveau rendu est une copie (F20).
- **Base légale.** CGI art. 289, V ; BOI-TVA-DECLA-30-20-30-10 § 100 (version en vigueur depuis le 07/02/2018) ; BOI-CF-COM-10-10-30 §§ 180 et 300 (version en vigueur depuis le 03/09/2025) ; C. com. L123-22.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://bofip.impots.gouv.fr/bofip/8862-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-10-20180207 ; https://bofip.impots.gouv.fr/bofip/645-PGP.html/identifiant=BOI-CF-COM-10-10-30-20250903
- **Citation.** « Par « intégrité du contenu » de la facture, il faut entendre le fait que l'intégralité des mentions, obligatoires ou non, figurant sur la facture d'origine n'ont pas été modifiées. »
- **Fiabilité.** Élevée.

#### F19 — Facture électronique hors plateforme : acceptation du client

- **Règle.** Les factures électroniques sont émises sous une forme électronique quelconque et tiennent lieu d'original ; leur transmission ou mise à disposition suppose l'acceptation du destinataire. L'acceptation peut être tacite, par exemple quand le client paie la facture ou dispose d'un délai raisonnable pour demander du papier. Courriel, pièce jointe, site internet sécurisé ou EDI sont admis. Une facture n'est électronique que si tout le processus l'est : envoyée sur papier, c'est le papier qui fait foi. Pour les factures entre entreprises entrant dans la réforme, cette liberté cesse à la date d'obligation d'Expedîle (E1, E12).
- **Chez Expedîle.** Portail client, courriel ou Telegram jusqu'à la date d'obligation. Les conditions générales prévoient la facture électronique ; l'application enregistre l'acceptation (horodatage, version des conditions) ou le paiement qui la vaut.
- **Base légale.** CGI art. 289, VI ; BOI-TVA-DECLA-30-20-30-10 §§ 80, 180-190 et 240 ; CGI art. 289 bis, I.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://bofip.impots.gouv.fr/bofip/8862-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-10-20180207
- **Citation.** « Leur transmission et mise à disposition sont soumises à l'acceptation du destinataire. » ; « L’acceptation peut également se faire de manière tacite, par exemple lorsque l'acquéreur ou le preneur traite ou acquitte la facture reçue ou, à défaut, par l’octroi au destinataire des factures d’un délai raisonnable pour exiger une facture papier. »
- **Fiabilité.** Élevée. La clause des conditions générales est une recommandation, non une règle citée.

#### F20 — Double, duplicata et copie

- **Règle.** Le fournisseur conserve un double de chaque facture émise ; vendeur et acheteur en gardent chacun un exemplaire. Un double renvoyé par un autre canal est clairement rattaché à la facture initiale et marqué « duplicata », « copie » ou « copie de continuité », pour ne jamais passer pour une nouvelle facture.
- **Chez Expedîle.** Le portail présente le document numéroté d'origine. Toute réexpédition porte « Duplicata » et renvoie au numéro initial ; aucune nouvelle facture n'est générée pour un renvoi.
- **Base légale.** CGI art. 289, I-4 ; C. com. L441-9, I al. 3 ; guide DGFiP (juillet 2026), question 15.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/guide_pratique_facturation_electronique.pdf
- **Citation.** « L'assujetti doit conserver un double de toutes les factures émises. » ; « En pratique, il est possible de l’identifier par une mention de type “duplicata”, “copie” ou “copie de continuité”. »
- **Fiabilité.** Élevée.

#### F21 — Langue et devise

- **Règle.** Le français est obligatoire dans les factures et quittances. Les montants peuvent être exprimés dans toute monnaie si la taxe est déterminée en euros ; l'administration peut exiger une traduction en français, certifiée le cas échéant. Les documents comptables sont établis en euros et en français.
- **Chez Expedîle.** Factures et avoirs en français et en euros.
- **Base légale.** Loi n° 94-665 du 4 août 1994, art. 2 (version en vigueur depuis le 05/03/1995) ; CGI art. 289, IV ; BOI-TVA-DECLA-30-20-20-10 §§ 380, 420-430 ; C. com. L123-22.
- **Sources.** https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006421210 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006219327
- **Citation.** « Dans la désignation, l'offre, la présentation, le mode d'emploi ou d'utilisation, la description de l'étendue et des conditions de garantie d'un bien, d'un produit ou d'un service, ainsi que dans les factures et quittances, l'emploi de la langue française est obligatoire. »
- **Fiabilité.** Élevée.

#### F22 — Durée de conservation : dix ans

- **Règle.** Fiscalement, les livres, registres, documents et pièces se conservent six ans selon le texte en vigueur au 10/10/2026, sous forme électronique s'ils ont été établis ou reçus sous cette forme. Au 01/01/2027, la durée passe à dix ans pour tous les documents dont la conservation expire après cette date ; le I bis (six ans pour les contrôles de la piste d'audit et leur documentation) est abrogé. Commercialement, les documents comptables et pièces justificatives se conservent dix ans. La documentation des traitements informatiques se conserve jusqu'à la fin de la troisième année suivant celle à laquelle elle se rapporte. Les documents douaniers se conservent six ans (C. douanes) et au moins trois ans (CDU). Le double de la note au consommateur se conserve deux ans.
- **Chez Expedîle.** Dix ans pour tout : factures, avoirs, devis et leurs versions, accords des clients, paiements, dossiers de départ et pièces douanières, documentation de la piste d'audit, grilles de taux, journaux d'audit. Les originaux électroniques restent électroniques. Aucune purge avant dix ans.
- **Base légale.** LPF art. L102 B, I et II (version du 01/01/2023 au 01/01/2027) ; LPF art. L102 B (version à partir du 01/01/2027, loi n° 2026-534 du 25 juin 2026 art. 36) ; C. com. L123-22 ; C. douanes art. L421-11 (en vigueur depuis le 01/05/2026) ; CDU art. 51(1) ; arrêté 83-50/A art. 4.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046869194 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054566874/2027-01-02 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006219327 ; https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006071570/LEGISCTA000053805942/
- **Citation.** « Les livres, registres, documents ou pièces sur lesquels peuvent s'exercer les droits de communication, d'enquête et de contrôle de l'administration sont conservés pendant un délai de dix ans » ; « Conformément au II de l'article 36 de la loi n° 2026-534 du 25 juin 2026, ces dispositions, dans leur rédaction issue du I de l'article 36 précité, s'appliquent aux documents et aux pièces dont le délai de conservation expire après le 1er janvier 2027. »
- **Fiabilité.** Élevée. Les versions 2027 sont consolidées par avance et peuvent encore être ajustées avant le 01/01/2027 (A36).

#### F23 — Forme et lieu de conservation

- **Règle.** Les factures se conservent sous leur forme et leur format d'origine. Les factures électroniques peuvent être stockées en France, dans un autre État de l'Union, ou hors de l'Union seulement dans un pays lié à la France par une convention d'assistance mutuelle ou offrant un droit d'accès en ligne immédiat, de téléchargement et d'utilisation. L'administration doit disposer d'un accès en ligne permettant le téléchargement, depuis le siège ou le principal établissement. Un stockage hors de France se déclare avec la déclaration de résultats, sur papier libre adressé au SIE, avec les noms et adresses des prestataires de stockage et les périodes couvertes. Les factures papier restent en France. À partir du 01/01/2027, l'article L102 B bis du LPF reprend l'exigence d'authenticité, d'intégrité et de lisibilité pendant toute la conservation ; un décret listera des procédés réputés conformes.
- **Chez Expedîle.** Documenter la région du projet Supabase (base, fichiers, sauvegardes) et de Vercel (Q13) ; déclarer le lieu de stockage s'il est hors de France ; garantir un accès en lecture pour l'administration (C5, I12).
- **Base légale.** LPF art. L102 C (version du 31/03/2017 au 01/01/2027 ; la version 2027 garde les trois premiers alinéas) ; BOI-CF-COM-10-10-30 §§ 180, 370 à 460 ; LPF art. L102 B bis (créé par l'ordonnance n° 2026-671, en vigueur au 01/01/2027) ; CIBS art. L. 216-38 (au 01/01/2027).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033815236 ; https://bofip.impots.gouv.fr/bofip/645-PGP.html/identifiant=BOI-CF-COM-10-10-30-20250903 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054566884/2027-01-02
- **Citation.** « Les assujettis sont tenus de déclarer, en même temps que leur déclaration de résultats ou de bénéfices, le lieu de stockage de leurs factures ainsi que toute modification de ce lieu lorsque celui-ci est situé hors de France. »
- **Fiabilité.** Élevée.

#### F24 — Délais de paiement des professionnels

- **Règle.** Par défaut, 30 jours après l'exécution de la prestation ; au plus 60 jours après la date de la facture, ou 45 jours fin de mois si c'est expressément convenu ; 45 jours au plus pour une facture périodique. Pour la commission de transport, les activités de transitaire, d'agent maritime et de fret aérien, de courtier de fret et de commissionnaire en douane, le délai ne peut dépasser 30 jours après la date d'émission de la facture (règle maintenue dans la version au 01/01/2027). Amende administrative jusqu'à 75 000 € (personne physique) ou 2 M€ (personne morale) ; 150 000 € et 4 M€ en cas de réitération dans les deux ans.
- **Chez Expedîle.** L'application propose « Paiement à 30 jours » et « Paiement en fin de mois ». Si Expedîle est commissionnaire de transport (Q6, A19), seuls conviennent 30 jours à compter de la date de facture ou la fin du mois d'émission ; une formule « 30 jours fin de mois » dépasserait le plafond. Jusqu'à confirmation, retenir 30 jours date de facture au plus.
- **Base légale.** C. com. art. L441-10, I (version du 26/04/2019 au 01/01/2027) ; L441-11, II-5° (version du 01/01/2024 au 01/01/2027, maintenu à l'identique au 01/01/2027) ; L441-16 (version en vigueur depuis le 01/11/2021).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414392 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048639492 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043750778
- **Citation.** « Trente jours après la date d'émission de la facture pour le transport routier de marchandises, pour la location de véhicules avec ou sans conducteur, pour la commission de transport ainsi que pour les activités de transitaire, d'agent maritime et de fret aérien, de courtier de fret et de commissionnaire en douane »
- **Fiabilité.** Élevée pour les textes ; moyenne pour la qualification d'Expedîle.

#### F25 — Sanctions des factures

- **Règle.** Ne pas délivrer une facture et ne pas comptabiliser la transaction : amende de 50 % de la transaction (plafond 375 000 € par exercice, client professionnel solidaire), réduite à 5 % (plafond 37 500 €) si la transaction a été comptabilisée ; ces amendes ne s'appliquent pas aux prestations fournies à des particuliers, sauf les travaux immobiliers soumis à note. Délivrer une facture qui ne correspond pas à une prestation réelle : 50 %. Chaque omission ou inexactitude : 15 €, plafonnée au quart du montant de la facture. Pas d'amende pour une première infraction de l'année et des trois années précédentes réparée spontanément ou dans les 30 jours d'une première demande de l'administration (pour le 3 du I, le II, le III et le IV de l'article). S'y ajoutent les amendes commerciales de F3 et F24.
- **Chez Expedîle.** Contrôle automatique des mentions avant émission ; procédure de correction par avoir réalisable en moins de 30 jours (I5). Le risque de 50 % pour facture sans opération réelle vise surtout le document douanier de départ (D17).
- **Base légale.** CGI art. 1737, I-2°, I-3°, dernier alinéa du I, II et V (version du 21/02/2026 au 01/01/2027, loi n° 2026-103 art. 123 ; la version 2027 garde 15 € et l'exclusion des particuliers, lue à travers une paraphrase).
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546686
- **Citation.** « Toute omission ou inexactitude constatée dans les factures ou documents en tenant lieu mentionnés aux articles 289 et 290 quinquies donne lieu à l'application d'une amende de 15 €. » ; « Les dispositions des 1 à 3 ne s'appliquent pas aux ventes au détail et aux prestations de services faites ou fournies à des particuliers, à l'exception des prestations de services mentionnées à l'article 290 quinquies soumises à la délivrance d'une note. »
- **Fiabilité.** Élevée.

### 2.2 TVA des prestations d'Expedîle France

#### Tableau par ligne, destination et type de client

Taux utiles : 20 % en métropole (CGI art. 278) ; 8,5 % à La Réunion, en Guadeloupe et en Martinique (art. 296) ; pas de TVA à Mayotte (art. 294, 1). La loi ne prescrit aucune phrase d'exonération (T15) : les mentions ci-dessous sont des formulations proposées par les recherches, conformes à l'article 242 nonies A, I-12°. À partir du 01/01/2027, « art. 262, I-1° du CGI » peut devenir « art. L. 213-16 du CIBS » ; les renvois au CGI restent admis sur les factures jusqu'au 30/06/2028.

| N° | Ligne facturée | Destination et client | TVA | Mention à imprimer | Règles | Fiabilité |
|---|---|---|---|---|---|---|
| V1 | Transport porte-à-porte (base + prix au kilo) | 974, 971, 972 — particulier | Exonérée ; le droit à déduction est conservé | « Exonération de TVA – article 262, I-1° du CGI (transport à destination de La Réunion, art. 294, 2-1° du CGI) » ; « Guadeloupe » ou « Martinique » selon le cas | T3, T4, T5, T6 | Élevée |
| V2 | Transport | 974, 971, 972 — pro établi en métropole, en Guadeloupe, en Martinique ou à La Réunion | Exonérée ; pas d'autoliquidation ; Expedîle France reste redevable | Même mention que V1 | T2, T4 | Élevée |
| V3 | Transport | 976 — particulier | Partie métropolitaine exonérée ; partie à Mayotte non imposable | « Exonération de TVA – article 262, I-1° du CGI (transport à destination de Mayotte, art. 294, 2-1° du CGI) » ; pour un prix unique couvrant les deux parties : « Exonération de TVA – art. 262, I-1° du CGI (partie métropolitaine) ; TVA non applicable à Mayotte – art. 294, 1 du CGI » | T3, T4, T8 | Moyenne (pas de seconde base ; risque T8) |
| V4 | Transport | 976 — pro établi à Mayotte | Hors du champ de la TVA française (ce n'est pas une exonération) | « TVA non applicable – article 259, 1° du CGI (preneur assujetti établi à Mayotte, art. 294, 1 du CGI) » | T3 | Élevée (aucun libellé prescrit, A10) |
| V5 | Transport | 976 — pro établi en métropole, en Guadeloupe, en Martinique ou à La Réunion | Exonérée | « Exonération de TVA – article 262, I-1° du CGI (transport à destination de Mayotte, art. 294, 2-1° du CGI) » | T4 | Élevée |
| V6 | Stockage (y compris pendant une attente), manutention, mesure et pesée, reconditionnement, emballage, groupage, d'une marchandise effectivement expédiée | Toutes destinations — particulier, ou pro établi en métropole, en Guadeloupe, en Martinique ou à La Réunion | Exonérée si l'exportation est prouvée | « Exonération de TVA – article 262, I-1° du CGI » | T4, T7 | Élevée |
| V7 | Mêmes prestations | Pro établi à Mayotte | Hors champ | Même mention que V4 | T3 | Élevée |
| V8 | Formalités d'export facturées à part | Toutes | Exonérées comme service directement lié à l'exportation ou comme élément du prix du transport (le 6° de l'art. 73 G ne vise que les commissionnaires agréés en douane) | Mention de V1 ou V6 | T4, T12 | Moyenne |
| V9 | Petits frais compris dans le prix du transport (frais de paiement, emballage, manutention mineure) | Tous | Suivent le transport (exonérés) s'ils sont réellement accessoires | Mention du transport | T12 | Moyenne |
| V10 | Assurance facultative facturée en sus | Tous | Non accessoire ; à qualifier (opération d'assurance exonérée sans droit à déduction, art. 261 C 2°, si Expedîle est assureur ou intermédiaire) | À confirmer | T12, A8 | À confirmer |
| V11 | Frais d'une marchandise qui ne part pas (refus, abandon, retrait en métropole, retour au vendeur, destruction) | Particulier | Stockage et services généraux : 20 % ; manutention, reconditionnement : 20 % (exécutés en métropole) ; transport de retour en métropole : 20 % | Taux et montant de TVA | T13 | Moyenne |
| V12 | Mêmes frais | Pro établi en métropole | 20 % | Taux et montant de TVA | T13 | Moyenne |
| V13 | Mêmes frais | Pro établi en Guadeloupe, en Martinique ou à La Réunion | Stockage et services généraux : 8,5 % (taux du DOM du client), déclarée par Expedîle France ; manutention : 20 % (tolérance) ; stockage seul : 8,5 % ou 20 %, ambigu | Taux et montant de TVA | T13, A6 | Moyenne |
| V14 | Mêmes frais | Pro établi à Mayotte | Pas de TVA française | Même mention que V4 | T13 | Élevée |
| V15 | Prestations à destination facturées à part (dédouanement, livraison finale, stockage dans le DOM) | 974, 971, 972 | Exonérées seulement si leur valeur entre dans la base de la TVA à l'importation ; sinon 8,5 % lorsqu'elles sont exécutées dans le DOM. Mieux : les inclure dans le prix porte-à-porte exonéré | Selon le cas | T6, T14 | Moyenne |
| V16 | Mêmes prestations | 976 | Pas de TVA (exécutées à Mayotte) | « TVA non applicable à Mayotte – art. 294, 1 du CGI » | T1, T14 | Élevée |
| V17 | Abonnements | Tous | Prestation distincte (20 % pour un particulier) ou avance sur des prestations exonérées : non tranché | À confirmer | A7 | À confirmer |
| V18 | Montants « OM », « OMR » et « TVA » du devis (taxes à destination) | 974, 971, 972 ; OM seul à 976 | Ce n'est pas une TVA d'Expedîle France. Débours hors base si toutes les conditions de D11 sont réunies ; sinon élément du prix, qui suit l'exonération du transport. Jamais libellé « TVA » comme une TVA d'Expedîle France | Si débours : « Débours – droits et taxes à l'importation (octroi de mer, octroi de mer régional, TVA à l'importation [DOM]) acquittés en votre nom et pour votre compte – art. 267, II-2° du CGI » ; présentation à confirmer (D3, A13) | T16, D11, D13 | Élevée pour le risque ; formulation à confirmer |

#### T1 — Statut fiscal des DOM et taux

- **Règle.** La TVA s'applique en Guadeloupe, en Martinique et à La Réunion ; elle n'est provisoirement pas applicable en Guyane et à Mayotte. Expédier un bien de la métropole vers l'un de ces départements est une exportation ; son entrée en Guadeloupe, en Martinique ou à La Réunion est une importation. Le texte définit l'exportation par l'expédition elle-même, sans exiger de vente. Taux dans les trois DOM : 8,50 % (normal) et 2,10 % (réduit, pour une liste d'opérations où le transport de marchandises ne figure pas). Les lois de finances 2024, 2025 et 2026 n'ont pas modifié ces taux. Taux normal en métropole : 20 %.
- **Chez Expedîle.** Grille fiscale : 20 % (métropole), 8,5 % (971, 972, 974), aucune TVA (976).
- **Base légale.** CGI art. 294, 1, 2-1°, 3-2° et 3-3° (version du 01/01/2014 au 01/01/2027 ; repris aux art. L. 211-7 et L. 211-54 du CIBS) ; art. 296 (même période ; CIBS L. 213-151) ; art. 278.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027978194 ; https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006179660
- **Citation.** « 2. Pour l'application de la taxe sur la valeur ajoutée, est considérée comme exportation d'un bien : 1° L'expédition ou le transport d'un bien hors de France métropolitaine à destination des départements de la Guadeloupe, de la Guyane, de Mayotte, de la Martinique ou de la Réunion ; » ; « b) Au taux normal de 8,50 % dans les autres cas ; »
- **Fiabilité.** Élevée.

#### T2 — Pour les services, les DOM ne sont pas des territoires tiers : pas d'autoliquidation

- **Règle.** Pour les biens, les DOM sont des territoires tiers ; pour les services, la métropole et Guadeloupe, Martinique, La Réunion forment une seule « France ». Il n'y a donc jamais d'autoliquidation entre Expedîle France et un client professionnel établi dans ces trois DOM : Expedîle France reste redevable de toute TVA due.
- **Chez Expedîle.** Jamais de mention « Autoliquidation » pour un client des DOM ; si une ligne est taxable, Expedîle France la déclare et la paie.
- **Base légale.** BOI-TVA-GEO-20-40 §§ 20, 30 et 230 (version en vigueur depuis le 24/07/2024) ; BOI-TVA-DECLA-10-10-20 § 150 (version du 09/09/2026). La doctrine des DOM est dans la série BOI-TVA-GEO-20 (la série GEO-10 concerne la Corse).
- **Source.** https://bofip.impots.gouv.fr/bofip/792-PGP.html/identifiant=BOI-TVA-GEO-20-40-20240724
- **Citation.** « Aussi, les dispositions du 2 de l'article 283 du CGI ne sont pas applicables lorsque le preneur assujetti est établi en Guadeloupe, en Martinique ou à La Réunion et le prestataire en métropole, ce dernier étant dès lors le redevable de la taxe. »
- **Fiabilité.** Élevée.

#### T3 — Lieu des prestations

- **Règle.**
  - Client professionnel : lieu d'établissement du client (art. 259, 1°). Client établi à Mayotte : pas de TVA française.
  - Client particulier : lieu d'établissement du prestataire, donc la métropole pour Expedîle France (art. 259, 2°).
  - Transport de biens pour un particulier (hors transport intracommunautaire) : distance parcourue en France (art. 259 A, 4°), soit la partie métropolitaine et la partie dans le DOM pour 971, 972 et 974, et seulement la partie métropolitaine pour 976. L'article 259 B ne vise pas le transport de biens.
  - Chargement, déchargement, manutention, activités similaires et travaux sur des biens meubles pour un particulier : lieu d'exécution matérielle (art. 259 A, 6°).
  - Client professionnel établi en Guadeloupe, en Martinique ou à La Réunion : taux de son lieu d'établissement, sauf tolérance pour le transport, les activités accessoires au transport (chargement, déchargement, manutention, activités similaires) et les travaux sur biens meubles, taxés au taux du lieu d'exécution.
- **Chez Expedîle.** Ces règles donnent le taux lorsque l'exonération ne joue pas (lignes V11 à V16 du tableau).
- **Base légale.** CGI art. 259, 1° et 2° (version du 01/01/2010 au 01/01/2027 ; CIBS L. 211-92 et L. 211-93) ; art. 259 A, 4° et 6° (version du 01/01/2025 au 01/01/2027, loi n° 2023-1322 art. 83 ; CIBS L. 211-76 et L. 211-77) ; BOI-TVA-GEO-20-40 §§ 120 à 140, 180, 200 ; BOI-TVA-CHAMP-20-60-20 §§ 1, 320-330.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000021642728 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909954 ; https://bofip.impots.gouv.fr/bofip/792-PGP.html/identifiant=BOI-TVA-GEO-20-40-20240724
- **Citation.** « 4° Les prestations de transport de biens effectuées pour des personnes non assujetties autres que les transports intracommunautaires de biens et les prestations de transport de passagers, en fonction des distances parcourues en France ; » ; « Lorsque le preneur assujetti est établi en Guyane, à Mayotte ou à l'étranger, la TVA nationale n'est pas applicable. »
- **Fiabilité.** Élevée.

#### T4 — Exonération principale : transport et services directement liés à l'exportation

- **Règle.** Les prestations de services directement liées à l'exportation sont exonérées, avec maintien du droit à déduction. La liste réglementaire vise notamment : 1° les transports de marchandises à destination d'un département d'outre-mer et les commissions afférentes ; 2° le chargement, le déchargement et la manutention ; 4° le gardiennage et le magasinage ; 5° l'emballage des marchandises destinées à l'exportation ; 6° les opérations des commissionnaires agréés en douane inhérentes à l'exportation. La mesure s'applique quels que soient la qualité et le lieu d'établissement du client ; elle couvre le stockage pendant toute la période qui précède l'exportation, quelle qu'en soit la durée, ainsi que le mesurage, le pesage et le groupage ; elle suppose que les biens partent réellement. La doctrine des DOM du 02/09/2026 confirme l'exonération des transports aériens et maritimes de la métropole vers Guadeloupe, Martinique et La Réunion, des transports d'approche et des services liés autres que le transport.
- **Chez Expedîle.** Transport, mesures, reconditionnement, groupage et stockage avant départ (y compris pendant une attente choisie par le client, si l'expédition suit) sont exonérés pour les quatre destinations, pour les particuliers comme pour les professionnels, à condition que les marchandises partent et que l'exportation soit prouvée (T7). Si Expedîle n'est pas elle-même représentant en douane (Q24), des frais de formalités d'export reposent sur l'exonération générale ou sur leur qualité d'élément du prix du transport (T12), non sur le 6°.
- **Base légale.** CGI art. 262, I-1° (version du 01/01/2018 au 01/01/2027 ; CIBS L. 213-16) ; CGI ann. III art. 73 G (en vigueur depuis le 31/03/1999 ; reste en annexe après le 01/01/2027) ; BOI-TVA-GEO-20-20 § 100 (version du 02/09/2026) ; BOI-TVA-CHAMP-30-30-20-10 §§ 1, 40, 70, 80, 100, 210 (version du 04/11/2015).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033469152 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006296940 ; https://bofip.impots.gouv.fr/bofip/784-PGP.html/identifiant=BOI-TVA-GEO-20-20-20260902 ; https://bofip.impots.gouv.fr/bofip/967-PGP.html/identifiant=BOI-TVA-CHAMP-30-30-20-10-20151104
- **Citation.** « I. - Sont exonérées de la taxe sur la valeur ajoutée : 1° les livraisons de biens expédiés ou transportés par le vendeur ou pour son compte, en dehors de la Communauté européenne ainsi que les prestations de services directement liées à l'exportation ; » ; « La mesure s'applique aux prestations de services en cause effectuées pendant toute la période précédant l'exportation, quelle qu'en soit la durée. »
- **Fiabilité.** Élevée.

#### T5 — Partie du transport à l'intérieur de chaque DOM

- **Règle.** Depuis le 21/02/2026, les transports aériens et maritimes de personnes et de marchandises effectués dans les limites de la Guadeloupe, de la Martinique ou de La Réunion sont exonérés, avec droit à déduction (auparavant : transports maritimes seulement). La livraison routière n'est ni aérienne ni maritime.
- **Chez Expedîle.** La partie aérienne ou maritime à l'intérieur du DOM est couverte. La livraison finale par route repose sur l'exonération du transport porte-à-porte (T4) ou sur la seconde base (T6) : point A4.
- **Base légale.** CGI art. 295, 1-1° (version du 21/02/2026 au 01/01/2027, loi n° 2026-103 art. 100 ; CIBS L. 213-203) ; BOFiP ACTU-2026-00140 (02/09/2026).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053545643 ; https://bofip.impots.gouv.fr/doctrine/pgp/15171-PGP
- **Citation.** « 1° Les transports aériens et maritimes de personnes et de marchandises effectués dans les limites de chacun des départements de la Guadeloupe, de la Martinique et de la Réunion ; » ; « Cette disposition s'applique aux services fournis à compter du 21 février 2026. »
- **Fiabilité.** Élevée.

#### T6 — Seconde base pour 971, 972, 974 : prestation comprise dans la base de l'importation

- **Règle.** Les prestations se rapportant à l'importation dont la valeur est comprise dans la base d'imposition de l'importation sont exonérées : transport, commission, assurance et emballage jusqu'au premier lieu de destination, ou jusqu'à une destination ultérieure connue lors de l'importation. Un montant non compris dans cette base est taxable dans les conditions de droit commun. La preuve peut être une attestation du déclarant donnant le numéro, la date et le bureau de la déclaration d'importation. Cette base n'existe pas à Mayotte (pas de TVA à l'importation) et ne joue probablement pas lorsque le colis entre en franchise, faute de base d'importation (A5).
- **Chez Expedîle.** Base de repli pour 971, 972 et 974 si l'exonération T4 était contestée ; elle suppose que la valeur en douane déclarée inclue le transport (Q7, Q9).
- **Base légale.** CGI art. 262, II-14° (CIBS L. 213-27) et art. 292, 2° et 3° ; BOI-TVA-GEO-20-20 § 110 ; BOI-TVA-CHAMP-30-30-20-40 §§ 1, 20, 40 ; BOI-TVA-CHAMP-20-60-20 §§ 180-190.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033469152 ; https://bofip.impots.gouv.fr/bofip/936-PGP.html/identifiant=BOI-TVA-CHAMP-30-30-20-40-20120912 ; https://bofip.impots.gouv.fr/bofip/784-PGP.html/identifiant=BOI-TVA-GEO-20-20-20260902
- **Citation.** « 14° Les prestations de services se rapportant à l'importation de biens en France ou dans un autre Etat membre de la Communauté européenne et dont la valeur est comprise dans la base d'imposition de l'importation. »
- **Fiabilité.** Élevée pour le texte ; moyenne pour son application (dépend des déclarations).

#### T7 — Preuve de l'exportation

- **Règle.** L'exonération suppose la preuve, par tout moyen, que le transport porte sur des biens exportés ; l'administration apprécie les justificatifs sous le contrôle du juge. Le transporteur peut se faire remettre par le client, au plus tard lors de la facturation, une attestation de destination ; sans preuve, il acquitte la TVA. Le droit de l'Union interdit de subordonner l'exonération à la seule production de la déclaration d'exportation : l'administration doit examiner si l'exportation se déduit, avec une vraisemblance suffisante, de l'ensemble des éléments. Tout document de transport vers un DOM est une preuve admise pour l'exportation de biens. Tout envoi postal vers un DOM fait l'objet d'une déclaration en douane (CN23 obligatoire à partir de 400 €).
- **Chez Expedîle.** Pour chaque dossier, conserver la chaîne : ligne de facture → départ et manifeste → lettre de transport aérien ou connaissement → déclaration d'expédition en métropole → déclaration d'importation dans le DOM → preuve de livraison. L'application relie ces références à la facture (I14).
- **Base légale.** BOI-TVA-CHAMP-20-60-20 §§ 50, 140, 160 (version du 24/07/2024) ; BOI-TVA-CHAMP-30-30-20-10 § 150 ; CJUE, 8 novembre 2018, C-495/17, Cartrans Spedition ; CGI ann. III art. 74, 1-d-2° ; BOI-TVA-CHAMP-30-30-10-10 § 260 ; douane.gouv.fr, « Envoyer un colis à un particulier » (mise à jour du 03/08/2026).
- **Sources.** https://bofip.impots.gouv.fr/bofip/2269-PGP.html/identifiant=BOI-TVA-CHAMP-20-60-20-20240724 ; https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62017CJ0495 ; https://www.douane.gouv.fr/fiche/envoyer-un-colis-un-particulier
- **Citation.** « L'exonération est subordonnée à la preuve que les transports exécutés entrent dans les prévisions du I de l'article 262 du CGI. Cette preuve, qui est fournie par tout moyen, incombe aux transporteurs mais il appartient à l'administration d'apprécier, sous le contrôle du juge de l'impôt, les justifications fournies. »
- **Fiabilité.** Élevée.

#### T8 — Colis des particuliers : doctrine favorable et zone de risque

- **Règle.** La doctrine qualifie de transport exonéré l'acheminement, pour des expéditeurs en France, de plis, paquets ou colis vers des territoires tiers. La même page juge qu'un déménagement vers un territoire tiers n'est pas exonéré au titre de l'article 262, I-1°, faute de lien avec une livraison de biens. Un contrôleur pourrait tenter d'appliquer ce raisonnement aux achats propres des particuliers (achetés TTC en métropole, sans vente à l'exportation). Arguments contraires : l'article 294, 2-1° définit l'exportation par l'expédition ; le 1° de l'article 73 G vise les transports vers un DOM sans condition de vente ; la doctrine DOM de 2026 exonère ces transports sans restriction ; pour 971, 972 et 974, la seconde base T6 existe. Le risque résiduel est le plus fort pour les particuliers de Mayotte : en cas de remise en cause, 20 % sur la part du prix correspondant au trajet en métropole ; sans justification des éléments de calcul, sur tout le prix.
- **Chez Expedîle.** Appliquer l'exonération ; conserver les distances par trajet ; demander un rescrit pour les achats propres des particuliers, d'abord pour Mayotte (C19, A3).
- **Base légale.** BOI-TVA-CHAMP-20-60-20 §§ 60, 280, 320-330.
- **Source.** https://bofip.impots.gouv.fr/bofip/2269-PGP.html/identifiant=BOI-TVA-CHAMP-20-60-20-20240724
- **Citation.** « La prestation que ces sociétés assurent, pour le compte des expéditeurs français, en acheminant vers des pays ou territoires tiers, les plis, paquets ou colis qui leur sont confiés est exonérée de la TVA en application du I de l'article 262 du CGI. » ; « ces prestations de services, qui ne sont pas directement liées à des livraisons de biens, ne sont pas susceptibles d'être exonérées au titre du 1° du I de l'article 262 du CGI, bien qu'il y ait une opération d'exportation. »
- **Fiabilité.** Moyenne.

#### T9 — Le service doit être rendu directement au propriétaire ; sous-traitants

- **Règle.** Selon la Cour de justice, l'exonération d'un transport lié à l'exportation suppose que le service soit fourni directement à l'expéditeur ou au destinataire des biens. Expedîle fournit son service au client, propriétaire et destinataire : la condition est remplie sur ses ventes. Ses sous-traitants (compagnie aérienne, ligne maritime, groupeur) fournissent Expedîle et non le propriétaire : leurs factures peuvent porter de la TVA selon la lecture stricte du droit de l'Union. La doctrine française exonère toutefois les transports vers un port ou un aéroport en vue d'un transbordement vers un territoire tiers, et les transports d'approche réalisés pour un transporteur titulaire d'un contrat de transport international, sur attestation ou au vu des documents de transport.
- **Chez Expedîle.** Côté achats : remettre les attestations prévues ou conserver les feuilles de route ; suivre le crédit de TVA (T11).
- **Base légale.** CJUE, 29 juin 2017, C-288/16, L.Č. ; BOI-TVA-CHAMP-20-60-20 §§ 30, 80 à 100 ; CGI ann. III art. 73 A.
- **Sources.** https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62016CJ0288 ; https://bofip.impots.gouv.fr/bofip/2269-PGP.html/identifiant=BOI-TVA-CHAMP-20-60-20-20240724
- **Citation.** « [...] l'exonération prévue à cette disposition ne s'applique pas à une prestation de services, telle que celle en cause au principal, relative à une opération de transport de biens à destination d'un pays tiers, lorsque ces services ne sont pas fournis directement à l'expéditeur ou au destinataire de ces biens. »
- **Fiabilité.** Élevée pour les ventes ; moyenne pour les achats.

#### T10 — Transporteur, commissionnaire ou intermédiaire

- **Règle.** Un assujetti agissant en son nom propre pour le compte d'autrui (commissionnaire de transport) est réputé avoir reçu et fourni lui-même le transport : l'exonération porte sur tout son prix. S'il agit au nom de ses clients (intermédiaire transparent), sa commission est exonérée par l'article 263.
- **Chez Expedîle.** Dans les deux cas, le prix du transport est exonéré. La qualification compte aussi pour les délais de paiement (F24) et pour les débours (2.3) : Q6.
- **Base légale.** CGI art. 256, V-1° (version du 01/01/2022 au 01/01/2027 ; CIBS L. 211-101) ; art. 263, al. 1 (CIBS L. 213-24) ; BOI-TVA-CHAMP-20-60-20 § 60.
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044983615
- **Citation.** « L'assujetti, agissant en son nom propre mais pour le compte d'autrui, qui s'entremet dans une livraison de bien ou une prestation de services, est réputé avoir personnellement acquis et livré le bien, ou reçu et fourni les services considérés »
- **Fiabilité.** Élevée.

#### T11 — Droit à déduction et crédit de TVA

- **Règle.** Les opérations exonérées par les articles 262, 263 et 295, 1-1° ouvrent droit à déduction comme si elles étaient taxées ; les opérations non imposables en France aussi, dans la mesure où elles ouvriraient ce droit si elles étaient imposables en France. Expedîle France sera donc structurellement en crédit de TVA ; les demandes de remboursement de crédit sont un motif classique de contrôle.
- **Chez Expedîle.** Conserver les factures d'achat (reçues par la plateforme depuis le 01/09/2026, E3), les attestations de T9 et un rapprochement du crédit de TVA.
- **Base légale.** CGI art. 271, V-c et V-d (version en vigueur depuis le 21/02/2026, loi n° 2026-103 art. 100 ; CIBS L. 213-203 et L. 221-7) ; BOI-TVA-GEO-20-20 § 3. Appliquer le V-d à un client professionnel de Mayotte est un raisonnement par analogie ; pour les services liés à l'exportation, la base sûre est le V-c.
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053545646
- **Citation.** « c) Les opérations exonérées en application des dispositions du 8 de l'article 261, des articles 262, 262-00 bis et 262 bis, des I et III de l'article 262 ter, de l'article 263, des 1° et 2° bis du II et du 2° du III de l'article 291 et du 1° du 1 de l'article 295 ; »
- **Fiabilité.** Élevée.

#### T12 — Frais accessoires et assurance

- **Règle.** Les frais accessoires demandés au client (commissions, emballage, transport, assurance) suivent l'opération principale. Par tolérance, les opérations qui constituent un élément du prix d'un transport exonéré sont exonérées. Un élément n'est accessoire que s'il n'a pas de finalité propre pour le consommateur moyen et si sa valeur reste minime ; la mise à disposition de modes de paiement en fait partie, pas les assurances facultatives tarifées en sus.
- **Chez Expedîle.** Les petits frais compris dans le prix du transport suivent son exonération. Des frais de stockage importants, demandés à part, ne sont pas accessoires mais sont exonérés en tant que magasinage avant exportation (T4). L'assurance facultative est à qualifier (Q17, A8).
- **Base légale.** CGI art. 267, I-2° (CIBS L. 213-68) ; BOI-TVA-CHAMP-20-60-20 § 300 ; BOI-TVA-CHAMP-30-30-20-10 § 40 ; BOI-TVA-CHAMP-60-20 §§ 220 à 240 (version du 29/07/2026) ; CGI art. 261 C, 2°.
- **Sources.** https://bofip.impots.gouv.fr/bofip/2269-PGP.html/identifiant=BOI-TVA-CHAMP-20-60-20-20240724 ; https://bofip.impots.gouv.fr/bofip/13858-PGP.html/identifiant=BOI-TVA-CHAMP-60-20-20260729
- **Citation.** « Afin de permettre une détaxation complète des opérations de transport à l'exportation ou de transit, il est admis que soient exonérées de la TVA les opérations qui constituent un élément du prix du transport exonéré réclamé par le transporteur ou le commissionnaire de transport. »
- **Fiabilité.** Moyenne.

#### T13 — Marchandises qui ne partent pas

- **Règle.** Lorsque les marchandises ne sont pas exportées (refus, abandon, retrait en métropole, retour au vendeur, destruction), les frais perdent l'exonération et sont taxés selon leur nature :
  - particulier : stockage et services généraux au lieu du prestataire, 20 % ; manutention, reconditionnement et travaux sur les biens au lieu d'exécution, 20 % s'ils sont exécutés en métropole ; transport de retour en métropole, 20 % ;
  - professionnel établi en métropole : 20 % ;
  - professionnel établi en Guadeloupe, en Martinique ou à La Réunion : stockage et services généraux au taux du DOM du client, 8,5 %, déclarés par Expedîle France (lignes 10 et 11 de la déclaration CA3) ; manutention au lieu d'exécution par tolérance, 20 % en métropole ; le stockage seul n'est pas cité par la tolérance (ambigu, A6) ;
  - professionnel établi à Mayotte : pas de TVA française.
  - dans tous les cas : une facture exonérée déjà émise se corrige si l'exportation n'a jamais lieu ; un acompte déjà encaissé devient taxable dès qu'il est acquis que les biens ne partiront pas.
- **Chez Expedîle.** Le parcours « ne part pas » produit un avoir sur les lignes exonérées et une nouvelle facture taxée pour les frais dus (I5).
- **Base légale.** BOI-TVA-CHAMP-30-30-20-10 § 210 ; CGI art. 259, 259 A, 4° et 6°, 278 ; BOI-TVA-GEO-20-40 §§ 130, 140, 180, 200, 260.
- **Sources.** https://bofip.impots.gouv.fr/bofip/967-PGP.html/identifiant=BOI-TVA-CHAMP-30-30-20-10-20151104 ; https://bofip.impots.gouv.fr/bofip/792-PGP.html/identifiant=BOI-TVA-GEO-20-40-20240724
- **Citation.** « le bénéfice de ces dispositions suppose en tout état de cause que les biens quittent le territoire de l'Union [...] » ; « Les prestations de services qui ne relèvent pas de l'article 259 A du CGI et qui sont fournies par un prestataire établi en métropole [...] à une personne non assujettie [...] sont soumises à la TVA au taux du lieu d'établissement du prestataire en application du 2° de l'article 259 du CGI. »
- **Fiabilité.** Moyenne. Pour les DOM, « quittent le territoire de l'Union » se lit comme « quittent le territoire fiscal de l'Union » : La Réunion appartient au territoire douanier de l'Union mais est un territoire tiers sur le plan fiscal (douane.gouv.fr).

#### T14 — Prestations à destination facturées à part

- **Règle.** Les services qui ont pour seul objet de permettre ou de faciliter l'importation dans le territoire de destination ne sont pas directement liés à l'exportation. Ils ne sont exonérés que par la seconde base (T6), si leur valeur entre dans la base de l'importation ; sinon ils sont taxables au droit commun : 8,5 % s'ils sont exécutés en Guadeloupe, en Martinique ou à La Réunion ; pas de TVA à Mayotte.
- **Chez Expedîle.** Facturer dédouanement, livraison finale et stockage à destination dans le prix porte-à-porte exonéré, solution la mieux étayée (T12), plutôt qu'en lignes séparées.
- **Base légale.** BOI-TVA-CHAMP-30-30-20-10 § 120 ; BOI-TVA-CHAMP-30-30-20-40 §§ 1, 20 ; BOI-TVA-GEO-20-40 §§ 140, 200 ; BOI-TVA-BASE-10-20-60-10 §§ 90 à 220.
- **Sources.** https://bofip.impots.gouv.fr/bofip/967-PGP.html/identifiant=BOI-TVA-CHAMP-30-30-20-10-20151104 ; https://bofip.impots.gouv.fr/bofip/936-PGP.html/identifiant=BOI-TVA-CHAMP-30-30-20-40-20120912
- **Citation.** « Lorsque la valeur des prestations de services se rapportant à l'importation des biens n'est pas comprise dans la base d'imposition à l'importation, le montant de ces services est imposable dans les conditions de droit commun. »
- **Fiabilité.** Moyenne.

#### T15 — Rédiger la mention d'exonération

- **Règle.** La loi n'impose aucune phrase. La facture renvoie à l'article du CGI, à l'article correspondant de la directive 2006/112/CE, ou à toute autre mention montrant l'exonération ; l'administration admet aussi une description non équivoque de l'opération exonérée. La mention peut figurer une seule fois pour toutes les lignes relevant de la même exonération. Entre la métropole et 971, 972, 974, jamais de mention « Autoliquidation ». Les renvois au CGI restent admis sur les factures jusqu'au 30/06/2028 ; ensuite, citer le CIBS ou la directive. Exemple officiel, pour des livraisons de biens (et non des services) : « Exonération de TVA en application de l'article 294 du Code général des impôts ».
- **Chez Expedîle.** Les mentions du tableau sont stockées dans la grille fiscale avec leur base légale (I6) ; passage aux références du CIBS avant le 30/06/2028.
- **Base légale.** CGI ann. II art. 242 nonies A, I-8° et I-12° ; BOI-TVA-DECLA-30-20-20-10 §§ 260, 490, 500 ; ordonnance n° 2025-1247 art. 46, II (modifiée par l'ordonnance n° 2026-671) ; BOI-RES-TVA-000253 § 3.1 ; FAQ impots.gouv.fr sur les livraisons de marchandises vers les DOM (modifiée le 16/06/2026).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276 ; https://bofip.impots.gouv.fr/bofip/140-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-10-20131018 ; https://www.impots.gouv.fr/professionnel/questions/depuis-la-metropole-je-fais-une-livraison-de-marchandises-dans-les-dom-dois
- **Citation.** « A défaut de telles mentions, il est admis que l'assujetti indique, de manière non équivoque, la nature de l'opération bénéficiant d'un régime d'exonération. »
- **Fiabilité.** Élevée.

#### T16 — Une TVA écrite sur une facture est due

- **Règle.** Toute personne qui mentionne la TVA sur une facture en est redevable du seul fait de l'avoir facturée. Une TVA portée sur une facture qui ne correspond pas à une opération réelle, ou à un prix effectivement dû, est due par celui qui l'a facturée. Le client ne peut pas déduire une TVA facturée à tort. La régularisation suppose une facture rectificative préalable adressée au client. Le droit de l'Union impose de pouvoir corriger lorsque le risque de perte de recettes a été entièrement éliminé à temps ; sinon, la bonne foi peut être exigée.
- **Chez Expedîle.** La « TVA » du devis (TVA à l'importation estimée) ne figure jamais comme TVA d'Expedîle France sur une facture, ni dans son récapitulatif de TVA. Tout document déjà remis qui la présenterait ainsi doit être rectifié. Prudence pour le devis : libeller « Estimation de la TVA à l'importation (DOM) » plutôt que « TVA » (I16).
- **Base légale.** CGI art. 283, 3 et 4 (version en vigueur depuis le 14/03/2026 ; CIBS L. 212-9 et L. 215-11) ; art. 272, 2 ; BOI-TVA-DECLA-30-20-20-30 §§ 370-380 (version du 08/01/2025) ; CJUE, 19 septembre 2000, C-454/98, Schmeink & Cofreth et Strobel.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051214570 ; https://bofip.impots.gouv.fr/bofip/1531-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-30-20250108 ; https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:61998CJ0454
- **Citation.** « 3. Toute personne qui mentionne la taxe sur la valeur ajoutée sur une facture est redevable de la taxe du seul fait de sa facturation. 4. Lorsque la facture ne correspond pas à la livraison d'une marchandise ou à l'exécution d'une prestation de services, ou fait état d'un prix qui ne doit pas être acquitté effectivement par l'acheteur, la taxe est due par la personne qui l'a facturée. »
- **Fiabilité.** Élevée.

#### T17 — Taxe sur les petits colis de 2026 : non applicable

- **Règle.** La taxe sur les petits colis (loi de finances 2026, art. 82) visait les envois en provenance de pays tiers à l'Union ; elle ne s'appliquait pas aux échanges entre l'hexagone et les collectivités de l'article 73 de la Constitution, et elle a été abrogée au 01/07/2026.
- **Chez Expedîle.** Aucune ligne à prévoir.
- **Base légale.** douane.gouv.fr, « Taxe sur les petits colis : point d'information sur sa mise en œuvre » (2026) ; la loi elle-même n'a pas été relue.
- **Source.** https://www.douane.gouv.fr/actualites/taxe-sur-les-petits-colis-point-dinformation-sur-sa-mise-en-oeuvre
- **Citation.** « Cette taxe ne s'applique pas aux échanges entre l'hexagone et les collectivités régies par l'article 73 de la Constitution. »
- **Fiabilité.** Élevée.

### 2.3 Octroi de mer, OMR et TVA à l'importation

L'octroi de mer (OM) et l'octroi de mer régional (OMR), dans les quatre destinations, et la TVA à l'importation, en Guadeloupe, en Martinique et à La Réunion, sont dus à l'arrivée des marchandises dans le DOM et liquidés par la douane. Ce ne sont pas des taxes d'Expedîle France. Deux questions décident de tout : **qui en est redevable** (D2, D8) et **Expedîle peut-elle les refacturer comme débours**, hors de son prix (D11, D13).

#### Les trois montages possibles

| Montage | Qui dépose la déclaration | Redevable de l'OM et de la TVA à l'importation | Débours possible ? | Conséquence |
|---|---|---|---|---|
| A — chaque client importateur, représentation directe | Expedîle Réunion (si elle est représentant en douane enregistré) ou un commissionnaire, au nom et pour le compte du client | Le client | Oui, avec mandat exprès préalable, comptes de tiers et reddition de compte exacte | Seul montage compatible avec les débours ; à sécuriser par rescrit et position de la douane |
| B — représentation indirecte | Le représentant, en son nom propre, pour le compte du client | Le client, et le représentant solidairement | Douteux (le représentant n'agit pas au nom du client) | À éviter, ou à sécuriser par rescrit |
| C — Expedîle Réunion déclarante en son nom, destinataire réelle ou acheteuse sur la facture de départ | Expedîle Réunion | Expedîle Réunion | Non : la refacturation fait partie du prix | TVA à l'importation non déductible et OM à sa charge pour Expedîle Réunion ; libellés « TVA » ou « octroi de mer » risqués |

#### D1 — Champ de l'octroi de mer et de l'OMR

- **Règle.** L'OM et l'OMR frappent les importations en Guadeloupe, en Guyane, en Martinique, à Mayotte et à La Réunion. L'importation, au sens de la loi, est l'entrée dans le territoire : les marchandises venant de métropole sont visées. La décision (UE) 2021/991 autorise jusqu'au 31/12/2027 des exonérations ou réductions pour certains produits fabriqués localement ; elle ne fixe pas de terme à l'OM sur les importations, qui repose sur la loi française.
- **Chez Expedîle.** L'OM concerne les quatre destinations, y compris Mayotte, où la TVA ne s'applique pas.
- **Base légale.** Loi n° 2004-639 du 2 juillet 2004, art. 1 (version en vigueur depuis le 01/07/2015) et art. 3, 1° a (version du 01/01/2024 au 01/01/2027) ; circulaire DGDDI du 10/07/2025, §§ 3, 5, 53 ; décision (UE) 2021/991, art. 1(1).
- **Sources.** https://www.douane.gouv.fr/sites/default/files/2025-07/16/Circulaire-octroi-de-mer10072025.pdf ; https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000253374
- **Citation.** « Ainsi, une importation au sens de la loi sur l’octroi de mer se rapporte à tout mouvement de marchandises (tierces, en provenance de l’Union européenne, du territoire métropolitain, d’un territoire exclu du territoire fiscal de l’UE ou d’un autre DROM, à l’exclusion des échanges effectués dans le cadre du marché unique antillais) à destination des DROM. »
- **Fiabilité.** Élevée.

#### D2 — Redevable de l'OM : le destinataire réel désigné sur la déclaration

- **Règle.** À l'importation, l'OM est dû par les personnes désignées comme destinataires réels des biens sur la déclaration en douane ; l'OMR suit le même régime.
- **Chez Expedîle.** L'OM ne peut être une dette du client, donc un débours, que si le client est désigné destinataire réel. Si Expedîle Réunion est désignée, l'OM est sa propre taxe (montage C).
- **Base légale.** Loi n° 2004-639, art. 33, I-1° (version en vigueur depuis le 01/01/2024, ordonnance n° 2023-1210 art. 40) et art. 37, I (version en vigueur depuis le 21/02/2026) ; circulaire du 10/07/2025, § 86.
- **Source.** https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000048639473
- **Citation.** « I. - L'octroi de mer est dû par : 1° Les personnes désignées comme destinataires réels des biens sur la déclaration en douane pour les opérations d'importation mentionnées au 1° de l'article 1er ; »
- **Fiabilité.** Élevée.

#### D3 — Écrire « octroi de mer » sur une facture rend redevable

- **Règle.** Toute personne qui mentionne l'OM sur une facture, ou sur un document qui en tient lieu, en est redevable du seul fait de l'avoir facturé, sauf erreur de bonne foi corrigée et taxe non répercutée.
- **Chez Expedîle.** Aucune ligne « Octroi de mer » ou « OMR » sur une facture d'Expedîle France, sauf remboursement clairement identifié d'un OM payé à l'importation au nom du client, avec la référence de la déclaration et la liquidation. Aucun texte officiel ne confirme que cette exception protège une ligne de débours (A13) : la présentation la plus prudente est un relevé de débours distinct de la facture (D14, I7).
- **Base légale.** Loi n° 2004-639, art. 33, II ; circulaire du 10/07/2025, § 86.
- **Source.** https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000048639473
- **Citation.** « II. - Toute personne qui mentionne l'octroi de mer sur une facture ou sur tout autre document en tenant lieu est redevable de la taxe du seul fait de sa facturation, hors le cas où elle a corrigé une erreur commise de bonne foi et que la taxe n'a pas été répercutée. »
- **Fiabilité.** Élevée pour le texte ; moyenne pour son application à une ligne de débours.

#### D4 — Les taxes naissent à l'importation, sur la déclaration

- **Règle.** L'OM devient exigible au moment de l'importation ; il est liquidé sur la déclaration en douane et recouvré par la douane selon les règles du code des douanes ; l'OMR suit. La TVA à l'importation devient exigible quand le bien est importé ; la « déclaration d'importation » inclut les échanges avec les territoires fiscaux spéciaux (métropole vers DOM).
- **Chez Expedîle.** À la confirmation du départ, à Paris, OM, OMR et TVA à l'importation ne sont que des estimations : leur montant exact n'est connu qu'au dédouanement, aux taux du jour.
- **Base légale.** Loi n° 2004-639, art. 10, I, art. 13, 1°, art. 37, I bis, art. 42 ; CGI art. 293 A, 1 (version en vigueur depuis le 31/12/2023, loi n° 2023-1322 art. 112 ; CIBS L. 212-3).
- **Sources.** https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000253374 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048838508
- **Citation.** « I. - Le fait générateur de l'octroi de mer se produit et l'octroi de mer devient exigible au moment de l'importation ou de la livraison du bien. » ; « La déclaration d'importation s'entend de la déclaration en douane, au sens du 12 de l'article 5 du code des douanes de l'Union, y compris pour les échanges mentionnés au 3 de l'article 1er du même code. »
- **Fiabilité.** Élevée.

#### D5 — Base et taux de l'OM et de l'OMR

- **Règle.** La base est la valeur en douane, selon les règles de l'Union : elle comprend le transport, l'assurance, le chargement et la manutention jusqu'au lieu d'entrée dans le DROM, et exclut le transport après l'arrivée et les droits et taxes de l'Union inclus dans le prix. Les taux, fixés par position tarifaire par la collectivité, sont plafonnés à 60 % (90 % pour l'alcool et le tabac), plafonds majorés de moitié à Mayotte depuis le 01/07/2026 ; l'OMR est plafonné à 2,5 % (5 % en Guyane), avec un supplément possible de 2,5 %.
- **Chez Expedîle.** Le devis calcule l'OM sur (valeur + part de transport) par article. C'est juste si la part de transport s'arrête à l'entrée dans le DOM et si les taux sont ceux du jour de l'importation. Un tarif porte-à-porte incluant la livraison finale surestime la base de l'OM.
- **Base légale.** Loi n° 2004-639, art. 9, 1° (version en vigueur depuis le 01/01/2024), art. 27 et 37 (versions en vigueur depuis le 21/02/2026, loi n° 2026-103 art. 99 ; plafonds de Mayotte au 01/07/2026) ; CDU art. 70, 71(1)(e), 72(a) ; circulaire du 10/07/2025, §§ 44 à 47 et 87-88.
- **Sources.** https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000253374 ; https://www.douane.gouv.fr/sites/default/files/2025-07/16/Circulaire-octroi-de-mer10072025.pdf
- **Citation.** « La base d'imposition est constituée par : 1° La valeur en douane des biens, telle que définie par la réglementation communautaire en vigueur, pour les opérations mentionnées au 1° de l'article 1er ; »
- **Fiabilité.** Élevée.

#### D6 — L'OM et l'OMR sont hors de la base de la TVA ; la formule « TVA » du devis

- **Règle.** L'OM et l'OMR ne sont pas compris dans la base de la TVA, y compris à l'importation. La base de la TVA à l'importation est la valeur en douane, augmentée des droits et taxes autres que la TVA (hors OM et OMR) et des frais accessoires (commission, emballage, transport, assurance) jusqu'au premier lieu de destination : le lieu inscrit sur le document de transport, à défaut la première rupture de charge ; pour un groupage poursuivi au-delà du dédouanement, le lieu de déchargement de chaque envoi. Cette base est constatée par la douane.
- **Chez Expedîle.** La formule du devis, (transport + OM + OMR) × taux, s'écarte deux fois des textes : elle inclut l'OM et l'OMR, que la loi exclut, et elle omet la valeur des marchandises, que l'article 292 inclut, sauf si le mécanisme de D7 s'applique. L'estimation ne correspondra pas à la liquidation de la douane. La base de transport n'est pas la même pour l'OM (jusqu'à l'entrée dans le DOM) et pour la TVA (jusqu'au premier lieu de destination).
- **Base légale.** Loi n° 2004-639, art. 45 (version du 01/07/2015 au 01/01/2027 ; à partir du 01/01/2027, il renvoie aux art. L. 213-66 et L. 213-67 du CIBS) ; CGI art. 292 (version du 01/01/2022 au 01/01/2027 ; CIBS L. 213-64, L. 213-67, L. 213-69, L. 216-3) ; BOI-TVA-BASE-10-20-60-10 §§ 1, 70, 90 à 130 (version du 24/02/2021) ; circulaire du 10/07/2025, § 121 ; réponse ministérielle à la question écrite AN n° 14492 (JO du 12/03/2024, p. 1867).
- **Sources.** https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000253374 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041472118 ; https://bofip.impots.gouv.fr/bofip/10302-PGP.html/identifiant=BOI-TVA-BASE-10-20-60-10-20210224
- **Citation.** « Par exception aux dispositions du 1° du I de l'article 267 et du 1° de l'article 292 du code général des impôts, l'octroi de mer et l'octroi de mer régional ne sont pas compris dans la base d'imposition de la taxe sur la valeur ajoutée. »
- **Fiabilité.** Élevée pour l'exclusion ; moyenne pour la pratique de liquidation, à vérifier sur des déclarations réelles (Q9).

#### D7 — Biens achetés TTC en métropole : deux sources officielles qui divergent

- **Règle.** Une réponse ministérielle de 1993 indique qu'à l'importation dans un DOM de biens achetés TTC en métropole, la TVA se calcule sur la valeur diminuée de la TVA métropolitaine restante, puis se diminue de cette TVA restante ; celle-ci étant supérieure, rien n'est dû, et le particulier n'obtient aucun remboursement. Une page actuelle de douane.gouv.fr indique au contraire qu'un colis reçu dans un DOM, y compris depuis la métropole, supporte la TVA sur la valeur totale de l'envoi au-delà de 22 €. Les deux ne peuvent décrire ensemble la pratique actuelle, et la formule du devis ne correspond à aucune des deux. La valeur protectrice de la réponse de 1993 est incertaine : elle est ancienne, absente du BOFiP, et la TVA à l'importation est liquidée par la douane.
- **Chez Expedîle.** Aucun montant de TVA à l'importation n'est présenté comme définitif. La pratique réelle se vérifie sur des liquidations (Q9) et auprès de la douane (A11).
- **Base légale.** Réponse ministérielle à la question écrite Sénat n° 02416 (JO Sénat du 02/12/1993, p. 2303) ; douane.gouv.fr, « Vous achetez sur internet » (consulté le 10/10/2026) ; CGI art. 292 ; BOI-SJ-RES-10-10-10 § 200.
- **Sources.** https://www.senat.fr/questions/base/1993/qSEQ930802416.html ; https://www.douane.gouv.fr/demarche/vous-achetez-sur-internet
- **Citation.** « [...] à l'importation dans les départements d'outre-mer la TVA rémanente est toujours supérieure au montant de la taxe due. Les particuliers, en tant que consommateurs finals, ne peuvent pas prétendre au remboursement de cette TVA rémanente. » ; « Si la réception du colis s'effectue dans un département d'Outre-mer (DOM), y compris depuis la métropole, vous aurez à payer : de la TVA sur la valeur totale de l'envoi si celle-ci dépasse 22 euros ; »
- **Fiabilité.** Moyenne.

#### D8 — Redevable de la TVA à l'importation

- **Règle.** Hors ventes à distance, le redevable est : a) le destinataire de la vente dont le prix sert de valeur transactionnelle en douane ; sinon b) le débiteur de la dette douanière, c'est-à-dire le déclarant, et aussi la personne représentée en cas de représentation indirecte. Les biens d'un particulier, achetés et livrés en métropole, lui appartiennent déjà : leur importation se fait sans vente, ce qui renvoie au déclarant ; en représentation directe, le client est le déclarant et doit la taxe. Le représentant qui agit en son nom propre est solidaire et transmet au redevable la base imposable et les documents nécessaires à la déduction. Un professionnel assujetti, pour les besoins duquel l'importation est réalisée, peut opter pour être redevable en inscrivant son numéro de TVA sur la déclaration ; un particulier ne le peut pas. Les règles de redevabilité des plateformes de vente à distance ne s'appliquent pas dans les DROM.
- **Chez Expedîle.** Qui déclare et qui est désigné importateur décide de qui doit la TVA à l'importation (Q7).
- **Base légale.** CGI art. 293 A, 2, 3° a et b, et 4 (version en vigueur depuis le 31/12/2023 ; CIBS L. 215-15, L. 217-5, L. 215-41) ; art. 293 A quater (version en vigueur depuis le 01/01/2022 ; CIBS L. 215-14) ; BOI-TVA-DECLA-10-20 §§ 70, 100, 110, 120, 145, 160 (version du 24/07/2024) ; CDU art. 5(15) et 77(3) ; instruction DGDDI sur les envois de faible valeur (texte n° 21000095).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048838508 ; https://bofip.impots.gouv.fr/bofip/3166-PGP.html/identifiant=BOI-TVA-DECLA-10-20-20240724 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044894135
- **Citation.** « Le code des douanes de l'Union définit le débiteur de la dette douanière comme le déclarant, c'est à dire la personne qui dépose la déclaration en douane (CDU, art. 77, paragraphe 3). »
- **Fiabilité.** Moyenne : l'application aux introductions dans les DOM passe par le renvoi de l'article 293 A à la déclaration en douane ; aucun texte ne la confirme expressément pour les DOM.

#### D9 — Paiement de la TVA à l'importation : au comptant ou autoliquidée

- **Règle.** Une personne non assujettie et non identifiée à la TVA (le particulier) déclare et paie la TVA à l'importation à la douane, au dédouanement. Un redevable identifié à la TVA en France l'autoliquide obligatoirement sur sa déclaration de TVA ; ce régime s'applique dans les DOM comme en métropole depuis le 01/01/2022. L'importation est incompatible avec le régime simplifié de TVA.
- **Chez Expedîle.** La TVA à l'importation d'un particulier est payée au comptant par le déclarant ou le représentant : un débours est possible (montage A). Un professionnel identifié et désigné redevable l'autoliquide : il n'y a rien à lui refacturer comme TVA.
- **Base légale.** CGI art. 1695, I-1° (version en vigueur depuis le 31/12/2023 ; CIBS L. 218-2) ; BOD n° 7440 du 23/11/2021 ; note aux opérateurs DGDDI du 23/11/2021 (mention G0008 pour un redevable non identifié ; code document 1008 ou FR7 pour un redevable identifié, à vérifier dans le système déclaratif actuel) ; BOI-TVA-DECLA-10-20 § 200.
- **Sources.** https://www.douane.gouv.fr/sites/default/files/uploads/files/BOD%207440%20blanc%20op%C3%A9rateurs.pdf ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041534638 ; https://www.douane.gouv.fr/sites/default/files/2021-11/30/note-aux-operateurs-generalisation-de-lautoliquidation-de-la-tva.pdf
- **Citation.** « L’autoliquidation de la TVA à l’importation est obligatoire et automatique pour tout redevable identifié à la TVA en France. » ; « Les personnes non-assujetties et non-identifiées à la TVA en France continuent de déclarer et payer la TVA à l’importation auprès des services de la DGDDI en vertu du I de l’article 1695 du CGI. »
- **Fiabilité.** Élevée.

#### D10 — Déduction de la TVA à l'importation

- **Règle.** Seul le redevable qui utilise les biens pour ses opérations taxées, normalement leur propriétaire, peut déduire la TVA à l'importation (exception si la valeur des biens est incorporée dans ses prix, ce qui n'est pas le cas d'un transporteur). Le droit national peut refuser la déduction au transporteur qui a payé la TVA à l'importation sans être importateur ni propriétaire. Un client professionnel ne déduit que la TVA pouvant légalement figurer sur la facture ; pour la TVA à l'importation, il lui faut la déclaration ou un document donnant son numéro, sa date et la base imposable, remis par celui qui l'a déposée pour son compte.
- **Chez Expedîle.** Si Expedîle Réunion est désignée redevable pour des biens qui appartiennent aux clients, cette TVA est une charge définitive pour elle et sa refacturation fait partie du prix. Les professionnels ont besoin des références de leur déclaration pour déduire (I14).
- **Base légale.** CGI art. 271, II-1-a et b, II-2 (version en vigueur depuis le 21/02/2026 ; CIBS L. 226-8 et L. 224-2) ; art. 293 A, 4 al. 2 ; BOI-TVA-DED-40-10-30 §§ 30 et 45 (version du 24/07/2024), qui cite l'ordonnance CJUE C-621/19 (Weindel Logistik Service) ; CJUE, 25 juin 2015, C-187/14, DSV Road.
- **Sources.** https://bofip.impots.gouv.fr/bofip/1082-PGP.html/identifiant=BOI-TVA-DED-40-10-30-20240724 ; https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62014CJ0187 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053545646
- **Citation.** « À cette fin, il est nécessaire que cet assujetti soit propriétaire du bien. »
- **Fiabilité.** Élevée.

#### D11 — Débours : les conditions

- **Règle.** Les sommes remboursées à un intermédiaire restent hors de sa base de TVA seulement si : 1) il a payé au nom et pour le compte de son client, en vertu d'un mandat préalable et explicite (un mandat tacite n'est admis que s'il est assez vraisemblable pour ne pas être mis en doute), en apparaissant clairement comme représentant du client auprès du tiers payé ; 2) il rend un compte exact au client ; 3) il inscrit ces dépenses dans des comptes de passage (comptes de tiers) ; 4) il justifie leur nature ou leur montant exact auprès de l'administration, par tout moyen approprié (factures du tiers, comptes rendus détaillés). Des frais d'exploitation refacturés ne peuvent pas être détachés du prix ; être remboursé au coût ne suffit pas. La doctrine admet expressément ce régime pour les commissionnaires de transport et en douane. Une taxe dont le prestataire est lui-même redevable ne peut pas être un débours.
- **Chez Expedîle.** L'OM, l'OMR et la TVA à l'importation des particuliers ne peuvent être des débours que dans le montage A, au montant exact liquidé (D13, D14).
- **Base légale.** CGI art. 267, II-2° (version du 31/12/2020 au 01/01/2027 ; CIBS L. 213-73 et L. 213-74) ; BOI-TVA-BASE-10-10-30 §§ 200 à 230 et 290 (version du 11/05/2022) ; BOI-TVA-BASE-10-20-40-20 §§ 70-80 (version du 12/09/2012) ; CJUE, 28 juillet 2011, C-106/10, Lidl & Companhia, points 34 et 40.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006309431 ; https://bofip.impots.gouv.fr/bofip/488-PGP.html/identifiant=BOI-TVA-BASE-10-10-30-20220511 ; https://bofip.impots.gouv.fr/bofip/1475-PGP.html/identifiant=BOI-TVA-BASE-10-20-40-20-20120912 ; https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62010CJ0106
- **Citation.** « Les sommes remboursées aux intermédiaires qui effectuent des dépenses au nom et pour le compte de leurs commettants dans la mesure où ces intermédiaires rendent compte à leurs commettants, portent ces dépenses dans leur comptabilité dans des comptes de passage, et justifient auprès de l'administration des impôts de la nature ou du montant exact de ces débours. » ; « agit en vertu d'un mandat préalable et explicite et non pas présumé »
- **Fiabilité.** Élevée.

#### D12 — Représentation en douane

- **Règle.** La représentation est directe (au nom et pour le compte d'autrui) ou indirecte (en son nom propre, pour le compte d'autrui) ; le représentant déclare sa qualité, faute de quoi il est réputé agir en son nom et pour son propre compte. Le déclarant répond de l'exactitude des données et de l'authenticité des documents joints, dont la facture commerciale ; le représentant enregistré répond des opérations qu'il effectue. Toute personne qui agit comme représentant en douane doit être enregistrée (sauf dépôt occasionnel de trois déclarations par an au plus, et deux autres cas) ; l'enregistrement vaut en métropole et dans les DOM où elle a un établissement. Le mandat donné à un représentant enregistré se prouve par écrit, éventuellement électronique ; une subdélégation exige l'accord exprès du client. Le représentant mentionne sur ses factures la date de versement des droits et taxes au comptable public. Celui qui a payé des droits et taxes pour un tiers est subrogé dans le privilège du Trésor.
- **Chez Expedîle.** Expedîle Réunion ne peut représenter les clients que si elle est enregistrée ; à défaut, un commissionnaire enregistré le fait. Le parcours de commande recueille un mandat exprès électronique, horodaté, avec accord de subdélégation (I16).
- **Base légale.** CDU art. 5(6), 15(2), 18(1), 19 (version consolidée du 12/12/2022) ; C. douanes art. L221-4, L221-5, L221-6, R221-11, R221-12, R221-13, R221-20, R221-21, R221-28, L323-17, L522-2 (en vigueur depuis le 01/05/2026, ordonnance n° 2026-265 et décret n° 2026-266 ; l'ancien art. 87 est abrogé).
- **Sources.** https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:02013R0952-20221212 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053805361 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813576 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813596 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813613 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053805725 ; https://www.douane.gouv.fr/sites/default/files/2026-04/09/CP-Recodification_le-code-des-douanes-entrera-en-vigueur-le-1-er-mai-2026.pdf
- **Citation.** « Cette représentation peut être soit directe, auquel cas le représentant en douane agit au nom et pour le compte d'autrui, soit indirecte, auquel cas le représentant en douane agit en son nom propre, mais pour le compte d'autrui. » ; « Le mandat donné au représentant en douane enregistré est établi par une preuve écrite qui peut être fournie de manière électronique. »
- **Fiabilité.** Élevée.

#### D13 — Les trois montages et leurs conséquences

- **Règle.** Les règles D2 à D12 donnent trois issues :
  - **A — représentation directe, chaque client importateur.** Chaque client est importateur et déclarant sur sa propre déclaration (mention G0008 pour un particulier ; numéro de TVA pour un professionnel identifié). Expedîle Réunion, si elle est enregistrée, ou un commissionnaire agit en représentant direct. Le client doit l'OM et la TVA à l'importation. Celle du particulier, payée au dédouanement par le représentant en son nom, peut être refacturée en débours ; celle du professionnel est autoliquidée par lui. Expedîle France ne peut porter ces montants qu'à l'intérieur d'une chaîne de mandats exprès, en comptes de tiers, en transmettant le relevé exact du représentant : aucune doctrine ne traite d'une telle chaîne (A12).
  - **B — représentation indirecte.** Le représentant déclare en son nom pour le client ; il devient débiteur avec le client et solidaire de la TVA. Le débours est douteux, car la doctrine exige d'agir au nom du client.
  - **C — Expedîle Réunion déclarante en son nom, destinataire réelle ou acheteuse sur la facture de départ.** Elle doit l'OM et la TVA à l'importation ; elle ne peut pas déduire cette TVA, faute d'être propriétaire, et l'OM reste une charge (seuls les producteurs redevables de l'OM le déduisent). La refacturation aux clients fait partie du prix des services d'Expedîle et n'est pas un débours, qu'elle soit facturée par Expedîle Réunion ou par Expedîle France ; libellée « TVA » ou « Octroi de mer », elle ajoute les risques de T16 et D3.
- **Chez Expedîle.** Le montage A est recommandé par les recherches ; il est à confirmer par un rescrit fiscal et une position de la douane (C19). Tant qu'il n'est pas confirmé, l'application ne choisit pas : la direction fixe le régime (I7).
- **Base légale.** Comme D2, D8, D9, D11 et D12 ; BOI-TVA-DED-40-10-30 § 45 ; loi n° 2004-639, art. 2 et 14 ; BOI-TVA-BASE-10-10-30 § 210.
- **Sources.** https://bofip.impots.gouv.fr/bofip/488-PGP.html/identifiant=BOI-TVA-BASE-10-10-30-20220511 ; https://bofip.impots.gouv.fr/bofip/1082-PGP.html/identifiant=BOI-TVA-DED-40-10-30-20240724
- **Citation.** « Ces dispositions ne concernent que les sommes versées à des tierces personnes par un mandataire, au nom et pour le compte de son commettant, à l'exclusion, par conséquent, des dépenses engagées par un assujetti pour les besoins de sa propre entreprise (salaires versés au personnel, prix d'acquisition de biens ou services, etc.). »
- **Fiabilité.** Moyenne pour A ; faible pour B ; moyenne pour C.

#### D14 — Calendrier des débours : provision, puis relevé exact

- **Règle.** Les taxes naissent à l'importation (D4) et un débours doit être le montant exact, avec un compte exact (D11). Une facture émise à la confirmation du départ ne peut donc pas porter ces montants comme débours exacts. Les montants du devis sont des estimations : ils peuvent être encaissés comme provision en compte de tiers, puis régularisés après le dédouanement par un relevé donnant le numéro de la déclaration, la liquidation et la date de paiement, l'écart étant remboursé ou réclamé. Ce mécanisme est une déduction tirée des textes ; aucun texte unique ne le prescrit.
- **Chez Expedîle.** Le paiement PayPlug d'un particulier couvre deux choses distinctes : le prix des services d'Expedîle et une provision pour taxes à destination (montage A). La facture ne porte que les services ; un relevé de débours séparé suit le dédouanement (I7).
- **Base légale.** CGI art. 293 A, 1 ; loi n° 2004-639, art. 10 ; CGI art. 267, II-2° ; BOI-TVA-BASE-10-10-30 § 220 ; C. douanes art. R221-28.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813613 ; https://bofip.impots.gouv.fr/bofip/488-PGP.html/identifiant=BOI-TVA-BASE-10-10-30-20220511
- **Citation.** « Outre les mentions obligatoires prévues au II de l'article 289 du code général des impôts, le représentant en douane mentionne sur les factures émises pour ses mandants la date de versement au comptable public des droits et taxes acquittés à l'importation en application des dispositions des articles L. 321-7 à L. 321-10. »
- **Fiabilité.** Moyenne.

#### D15 — Franchises et exonérations qui annulent les taxes

- **Règle.**
  - Exonération de TVA et d'OM des envois d'une valeur intrinsèque de 22 € au plus importés en Guadeloupe, à La Réunion ou en Martinique.
  - Franchise de TVA et d'OM jusqu'à 400 € pour les petits envois non commerciaux venant d'un État de l'Union, métropole comprise (envois occasionnels, pour l'usage personnel ou familial du destinataire, sans aucun paiement ; les exemples de la douane sont des cadeaux entre particuliers). Son application aux achats propres d'un client réexpédiés par Expedîle est douteuse (A5).
  - Les biens exonérés de droits et taxes sont exonérés d'OM ; l'OMR suit.
  - Les exonérations facultatives d'OM, surtout pour les biens destinés à une activité économique, ne jouent que si elles sont demandées au dédouanement, avec le code additionnel national (CANA).
  - Les produits de la liste de l'annexe IV, art. 50 duodecies, sont exonérés de TVA à l'importation en Guadeloupe, en Martinique et à La Réunion ; la liste comprend une partie commune et des produits propres à La Réunion ou aux Antilles (répartition admise jusqu'au 31/12/2027) ; elle a été modifiée par un arrêté du 29 juin 2026.
- **Chez Expedîle.** Quand une exonération joue, rien n'est payé, donc rien ne peut être refacturé en débours. L'estimation vérifie franchises et listes par code SH et par destination ; une franchise annule l'estimation correspondante.
- **Base légale.** CGI ann. IV art. 50 octies, 5° (en vigueur depuis le 01/07/2021) ; loi n° 2004-639, art. 6, 8 (version du 01/04/2023 au 01/01/2027) et 37, I ; circulaire du 10/07/2025, §§ 25 à 29 et 34 à 36 ; CGI art. 295, 1-5° a ; CGI ann. IV art. 50 duodecies (version en vigueur depuis le 01/07/2026) ; BOFiP ACTU-2025-00106 (23/07/2025) ; douane.gouv.fr, « Recevoir un colis envoyé par un particulier ».
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043584984 ; https://bofip.impots.gouv.fr/bofip/14710-PGP.html/ACTU-2025-00106 ; https://www.douane.gouv.fr/fiche/recevoir-un-colis-envoye-par-un-particulier
- **Citation.** « Les biens compris dans un envoi d'une valeur intrinsèque qui n'excède pas 22 €, lorsque l'importation est réalisée en Guadeloupe, à La Réunion ou en Martinique » ; « Les biens en provenance d'un Etat membre de l'Union européenne sont importés en franchise de taxe sur la valeur ajoutée et d'octroi de mer lorsque leur valeur totale n'excède pas 1 000 € pour les biens transportés par les voyageurs ou 400 € pour les biens qui font l'objet de petits envois non commerciaux. »
- **Fiabilité.** Moyenne.

#### D16 — Déclarations à l'arrivée

- **Règle.** Tout envoi introduit dans un DROM fait l'objet d'une déclaration en douane électronique (depuis le 01/07/2021). Depuis le 01/07/2026, la déclaration simplifiée H7 est réservée aux envois de 150 € au plus vendus dans le cadre de ventes à distance de biens importés ; les biens propres des clients, réexpédiés de métropole, n'entrent pas dans cette définition ; l'opérateur postal peut utiliser la déclaration H6 jusqu'à 1 000 €. Dans une déclaration d'introduction dans un territoire fiscal spécial, l'« exportateur » est l'expéditeur, défini comme le dernier vendeur des marchandises ; l'« importateur » est la partie qui dépose la déclaration ou pour le compte de laquelle elle est déposée (en H6 et H7 : la partie à laquelle les marchandises sont effectivement destinées).
- **Chez Expedîle.** Une déclaration par client ou par dossier est la façon naturelle de désigner chaque client comme importateur. Une facture de départ qui présente Expedîle France comme exportatrice et vendeuse ne correspond pas à des biens dont le dernier vendeur est un marchand en ligne (D17).
- **Base légale.** Instruction DGDDI « Le dédouanement des envois de faible valeur », texte n° 21000095 (version du 23/03/2023), § I-3 ; règlement (UE) 2026/382 ; règlement délégué (UE) 2026/1022 (applicable au 01/07/2026) ; règlement délégué (UE) 2015/2446, art. 134 et annexe B (éléments 13 01 et 13 04), version consolidée du 01/07/2026.
- **Sources.** https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32026R1022 ; https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:02015R2446-20260701
- **Citation.** « L’exportateur est l’expéditeur dans le cadre des échanges avec des territoires fiscaux spéciaux L’expéditeur est le dernier vendeur des marchandises. »
- **Fiabilité.** Moyenne : l'application aux introductions dans les DOM de la nouvelle restriction de la H7 est une lecture des textes ; aucune note récente de la douane ne la confirme (A17).

#### D17 — La « facture commerciale » de départ Expedîle France → Expedîle Réunion

- **Règle.**
  - Si ce document est présenté à la douane comme une vente et que son prix sert de valeur transactionnelle, Expedîle Réunion devient « destinataire de la vente » et redevable de la TVA à l'importation, ce qui exclut le débours.
  - Si Expedîle Réunion est désignée destinataire réel, elle doit l'OM.
  - Délivrer une facture qui ne correspond pas à une livraison ou à une prestation réelle est puni d'une amende de 50 % ; l'exclusion prévue pour les particuliers ne joue pas, le destinataire étant une entreprise. Une TVA portée sur un tel document serait due (T16).
  - Le déclarant répond de l'authenticité et de l'exactitude des documents joints à la déclaration.
  - Tout document délivré dans les conditions de l'article 289 est une facture, quel que soit son titre (F4).
- **Chez Expedîle.** Le document actuel, intitulé « FACTURE COMMERCIALE » avec le pied « usage douanier uniquement », est à revoir avec le déclarant (Q8, A18) : pas de TVA, pas de numéro des séries de vente, pas de présentation comme une vente d'Expedîle France ; chaque client désigné importateur, le marchand en ligne comme dernier vendeur ; ou une déclaration par client.
- **Base légale.** CGI art. 293 A, 2, 3° a ; BOI-TVA-DECLA-10-20 § 70 ; CGI art. 1737, I-2° ; art. 283, 4 ; CDU art. 15(2) et 70(1) ; règlement délégué (UE) 2015/2446, annexe B ; BOI-TVA-DECLA-30-20-10.
- **Sources.** https://bofip.impots.gouv.fr/bofip/3166-PGP.html/identifiant=BOI-TVA-DECLA-10-20-20240724 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546686
- **Citation.** « Ainsi, la personne désignée redevable de la TVA à l'importation sera le destinataire de la vente dont la valeur a été retenue en tant que valeur transactionnelle pour la détermination de la valeur en douane. » ; « le fait de délivrer une facture ne correspondant pas à une livraison ou à une prestation de service réelle »
- **Fiabilité.** Moyenne : l'application de l'amende au document douanier reste une interprétation.

#### D18 — Conservation des pièces douanières et droit de communication de la douane

- **Règle.** Les agents des douanes peuvent demander tout document, sur tout support, à toute personne intéressée par des opérations relevant de leur compétence, sur place ou par correspondance, et en prendre copie ou les saisir. Sauf délai plus long, ces documents se conservent six ans, sous forme électronique s'ils ont été établis ou reçus ainsi ; le CDU impose au moins trois ans.
- **Chez Expedîle.** Par dossier : mandat et acceptation, déclaration, liquidation, preuve de paiement, factures du représentant (avec la date de paiement), extraits des comptes de tiers, relevés adressés au client. Durée retenue : dix ans (F22).
- **Base légale.** C. douanes art. L421-1 et L421-11 (en vigueur depuis le 01/05/2026, ordonnance n° 2026-265) ; CDU art. 51(1).
- **Source.** https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006071570/LEGISCTA000053805942/
- **Citation.** « Lorsqu'ils sont établis ou reçus sur support informatique, ces documents sont conservés sous cette forme pendant le délai prévu au premier alinéa. »
- **Fiabilité.** Élevée.

### 2.4 Facturation électronique

#### Ce qu'il faut faire, et quand

| Quand | Quoi | Règles |
|---|---|---|
| Maintenant (déjà dû) | Choisir une plateforme agréée pour la réception ; signer l'accord formel ; vérifier l'inscription à l'annuaire (SIREN, SIRET, code de routage) ; garder des preuves datées. Même chose pour Expedîle Réunion si c'est une société distincte | E3, E5, E17 |
| Maintenant | Établir la catégorie de taille au 01/01/2025. Si Expedîle France est une ETI ou une grande entreprise, l'émission et l'e-reporting sont déjà dus : contracter immédiatement l'émission et documenter la trajectoire de mise en conformité | E1, E2, E13 |
| D'ici au 01/09/2027 | Factures aux professionnels en PDF ou Factur-X, par le portail ou par courriel, avec l'acceptation du client ; entrée volontaire anticipée possible, uniquement par une plateforme agréée | F19, E12 |
| 01/01/2027 | Vérifier le régime de déclaration de TVA (fin du régime simplifié ; déclaration mensuelle, ou trimestrielle sous les seuils), qui fixe la fréquence de l'e-reporting | E9 |
| Avant le 01/09/2027 (PME) | Choisir la plateforme d'émission et d'e-reporting ; connecter l'application ; produire un Factur-X au profil EN 16931 ; suivre les statuts ; préparer l'e-reporting quotidien des ventes aux particuliers, l'e-reporting des clients professionnels de Mayotte et de l'étranger, les données de paiement et l'e-reporting des achats auprès de fournisseurs non établis en France ; tester avec la plateforme | E4 à E11 |
| 01/09/2027 (PME) | Émission électronique obligatoire vers les professionnels établis en métropole, en Guadeloupe, en Martinique et à La Réunion ; e-reporting ; données de paiement ; quatre nouvelles mentions | E1, E6, F8 |

#### E1 — Calendrier

- **Règle.** L'émission électronique (art. 289 bis) et l'e-reporting (art. 290 et 290 A) s'appliquent aux factures émises à partir du 01/09/2026 par les grandes entreprises et les ETI, et à partir du 01/09/2027 par les PME et micro-entreprises non membres d'un assujetti unique. Un décret pourrait reporter ces dates, au plus tard au 01/12/2026 et au 01/12/2027 ; aucun décret de report n'a été trouvé et la DGFiP annonce le maintien du calendrier légal. La loi de finances pour 2026 a supprimé la condition liée à l'autorisation européenne : le calendrier est inconditionnel. Ses propres modifications (art. 289 bis, 290, 290 A, 1737, 1788 D) s'appliquent aux factures émises à partir de la date de la catégorie de l'entreprise : la mention « en vigueur depuis le 21/02/2026 » de Légifrance n'est pas la date d'application à Expedîle.
- **Chez Expedîle.** PME : émission et e-reporting au 01/09/2027 ; réception depuis le 01/09/2026 (E3).
- **Base légale.** Loi n° 2022-1157 du 16 août 2022, art. 26, III-A et III-B (version en vigueur depuis le 21/02/2026) ; loi n° 2026-103, art. 123, IV et V ; DGFiP, guide pratique de démarrage (juillet 2026) ; BOI-TVA-DECLA-20-30-50 § 10 (30/09/2026).
- **Sources.** https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000046188381 ; https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053508878 ; https://www.impots.gouv.fr/professionnel/questions/partir-de-quand-suis-je-concerne-par-la-reforme-de-la-facturation
- **Citation.** « Toutefois, pour les factures émises par les assujettis relevant des catégories des microentreprises et des petites et moyennes entreprises qui ne sont pas membres d'un assujetti unique mentionné à l'article 256 C du code général des impôts, les 2° et 4° du I et le II du présent article s'appliquent à compter du 1er septembre 2027. »
- **Fiabilité.** Élevée.

#### E2 — Catégorie de taille

- **Règle.** La catégorie s'apprécie pour chaque personne juridique (SIREN) au 01/01/2025, sur le dernier exercice clos avant cette date, ou à défaut sur le premier exercice clos après. Micro-entreprise : moins de 10 personnes et chiffre d'affaires ou total de bilan de 2 M€ au plus. PME : moins de 250 personnes et chiffre d'affaires de 50 M€ au plus ou total de bilan de 43 M€ au plus.
- **Chez Expedîle.** Expedîle France et Expedîle Réunion, si elle est une société distincte, s'apprécient séparément (Q2).
- **Base légale.** Loi n° 2022-1157, art. 26, III-A, al. 3 ; FAQ DGFiP « J'approfondis la facturation électronique » (version du 01/09/2026), question 1.1.
- **Sources.** https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000046188381 ; https://www.impots.gouv.fr/foire-aux-questions-japprofondis-la-facturation-electronique
- **Citation.** « L'appartenance à une catégorie s'apprécie au niveau de chaque personne juridique au 1er janvier 2025, sur la base du dernier exercice clos avant cette date ou, en l'absence d'un tel exercice, sur celle du premier exercice clos à compter de cette date. »
- **Fiabilité.** Élevée.

#### E3 — Réception obligatoire depuis le 1er septembre 2026

- **Règle.** Depuis le 01/09/2026, toute entreprise assujettie établie en France, quelles que soient sa taille et sa forme, doit pouvoir recevoir par une plateforme agréée les factures électroniques de ses fournisseurs soumis à l'obligation d'émettre ; le choix de la plateforme devait être fait à cette date. Une facture reçue par courrier, en PDF ou sur papier après cette date ne doit pas être écartée pour autant.
- **Chez Expedîle.** Plateforme de réception pour les factures des fournisseurs (transporteurs, compagnies, lignes maritimes, énergie, télécoms) ; ces factures fondent la déduction de TVA (T11).
- **Base légale.** CGI art. 289 bis, I ; FAQ DGFiP « Je découvre la facturation électronique » (version du 01/09/2026), questions 1.2, 2.2 et 5.1 ; guide pratique (juillet 2026), questions 1 et 3.
- **Source.** https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq---fe_je-decouvre-la-facturation-electronique.pdf
- **Citation.** « Depuis le 1er septembre 2026, toutes les entreprises, quelles que soient leur taille et leur forme juridique, ont l’obligation de recevoir des factures sous format électronique, par l’intermédiaire d’une plateforme agréée »
- **Fiabilité.** Élevée.

#### E4 — Champ de la facture électronique

- **Règle.** L'émission, la transmission et la réception des factures, et des factures d'acompte, se font sous forme électronique lorsque l'émetteur et le destinataire sont des assujettis établis en France. Trois critères : deux assujettis établis en France, une opération dans le champ de la TVA française, des règles de facturation françaises. Les franchisés en base et micro-entrepreneurs sont des assujettis et sont concernés. Une association non assujettie est traitée comme un particulier (e-reporting) ; une association assujettie reçoit une facture électronique. Seules les opérations exonérées par les articles 261 à 261 E échappent à l'émission ; les exonérations d'Expedîle (art. 262, 295) n'en font pas partie.
- **Chez Expedîle.** Factures, factures d'acompte et avoirs aux professionnels établis en métropole, en Guadeloupe, en Martinique et à La Réunion : facture électronique par plateforme à la date d'obligation. Le statut d'assujetti du client, et non la seule présence d'un SIRET, décide du canal.
- **Base légale.** CGI art. 289 bis, I (version en vigueur depuis le 21/02/2026 ; maintenu après le 01/01/2027 jusqu'à sa reprise réglementaire) ; FAQ « Je découvre », question 1.1 ; FAQ « J'approfondis », question 1.2 ; page de questions impots.gouv.fr « Je n'émets pas de facture, ou je facture sans TVA » (modifiée le 16/01/2026).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195635 ; https://www.impots.gouv.fr/foire-aux-questions-japprofondis-la-facturation-electronique
- **Citation.** « [...] l'émission, la transmission et la réception des factures relatives aux opérations mentionnées aux a et d du 1 du I dudit article 289 ainsi qu'aux acomptes s'y rapportant s'opèrent sous une forme électronique, selon des normes de facturation électronique définies par arrêté du ministre chargé du budget, lorsque l'émetteur de la facture et son destinataire sont des assujettis qui sont établis ou ont leur domicile ou leur résidence habituelle en France. »
- **Fiabilité.** Élevée.

#### E5 — Plateforme agréée, portail public, annuaire

- **Règle.** Depuis la loi de finances pour 2026, le recours à une plateforme agréée est obligatoire ; le portail public n'est plus une option d'échange. Le portail public administre l'annuaire et concentre les données pour l'administration ; seules les plateformes agréées transmettent les factures aux destinataires et les données au portail ; un logiciel « compatible » doit passer par une plateforme. La plateforme du destinataire ne met à jour l'annuaire qu'avec son accord formel, qu'elle conserve et produit sur demande. L'entreprise choisit librement une ou plusieurs plateformes (émission, réception et e-reporting peuvent être séparés) et peut en changer à tout moment ; l'ancienne plateforme assure alors un service minimal pendant un an. Les plateformes sont immatriculées pour trois ans renouvelables ; la liste officielle distingue les opérateurs définitivement immatriculés et ceux en attente des tests d'interopérabilité.
- **Chez Expedîle.** L'application se connecte à une plateforme agréée, jamais directement au portail public. Vérifier sur la liste officielle le statut de la plateforme choisie ; conserver l'accord formel.
- **Base légale.** CGI art. 289 bis, I al. 2 et III ; art. 290 B ; CGI ann. II art. 242 nonies E bis, E ter et E quater (versions en vigueur depuis le 29/07/2026, décret n° 2026-677 art. 7) ; DSE v3.2 (30/04/2026), § 2.3.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195635 ; https://www.legifrance.gouv.fr/codes/id/LEGISCTA000046385428/2026-10-10 ; https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees
- **Citation.** « L'émission, la transmission et la réception des factures électroniques s'effectuent en recourant à une plateforme agréée. »
- **Fiabilité.** Élevée.

#### E6 — Les DOM : facture électronique ou e-reporting

- **Règle.** Un fournisseur établi en métropole :
  - envoie une **facture électronique** à un client assujetti établi en Guadeloupe, en Martinique ou à La Réunion, bien que ces flux soient assimilés à des exportations pour la TVA des biens ;
  - fait un **e-reporting** pour un client assujetti établi en Guyane ou à Mayotte, où la TVA ne s'applique pas ;
  - fait un **e-reporting** pour un particulier ou un client non assujetti, où qu'il soit.
- **Chez Expedîle.** Professionnels de 974, 971, 972 et de métropole : facture électronique. Professionnels de 976 : e-reporting, facture envoyée par tout canal. Particuliers : e-reporting, facture PDF possible en parallèle.
- **Base légale.** BOI-TVA-DECLA-20-30-50-10 §§ 50, 160 à 190 (30/09/2026) ; FAQ DGFiP « DROM et COM » (version du 21/01/2026), section 4 ; FAQ « J'approfondis », questions 2.6 à 2.8 ; page impots.gouv.fr « Mes clients sont à la fois des entreprises et des particuliers ».
- **Sources.** https://bofip.impots.gouv.fr/doctrine/pgp/13898-PGP ; https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq_drom.pdf ; https://www.impots.gouv.fr/professionnel/questions/mes-clients-sont-la-fois-des-entreprises-et-des-particuliers-par-quel
- **Citation.** « Ces exportations ne sont toutefois pas visées par l’article 290 du CGI et ne doivent pas faire l’objet d’une transmission des données de transaction, mais d’une facture électronique conformément à l’article 289 bis du CGI » ; « En revanche, toutes mes opérations réalisées avec des clients en Guyane ou à Mayotte, où la TVA n’est pas applicable, entrent dans le champ du e-reporting. »
- **Fiabilité.** Élevée.

#### E7 — E-reporting des transactions

- **Règle.** L'e-reporting couvre les opérations non exonérées par les articles 261 à 261 E, notamment les prestations à des non-assujettis situées en France ou réputées hors de France (art. 259 B), les prestations à des assujettis non situées en France et les achats de services auprès de fournisseurs non établis en France. Ventes aux non-assujettis : données globalisées par jour, sans identité du client (SIREN du vendeur, période, option pour les débits, catégorie de transaction, base HT et taxe par taux, taxe due, devise, date). Catégories : TLB1 (biens taxables), TPS1 (services taxables), TNT1 (opérations non soumises à la TVA en France, dont les ventes à distance intracommunautaires et les services de l'art. 259 B), TMA1 (régimes de marge). Clients professionnels hors du champ de la facture électronique : données facture par facture, identiques à celles d'une facture électronique, avec un identifiant de substitution sans SIREN. Achats auprès de fournisseurs non établis : sans détail des lignes.
- **Chez Expedîle.** Totaux quotidiens des ventes aux particuliers par taux et par catégorie ; données facture par facture pour les professionnels de Mayotte et de l'étranger ; e-reporting des achats de logiciels ou d'hébergement à des fournisseurs étrangers. Le code de catégorie des services exonérés liés à l'exportation reste à confirmer (A21).
- **Base légale.** CGI art. 290, I (version en vigueur depuis le 21/02/2026 ; maintenu jusqu'à sa reprise réglementaire) ; CGI ann. II art. 242 nonies M, I et II (29/07/2026) ; ann. IV art. 41 septies L ; BOI-TVA-DECLA-20-30-50-10 §§ 20, 50, 60 ; BOI-TVA-DECLA-20-30-50-20 §§ 50 à 80 ; DSE v3.2, annexe 7, règle G1.68.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546668 ; https://bofip.impots.gouv.fr/doctrine/pgp/13899-PGP
- **Citation.** « les données attendues de l’assujetti pour ses opérations réalisées avec une personne non assujettie, qu’il s’agisse des opérations visées au I de l’article 290 du CGI (opérations réalisées par un assujetti établi en France) ou au II de l’article 290 du CGI (opérations réalisées par un assujetti non établi en France), sont globalisées par jour. »
- **Fiabilité.** Élevée.

#### E8 — Données de paiement

- **Règle.** Pour les opérations dont la TVA est exigible à l'encaissement (essentiellement les services), le fournisseur transmet les données de paiement, que l'opération ait donné lieu à facture électronique ou à e-reporting, sauf autoliquidation par le client. Pour une facture électronique : mise à jour du statut « Encaissée » par la plateforme d'émission (recommandée dans les 24 heures). Pour les ventes aux particuliers : données globalisées par jour et par taux. Transmission mensuelle, dans les dix jours suivant la fin du mois (régime réel normal). Le redevable ayant opté pour les débits n'est pas sanctionné pour l'absence de ces données.
- **Chez Expedîle.** Chaque encaissement (PayPlug, virement, espèces) et chaque remboursement est daté et rattaché à sa facture ou à son jour : ce sont ces données qui seront transmises.
- **Base légale.** CGI art. 290 A, I (version en vigueur depuis le 21/02/2026) ; CGI ann. II art. 242 nonies P ; ann. IV art. 41 septies G et P ; BOI-TVA-DECLA-20-30-60 §§ 1, 20, 30, 50, 110 à 190 (30/09/2026).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044045416 ; https://bofip.impots.gouv.fr/doctrine/pgp/13901-PGP
- **Citation.** « les émetteurs de factures transmettent les données de paiement de leur facture au moyen de la mise à jour du statut « Encaissée » de la facture par l’intermédiaire de la plateforme agréée choisie pour son émission. »
- **Fiabilité.** Élevée.

#### E9 — Fréquences, délais et dates qui déclenchent la transmission

- **Règle.** Données de transaction : régime réel normal mensuel, trois transmissions par mois ; réel normal trimestriel, une par mois ; régime simplifié (jusqu'au 31/12/2026), une par mois ; franchise, tous les deux mois ; chaque transmission dans les dix jours suivant la fin de la période ; décompte par plateforme ; rien à transmettre pour une période sans opération. Les données de transaction suivent la date de réalisation de l'opération, les données de paiement la date d'encaissement ; la plateforme de l'émetteur transmet les données d'une facture électronique dans les 24 heures de son dépôt. Au 01/01/2027, le régime simplifié disparaît : déclaration mensuelle, ou trimestrielle si le chiffre d'affaires n'a pas dépassé 1 000 000 € l'année précédente et 1 100 000 € l'année en cours. Au 10/10/2026, les tableaux de la DGFiP et l'article 242 nonies O ne sont pas encore mis à jour pour 2027.
- **Chez Expedîle.** La fréquence dépendra du régime de TVA 2027 (Q3). L'application conserve, pour chaque opération, la date de réalisation, la date d'encaissement et la date de dépôt.
- **Base légale.** CGI ann. II art. 242 nonies L et O (29/07/2026) ; ann. IV art. 41 septies M ; BOI-TVA-DECLA-20-30-50-30 §§ 50 à 100 (30/09/2026) ; CGI art. 287 (version à partir du 01/01/2027, loi n° 2025-127 art. 38) ; DSE v3.2, § 3.7.7.
- **Sources.** https://www.legifrance.gouv.fr/codes/id/LEGISCTA000046385428/2026-10-10 ; https://bofip.impots.gouv.fr/doctrine/pgp/13900-PGP ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051190827/2027-01-01
- **Citation.** « 1° Lorsqu'il est soumis au régime réel normal mensuel d'imposition prévu au 2 de l'article 287 du même code, à raison de trois transmissions par mois ; » ; « Les redevables déposent la déclaration prévue au 1 chaque trimestre civil lorsqu'ils n'ont pas réalisé un chiffre d'affaires majoré des acquisitions taxables supérieur à : a) 1 000 000 € pendant l'année civile précédente ; b) 1 100 000 € pendant l'année en cours. »
- **Fiabilité.** Élevée pour les textes en vigueur ; moyenne pour leur mise à jour en 2027.

#### E10 — Formats et Factur-X

- **Règle.** Les plateformes doivent traiter au moins : UBL ou CII au profil EN 16931 ou EXTENDED-CTC-FR, et le format mixte composé d'un XML CII (profil EN 16931 ou EXTENDED-CTC-FR) et d'un PDF/A-3 lisible, c'est-à-dire le principe de Factur-X ; la plateforme d'émission convertit au besoin. Les normes AFNOR XP Z12-012 (formats), XP Z12-013 (interfaces) et XP Z12-014 (cas d'usage) détaillent ces formats. Version courante de la spécification : Factur-X 1.09.2 / ZUGFeRD 2.5.2, publiée le 04/08/2026, effective le 01/09/2026, fondée sur CII D22B. Les profils MINIMUM et BASIC WL ne portent que l'en-tête et le pied ; le profil EN 16931 est le minimum sûr.
- **Chez Expedîle.** Factur-X au profil EN 16931 (PDF/A-3 avec XML CII), validé avec l'outil de la plateforme et le paquet officiel ; une facture électronique entrant dans la réforme passe toujours par la plateforme.
- **Base légale.** CGI ann. IV art. 41 septies C, I (version en vigueur depuis le 29/07/2026, arrêté du 27 juillet 2026 art. 1) ; page impots.gouv.fr « Spécifications externes et normes » (modifiée le 02/07/2026) ; FNFE-MPE ; FeRD.
- **Sources.** https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069576/LEGISCTA000046386156/2026-10-10/ ; https://fnfe-mpe.org/factur-x/ ; https://www.ferd-net.de/publikationen-produkte/publikationen/detailseite/zugferd-252-english
- **Citation.** « e) Un standard de format mixte composé d'un fichier de données structuré au format XML (UN/CEFACT CII), conforme au "profil EN16931" ou au "profil EXTENDED-CTC-FR" au travers de son profil "EXTENDED", conformément à la norme XP Z12-012 publiée sur le site internet de l'Association française de normalisation, et d'un fichier PDF constituant la représentation lisible de la facture (norme PDF/A3). »
- **Fiabilité.** Élevée pour les formats ; moyenne pour le choix du profil (aucun texte ne dit si BASIC est accepté).

#### E11 — Règles de gestion de la DGFiP

- **Règle.** Les plateformes appliquent les règles du dossier de spécifications externes v3.2 (30/04/2026) :
  - SIREN du vendeur et de l'acheteur obligatoires (schéma 0002) et présents dans l'annuaire ;
  - types de document : 380 facture, 386 facture d'acompte, 384 facture rectificative, 381 avoir (503 : avoir de facture d'acompte) ;
  - cadres de facturation : S1, S2 (facture déjà payée), S4 (facture définitive après acompte) ;
  - numéro de 35 caractères au plus, unique pour un même numéro, une même année et un même SIREN (contrôle bloquant) ;
  - catégories de TVA S, E, AE, K, G, O, Z ; taux admis dont 8.5 et 2.1 ;
  - motif d'exonération exigé avec la catégorie E ;
  - BT-8 (code 5 en CII) seulement en cas d'option pour les débits ;
  - 26 données obligatoires en 2026, 34 dès 2027 ;
  - rejet des données réglementaires d'une facture ne portant que des codes O et/ou E liés aux articles 261 à 261 E (sauf sphère publique).
- **Chez Expedîle.** Le générateur valide ces règles avant tout dépôt (I8) ; les caractères autorisés du numéro (règle G1.05) sont à vérifier.
- **Base légale.** DGFiP/AIFE, spécifications externes v3.2 : dossier général, annexes 1, 6 et 7 ; FAQ « Je découvre », question 6.3.
- **Source.** https://www.impots.gouv.fr/specifications-externes-b2b
- **Citation.** « [G1.63] Le SIREN du vendeur (BT-30) et de l'acheteur (BT-47) sont obligatoires et doivent exister dans l’annuaire. »
- **Fiabilité.** Élevée.

#### E12 — Jusqu'au 1er septembre 2027, et après

- **Règle.** Un PDF image envoyé par courriel n'est pas une facture électronique au sens de la réforme : celle-ci porte des données structurées et passe par une plateforme. Jusqu'à son échéance, une PME peut facturer ses clients professionnels comme d'habitude ; elle peut entrer plus tôt dans le dispositif, mais seulement par une plateforme ; un client ne peut pas lui imposer l'émission électronique avant son échéance, ni refuser une facture non électronique pour ce motif. Une facture refusée par l'acheteur et réémise prend un nouveau numéro. Une facture « refusée » ou « rejetée » donne lieu, chez le fournisseur, à une annulation comptable (avoir interne) sans flux de données vers le portail public. Un avoir renvoie aux factures antérieures (et à leur date, à partir de la phase cible).
- **Chez Expedîle.** Avant le 01/09/2027 : PDF/Factur-X par portail ou courriel (F19). Après : dépôt par la plateforme, suivi des statuts, numéro neuf après un refus.
- **Base légale.** CGI art. 289 bis ; page impots.gouv.fr « Est-ce qu'une facture envoyée par mail est une facture électronique ? » (modifiée le 16/01/2026) ; FAQ « Je découvre », questions 3.1, 5.2 et 5.3 ; guide pratique (juillet 2026), questions 12 et 17 à 20 ; DSE v3.2, règle G1.31 et tableau 8.
- **Sources.** https://www.impots.gouv.fr/professionnel/questions/est-ce-quune-facture-envoyee-par-mail-est-une-facture-electronique ; https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/guide_pratique_facturation_electronique.pdf
- **Citation.** « La facture de type image PDF (facture numérisée ou PDF générée à partir d’un outil bureautique) envoyée par mail n'est pas une facture électronique. » ; « La réforme ne donne pas à un client le pouvoir d’imposer, au titre de l’obligation légale de facturation électronique, une émission électronique à une entreprise dont l’échéance d’émission est fixée au 1er septembre 2027. »
- **Fiabilité.** Élevée.

#### E13 — Sanctions, tolérances et approche de démarrage

- **Règle.**
  - Ne pas émettre sous forme électronique une facture qui doit l'être : 50 € par facture, plafond de 15 000 € par année civile (15 € par facture avant la loi de finances 2026 ; le nouveau montant vaut pour les factures émises à partir de la date de la catégorie).
  - Ne pas recourir à une plateforme pour la réception : mise en demeure de trois mois, puis 500 €, nouvelle mise en demeure, puis 1 000 €, et 1 000 € après chaque nouvelle période de trois mois.
  - E-reporting manquant (transactions ou paiements) : 500 € par transmission, plafond de 15 000 € par an pour chaque catégorie, dans la version en vigueur au 10/10/2026 ; la version consolidée au 01/01/2027 indique 250 €, d'où une incertitude sur le montant applicable aux premières périodes d'Expedîle (A29).
  - Pas d'amende pour une première infraction de l'année et des trois années précédentes réparée spontanément ou dans les 30 jours d'une première demande (hors réception, qui a son propre mécanisme de mise en demeure).
  - Tolérance : si le client professionnel ne figure pas dans l'annuaire, ni l'émetteur ni le destinataire ne sont sanctionnés pour cette facture, et l'émetteur fait un e-reporting comme pour un non-assujetti. Aucune transmission « à blanc » n'est exigée.
  - Approche de démarrage de la DGFiP : pas de sanction pour une entreprise engagée dans une trajectoire sérieuse et documentée ; ce n'est ni un report ni une suspension, et l'entreprise doit produire des preuves datées (contrat de plateforme, tests, tickets, consignes internes).
- **Chez Expedîle.** Garder un dossier daté de mise en conformité (contrat, accord formel, tests, incidents). Prévoir 500 € par transmission tant que le montant 2027 n'est pas clarifié.
- **Base légale.** CGI art. 1737, III, IV bis et V (version du 21/02/2026 au 01/01/2027, loi n° 2026-103 art. 123) ; art. 1788 D, I, II et V (même période ; version au 01/01/2027 issue de l'ordonnance n° 2026-671 art. 2) ; loi n° 2026-103 art. 123, V ; BOI-TVA-DECLA-20-30-50-10 § 100 ; DSE v3.2 § 2.3.3 ; guide pratique (juillet 2026), introduction et questions 27 à 29 ; BOI-RES-TVA-000253 § 2.7.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546686 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546693 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195593/2027-01-02 ; https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/guide_pratique_facturation_electronique.pdf
- **Citation.** « III. - Le non-respect par l'assujetti de l'obligation d'émission d'une facture sous une forme électronique dans les conditions prévues à l'article 289 bis donne lieu à l'application d'une amende de 50 € par facture, sans que le total des amendes appliquées au titre d'une même année civile puisse être supérieur à 15 000 €. » ; « Il est précisé que pendant la phase de démarrage, il n'y aura pas d'application des sanctions aux entreprises rencontrant des difficultés dans la mise en œuvre de la réforme mais qui sont engagées dans une trajectoire sérieuse de mise en conformité. »
- **Fiabilité.** Élevée pour les montants en vigueur ; moyenne pour le montant de 2027.

#### E14 — Clients du secteur public

- **Règle.** Depuis le 01/09/2026, la facturation vers une entité publique, quelle que soit sa taille, obéit aux mêmes formats et données structurées que la facturation entre entreprises. Le fournisseur passe par une plateforme raccordée à Chorus Pro ou, provisoirement, par les canaux actuels de Chorus Pro.
- **Chez Expedîle.** Toute collectivité, administration ou établissement public client, y compris dans les DOM, est facturé par Chorus Pro (Q5).
- **Base légale.** FAQ « Je découvre », questions 11.1 et 11.2 ; CGI art. 290 B ; DSE v3.2 § 2.3.4.
- **Source.** https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq---fe_je-decouvre-la-facturation-electronique.pdf
- **Citation.** « Depuis le 1er septembre 2026, les obligations en matière de facturation électronique vers une entité publique (quelle que soit sa taille) seront identiques au cadre prévu pour les échanges inter-entreprises. »
- **Fiabilité.** Élevée.

#### E15 — Les données ne remplacent pas la déclaration de TVA

- **Règle.** La facturation électronique ne change pas les obligations déclaratives : les déclarations de TVA continuent selon le régime. L'administration collecte les données de facturation, de transaction et de paiement, notamment pour préremplir la TVA et moderniser son contrôle.
- **Chez Expedîle.** Factures, e-reporting, déclarations de TVA et comptabilité doivent concorder : c'est ce qu'un contrôleur rapprochera.
- **Base légale.** Page impots.gouv.fr « Avec la réforme de la facturation électronique, dois-je encore déposer des déclarations de TVA ? » (modifiée le 16/01/2026) ; FAQ « Je découvre », question 6.1 ; DSE v3.2 § 2.3.4.
- **Source.** https://www.impots.gouv.fr/professionnel/questions/avec-la-reforme-de-la-facturation-electronique-dois-je-encore-deposer-des
- **Citation.** « Oui. La facturation électronique n’a pas d’impact sur les obligations déclaratives. »
- **Fiabilité.** Élevée.

#### E16 — Ce qui reste hors du dispositif

- **Règle.** Les opérations hors du champ de la TVA sont exclues de la facture électronique et de l'e-reporting. Les documents qui ne sont pas des factures (pro forma, documents douaniers, relevés) restent hors du dispositif et s'échangent par tout canal.
- **Chez Expedîle.** Le document douanier de départ n'est pas une facture électronique s'il ne documente aucune vente ni prestation entre les deux entités (D17) ; s'il en documentait une entre deux assujettis établis en France, il entrerait dans l'article 289 bis.
- **Base légale.** FAQ « Je découvre », questions 1.2, 4.1 et 7.2.
- **Source.** https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq---fe_je-decouvre-la-facturation-electronique.pdf
- **Citation.** « Les documents autres que des factures ne sont pas dans le champ du dispositif »
- **Fiabilité.** Moyenne pour l'application au document douanier.

#### E17 — Expedîle Réunion

- **Règle.** Une entreprise assujettie établie en Guadeloupe, en Martinique ou à La Réunion relève des deux dispositifs : facture électronique et e-reporting.
- **Chez Expedîle.** Si Expedîle Réunion est une personne distincte, elle reçoit par plateforme depuis le 01/09/2026, émet selon sa propre catégorie et fait l'e-reporting de ses ventes aux particuliers et aux clients de Mayotte. Toute prestation réelle facturée entre Expedîle France et Expedîle Réunion est une facture électronique entre entreprises (Q8).
- **Base légale.** FAQ « J'approfondis », questions 2.6 et 2.7 ; BOI-TVA-DECLA-20-30-50-10 § 170.
- **Source.** https://www.impots.gouv.fr/foire-aux-questions-japprofondis-la-facturation-electronique
- **Citation.** « Si vous êtes un opérateur établi dans les départements de la Martinique, la Guadeloupe et La Réunion, vous êtes concernés par les deux dispositifs : facturation électronique et e-reporting. »
- **Fiabilité.** Élevée pour la règle ; l'application aux flux entre les deux entités dépend des faits.

### 2.5 Contrôle fiscal

#### C1 — Piste d'audit fiable : obligation et méthodes

- **Règle.** L'authenticité, l'intégrité et la lisibilité de chaque facture, papier ou électronique, s'assurent par l'une de quatre méthodes : des contrôles documentés et permanents établissant une piste d'audit fiable entre la facture et la prestation ; une signature électronique qualifiée ; un message structuré convenu entre les parties (EDI) ; un cachet électronique qualifié. Un PDF ou un Factur-X envoyé par courriel ou par le portail, sans cachet ni signature qualifiés, relève de la première méthode : la piste d'audit est alors obligatoire. L'authenticité est l'assurance de l'identité de l'émetteur ; la lisibilité est la possibilité de lire la facture sans difficulté, sur papier ou sur écran.
- **Chez Expedîle.** Piste d'audit pour toutes les factures et tous les avoirs émis, et pour les factures reçues des fournisseurs. Option : apposer un cachet électronique qualifié (eIDAS) sur chaque PDF, preuve forte d'origine et d'intégrité ; l'examen de la réalité des opérations reste entier.
- **Base légale.** CGI art. 289, V et VII (version en vigueur depuis le 31/12/2023 ; le VII est maintenu après le 01/01/2027 jusqu'à sa reprise réglementaire) ; BOI-TVA-DECLA-30-20-30-10 § 100 ; BOI-TVA-DECLA-30-20-30-20 § 30.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413 ; https://bofip.impots.gouv.fr/bofip/8862-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-10-20180207
- **Citation.** « 1° Soit sous forme électronique en recourant à toute solution technique autre que celles prévues aux 2°, 3° et 4°, ou sous forme papier, dès lors que des contrôles documentés et permanents sont mis en place par l'entreprise et permettent d'établir une piste d'audit fiable entre la facture émise ou reçue et la livraison de biens ou prestation de services qui en est le fondement ; »
- **Fiabilité.** Élevée.

#### C2 — Ce que la piste d'audit doit montrer

- **Règle.** La piste d'audit reconstitue dans l'ordre chronologique tout le processus de facturation, de son origine à la facture, et relie les documents entre eux ; elle est fiable quand l'administration peut relier les pièces entre elles et aux opérations réelles. Les contrôles vérifient que les données sont complètes, exactes et non modifiées, transmises à la bonne personne au bon moment, non traitées deux fois, porteuses des mentions obligatoires et correspondant à une opération réelle. Pour une petite entreprise, le rapprochement de la facture avec les documents commerciaux suffit, à condition de conserver et de tracer chacun d'eux, dans les deux sens. La piste peut inclure des documents de tiers, comme les relevés bancaires. Il faut aussi protéger les fichiers, prévoir la panne ou la perte de données, et éviter l'envoi accidentel de doublons.
- **Chez Expedîle.** Chaîne à tracer, dans les deux sens : réception du colis → mesures → demande et décision du client (avec la photographie des cartons) → devis versionné → acceptation ou paiement → affectation au départ → confirmation du départ (manifeste, documents de transport, déclaration d'export) → facture → avoirs → encaissements et remboursements → arrivée et livraison. Chaque étape a un identifiant stable, un horodatage, un auteur et une version (I2, I14).
- **Base légale.** BOI-TVA-DECLA-30-20-30-20 §§ 50 à 150 (version en vigueur depuis le 07/02/2018).
- **Source.** https://bofip.impots.gouv.fr/bofip/8865-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-20-20180207
- **Citation.** « Ainsi, chacun des éléments suivants doit être conservé et traçé : le devis qui devient le bon de commande, par la suite validé, le bon de livraison (avec l'impact des retours éventuels) et enfin la facturation (également avec l'impact des avoirs éventuels). Les contrôles établissant la piste d'audit doivent permettre de s'assurer que le passage de l'un à l'autre des documents précité est traçable dans les deux sens. »
- **Fiabilité.** Élevée.

#### C3 — Documenter les contrôles

- **Règle.** Les contrôles sont documentés : décrits, présentés et expliqués (qui contrôle quoi, quand et comment). La documentation s'établit à la mise en place de la piste, couvre chaque étape et se met à jour quand l'organisation change ; des contrôles électroniques se présentent sous forme électronique. Contenu attendu, surtout dans une grande entreprise : cartographie des applications et habilitations, structures des fichiers, tables de codification et paramètres, stockage et archivage, flux avec les tiers, alimentation de la comptabilité et contrôles de cohérence, liste des anomalies et procédures de correction. Une documentation synthétique peut suffire dans une PME ; une présentation orale avec démonstration, dans une très petite entreprise à un seul acteur.
- **Chez Expedîle.** Un dossier daté et versionné, en français : rôles et permissions ; modèle de données ; grilles tarifaire et fiscale avec dates de validité ; stockage privé et conservation ; flux avec PayPlug, Telegram, la douane, Expedîle Réunion et la plateforme agréée ; export comptable et rapprochements ; procédures de correction (avoirs, `revert_colis`, retrait de devis). Les versions anciennes sont conservées (I14).
- **Base légale.** BOI-TVA-DECLA-30-20-30-20 §§ 80, 90 et 180 à 220 ; LPF art. L13 D et L80 F.
- **Source.** https://bofip.impots.gouv.fr/bofip/8865-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-20-20180207
- **Citation.** « Toutefois, ces contrôles doivent être documentés c'est-à-dire être décrits, présentés et expliqués par l'entreprise. » ; « une documentation synthétique pourra être jugée suffisante dans les petites et moyennes entreprises (PME) »
- **Fiabilité.** Élevée.

#### C4 — Si la piste d'audit fait défaut

- **Règle.** Le contrôleur vérifie que les contrôles garantissent réellement authenticité, intégrité et lisibilité. Si la vérification est impossible ou si les contrôles échouent, les factures ne sont plus considérées comme des factures d'origine : la TVA facturée reste due par l'émetteur et la déduction du client peut être remise en cause (le client qui prouve la réalité de l'opération et dispose de ses propres contrôles n'est pas privé automatiquement de son droit).
- **Chez Expedîle.** Sans documentation ni liens entre les enregistrements, Expedîle ne peut pas prouver ses factures.
- **Base légale.** LPF art. L13 D (version du 01/01/2013 au 01/01/2027) et L13 E (version du 07/06/2013 au 01/01/2027) ; BOI-TVA-DECLA-30-20-30-50 §§ 20 à 110 (version en vigueur depuis le 07/02/2018).
- **Source.** https://bofip.impots.gouv.fr/bofip/8869-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-50-20180207
- **Citation.** « En cas d'impossibilité d'effectuer la vérification prévue à l'article L. 13 D ou si les contrôles mentionnés au 1° du VII de l'article 289 du code général des impôts ne permettent pas d'assurer l'authenticité de l'origine, l'intégrité du contenu et la lisibilité des factures, ces dernières ne sont pas considérées comme factures d'origine, sans préjudice des dispositions du 3 de l'article 283 du même code. »
- **Fiabilité.** Élevée.

#### C5 — Droit d'enquête sur la facturation

- **Règle.** Des agents au moins de grade contrôleur peuvent examiner factures, livres et documents professionnels ; lorsque la piste d'audit sécurise les factures, ils accèdent à tous les systèmes et documents qui constituent les contrôles et à leur documentation. Ils peuvent se rendre dans les locaux professionnels de 8 h à 20 h et pendant les heures d'activité, prendre copie par tout moyen, et exiger la présentation électronique de contrôles électroniques. Chaque intervention donne lieu à un procès-verbal. Ce n'est pas une procédure de contrôle de l'impôt.
- **Chez Expedîle.** Une personne présente dans les locaux de Paris doit pouvoir ouvrir, sans préavis, un accès en lecture à l'application (vue équipe, registre des factures, journal d'audit) et exporter des copies (I14).
- **Base légale.** LPF art. L80 F (version du 01/01/2013 au 01/01/2027) ; BOI-TVA-DECLA-30-20-30-50 § 70.
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000026949916
- **Citation.** « Si les contrôles prévus au 1° du VII du même article 289 sont effectués sous forme électronique, les assujettis sont tenus de les présenter sous cette forme. »
- **Fiabilité.** Élevée.

#### C6 — Droit de communication et amende de 10 000 €

- **Règle.** Les contribuables tenus à la comptabilité commerciale communiquent sur demande leurs livres, registres et tous documents relatifs à leur activité, sur place ou par correspondance, y compris électronique, quel que soit le support. Refuser, faire obstacle, ne pas tenir les documents ou les détruire avant les délais : 10 000 € par demande.
- **Chez Expedîle.** Exports par période et par client de tous les documents produits par l'application ; aucune purge avant la fin de la conservation (F22).
- **Base légale.** LPF art. L85 (en vigueur depuis le 01/01/2015) et L81 (version en vigueur depuis le 27/06/2026, loi n° 2026-534 art. 85) ; CGI art. 1734 (version en vigueur depuis le 01/01/2024).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030059624 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048651374
- **Citation.** « Une amende de même montant est applicable en cas d'absence de tenue de ces documents ou de destruction de ceux-ci avant les délais prescrits. »
- **Fiabilité.** Élevée.

#### C7 — Comptabilité informatisée : l'application est contrôlable

- **Règle.** Lorsque la comptabilité est informatisée, le contrôle porte sur toutes les données et tous les traitements qui concourent, directement ou indirectement, aux résultats et aux déclarations, et sur leur documentation ; les systèmes de gestion des ventes et des encaissements en font partie, qu'ils soient développés en interne ou par des tiers. Le contrôleur peut avoir besoin des versions archivées des programmes. La documentation (conception, spécifications, architecture, maintenance, exploitation, guides) est tenue en français, l'anglais étant toléré si une traduction peut être fournie rapidement ; pour un système simple, le code source peut suffire. Il faut conserver les données élémentaires, pas seulement les totaux : mouvements (commandes, livraisons, factures, devis) et référentiels (clients, tarifs, tables de codes de l'année) ; les tables de paramètres, comme les codes TVA, sont elles-mêmes des données élémentaires.
- **Chez Expedîle.** Le moteur de devis (`domain/quote.js`, `save_quote`), les fonctions de paiement, la facturation et les exports sont dans le périmètre. Chaque déploiement en production est étiqueté ; chaque devis et chaque facture enregistre la version de code et la version de grille qui l'ont produit ; les règles de calcul sont décrites en français, version par version (I2, I14).
- **Base légale.** LPF art. L13, IV (version du 01/01/2024 au 01/01/2027) ; BOI-BIC-DECLA-30-10-20-40 §§ 180, 190, 210, 230, 260, 290 à 350, 470 à 490 (version en vigueur depuis le 20/07/2018) ; LPF art. L102 B, II.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048838925 ; https://bofip.impots.gouv.fr/bofip/2899-PGP.html/identifiant=BOI-BIC-DECLA-30-10-20-40-20180720
- **Citation.** « Selon les nécessités du contrôle, il peut s’avérer nécessaire d’accéder aux versions archivées des programmes, afin de réaliser les tests nécessaires à la validation ou à la compréhension des résultats produits ou de la documentation présentée. »
- **Fiabilité.** Élevée.

#### C8 — FEC et traitements informatiques du contrôleur

- **Règle.** Au début d'une vérification de comptabilité, l'entreprise remet une copie de son fichier des écritures comptables au format réglementaire : un fichier par exercice, tous journaux confondus, écritures classées par ordre chronologique de validation, avec 18 champs obligatoires (dont numéro d'écriture sur une séquence continue, référence et date de la pièce, date de validation, compte et compte auxiliaire), nommé SirenFECAAAAMMJJ. À défaut : 5 000 € ou, si c'est plus, 10 % des droits rappelés. Pour des traitements informatiques, l'entreprise choisit entre un traitement sur son matériel, un traitement par elle-même, ou la remise de copies de fichiers dans les quinze jours, en fichiers à plat accompagnés de la description de leurs champs. En examen de comptabilité à distance, le FEC s'envoie dans les quinze jours (5 000 € à défaut).
- **Chez Expedîle.** Le FEC vient du logiciel comptable d'Expedîle France, pas de l'application. L'export des ventes l'alimente de sorte que chaque écriture de vente porte le numéro de facture ou d'avoir comme référence de pièce, la date de facture comme date de pièce et le compte auxiliaire du client ; les encaissements se lettrent. Contrôle : chaque facture du registre se retrouve dans le FEC, et inversement. Préparer des exports à plat documentés en français pour les dossiers, devis, factures, avoirs, paiements, départs, douane, taux et journal d'audit (I13).
- **Base légale.** LPF art. L47 A, I et II (version du 25/10/2018 au 01/01/2027) ; LPF art. A47 A-1 et A47 A-2 (en vigueur depuis le 02/08/2013) ; LPF art. L47 AA ; CGI art. 1729 D, I et II (version en vigueur depuis le 01/01/2017) ; BOI-CF-IOR-60-40 § 20.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037526053 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033815103
- **Citation.** « Le défaut de présentation de la comptabilité selon les modalités prévues au I de l'article L. 47 A du livre des procédures fiscales entraîne l'application d'une amende égale à 5 000 € ou, en cas de rectification et si le montant est plus élevé, d'une majoration de 10 % des droits mis à la charge du contribuable. »
- **Fiabilité.** Élevée.

#### C9 — Écritures irréversibles et documents de procédure comptable

- **Règle.** Une écriture validée ne se modifie ni ne se supprime : on corrige par une nouvelle écriture. Une procédure de clôture périodique fige la chronologie ; une opération datée d'une période close s'enregistre au premier jour de la période ouverte avec sa date réelle. Le chemin de révision relie chaque écriture à sa pièce ; la piste d'audit relie la facture à l'opération réelle. Les articles du plan comptable cités par la doctrine de 2018 (911-3, 921-3, 921-4, 922-1) sont renumérotés 1011-3, 1031-3, 1031-4 et 1032-1 pour les exercices ouverts depuis le 01/01/2025. Le commerçant établit un document décrivant ses procédures et son organisation comptables lorsqu'il est nécessaire pour comprendre le système et le contrôler ; chaque enregistrement indique l'origine, le contenu, l'imputation et la référence de la pièce justificative ; des livres électroniques sont identifiés et datés dès leur établissement par des moyens offrant toute garantie de preuve.
- **Chez Expedîle.** L'export comptable est déterministe et rejouable ; un lot exporté est numéroté, daté, doté d'une empreinte et n'est plus modifié après import ; un élément tardif part dans la période ouverte suivante. Un document de procédures comptables décrit la chaîne application → export → comptabilité (I13).
- **Base légale.** BOI-BIC-DECLA-30-10-20-40 §§ 80 à 150 ; BOI-TVA-DECLA-30-20-30-20 §§ 160-170 ; règlement ANC n° 2022-06, art. 24 ; C. com. art. R123-172, R123-173 et R123-174.
- **Sources.** https://bofip.impots.gouv.fr/bofip/2899-PGP.html/identifiant=BOI-BIC-DECLA-30-10-20-40-20180720 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006257926
- **Citation.** « Les fonctions d’un logiciel qui permettent la suppression d’une écriture validée ou sa modification s’opposent au principe d’irréversibilité de l’enregistrement des écritures comptables. A ce titre, l’utilisation de telles fonctions est prohibée. »
- **Fiabilité.** Élevée.

#### C10 — Présenter les justificatifs, en français

- **Règle.** Le contribuable présente à toute réquisition les documents comptables, inventaires, copies de lettres, pièces de recettes et de dépenses qui justifient ses résultats ; une comptabilité tenue en langue étrangère s'accompagne d'une traduction certifiée par un traducteur juré.
- **Chez Expedîle.** Comptabilité, exports et dictionnaires de champs en français ; les pièces (devis, factures, preuves de paiement, documents de transport et de douane) se retrouvent à partir de chaque écriture.
- **Base légale.** CGI art. 54 (version en vigueur depuis le 30/12/1989) ; LPF art. L47 A, I.
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006307742
- **Citation.** « Si la comptabilité est tenue en langue étrangère, une traduction certifiée par un traducteur juré doit être représentée à toute réquisition de l'administration. »
- **Fiabilité.** Élevée.

#### C11 — Délai de reprise de l'administration

- **Règle.** Pour la TVA, l'administration peut rectifier jusqu'à la fin de la troisième année suivant celle où la taxe est devenue exigible ; dix ans en cas de flagrance fiscale ou d'activité occulte. Les durées de conservation (F22) sont plus longues.
- **Chez Expedîle.** Les opérations de 2026 restent contrôlables jusqu'au 31/12/2029 dans le cas ordinaire.
- **Base légale.** LPF art. L176 (version du 01/01/2023 au 01/01/2027 ; même durée dans la version 2027).
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038595822
- **Citation.** « Pour les taxes sur le chiffre d'affaires, le droit de reprise de l'administration s'exerce jusqu'à la fin de la troisième année suivant celle au cours de laquelle la taxe est devenue exigible conformément aux dispositions du 2 de l'article 269 du code général des impôts. »
- **Fiabilité.** Élevée.

#### C12 — Logiciel de caisse : obligation et champ

- **Règle.** Un assujetti qui réalise des opérations ne donnant pas lieu à facturation selon l'article 289 (en pratique, avec des particuliers) et les enregistre dans un logiciel ou un système de caisse doit utiliser un système qui garantit l'inaltérabilité, la sécurisation, la conservation et l'archivage des données, attesté par un certificat d'organisme accrédité ou une attestation individuelle de l'éditeur ; depuis le 27/06/2026, les données archivées se restituent au format fixé par l'administration. Un système de caisse est tout logiciel qui enregistre des paiements hors comptabilité, sans écriture comptable concomitante, automatique et obligatoire. Un logiciel de gestion qui suit les encaissements des particuliers en fait partie ; facturer volontairement les particuliers n'en sort pas ; les logiciels développés en interne sont visés ; seule la fonction d'encaissement d'un logiciel multifonction doit être sécurisée. Une entreprise mandatée pour encaisser pour le compte d'un assujetti est aussi concernée.
- **Chez Expedîle.** L'application enregistre les paiements PayPlug des particuliers (`confirm_payplug_payment`) et les paiements manuels (`mark_manual_payment`) : sa fonction d'encaissement est très probablement un système de caisse, sauf dispense (C13). Si Expedîle Réunion encaisse pour Expedîle France, son système est concerné aussi (Q23).
- **Base légale.** CGI art. 286, I-3° bis (version en vigueur depuis le 27/06/2026, loi n° 2026-534 art. 87 ; maintenu après le 01/01/2027 jusqu'à sa reprise ; CIBS L. 216-40) ; BOI-TVA-DECLA-30-10-30 §§ 1, 10, 30, 40, 45 (version du 25/03/2026).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054337091 ; https://bofip.impots.gouv.fr/bofip/10691-PGP.html/identifiant=BOI-TVA-DECLA-30-10-30-20260325
- **Citation.** « Ainsi, un logiciel de gestion qui permet de suivre les encaissements perçus en contrepartie des opérations de ventes ou de prestations de services qui concernent les non assujettis à la TVA (clients particuliers) doit être sécurisé. » ; « Un assujetti qui décide de délivrer des factures à un particulier, bien que la réglementation fiscale ne l’y oblige pas, demeure néanmoins tenu de respecter l’obligation de sécurisation de son logiciel ou système de caisse. »
- **Fiabilité.** Élevée.

#### C13 — Dispenses du logiciel de caisse : probablement indisponibles

- **Règle.** Sont dispensés : les assujettis en franchise, ceux au remboursement forfaitaire agricole, et ceux qui réalisent exclusivement des opérations exonérées. Par tolérance, l'est aussi l'assujetti dont tous les paiements, pour toutes ses ventes, passent directement par un établissement de crédit (ou une banque de l'Union soumise à l'échange automatique d'informations). La tolérance tombe dès qu'une partie des ventes, même minime, est payée autrement, ou si le prestataire de paiement n'a pas ce statut. Les terminaux de paiement et les prestataires de services de paiement ne sont pas eux-mêmes des systèmes de caisse. Un site qui n'accepte que les moyens de paiement d'un prestataire de paiement n'est dispensé que si ce prestataire remplit la condition ; un site qui accepte des paiements par carte ou virement proposés par des banques qualifiées est dispensé même s'il passe par un prestataire pour les gérer.
- **Chez Expedîle.** Le registre officiel REGAFI de l'ACPR (consulté le 10/10/2026) classe PAYPLUG ENTERPRISE (SIREN 443222682) comme établissement de paiement, non comme établissement de crédit. L'application prévoit aussi les espèces et le virement. La tolérance est donc probablement indisponible. La dispense pour opérations « exclusivement exonérées » tombe dès qu'une ligne est taxable (marchandises qui ne partent pas, T13). Conclusion : certification à prévoir (C15), sauf démonstration contraire (Q11, A33).
- **Base légale.** CGI art. 286, II-2 ; BOI-TVA-DECLA-30-10-30 §§ 25, 30 à 37.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054337091 ; https://bofip.impots.gouv.fr/bofip/10691-PGP.html/identifiant=BOI-TVA-DECLA-30-10-30-20260325
- **Citation.** « Cette mesure de tempérament ne s’applique pas : - dès lors qu’une partie des ventes ou prestations est payée par un autre moyen, quelle que soit l’importance de cette partie ; »
- **Fiabilité.** Moyenne (dépend du contrat PayPlug et des moyens de paiement réellement acceptés).

#### C14 — Conditions techniques du logiciel de caisse

- **Règle.** Chaque transaction s'enregistre ligne par ligne : numéro du justificatif, date à la minute, total TTC, détail des prestations (libellé, quantité, prix unitaire, total HT, taux de TVA), données de paiement et traces des corrections ; le numéro de caisse n'est pas exigé pour un logiciel de facturation doté d'une fonction de caisse. Les données sont inaltérables (aucune fonction de modification ; empreinte, chaînage ou signature) ; les corrections se font par des opérations de « plus » et de « moins », elles-mêmes enregistrées et inaltérables, jamais en modifiant l'origine. Les modes école ou test sont marqués « factice » ou « simulation ». Un logiciel de facturation est dispensé des clôtures s'il fournit à la demande le chiffre d'affaires d'une période. Archivage au moins annuel, qui fige les données et leur donne date certaine, en format ouvert avec une notice en français, traçable, lisible même après changement de logiciel ; l'archivage n'est pas une sauvegarde.
- **Chez Expedîle.** Paiements, remboursements et factures en ajout seul ; empreintes chaînées ; aucun droit `UPDATE` ou `DELETE` sur ces tables ; données de test marquées « simulation » et séparées de la production ; total par période à la demande ; archive annuelle signée (I11, I12). Le format de restitution exigé depuis le 27/06/2026 n'est pas encore publié (A33).
- **Base légale.** BOI-TVA-DECLA-30-10-30 §§ 50, 80 à 150, 155 à 260 ; CGI art. 286, I-3° bis, second alinéa.
- **Source.** https://bofip.impots.gouv.fr/bofip/10691-PGP.html/identifiant=BOI-TVA-DECLA-30-10-30-20260325
- **Citation.** « Si des corrections sont apportées à ces données, que ce soit au moyen du logiciel ou système de caisse lui-même ou d’un dispositif externe au logiciel ou système de caisse, ces corrections (modifications ou annulations) s’effectuent par des opérations de « plus » et de « moins » et non par modification directe des données d’origine enregistrées. »
- **Fiabilité.** Élevée.

#### C15 — Preuve de conformité : certificat obligatoire pour un logiciel maison

- **Règle.** La loi de finances pour 2026 a rétabli, depuis le 21/02/2026, l'attestation individuelle de l'éditeur à côté du certificat. Mais lorsque le logiciel est développé par l'assujetti pour ses propres besoins, seul un certificat d'un organisme accrédité est admis, sauf si son activité déclarée, réelle et corroborée est l'édition de logiciels (le code NAF ne suffit pas). Le certificat couvre la version en service ; une modification qui touche la sécurisation des données (nouvelle version majeure) exige un nouveau certificat. Le délai qui reportait la certification au 01/09/2026 est expiré.
- **Chez Expedîle.** Si Expedîle France développe elle-même l'application, elle en est l'éditeur et doit faire certifier la fonction d'encaissement par un organisme accrédité (art. L433-4 du code de la consommation). Isoler et figer ce module pour que les déploiements fréquents ne remettent pas le certificat en cause. Autres voies : un éditeur distinct dont l'activité réelle est l'édition de logiciels et qui délivre l'attestation, ou un module d'encaissement tiers déjà certifié (Q12).
- **Base légale.** BOFiP ACTU-2026-00073 (25/03/2026) ; ACTU-2025-00160 (01/10/2025) ; BOI-TVA-DECLA-30-10-30 §§ 270, 300 à 340 et 375.
- **Sources.** https://bofip.impots.gouv.fr/bofip/15035-PGP.html/ACTU-2026-00073 ; https://bofip.impots.gouv.fr/bofip/10691-PGP.html/identifiant=BOI-TVA-DECLA-30-10-30-20260325 ; https://bofip.impots.gouv.fr/bofip/14826-PGP.html/ACTU-2025-00160
- **Citation.** « En dehors de cette exception, lorsque le logiciel ou système est développé par l’assujetti lui-même pour ses besoins propres, ce dernier ne pourra justifier que son logiciel ou système satisfait à l’obligation prévue au 3° bis du I de l’article 286 du CGI que par la production d’un certificat délivré par un organisme accrédité dans les conditions précisées au III-A § 320 à 340. »
- **Fiabilité.** Élevée.

#### C16 — Sanctions et visites inopinées

- **Règle.** Ne pas justifier par le certificat ou l'attestation : 7 500 € par logiciel ou système ; l'entreprise a ensuite 60 jours pour se mettre en conformité, faute de quoi l'amende peut s'appliquer de nouveau ; l'administration n'a pas à prouver un usage frauduleux. Depuis le 27/06/2026, des agents peuvent venir sans préavis vérifier la détention d'un certificat pour chaque logiciel, se faire présenter les terminaux ou systèmes de paiement électronique et relever les comptes bancaires qui reçoivent les fonds ; l'entreprise a 30 jours pour produire le certificat. Ne pas présenter tout ou partie des terminaux : 7 500 € par appareil.
- **Chez Expedîle.** Tenir à jour la liste des moyens d'encaissement : compte marchand PayPlug, comptes bancaires de versement, éventuel terminal à l'entrepôt ; garder le certificat et l'identification de la version en service accessibles depuis l'application. La qualification d'un compte PayPlug en ligne comme « système de paiement électronique » n'est pas encore précisée (A33).
- **Base légale.** CGI art. 1770 duodecies (version du 21/02/2026 au 01/01/2027) ; LPF art. L80 O (version du 27/06/2026 au 01/01/2027, loi n° 2026-534 art. 87) ; CGI art. 1770 quaterdecies (créé par la loi n° 2026-534 art. 87) ; BOI-CF-INF-20-10-20 §§ 550 à 580 ; BOI-CF-COM-20-60 §§ 10 à 180 (25/03/2026).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546759 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054337073 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054319888
- **Citation.** « [...] est sanctionné par une amende de 7 500 € par logiciel ou système de caisse concerné. » ; « Le fait, pour une personne assujettie à la taxe sur la valeur ajoutée disposant de terminaux ou de systèmes de paiement électronique pour encaisser les paiements de ses clients, de ne pas les présenter ou de n'en présenter qu'une partie aux agents intervenant en application de l'article L. 80 O du livre des procédures fiscales entraîne l'application d'une amende de 7 500 € par appareil non présenté. »
- **Fiabilité.** Élevée.

#### C17 — Concepteurs et éditeurs de logiciels

- **Règle.** Ceux qui conçoivent ou éditent des logiciels de comptabilité, de gestion ou de caisse présentent à l'administration, sur demande, codes, données, traitements et documentation. Ils les conservent jusqu'à la fin de la troisième année suivant l'arrêt de la diffusion du logiciel. Manquement : 10 000 € par logiciel vendu ou par client servi dans l'année.
- **Chez Expedîle.** L'article L96 J vise celui qui conçoit l'application ; l'article L102 D est écrit pour des logiciels diffusés, son application à un outil purement interne est incertaine (A34). Conserver le dépôt de code et sa documentation dix ans couvre les deux cas.
- **Base légale.** LPF art. L96 J (version en vigueur depuis le 01/05/2026, ordonnance n° 2026-265 art. 6) et L102 D (en vigueur depuis le 08/12/2013) ; CGI art. 1734, al. 3 ; BOI-CF-COM-10-10-30 § 60.
- **Source.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053881338
- **Citation.** « Les entreprises ou les opérateurs qui conçoivent ou éditent des logiciels de comptabilité, de gestion ou des systèmes de caisse ou interviennent techniquement sur les fonctionnalités de ces produits affectant, directement ou indirectement, la tenue des écritures mentionnées au 1° de l'article 1743 du code général des impôts sont tenus de présenter à l'administration fiscale, sur sa demande, tous codes, données, traitements ou documentation qui s'y rattachent. »
- **Fiabilité.** Moyenne.

#### C18 — Paiements en espèces

- **Règle.** Une dette de plus de 1 000 € ne peut pas être payée en espèces (3 000 € en monnaie électronique) lorsque le débiteur a son domicile fiscal en France, DOM compris, ou agit pour une activité professionnelle. Amende jusqu'à 5 % des sommes payées en infraction ; débiteur et créancier en sont solidaires.
- **Chez Expedîle.** L'application prévoit le mode « Espèces » : `mark_manual_payment` enregistre le moyen de paiement et bloque, ou signale, les espèces au-delà de 1 000 € pour le montant de la dette ; tout encaissement en espèces fait aussi tomber la tolérance de C13.
- **Base légale.** Code monétaire et financier, art. L112-6, I (version en vigueur depuis le 15/06/2025), D112-3, I-1° (version en vigueur depuis le 01/10/2018) et L112-7 (version en vigueur depuis le 01/11/2017).
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051752373 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036824549 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033461943
- **Citation.** « Lorsque le débiteur a son domicile fiscal sur le territoire de la République française ou agit pour les besoins d'une activité professionnelle, à 1 000 euros pour les paiements effectués en espèces et à 3 000 euros pour les paiements effectués au moyen de monnaie électronique »
- **Fiabilité.** Élevée.

#### C19 — Sécuriser une position : doctrine opposable, rescrit, position de la douane

- **Règle.** L'administration ne peut pas rehausser un contribuable qui a appliqué un texte selon l'interprétation publiée dans sa doctrine. Saisie d'une demande écrite, précise et complète par un redevable de bonne foi, elle prend formellement position dans les trois mois ; cette position l'engage. La douane offre la même garantie pour les droits et taxes qu'elle perçoit (dont l'OM, l'OMR et la TVA à l'importation des non-identifiés), mais pas pour une question qui ne porte que sur le code des douanes de l'Union. La doctrine et les rescrits restent opposables après le transfert au CIBS.
- **Chez Expedîle.** Points à soumettre avant d'imprimer les lignes concernées : exonération du transport des achats propres des particuliers, surtout vers Mayotte (T8) ; débours et chaîne de mandats (D13) ; frais en cas de non-départ (T13). À la douane : redevable de l'OM, franchises, type de déclaration (D15, D16). Le texte vise une demande présentée par le redevable lui-même.
- **Base légale.** LPF art. L80 A (version en vigueur depuis le 12/08/2018) et L80 B, 1° (version en vigueur depuis le 29/07/2026) ; C. douanes art. L312-1, L312-3 et L312-5 (en vigueur depuis le 01/05/2026) ; BOI-RES-TVA-000253 § 2.1.
- **Sources.** https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037312533 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054674686 ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053805568
- **Citation.** « 1° Lorsque l'administration a formellement pris position sur l'appréciation d'une situation de fait au regard d'un texte fiscal ; elle se prononce dans un délai de trois mois lorsqu'elle est saisie d'une demande écrite, précise et complète par un redevable de bonne foi. »
- **Fiabilité.** Élevée.

#### C20 — Transfert de la TVA au CIBS le 1er janvier 2027

- **Règle.** Les règles de TVA passent du CGI au livre II du CIBS le 01/01/2027 (date reportée du 01/09/2026), à droit constant. Les règles de format des factures et de transmission électronique restent régies par le CGI ; les annexes II, III et IV restent applicables jusqu'à leur reprise réglementaire. Les renvois au CGI restent possibles dans les mentions des factures jusqu'au 30/06/2028. Le I-3, le IV et le VII de l'article 289 restent en vigueur jusqu'à leur reprise. Au 01/01/2027 : la conservation passe à l'article L102 B bis du LPF ; les factures relèvent notamment des articles L. 216-25 (définition, documents modificatifs), L. 216-26, L. 216-30 (obligation de facturer), L. 216-32 (acomptes), L. 216-33 à L. 216-36 (mentions, délais, mandat, formats), L. 216-38 (conservation), L. 216-40 (logiciels de caisse), L. 216-47 et L. 216-48 (e-reporting) du CIBS. Concordances utiles : 262, I-1° → L. 213-16 ; 262, II-14° → L. 213-27 ; 259, 1° → L. 211-92 ; 259, 2° → L. 211-93 ; 259 A, 4° → L. 211-76 ; 294 → L. 211-7 ; 295, 1-1° → L. 213-203 ; 296 → L. 213-151 ; 283, 3 → L. 212-9 ; 267, II-2° → L. 213-73.
- **Chez Expedîle.** Documents de 2026 : citer le CGI. À partir de 2027 : grille fiscale avec les deux références ; passage au CIBS avant le 30/06/2028. Certaines notes de concordance de Légifrance sont incohérentes (A36) : vérifier sur la table officielle avant d'imprimer un article du CIBS.
- **Base légale.** Ordonnance n° 2025-1247 du 17 décembre 2025, art. 15, 46 et 49, modifiée par l'ordonnance n° 2026-671 du 27 juillet 2026 ; BOFiP ACTU-2026-00126 (07/10/2026) ; BOI-RES-TVA-000253 (version du 07/10/2026), §§ 1.3, 2.1 à 2.4, 3.1 ; table de concordance officielle (Légifrance).
- **Sources.** https://bofip.impots.gouv.fr/bofip/15140-PGP.html/ACTU-2026-00126 ; https://bofip.impots.gouv.fr/bofip/14901-PGP.html/identifiant=BOI-RES-TVA-000253-20261007 ; https://www.legifrance.gouv.fr/contenu/Media/files/autour-de-la-loi/codification/tables-de-concordance/code-des-impositions-sur-les-biens-et-services/table-de-concordance_-cibs_avant-apres-ancienne-nouvelle.xlsx
- **Citation.** « L’entrée en vigueur du transfert des dispositions législatives recodifiées régissant la TVA au sein du code des impositions sur les biens et services est décalée du 1er septembre 2026 au 1er janvier 2027. En cohérence, la date jusqu’à laquelle les anciennes références au code général des impôts peuvent continuer à être utilisées est reportée du 31 décembre 2027 au 30 juin 2028. »
- **Fiabilité.** Élevée pour le principe ; moyenne pour les numéros du CIBS tirés des versions 2027 consolidées.

## 3. Questions de faits que la direction doit confirmer

Ces faits ne se trouvent dans aucun texte ; ils décident de la règle applicable. Chaque réponse se consigne, datée, avec ses pièces, dans le dossier de contrôle (I14).

| N° | Question | Ce que la réponse change | Règles |
|---|---|---|---|
| Q1 | Identité juridique d'Expedîle France : dénomination, forme, capital, SIREN et SIRET, ville du greffe (RCS), siège, numéro de TVA, EORI. Les mêmes données pour Expedîle Réunion : société distincte avec son SIREN, ou établissement d'Expedîle France ? | Mentions de toutes les factures et des devis ; nature des flux entre les deux entités (interne ou entre entreprises, donc facture électronique) ; organisation douanière | F6, F9, F10, E17, D17 |
| Q2 | Catégorie de taille d'Expedîle France (et d'Expedîle Réunion) au 01/01/2025 : effectif, chiffre d'affaires, total de bilan du dernier exercice clos ; appartenance à un assujetti unique | Date d'émission électronique et d'e-reporting : 01/09/2026 (déjà due) ou 01/09/2027 ; date des nouvelles mentions | E1, E2, F8 |
| Q3 | Régime de TVA (réel normal mensuel ou trimestriel, ou simplifié jusqu'au 31/12/2026), chiffre d'affaires 2025 et 2026, option pour les débits, situation et historique de crédit de TVA | Fréquence de l'e-reporting ; mention des débits ; données de paiement ; moment d'exigibilité ; exposition au contrôle des remboursements | E8, E9, F8, F15, T11 |
| Q4 | Plateforme agréée choisie pour la réception : nom, date du contrat, accord formel, inscription à l'annuaire ; plateforme prévue pour l'émission ; entrée volontaire anticipée ? | Risque de mise en demeure et d'amendes de réception ; preuves pour l'approche de démarrage | E3, E5, E13 |
| Q5 | Clientèle : part des particuliers et des professionnels ; lieu d'établissement de chaque professionnel (métropole, 971, 972, 974, 976, 973, autre État de l'Union, hors Union) ; SIREN et numéro de TVA ; associations non assujetties ; micro-entrepreneurs ; entités publiques | Facture électronique ou e-reporting ; autoliquidation éventuelle ; lieu des prestations ; SIREN du client ; Chorus Pro | E4, E6, E14, T3, F8 |
| Q6 | Qualification d'Expedîle France : transporteur, commissionnaire de transport agissant en son nom, intermédiaire au nom des clients, transitaire, commissionnaire en douane ? Contrats de transport (aérien ou maritime, groupage, transbordement de Mayotte par La Réunion, trajets routiers) | Plafond de 30 jours pour les professionnels ; fondement de l'exonération ; débours | F24, T10, T4, D11 |
| Q7 | Organisation douanière à destination : qui dépose les déclarations (Expedîle Réunion, commissionnaire, La Poste, transporteur express) ; numéro d'enregistrement RDE et EORI ; représentation directe, indirecte ou en son nom propre ; qui est importateur, destinataire réel, redevable de la TVA (mention G0008 ou numéro de TVA) ; une déclaration par client ou par départ ; type de déclaration utilisé depuis le 01/07/2026 ; mandats écrits existants | Débours possible ou prix ; redevable de l'OM et de la TVA à l'importation ; risques d'écrire « TVA » ou « octroi de mer » | D2, D8, D9, D12, D13, D16 |
| Q8 | La « facture commerciale » de départ sert-elle de document de valeur en douane ? Y a-t-il un transfert de propriété ou un prix entre les deux entités ? Des prestations réelles sont-elles facturées entre elles (dédouanement, manutention, livraison, stockage), dans quel sens ? | Redevable de la TVA à l'importation et de l'OM ; risque d'amende de 50 % ; facture électronique entre les deux entités ; prix de transfert | D17, E16, E17 |
| Q9 | Trois à cinq déclarations réelles par destination avec leur liquidation (bases et taux d'OM, d'OMR et de TVA ; montants ; date et référence de paiement ; franchise appliquée) ; adresse de destination finale portée sur la lettre de transport aérien ou le connaissement | Comparaison avec le devis ; montant exact des débours ; base de TVA (premier lieu de destination) ; seconde base d'exonération | D5, D6, D7, T6 |
| Q10 | Comptabilisation de l'OM, de l'OMR et de la TVA à l'importation encaissés et payés, dans les deux entités : comptes de tiers par client ou chiffre d'affaires ? Traitement des écarts entre estimation et liquidation | Condition des débours ; écritures de l'export comptable | D11, D14, I13 |
| Q11 | Moyens de paiement réellement acceptés et leur enregistrement : contrat PayPlug (entité contractante, qui fournit et acquiert le paiement par carte), virements, chèques, espèces (montants, qualité et résidence du payeur), terminal physique éventuel ; remboursements | Dispense du logiciel de caisse ; plafond des espèces ; visite des terminaux ; données de paiement | C13, C16, C18, E8 |
| Q12 | Qui développe et édite l'application (Expedîle France, une société d'édition distincte, le dirigeant, un prestataire) ; activité déclarée ; qui détient le code source et maîtrise les paramètres ; certificat existant ; identification des versions majeures et mineures | Certificat obligatoire ou attestation possible ; obligations des concepteurs | C15, C17 |
| Q13 | Hébergement : région du projet Supabase (base, fichiers, sauvegardes), Vercel, autres sous-traitants hors de l'Union ; accès en ligne possible pour l'administration ; déclaration déjà faite du lieu de stockage | Déclaration au SIE ; pays de stockage autorisés | F23 |
| Q14 | Comptabilité : logiciel, personne qui la tient, plan de comptes et journaux, dates d'exercice, production du FEC, document de procédures ; factures déjà émises avec un autre outil | FEC ; continuité de la numérotation ; document de procédures | C8, C9, F11 |
| Q15 | Définition contractuelle de la prestation et de son achèvement (départ, arrivée ou livraison) ; possibilité d'annuler un dossier après la facture de départ | Date de facture et date de réalisation ; avoirs ; date de l'e-reporting | F12, F16, E9 |
| Q16 | Liste complète des frais et du moment où ils sont facturés : stockage (notamment pendant une attente), mesure, reconditionnement, emballage, assurance, frais de paiement, abonnements, frais de dossier, retour, destruction, livraison finale, dédouanement à destination ; frais facturés si la marchandise ne part pas ; ventes de biens à part (cartons, emballages) | Ligne de TVA de chaque frais ; nature des opérations ; dispense « exclusivement exonérées » du logiciel de caisse | T4, T12, T13, T14, F8, C13 |
| Q17 | Assurance proposée : obligatoire ou facultative, incluse ou facturée en sus, assureur, statut d'intermédiaire | Frais accessoire ou opération d'assurance | T12 |
| Q18 | Conditions de paiement des professionnels : paiement par envoi avant départ, « 30 jours », « fin de mois » (fin du mois d'émission ?), facture mensuelle ; escompte ; taux des pénalités ; bons de commande | Factures d'acompte ; plafonds de délai ; mentions ; facture périodique | F13, F14, F24, F9 |
| Q19 | Conditions générales actuelles : acceptation de la facture électronique et du portail ; devis descriptif et détaillé ; mandat exprès, préalable et horodaté pour le dédouanement et le paiement des droits au nom du client, remboursement au coût exact, provision et régularisation, accord de subdélégation | Validité de la facture électronique ; note au consommateur ; débours ; représentation en douane | F19, F5, D11, D12, D14 |
| Q20 | Preuve d'exportation : déclaration d'expédition au départ de métropole (au nom de qui), capture de sa référence et de la preuve de sortie, conservation | Exonération du transport et des services liés | T7, T6 |
| Q21 | Sous-traitants de transport (compagnies, lignes, groupeurs, transporteurs routiers) : facturent-ils avec ou sans TVA ? Expedîle remet-elle des attestations ? | TVA d'amont et crédit de TVA | T9, T11 |
| Q22 | Codes SH à 8 chiffres des articles ; source et mise à jour des taux d'OM et d'OMR ; achats des clients TTC ou HT à l'export ; factures d'achat collectées ; franchises utilisées ; rapport habituel entre valeur des marchandises et prix du transport | Exactitude de l'estimation des taxes ; franchises ; mécanisme de 1993 | D5, D7, D15 |
| Q23 | Expedîle Réunion encaisse-t-elle des paiements pour le compte d'Expedîle France ? | Logiciel de caisse du mandataire | C12 |
| Q24 | Expedîle France ou Expedîle Réunion sont-elles représentants en douane enregistrés, opérateurs économiques agréés, identifiées à la TVA ? Quel régime de déclaration de TVA chacune dépose-t-elle ? | Représentation possible ; 6° de l'article 73 G ; solidarité pour la TVA à l'importation | D12, D9, T4 |
| Q25 | Qui rédige et tient à jour la description des contrôles ; quels rôles peuvent émettre un avoir ou annuler ; état des preuves existantes (journal d'audit, versions de code par déploiement, historique des taux, conservation des accords Telegram) | Documentation de la piste d'audit ; permissions | C2, C3, I14 |
| Q26 | Les environnements de test peuvent-ils créer des numéros de facture ou des paiements ? Date de mise en service du module de paiement et volumes mensuels d'encaissements | Marquage « simulation » ; intégrité de la numérotation ; ampleur de l'exposition | C14, F11 |

## 4. Décisions d'implémentation proposées

Ces décisions sont des propositions de conception, déduites des règles de la section 2. Elles ne sont pas des règles légales. Aucune n'est appliquée par ce document ; chacune suit le circuit habituel du projet (migration, commande serveur, mapping, écran, tests, recette, mise en production).

### I1 — Principes

- La base de données est la seule source : une facture existe quand la transaction qui l'écrit a réussi, avec l'identifiant et le numéro renvoyés par la base.
- Émission, numérotation et avoirs passent par des commandes serveur dédiées, jamais par une écriture directe ni par le navigateur.
- Aucune règle fiscale n'est écrite en dur : taux, mentions et fondements viennent d'une grille versionnée (I6). Une valeur marquée « à confirmer » n'a pas de valeur par défaut : l'émission s'arrête avec un message clair.
- Une donnée obligatoire manquante (SIREN d'un professionnel, adresse, identité d'Expedîle) bloque l'émission ; rien n'est inventé.
- « Émise », « mise à disposition », « envoyée » et « payée » restent des états distincts ; « envoyée » suppose une confirmation réelle du canal.

### I2 — Modèle de données

Le nom `factures` désigne déjà, dans l'application, les factures d'achat des clients. Les factures émises par Expedîle prennent donc des noms distincts (à valider) :

- `invoice_series` : code de série, année, dernier numéro attribué, justification écrite de la série (F11).
- `issued_invoices` : série, année, numéro et numéro complet ; type (facture 380, facture d'acompte 386, avoir 381, rectificative 384) ; identités figées du vendeur et du client au moment de l'émission (nom, adresse, SIREN, numéro de TVA, forme, capital, RCS) ; catégorie et lieu d'établissement du client ; dossiers (`colis`), départ (`envois`), version de devis (`quote_versions`) ; date et heure d'émission ; date de réalisation ou période ; devise ; totaux HT et TVA par taux, total TTC, acomptes imputés, net à payer ; mentions imprimées ; conditions de paiement (échéance, escompte, pénalités, indemnité de 40 €) ; références (facture d'origine pour un avoir, factures d'acompte pour une facture finale, bon de commande) ; version de la grille fiscale et version du code (identifiant git) ; chemin du fichier original, empreinte SHA-256, date de génération ; statut sur la plateforme (déposée, rejetée, refusée, encaissée) tenu à part du contenu.
- `issued_invoice_lines` : rang, nature (transport, stockage, manutention, reconditionnement, frais), désignation précise, quantité, unité, prix unitaire HT, montant HT, catégorie de TVA, taux, code et texte d'exonération, base légale, dossier, date de réalisation.
- `invoice_events` : journal en ajout seul (émission, génération du fichier, mise à disposition, envoi confirmé, duplicata, statut de plateforme, avoir lié), avec auteur, horodatage, données et empreinte chaînée (empreinte de l'événement précédent incluse).
- `paiements` (existant ; montant positif pour un paiement, négatif pour un remboursement) : ajouter le moyen normalisé (carte PayPlug, virement, chèque, espèces), la date d'encaissement, la référence de versement PayPlug, la qualité du payeur, le lien vers la facture ou l'avoir ; ajout seul, corrections par écritures de signe opposé (C14).
- `destination_tax_settlements` (montage A seulement) : dossier, provision encaissée, déclaration (numéro, date, bureau), déclarant et mode de représentation, OM, OMR et TVA liquidés, date de paiement au comptable public, écart, relevé adressé au client, compte de tiers.
- `tax_grid_versions` : grille fiscale (I6).

Protection : aucun droit `UPDATE` ni `DELETE` sur les factures émises, leurs lignes, leurs événements et les paiements (droits SQL et déclencheurs) ; un dossier qui porte un devis, un paiement ou une facture ne peut plus être supprimé. Dans les migrations du dépôt, `paiements`, `audit_actions` et `logs_statut` sont supprimés en cascade avec le dossier (`ON DELETE CASCADE`) : remplacer par une interdiction pour ces enregistrements.

### I3 — Numérotation sans trou

- Deux séries : `FP` pour les particuliers, `FE` pour les professionnels, justifiées par des règles de facturation différentes et, à partir de 2027, des modes d'émission différents (F11). Format `FP-2026-000123` : 14 caractères, sous la limite de 35 (E11) ; caractères autorisés à vérifier (règle G1.05).
- Factures d'acompte et avoirs prennent un numéro dans la série de leur catégorie de client ; le type les distingue. Cela évite d'avoir à justifier des séries supplémentaires.
- Attribution dans la transaction d'émission : verrou sur la ligne de la série (`SELECT … FOR UPDATE`), incrément, insertion de la facture, validation. Un échec annule tout, numéro compris. Pas de séquence PostgreSQL, qui peut sauter des valeurs après une annulation.
- Jamais de numéro pour un brouillon ; jamais de suppression ; contraintes d'unicité sur (série, année, numéro) et sur le numéro complet.
- Registre exportable par série : chaque numéro, sa date, son type, son statut ; contrôle automatique de continuité.
- Le document douanier de départ et les relevés de débours ont leurs propres références, hors des séries de factures.

### I4 — Émission par commande serveur

- `issue_departure_invoices(p_envoi_id, p_expected_manifest_version)` : appelée dans la transaction de `confirm_departure`, pour que jamais un dossier parti ne reste sans facture. Les prérequis (identités complètes, SIREN des professionnels, régime des taxes à destination fixé, grille applicable) sont vérifiés avant la confirmation, comme les contrôles de chargement actuels ; un dossier non facturable ne peut pas être confirmé dans le départ. Ce choix bloque un départ pour une donnée manquante : à valider par la direction.
- Une facture par dossier, idempotente (unicité dossier, type, départ). Entrées : instantané du devis enregistré (jamais recalculé), paiements, version de la grille, identité du client à l'émission, date du départ et version du manifeste.
- Particulier : facture `FP`, « payée le … par … » ; lignes des services d'Expedîle ; taxes à destination traitées selon le régime fixé par la direction, jamais comme une TVA d'Expedîle France (I7).
- Professionnel payant avant le départ : `issue_advance_invoice(p_paiement_id)` à l'enregistrement du paiement, puis facture finale au départ renvoyant à l'acompte, solde nul (F14).
- Professionnel à terme : facture au départ avec l'échéance dans les plafonds (F24).
- Facture périodique mensuelle des professionnels : seulement si la direction la choisit (Q18), à la fin du mois, une ligne datée par dossier (F13).
- Date de réalisation : celle que définissent les conditions générales (Q15), imprimée dès qu'elle est déterminée (F12).

### I5 — Avoirs, annulations, marchandises qui ne partent pas, impayés

- `issue_credit_note(p_invoice_id, p_lines, p_reason, p_expected_updated_at)` : avoir total ou partiel, avec son numéro, le numéro et la date de la facture d'origine, le motif et les montants HT et TVA ; permission dédiée ; le remboursement PayPlug ou manuel n'est enregistré qu'après l'avoir (F16).
- Marchandise qui ne part pas : avoir sur les lignes exonérées, puis facture des frais dus aux taux de T13 (lignes V11 à V14).
- Correction possible en moins de 30 jours après une demande de l'administration, pour bénéficier de l'absence d'amende sur une première infraction (F25).
- Facture impayée : jamais modifiée ; duplicata « facture impayée » ou état récapitulatif (F17).
- À partir de la facture électronique : facture refusée annulée en interne, nouvelle facture sous un nouveau numéro (E12).

### I6 — Grille fiscale paramétrable

- Table versionnée : nature de ligne × destination × catégorie de client (particulier ; professionnel établi en métropole, en Guadeloupe, en Martinique ou à La Réunion ; professionnel établi à Mayotte ; professionnel hors de France) × situation (marchandise expédiée ou non) → catégorie de TVA, taux, texte de la mention, base légale CGI (et CIBS à partir de 2027), fiabilité, date d'effet.
- Valeurs initiales : le tableau du 2.2 (lignes V1 à V18). Taux : 20 % (métropole), 8,5 % (971, 972, 974), aucun (976). Le taux réduit de 2,1 % ne concerne pas le transport de marchandises.
- Lignes sans valeur par défaut jusqu'à décision de la direction : assurance (V10), stockage d'un professionnel des DOM en cas de non-départ (V13), abonnements (V17), régime des taxes à destination (V18).
- Chaque modification garde son auteur et sa date ; chaque facture garde la version de grille appliquée.
- Avant le 30/06/2028 : mentions basculées sur les articles du CIBS.

### I7 — Taxes à destination (OM, OMR, TVA à l'importation)

- Aucune ligne libellée « TVA » ou « Octroi de mer » dans le corps ou le récapitulatif de TVA d'une facture d'Expedîle France ; la TVA à l'importation estimée ne s'ajoute jamais à la TVA de la facture (T16, D3).
- Le régime est un paramètre explicite, sans valeur par défaut, fixé par la direction après Q7, Q8 et Q10 :
  - **débours** (montage A confirmé) : le paiement se répartit entre le prix des services et une provision en compte de tiers ; après le dédouanement, un relevé de débours distinct de la facture donne, par dossier, la déclaration (numéro, date, bureau), le déclarant et la représentation, les montants liquidés d'OM, d'OMR et de TVA, la date de paiement, la provision reçue et l'écart remboursé ou réclamé (D14) ;
  - **prix** (montage C, ou conditions non réunies) : le montant fait partie du prix des services d'Expedîle, suit l'exonération du transport et se décrit sans les mots « TVA » ni « octroi de mer ».
- Devis : libellé « Estimation des taxes à l'importation (OM, OMR, TVA du DOM) » ; exclure l'OM et l'OMR de la base de la TVA estimée (D6, fiabilité élevée) ; traiter la valeur des marchandises après vérification sur des liquidations réelles (D7) ; limiter le transport de la base d'OM à l'entrée dans le DOM (D5) ; appliquer les franchises et la liste des produits exonérés par code SH (D15). Toute modification du moteur de devis est une décision de la direction : le calcul actuel n'est pas changé par ce document.
- Professionnels identifiés à la TVA : aucune TVA à l'importation encaissée par Expedîle ; le portail leur donne les références de leur déclaration pour la déduction (D10).

### I8 — PDF et Factur-X

- Fichier produit une seule fois, au serveur (fonction Edge), à partir des données enregistrées ; PDF/A-3 avec XML CII au profil EN 16931 (Factur-X 1.09.2) pour les professionnels ; PDF/A pour les particuliers (Factur-X possible).
- Stockage dans un compartiment privé, sous un nouveau chemin par document, jamais écrasé ; empreinte SHA-256 enregistrée ; jamais régénéré ; tout renvoi est un « Duplicata » (F18, F20).
- Contrôles avant émission : mentions du tableau du 2.1 selon la catégorie de client ; règles de la DGFiP (E11) ; validation par le schéma et les règles du paquet Factur-X officiel et par le validateur de la plateforme.
- Option : cachet électronique qualifié sur chaque PDF (C1).
- À partir du 01/09/2027 (PME) : dépôt des factures entre entreprises par l'API de la plateforme ; l'original est le fichier transmis ; statuts suivis.
- Choix du générateur PDF/A-3 compatible avec les fonctions Edge : à valider techniquement.

### I9 — Mise à disposition et envoi

- Le portail présente l'original numéroté ; les conditions générales prévoient la facture électronique ; l'application journalise l'acceptation ou le paiement qui la vaut (F19).
- L'avis au client suit le flux existant (`queue_message`, puis livraison) ; « envoyée » seulement après confirmation.
- Professionnels de Mayotte et de l'étranger : facture par tout canal, e-reporting à partir de 2027 ; entités publiques : Chorus Pro (E14).

### I10 — E-reporting et données de paiement (préparation de 2027)

- Agrégats quotidiens des ventes aux particuliers par taux et par catégorie ; données facture par facture pour les professionnels de Mayotte et de l'étranger ; données de paiement par facture (statut « Encaissée ») et par jour pour les particuliers ; achats auprès de fournisseurs non établis.
- Dates conservées : réalisation, encaissement, dépôt ; transmission par la plateforme choisie (E7 à E9).

### I11 — Encaissements sécurisés (logiciel de caisse)

- Isoler la fonction d'encaissement (paiements, remboursements, liens vers les factures) : tables en ajout seul, empreintes chaînées, données ligne par ligne, horodatage à la minute, moyen de paiement normalisé.
- Espèces : moyen enregistré ; blocage ou alerte au-delà de 1 000 € pour le montant de la dette (C18).
- Environnements de test : données marquées « simulation », jamais mêlées à la production.
- Total encaissé par période à la demande ; archive annuelle figée (format ouvert, notice en français, manifeste d'empreintes) ; version en service visible.
- Certification de ce module par un organisme accrédité, version majeure figée (C15), ou l'une des autres voies de C15.

### I12 — Conservation, hébergement, archives

- Dix ans pour tout, sans purge ; originaux électroniques gardés sous leur forme (F22, F23).
- Région d'hébergement documentée ; déclaration au SIE si le stockage est hors de France ; accès en lecture possible pour l'administration.
- Sauvegardes distinctes des archives annuelles ; contrôle périodique des empreintes.

### I13 — Export comptable et FEC

- Export déterministe par période : journal des ventes (factures et avoirs), journal des encaissements, débours en comptes de tiers. Chaque ligne porte le numéro de la pièce (facture, avoir ou paiement), sa date et le compte auxiliaire du client.
- Lot numéroté, daté, doté d'une empreinte, figé après import ; élément tardif dans la période ouverte suivante (C9).
- Rapprochements : registre des factures ↔ FEC ↔ déclarations de TVA ↔ versements PayPlug ↔ banque.
- Document de procédures comptables décrivant la chaîne application → export → comptabilité (C9).

### I14 — Dossier de contrôle exportable

Un export par période, en un geste, avec un dictionnaire des champs en français (fichiers à plat, C8) :

1. journal des ventes : factures et avoirs avec toutes leurs données, statut, empreinte et journal de mise à disposition ;
2. registre de numérotation par série ;
3. chaînes avoir → facture → remboursement ;
4. versions de devis avec la grille et les tarifs appliqués, et le motif de chaque invalidation ;
5. accords des clients (bouton Telegram ou action du portail, horodatage, cartons couverts) ;
6. paiements et remboursements (identifiant PayPlug, montant, devise, mode test ou réel, date, versement ; paiements manuels avec moyen, référence et auteur) ;
7. départs, manifestes, documents douaniers, preuves d'exportation, d'arrivée et de livraison ;
8. historique des paramètres, tarifs et taux, avec dates d'effet ;
9. journal d'audit (qui, quand, avant, après) et historique des habilitations ;
10. rapprochements chiffre d'affaires ↔ déclarations de TVA ↔ PayPlug ↔ banque ;
11. fichiers originaux et manifeste de leurs empreintes ;
12. description des contrôles (piste d'audit), documentation des traitements et versions de code.

Un rôle en lecture seule permet de présenter l'application à un agent sans préavis (C5).

| Question probable d'un contrôleur | Réponse et pièce | Règles |
|---|---|---|
| Remettez le FEC de l'exercice | FEC du logiciel comptable, alimenté par l'export des ventes (numéro de facture en référence de pièce) | C8, I13 |
| Pourquoi ce transport est-il facturé sans TVA ? | Mention de l'article 262, I-1° ; preuve d'exportation du dossier (lettre de transport ou connaissement, déclarations, livraison) | T4, T7 |
| Montrez tout ce qui justifie cette facture | Dossier de la facture : devis versionné, accord du client, paiement, départ, manifeste, pièces douanières, avoirs | C2, I14 |
| Votre numérotation est-elle continue ? | Registre de numérotation par série, contrôle de continuité | F11, I3 |
| Comment corrigez-vous une facture ? | Procédure d'avoir ; liste des avoirs reliés à leurs factures et remboursements | F16, I5 |
| Que représente ce montant de taxes à destination ? | Mandat, déclaration, liquidation, preuve de paiement, compte de tiers, relevé au client ; ou, s'il fait partie du prix, la grille et la mention appliquées | D11, D14, I7 |
| Pourquoi cette « facture commerciale » à Expedîle Réunion ? | Nature du document douanier, absence de vente, déclarant et déclarations | D17, I15 |
| Votre logiciel d'encaissement est-il certifié ? | Certificat et version en service, ou justification d'une dispense | C12 à C16, I11 |
| Où sont stockées vos factures ? Y a-t-il un accès en ligne ? | Hébergement et régions, accès en lecture, déclaration au SIE si hors de France | F23, I12 |
| Par quelle plateforme agréée recevez-vous vos factures ? | Contrat, accord formel, inscription à l'annuaire, date | E3, E5 |
| Montrez la documentation de vos contrôles | Dossier de piste d'audit daté et versionné | C3, I14 |
| Acceptez-vous des espèces ? | Journal des paiements par moyen ; contrôle du plafond de 1 000 € | C18, I11 |
| Justifiez votre crédit de TVA | Factures d'achat reçues par la plateforme, attestations de transport, rapprochement des déclarations | T9, T11 |
| Quels taux et paramètres s'appliquaient à telle date ? | Historique de la grille fiscale et des tarifs | C7, I6 |
| Quelle version du programme a calculé ce devis ? | Version de code enregistrée avec chaque devis et chaque facture | C7, I2 |

### I15 — Document douanier de départ

À arrêter avec le déclarant en douane avant toute modification du document en production (Q8, A18) : un titre qui ne le présente pas comme une facture de vente ; aucun numéro des séries `FP` ou `FE` ; aucune TVA ; chaque client désigné comme importateur et le marchand en ligne comme dernier vendeur ; ou une déclaration par client (D16, D17).

### I16 — Devis, conditions générales et mentions

- Devis PDF : SIREN, mention RCS et ville du greffe, siège, forme et capital (F10) ; taxes présentées comme des estimations de taxes à l'importation, par exemple « Estimation de la TVA à l'importation (DOM) » au lieu de « TVA » (T16, I7) ; devis descriptif et détaillé, daté (F5).
- Conditions générales : définition de la prestation et de son achèvement (F12) ; acceptation de la facture électronique et du portail (F19) ; mandat exprès de dédouanement et de paiement des droits au nom du client, remboursement au coût exact, provision et régularisation, accord de subdélégation (D11, D12, D14) ; délais des professionnels dans les plafonds, escompte, pénalités, indemnité de 40 € (F9, F24).

### I17 — Tests et recette

- Tests du domaine et assertions SQL (`pinta/supabase/tests`) : continuité de la numérotation sous émissions concurrentes ; aucun trou après une annulation ; refus de `UPDATE` et `DELETE` ; mentions complètes par catégorie de client ; application de la grille ligne par ligne (V1 à V18) ; avoirs et leurs références ; acompte puis facture finale ; duplicata ; validation Factur-X ; correspondance de l'export avec les champs du FEC ; archive annuelle et vérification des empreintes.
- Une recette locale ne prouve pas un déploiement : migrations, fonctions, secrets et plateforme s'activent ensemble dans l'environnement cible.

## 5. Points à confirmer et sources

### 5.1 À confirmer

Ces points ne sont tranchés par aucune source vérifiée. Ils ne sont pas présentés comme des règles.

| N° | Point ouvert | Comment le trancher | Règles |
|---|---|---|---|
| A1 | Quand la prestation est-elle « réalisée » : départ, arrivée ou livraison ? Cela fixe la date limite de facture, la date de réalisation à imprimer, le fait générateur et la date d'e-reporting | Définir la prestation et son achèvement dans les conditions générales (Q15) | F12, E9 |
| A2 | Note au particulier qui paie d'avance : l'arrêté exige la note avant le paiement ; aucun texte ne règle les prestations payées d'avance. Option 1 : devis descriptif et détaillé remis et accepté avant le paiement, puis facture tenant lieu de note au départ. Option 2 : un document à l'encaissement renvoyant au devis, puis la facture au départ, en évitant deux factures pour une même opération | Décision de la direction ; aucune option n'est validée par un texte | F5, F4 |
| A3 | Exonération du transport des achats propres des particuliers (remarque du § 60 contre le § 280 sur les déménagements), surtout vers Mayotte, sans seconde base | Rescrit (LPF L80 B, 1°) | T8, C19 |
| A4 | Livraison finale par route dans 971, 972, 974, comprise dans le prix porte-à-porte : article 262, I-1°, ou seulement article 262, II-14° jusqu'au premier lieu de destination ? | Adresse portée sur les documents de transport (Q9) ; rescrit si besoin | T5, T6 |
| A5 | Franchises de 22 € et 400 € : l'article 262, II-14° joue-t-il encore ? Les achats propres d'un client qui se les expédie sont-ils des envois entre particuliers non commerciaux ? | Position formelle de la douane (C. douanes L312-3) | D15, T6 |
| A6 | Stockage facturé à un professionnel des DOM quand la marchandise ne part pas : 8,5 % (taux du client) ou 20 % (tolérance du § 140, qui ne cite pas le stockage) ? | Rescrit | T13 |
| A7 | Abonnements : prestation distincte taxable ou avance sur des prestations exonérées ? | Décrire l'abonnement ; rescrit | V17 |
| A8 | Assurance facultative : accessoire du transport ou opération d'assurance exonérée sans droit à déduction ? Expedîle est-elle intermédiaire d'assurance ? | Contrat d'assurance (Q17) | T12 |
| A9 | Clients établis hors de France (Union ou hors Union) : lieu des prestations, mention « Autoliquidation », e-reporting | Recenser ces clients (Q5) ; règles à rechercher | T3, E7 |
| A10 | Mention pour un professionnel établi à Mayotte : aucune formule prescrite pour une opération hors champ ; la formule proposée est-elle acceptée par le logiciel comptable ? | Choix de la direction | V4 |
| A11 | « TVA » du devis : redevable, débours possible avec des montants figés au devis, base qui inclut l'OM et l'OMR, pratique réelle de liquidation, maintien de la réponse de 1993 | Déclarations réelles (Q9) ; question au pôle d'action économique de la douane | D6, D7 |
| A12 | Expedîle France peut-elle présenter comme débours des droits payés par Expedîle Réunion ou un commissionnaire, par une chaîne de mandats ? | Rescrit | D13 |
| A13 | Une ligne de débours portant les mots « octroi de mer » ou « TVA » expose-t-elle à l'article 33, II de la loi de 2004 ou à l'article 283, 3 ? Quelle formulation ? | Rescrit et position de la douane | D3, T16 |
| A14 | Débours possibles en représentation indirecte ? | Rescrit ; à défaut, éviter ce montage | D13 |
| A15 | Valeur en douane de biens achetés TTC : la TVA métropolitaine incluse en est-elle retirée ? Quelle méthode (CDU art. 70 ou 74) ? | Douane | D5, D7 |
| A16 | La franchise de 22 € s'applique-t-elle à l'OM à Mayotte, que le texte de TVA ne vise pas ? | Douane | D15 |
| A17 | La douane admet-elle encore la H7, ou une tolérance, pour les biens propres des clients depuis le 01/07/2026 ? Quelle déclaration le commissionnaire utilise-t-il ? | Déclarant et douane | D16 |
| A18 | Remplacer la facture commerciale de départ par un manifeste de groupage ou un document qui désigne chaque client importateur et le marchand comme dernier vendeur, ou déposer une déclaration par client ? | Déclarant et douane | D17, I15 |
| A19 | Expedîle France est-elle commissionnaire de transport (plafond de 30 jours) ? | Contrats et activité réelle (Q6) | F24 |
| A20 | L'amende de 15 € par mention vise-t-elle les factures volontaires aux particuliers ? | Prudence retenue : toutes les mentions | F25 |
| A21 | Données exigées par la plateforme : adresse de livraison des biens pour un transport, codes d'exonération (VATEX), catégorie d'e-reporting des services exonérés liés à l'exportation, types d'acompte et d'avoir | Spécifications de la plateforme ; normes AFNOR XP Z12-012 et XP Z12-014 | F8, E7, E11 |
| A22 | Présentation des débours dans un Factur-X (catégorie O, frais de document, profil EXTENDED-CTC-FR). Les spécifications v2.4 (cas 16) mettent hors réforme une facture composée uniquement de débours ; l'analogie est faible et la v3.2 n'en parle pas | Plateforme ; normes AFNOR | E10, E11 |
| A23 | Facture mensuelle des professionnels quand la TVA des services est exigible à l'encaissement : comment appliquer le critère du « même mois civil » ? | Aucune doctrine ; facturer à la fin du mois des prestations réalisées | F13 |
| A24 | Facture rejetée par la plateforme (et non refusée par l'acheteur) : même numéro ou nouveau ? Les avoirs entre entreprises transitent-ils par la plateforme ? Un avoir émis après le 01/09/2027 sur une facture PDF antérieure ? | Spécifications de la plateforme | E12 |
| A25 | Données de paiement pour les professionnels de Mayotte et de l'étranger ; identifiant à transmettre pour un client de Mayotte (SIREN ou identifiant de substitution) | FAQ et spécifications ; plateforme | E7, E8 |
| A26 | Date d'encaissement d'un paiement par carte PayPlug : transaction, capture ou versement sur le compte ? | Doctrine sur l'encaissement ; aucune règle propre à la carte trouvée | E8, F15 |
| A27 | Date d'une transaction aux particuliers pour l'e-reporting : date de comptabilisation (spécifications) ou date de réalisation (BOFiP) ? | Spécifications ; plateforme | E9 |
| A28 | Remboursements et avoirs aux particuliers dans les totaux quotidiens : en net du jour, ou à la date du remboursement ? | Cas d'usage des spécifications ; plateforme | E7 |
| A29 | Montant de l'amende d'e-reporting à partir de 2027 : 250 € (version consolidée) ou 500 € (loi de finances 2026) ? | Revoir après la loi de finances pour 2027 et toute loi de ratification ; prévoir 500 € | E13 |
| A30 | L'approche de démarrage sans sanction sera-t-elle reconduite pour les PME en septembre 2027 ? | Publication de la DGFiP | E13 |
| A31 | Tableaux de fréquence de la DGFiP après la fin du régime simplifié | Publication de la DGFiP avant le 01/09/2027 | E9 |
| A32 | Sens de « Importations (hors DOM) hors champ » dans le tableau DGFiP des opérations d'e-reporting | DGFiP | E7 |
| A33 | Logiciel de caisse : entité PayPlug contractante et fournisseur réel du paiement par carte ; portée de « exclusivement exonérées » en présence d'opérations hors champ (Mayotte) ; format de restitution des archives (aucune norme publiée au 10/10/2026) ; L80 O ne cite que le certificat ; un compte PayPlug en ligne est-il un « système de paiement électronique » ? | Contrat PayPlug (Q11) ; textes à paraître | C13, C14, C16 |
| A34 | L'article L102 D (conservation par l'éditeur) vise-t-il une application interne jamais diffusée ? | Conserver dix ans dans tous les cas | C17 |
| A35 | Après 2027 : conservation des contrôles de la piste d'audit (I bis abrogé, nouvel L102 B bis), décret des procédés réputés conformes, mise à jour du BOFiP qui dit encore « six ans » | Textes à paraître ; conserver dix ans | F22, F23 |
| A36 | Concordance avec le CIBS : notes de Légifrance incohérentes (L. 216-41, L. 216-42, L. 216-44 ; L. 215-26 ; deux versions 2027 de l'article L80 O) ; versions 2027 encore ajustables | Table officielle de concordance ; nouvelle vérification en décembre 2026 | C20 |
| A37 | Lignes de la déclaration CA3 pour les opérations exonérées, hors champ et taxées au taux des DOM | Notice de la CA3 | T13, T11 |
| A38 | Prix de transfert et TVA des prestations entre Expedîle Réunion et Expedîle France (un prestataire des DOM qui sert un assujetti de métropole reste redevable, BOI-TVA-GEO-20-40 § 244) | Q8 ; recherche dédiée | E17 |
| A39 | Article L3222-2 du code des transports (charges de carburant sur facture) pour un trajet routier contracté par Expedîle | Non vérifié | — |
| A40 | Successeur de la décision (UE) 2021/991 après 2027 ; réforme du code des douanes de l'Union | Veille | D1 |
| A41 | Produits des clients figurant sur la liste de l'annexe IV, art. 50 duodecies ; application automatique ou sur demande du déclarant | Douane ; codes SH (Q22) | D15 |
| A42 | Règles d'intégration du XML dans le PDF (nom du fichier, relation, métadonnées XMP) non lues : le paquet officiel exige une inscription ; profil BASIC accepté par la plateforme ? | Télécharger le paquet ; plateforme | E10 |
| A43 | TVA facturée par les sous-traitants de transport : lecture stricte de l'Union (C-288/16) ou tolérance française (§ 30) | Q21 | T9 |
| A44 | Rédaction au 01/01/2027 des articles 3, 8, 33 et 45 de la loi sur l'octroi de mer et des articles du CIBS : non lue | Nouvelle vérification en janvier 2027 | D1 à D6 |

### 5.2 Sources

Toutes les sources ont été consultées le 10 octobre 2026.

**Légifrance — codes et lois**

- CGI art. 54 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006307742
- CGI art. 256 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044983615
- CGI art. 259 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000021642728
- CGI art. 259 A : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909954
- CGI art. 262 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033469152
- CGI art. 267 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006309431
- CGI art. 269 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006309449
- CGI art. 271 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053545646
- CGI art. 272 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031817248
- CGI art. 283 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051214570
- CGI art. 286 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054337091
- CGI art. 287 (version au 01/01/2027) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051190827/2027-01-01
- CGI art. 289 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048827413
- CGI art. 289 bis : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195635
- CGI art. 290 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546668
- CGI art. 290 A : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044045416
- CGI art. 290 B : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195605
- CGI art. 292 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041472118
- CGI art. 293 A : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048838508
- CGI art. 293 A quater : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044894135
- CGI art. 294 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027978194
- CGI art. 294 à 296 quater (section des DOM) : https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006179660
- CGI art. 295 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053545643
- CGI art. 1695 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041534638
- CGI art. 1729 D : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033815103
- CGI art. 1734 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048651374
- CGI art. 1737 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546686
- CGI art. 1770 duodecies : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546759
- CGI art. 1770 quaterdecies : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054319888
- CGI art. 1788 D (en vigueur) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546693 ; version au 01/01/2027 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195593/2027-01-02
- CGI ann. II art. 242 nonies A : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276
- CGI ann. II art. 242 nonies B à P (section) : https://www.legifrance.gouv.fr/codes/id/LEGISCTA000046385428/2026-10-10
- CGI ann. III art. 73 G : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006296940
- CGI ann. IV art. 41 septies A à P (section) : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069576/LEGISCTA000046386156/2026-10-10/
- CGI ann. IV art. 50 octies : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043584984
- CIBS art. L. 216-40 (version au 01/01/2027) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054525377/2027-01-02
- LPF art. L13 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048838925
- LPF art. L47 A : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037526053
- LPF art. L80 A : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037312533
- LPF art. L80 B : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054674686
- LPF art. L80 F : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000026949916
- LPF art. L80 O : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054337073
- LPF art. L85 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030059624
- LPF art. L96 J : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053881338
- LPF art. L102 B (en vigueur) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046869194 ; version au 01/01/2027 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054566874/2027-01-02
- LPF art. L102 B bis (au 01/01/2027) : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054566884/2027-01-02
- LPF art. L102 C : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033815236
- LPF art. L176 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038595822
- C. com. art. L123-22 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006219327
- C. com. art. R123-172 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006257926
- C. com. art. R123-237 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045710304
- C. com. art. R123-238 (section) : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000005634379/LEGISCTA000006178891/
- C. com. art. L441-9 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414397
- C. com. art. L441-10 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414392
- C. com. art. L441-11 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048639492
- C. com. art. L441-16 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043750778
- C. com. art. D441-5 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043197457
- C. douanes art. L221-5 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053805361
- C. douanes art. R221-13 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813576
- C. douanes art. R221-20 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813592
- C. douanes art. R221-21 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813596
- C. douanes art. R221-28 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053813613
- C. douanes art. L312-3 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053805568
- C. douanes art. L323-17 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053805725
- C. douanes art. L421-1 et suivants (section) : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006071570/LEGISCTA000053805942/
- C. douanes art. L522-2 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053806961
- Code monétaire et financier art. L112-6 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051752373 ; art. D112-3 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036824549 ; art. L112-7 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033461943
- Loi n° 94-665 du 4 août 1994, art. 2 : https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006421210
- Loi n° 2004-639 du 2 juillet 2004 (octroi de mer) : https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000253374 ; art. 33 : https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000048639473
- Loi n° 2022-1157 du 16 août 2022, art. 26 : https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000046188381
- Loi n° 2026-103 du 19 février 2026, art. 123 : https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053508878
- Ordonnance n° 2025-1247, art. 46 : https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000054587035/2026-10-10
- Décret n° 2026-677 du 27 juillet 2026 : https://www.legifrance.gouv.fr/eli/decret/2026/7/27/CPPE2610307D/jo/texte
- Arrêté du 27 juillet 2026 relatif à la généralisation de la facturation électronique : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054499535
- Arrêté n° 83-50/A du 3 octobre 1983, art. 1, 3 et 4 : https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032459001 ; https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032459003 ; https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032459004
- Table de concordance du CIBS : https://www.legifrance.gouv.fr/contenu/Media/files/autour-de-la-loi/codification/tables-de-concordance/code-des-impositions-sur-les-biens-et-services/table-de-concordance_-cibs_avant-apres-ancienne-nouvelle.xlsx

**BOFiP**

- BOI-TVA-DECLA-30-20-10 : https://bofip.impots.gouv.fr/bofip/1525-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-20210813
- BOI-TVA-DECLA-30-20-10-10 : https://bofip.impots.gouv.fr/bofip/13242-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-10-20211222
- BOI-TVA-DECLA-30-20-10-40 : https://bofip.impots.gouv.fr/bofip/13245-PGP.html/identifiant=BOI-TVA-DECLA-30-20-10-40-20210813
- BOI-TVA-DECLA-30-20-20-10 : https://bofip.impots.gouv.fr/bofip/140-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-10-20131018
- BOI-TVA-DECLA-30-20-20-20 : https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20220119
- BOI-TVA-DECLA-30-20-20-30 : https://bofip.impots.gouv.fr/bofip/1531-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-30-20250108
- BOI-TVA-DECLA-30-20-30-10 : https://bofip.impots.gouv.fr/bofip/8862-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-10-20180207
- BOI-TVA-DECLA-30-20-30-20 : https://bofip.impots.gouv.fr/bofip/8865-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-20-20180207
- BOI-TVA-DECLA-30-20-30-50 : https://bofip.impots.gouv.fr/bofip/8869-PGP.html/identifiant=BOI-TVA-DECLA-30-20-30-50-20180207
- BOI-TVA-DECLA-30-10-30 (logiciels de caisse) : https://bofip.impots.gouv.fr/bofip/10691-PGP.html/identifiant=BOI-TVA-DECLA-30-10-30-20260325
- BOI-TVA-DECLA-20-30-50-10, -20, -30 et BOI-TVA-DECLA-20-30-60 (e-reporting) : https://bofip.impots.gouv.fr/doctrine/pgp/13898-PGP ; https://bofip.impots.gouv.fr/doctrine/pgp/13899-PGP ; https://bofip.impots.gouv.fr/doctrine/pgp/13900-PGP ; https://bofip.impots.gouv.fr/doctrine/pgp/13901-PGP
- BOI-TVA-DECLA-10-20 : https://bofip.impots.gouv.fr/bofip/3166-PGP.html/identifiant=BOI-TVA-DECLA-10-20-20240724
- BOI-TVA-GEO-20-20 : https://bofip.impots.gouv.fr/bofip/784-PGP.html/identifiant=BOI-TVA-GEO-20-20-20260902
- BOI-TVA-GEO-20-40 : https://bofip.impots.gouv.fr/bofip/792-PGP.html/identifiant=BOI-TVA-GEO-20-40-20240724
- BOI-TVA-CHAMP-20-60-20 : https://bofip.impots.gouv.fr/bofip/2269-PGP.html/identifiant=BOI-TVA-CHAMP-20-60-20-20240724
- BOI-TVA-CHAMP-30-30-20-10 : https://bofip.impots.gouv.fr/bofip/967-PGP.html/identifiant=BOI-TVA-CHAMP-30-30-20-10-20151104
- BOI-TVA-CHAMP-30-30-20-40 : https://bofip.impots.gouv.fr/bofip/936-PGP.html/identifiant=BOI-TVA-CHAMP-30-30-20-40-20120912
- BOI-TVA-CHAMP-60-20 : https://bofip.impots.gouv.fr/bofip/13858-PGP.html/identifiant=BOI-TVA-CHAMP-60-20-20260729
- BOI-TVA-BASE-10-10-30 : https://bofip.impots.gouv.fr/bofip/488-PGP.html/identifiant=BOI-TVA-BASE-10-10-30-20220511
- BOI-TVA-BASE-10-20-40-20 : https://bofip.impots.gouv.fr/bofip/1475-PGP.html/identifiant=BOI-TVA-BASE-10-20-40-20-20120912
- BOI-TVA-BASE-10-20-60-10 : https://bofip.impots.gouv.fr/bofip/10302-PGP.html/identifiant=BOI-TVA-BASE-10-20-60-10-20210224
- BOI-TVA-DED-40-10-30 : https://bofip.impots.gouv.fr/bofip/1082-PGP.html/identifiant=BOI-TVA-DED-40-10-30-20240724
- BOI-CF-COM-10-10-30 : https://bofip.impots.gouv.fr/bofip/645-PGP.html/identifiant=BOI-CF-COM-10-10-30-20250903
- BOI-BIC-DECLA-30-10-20-40 : https://bofip.impots.gouv.fr/bofip/2899-PGP.html/identifiant=BOI-BIC-DECLA-30-10-20-40-20180720
- BOI-RES-TVA-000253 : https://bofip.impots.gouv.fr/bofip/14901-PGP.html/identifiant=BOI-RES-TVA-000253-20261007
- Actualités : ACTU-2026-00126 https://bofip.impots.gouv.fr/bofip/15140-PGP.html/ACTU-2026-00126 ; ACTU-2026-00140 https://bofip.impots.gouv.fr/doctrine/pgp/15171-PGP ; ACTU-2026-00073 https://bofip.impots.gouv.fr/bofip/15035-PGP.html/ACTU-2026-00073 ; ACTU-2025-00160 https://bofip.impots.gouv.fr/bofip/14826-PGP.html/ACTU-2025-00160 ; ACTU-2025-00106 https://bofip.impots.gouv.fr/bofip/14710-PGP.html/ACTU-2025-00106

**DGFiP et impots.gouv.fr**

- FAQ « Je découvre la facturation électronique » (01/09/2026) : https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq---fe_je-decouvre-la-facturation-electronique.pdf
- FAQ « J'approfondis la facturation électronique » (01/09/2026) : https://www.impots.gouv.fr/foire-aux-questions-japprofondis-la-facturation-electronique
- FAQ « DROM et COM » (21/01/2026) : https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq_drom.pdf
- Guide pratique de démarrage (juillet 2026) : https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/guide_pratique_facturation_electronique.pdf
- Spécifications externes : https://www.impots.gouv.fr/specifications-externes-b2b ; version 3.2 : https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/specification_externes_b2b/specifications-externes-v3.2.zip ; version 2.4 : https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/specification_externes_b2b/version_2-4_du_19_06_2024/specifications-externes-facturation-electronique-v2.4.zip
- Liste des plateformes agréées : https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees
- Questions professionnelles : https://www.impots.gouv.fr/professionnel/questions/partir-de-quand-suis-je-concerne-par-la-reforme-de-la-facturation ; https://www.impots.gouv.fr/professionnel/questions/est-ce-quune-facture-envoyee-par-mail-est-une-facture-electronique ; https://www.impots.gouv.fr/professionnel/questions/mes-clients-sont-la-fois-des-entreprises-et-des-particuliers-par-quel ; https://www.impots.gouv.fr/professionnel/questions/avec-la-reforme-de-la-facturation-electronique-dois-je-encore-deposer-des ; https://www.impots.gouv.fr/professionnel/questions/depuis-la-metropole-je-fais-une-livraison-de-marchandises-dans-les-dom-dois

**Douane**

- Circulaire sur l'octroi de mer du 10/07/2025 : https://www.douane.gouv.fr/sites/default/files/2025-07/16/Circulaire-octroi-de-mer10072025.pdf
- Entrée en vigueur du nouveau code des douanes (communiqué) : https://www.douane.gouv.fr/sites/default/files/2026-04/09/CP-Recodification_le-code-des-douanes-entrera-en-vigueur-le-1-er-mai-2026.pdf
- BOD n° 7440 : https://www.douane.gouv.fr/sites/default/files/uploads/files/BOD%207440%20blanc%20op%C3%A9rateurs.pdf
- Note aux opérateurs du 23/11/2021 : https://www.douane.gouv.fr/sites/default/files/2021-11/30/note-aux-operateurs-generalisation-de-lautoliquidation-de-la-tva.pdf
- « Vous achetez sur internet » : https://www.douane.gouv.fr/demarche/vous-achetez-sur-internet
- « Envoyer un colis à un particulier » : https://www.douane.gouv.fr/fiche/envoyer-un-colis-un-particulier
- « Recevoir un colis envoyé par un particulier » : https://www.douane.gouv.fr/fiche/recevoir-un-colis-envoye-par-un-particulier
- « Taxe sur les petits colis » : https://www.douane.gouv.fr/actualites/taxe-sur-les-petits-colis-point-dinformation-sur-sa-mise-en-oeuvre

**Union européenne (EUR-Lex)**

- Code des douanes de l'Union (version consolidée du 12/12/2022) : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:02013R0952-20221212
- Règlement délégué (UE) 2015/2446 (version consolidée du 01/07/2026) : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:02015R2446-20260701
- Règlement délégué (UE) 2026/1022 : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32026R1022
- CJUE C-454/98 : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:61998CJ0454
- CJUE C-106/10 : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62010CJ0106
- CJUE C-187/14 : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62014CJ0187
- CJUE C-288/16 : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62016CJ0288
- CJUE C-495/17 : https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:62017CJ0495

**Autres sources officielles**

- Fiche DILA « Mentions obligatoires sur une facture » (vérifiée le 11/08/2026) : https://entreprendre.service-public.gouv.fr/vosdroits/F31808
- Réponse ministérielle, question écrite Sénat n° 02416 (1993) : https://www.senat.fr/questions/base/1993/qSEQ930802416.html
- Factur-X (FNFE-MPE) : https://fnfe-mpe.org/factur-x/
- ZUGFeRD 2.5.2 (FeRD) : https://www.ferd-net.de/publikationen-produkte/publikationen/detailseite/zugferd-252-english
