# Bêta Gmail - Questionnaire financier Prestaterre V0.29

Cette version ne nécessite aucun backend, aucun Google Apps Script et aucune clé.

## 1. Adresse de réception

Cette version est déjà configurée pour envoyer les questionnaires à :

`cedric.covarel@prestaterre.eu`

## 2. Publier sur GitHub Pages

Remplacer l'ancien `index.html` de la bêta par ce fichier puis pousser la mise à jour sur GitHub Pages.

## 3. Ce que fait le bouton d'envoi

Le bouton `Préparer et envoyer par e-mail` :

1. génère le bilan Prestaterre en PDF ;
2. génère le CSV exploitable des données financières ;
3. ajoute le JSON complet ;
4. ajoute les PDF / Excel sources autorisés dans la limite bêta ;
5. fabrique et télécharge un seul fichier ZIP ;
6. ouvre Gmail dans un nouvel onglet avec le destinataire, l'objet et le message préremplis.

Le répondant doit seulement joindre le ZIP téléchargé au mail puis cliquer sur Envoyer.

## Limites bêta

- 8 Mo maximum par fichier source ;
- 12 Mo maximum de sources cumulées dans le ZIP ;
- les fichiers dépassant ces seuils sont omis du ZIP et signalés dans le message ;
- le PDF, le CSV et le JSON restent générés.

## Si Gmail ne s'ouvre pas

Le site affiche deux liens de secours après la préparation :

- `ouvrir Gmail` ;
- `ouvrir le logiciel de messagerie` via `mailto:`.

Aucune pièce jointe ne peut être ajoutée automatiquement à Gmail par une simple page web : le ZIP doit être joint manuellement, ce qui est la seule action restant au répondant.
