/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _registry from "../_registry.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as bootstrap from "../bootstrap.js";
import type * as consent from "../consent.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as leads from "../leads.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_ownerGuard from "../lib/ownerGuard.js";
import type * as lib_passwordStrength from "../lib/passwordStrength.js";
import type * as lib_previewToken from "../lib/previewToken.js";
import type * as lib_resend from "../lib/resend.js";
import type * as lib_safeHref from "../lib/safeHref.js";
import type * as lib_servedPaths from "../lib/servedPaths.js";
import type * as lib_signInRateLimit from "../lib/signInRateLimit.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_token from "../lib/token.js";
import type * as lib_umamiToken from "../lib/umamiToken.js";
import type * as lib_webhookUrl from "../lib/webhookUrl.js";
import type * as media from "../media.js";
import type * as migrations from "../migrations.js";
import type * as pages from "../pages.js";
import type * as posts from "../posts.js";
import type * as profiles from "../profiles.js";
import type * as redirects from "../redirects.js";
import type * as revalidate from "../revalidate.js";
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
  _registry: typeof _registry;
  analytics: typeof analytics;
  auth: typeof auth;
  bootstrap: typeof bootstrap;
  consent: typeof consent;
  content: typeof content;
  crons: typeof crons;
  http: typeof http;
  invitations: typeof invitations;
  leads: typeof leads;
  "lib/authz": typeof lib_authz;
  "lib/ownerGuard": typeof lib_ownerGuard;
  "lib/passwordStrength": typeof lib_passwordStrength;
  "lib/previewToken": typeof lib_previewToken;
  "lib/resend": typeof lib_resend;
  "lib/safeHref": typeof lib_safeHref;
  "lib/servedPaths": typeof lib_servedPaths;
  "lib/signInRateLimit": typeof lib_signInRateLimit;
  "lib/slug": typeof lib_slug;
  "lib/token": typeof lib_token;
  "lib/umamiToken": typeof lib_umamiToken;
  "lib/webhookUrl": typeof lib_webhookUrl;
  media: typeof media;
  migrations: typeof migrations;
  pages: typeof pages;
  posts: typeof posts;
  profiles: typeof profiles;
  redirects: typeof redirects;
  revalidate: typeof revalidate;
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
