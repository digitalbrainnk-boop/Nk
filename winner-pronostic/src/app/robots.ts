import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/compte", "/auth/", "/verification", "/nouveau-mot-de-passe"] },
  };
}
