/**
 * Minimal structural types for the slices of the GitHub REST API we consume.
 * These are intentionally partial — only the fields the normalizer reads.
 */

export interface GhUser {
  login: string;
  avatar_url?: string;
  type?: string; // "User" | "Bot" | "Organization"
}

export interface GhReactions {
  "+1"?: number;
  "-1"?: number;
  laugh?: number;
  hooray?: number;
  confused?: number;
  heart?: number;
  rocket?: number;
  eyes?: number;
}

export interface GhIssue {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  state_reason?: string | null;
  body?: string | null;
  user: GhUser;
  created_at: string;
  author_association?: string;
  reactions?: GhReactions;
  pull_request?: { merged_at?: string | null } | null;
}

export interface GhPull {
  number: number;
  merged?: boolean;
  merged_at?: string | null;
  state: "open" | "closed";
}

export interface GhComment {
  id: number;
  user: GhUser;
  body: string;
  created_at: string;
  author_association?: string;
  reactions?: GhReactions;
}

export interface GhReview {
  id: number;
  user: GhUser | null;
  body?: string | null;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
  submitted_at?: string;
  author_association?: string;
}

export interface GhReviewComment {
  id: number;
  user: GhUser;
  body: string;
  created_at: string;
  path?: string;
  author_association?: string;
  reactions?: GhReactions;
}

export interface GhTimelineEvent {
  event: string;
  created_at?: string;
  actor?: GhUser | null;
  label?: { name: string };
  assignee?: GhUser;
  commit_id?: string | null;
  source?: unknown;
  rename?: { from: string; to: string };
  state_reason?: string | null;
}
