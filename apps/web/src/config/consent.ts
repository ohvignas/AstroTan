// La configuration du consentement pour CE site.
//
// Écrite en code, comme `nav.ts` et `legal.ts`, et pour la même raison : un
// adoptant ouvre un fichier, change quatre valeurs, redéploie. La mettre
// dans l'administration aurait donné un écran de plus à remplir pour des
// valeurs qui changent une fois dans la vie du site.
//
// Le tableau des options est celui d'Open Consent (https://www.openconsent.dev/docs) —
// les noms sont repris tels quels pour que sa documentation se lise ici.
import type { ConsentConfig } from "../lib/consent"

export const consentConfig: ConsentConfig = {
  /**
   * À INCRÉMENTER à chaque fois que la liste des tiers change, ou que la
   * politique de confidentialité change sur le fond.
   *
   * C'est la seule opération qui redemande son avis à tout le monde. Ajouter
   * un pixel sans toucher à cette valeur laisserait des visiteurs avoir
   * « accepté » un tiers qui n'existait pas quand ils ont cliqué — ce qui
   * n'est pas un consentement, seulement une case cochée.
   */
  consentVersion: "1.0.0",

  /**
   * 365 jours, le défaut d'Open Consent.
   *
   * La CNIL, elle, recommande six mois pour la conservation du choix. Un
   * site qui vise strictement le public français peut poser `182` ici : la
   * seule conséquence est que le bandeau revient plus tôt. Personne ne perd
   * rien à raccourcir, ce qui est la raison pour laquelle le réglage existe.
   */
  expirationDays: 365,

  privacyPolicyUrl: "/confidentialite",
  cookiePolicyUrl: "/cookies",
  position: "bottom-left",

  /**
   * Google Consent Mode v2.
   *
   * Sans effet tant que `PUBLIC_GOOGLE_TAG_ID` n'est pas posé : le bloc de
   * défaut n'est rendu que s'il y a une balise Google à faire patienter.
   * Le laisser à `true` ne coûte donc rien à un site sans Google, et évite
   * l'oubli le jour où l'on en ajoute une.
   */
  googleConsentMode: { enabled: true },

  /**
   * La traçabilité — la preuve du consentement, que le RGPD demande de
   * pouvoir produire.
   *
   * Éteinte par défaut, et c'est un arbitrage assumé : la garder, c'est
   * conserver un identifiant d'appareil et un horodatage pour chaque
   * visiteur qui répond — donc traiter une donnée personnelle de plus, au
   * nom de la conformité. Un site vitrine sans enjeu s'en passe ; un site
   * qui fait de la publicité ciblée a intérêt à l'allumer.
   *
   * Allumée, elle poste sur `/api/consent`, qui écrit dans Convex. Voir
   * `docs/rgpd.md` pour la marche à suivre.
   */
  traceability: { enabled: false, endpoint: "/api/consent" },
}
