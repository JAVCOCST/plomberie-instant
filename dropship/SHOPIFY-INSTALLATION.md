# Installer la boutique Shopify — pas à pas

Durée totale : environ **4 à 6 heures**, réparties sur quelques soirs. Coche au fur et à mesure.
Les textes à coller sont dans `site/` et `politiques/` ; le logo dans `marque/logo/png/`.

> Les menus de Shopify changent parfois de nom. Si un libellé ne correspond pas exactement, cherche le mot-clé dans la
> barre de recherche en haut de l'administration Shopify.

---

## Étape 1 — Créer le compte (15 min)
- [ ] Aller sur shopify.com/ca/fr → **Commencer l'essai gratuit** avec un courriel dédié au projet.
- [ ] Nom de la boutique : **Petit Soleil**.
- [ ] Pays : **Canada**. Choisir le forfait **Basic** à la fin de l'essai (souvent 1 $/mois pendant 3 mois).
- [ ] Laisser la boutique **protégée par mot de passe** jusqu'au lancement (Boutique en ligne → Préférences).

## Étape 2 — Paramètres de base (20 min)
**Paramètres → Détails de la boutique**
- [ ] Nom légal de l'entreprise, adresse, téléphone, courriel de contact (`bonjour@…`) et courriel de l'expéditeur.
- [ ] Devise : **dollar canadien (CAD)**. Fuseau : **(GMT−05:00) Heure de l'Est**. Unités : **système métrique, kg**.
- [ ] Préfixe des commandes : `PS-` (les numéros deviennent PS-1001, PS-1002…).

## Étape 3 — Domaine (15 min)
**Paramètres → Domaines**
- [ ] Acheter le domaine directement dans Shopify (le plus simple) ou connecter un domaine acheté ailleurs.
- [ ] Le définir comme **domaine principal**. Le certificat SSL (cadenas) s'active tout seul.
- [ ] Créer l'adresse courriel `bonjour@ton-domaine` (Shopify propose le transfert de courriels gratuitement vers ta
      boîte Gmail/Outlook).

## Étape 4 — Langues et marché (20 min)
**Paramètres → Langues**
- [ ] Ajouter le **français** et le définir comme **langue par défaut**. Garder l'anglais comme 2e langue, et le publier.
- [ ] Installer l'appli **Translate & Adapt** (gratuite, par Shopify) : c'est là qu'on collera les textes EN.

**Paramètres → Marchés**
- [ ] Marché principal : **Canada**. Désactiver les autres marchés (États-Unis, international) pour l'instant.

## Étape 5 — Taxes (20 min) ⚠️ important
**Paramètres → Taxes et droits**
- **Si tu es inscrit à la TPS/TVQ** (recommandé) : entrer tes numéros pour **Canada (TPS)** et **Québec (TVQ)**,
  puis cliquer sur **Percevoir** pour les autres provinces (TVH, etc.). Shopify calcule tout.
- **Si tu n'es pas inscrit** (petit fournisseur sous 30 000 $) : **ne percevoir aucune taxe**. On n'a pas le droit de
  facturer la TPS/TVQ sans numéro d'inscription.
- [ ] Décision prise avec le comptable et configurée.
- [ ] « Inclure les taxes dans les prix » : **NON** (au Canada, les prix s'affichent avant taxes).

## Étape 6 — Livraison (15 min)
**Paramètres → Expédition et livraison**
- [ ] Dans le profil général, zone **Canada** seulement.
- [ ] Supprimer les tarifs par défaut et créer un tarif : **Livraison standard gratuite** — 0,00 $ —
      description « 7 à 15 jours ouvrables ». Traduction EN : *Free standard shipping, 7–15 business days*.
- [ ] Poids du produit : 0,8 kg (lampe + boîte, à ajuster).

## Étape 7 — Paiements (20 min)
**Paramètres → Paiements**
- [ ] Activer **Shopify Payments** (cartes, Apple Pay, Google Pay, Shop Pay). Entrer le compte bancaire de l'entreprise.
- [ ] Ajouter **PayPal**.
- [ ] Libellé sur le relevé bancaire : `PETITSOLEIL`.
- [ ] Activer **le mode test** pour l'instant (pour la commande test de l'étape 15).

