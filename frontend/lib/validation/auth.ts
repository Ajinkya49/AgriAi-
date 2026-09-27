import { z } from "zod";

/**
 * Form validation schemas (Zod, per the TRD).
 *
 * These validate the *shape* of user input on the way in. They are not the
 * access boundary — that is Row Level Security in the database. Nothing here
 * should be treated as a security control.
 */

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address")
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address");

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80, "That name is too long"),
  email: emailField,
  // Supabase's own minimum is 6; 8 is a sensible floor for a public app.
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(72, "Passwords cannot be longer than 72 characters"),
});

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password"),
});

export const onboardingSchema = z.object({
  region: z.string().trim().max(80).optional(),
  primary_crops: z.array(z.string().trim().max(40)).max(12).optional(),
});

/**
 * Account settings. A superset of onboarding — the same region and crops, plus
 * the display name that `users.name` holds and the community feed shows.
 */
export const settingsSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(80),
  region: z.string().trim().max(80).optional(),
  primary_crops: z.array(z.string().trim().max(40)).max(12).optional(),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Indian states and union territories, offered on the onboarding screen.
 * `users.region` is free text, so this list only drives the picker.
 */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

/**
 * Crops a farmer can declare as theirs.
 *
 * `users.primary_crops` is intentionally broader than what the v1 model can
 * diagnose — a farmer grows what they grow, and the profile should reflect that
 * regardless of the model's current scope. The list previously implied coverage
 * the model does not have (it offered 12 crops while only 3 are diagnosable),
 * which is handled by `DIAGNOSABLE_CROPS` below rather than by shrinking this.
 *
 * Kept in sync with the backend's `DIAGNOSABLE_CROPS` by
 * `frontend/e2e/crop-coverage.mjs`.
 */
export const CROP_OPTIONS = [
  "Tomato",
  "Wheat",
  "Potato",
  "Rice",
  "Maize",
  "Onion",
  "Brinjal",
  "Chilli",
  "Pepper",
  "Cotton",
  "Sugarcane",
  "Groundnut",
  "Soybean",
] as const;

export type CropOption = (typeof CROP_OPTIONS)[number];

/**
 * Crops the v1 detection model was actually trained on.
 *
 * MIRRORS `backend/app/models/labels.py` → `DIAGNOSABLE_CROPS`, which derives it
 * from the class taxonomy. Duplicated here because the crop picker is a client
 * component and the model's taxonomy is not importable from the browser; the
 * authoritative value is served at `GET /api/health/dependencies` →
 * `model.diagnosable_crops`.
 *
 * ⚠️ Why this list matters: the classifier has a fixed output layer over 10
 * classes, so it has no way to answer "none of mine". Photograph a cotton leaf
 * and it will still return its best-fitting trained class with a
 * confident-looking score. Telling the farmer up front is the honest fix.
 *
 * `frontend/e2e/crop-coverage.mjs` asserts this matches the backend and fails the
 * suite if the model learns a new crop without this being updated.
 */
export const DIAGNOSABLE_CROPS = ["Tomato", "Potato", "Pepper"] as const;

export type DiagnosableCrop = (typeof DIAGNOSABLE_CROPS)[number];

/** True when the model can actually diagnose `crop` (case-insensitive). */
export function isDiagnosableCrop(crop: string): boolean {
  const needle = crop.trim().toLowerCase();
  return DIAGNOSABLE_CROPS.some((c) => c.toLowerCase() === needle);
}

/**
 * Picker order: diagnosable crops first, so the ones that produce a real result
 * are the easiest to reach. Within each group the declared order is preserved.
 *
 * Not alphabetical on purpose — for a farmer scanning a row of chips, "what
 * works" is a more useful sort than "what starts with A".
 */
export const CROP_OPTIONS_ORDERED: readonly string[] = [
  ...DIAGNOSABLE_CROPS,
  ...CROP_OPTIONS.filter(
    (c) => !DIAGNOSABLE_CROPS.some((d) => d.toLowerCase() === c.toLowerCase()),
  ),
];
