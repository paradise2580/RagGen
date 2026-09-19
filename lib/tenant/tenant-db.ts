import { prisma } from "@/lib/db";
import { PrismaClient } from "@/prisma/generated/tenant";
import { resolveTenantDatabaseUrl } from "@/lib/db-url.cjs";
export const STANDALONE_TENANT_ID=process.env.VIDEO_GENERATOR_TENANT_ID||"raggen";
const clients=new Map<string,PrismaClient>();
export async function resolveTenantClientOr404(opts?:{tenantId?:string}):Promise<PrismaClient>{
 const id=opts?.tenantId||STANDALONE_TENANT_ID;
 if(id===STANDALONE_TENANT_ID)return prisma;
 const workspace=await prisma.ragWorkspace.findUnique({where:{id}});
 if(!workspace||!/^raggen_[a-z0-9_]+$/.test(workspace.databaseName))throw new Error("Workspace database unavailable");
 const url=new URL(resolveTenantDatabaseUrl());url.pathname=`/${workspace.databaseName}`;
 const cached=clients.get(workspace.databaseName);if(cached)return cached;
 const client=new PrismaClient({datasourceUrl:url.toString()});clients.set(workspace.databaseName,client);return client;
}
export async function resolveTenantClientForSystem(tenantId?:string){return resolveTenantClientOr404({tenantId});}

export async function disconnectTenantClients(){await Promise.all([...clients.values()].map(c=>c.$disconnect()));clients.clear();}
