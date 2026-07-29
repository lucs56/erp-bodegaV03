/**
 * Lee el estilo de texto tachado desde las estructuras internas de un XLSX.
 *
 * SheetJS conserva fuentes, estilos y XML cuando se abre el libro con
 * `bookFiles: true`. Esta función no modifica el archivo: solamente devuelve
 * qué filas fueron marcadas como realizadas en cada hoja.
 */
export function struckRowsBySheet(workbook: unknown) {
  const result = new Map<string, Set<number>>();
  const book = workbook as {
    Styles?: {
      Fonts?: Array<{ strike?: boolean }>;
      CellXf?: Array<{ fontId?: number | string; fontid?: number | string }>;
    };
    Workbook?: {
      Sheets?: Array<{ name?: string; id?: string }>;
    };
    files?: Record<string, { content?: unknown } | undefined>;
  };

  const fonts = book.Styles?.Fonts ?? [];
  const cellStyles = book.Styles?.CellXf ?? [];
  const struckStyleIds = new Set<number>();
  cellStyles.forEach((style, styleId) => {
    const fontId = Number(style.fontId ?? style.fontid ?? 0);
    if (fonts[fontId]?.strike) struckStyleIds.add(styleId);
  });
  if (struckStyleIds.size === 0) return result;

  const relationships = relationshipTargets(
    fileText(book.files?.["xl/_rels/workbook.xml.rels"]?.content),
  );

  for (const sheet of book.Workbook?.Sheets ?? []) {
    const title = String(sheet.name ?? "").trim();
    const target = relationships.get(String(sheet.id ?? ""));
    if (!title || !target) continue;

    const worksheetPath = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.?\//, "")}`;
    const xml = fileText(book.files?.[worksheetPath]?.content);
    if (!xml) continue;

    const struckRows = new Set<number>();
    const cellPattern = /<c\b([^>]*)>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(xml))) {
      const reference = attribute(cellMatch[1], "r");
      const styleId = Number(attribute(cellMatch[1], "s"));
      if (!reference || !struckStyleIds.has(styleId)) continue;
      const coordinate = reference.match(/^([A-Z]+)(\d+)$/i);
      if (!coordinate || columnNumber(coordinate[1]) > 16) continue;
      struckRows.add(Number(coordinate[2]));
    }
    if (struckRows.size) result.set(title, struckRows);
  }

  return result;
}

function relationshipTargets(xml: string) {
  const targets = new Map<string, string>();
  const pattern = /<Relationship\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    const id = attribute(match[1], "Id");
    const target = attribute(match[1], "Target");
    if (id && target) targets.set(id, target);
  }
  return targets;
}

function attribute(source: string, name: string) {
  const match = source.match(
    new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? "";
}

function columnNumber(column: string) {
  return column
    .toUpperCase()
    .split("")
    .reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}

function fileText(content: unknown) {
  if (typeof content === "string") return content;
  if (content instanceof ArrayBuffer)
    return new TextDecoder().decode(new Uint8Array(content));
  if (ArrayBuffer.isView(content))
    return new TextDecoder().decode(
      new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
    );
  return "";
}
