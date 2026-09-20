#!/usr/bin/env node
/**
 * Micro static blog generator for the Backbone marketing site.
 *
 * Reads Markdown + YAML front matter from content/blog/*.md and writes fully
 * rendered, deterministic static output under public/blog/:
 *   - public/blog/index.html            (article card list)
 *   - public/blog/<slug>/index.html     (one per article, header/footer inlined)
 *   - public/blog/feed.xml              (RSS 2.0 incl. content:encoded)
 *   - public/blog/index.json            (machine-readable index)
 * It also rewrites public/sitemap.xml in full (single source of truth).
 *
 * No framework, no runtime shell injection for blog pages: header/footer markup
 * is baked in at build time so blog HTML is fully crawlable at rest.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const publicRoot = path.join(root, "public");
const contentDir = path.join(root, "content", "blog");
const blogOutDir = path.join(publicRoot, "blog");

const SITE = "https://backbonehq.io";
const BLOG_TITLE = "Backbone Engineering";
const BLOG_DESC =
  "Opinionated engineering notes on building production SaaS platforms - from runtime architecture and platform engineering to the realities of running software at scale.";
const DEFAULT_OG = `${SITE}/assets/images/og.png`;
const AUTHOR = "Andrew Eells";

// External article links open in a new tab; relative/on-site links stay in-place.
marked.use({
  hooks: {
    postprocess(html) {
      return html.replace(
        /<a href="((?:https?:)?\/\/[^"]+)"/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer"',
      );
    },
  },
});

// Authoritative list of non-blog routes on this host only. Docs live on
// docs.backbonehq.io (separate GSC property + ReadMe sitemap) — never list them here.
const STATIC_ROUTES = [
  { loc: `${SITE}/`, lastmod: "2026-05-25" },
  { loc: `${SITE}/faq/`, lastmod: "2026-05-25" },
  { loc: `${SITE}/privacy/`, lastmod: "2026-05-25" },
  { loc: `${SITE}/terms/`, lastmod: "2026-05-25" },
  { loc: `${SITE}/licence/`, lastmod: "2026-05-25" },
  { loc: `${SITE}/compare/`, lastmod: "2026-08-07" },
  { loc: `${SITE}/compare/diy/`, lastmod: "2026-08-07" },
  { loc: `${SITE}/compare/duplocloud/`, lastmod: "2026-08-07" },
  { loc: `${SITE}/compare/coherence/`, lastmod: "2026-08-07" },
  { loc: `${SITE}/compare/encore/`, lastmod: "2026-08-07" },
];

// --- URL helpers (single source of truth for trailing-slash convention) ---
const toBlogUrl = (slug) => `/blog/${slug}/`;
const toBlogAbsUrl = (slug) => `${SITE}/blog/${slug}/`;

// --- escaping helpers ---
const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, "&quot;");
const escapeXml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// --- date helpers ---
function toISODate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function displayDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
function rfc822(iso) {
  return new Date(`${iso}T00:00:00Z`).toUTCString();
}

// --- read shared header/footer partials and bake them in ---
function readPartial(name) {
  return fs.readFileSync(path.join(publicRoot, "partials", `${name}.html`), "utf8").trim();
}
const headerPartial = readPartial("header");
const footerPartial = readPartial("footer");
const pagePulsePartial = readPartial("page-pulse");

// Mark the /blog/ nav links as active in the inlined header.
function headerWithActiveBlog() {
  return headerPartial.replace(/(<a class=")([^"]*)(" href="\/blog\/")/g, "$1$2 text-white$3");
}

// --- load + parse articles ---
function loadArticles() {
  if (!fs.existsSync(contentDir)) return [];
  const files = fs.readdirSync(contentDir).filter((f) => f.endsWith(".md"));
  const articles = files.map((file) => {
    const raw = fs.readFileSync(path.join(contentDir, file), "utf8");
    const { data, content } = matter(raw);
    const slug = data.slug || file.replace(/\.md$/, "");
    const rawTitle = String(data.title || slug);
    const title = rawTitle.replace(/\s*\n\s*/g, " ").trim();
    const titleHtml = escapeHtml(rawTitle).replace(/\n/g, "<br>");
    const published = toISODate(data.published);
    const updated = data.updated ? toISODate(data.updated) : published;
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.round(words / 200));
    const tags = Array.isArray(data.tags) ? data.tags : [];
    return {
      slug,
      title,
      titleHtml,
      summary: String(data.summary || ""),
      description: String(data.description || data.summary || ""),
      published,
      updated,
      tags,
      readingTime,
      html: marked.parse(content),
      url: toBlogUrl(slug),
      absUrl: toBlogAbsUrl(slug),
    };
  });
  articles.sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
  return articles;
}

