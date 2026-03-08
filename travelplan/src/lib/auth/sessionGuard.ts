import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail } from "@/lib/http/response";
import { verifySessionJwt, type SessionJwtPayload } from "@/lib/auth/jwt";

type RequireSessionOptions = {
  allowPasswordChangeRequired?: boolean;
};

export const getRequestSession = async (request: NextRequest): Promise<SessionJwtPayload | null> => {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return null;
  }

  try {
    return await verifySessionJwt(token);
  } catch {
    return null;
  }
};

export const requireSession = async (request: NextRequest, options?: RequireSessionOptions) => {
  const session = await getRequestSession(request);
  if (!session) {
    return {
      response: fail(apiError("unauthorized", "Authentication required"), 401),
      session: null,
    };
  }

  if (session.mustChangePassword && !options?.allowPasswordChangeRequired) {
    return {
      response: fail(apiError("password_change_required", "Password change required"), 403),
      session: null,
    };
  }

  return {
    response: null,
    session,
  };
};
