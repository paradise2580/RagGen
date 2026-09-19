import { spawnSync } from "node:child_process";
import { prisma } from "../lib/db";
import { PrismaClient } from "../prisma/generated/tenant";
import { resolveTenantClientForSystem,disconnectTenantClients } from "../lib/tenant/tenant-db";
import { hashPassword } from "../lib/rag-auth";
import { resolveTenantDatabaseUrl } from "../lib/db-url.cjs";

// Run from RagGen. Password is accepted only through the environment, never an argument.
async function main() {
 const [command,id,nameOrEmail,role="EDITOR"]=process.argv.slice(2);
 const local=process.env.VIDEO_GENERATOR_TENANT_ID||"raggen";
 if(command==="create"){
  if(!id||!/^[a-z0-9_]{3,40}$/.test(id))throw new Error("Workspace id must be 3-40 lowercase letters, digits or underscores.");
  if(await prisma.ragWorkspace.findUnique({where:{id}}))throw new Error("Workspace already exists; no database was changed.");
  const databaseName=id===local?decodeURIComponent(new URL(resolveTenantDatabaseUrl()).pathname.slice(1)):`raggen_${id}`;
  if(id!==local){
   const exists=await prisma.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname=${databaseName}`;
   if(exists.length)throw new Error("Database already exists. Refusing to adopt or overwrite it.");
   await prisma.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
   const url=new URL(resolveTenantDatabaseUrl());url.pathname=`/${databaseName}`;
   const db=new PrismaClient({datasourceUrl:url.toString()});
   try { await db.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector"); } finally { await db.$disconnect(); }
   for(const args of [["node_modules/prisma/build/index.js","db","push","--skip-generate"],["node_modules/tsx/dist/cli.mjs","-r","tsconfig-paths/register","scripts/rag-vector-migrate.ts"]]){
    const result=spawnSync(process.execPath,args,{env:{...process.env,TENANT_DATABASE_URL:url.toString()},stdio:"pipe",windowsHide:true});
    if(result.status!==0)throw new Error("Workspace schema setup failed. Database retained for diagnosis; directory membership was not granted.");
   }
  }
  await prisma.ragWorkspace.create({data:{id,name:nameOrEmail||id,databaseName}});
  console.log(`Workspace ${id} created.`);return;
 }
 if(command==="member"){
  const email=(nameOrEmail||"").trim().toLowerCase();
  if(!email.includes("@")||!["OWNER","EDITOR"].includes(role))throw new Error("Usage: member WORKSPACE EMAIL [OWNER|EDITOR]");
  if(!await prisma.ragWorkspace.findUnique({where:{id}}))throw new Error("Create the workspace first.");
  let user=await prisma.ragUser.findUnique({where:{email}});
  if(!user){
   const password=process.env.RAG_USER_PASSWORD||"";
   if(password.length<12||password.length>256)throw new Error("For a new user, set RAG_USER_PASSWORD to 12-256 characters in this process environment.");
   user=await prisma.ragUser.create({data:{email,name:email.split("@")[0],passwordHash:await hashPassword(password)}});
  }
  await prisma.ragMembership.upsert({where:{userId_workspaceId:{userId:user.id,workspaceId:id}},create:{userId:user.id,workspaceId:id,role},update:{role}});
  console.log("Workspace membership saved.");return;
 }
 if(command==="credits"){
  const amount=Number(nameOrEmail);if(!Number.isSafeInteger(amount)||amount<1||amount>1000000)throw new Error("Credit increment must be 1-1000000.");
  if(!await prisma.ragWorkspace.findUnique({where:{id}}))throw new Error("Workspace not found.");
  const db=await resolveTenantClientForSystem(id);
  await db.organizationCredit.upsert({where:{tenantId:id},create:{tenantId:id,balance:amount,isTrial:false},update:{balance:{increment:amount}}});
  console.log("Application credits added. This does not change provider budgets.");return;
 }
 if(command==="disable"){
  const user=await prisma.ragUser.findUniqueOrThrow({where:{email:id.toLowerCase()}});
  await prisma.$transaction([prisma.ragUser.update({where:{id:user.id},data:{disabled:true}}),prisma.ragSession.deleteMany({where:{userId:user.id}})]);
  console.log("User disabled and sessions revoked.");return;
 }
 throw new Error("Usage: rag:workspace create ID NAME | member ID EMAIL [OWNER|EDITOR] | disable EMAIL | credits ID AMOUNT");
}
main().catch(e=>{console.error(e instanceof Error&&!String(e.message).includes("prisma")?e.message:"Workspace operation failed.");process.exitCode=1;}).finally(async()=>{await disconnectTenantClients();await prisma.$disconnect();});