// --- related articles: shared-tag count, newest first as tiebreaker ---
function relatedFor(article, all) {
  const others = all.filter((a) => a.slug !== article.slug);
  const scored = others
    .map((a) => ({
      a,
      score: a.tags.filter((t) => article.tags.includes(t)).length,
    }))
    .sort((x, y) => y.score - x.score || (x.a.published < y.a.published ? 1 : -1));
  const withTags = scored.filter((s) => s.score > 0).map((s) => s.a);
  if (withTags.length >= 3) return withTags.slice(0, 3);
  // Fall back to most recent others to always fill up to 3 where possible.
  const filler = others.filter((a) => !withTags.includes(a)).slice(0, 3 - withTags.length);
  return [...withTags, ...filler].slice(0, 3);
}

// --- shared page chrome ---
function pageHead({ title, description, canonical, extraHead = "", jsonLd = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link href="${canonical}" rel="canonical" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:image" content="${DEFAULT_OG}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(title)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${DEFAULT_OG}" />
    <link rel="alternate" type="application/rss+xml" title="${escapeAttr(BLOG_TITLE)}" href="/blog/feed.xml" />
    <link rel="stylesheet" href="/assets/css/main.css" media="all" />
    <link rel="stylesheet" href="/assets/css/blog.css" media="all" />
    <link rel="stylesheet" href="/assets/css/vendor/glightbox.min.css" media="all" />
${jsonLd}    <script type="module" src="/assets/js/layout-shell.js"></script>
  </head>
  <body class="helvetica bg-[#0B0C14] text-neutral-200">
    <div class="main overflow-x-hidden has-top-glow">
      ${headerWithActiveBlog()}`;
}

const pageFoot = () => `      ${footerPartial}
    </div>
${pagePulsePartial}
    <script src="/assets/js/vendor/glightbox.min.js" defer></script>
    <script src="/assets/js/blog-lightbox.js" defer></script>
  </body>
</html>
`;

function jsonLdBlock(obj) {
  return `    <script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n    </script>\n`;
}

// --- article page ---
function renderArticle(article, all) {
  const related = relatedFor(article, all);
  const jsonLd = jsonLdBlock({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: article.title,
    description: article.description,
    datePublished: article.published,
    dateModified: article.updated,
    articleSection: BLOG_TITLE,
    keywords: article.tags.join(", "),
    url: article.absUrl,
    mainEntityOfPage: article.absUrl,
    image: DEFAULT_OG,
    author: { "@type": "Person", name: AUTHOR },
    publisher: {
      "@type": "Organization",
      name: "Backbone",
      url: `${SITE}/`,
      logo: { "@type": "ImageObject", url: DEFAULT_OG },
    },
  });

  const tagsHtml = article.tags.length
    ? `<ul class="blog-tags" aria-label="Tags">${article.tags
        .map((t) => `<li>${escapeHtml(t)}</li>`)
        .join("")}</ul>`
    : "";

  const relatedHtml = related.length
    ? `
        <section class="blog-related" aria-labelledby="related-heading">
          <h2 id="related-heading">Related articles</h2>
          <ul>
${related
  .map(
    (r) =>
      `            <li><a href="${r.url}">${escapeHtml(r.title)}</a><span class="blog-related-meta">${displayDate(
        r.published,
      )} · ${r.readingTime} min read</span></li>`,
  )
  .join("\n")}
          </ul>
        </section>`
    : "";

  const cta = `
        <section class="blog-cta">
          <div class="prose-cta-box rounded-xl border border-[#939DB8]/10 bg-[#0F101A]">
            <h2 class="text-white font-semibold text-[18px] md:text-[20px]">Building production software at scale?</h2>
            <p class="mt-3 text-neutral-300 leading-[165%]">
              Backbone is an opinionated runtime foundation for modern SaaS systems - designed to handle deployment,
              observability, security, and cloud-native operations as a coherent whole.
            </p>
            <p class="mt-2 text-neutral-300 leading-[165%]">
              So your team can focus on business value rather than undifferentiated effort.
            </p>
            <div class="mt-6 flex flex-wrap gap-3">
              <a class="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium text-white border border-[#939DB8]/20 bg-[#727DA1]/10 hover:bg-[#727DA1]/20 transition-colors" href="/">Explore Backbone</a>
              <a class="inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-medium text-white border border-[#939DB8]/20 bg-[#727DA1]/10 hover:bg-[#727DA1]/20 transition-colors" href="/faq/">Read the FAQ</a>
            </div>
          </div>
        </section>`;

  const body = `
      <main class="page-rail pt-32 pb-24">
        <article class="blog-article">
          <a class="blog-back" href="/blog/">&larr; All articles</a>
          <h1>${article.titleHtml}</h1>
          <div class="blog-byline">
            By ${escapeHtml(AUTHOR)} &middot;
            <time datetime="${article.published}">${displayDate(article.published)}</time> &middot;
            ${article.readingTime} min read
          </div>
          ${tagsHtml}
          <hr class="blog-rule" aria-hidden="true" />
          <div class="blog-prose">
${article.html}
          </div>
        </article>
${relatedHtml}
${cta}
      </main>
`;

  return (
    pageHead({
      title: `${article.title} | Backbone`,
      description: article.description,
      canonical: article.absUrl,
      jsonLd,
    }) +
    body +
    pageFoot()
  );
}

// --- index page ---
function renderIndex(all) {
  const jsonLd = jsonLdBlock({
    "@context": "https://schema.org",
    "@type": "Blog",
    name: BLOG_TITLE,
    description: BLOG_DESC,
    url: `${SITE}/blog/`,
    blogPost: all.map((a) => ({
      "@type": "BlogPosting",
      headline: a.title,
      description: a.summary,
      url: a.absUrl,
      datePublished: a.published,
      dateModified: a.updated,
      author: { "@type": "Person", name: AUTHOR },
    })),
  });

  const cards = all
    .map(
      (a) => `          <li class="blog-card">
            <a class="blog-card-title" href="${a.url}"><h2>${escapeHtml(a.title)}</h2></a>
            <div class="blog-card-meta"><time datetime="${a.published}">${displayDate(
              a.published,
            )}</time> &middot; ${a.readingTime} min read</div>
            <p class="blog-card-summary">${escapeHtml(a.summary)}</p>
            <a class="blog-card-more" href="${a.url}">Read article &rarr;</a>
          </li>`,
    )
    .join("\n");

  const body = `
      <main class="page-rail pt-32 pb-24">
        <header class="max-w-[820px]" style="text-wrap: pretty">
          <h1 class="font-helveticaDisplay text-white font-bold text-[40px] leading-[110%]">${escapeHtml(
            BLOG_TITLE,
          )}</h1>
          <p class="mt-4 text-neutral-200 text-lg leading-[145%]">${escapeHtml(BLOG_DESC)}</p>
        </header>
        <hr class="page-rail-separator separator-margin-y-compact border-0 border-t border-image-t border-separator-gradient" aria-hidden="true" />
        <ul class="blog-card-list">
${cards}
        </ul>
      </main>
`;

  return (
    pageHead({
      title: `${BLOG_TITLE} | Backbone`,
      description: BLOG_DESC,
      canonical: `${SITE}/blog/`,
      jsonLd,
    }) +
    body +
    pageFoot()
  );
}

// --- RSS feed ---
function renderFeed(all) {
  const lastBuild = all.length ? rfc822(all[0].updated) : new Date().toUTCString();
  const items = all
    .map(
      (a) => `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${a.absUrl}</link>
      <guid isPermaLink="true">${a.absUrl}</guid>
      <pubDate>${rfc822(a.published)}</pubDate>
      <description>${escapeXml(a.summary)}</description>
      <content:encoded><![CDATA[${a.html}]]></content:encoded>
${a.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join("\n")}
    </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(BLOG_TITLE)}</title>
    <link>${SITE}/blog/</link>
    <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(BLOG_DESC)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

// --- index.json ---
function renderIndexJson(all) {
  return `${JSON.stringify(
    all.map((a) => ({
      title: a.title,
      slug: a.slug,
      url: a.url,
      summary: a.summary,
      published: a.published,
      updated: a.updated,
      tags: a.tags,
      readingTime: a.readingTime,
    })),
    null,
    2,
  )}\n`;
}

// --- sitemap (full deterministic rewrite) ---
function renderSitemap(all) {
  const blogIndexLastmod = all.length ? all[0].updated : toISODate(new Date());
  const entries = [
    ...STATIC_ROUTES,
    { loc: `${SITE}/blog/`, lastmod: blogIndexLastmod },
    ...all.map((a) => ({ loc: a.absUrl, lastmod: a.updated })),
  ];
  const urls = entries
    .map((e) => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

// --- write everything ---
function main() {
  const all = loadArticles();
  if (all.length === 0) {
    console.warn("build-blog: no articles found in content/blog/*.md");
  }

  fs.mkdirSync(blogOutDir, { recursive: true });

  for (const article of all) {
    const dir = path.join(blogOutDir, article.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), renderArticle(article, all), "utf8");
  }

  fs.writeFileSync(path.join(blogOutDir, "index.html"), renderIndex(all), "utf8");
  fs.writeFileSync(path.join(blogOutDir, "feed.xml"), renderFeed(all), "utf8");
  fs.writeFileSync(path.join(blogOutDir, "index.json"), renderIndexJson(all), "utf8");
  fs.writeFileSync(path.join(publicRoot, "sitemap.xml"), renderSitemap(all), "utf8");

  console.log(
    `build-blog: ${all.length} article(s) → public/blog/{index.html, <slug>/index.html, feed.xml, index.json} + sitemap.xml`,
  );
  for (const a of all) console.log(`  - ${a.url} (${a.readingTime} min)`);
}

main();
