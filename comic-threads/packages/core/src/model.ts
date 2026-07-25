/**
 * Source-agnostic Thread model (DESIGN.md §4.1). GitHub is the first source;
 * Reddit/HN would normalize into this same shape. The engine never sees a
 * GitHub-specific field — everything downstream operates on `Thread`.
 */

export type ThreadState = "open" | "closed" | "merged";

export type ParticipantRole = "author" | "maintainer" | "contributor" | "bot";

export interface Participant {
  login: string;
  displayName: string;
  avatarUrl?: string;
  role: ParticipantRole;
}

/** A spoken comment: issue body, comment, or PR review comment (whisper). */
export interface Utterance {
  kind: "utterance";
  author: string;
  body: string;
  ts: string;
  /** whisper = PR review comment (rendered as a dashed aside balloon). */
  mode: "say" | "whisper";
  reactions?: Record<string, number>;
  /** Fenced code blocks pulled out of `body`, rendered as terminal cards. */
  codeBlocks?: CodeBlock[];
}

export interface CodeBlock {
  lang: string;
  text: string;
}

export type EventFlavor =
  | "open"
  | "close"
  | "merge"
  | "label"
  | "assign"
  | "review-approve"
  | "review-changes"
  | "commit"
  | "misc";

/** A timeline event rendered as a caption box (narration). */
export interface ThreadEvent {
  kind: "event";
  ts: string;
  text: string;
  flavor: EventFlavor;
  /** Optional actor login (for casting the celebration/wave panels). */
  actor?: string;
}

export type ThreadItem = Utterance | ThreadEvent;

export interface Thread {
  source: "github";
  /** "owner/repo#123" */
  id: string;
  title: string;
  url: string;
  state: ThreadState;
  participants: Participant[];
  items: ThreadItem[];
}

export function isUtterance(item: ThreadItem): item is Utterance {
  return item.kind === "utterance";
}

export function isEvent(item: ThreadItem): item is ThreadEvent {
  return item.kind === "event";
}
