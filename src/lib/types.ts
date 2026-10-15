export type AwardCode =
  | "overall"
  | "music"
  | "composition"
  | "creative"
  | "humor"
  | "theme";
export type Award = {
  code: AwardCode;
  name: string;
  min_votes: number;
  max_votes: number;
  display_order: number;
};
export type Video = {
  video_id: string;
  display_order: number;
  title: string;
  author_nico_user_id: string;
  author_name: string;
  theme: string | null;
  watch_url: string;
  thumbnail_url: string | null;
  posted_at: string | null;
  is_active: boolean;
};
export type Profile = {
  user_id: string;
  display_name: string;
  nico_user_id: string;
};
export type Entry = {
  award_code: AwardCode;
  video_id: string;
  comment: string;
};
export type Ballot = {
  year: number;
  id: string;
  voter_id: string;
  status: "draft" | "submitted";
  revision: number;
  submitted_at: string | null;
};
export type Poll = {
  year: number;
  title: string;
  id: number;
  starts_at: string | null;
  ends_at: string | null;
  is_published: boolean;
  results_public: boolean;
  master_revision: number;
};
export type AdminVoter = {
  ballot_id: string;
  voter_id: string | null;
  display_name: string;
  nico_user_id: string;
  source: "site" | "historical";
  status: "draft" | "submitted" | "imported";
};
export type AdminVideosData = {
  kind: "videos";
  year: number;
  master_revision: number;
  videos: Video[];
};
export type AdminVotersData = {
  kind: "voters";
  year: number;
  voters: AdminVoter[];
};
export type AdminYearData = AdminVideosData | AdminVotersData;
export type Ranking = {
  award_code: string;
  award_name: string;
  video_id: string;
  title: string;
  author_name: string;
  votes: number;
  creator_bonus?: number;
  points?: number;
  rank: number;
};
export type HistoryYear = {
  year: number;
  title: string;
  ends_at: string | null;
  results_public: boolean;
  status: Ballot["status"] | null;
  submitted_at: string | null;
  entry_count: number;
};
export type VoteHistory = {
  years: HistoryYear[];
  poll?: Poll;
  ballot?: Ballot | null;
  entries?: (Entry & {
    award_name: string;
    title: string;
    author_name: string;
    watch_url: string;
  })[];
  rankings?: Ranking[];
  results_public?: boolean;
};
export type VoteData = {
  profile: Profile;
  awards: Award[];
  videos: Video[];
  ballot: Ballot | null;
  entries: Entry[];
  poll: Poll;
  isAdmin: boolean;
};
