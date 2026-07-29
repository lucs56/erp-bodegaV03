import assert from "node:assert/strict";
import test from "node:test";
import { struckRowsBySheet } from "../lib/xlsx-strikethrough.ts";

test("detecta una fila tachada usando los estilos internos del XLSX", () => {
  const workbook = {
    Styles: {
      Fonts: [{}, { strike: true }],
      CellXf: [{ fontId: 0 }, { fontId: 1 }],
    },
    Workbook: {
      Sheets: [{ name: "Sem 27-07 al 31-07", id: "rId1" }],
    },
    files: {
      "xl/_rels/workbook.xml.rels": {
        content: new TextEncoder().encode(
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
      },
      "xl/worksheets/sheet1.xml": {
        content: new TextEncoder().encode(
          '<worksheet><sheetData><row r="9"><c r="D9" s="1"><v>ALAMOS</v></c></row></sheetData></worksheet>',
        ),
      },
    },
  };
  assert.deepEqual(
    [...(struckRowsBySheet(workbook).get("Sem 27-07 al 31-07") ?? [])],
    [9],
  );
});
