import type { Profile } from "./types";

export type HistoricalVoter = {
  id: string;
  source_row: number;
  display_name: string;
  nico_user_id: string | null;
  source_timestamp: string;
  user_id: string | null;
  link_revision: number;
  linked_at: string | null;
};
export type HistoricalVoterData = {
  year: number;
  voters: HistoricalVoter[];
  users: Profile[];
};

export function matchingNicoId(a: string | null, b: string | null) {
  const normalize = (s: string | null) => {
    const value = s?.trim() ?? "";
    return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : null;
  };
  const left = normalize(a);
  return left !== null && left === normalize(b);
}
