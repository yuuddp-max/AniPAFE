type AvatarUser = {
  identities?: { provider: string; identity_data?: Record<string, unknown> }[];
  user_metadata: Record<string, unknown>;
};

export function googleAvatar(user: AvatarUser): string | null {
  const google = user.identities?.find(
    (identity) => identity.provider === "google",
  )?.identity_data;
  for (const value of [
    google?.avatar_url,
    google?.picture,
    user.user_metadata.avatar_url,
    user.user_metadata.picture,
  ]) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (url.hostname === "googleusercontent.com" ||
          url.hostname.endsWith(".googleusercontent.com"))
      )
        return url.href;
    } catch {
      // Missing or invalid profile images use the name's initial instead.
    }
  }
  return null;
}
