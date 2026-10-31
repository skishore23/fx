// Application-derived finite model built by calling FX's real getMemory API.
// A retain adapter writes memoryFiltered back as the next operation's memory.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {getMemory}=require('../../packages/fx-core/dist/memory');
const {synthesizeFiniteComposition,verifyFiniteCertificate}=require('../../packages/fx-core/dist');
async function main(){
 const entries=Array.from({length:6},(_,i)=>({id:`e${i}`,type:i%2?'error':'observation',content:i%3?'routine':'URGENT',timestamp:new Date(1000+i*1000)}));
 const filters=[{type:'error'},{type:'observation'},{search:'urgent'},{since:new Date(3500)},{limit:1},{limit:2},{limit:-1}];
 const decode=mask=>entries.filter((_,i)=>mask&(1<<i));
 const encode=rows=>rows.reduce((m,e)=>m|(1<<entries.findIndex(x=>x.id===e.id)),0);
 const ops=[];
 for(let i=0;i<filters.length;i++){
  const table=[];for(let x=0;x<64;x++){const r=await getMemory(filters[i])({memory:decode(x)});table.push(encode(r.memoryFiltered));}
  ops.push({name:`retain${i}`,table});
 }
 const bank=[{table:Array.from({length:64},(_,x)=>x),word:[]}];const seen=new Set([bank[0].table.join(',')]);
 for(let k=0;k<bank.length;k++){
  const p=bank[k];if(p.word.length===3)continue;
  for(let a=0;a<ops.length;a++){const t=p.table.map(x=>ops[a].table[x]);const key=t.join(',');if(!seen.has(key)){seen.add(key);bank.push({table:t,word:[...p.word,a]});}}
 }
 const tasks=[];const goalSeen=new Set(seen);
 outer:for(const s of bank)for(const p of bank){const target=p.table.map(x=>s.table[x]);const key=target.join(',');if(!goalSeen.has(key)){goalSeen.add(key);tasks.push({target,reference:[...p.word,...s.word]});if(tasks.length===12)break outer;}}
 const records=[];
 for(const task of tasks){
  const problem={states:64,operations:ops,target:task.target};const result=synthesizeFiniteComposition(problem,{maxLength:6});
  assert.equal(result.status,'solved');assert(verifyFiniteCertificate(problem,result.certificate));
  for(let x=0;x<64;x++){
   let rows=decode(x);
   for(const a of result.certificate.program){const output=await getMemory(filters[a])({memory:rows});rows=output.memoryFiltered;}
   assert.equal(encode(rows),task.target[x],'Actual FX replay disagrees with synthesized model');
  }
  records.push({certificate:result.certificate,reference:task.reference,usage:result.usage});
 }
 assert(tasks.length>0,'No nontrivial tasks generated');
 const result={states:64,operations:ops,bank_size:bank.length,tasks:tasks.length,actual_fx_replays:64*tasks.length,records,
  scope:'Application-derived exhaustive six-entry subset model using actual FX getMemory calls plus a retain adapter. Synthetic entries; no production traces, production speedup or learned-plan improvement claim.'};
 if(process.argv.includes('--record'))fs.writeFileSync(path.join(__dirname,'results/fx-memory.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({tasks:result.tasks,actual_fx_replays:result.actual_fx_replays,bank_size:result.bank_size}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
