import { z } from "zod";

const ProjectValues = [
  "reactivepay",
  "8pay",
  "fxmb",
  "spinpay",
  "rizonpay",
  "reactivepaystage",
  "oxypay",
  "driedel",
] as const;

export type Project = (typeof ProjectValues)[number];

export const ProjectSchema = z.enum(ProjectValues);

export const ALL_PROJECTS: readonly Project[] = ProjectValues;
