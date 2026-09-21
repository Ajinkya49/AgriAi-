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
 * Crops offered during onboarding. The v1 detection model ships with a small
 * curated set (PRD: tomato, wheat and 2–3 more common regional crops); this list
 * is what a farmer can declare as their primary crop, which is broader than what
 * the model can currently diagnose.
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
  "Cotton",
  "Sugarcane",
  "Groundnut",
  "Soybean",
] as const;
