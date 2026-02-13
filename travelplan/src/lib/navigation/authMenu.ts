export type AuthMenuItem = {
  key: "login" | "register" | "logout";
  labelKey: string;
  href?: string;
};

export const getAuthMenuItems = (isAuthenticated: boolean): AuthMenuItem[] => {
  if (isAuthenticated) {
    return [{ key: "logout", labelKey: "auth.logout" }];
  }

  return [
    { key: "login", labelKey: "auth.login", href: "/auth/login" },
    { key: "register", labelKey: "auth.register", href: "/auth/register" },
  ];
};
