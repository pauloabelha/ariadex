"use strict";

function escapePdfText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text, maxChars) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [""];
  }

  const words = normalized.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
      continue;
    }
    lines.push(word.slice(0, maxChars));
    current = word.slice(maxChars);
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function articleToPlainText(article) {
  const lines = [];
  const title = String(article?.title || "Ariadex Digest").trim();
  const dek = String(article?.dek || "").trim();
  const summary = String(article?.summary || "").trim();
  const sections = Array.isArray(article?.sections) ? article.sections : [];
  const references = Array.isArray(article?.references) ? article.references : [];

  lines.push(title);
  if (dek) {
    lines.push("");
    lines.push(dek);
  }
  if (summary) {
    lines.push("");
    lines.push(summary);
  }

  for (const section of sections) {
    const heading = String(section?.heading || "").trim();
    const body = String(section?.body || "").trim();
    if (!heading && !body) {
      continue;
    }
    lines.push("");
    if (heading) {
      lines.push(heading.toUpperCase());
    }
    if (body) {
      lines.push(body);
    }
  }

  if (references.length > 0) {
    lines.push("");
    lines.push("REFERENCES");
    for (let i = 0; i < references.length; i += 1) {
      const ref = references[i] || {};
      const display = String(ref.displayUrl || ref.canonicalUrl || "").trim();
      if (!display) {
        continue;
      }
      lines.push(`${i + 1}. ${display}`);
    }
  }

  return lines.join("\n");
}

function createMinimalPdfBufferFromText(text, options = {}) {
  const title = String(options.title || "Ariadex Digest").trim() || "Ariadex Digest";
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 48;
  const marginTop = 52;
  const lineHeight = 16;
  const fontSize = 12;
  const maxChars = Math.max(40, Math.min(110, Math.floor(Number(options.maxCharsPerLine) || 84)));
  const rawLines = String(text || "").split("\n");
  const wrappedLines = [];

  for (const rawLine of rawLines) {
    if (!String(rawLine || "").trim()) {
      wrappedLines.push("");
      continue;
    }
    wrappedLines.push(...wrapLine(rawLine, maxChars));
  }

  const linesPerPage = Math.max(20, Math.floor((pageHeight - (marginTop * 2)) / lineHeight));
  const pages = [];
  for (let i = 0; i < wrappedLines.length; i += linesPerPage) {
    pages.push(wrappedLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) {
    pages.push([""]);
  }

  const objects = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = 2;
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const contentIds = [];
  const pageIds = [];

  for (const lines of pages) {
    const commands = ["BT", `/F1 ${fontSize} Tf`, `${marginLeft} ${pageHeight - marginTop} Td`];
    for (let i = 0; i < lines.length; i += 1) {
      const line = escapePdfText(lines[i]);
      if (i > 0) {
        commands.push(`0 -${lineHeight} Td`);
      }
      commands.push(`(${line}) Tj`);
    }
    commands.push("ET");
    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  const infoId = addObject(`<< /Title (${escapePdfText(title)}) /Producer (Ariadex) >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function createArticlePdfBuffer(article) {
  return createMinimalPdfBufferFromText(articleToPlainText(article), {
    title: article?.title || "Ariadex Digest"
  });
}

module.exports = {
  articleToPlainText,
  createArticlePdfBuffer,
  createMinimalPdfBufferFromText
};
