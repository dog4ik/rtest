import type { InteractionLog } from "./interaction_logs";

export type GwConnectError = {
  result: boolean;
  error: string;
  logs: InteractionLog[];
};
