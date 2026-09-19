import { prisma } from "../lib/db";
import { resolveTenantClientForSystem, disconnectTenantClients } from "../lib/tenant/tenant-db";
import { runNextTask } from "../lib/video-generator/rag/queue";
let stopping=false;process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
async function main(){
 do{
  const ids=[...new Set([process.env.VIDEO_GENERATOR_TENANT_ID||"raggen",...(await prisma.ragWorkspace.findMany({select:{id:true}})).map(w=>w.id)])];
  let worked=false;
  for(const id of ids){const db=await resolveTenantClientForSystem(id);worked=await runNextTask(db,id)||worked;}
  if(process.argv.includes("--once"))break;
  if(!worked)await new Promise(r=>setTimeout(r,1500));
 }while(!stopping);
}
main().catch(e=>{console.error("RagGen worker stopped:",e.name);process.exitCode=1;}).finally(async()=>{await disconnectTenantClients();await prisma.$disconnect();});
