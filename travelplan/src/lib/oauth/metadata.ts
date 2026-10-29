import { getIssuer, getMcpResourceUrl, MCP_SCOPE, OFFLINE_ACCESS_SCOPE } from "@/lib/oauth/config";

/**
 * Story 15.1, AC 4-5. The two discovery documents, built in one place so the issuer and the resource can
 * never disagree between them.
 *
 * Claude specifics (claude.com/docs/connectors/building/authentication): it uses CIMD only when both
 * `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported` are
 * present, uses only the first authorization server, and adds `offline_access` to its request when the
 * authorization server lists it. The MCP spec says the resource metadata should not list `offline_access`,
 * so it appears only in the authorization-server document. No `registration_endpoint`: DCR is not offered.
 */

export const buildProtectedResourceMetadata = () => ({
  resource: getMcpResourceUrl(),
  authorization_servers: [getIssuer()],
  scopes_supported: [MCP_SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "TravelPlan",
});

export const buildAuthorizationServerMetadata = () => {
  const issuer = getIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE, OFFLINE_ACCESS_SCOPE],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
};
