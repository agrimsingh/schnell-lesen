import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

type ChapterSection = {
  title: string;
  text: string;
};

type TocEntry = {
  href: string;
  title: string;
};

const toArray = <T,>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const getDir = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
};

const resolvePath = (baseDir: string, relative: string) => {
  if (!relative) return baseDir;
  if (/^[a-z]+:\/\//i.test(relative)) return relative;
  if (relative.startsWith("/")) return relative.replace(/^\/+/, "");

  const baseParts = baseDir.split("/").filter(Boolean);
  const relParts = relative.split("/").filter(Boolean);
  const output = [...baseParts];

  relParts.forEach((part) => {
    if (part === "." || part === "") return;
    if (part === "..") {
      output.pop();
      return;
    }
    output.push(part);
  });

  return output.join("/");
};

const normalizeHref = (href: string) => href.split("#")[0];

const parseNavHtml = (html: string, baseDir: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const nav =
    doc.querySelector("nav[epub\\:type='toc']") ||
    doc.querySelector("nav[role='doc-toc']") ||
    doc.querySelector("nav");
  if (!nav) return [] as TocEntry[];

  const links = Array.from(nav.querySelectorAll("a[href]"));
  return links
    .map((link) => {
      const href = link.getAttribute("href") || "";
      const title = link.textContent?.trim() || "Untitled";
      return {
        href: resolvePath(baseDir, normalizeHref(href)),
        title,
      };
    })
    .filter((entry) => entry.href);
};

const parseNcx = (xml: string, baseDir: string) => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
  });
  const toc = parser.parse(xml);
  const navMap = toc?.ncx?.navMap?.navPoint ?? [];

  const entries: TocEntry[] = [];
  const readText = (value: unknown): string => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return readText(value[0]);
    if (typeof value === "object") {
      if ("text" in value) return readText((value as { text?: unknown }).text);
      if ("#text" in value) {
        return readText((value as { "#text"?: unknown })["#text"]);
      }
    }
    return "";
  };

  const readSrc = (value: unknown): string => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return readSrc(value[0]);
    if (typeof value === "object") {
      if ("src" in value) return readSrc((value as { src?: unknown }).src);
      if ("@_src" in value) {
        return readSrc((value as { "@_src"?: unknown })["@_src"]);
      }
    }
    return "";
  };

  const walk = (points: unknown) => {
    toArray(points as { navLabel?: unknown; content?: unknown; navPoint?: unknown }).forEach(
      (point) => {
        const content = (point as { content?: unknown })?.content;
        const src = readSrc(content);
        const navLabel = (point as { navLabel?: unknown })?.navLabel;
        const title = readText(navLabel) || "Untitled";
        if (src) {
          entries.push({
            href: resolvePath(baseDir, normalizeHref(src)),
            title,
          });
        }
        if ((point as { navPoint?: unknown }).navPoint) {
          walk((point as { navPoint?: unknown }).navPoint);
        }
      }
    );
  };

  walk(navMap);
  return entries;
};

export const parseEpubSections = async (
  arrayBuffer: ArrayBuffer
): Promise<ChapterSection[]> => {
  const zip = unzipSync(new Uint8Array(arrayBuffer));
  const zipEntries = Object.keys(zip);
  const lowerMap = new Map(zipEntries.map((entry) => [entry.toLowerCase(), entry]));

  const readText = (path: string) => {
    const key = zip[path] ? path : lowerMap.get(path.toLowerCase());
    if (!key) {
      throw new Error(`Missing file in epub: ${path}`);
    }
    return strFromU8(zip[key]);
  };

  const containerXml = readText("META-INF/container.xml");
  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
  });
  const container = xmlParser.parse(containerXml);
  const rootfile = toArray(container?.container?.rootfiles?.rootfile)[0];
  const opfPath = rootfile?.["full-path"] || rootfile?.["fullPath"];

  if (!opfPath) {
    throw new Error("OPF path not found in container.xml");
  }

  const opfXml = readText(opfPath);
  const opf = xmlParser.parse(opfXml);
  const opfPackage = opf?.package;
  const manifestItems = toArray(opfPackage?.manifest?.item) as Array<{
    id?: string;
    href?: string;
    properties?: string;
    mediaType?: string;
  }>;
  const spineItems = toArray(opfPackage?.spine?.itemref) as Array<{
    idref?: string;
  }>;

  const manifestMap = new Map(
    manifestItems
      .filter((item) => item.id && item.href)
      .map((item) => [item.id as string, item])
  );

  const opfBaseDir = getDir(opfPath);
  const tocEntries: TocEntry[] = [];

  const navItem = manifestItems.find((item) =>
    (item.properties || "").split(" ").includes("nav")
  );

  if (navItem?.href) {
    const navPath = resolvePath(opfBaseDir, navItem.href);
    const navHtml = readText(navPath);
    tocEntries.push(...parseNavHtml(navHtml, getDir(navPath)));
  } else if (opfPackage?.spine?.toc) {
    const tocId = opfPackage.spine.toc as string;
    const tocItem = manifestMap.get(tocId);
    if (tocItem?.href) {
      const ncxPath = resolvePath(opfBaseDir, tocItem.href);
      const ncxXml = readText(ncxPath);
      tocEntries.push(...parseNcx(ncxXml, getDir(ncxPath)));
    }
  }

  const tocMap = new Map(
    tocEntries.map((entry) => [normalizeHref(entry.href), entry.title])
  );

  const sections: ChapterSection[] = [];
  spineItems.forEach((item, index) => {
    if (!item.idref) return;
    const manifest = manifestMap.get(item.idref);
    if (!manifest?.href) return;

    const filePath = resolvePath(opfBaseDir, manifest.href);
    const html = readText(filePath);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = doc.body?.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!text) return;

    const title = tocMap.get(normalizeHref(filePath)) || `Section ${index + 1}`;
    sections.push({ title, text });
  });

  return sections;
};
