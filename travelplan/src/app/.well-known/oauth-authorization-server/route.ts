import { isMcpEnabled } from "@/lib/oauth/config";
import { connectorDisabled, metadataJson } from "@/lib/oauth/http";
import { buildAuthorizationServerMetadata } from "@/lib/oauth/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Story 15.1, AC 5: authorization-server metadata (RFC 8414). */
export const GET = () => (isMcpEnabled() ? metadataJson(buildAuthorizationServerMetadata()) : connectorDisabled());
