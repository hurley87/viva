/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assessments from "../assessments.js";
import type * as assignments from "../assignments.js";
import type * as deployment from "../deployment.js";
import type * as examiner_instructions from "../examiner/instructions.js";
import type * as examiner_realtime from "../examiner/realtime.js";
import type * as grader_assessmentSchema from "../grader/assessmentSchema.js";
import type * as grader_prompt from "../grader/prompt.js";
import type * as grader_run from "../grader/run.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_identity from "../lib/identity.js";
import type * as lib_time from "../lib/time.js";
import type * as seed from "../seed.js";
import type * as sessions from "../sessions.js";
import type * as spend from "../spend.js";
import type * as standards from "../standards.js";
import type * as student from "../student.js";
import type * as transcript from "../transcript.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  assessments: typeof assessments;
  assignments: typeof assignments;
  deployment: typeof deployment;
  "examiner/instructions": typeof examiner_instructions;
  "examiner/realtime": typeof examiner_realtime;
  "grader/assessmentSchema": typeof grader_assessmentSchema;
  "grader/prompt": typeof grader_prompt;
  "grader/run": typeof grader_run;
  "lib/config": typeof lib_config;
  "lib/constants": typeof lib_constants;
  "lib/identity": typeof lib_identity;
  "lib/time": typeof lib_time;
  seed: typeof seed;
  sessions: typeof sessions;
  spend: typeof spend;
  standards: typeof standards;
  student: typeof student;
  transcript: typeof transcript;
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
