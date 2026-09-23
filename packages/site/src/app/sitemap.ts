import type { MetadataRoute } from "next";
import { SITE } from "@/lib/config";

const routes: Array<{ path: string; priority: number; changeFrequency: "weekly" | "monthly" | "yearly" }> = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/download", priority: 0.9, changeFrequency: "weekly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
  { path: "/security", priority: 0.8, changeFrequency: "monthly" },
  { path: "/why-kant", priority: 0.7, changeFrequency: "monthly" },
  { path: "/community", priority: 0.6, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE.url}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}
