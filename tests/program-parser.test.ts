import assert from "node:assert/strict";
import test from "node:test";
import { parseProgramSheet, parseWeekIdentity } from "../lib/program-parser.ts";

function row(values: Record<number, string>) {
  const result: string[] = [];
  for (const [index, value] of Object.entries(values)) result[Number(index)] = value;
  return result;
}

const headers = row({
  0: "Fecha", 1: "PIN°", 2: "Código", 3: "Marca", 4: "Variedad", 5: "Cosecha",
  6: "Capacidad", 7: "Tapón/SC", 8: "Litros", 9: "Cliente", 10: "País destino",
  11: "Acción", 12: "Cajas", 13: "Cj x", 14: "Botellas", 15: "Observaciones",
  20: "BOTELLA", 21: "TAPON", 22: "CAPS/TAPA", 23: "CAJAS", 24: "ETQ", 25: "CEQ",
});

test("reconoce la semana actual aunque el año esté solo en el título", () => {
  const identity = parseWeekIdentity("Sem 13-07 al 17-07", "Programa de Producción - Sem del 13 de Julio al 17 de Julio 2026",new Date("2026-07-15T12:00:00Z"));
  assert.equal(identity?.weekId, "2026-07-13");
  assert.equal(identity?.weekLabel, "13–17 Jul");
  assert.equal(identity?.status, "actual");
});

test("descubre encabezados, acciones y materiales sin depender de filas fijas", () => {
  const parsed = parseProgramSheet({
    sheetId: 1,
    title: " Sem 20-07 al 24-07",
    values: [
      ["Programa de Producción - Sem del 20 de Julio al 24 de Julio 2026"],
      [],
      ["PROGRAMACION LINEA 1"],
      [],
      headers,
      [],
      row({ 0: "LUNES", 1: "E0001", 2: "305-25", 3: "ALAMOS", 4: "MALBEC", 5: "2025", 6: "0.750", 7: "Tapón", 8: "1.890", 9: "CLIENTE", 10: "ARGENTINA", 11: "FRACCIONAR", 12: "420", 13: "6", 14: "2.520", 20: "10248", 21: "20383", 22: "33134", 23: "72460", 24: "E854925A", 25: "C854925A" }),
      row({ 1: "STOCK", 2: "305-25-E", 3: "ALAMOS", 4: "MALBEC", 5: "2025", 11: "VESTIR", 14: "1,200", 20: "N/A", 21: "N/A", 22: "33134", 23: "72460", 24: "E854925A", 25: "C854925A" }),
    ],
  });
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].sourceRow, 7);
  assert.equal(parsed.records[0].materials.case, "72460");
  assert.equal(parsed.records[1].materials.bottle, "");
  assert.equal(parsed.records[1].bottles, 1200);
});

test("marca una fila productiva sin código para impedir una relación BOM incorrecta", () => {
  const parsed = parseProgramSheet({
    sheetId: 2,
    title: "TENTATIVO Sem 27-07 al 31-07",
    values: [
      ["Programa de Producción - Sem del 27 de Julio al 31 de Julio 2026"],
      ["PROGRAMACION LINEA 1"],
      headers,
      row({ 1: "STOCK", 3: "LA POSTA BLANCO", 4: "BLEND", 5: "2025", 11: "FRACCIONAR", 14: "6.000" }),
    ],
  });
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].productCode, "");
  assert.equal(parsed.diagnostics[0].code, "MISSING_PRODUCT_CODE");
  assert.equal(parsed.diagnostics[0].sourceRow, 4);
});
