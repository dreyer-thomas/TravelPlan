import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Ceiling on a request body that passes through the middleware, which `middleware.ts`'s
     * matcher applies to every `/api/trips/:path*` route — the trip import among them.
     *
     * Next buffers such a body before the handler runs and caps that buffer at **10 MB** by
     * default. `MAX_IMPORT_PACKAGE_BYTES` allows a 100 MB backup, so without this a
     * photo-bearing import is truncated mid-body, `request.formData()` throws, and the route
     * answers `400 invalid_form_data` — which the dialog renders as "this backup could not be
     * read, it may be incomplete or damaged" for a file that is perfectly intact. Measured: a
     * 13.4 MB export (one trip, four photos) fails on the stock config and succeeds here.
     *
     * 110 MB rather than 100: `multipart/form-data` wraps the archive in boundaries and part
     * headers, so a backup at exactly the app's limit is larger than that on the wire. The
     * reverse proxy in front of this app needs the same headroom — see
     * `client_max_body_size` in its server block.
     *
     * Note the key: Next's own oversize warning still names `middlewareClientMaxBodySize`,
     * which is deprecated in this version. `proxyClientMaxBodySize` is the current one.
     */
    proxyClientMaxBodySize: "110mb",
  },
};

export default nextConfig;
