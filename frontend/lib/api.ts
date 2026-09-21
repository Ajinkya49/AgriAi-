import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

/**
 * Client for the FastAPI backend, called from the browser.
 *
 * Every authenticated request carries the caller's Supabase access token, so the
 * backend can verify the session and act *as that farmer* — which is what makes
 * Row Level Security apply on the server side too.
 *
 * Feature phases add typed helpers here rather than calling `fetch` ad hoc from
 * components.
 */

export const API_BASE_URL = env.NEXT_PUBLIC_API_BASE_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // fall through to the generic message
  }
  return "Something went wrong. Please try again.";
}

/** Authenticated request to the backend, as the signed-in farmer. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;
  if (!token) {
    throw new ApiError("Your session has expired. Please log in again.", 401);
  }

  // Let the browser set Content-Type for FormData — it has to include the
  // multipart boundary, which we cannot know in advance.
  const isFormData = init.body instanceof FormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------
 * Health probes (used by the landing page)
 * ---------------------------------------------------------------------- */

export type HealthResponse = {
  status: string;
  service: string;
  environment: string;
  version: string;
};

export type DependencyHealthResponse = {
  status: string;
  supabase: { configured: boolean; connected: boolean; detail: string };
  model: {
    configured: boolean;
    path: string;
    version: string;
    loaded: boolean;
    num_classes: number | null;
    error: string | null;
  };
  rag: { configured: boolean; index_path: string; loaded: boolean };
};

async function publicRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new ApiError(await readError(response), response.status);
  }
  return (await response.json()) as T;
}

export function getHealth(): Promise<HealthResponse> {
  return publicRequest<HealthResponse>("/api/health");
}

export function getDependencyHealth(): Promise<DependencyHealthResponse> {
  return publicRequest<DependencyHealthResponse>("/api/health/dependencies");
}

/* -------------------------------------------------------------------------
 * Diagnosis (Phase 4)
 * ---------------------------------------------------------------------- */

export type DiagnosisAlternative = {
  disease_name: string;
  display_name: string;
  confidence_score: number;
};

/**
 * One curated Natural or Traditional solution.
 *
 * Always a row from the `solutions` table — the LLM never writes these.
 */
export type Solution = {
  id: string;
  solution_type: "natural" | "traditional";
  title: string;
  description: string;
  source_name: string;
  source_url: string | null;
  region_specific: string | null;
  verified: boolean;
};

export type Solutions = {
  natural: Solution[];
  traditional: Solution[];
  total: number;
  /** False when one of the sections is empty — the UI says so rather than showing a blank panel. */
  complete: boolean;
};

export type Diagnosis = {
  id: string;
  user_id: string;
  image_url: string;
  image_signed_url: string | null;
  crop_type: string;
  predicted_disease: string;
  confidence_score: number;
  symptoms_summary: string | null;
  model_version: string;
  created_at: string;
  confidence_band: "high" | "medium" | "low";
  needs_expert_confirmation: boolean;
  is_reliable: boolean;
  is_healthy: boolean;
  alternatives: DiagnosisAlternative[] | null;
  solutions: Solutions | null;
};

/** Upload a crop photo and receive a stored diagnosis. */
export function diagnoseImage(file: File): Promise<Diagnosis> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<Diagnosis>("/api/diagnose", { method: "POST", body: form });
}

/** Fetch one stored diagnosis. */
export function getDiagnosis(id: string): Promise<Diagnosis> {
  return apiFetch<Diagnosis>(`/api/diagnoses/${id}`);
}

/** Dashboard history for the signed-in farmer. */
export function listDiagnoses(
  userId: string,
): Promise<{ items: Diagnosis[]; total: number }> {
  return apiFetch<{ items: Diagnosis[]; total: number }>(`/api/diagnoses/user/${userId}`);
}

/* -------------------------------------------------------------------------
 * Farming assistant (Phase 6)
 * ---------------------------------------------------------------------- */

/** A knowledge-base excerpt an answer drew on. */
export type AssistantSource = {
  index: number;
  source: string;
  score: number;
  excerpt: string;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: AssistantSource[];
  created_at: string;
};

