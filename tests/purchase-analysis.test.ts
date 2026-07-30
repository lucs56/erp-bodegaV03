import test from "node:test";
import assert from "node:assert/strict";
import {
  PURCHASE_ANALYSIS_COLUMNS,
  calculatePurchase,
  canonicalMaterialCode,
  parsePurchaseWorkbook,
  purchaseAnalysisTableRows,
} from "../lib/purchase-analysis.ts";

test("conserva exactamente las ocho columnas operativas", () => {
  assert.deepEqual(PURCHASE_ANALYSIS_COLUMNS, [
    "INSUMO",
    "NECESIDAD CALCULADA",
    "NECESIDAD CONFIRMADA",
    "STOCK",
    "PENDIENTE DETECTADO",
    "PENDIENTE CONFIRMADO",
    "COMPRA EXACTA",
    "COMPRA REDONDEADA",
  ]);
});

test("la exportación usa las mismas ocho columnas y ningún dato auxiliar", () => {
  const rows = purchaseAnalysisTableRows([
    {
      materialCode: "20028",
      materialName: "Tapón / cierre",
      calculatedNeed: 4_205_337.064,
      confirmedNeed: 4_350_000,
      stock: 291_700,
      pendingDetected: 1_852_750,
      confirmedPending: 1_100_000,
      exactPurchase: 2_958_300,
      roundedPurchase: 2_959_000,
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.length, 8);
  assert.equal(rows[1]?.length, 8);
  assert.equal(rows[1]?.[0], "20028 - Tapón / cierre");
});

test("redondea la compra hacia arriba por millar", () => {
  assert.deepEqual(calculatePurchase(4_350_000, 291_700, 1_100_000), {
    exactPurchase: 2_958_300,
    roundedPurchase: 2_959_000,
  });
});

test("consolida 30354 y 30354A como un único insumo", () => {
  assert.equal(canonicalMaterialCode("30354"), "30354A");
  assert.equal(canonicalMaterialCode("30354A"), "30354A");
  assert.equal(canonicalMaterialCode("30354-30354A"), "30354A");
});

test("cruza necesidad, stock y pendiente sin duplicar el alias", () => {
  const result = parsePurchaseWorkbook([
    {
      name: "ESTIMADO",
      rows: [
        {
          "Código de insumo": "30354",
          "Nombre del insumo": "Cápsula",
          "Necesidad calculada": 2_353_474.2,
        },
      ],
    },
    {
      name: "STOCK",
      rows: [
        {
          Código: "30354A",
          Descripción: "Cápsula",
          Stock: 452_726,
        },
      ],
    },
    {
      name: "PENDIENTE",
      rows: [{ Insumo: "30354", Pendiente: 280_000 }],
    },
  ]);

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    materialCode: "30354A",
    materialName: "Cápsula",
    calculatedNeed: 2_353_474.2,
    confirmedNeed: 2_353_474.2,
    stock: 452_726,
    pendingDetected: 280_000,
    confirmedPending: 280_000,
    exactPurchase: 1_620_748.2,
    roundedPurchase: 1_621_000,
  });
});

test("conserva el desglose por depósito aunque exista stock total", () => {
  const result = parsePurchaseWorkbook([
    {
      name: "ESTIMADO",
      rows: [
        {
          Insumo: "20028",
          Descripción: "Tapón",
          Necesidad: 500_000,
        },
      ],
    },
    {
      name: "STOCK",
      rows: [
        {
          Insumo: "20028",
          Descripción: "Tapón",
          Stock: 291_700,
          "Depósito 2": 141_750,
          C18: 149_950,
        },
      ],
    },
  ]);

  assert.deepEqual(result.stockItems[0]?.depots, {
    "2": 141_750,
    C18: 149_950,
  });
  assert.equal(result.rows[0]?.stock, 291_700);
});

test("solo descuenta pendientes que llegan dentro del período analizado", () => {
  const result = parsePurchaseWorkbook([
    {
      name: "ESTIMADO SEPTIEMBRE-NOVIEMBRE 2026",
      rows: [
        {
          Insumo: "10348",
          Descripción: "Botella",
          Necesidad: 500_000,
        },
      ],
    },
    {
      name: "STOCK",
      rows: [{ Insumo: "10348", Descripción: "Botella", Stock: 100_000 }],
    },
    {
      name: "PENDIENTE",
      rows: [
        {
          Insumo: "10348",
          Descripción: "Botella",
          Pendiente: 200_000,
          "Fecha entrega": "15/10/2026",
        },
        {
          Insumo: "10348",
          Descripción: "Botella",
          Pendiente: 100_000,
          "Fecha entrega": "15/12/2026",
        },
      ],
    },
  ]);

  assert.equal(result.rows[0]?.pendingDetected, 300_000);
  assert.equal(result.rows[0]?.confirmedPending, 200_000);
  assert.equal(result.rows[0]?.exactPurchase, 200_000);
  assert.match(result.diagnostics.join(" "), /posteriores al período/);
});
