import test from "node:test"; import assert from "node:assert/strict";
import { diffProgram } from "../lib/program-diff.ts";
const base = { id:"a",weekId:"w",weekLabel:"W",sourceSheet:"S",sourceRow:1,line:"linea-1",action:"FRACCIONAR",pin:"",productCode:"P",brand:"V",variety:"M",vintage:"2025",bottles:100,client:"",country:"",materials:{} } as never;
test("detecta altas, bajas y modificaciones",()=>{ const result=diffProgram([base,{...base,id:"b"}],[{...base,bottles:120},{...base,id:"c"}]); assert.deepEqual(result,{added:1,removed:1,modified:1,total:3,changedIds:["a","c"],changedWeekIds:[base.weekId]}); });
