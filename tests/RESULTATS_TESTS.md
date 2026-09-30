# Tests V5.1 - 30 septembre 2026

## Resultats
- `node tests/core.test.cjs` : 44/44 tests reussis (non-regression V5).
- `node tests/pivot.test.cjs` : 22/22 tests reussis (comparaison bilaterale, adresses).
- `python tests/browser.test.py` : 19/19 controles reussis (interface existante).
- `python tests/bilateral-browser.test.py` : 19/19 controles reussis (nouveau parcours).
- Syntaxe JavaScript : app.js, cadastre-rnb.js, pivot-rnb.js controlee avec node --check.
- Captures du tableau et de la fenetre de preuves inspectees visuellement.

Total : 66 tests de logique et 38 controles d'interface.

## Cas verifies
Parcelle base / adresse SIAP concordantes ; ID-RNB existant ; adresses seules ;
plusieurs adresses d'un meme SIAP ; conservation de la seconde adresse ;
plusieurs numeros SIAP lies au meme RNB malgre un ecart de score ; couverture
partielle des RNB de la base ; batiment inclus dans un SIAP plus large ;
candidats ambigus indexes mais non retenus ; numeros de rue differents lors
du geocodage ; deux entrees differentes d'un meme batiment ; API en echec ;
recherche textuelle candidate sans geocodage ; pagination ; absence de
navigation hors du service officiel ; export des preuves ; conservation des
colonnes sources ; validations manuelles ; filtres ; conservation du scroll.

## Limites importantes
Donnees et identifiants fictifs. Aucune connexion directe au SIAP.
Les services publics sont simules. Les tests d'interface simulent aussi
XLSX, Fuse et Turf : ils valident les actions, les structures de donnees et
les colonnes exportees, pas le chargement reel des CDN, les algorithmes tiers,
ni la lecture/ecriture effective d'un vrai classeur par ces bibliotheques.
Le jeu de test geocodage V5 a ete complete avec le champ housenumber, requis
pour controler le numero dans le nouveau parcours.
Les API de production n'ont pas pu etre testees depuis cet environnement
(reseau indisponible). Il reste a tester un echantillon connu sur le poste
utilisateur, avec connexion Internet et les deux fichiers Excel metier.
Aucun taux de rapprochement metier ni garantie d'exactitude financiere.

## Relancer
Node.js pour les deux suites de logique. Python + Playwright + Chromium
pour les suites navigateur. La variable CHROMIUM_PATH peut designer un
navigateur deja installe. Les tests ne modifient aucun fichier utilisateur.
