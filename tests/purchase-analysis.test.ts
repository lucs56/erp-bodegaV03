import test from "node:test";
import assert from "node:assert/strict";
import {
  PURCHASE_ANALYSIS_COLUMNS,
  PURCHASE_ANALYSIS_EXPORT_COLUMNS,
  calculatePurchase,
  canonicalMaterialCode,
  compatibleMaterialCodes,
  mergeSavedConfirmations,
  parsePurchaseWorkbook,
  purchaseAnalysisExportRows,
  purchaseRecordsFromMatrix,
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

test("la vista operativa conserva las ocho columnas de control", () => {
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
      roundedPurchase: 2_960_000,
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.length, 8);
  assert.equal(rows[1]?.length, 8);
  assert.equal(rows[1]?.[0], "20028 - Tapón / cierre");
});

test("el Excel usa las seis columnas del análisis manual y saldo negativo", () => {
  assert.deepEqual(PURCHASE_ANALYSIS_EXPORT_COLUMNS, [
    "Codigo",
    "Descripcion",
    "Stock",
    "Pendiente",
    "Necesidad",
    "A comprar",
  ]);
  const rows = purchaseAnalysisExportRows([
    {
      materialCode: "20028",
      materialName: "COR CW1/D3 44 X 24 MZA-ARG",
      calculatedNeed: 4_205_337.064,
      confirmedNeed: 4_350_000,
      stock: 291_700,
      pendingDetected: 1_800_600,
      confirmedPending: 1_100_000,
      exactPurchase: 2_958_300,
      roundedPurchase: 2_960_000,
    },
  ]);

  assert.deepEqual(rows[0], [...PURCHASE_ANALYSIS_EXPORT_COLUMNS]);
  assert.deepEqual(rows[1], [
    "20028",
    "COR CW1/D3 44 X 24 MZA-ARG",
    291_700,
    1_100_000,
    4_350_000,
    -2_958_300,
  ]);
});

test("redondea la compra hacia arriba cada 10.000 unidades", () => {
  assert.deepEqual(calculatePurchase(4_350_000, 291_700, 1_100_000), {
    exactPurchase: 2_958_300,
    roundedPurchase: 2_960_000,
  });
});

test("conserva los códigos individuales pero los reconoce como compatibles", () => {
  assert.equal(canonicalMaterialCode("30354"), "30354");
  assert.equal(canonicalMaterialCode("30354A"), "30354A");
  assert.notEqual(canonicalMaterialCode("30354"), canonicalMaterialCode("30354A"));
  assert.deepEqual(compatibleMaterialCodes("30354"), ["30354", "30354A"]);
  assert.deepEqual(compatibleMaterialCodes("71684D"), ["71684C", "71684D"]);
});

test("comparte stock y pendiente entre 30354 y 30354A sin duplicar necesidad", () => {
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
          Código: "30354",
          Descripción: "Cápsula original",
          "Depósito 2": 127_956,
          C18: 86_625,
          TOTAL: 999_999,
        },
        {
          Código: "30354A",
          Descripción: "Cápsula alternativa",
          "Depósito 2": 95_025,
          C18: 143_120,
          TOTAL: 999_999,
        },
      ],
    },
    {
      name: "PENDIENTE",
      rows: [
        { Insumo: "30354", Pendiente: 100_000 },
        { Insumo: "30354A", Pendiente: 180_000 },
      ],
    },
  ]);

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    materialCode: "30354 / 30354A",
    compatibleCodes: ["30354", "30354A"],
    materialName: "Cápsula original",
    calculatedNeed: 2_353_474.2,
    confirmedNeed: 2_353_474.2,
    stock: 452_726,
    pendingDetected: 280_000,
    confirmedPending: 280_000,
    exactPurchase: 1_620_748.2,
    roundedPurchase: 1_630_000,
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
          "Depósito 13": 999_999,
          TOTAL: 1_291_699,
        },
      ],
    },
  ]);

  assert.deepEqual(result.stockItems[0]?.depots, {
    "2": 141_750,
    C18: 149_950,
    "13": 999_999,
  });
  assert.equal(result.rows[0]?.stock, 291_700);
});

test("conserva el pendiente confirmado manual al volver a cargar el Excel", () => {
  const imported = parsePurchaseWorkbook([
    {
      name: "ESTIMADO",
      rows: [{ Insumo: "30354", Descripción: "Cápsula", Necesidad: 2_353_474.2 }],
    },
    {
      name: "STOCK",
      rows: [
        { Insumo: "30354", Descripción: "Cápsula", "2": 127_956, C18: 86_625 },
        { Insumo: "30354A", Descripción: "Cápsula", "2": 95_025, C18: 143_120 },
      ],
    },
    {
      name: "PENDIENTE",
      rows: [{ Insumo: "30354", Pendiente: 581_977 }],
    },
  ]).rows;
  const saved = [
    {
      ...imported[0]!,
      confirmedPending: 280_000,
      exactPurchase: 0,
      roundedPurchase: 0,
    },
  ];

  const merged = mergeSavedConfirmations(imported, saved);
  assert.equal(merged[0]?.pendingDetected, 581_977);
  assert.equal(merged[0]?.confirmedPending, 280_000);
  assert.equal(merged[0]?.stock, 452_726);
  assert.equal(merged[0]?.exactPurchase, 1_620_748.2);
});

