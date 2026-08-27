import { v } from "convex/values";

export const roleValidator = v.union(
  v.literal("teacher"),
  v.literal("student"),
  v.literal("operator"),
);

export const userStatusValidator = v.union(
  v.literal("active"),
  v.literal("voided"),
);

export const userPublicValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  privyDid: v.string(),
  email: v.string(),
  displayName: v.string(),
  role: roleValidator,
  status: userStatusValidator,
});
