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
import type * as auth from "../auth.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as invitations from "../invitations.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_ownerGuard from "../lib/ownerGuard.js";
import type * as lib_passwordStrength from "../lib/passwordStrength.js";
import type * as lib_previewToken from "../lib/previewToken.js";
import type * as lib_signInRateLimit from "../lib/signInRateLimit.js";
import type * as lib_token from "../lib/token.js";
import type * as pages from "../pages.js";
import type * as profiles from "../profiles.js";
import type * as revalidate from "../revalidate.js";
import type * as siteContent from "../siteContent.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  _registry: typeof _registry;
  auth: typeof auth;
  content: typeof content;
  crons: typeof crons;
  http: typeof http;
  invitations: typeof invitations;
  "lib/authz": typeof lib_authz;
  "lib/ownerGuard": typeof lib_ownerGuard;
  "lib/passwordStrength": typeof lib_passwordStrength;
  "lib/previewToken": typeof lib_previewToken;
  "lib/signInRateLimit": typeof lib_signInRateLimit;
  "lib/token": typeof lib_token;
  pages: typeof pages;
  profiles: typeof profiles;
  revalidate: typeof revalidate;
  siteContent: typeof siteContent;
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