test("comparte las cajas 71684C y 71684D", () => {
  const result = parsePurchaseWorkbook([
    {
      name: "ESTIMADO",
      rows: [{ Insumo: "71684C", Descripción: "Caja Alamos", Necesidad: 29_547 }],
    },
    {
      name: "STOCK",
      rows: [
        { Insumo: "71684C", Descripción: "Caja Alamos", "2": 900, C18: 0 },
        { Insumo: "71684D", Descripción: "Caja Alamos DN", "2": 13_590, C18: 0 },
      ],
    },
    { name: "PENDIENTE", rows: [] },
  ]);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.materialCode, "71684C / 71684D");
  assert.equal(result.rows[0]?.stock, 14_490);
  assert.equal(result.rows[0]?.calculatedNeed, 29_547);
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

test("reconoce los encabezados reales de ESTIMADO, STOCK y PENDIENTE", () => {
  const estimatedRows = purchaseRecordsFromMatrix([
    ["canal", "TOTAL BODEGA", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["CÓDIGO", "VARIEDAD", "PRESENTACIÓN", "Ago-26", "Sep-26", "Oct-26", "Nov-26"],
    [],
    ["", "", "", "", "", "", "", "total cajas", "total botellas", "botella", "tapon", "tapa", "capsulas", "cajas"],
    ["330-24", "ALAMOS MALBEC", 6, 10, 20, 30, 40, 100, 600, "10248", "20376", "", "30217", "72456D"],
  ]);
  const stockRows = purchaseRecordsFromMatrix([
    ["Código de producto", "Descripción", "2", "C18", "TOTAL"],
    ["10248", "BOT CON BAJ SERRANA", 100, 50, 150],
    ["20376", "TAP MICRO PREM", 80, 20, 100],
    ["30217", "CAP COMPLEX DORADA", 40, 10, 50],
    ["72456D", "CAJA ALAMOS", 5, 0, 5],
  ]);
  const pendingRows = purchaseRecordsFromMatrix([
    ["Fecha OC", "Producto/C", "Descripcion Producto/C", "F.Entr.", "C.por D./E.", "", "", ""],
    ["01/08/2026", "20376", "TAP MICRO PREM", "15/08/2026", 25, "", "Etiquetas de fila", "Suma de C.por D./E."],
    ["02/08/2026", "20376", "TAP MICRO PREM", "20/08/2026", -10, "", "20376", 15],
  ]);

  const result = parsePurchaseWorkbook([
    { name: "ESTIMADO.xlsx · Hoja1", rows: estimatedRows },
    { name: "STOCK.xlsx · Hoja1", rows: stockRows },
    { name: "PENDIENTE.xlsx · Hoja1", rows: pendingRows },
  ]);

  assert.deepEqual(result.detectedSources, {
    estimate: true,
    stock: true,
    pending: true,
  });
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows.find((row) => row.materialCode === "10248")?.calculatedNeed, 600);
  assert.equal(result.rows.find((row) => row.materialCode === "72456D")?.calculatedNeed, 100);
  assert.equal(result.rows.find((row) => row.materialCode === "20376")?.pendingDetected, 25);
});

test("suma pendientes positivos de C.por D./E. y descarta negativos", () => {
  const result = parsePurchaseWorkbook([
    {
      name: "ESTIMADO",
      rows: [{ Insumo: "10248", Descripción: "Botella", Necesidad: 1_000 }],
    },
    {
      name: "STOCK",
      rows: [{ Insumo: "10248", Descripción: "Botella", Stock: 100 }],
    },
    {
      name: "PENDIENTE",
      rows: [
        { "Producto/C": "10248", "C.por D./E.": 250 },
        { "Producto/C": "10248", "C.por D./E.": -75 },
        { "Producto/C": "10248", "C.por D./E.": 50 },
      ],
    },
  ]);

  assert.equal(result.rows[0]?.pendingDetected, 300);
  assert.equal(result.rows[0]?.confirmedPending, 300);
  assert.equal(result.rows[0]?.exactPurchase, 600);
});

test("ignora la hoja Análisis y exige las tres fuentes operativas", () => {
  const result = parsePurchaseWorkbook([
    {
      name: "Análisis · analisis-compras-agosto-noviembre-2026.xlsx",
      rows: [
        {
          Código: "10248",
          Descripción: "BOT CON BAJ SERRANA 750 VO 400",
          Stock: 290_276,
          Pendiente: 234_246,
          Necesidad: 1_140_566.6556933399,
        },
      ],
    },
    {
      name: "ESTIMADO · analisis-compras-agosto-noviembre-2026.xlsx",
      rows: [
        {
          Código: "330-24",
          Producto: "ALAMOS MALBEC",
          Presentación: 6,
          "Total cajas": 130_294.48238688245,
          "Total botellas": 781_766.8943212947,
          Botella: "10248",
        },
      ],
    },
  ]);

  assert.deepEqual(result.detectedSources, {
    estimate: true,
    stock: false,
    pending: false,
  });
  const bottle = result.rows.find((row) => row.materialCode === "10248");
  assert.ok(bottle);
  assert.equal(bottle.stock, 0);
  assert.equal(bottle.pendingDetected, 0);
  assert.equal(bottle.calculatedNeed, 781_766.8943212947);
  assert.equal(bottle.roundedPurchase, 790_000);
  assert.match(result.diagnostics.join(" "), /Se ignoró la hoja calculada/);
  assert.match(result.diagnostics.join(" "), /No se encontró stock/);
  assert.match(result.diagnostics.join(" "), /No se encontró un archivo PENDIENTE/);
});

test("usa ESTIMADO, STOCK y PENDIENTE aunque exista una hoja Análisis conflictiva", () => {
  const result = parsePurchaseWorkbook([
    {
      name: "Análisis · compra.xlsx",
      rows: [
        {
          Código: "10248",
          Descripción: "VALORES QUE NO DEBEN USARSE",
          Stock: 999_999,
          Pendiente: 999_999,
          Necesidad: 1,
        },
      ],
    },
    {
      name: "ESTIMADO · compra.xlsx",
      rows: [
        {
          Código: "330-24",
          Producto: "ALAMOS MALBEC",
          Presentación: 6,
          "Total cajas": 100,
          "Total botellas": 600,
          Botella: "10248",
          Cajas: "72456D",
        },
      ],
    },
    {
      name: "STOCK · compra.xlsx",
      rows: [
        {
          "Código de producto": "10248",
          Descripción: "BOTELLA CORRECTA",
          "2": 100,
          C18: 50,
          TOTAL: 150,
        },
      ],
    },
    {
      name: "PENDIENTE · compra.xlsx",
      rows: [
        {
          "Producto/C": "10248",
          "Descripcion Producto/C": "BOTELLA CORRECTA",
          "C.por D./E.": 200,
        },
      ],
    },
  ]);

  assert.deepEqual(result.detectedSources, {
    estimate: true,
    stock: true,
    pending: true,
  });
  const bottle = result.rows.find((row) => row.materialCode === "10248");
  assert.deepEqual(bottle, {
    materialCode: "10248",
    materialName: "BOTELLA CORRECTA",
    calculatedNeed: 600,
    confirmedNeed: 600,
    stock: 150,
    pendingDetected: 200,
    confirmedPending: 200,
    exactPurchase: 250,
    roundedPurchase: 10_000,
  });
});

test("restaura necesidad y pendiente confirmados antes de exportar", () => {
  const imported = parsePurchaseWorkbook([
    {
      name: "ESTIMADO · estimado.xlsx",
      rows: [{ Insumo: "20028", Descripción: "CORCHO", Necesidad: 4_205_337.064 }],
    },
    {
      name: "STOCK · stock.xlsx",
      rows: [{ Insumo: "20028", Descripción: "CORCHO", "2": 200_000, C18: 91_700 }],
    },
    {
      name: "PENDIENTE · pendiente.xlsx",
      rows: [{ Insumo: "20028", Pendiente: 52_150 }],
    },
  ]).rows;

  const saved = [
    {
      ...imported[0]!,
      confirmedNeed: 4_350_000,
      confirmedPending: 1_100_000,
      exactPurchase: 0,
      roundedPurchase: 0,
    },
  ];

  const merged = mergeSavedConfirmations(imported, saved);
  assert.equal(merged[0]?.calculatedNeed, 4_205_337.064);
  assert.equal(merged[0]?.pendingDetected, 52_150);
  assert.equal(merged[0]?.confirmedNeed, 4_350_000);
  assert.equal(merged[0]?.confirmedPending, 1_100_000);
  assert.equal(merged[0]?.exactPurchase, 2_958_300);
  assert.deepEqual(purchaseAnalysisExportRows(merged)[1], [
    "20028",
    "CORCHO",
    291_700,
    1_100_000,
    4_350_000,
    -2_958_300,
  ]);
});

test("tres archivos separados y un libro de tres hojas calculan lo mismo", () => {
  const estimateRows = [{ Insumo: "10248", Descripción: "BOTELLA", Necesidad: 1_140_566.6556933399 }];
  const stockRows = [{ Insumo: "10248", Descripción: "BOTELLA", "2": 250_000, C18: 40_276 }];
  const pendingRows = [{ Insumo: "10248", Pendiente: 234_246 }];

  const separate = parsePurchaseWorkbook([
    { name: "Hoja1 · ESTIMADO.xlsx", rows: estimateRows },
    { name: "Hoja1 · STOCK.xlsx", rows: stockRows },
    { name: "Hoja1 · PENDIENTE.xlsx", rows: pendingRows },
  ]);
  const consolidated = parsePurchaseWorkbook([
    { name: "ESTIMADO · compras.xlsx", rows: estimateRows },
    { name: "STOCK · compras.xlsx", rows: stockRows },
    { name: "PENDIENTE · compras.xlsx", rows: pendingRows },
  ]);

  assert.deepEqual(separate.detectedSources, consolidated.detectedSources);
  assert.deepEqual(separate.rows, consolidated.rows);
});