## Étape 8 — Caisse (10 min)
**Paramètres → Paiement (Checkout)**
- [ ] Compte client : **facultatif**.
- [ ] Coordonnées : courriel **ou** téléphone.
- [ ] Champs : nom complet obligatoire, entreprise masquée, adresse ligne 2 facultative, téléphone facultatif.
- [ ] Marketing : **afficher la case d'inscription aux courriels, NON cochée par défaut** (exigence LCAP / CASL).
- [ ] Pourboires : désactivés.
- [ ] Ajouter dans les **notes de commande** : « C'est un cadeau (facture sans prix) ».

## Étape 9 — Politiques (15 min)
**Paramètres → Politiques**
- [ ] Coller `politiques/retours.md` → Politique de remboursement
- [ ] Coller `politiques/confidentialite.md` → Politique de confidentialité
- [ ] Coller `politiques/conditions.md` → Conditions d'utilisation
- [ ] Coller `politiques/livraison.md` → Politique d'expédition
- [ ] Coordonnées → Politique de contact
- [ ] Mettre chaque version **anglaise** dans Translate & Adapt.

**Paramètres → Confidentialité des clients**
- [ ] Activer la **bannière de témoins (cookies)** pour le Canada, avec choix « Accepter / Refuser / Préférences ».

## Étape 10 — Le thème (1 h 30)
**Boutique en ligne → Thèmes** : garder **Dawn** (gratuit, rapide, très bien fait). → **Personnaliser**.

**Paramètres du thème**
- [ ] **Logo** : `petit-soleil-horizontal.png`, largeur 160 px. **Favicon** : `petit-soleil-favicon.png`.
- [ ] **Couleurs** (schéma 1, principal) : fond `#F7F3EC`, texte `#1E2A3A`, bouton plein `#1E2A3A`, texte du bouton
      `#F7F3EC`, bouton contour `#1E2A3A`. Schéma 2 (sections mises en avant) : fond `#F9D9B8`. Schéma 3 (sections
      foncées) : fond `#1E2A3A`, texte `#F7F3EC`, bouton `#F2B544`, texte du bouton `#1E2A3A`.
- [ ] **Typographie** : titres **Fraunces** (sinon *Lora*), texte **Inter** (sinon *Assistant*).
- [ ] **Boutons** : coins arrondis au maximum (rayon 40 px).
- [ ] **Panier** : type « tiroir ».
- [ ] **Médias sociaux** : liens Instagram, Facebook, TikTok.

**Accueil** : construire les sections dans l'ordre de `site/02-accueil.md`
(Bannière avec image → Texte avec icônes (4 colonnes) → Image avec texte → Colonnes multiples (3 étapes) →
Produit en vedette → Image avec texte (Kit Matin) → Bannière (cadeau) → Contenu réductible (FAQ) → Inscription à la
newsletter).

**En-tête / pied de page** : barre d'annonce et menus de `site/01-elements-globaux.md`.

## Étape 11 — Le produit (45 min)
1. [ ] Dans QKsource, connecter la boutique : bouton **Connect** (sur la fiche produit) → autoriser Shopify.
2. [ ] Sur la fiche du produit SKU `QSHD242056202BY` : choisir **SK40 DC** + **US** → **List** (l'envoie dans Shopify
       en brouillon).
