import { redirect } from "next/navigation";

/**
 * `/admin` sends you to the one thing it administers (Story 5.10, AC2).
 *
 * `middleware.ts`'s matcher already covers `/admin/:path*` and its comment already claimed this redirect
 * existed - it did not, so the obvious parent of the URL behind a menu row labelled "User administration"
 * returned a 404. The row itself links straight to `/admin/users`; this exists for the address typed by hand.
 *
 * No role check here, and none needed: the redirect leads to a page that gates itself, so this cannot leak
 * anything. The middleware has already turned a signed-out caller away at both paths.
 */
export default function AdminIndexPage() {
  redirect("/admin/users");
}
