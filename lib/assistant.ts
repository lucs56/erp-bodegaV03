export type GeneralAssistantContext = {
  now: string;
  synchronized: boolean;
  fetchedAt: string;
  operations: number;
  weeks: number;
  completedOperations: number;
  mappedOperations: number;
  blockedOperations: number;
  shortages: number;
  stockItems: number;
  changes: {
    added: number;
    modified: number;
    removed: number;
    detectedAt: string;
  };
};

export function generalAssistantFallback(
  question: string,
  context: GeneralAssistantContext,
) {
  const term = normalize(question);
  if (/^(HOLA|BUEN DIA|BUENAS|BUENOS DIAS)\b/.test(term))
    return "¡Hola! Puedo explicarte el estado general, la sincronización, los cambios del programa y para qué sirve cada módulo.";

  if (/\b(FECHA|DIA ES HOY|QUE DIA|HOY)\b/.test(term))
    return `Hoy es ${context.now}.`;

  if (/\b(SINCRON|ACTUALIZ|GOOGLE|SHEET|PLANILLA)\b/.test(term))
    return context.synchronized
      ? `Sí. La programación está sincronizada. La última lectura válida fue ${context.fetchedAt} y el sistema vuelve a comprobarla automáticamente cada 30 segundos.`
      : `En este momento se está usando la última lectura validada, del ${context.fetchedAt}. No se pierden los datos: el sistema vuelve a intentar automáticamente y también podés usar “Actualizar ahora”.`;

  if (/\b(CAMBIO|AGREG|MODIFIC|ELIMIN)\b/.test(term)) {
    const total =
      context.changes.added +
      context.changes.modified +
      context.changes.removed;
    return total
      ? `El último cambio detectado tiene ${context.changes.added} operaciones agregadas, ${context.changes.modified} modificadas y ${context.changes.removed} eliminadas. Podés abrir el aviso del Resumen para ver solamente esas filas.`
      : "No hay cambios pendientes de revisar desde la última lectura comparada.";
  }

  if (/\b(ERROR|FALLA|PROBLEMA|ESTADO|ANDA|FUNCIONA)\b/.test(term))
    return context.blockedOperations
      ? `El sistema conserva la última información válida. Hay ${context.blockedOperations} operaciones bloqueadas porque todavía no pueden relacionarse con una ficha técnica. Revisalas en Consumos o Ficha técnica.`
      : "Los módulos principales están operativos. Si Google o Cloudflare demoran, la aplicación conserva la última lectura y reintenta sin borrar el cálculo anterior.";

  if (/\b(COMPRA|FALTANTE|COMPRAR)\b/.test(term))
    return context.shortages
      ? `Hay ${context.shortages} insumos con necesidad de compra. Abrí Faltantes para revisar el origen y Compras para descargarlos agrupados. Las operaciones tachadas como realizadas no están incluidas.`
      : "Con el programa, las fichas técnicas y el stock cargados no hay faltantes calculados en este momento.";

  if (/\b(STOCK|EXISTENCIA|DEPOSITO)\b/.test(term))
    return `El último stock válido contiene ${context.stockItems} insumos. En Stock podés ver el total y su distribución por depósito; Faltantes usa ese total para el cálculo.`;

  if (/\b(FICHA|TECNICA|MATERIAL)\b/.test(term))
    return "Ficha técnica relaciona cada producto con sus botellas, cierres, cápsulas, cajas y etiquetas, indicando el consumo por botella o por caja. Es la base para calcular Consumos, Faltantes y Compras.";

  if (/\b(MODULO|COMO FUNCIONA|PARA QUE SIRVE|AYUDA|QUE HACE)\b/.test(term))
    return "El flujo general es: Programación lee Google Sheets; Ficha técnica define los insumos de cada producto; Stock carga las existencias por depósito; Consumos calcula la demanda; Faltantes compara demanda contra stock; y Compras prepara lo pendiente.";

  if (/\b(PROGRAMA|PRODUCCION|OPERACION|SEMANA)\b/.test(term))
    return `La lectura actual contiene ${context.operations} operaciones en ${context.weeks} semanas. ${context.completedOperations} están marcadas como realizadas y se excluyen de consumos y compras.`;

  return "Puedo responder consultas generales sobre el funcionamiento del ERP, la fecha, sincronización, cambios de programación, fichas técnicas, stock, faltantes y compras. Para consultar un insumo puntual, usá el buscador del módulo correspondiente.";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
