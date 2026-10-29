import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import OAuthConsentCard from "@/components/features/oauth/OAuthConsentCard";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { buildErrorRedirectUrl, validateAuthorizeRequest } from "@/lib/oauth/authorizeRequest";
import { isMcpEnabled } from "@/lib/oauth/config";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const toSearchParams = (raw: Record<string, string | string[] | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  return params;
};

/** A signed-in user who may act now; a forced password change counts as not signed in (AC 10). */
const resolveConsentingUser = async () => {
  const token = (await cookies()).get("session")?.value;
  if (!token) return null;
  try {
    const session = await verifySessionJwt(token);
    if (session.mustChangePassword) return null;
    return await prisma.user.findUnique({ where: { id: session.sub }, select: { id: true, email: true } });
  } catch {
    return null;
  }
};

/**
 * Story 15.1, AC 9-11. The authorization endpoint of the connector's OAuth server.
 *
 * Outside the proxy matcher on purpose, so it guards itself: validate first (an invalid client or redirect
 * renders an error card and never redirects anywhere), then send a signed-out visitor through the login page
 * and back here via `returnTo`, then show the consent card. `redirect()` throws, so it is never inside a `try`.
 */
export default async function OAuthAuthorizePage({ searchParams }: PageProps) {
  if (!isMcpEnabled()) notFound();

  const params = toSearchParams(await searchParams);
  const validation = await validateAuthorizeRequest(params);

  if (validation.kind === "fatal") {
    return <OAuthConsentCard mode="error" reason={validation.reason} />;
  }
  if (validation.kind === "redirectError") {
    redirect(buildErrorRedirectUrl(validation));
  }

  const query = params.toString();
  const user = await resolveConsentingUser();
  if (!user) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }

  const request = validation.request;
  return (
    <OAuthConsentCard
      mode="consent"
      query={query}
      clientName={request.client.clientName}
      clientHost={new URL(request.client.clientId).host}
      redirectHost={new URL(request.redirectUri).host}
      email={user.email}
      loopbackOnly={request.loopbackOnly}
    />
  );
}
