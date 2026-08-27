import {
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { mutation, query } from "../_generated/server";
import { requireStudent, requireUser } from "./auth";

export const authedQuery = customQuery(query, {
  args: {},
  input: async (ctx, args) => {
    const user = await requireUser(ctx);
    return { ctx: { ...ctx, user }, args };
  },
});

export const authedMutation = customMutation(mutation, {
  args: {},
  input: async (ctx, args) => {
    const user = await requireUser(ctx);
    return { ctx: { ...ctx, user }, args };
  },
});

export const studentQuery = customQuery(query, {
  args: {},
  input: async (ctx, args) => {
    const user = await requireStudent(ctx);
    return { ctx: { ...ctx, user }, args };
  },
});

export const studentMutation = customMutation(mutation, {
  args: {},
  input: async (ctx, args) => {
    const user = await requireStudent(ctx);
    return { ctx: { ...ctx, user }, args };
  },
});
