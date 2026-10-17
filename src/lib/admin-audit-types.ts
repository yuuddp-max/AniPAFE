export type AdminAuditRow = {
  id: number;
  action: string;
  target: string | null;
  created_at: string;
  summary: Record<string, unknown>;
};
