import type { APIRoute } from "astro";

// Hand-rolled rather than @astrojs/sitemap: only a handful of routes, and the
// private /plan pages must stay out of it.
const pages = [
  { path: "/", priority: "1.0" },
  { path: "/about", priority: "0.9" },
  { path: "/cv", priority: "0.8" },
  { path: "/pubs", priority: "0.6" },
  { path: "/flowsites", priority: "0.7" },
  { path: "/compensation", priority: "0.7" },
  { path: "/euchre", priority: "0.4" },
];

export const GET: APIRoute = ({ site }) => {
  const origin = (site ?? new URL("https://thisishowwesee.com")).origin;
  const urls = pages
    .map(
      (page) =>
        `  <url><loc>${origin}${page.path}</loc><priority>${page.priority}</priority></url>`
    )
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml" } }
  );
};
