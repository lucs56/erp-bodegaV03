import type { ProgramRecord } from "./program-data";

export function diffProgram(previous: ProgramRecord[], next: ProgramRecord[]) {
  const beforeRecords = new Map(previous.map((record) => [record.id, record]));
  const afterRecords = new Map(next.map((record) => [record.id, record]));
  const before = new Map(previous.map((record) => [record.id, signature(record)]));
  const after = new Map(next.map((record) => [record.id, signature(record)]));
  let added = 0; let removed = 0; let modified = 0;
  const changedIds:string[]=[]; const changedWeekIds=new Set<string>();
  for (const [id, value] of after) {
    if (!before.has(id)) { added += 1; changedIds.push(id); changedWeekIds.add(afterRecords.get(id)!.weekId); }
    else if (before.get(id) !== value) { modified += 1; changedIds.push(id); changedWeekIds.add(afterRecords.get(id)!.weekId); }
  }
  for (const id of before.keys()) if (!after.has(id)) { removed += 1; changedWeekIds.add(beforeRecords.get(id)!.weekId); }
  return { added, removed, modified, total: added + removed + modified, changedIds, changedWeekIds:[...changedWeekIds] };
}

function signature(record: ProgramRecord) {
  return JSON.stringify([record.weekId, record.line, record.action, record.pin, record.productCode, record.brand, record.variety, record.vintage, record.bottles, record.client, record.country, record.materials]);
}
