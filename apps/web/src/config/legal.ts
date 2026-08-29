// L'identité de l'éditeur du site, telle qu'elle apparaît sur les pages
// réglementaires.
//
// En code, dans un seul fichier, parce que ces valeurs sont les mêmes sur
// trois pages et qu'elles ne se recopient pas : une adresse changée à deux
// endroits sur trois est exactement le défaut que ce fichier existe pour
// rendre impossible.
//
// UN ADOPTANT DOIT REMPLIR CE FICHIER. Les valeurs livrées décrivent le
// dépôt AstroTan, pas son site — les laisser telles quelles publierait des
// mentions légales fausses, ce qui est pire que pas de mentions légales.

export interface LegalEntity {
  /** Raison sociale, ou nom et prénom pour une personne physique. */
  name: string
  /** « SAS au capital de 1 000 € », « auto-entrepreneur », « association loi 1901 »… */
  form: string
  address: string
  email: string
  phone?: string
  /** SIRET, SIREN ou équivalent. Obligatoire pour une activité commerciale. */
  registration?: string
  /** Numéro de TVA intracommunautaire, si assujetti. */
  vat?: string
  /** Le directeur de la publication — une personne physique, nommée. */
  publicationDirector: string
}

export interface LegalHost {
  name: string
  address: string
  /** Site ou téléphone : la loi exige un moyen de le joindre. */
  contact: string
}

export const legalEntity: LegalEntity = {
  name: "AstroTan",
  form: "Projet open source — à remplacer par votre raison sociale",
  address: "Adresse à compléter",
  email: "contact@exemple.fr",
  publicationDirector: "À compléter",
}

export const legalHost: LegalHost = {
  name: "Hostinger International Ltd.",
  address: "61 Lordou Vironos Street, 6023 Larnaca, Chypre",
  contact: "https://www.hostinger.fr",
}

/**
 * Où les données partent, et pourquoi. Le tableau que le RGPD appelle
 * « registre » côté visiteur — la version lisible, pas le document interne.
 *
 * Une ligne par traitement réellement effectué. En retirer une parce qu'on
 * a retiré le traitement est normal ; en garder une pour faire sérieux est
 * une déclaration fausse.
 */
export interface Processing {
  purpose: string
  data: string
  basis: string
  retention: string
  recipients: string
}

export const processings: Processing[] = [
  {
    purpose: "Répondre à un message envoyé par le formulaire de contact",
    data: "Nom, adresse électronique, contenu du message, date d'envoi",
    basis: "Intérêt légitime — répondre à quelqu'un qui nous écrit",
    retention: "3 ans après le dernier échange",
    recipients: "Convex (hébergement de la base), et le service d'automatisation configuré le cas échéant",
  },
  {
    purpose: "Mesurer l'audience du site",
    data: "Page vue, page d'origine, pays, type d'appareil — sans cookie et sans adresse IP conservée",
    basis: "Intérêt légitime — une mesure anonyme, exemptée de consentement",
    retention: "13 mois",
    recipients: "Umami, auto-hébergé sur notre propre serveur",
  },
  {
    purpose: "Enregistrer le choix exprimé sur les cookies",
    data: "Le choix lui-même, sa date, la version de la politique acceptée",
    basis: "Obligation légale — pouvoir prouver le consentement",
    retention: "Voir `expirationDays` dans `src/config/consent.ts`",
    recipients: "Personne : stocké dans le navigateur, sauf si la traçabilité est activée",
  },
]

/** Le délégué à la protection des données, si le site en a désigné un. */
export const dpo: { name: string; email: string } | null = null
