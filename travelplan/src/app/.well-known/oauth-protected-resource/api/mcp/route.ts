import { isMcpEnabled } from "@/lib/oauth/config";
import { connectorDisabled, metadataJson } from "@/lib/oauth/http";
import { buildProtectedResourceMetadata } from "@/lib/oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Story 15.1, AC 4: the path-inserted form of the same document (RFC 9728 §3.1), which clients probe when
 * a 401 carries no `resource_metadata` pointer. Ours always does; this is the fallback.
 */
export const GET = () => (isMcpEnabled() ? metadataJson(buildProtectedResourceMetadata()) : connectorDisabled());
