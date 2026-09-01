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
import type * as ai from "../ai.js";
import type * as aiImage from "../aiImage.js";
import type * as analytics from "../analytics.js";
import type * as apiTokens from "../apiTokens.js";
import type * as auditLog from "../auditLog.js";
import type * as auth from "../auth.js";
import type * as bootstrap from "../bootstrap.js";
import type * as chat from "../chat.js";
import type * as consent from "../consent.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as dataSubject from "../dataSubject.js";
import type * as dataforseo from "../dataforseo.js";
import type * as dns from "../dns.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as leads from "../leads.js";
import type * as lib_aiSiteContext from "../lib/aiSiteContext.js";
import type * as lib_apiAuth from "../lib/apiAuth.js";
import type * as lib_apiDispatch from "../lib/apiDispatch.js";
import type * as lib_apiErrors from "../lib/apiErrors.js";
import type * as lib_apiHttp from "../lib/apiHttp.js";
import type * as lib_apiOpenapi from "../lib/apiOpenapi.js";
import type * as lib_apiPostWrite from "../lib/apiPostWrite.js";
import type * as lib_apiRoutes from "../lib/apiRoutes.js";
import type * as lib_auditEvent from "../lib/auditEvent.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_catalogueEmails from "../lib/catalogueEmails.js";
import type * as lib_chatSessionToken from "../lib/chatSessionToken.js";
import type * as lib_consentRateLimit from "../lib/consentRateLimit.js";
import type * as lib_coverCaption from "../lib/coverCaption.js";
import type * as lib_coverImage from "../lib/coverImage.js";
import type * as lib_coverPrompt from "../lib/coverPrompt.js";
import type * as lib_dataforseo from "../lib/dataforseo.js";
import type * as lib_dataforseoConfigured from "../lib/dataforseoConfigured.js";
import type * as lib_dataforseoFetch from "../lib/dataforseoFetch.js";
import type * as lib_dataforseoSerp from "../lib/dataforseoSerp.js";
import type * as lib_doh from "../lib/doh.js";
import type * as lib_expediteur from "../lib/expediteur.js";
import type * as lib_gabarit from "../lib/gabarit.js";
import type * as lib_hoteNu from "../lib/hoteNu.js";
import type * as lib_hotesSortants from "../lib/hotesSortants.js";
import type * as lib_leadCascade from "../lib/leadCascade.js";
import type * as lib_leadRateLimit from "../lib/leadRateLimit.js";
import type * as lib_notifier from "../lib/notifier.js";
import type * as lib_omitTargetKeyword from "../lib/omitTargetKeyword.js";
import type * as lib_openRouterImage from "../lib/openRouterImage.js";
import type * as lib_openRouterImageModels from "../lib/openRouterImageModels.js";
import type * as lib_openRouterModels from "../lib/openRouterModels.js";
import type * as lib_openrouter from "../lib/openrouter.js";
import type * as lib_originFingerprint from "../lib/originFingerprint.js";
import type * as lib_origines from "../lib/origines.js";
import type * as lib_ownerGuard from "../lib/ownerGuard.js";
import type * as lib_parseModelJson from "../lib/parseModelJson.js";
import type * as lib_passwordResetRateLimit from "../lib/passwordResetRateLimit.js";
import type * as lib_passwordStrength from "../lib/passwordStrength.js";
import type * as lib_pixelId from "../lib/pixelId.js";
import type * as lib_postAuthor from "../lib/postAuthor.js";
import type * as lib_postWorkingCopy from "../lib/postWorkingCopy.js";
import type * as lib_previewToken from "../lib/previewToken.js";
import type * as lib_publicPath from "../lib/publicPath.js";
import type * as lib_refreshCible from "../lib/refreshCible.js";
import type * as lib_requiredPages from "../lib/requiredPages.js";
import type * as lib_resend from "../lib/resend.js";
import type * as lib_safeHref from "../lib/safeHref.js";
import type * as lib_secretsCrypto from "../lib/secretsCrypto.js";
import type * as lib_seoGeoDraft from "../lib/seoGeoDraft.js";
import type * as lib_seoGeoPageKind from "../lib/seoGeoPageKind.js";
import type * as lib_seoGeoPrompt from "../lib/seoGeoPrompt.js";
import type * as lib_seoRankState from "../lib/seoRankState.js";
import type * as lib_seoRanksQueries from "../lib/seoRanksQueries.js";
import type * as lib_seoRanksWrite from "../lib/seoRanksWrite.js";
import type * as lib_seoRelever from "../lib/seoRelever.js";
import type * as lib_seoSiteHistory from "../lib/seoSiteHistory.js";
import type * as lib_seoSnapshot from "../lib/seoSnapshot.js";
import type * as lib_seoWeekly from "../lib/seoWeekly.js";
import type * as lib_serpLocale from "../lib/serpLocale.js";
import type * as lib_servedPaths from "../lib/servedPaths.js";
import type * as lib_sharedSecret from "../lib/sharedSecret.js";
import type * as lib_signInRateLimit from "../lib/signInRateLimit.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_socialIcons from "../lib/socialIcons.js";
import type * as lib_socialNetworks from "../lib/socialNetworks.js";
import type * as lib_storeGeneratedMedia from "../lib/storeGeneratedMedia.js";
import type * as lib_token from "../lib/token.js";
import type * as lib_umamiToken from "../lib/umamiToken.js";
import type * as lib_webhookUrl from "../lib/webhookUrl.js";
import type * as lib_yoastFindings from "../lib/yoastFindings.js";
import type * as lib_yoastPaper from "../lib/yoastPaper.js";
import type * as lib_yoastRun from "../lib/yoastRun.js";
import type * as media from "../media.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as pages from "../pages.js";
import type * as passwordReset from "../passwordReset.js";
import type * as posts from "../posts.js";
import type * as profiles from "../profiles.js";
import type * as redirects from "../redirects.js";
import type * as resendDomain from "../resendDomain.js";
import type * as retention from "../retention.js";
import type * as revalidate from "../revalidate.js";
import type * as routing from "../routing.js";
import type * as secretCheck from "../secretCheck.js";
import type * as secrets from "../secrets.js";
import type * as seed from "../seed.js";
import type * as seoAnalyze from "../seoAnalyze.js";
import type * as seoRanks from "../seoRanks.js";
import type * as settings from "../settings.js";
import type * as siteApi from "../siteApi.js";
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
  ai: typeof ai;
  aiImage: typeof aiImage;
  analytics: typeof analytics;
  apiTokens: typeof apiTokens;
  auditLog: typeof auditLog;
  auth: typeof auth;
  bootstrap: typeof bootstrap;
  chat: typeof chat;
  consent: typeof consent;
  content: typeof content;
  crons: typeof crons;
  dashboard: typeof dashboard;
  dataSubject: typeof dataSubject;
  dataforseo: typeof dataforseo;
  dns: typeof dns;
  emails: typeof emails;
  http: typeof http;
  invitations: typeof invitations;
  leads: typeof leads;
  "lib/aiSiteContext": typeof lib_aiSiteContext;
  "lib/apiAuth": typeof lib_apiAuth;
  "lib/apiDispatch": typeof lib_apiDispatch;
  "lib/apiErrors": typeof lib_apiErrors;
  "lib/apiHttp": typeof lib_apiHttp;
  "lib/apiOpenapi": typeof lib_apiOpenapi;
  "lib/apiPostWrite": typeof lib_apiPostWrite;
  "lib/apiRoutes": typeof lib_apiRoutes;
  "lib/auditEvent": typeof lib_auditEvent;
  "lib/authz": typeof lib_authz;
  "lib/catalogueEmails": typeof lib_catalogueEmails;
  "lib/chatSessionToken": typeof lib_chatSessionToken;
  "lib/consentRateLimit": typeof lib_consentRateLimit;
  "lib/coverCaption": typeof lib_coverCaption;
  "lib/coverImage": typeof lib_coverImage;
  "lib/coverPrompt": typeof lib_coverPrompt;
  "lib/dataforseo": typeof lib_dataforseo;
  "lib/dataforseoConfigured": typeof lib_dataforseoConfigured;
  "lib/dataforseoFetch": typeof lib_dataforseoFetch;
  "lib/dataforseoSerp": typeof lib_dataforseoSerp;
  "lib/doh": typeof lib_doh;
  "lib/expediteur": typeof lib_expediteur;
  "lib/gabarit": typeof lib_gabarit;
  "lib/hoteNu": typeof lib_hoteNu;
  "lib/hotesSortants": typeof lib_hotesSortants;
  "lib/leadCascade": typeof lib_leadCascade;
  "lib/leadRateLimit": typeof lib_leadRateLimit;
  "lib/notifier": typeof lib_notifier;
  "lib/omitTargetKeyword": typeof lib_omitTargetKeyword;
  "lib/openRouterImage": typeof lib_openRouterImage;
  "lib/openRouterImageModels": typeof lib_openRouterImageModels;
  "lib/openRouterModels": typeof lib_openRouterModels;
  "lib/openrouter": typeof lib_openrouter;
  "lib/originFingerprint": typeof lib_originFingerprint;
  "lib/origines": typeof lib_origines;
  "lib/ownerGuard": typeof lib_ownerGuard;
  "lib/parseModelJson": typeof lib_parseModelJson;
  "lib/passwordResetRateLimit": typeof lib_passwordResetRateLimit;
  "lib/passwordStrength": typeof lib_passwordStrength;
  "lib/pixelId": typeof lib_pixelId;
  "lib/postAuthor": typeof lib_postAuthor;
  "lib/postWorkingCopy": typeof lib_postWorkingCopy;
  "lib/previewToken": typeof lib_previewToken;
  "lib/publicPath": typeof lib_publicPath;
  "lib/refreshCible": typeof lib_refreshCible;
  "lib/requiredPages": typeof lib_requiredPages;
  "lib/resend": typeof lib_resend;
  "lib/safeHref": typeof lib_safeHref;
  "lib/secretsCrypto": typeof lib_secretsCrypto;
  "lib/seoGeoDraft": typeof lib_seoGeoDraft;
  "lib/seoGeoPageKind": typeof lib_seoGeoPageKind;
  "lib/seoGeoPrompt": typeof lib_seoGeoPrompt;
  "lib/seoRankState": typeof lib_seoRankState;
  "lib/seoRanksQueries": typeof lib_seoRanksQueries;
  "lib/seoRanksWrite": typeof lib_seoRanksWrite;
  "lib/seoRelever": typeof lib_seoRelever;
  "lib/seoSiteHistory": typeof lib_seoSiteHistory;
  "lib/seoSnapshot": typeof lib_seoSnapshot;
  "lib/seoWeekly": typeof lib_seoWeekly;
  "lib/serpLocale": typeof lib_serpLocale;
  "lib/servedPaths": typeof lib_servedPaths;
  "lib/sharedSecret": typeof lib_sharedSecret;
  "lib/signInRateLimit": typeof lib_signInRateLimit;
  "lib/slug": typeof lib_slug;
  "lib/socialIcons": typeof lib_socialIcons;
  "lib/socialNetworks": typeof lib_socialNetworks;
  "lib/storeGeneratedMedia": typeof lib_storeGeneratedMedia;
  "lib/token": typeof lib_token;
  "lib/umamiToken": typeof lib_umamiToken;
  "lib/webhookUrl": typeof lib_webhookUrl;
  "lib/yoastFindings": typeof lib_yoastFindings;
  "lib/yoastPaper": typeof lib_yoastPaper;
  "lib/yoastRun": typeof lib_yoastRun;
  media: typeof media;
  migrations: typeof migrations;
  notifications: typeof notifications;
  pages: typeof pages;
  passwordReset: typeof passwordReset;
  posts: typeof posts;
  profiles: typeof profiles;
  redirects: typeof redirects;
  resendDomain: typeof resendDomain;
  retention: typeof retention;
  revalidate: typeof revalidate;
  routing: typeof routing;
  secretCheck: typeof secretCheck;
  secrets: typeof secrets;
  seed: typeof seed;
  seoAnalyze: typeof seoAnalyze;
  seoRanks: typeof seoRanks;
  settings: typeof settings;
  siteApi: typeof siteApi;
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
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
