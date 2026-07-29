import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurchaseAnalysis,
  type SheetMatrix,
} from "../lib/purchase-analysis.ts";

function sheet(name: string, rows: unknown[][]): SheetMatrix {
  return { name, fileName: "analisis-mensual.xlsx", rows };
}

test("conecta estimado, stock, pendiente y análisis sin duplicar códigos equivalentes", () => {
  const snapshot = buildPurchaseAnalysis([
    sheet("ESTIMADO", [
      ["CÓDIGO", "VARIEDAD", "PRESENTACIÓN", "Agosto", "Septiembre"],
      [],
      [null, null, null, null, null, null, null, "total cajas", "total botellas", "botella", "tapon", "tapa", "capsulas", "cajas"],
      ["2372-24", "DV CATENA CABERNET - MALBEC", 6, 50, 50, null, null, 100, 600, "10348", "20383", null, "30354", "72460-25"],
    ]),
    sheet("STOCK", [
      ["Codigo de producto", "Descripcion", "2", "C18", "TOTAL"],
      ["30354", "CAP DV CATENA MARRON", 120, 80, 200],
      ["30354A", "CAP DV MARRON ECO CAP", 90, 110, 200],
    ]),
    sheet("PENDIENTE", [
      ["Fecha OC", "Nro. OC", "Producto/C", "Descripcion Producto/C", "F.Entr.", "C.por D./E.", "Cant. OC."],
      ["01/08/26", "150001", "30354", "CAP DV CATENA MARRON", "15/08/26", -500, 1_000],
      ["02/08/26", "150002", "30354A", "CAP DV MARRON ECO CAP", "16/08/26", -600, 1_000],
    ]),
    sheet("ANALISIS", [
      ["Codigo", "Descripcion", "Stock", "Pendiente", "Necesidad", "A comprar"],
      ["30354A", "CAP DV MARRON ECO CAP", 200, 300, 600, -100],
    ]),
  ]);

  const item = snapshot.items.find(
    (candidate) => candidate.materialCode === "30354A",
  );
  assert.ok(item);
  assert.deepEqual(item.sourceCodes, ["30354", "30354A"]);
  assert.equal(item.stock, 400);
  assert.deepEqual(item.depots, { "2": 210, C18: 190 });
  assert.equal(item.calculatedNeed, 600);
  assert.equal(item.confirmedNeed, 600);
  assert.equal(item.pendingDetected, 1_100);
  assert.equal(item.pendingConfirmed, 300);
  assert.equal(item.shortageExact, 0);
  assert.equal(snapshot.summary.aliasesConsolidated, 1);
  assert.equal(snapshot.summary.materials, 4);
});

test("calcula la compra exacta y la redondea siempre hacia arriba", () => {
  const snapshot = buildPurchaseAnalysis(
    [
      sheet("ESTIMADO", [
        ["CÓDIGO", "VARIEDAD", "PRESENTACIÓN", "Agosto"],
        [],
        [null, null, null, null, null, null, null, "total cajas", "total botellas", "botella", "tapon", "tapa", "capsulas", "cajas"],
        ["330-24", "ALAMOS MALBEC", 6, 100, null, null, null, 100, 600, "10248", "20376", null, "30217", "72456D"],
      ]),
      sheet("STOCK", [
        ["Codigo de producto", "Descripcion", "2", "C18", "TOTAL"],
        ["20376", "TAPON ALAMOS", 100, 50, 150],
      ]),
      sheet("PENDIENTE", [
        ["Fecha OC", "Nro. OC", "Producto/C", "Descripcion Producto/C", "F.Entr.", "C.por D./E.", "Cant. OC."],
        ["01/08/26", "150003", "20376", "TAPON ALAMOS", "15/08/26", -125, 500],
      ]),
    ],
    { rounding: 100 },
  );

  const item = snapshot.items.find(
    (candidate) => candidate.materialCode === "20376",
  );
  assert.ok(item);
  assert.equal(item.confirmedNeed, 600);
  assert.equal(item.stock, 150);
  assert.equal(item.pendingConfirmed, 125);
  assert.equal(item.shortageExact, 325);
  assert.equal(item.purchaseRounded, 400);
});
