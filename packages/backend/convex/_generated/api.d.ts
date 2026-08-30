/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _dataRegistry from "../_dataRegistry.js";
import type * as _registry from "../_registry.js";
import type * as analytics from "../analytics.js";
import type * as auditLog from "../auditLog.js";
import type * as auth from "../auth.js";
import type * as bootstrap from "../bootstrap.js";
import type * as consent from "../consent.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as dataSubject from "../dataSubject.js";
import type * as dns from "../dns.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as leads from "../leads.js";
import type * as lib_auditEvent from "../lib/auditEvent.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_catalogueEmails from "../lib/catalogueEmails.js";
import type * as lib_consentRateLimit from "../lib/consentRateLimit.js";
import type * as lib_doh from "../lib/doh.js";
import type * as lib_expediteur from "../lib/expediteur.js";
import type * as lib_gabarit from "../lib/gabarit.js";
import type * as lib_hoteNu from "../lib/hoteNu.js";
import type * as lib_leadCascade from "../lib/leadCascade.js";
import type * as lib_leadRateLimit from "../lib/leadRateLimit.js";
import type * as lib_originFingerprint from "../lib/originFingerprint.js";
import type * as lib_origines from "../lib/origines.js";
import type * as lib_ownerGuard from "../lib/ownerGuard.js";
import type * as lib_passwordResetRateLimit from "../lib/passwordResetRateLimit.js";
import type * as lib_passwordStrength from "../lib/passwordStrength.js";
import type * as lib_previewToken from "../lib/previewToken.js";
import type * as lib_publicPath from "../lib/publicPath.js";
import type * as lib_requiredPages from "../lib/requiredPages.js";
import type * as lib_resend from "../lib/resend.js";
import type * as lib_safeHref from "../lib/safeHref.js";
import type * as lib_secretsCrypto from "../lib/secretsCrypto.js";
import type * as lib_servedPaths from "../lib/servedPaths.js";
import type * as lib_sharedSecret from "../lib/sharedSecret.js";
import type * as lib_signInRateLimit from "../lib/signInRateLimit.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_token from "../lib/token.js";
import type * as lib_umamiToken from "../lib/umamiToken.js";
import type * as lib_webhookUrl from "../lib/webhookUrl.js";
import type * as media from "../media.js";
import type * as migrations from "../migrations.js";
import type * as pages from "../pages.js";
import type * as passwordReset from "../passwordReset.js";
import type * as posts from "../posts.js";
import type * as profiles from "../profiles.js";
import type * as redirects from "../redirects.js";
import type * as retention from "../retention.js";
import type * as revalidate from "../revalidate.js";
import type * as routing from "../routing.js";
import type * as secretCheck from "../secretCheck.js";
import type * as secrets from "../secrets.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as tags from "../tags.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _dataRegistry: typeof _dataRegistry;
  _registry: typeof _registry;
  analytics: typeof analytics;
  auditLog: typeof auditLog;
  auth: typeof auth;
  bootstrap: typeof bootstrap;
  consent: typeof consent;
  content: typeof content;
  crons: typeof crons;
  dashboard: typeof dashboard;
  dataSubject: typeof dataSubject;
  dns: typeof dns;
  emails: typeof emails;
  http: typeof http;
  invitations: typeof invitations;
  leads: typeof leads;
  "lib/auditEvent": typeof lib_auditEvent;
  "lib/authz": typeof lib_authz;
  "lib/catalogueEmails": typeof lib_catalogueEmails;
  "lib/consentRateLimit": typeof lib_consentRateLimit;
  "lib/doh": typeof lib_doh;
  "lib/expediteur": typeof lib_expediteur;
  "lib/gabarit": typeof lib_gabarit;
  "lib/hoteNu": typeof lib_hoteNu;
  "lib/leadCascade": typeof lib_leadCascade;
  "lib/leadRateLimit": typeof lib_leadRateLimit;
  "lib/originFingerprint": typeof lib_originFingerprint;
  "lib/origines": typeof lib_origines;
  "lib/ownerGuard": typeof lib_ownerGuard;
  "lib/passwordResetRateLimit": typeof lib_passwordResetRateLimit;
  "lib/passwordStrength": typeof lib_passwordStrength;
  "lib/previewToken": typeof lib_previewToken;
  "lib/publicPath": typeof lib_publicPath;
  "lib/requiredPages": typeof lib_requiredPages;
  "lib/resend": typeof lib_resend;
  "lib/safeHref": typeof lib_safeHref;
  "lib/secretsCrypto": typeof lib_secretsCrypto;
  "lib/servedPaths": typeof lib_servedPaths;
  "lib/sharedSecret": typeof lib_sharedSecret;
  "lib/signInRateLimit": typeof lib_signInRateLimit;
  "lib/slug": typeof lib_slug;
  "lib/token": typeof lib_token;
  "lib/umamiToken": typeof lib_umamiToken;
  "lib/webhookUrl": typeof lib_webhookUrl;
  media: typeof media;
  migrations: typeof migrations;
  pages: typeof pages;
  passwordReset: typeof passwordReset;
  posts: typeof posts;
  profiles: typeof profiles;
  redirects: typeof redirects;
  retention: typeof retention;
  revalidate: typeof revalidate;
  routing: typeof routing;
  secretCheck: typeof secretCheck;
  secrets: typeof secrets;
  seed: typeof seed;
  settings: typeof settings;
  tags: typeof tags;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