export type AssistantStatus = {
  available: boolean;
  index_loaded: boolean;
  chunk_count: number | null;
  embedding_model: string | null;
  built_at: string | null;
  chat_model: string | null;
  error: string | null;
  suggested_questions: string[];
  /** The same starters in Hindi. Returned up-front so switching language is instant. */
  suggested_questions_hi: string[];
  /** Languages the assistant answers in, e.g. ["en", "hi"]. */
  supported_languages: string[];
};

export type AskResponse = {
  conversation_id: string;
  message_id: string;
  answer: string;
  sources: AssistantSource[];
  model: string;
  /** True when the knowledge base did not cover the question. */
  refused: boolean;
};

export function getAssistantStatus(): Promise<AssistantStatus> {
  return apiFetch<AssistantStatus>("/api/assistant/status");
}

/** Ask the farming assistant a question, optionally as a follow-up to a diagnosis. */
export function askAssistant(
  message: string,
  options: { diagnosisId?: string; conversationId?: string } = {},
): Promise<AskResponse> {
  return apiFetch<AskResponse>("/api/assistant/message", {
    method: "POST",
    body: JSON.stringify({
      message,
      diagnosis_id: options.diagnosisId ?? null,
      conversation_id: options.conversationId ?? null,
    }),
  });
}

export function getConversation(conversationId: string): Promise<{
  id: string;
  diagnosis_id: string | null;
  created_at: string;
  messages: AssistantMessage[];
}> {
  return apiFetch(`/api/assistant/conversations/${conversationId}`);
}

/* -------------------------------------------------------------------------
 * Farmer community (Phase 7)
 * ---------------------------------------------------------------------- */

/** Public display fields for an author — never email, phone or region. */
export type Author = {
  id: string;
  name: string;
  role: string;
};

export type Community = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count: number;
  post_count: number;
  is_member: boolean;
};

export type Post = {
  id: string;
  community_id: string;
  community_name: string | null;
  user_id: string;
  author: Author | null;
  content: string;
  image_url: string | null;
  image_signed_url: string | null;
  diagnosis_id: string | null;
  /** e.g. "Tomato — Late Blight (99%)", shown as a badge on a shared diagnosis. */
  diagnosis_summary: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  is_mine: boolean;
};

export type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  author: Author | null;
  content: string;
  created_at: string;
  is_mine: boolean;
};

export type PostDetail = Post & { comments: Comment[] };

export function listCommunities(): Promise<{ items: Community[]; total: number }> {
  return apiFetch("/api/communities");
}

export function getCommunity(id: string): Promise<Community> {
  return apiFetch(`/api/communities/${id}`);
}

export function createCommunity(name: string, description?: string): Promise<Community> {
  return apiFetch("/api/communities", {
    method: "POST",
    body: JSON.stringify({ name, description: description || null }),
  });
}

export function joinCommunity(
  id: string,
): Promise<{ community_id: string; is_member: boolean; member_count: number }> {
  return apiFetch(`/api/communities/${id}/join`, { method: "POST" });
}

export function leaveCommunity(
  id: string,
): Promise<{ community_id: string; is_member: boolean; member_count: number }> {
  return apiFetch(`/api/communities/${id}/join`, { method: "DELETE" });
}

export function listCommunityPosts(
  communityId: string,
): Promise<{ items: Post[]; total: number }> {
  return apiFetch(`/api/communities/${communityId}/posts`);
}

export function createPost(input: {
  communityId: string;
  content: string;
  diagnosisId?: string | null;
}): Promise<Post> {
  return apiFetch("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      community_id: input.communityId,
      content: input.content,
      diagnosis_id: input.diagnosisId ?? null,
    }),
  });
}

export function getPost(id: string): Promise<PostDetail> {
  return apiFetch(`/api/posts/${id}`);
}

export function createComment(postId: string, content: string): Promise<Comment> {
  return apiFetch(`/api/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function likePost(
  postId: string,
): Promise<{ post_id: string; liked: boolean; like_count: number }> {
  return apiFetch(`/api/posts/${postId}/like`, { method: "POST" });
}

export function unlikePost(
  postId: string,
): Promise<{ post_id: string; liked: boolean; like_count: number }> {
  return apiFetch(`/api/posts/${postId}/like`, { method: "DELETE" });
}
