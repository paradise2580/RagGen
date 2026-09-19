import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/rag-auth";
import { disconnectTenantClients,resolveTenantClientForSystem } from "../lib/tenant/tenant-db";
import { POST as authPost } from "../app/api/video-generator/auth/[action]/route";
import { GET as brandsGet, POST as brandsPost } from "../app/api/video-generator/brands/[[...segments]]/route";
import { POST as ragPost } from "../app/api/video-generator/rag/[[...segments]]/route";
import { GET as productsGet } from "../app/api/video-generator/products/route";
const id=`test_${randomUUID().replaceAll("-","").slice(0,16)}`,databaseName=`raggen_${id}`,email=`${id}@test.invalid`;
let created=false;
async function main(){
 assert.equal(new URL(process.env.TENANT_DATABASE_URL!).pathname,"/raggen");
 const child=spawnSync(process.execPath,["node_modules/tsx/dist/cli.mjs","-r","tsconfig-paths/register","-r","./scripts/db-env.cjs","scripts/rag-workspace.ts","create",id,"Isolation test"],{env:process.env,encoding:"utf8",windowsHide:true});
 assert.equal(child.status,0,"Workspace provisioning must succeed");created=true;
 const password=randomUUID()+randomUUID();
 await prisma.ragUser.create({data:{email,name:"Isolation test",passwordHash:await hashPassword(password),memberships:{create:{workspaceId:id,role:"EDITOR"}}}});
 process.env.RAG_AUTH_MODE="required";
 const login=await authPost(new NextRequest("http://localhost:3101/api/video-generator/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})}),{params:{action:"login"}});
 assert.equal(login.status,200);const cookie=login.headers.get("set-cookie")!.split(";")[0];assert.match(login.headers.get("set-cookie")!,/HttpOnly/i);
 const req=(path:string,method="GET",body?:any,workspace=id)=>new NextRequest(`http://localhost:3101/api/video-generator${path}`,{method,headers:{cookie,"x-workspace-id":workspace,"Content-Type":"application/json",...(process.env.VIDEO_GENERATOR_API_TOKEN?{"x-api-token":process.env.VIDEO_GENERATOR_API_TOKEN}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal((await brandsGet(req("/brands","GET",undefined,"not-a-membership"),{params:{}})).status,401);
 const createdBrand=await brandsPost(req("/brands","POST",{name:"Private brand"}),{params:{}});assert.equal(createdBrand.status,201);const brand=await createdBrand.json();
 assert.equal(await prisma.ragBrand.findUnique({where:{id:brand.id}}),null);
 const db=await resolveTenantClientForSystem(id);assert.ok(await db.ragBrand.findUnique({where:{id:brand.id}}));
 assert.equal((await (await productsGet(req("/products"))).json()).length,0);
 assert.equal((await ragPost(req("/rag/budget","POST",{monthlyLimitMicros:10}),{params:{segments:["budget"]}})).status,403);
 const forbidden=req("/brands","POST",{name:"Attack"});forbidden.headers.set("origin","https://attacker.invalid");assert.equal((await brandsPost(forbidden,{params:{}})).status,403);
 const logout=await authPost(req("/auth/logout","POST"),{params:{action:"logout"}});assert.equal(logout.status,200);
 assert.equal((await brandsGet(req("/brands"),{params:{}})).status,401);
 console.log("PASS isolated database provisioning, cookie login/logout, membership enforcement, owner-only budgets, origin checks, and product/brand isolation.");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 await disconnectTenantClients();await prisma.ragUser.deleteMany({where:{email}});await prisma.ragWorkspace.deleteMany({where:{id}});
 if(created&&/^raggen_test_[a-f0-9]{16}$/.test(databaseName))await prisma.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
 await prisma.$disconnect();
});
