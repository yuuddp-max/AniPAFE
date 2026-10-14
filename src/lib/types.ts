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
  id: string;
  voter_id: string;
  status: "draft" | "submitted";
  revision: number;
  submitted_at: string | null;
};
export type Poll = {
  id: number;
  starts_at: string | null;
  ends_at: string | null;
  is_published: boolean;
  results_public: boolean;
  master_revision: number;
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
