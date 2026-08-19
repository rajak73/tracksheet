import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";

/**
 * The signed-in user's own account details.
 *
 * ── Why this is not `PATCH /api/instructors/:id` ───────────────────────────
 * That route is an ADMINISTRATIVE action — one person editing another's
 * personnel record — and it deliberately refuses an instructor editing
 * themselves, because `employeeCode`, tenancy and roster membership are
 * organisational facts their subject must not set. Editing your OWN display
 * name, phone number and picture is a different action with a different set of
 * allowed fields, so it gets its own route rather than a role exception carved
 * into the admin one. Nothing about the existing route changes.
 *
 * ── What cannot be changed here, and why ───────────────────────────────────
 * Email is identity: it is the login, it is globally unique, and it is how the
 * bulk importer matches an existing person. Role, university, employee code and
 * active state are all organisational. None of them appear below, so no request
 * can reach them — the safety is the absence of the field, not a check.
 *
 * ── The picture ───────────────────────────────────────────────────────────
 * Accepted as a `data:` URI rather than an upload, because this application has
 * no object storage and writes no files. The type allowlist and the size cap
 * are enforced here; an oversized or non-image value is refused rather than
 * stored and served back to every viewer.
 */

/** Small enough to hold in a row and to send with a profile response. */
const MAX_AVATAR_BYTES = 256 * 1024;

const AVATAR_PREFIX = /^data:image\/(png|jpeg|webp);base64,/;

const UpdateProfile = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  // Nullable: clearing a phone number is a legitimate edit, and `undefined`
  // (absent) has to keep meaning "leave it alone".
  phone: z.string().trim().max(32).nullable().optional(),
  avatarUrl: z.string().max(MAX_AVATAR_BYTES * 2).nullable().optional(),
});

const SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  avatarUrl: true,
  role: true,
  // The employee code the person is known by internally. Read-only here — it is
  // set by an administrator — but the account menu shows it, and fetching a
  // whole instructor record just to display one string would be wasteful.
  instructorProfile: { select: { employeeCode: true } },
  managerProfile: { select: { employeeCode: true } },
} as const;

/** Flattens the profile rows into one shape the client can render directly. */
function shape(user: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  instructorProfile: { employeeCode: string | null } | null;
  managerProfile: { employeeCode: string | null } | null;
}) {
  const { instructorProfile, managerProfile, ...rest } = user;
  return {
    ...rest,
    employeeCode: instructorProfile?.employeeCode ?? managerProfile?.employeeCode ?? null,
  };
}

export const GET = withAuth(async ({ principal }) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: principal.userId },
    select: SELECT,
  });
  return NextResponse.json({ profile: shape(user) });
});

export const PATCH = withAuth(async ({ principal, scope, req }) => {
  const input = UpdateProfile.parse(await req.json().catch(() => null));

  if (typeof input.avatarUrl === "string" && input.avatarUrl !== "") {
    if (!AVATAR_PREFIX.test(input.avatarUrl)) {
      throw new ApiError(
        400,
        "INVALID_IMAGE",
        "The picture must be a PNG, JPEG or WebP image.",
      );
    }
    // The decoded size is what actually gets stored, so that is what is capped
    // — base64 inflates by a third and checking the encoded length would let a
    // third more through than intended.
    const base64 = input.avatarUrl.slice(input.avatarUrl.indexOf(",") + 1);
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes > MAX_AVATAR_BYTES) {
      throw new ApiError(
        413,
        "IMAGE_TOO_LARGE",
        `The picture must be under ${MAX_AVATAR_BYTES / 1024}KB. Try a smaller image.`,
      );
    }
  }

  const profile = await prisma.user.update({
    where: { id: principal.userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl || null } : {}),
    },
    select: SELECT,
  });

  await logAudit(principal, scope, {
    action: "PROFILE_UPDATED",
    entityType: "User",
    entityId: principal.userId,
    // Which fields changed, never their values: a phone number and a picture
    // are personal data and the audit trail does not need copies of them.
    metadata: { fields: Object.keys(input) },
  });

  return NextResponse.json({ profile: shape(profile) });
});
