export type AuthMenuItem = {
  key: "login" | "register" | "logout";
  label: string;
  href?: string;
};

export const getAuthMenuItems = (isAuthenticated: boolean): AuthMenuItem[] => {
  if (isAuthenticated) {
    return [{ key: "logout", label: "Sign out" }];
  }

  return [
    { key: "login", label: "Login", href: "/auth/login" },
    { key: "register", label: "Register", href: "/auth/register" },
  ];
};
