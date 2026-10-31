// Verify measured native answers by replaying actual operations through FX.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const assert=require('node:assert/strict');
const {finiteProblemId,verifyFiniteCertificate}=require('../../packages/fx-core/dist');
const file=path.join(__dirname,'results/heldout.json');
const h=JSON.parse(fs.existsSync(file)?fs.readFileSync(file,'utf8'):zlib.gunzipSync(fs.readFileSync(file+'.gz')));
const counts={};
for(const [split,report] of Object.entries(h.reports)){
 const cases=new Map(report.cases.map(c=>[c.id,c]));const verified=new Set();let checked=0;const problems=new Map();
 for(const repetitions of Object.values(report.samples))for(const rows of repetitions)for(const row of rows){
  const c=cases.get(row.id);
  for(let t=0;t<c.targets.length;t++){
   const [i,j]=row.answers[t];assert(i>=0&&j>=0);
   const program=[...c.words[i],...c.words[j]];const key=row.id+':'+t+':'+program.join(',');
   checked++;if(verified.has(key))continue;
   const problemKey=row.id+':'+t;
   if(!problems.has(problemKey)){
    const p={states:c.states,target:[...Buffer.from(c.targets[t],'hex')],operations:c.operations.map((hex,k)=>({name:`op${k}`,table:[...Buffer.from(hex,'hex')]}))};
    problems.set(problemKey,{p,id:finiteProblemId(p)});
   }
   const {p,id}=problems.get(problemKey);
   assert(program.length<=10,'program exceeds declared length bound');
   assert(verifyFiniteCertificate(p,{version:1,problemId:id,program,output:p.target}),'native/FX disagreement');
   verified.add(key);
  }
 }
 counts[split]={tasks:[...cases.values()].reduce((n,c)=>n+c.targets.length,0),native_answers_checked:checked,unique_certificates_verified:verified.size};
}
if(process.argv.includes('--record'))fs.writeFileSync(path.join(__dirname,'results/fx-verification.json'),JSON.stringify({node:process.version,counts},null,2)+'\n');
console.log(JSON.stringify(counts));
