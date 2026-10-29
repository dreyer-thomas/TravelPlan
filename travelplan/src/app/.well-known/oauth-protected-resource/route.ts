import { isMcpEnabled } from "@/lib/oauth/config";
import { connectorDisabled, metadataJson } from "@/lib/oauth/http";
import { buildProtectedResourceMetadata } from "@/lib/oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Story 15.1, AC 4: protected-resource metadata (RFC 9728), the document the 401 on `/api/mcp` points at. */
export const GET = () => (isMcpEnabled() ? metadataJson(buildProtectedResourceMetadata()) : connectorDisabled());
