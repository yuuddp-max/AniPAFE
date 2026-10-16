import type { LinkedOriginalEntry, VoteData } from "./types";

export const isOriginalSelection = (entry: LinkedOriginalEntry) =>
  entry.video_id !== null || entry.source_video_number !== null;

export function initialVoteSource(data: VoteData) {
  return data.ballot?.status === "submitted" || data.entries.length > 0
    ? "site"
    : (data.linkedOriginals?.[0]?.id ?? "site");
}
