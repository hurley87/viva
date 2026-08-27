/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as examiner_constants from "../examiner/constants.js";
import type * as examiner_instructions from "../examiner/instructions.js";
import type * as health from "../health.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_caps from "../lib/caps.js";
import type * as lib_customFunctions from "../lib/customFunctions.js";
import type * as lib_sessionEnd from "../lib/sessionEnd.js";
import type * as lib_transcript from "../lib/transcript.js";
import type * as lib_validators from "../lib/validators.js";
import type * as realtime from "../realtime.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as standards from "../standards.js";
import type * as transcripts from "../transcripts.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "examiner/constants": typeof examiner_constants;
  "examiner/instructions": typeof examiner_instructions;
  health: typeof health;
  "lib/auth": typeof lib_auth;
  "lib/caps": typeof lib_caps;
  "lib/customFunctions": typeof lib_customFunctions;
  "lib/sessionEnd": typeof lib_sessionEnd;
  "lib/transcript": typeof lib_transcript;
  "lib/validators": typeof lib_validators;
  realtime: typeof realtime;
  seed: typeof seed;
  sessions: typeof sessions;
  standards: typeof standards;
  transcripts: typeof transcripts;
  users: typeof users;
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

export declare const components: {};
