import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Ceiling on a request body that passes through the middleware, which `middleware.ts`'s
     * matcher applies to every `/api/trips/*` route **except** `/api/trips/import`.
     *
     * Next buffers such a body in memory before the handler runs and caps that buffer at **10 MB**
     * by default. That default is what truncated a 13.4 MB photo-bearing import mid-body on
     * 2026-08-02, making `request.formData()` throw and the route answer `400 invalid_form_data` —
     * which the dialog renders as "this backup could not be read, it may be incomplete or damaged"
     * for a file that is perfectly intact.
     *
     * **What this number covers now is the four image upload routes, and only them.** Story 2.34
     * took the import out of the matcher, so the one request that ever justified 320 MB no longer
     * passes through here at all — its body is streamed straight to a temp file. What is still
     * matched and still multipart is `trips/[id]/hero-image`, `trips/[id]/accommodations/images` and
     * `trips/[id]/day-plan-items/images` at 5 MB each, and `trips/[id]/days/[dayId]/image` at 15 MB;
     * every one of them calls `request.formData()`, so a matched request costs Next's buffer plus the
     * `File` it builds out of it.
     *
     * Leaving it at 320 MB after the import moved out therefore relocated the exact hazard this story
     * exists to remove onto its neighbours: two 320 MB copies on endpoints that need at most 15 MB.
     * **20 MB** on 2026-08-03 — above the highest per-route ceiling with room for the boundaries and
     * part headers `multipart/form-data` wraps a file in, and 16× less to buffer if one of those
     * routes is attacked. Raising it again is only correct if one of those four routes raises its own
     * `MAX_FILE_SIZE_BYTES` first.
     *
     * **Lowering it moved the truncation cliff, so the four routes grew a guard for it.** Over this
     * number Next truncates rather than refuses (`getCloneableBody` logs and pushes `null`), which is
     * how an intact file came to be reported as damaged in the first place. At 320 MB no real upload
     * ever reached the cliff; at 20 MB a 25 MB photo does, and it would have answered
     * `invalid_form_data` where 320 MB answered "exceeds size limit". Each of the four now checks
     * `declaredBodyExceedsFileLimit` before touching the body, so the accurate message survives the
     * smaller buffer — see `src/lib/http/bodyLimit.ts`. That guard is what makes 20 MB safe to keep.
     *
     * The reverse proxy's `client_max_body_size 320m` stays where it is regardless: the import still
     * passes through nginx even though it no longer passes through the middleware, and 320m is what
     * lets a 300 MB backup reach this app to be accepted or refused with its own message. See
     * `importLimits.ts`.
     *
     * Note the key: Next's own oversize warning still names `middlewareClientMaxBodySize`,
     * which is deprecated in this version. `proxyClientMaxBodySize` is the current one.
     */
    proxyClientMaxBodySize: "20mb",
  },
};

export default nextConfig;
