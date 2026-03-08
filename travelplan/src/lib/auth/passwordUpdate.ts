import { hashPassword } from "@/lib/auth/bcrypt";

type BuildPasswordUpdateDataOptions = {
  password: string;
  clearMustChangePassword?: boolean;
};

export const buildPasswordUpdateData = async ({
  password,
  clearMustChangePassword = true,
}: BuildPasswordUpdateDataOptions) => {
  const passwordHash = await hashPassword(password);

  return {
    passwordHash,
    mustChangePassword: clearMustChangePassword ? false : undefined,
  };
};