3. [ ] Dans Shopify → **Produits**, ouvrir le brouillon et **tout réécrire** :
   - Titre, description (onglets), SEO : `site/03-produit-lampe.md`
   - Prix : **69,99 $**, pas de prix barré
   - Garder **uniquement** la variante prise US (supprimer EU / UK)
   - Images : celles de QKsource sans texte en premier (temporaire)
   - Cocher « Suivre la quantité » : non (le fournisseur gère le stock), « Continuer à vendre en rupture » : non
   - Type : `Lampe lumière du jour` · Collections : `Accueil`, `Cadeaux`
4. [ ] Vérifier dans QKsource que la variante Shopify est bien **liée** au SKU fournisseur (sinon les commandes ne
       partiront pas automatiquement).
5. [ ] Traduire la fiche en anglais (Translate & Adapt).
6. [ ] Kit Matin et Duo cadeau : à ajouter **quand le réveil est confirmé** (voir `site/04-produit-kit-matin.md`).

## Étape 12 — Pages et menus (30 min)
**Boutique en ligne → Pages** : créer
- [ ] Notre histoire (`site/05-notre-histoire.md`) · FAQ (`site/06-faq.md`) · Nous joindre (`site/07-contact-suivi.md`,
      modèle « contact ») · Garantie (`politiques/garantie.md`)

**Boutique en ligne → Navigation**
- [ ] Menu principal et menu du pied de page selon `site/01-elements-globaux.md`.

## Étape 13 — Applications (30 min)
| Appli | Pourquoi | Prix |
|---|---|---|
| **Translate & Adapt** | Version anglaise | Gratuit |
| **Shopify Email** | Courriels automatiques (`marketing/courriels.md`) | Gratuit au départ |
| **Judge.me** | Avis clients avec photos | Gratuit |
| **Parcel Panel** ou **AfterShip** | Page de suivi de commande | Gratuit au départ |
| **Facebook & Instagram** | Pixel + Conversions API, catalogue | Gratuit |
| **Google & YouTube** | Google Shopping (plus tard) | Gratuit |
| **QKsource** | Envoi automatique des commandes au fournisseur | Gratuit |

Ne pas installer d'autres applis « miracle » (comptes à rebours, fausses notifications d'achat) : elles ralentissent le
site et nuisent à la confiance.

## Étape 14 — Courriels (30 min)
- [ ] **Paramètres → Notifications** : traduire et personnaliser « Confirmation de commande » et « Confirmation
      d'expédition » (`marketing/courriels.md`, section C). Mettre le logo et la couleur `#1E2A3A`.
- [ ] **Shopify Email → Automatisations** : créer « Bienvenue » (A1–A3) et « Panier abandonné » (B1–B3).
- [ ] **Remises** : créer `SOLEIL10` (10 %, 1re commande, 1 utilisation par client), `REVIENS10` (10 %).

## Étape 15 — Tests (45 min) ✅ ne pas sauter
- [ ] Ouvrir le site sur **téléphone** (la majorité des acheteurs) : accueil, fiche produit, panier, FAQ, en FR et en EN.
- [ ] Vitesse : Boutique en ligne → Thèmes → score de vitesse ; viser > 50.
- [ ] Faire une **commande test** (mode test des paiements), puis vérifier : courriel de confirmation, commande visible
      dans QKsource.
- [ ] Désactiver le mode test, faire **une vraie commande** à ta propre adresse au Québec : c'est aussi ton échantillon !
      Vérifier le suivi, le délai réel, l'emballage, d'éventuels frais de douane.
- [ ] Rembourser une commande test pour voir le processus.

## Étape 16 — Lancement 🚀
- [ ] Plus aucun `[À CONFIRMER]` ni texte entre crochets (`[COURRIEL]`, `[ADRESSE]`…) sur le site (rechercher « [ » dans chaque page).
- [ ] Boutique en ligne → Préférences : **retirer le mot de passe**.
- [ ] Titre et description SEO, image de partage (`site/01-elements-globaux.md`).
- [ ] Domaine vérifié dans Meta Business, pixel qui reçoit les événements.
- [ ] Lancer les pubs selon `marketing/publicites.md`.
